// packages/emmy-tools/tests/web-search.test.ts
//
// Plan 03.1-02 Task 1 (RED) — web_search tool unit tests.
//
// Covers D-34:
//   - Success path: HTTP GET /search?q=&format=json → SearchResult[] mapping
//     (content → snippet, engine → engine).
//   - Fallback on connection-refused: ToolError-shaped result + tool.web_search.fallback
//     event; does NOT throw.
//   - Fallback on 5xx: same ToolError-shaped result + fallback event.
//   - Rate limit (T-03.1-02-03): 11th call within a turn returns ToolError
//     "rate limit: 10 searches per turn"; counter resets via resetTurnSearchCount.
//
// Test strategy: a Bun.serve() mock plays SearxNG with controllable responses.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
	__resetSearchCountForTests,
	resetTurnSearchCount,
	webSearch,
	type SearchResult,
	type WebSearchToolErrorResult,
} from "../src/web-search";

// ---- fixture SearxNG payload ---------------------------------------------
const CANNED_JSON = {
	query: "bun runtime",
	number_of_results: 3,
	results: [
		{
			title: "Bun — A fast JavaScript runtime",
			url: "https://bun.sh/",
			content: "Bun is a fast all-in-one JavaScript runtime for Node-replacing workloads.",
			engine: "google",
			category: "general",
		},
		{
			title: "bun vs node — benchmark thread",
			url: "https://bun.sh/blog/bun-vs-node",
			content: "Benchmarks comparing Bun and Node for HTTP throughput.",
			engine: "duckduckgo",
			category: "general",
		},
		{
			title: "Bun GitHub repo",
			url: "https://github.com/oven-sh/bun",
			content: "Official oven-sh/bun source repository.",
			engine: "brave",
			category: "general",
		},
	],
	answers: [],
	suggestions: [],
	infoboxes: [],
};

// ---- Mock SearxNG server --------------------------------------------------
// Multiple modes via path:
//   /ok → returns CANNED_JSON
//   /err500 → returns 500 Internal Server Error
//   /hang → never responds (to exercise AbortController timeout path)
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let lastReceivedQuery: string | null = null;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			// Accept /search for the happy path to mirror real SearxNG.
			if (url.pathname === "/search") {
				const mode = url.searchParams.get("mock_mode") ?? "ok";
				lastReceivedQuery = url.searchParams.get("q");
				if (mode === "err500") {
					return new Response("upstream blew up", { status: 500 });
				}
				if (mode === "hang") {
					return new Promise<Response>(() => {
						/* never resolve */
					});
				}
				return new Response(JSON.stringify(CANNED_JSON), {
					headers: { "content-type": "application/json" },
				});
			}
			return new Response("not found", { status: 404 });
		},
	});
	baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

beforeEach(() => {
	__resetSearchCountForTests();
	lastReceivedQuery = null;
});

// ---- Emitted telemetry collector -----------------------------------------
interface CollectedEvent {
	event: string;
	[k: string]: unknown;
}
const collected: CollectedEvent[] = [];
function testEmit(ev: CollectedEvent): void {
	collected.push(ev);
}
beforeEach(() => {
	collected.length = 0;
});

// -------------------- TESTS --------------------

