// packages/emmy-tools/tests/web-search-env-override.test.ts
//
// Plan 04.2-05 Task 1 — EMMY_SEARXNG_URL env override + D-33 LOCKED loopback
// invariant. Four-test file:
//   1. env set → webSearch hits the env URL (proves remote-client posture works)
//   2. env unset → DEFAULT_CFG.baseUrl is exactly "http://127.0.0.1:8888"
//      (D-33 LOCKED loopback invariant for local mode preserved)
//   3. env set to https Tailscale URL → DEFAULT_CFG.baseUrl matches verbatim
//   4. env-flip mid-test is picked up (getter is live, not cached)
//
// Critical: env vars MUST be saved+restored per-test (S-2 pattern from PATTERNS.md)
// to prevent test-order contamination. Per checker iter-1 BLOCKER #5 fix, the
// implementation uses a GETTER (not a module-load-time literal), which means
// no Bun module-cache poking and no `?t=${Date.now()}` query-string re-imports
// are needed — the getter resolves env LIVE on every read.
//
// Cross-references:
//   - .planning/phases/04.2-remote-client-mode-parity/04.2-PATTERNS.md §Group C
//   - .planning/phases/03.1-operational-polish-minimal-ram-profile-live-auto-compaction-/03.1-CONTEXT.md D-33 LOCKED
//   - .planning/phases/04.2-remote-client-mode-parity/04.2-CONTEXT.md C-03

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

describe("web-search EMMY_SEARXNG_URL env override (Plan 04.2-05)", () => {
	let oldEnv: string | undefined;
	let server: ReturnType<typeof Bun.serve>;
	let mockBaseUrl: string;
	let lastReceivedQuery: string | null = null;

	const CANNED_JSON = JSON.stringify({
		query: "test",
		number_of_results: 1,
		results: [
			{
				title: "test result",
				url: "https://example.com/x",
				content: "snippet",
				engine: "google",
			},
		],
		answers: [],
		suggestions: [],
		infoboxes: [],
	});

	beforeAll(() => {
		server = Bun.serve({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				lastReceivedQuery = url.searchParams.get("q");
				if (url.pathname === "/search") {
					return new Response(CANNED_JSON, {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		});
		mockBaseUrl = `http://127.0.0.1:${server.port}`;
	});
	afterAll(() => {
		server.stop(true);
	});

	beforeEach(() => {
		oldEnv = process.env.EMMY_SEARXNG_URL;
		lastReceivedQuery = null;
	});
	afterEach(() => {
		if (oldEnv === undefined) delete process.env.EMMY_SEARXNG_URL;
		else process.env.EMMY_SEARXNG_URL = oldEnv;
	});

	test("EMMY_SEARXNG_URL set → DEFAULT_CFG.baseUrl uses env override (live getter, no module reload)", async () => {
		// BLOCKER #5 fix: baseUrl is a getter; setting the env var AFTER module load
		// is picked up on the next read. NO Bun cache-busting; NO query-string re-import.
		process.env.EMMY_SEARXNG_URL = mockBaseUrl;
		const { __getDefaultCfgForTests, webSearch, __resetSearchCountForTests } =
			await import("../src/web-search");
		__resetSearchCountForTests();
		const cfg = __getDefaultCfgForTests();
		expect(cfg.baseUrl).toBe(mockBaseUrl); // getter resolves env LIVE

		// Behavioral cross-check: webSearch actually fetches the env URL.
		await webSearch("phase 04.2 test", { emit: () => {} });
		expect(lastReceivedQuery).toBe("phase 04.2 test");
	});

	test("EMMY_SEARXNG_URL UNSET → DEFAULT_CFG.baseUrl is exactly 'http://127.0.0.1:8888' (D-33 LOCKED loopback invariant)", async () => {
		delete process.env.EMMY_SEARXNG_URL;
		const { __getDefaultCfgForTests } = await import("../src/web-search");
		const cfg = __getDefaultCfgForTests();
		// The getter resolves NOW, with env unset → literal loopback default.
		expect(cfg.baseUrl).toBe("http://127.0.0.1:8888");
	});

	test("EMMY_SEARXNG_URL set to https Tailscale URL → DEFAULT_CFG.baseUrl matches verbatim", async () => {
		process.env.EMMY_SEARXNG_URL = "https://spark.example.ts.net:8888";
		const { __getDefaultCfgForTests } = await import("../src/web-search");
		const cfg = __getDefaultCfgForTests();
		expect(cfg.baseUrl).toBe("https://spark.example.ts.net:8888");
	});

	test("env-flip mid-test is picked up (getter is live, not cached)", async () => {
		// Confirms BLOCKER #5 fix invariant: changing env after module-load works.
		const { __getDefaultCfgForTests } = await import("../src/web-search");
		delete process.env.EMMY_SEARXNG_URL;
		expect(__getDefaultCfgForTests().baseUrl).toBe("http://127.0.0.1:8888");
		process.env.EMMY_SEARXNG_URL = "https://flipped.example.ts.net:8888";
		expect(__getDefaultCfgForTests().baseUrl).toBe("https://flipped.example.ts.net:8888");
		delete process.env.EMMY_SEARXNG_URL;
		expect(__getDefaultCfgForTests().baseUrl).toBe("http://127.0.0.1:8888");
	});
});