describe("webSearch — success path: SearxNG JSON → SearchResult[]", () => {
	test("returns 3 results with correct field mapping (content → snippet, engine)", async () => {
		const out = await webSearch("bun runtime", {
			baseUrl,
			mockMode: "ok",
			emit: testEmit,
		});
		// NOT a ToolError
		expect("isError" in out && (out as WebSearchToolErrorResult).isError === true).toBe(false);
		const results = out as SearchResult[];
		expect(Array.isArray(results)).toBe(true);
		expect(results).toHaveLength(3);
		// First result mapping
		expect(results[0]!.title).toBe("Bun — A fast JavaScript runtime");
		expect(results[0]!.url).toBe("https://bun.sh/");
		expect(results[0]!.snippet).toBe(
			"Bun is a fast all-in-one JavaScript runtime for Node-replacing workloads.",
		);
		expect(results[0]!.engine).toBe("google");
		expect(results[1]!.engine).toBe("duckduckgo");
		expect(results[2]!.engine).toBe("brave");
	});

	test("sends query string via q= and format=json", async () => {
		await webSearch("bun runtime", { baseUrl, mockMode: "ok", emit: testEmit });
		expect(lastReceivedQuery).toBe("bun runtime");
	});

	test("missing `content` field → snippet = '' (not undefined)", async () => {
		// Isolated inline server that returns a result with no `content` field.
		const altServer = Bun.serve({
			port: 0,
			async fetch(_req) {
				return new Response(
					JSON.stringify({
						query: "x",
						number_of_results: 1,
						results: [{ title: "no snippet", url: "https://example.org/", engine: "ddg" }],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			},
		});
		try {
			const out = await webSearch("x", {
				baseUrl: `http://127.0.0.1:${altServer.port}`,
				mockMode: "ok",
				emit: testEmit,
			});
			const results = out as SearchResult[];
			expect(results[0]!.snippet).toBe("");
			expect(results[0]!.engine).toBe("ddg");
		} finally {
			altServer.stop(true);
		}
	});
});

describe("webSearch — fallback path (T-03.1-02-03 docs + safety)", () => {
	test("connection refused → ToolError-shaped result + fallback event; does NOT throw", async () => {
		// Port 1 is almost never bound and will connect-refused instantly.
		const unreachable = "http://127.0.0.1:1";
		const out = await webSearch("anything", {
			baseUrl: unreachable,
			mockMode: "ok",
			emit: testEmit,
			timeoutMs: 2000,
		});
		// result must be ToolError-shaped (NOT thrown)
		const err = out as WebSearchToolErrorResult;
		expect(err.isError).toBe(true);
		expect(Array.isArray(err.content)).toBe(true);
		expect(err.content[0]!.type).toBe("text");
		expect(err.content[0]!.text.toLowerCase()).toContain("search");
		// emitted fallback event
		expect(collected.some((e) => e.event === "tool.web_search.fallback")).toBe(true);
	});

	test("500 upstream → ToolError-shaped + fallback event; does NOT throw", async () => {
		const out = await webSearch("bun", {
			baseUrl,
			mockMode: "err500",
			emit: testEmit,
		});
		const err = out as WebSearchToolErrorResult;
		expect(err.isError).toBe(true);
		expect(err.content[0]!.text.toLowerCase()).toContain("search");
		expect(collected.some((e) => e.event === "tool.web_search.fallback")).toBe(true);
	});
});

describe("webSearch — rate limit (T-03.1-02-03)", () => {
	test("11th call in a turn returns ToolError with 'rate limit: 10 searches per turn'", async () => {
		// Burn 10 successful calls (the counter increments per call attempt, not
		// per successful call — the `_turnSearchCount >= limit` check gates entry).
		for (let i = 0; i < 10; i++) {
			await webSearch(`q${i}`, { baseUrl, mockMode: "ok", emit: testEmit });
		}
		// 11th
		const out = await webSearch("q11", { baseUrl, mockMode: "ok", emit: testEmit });
		const err = out as WebSearchToolErrorResult;
		expect(err.isError).toBe(true);
		const text = err.content[0]!.text.toLowerCase();
		expect(text).toContain("rate limit");
		expect(text).toContain("10");
		// Emitted rate_limit event
		expect(collected.some((e) => e.event === "tool.web_search.rate_limit")).toBe(true);
	});

	test("resetTurnSearchCount re-enables search after the cap is hit", async () => {
		for (let i = 0; i < 10; i++) {
			await webSearch(`q${i}`, { baseUrl, mockMode: "ok", emit: testEmit });
		}
		// Hit cap
		const capped = await webSearch("q_cap", {
			baseUrl,
			mockMode: "ok",
			emit: testEmit,
		});
		expect((capped as WebSearchToolErrorResult).isError).toBe(true);
		// Reset (simulates turn_end)
		resetTurnSearchCount();
		// Next call succeeds
		const out = await webSearch("q_after_reset", {
			baseUrl,
			mockMode: "ok",
			emit: testEmit,
		});
		expect(Array.isArray(out)).toBe(true);
		expect((out as SearchResult[])[0]!.title).toContain("Bun");
	});
});
