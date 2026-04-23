// packages/emmy-tools/tests/web-search.integration.test.ts
//
// Plan 03.1-02 Task 1 (RED) — web_search tool registration via native-tools.
//
// Covers:
//   - registerWebSearchTool returns null when opts.enabled=false
//   - registerWebSearchTool returns null when EMMY_WEB_SEARCH=off
//   - registerWebSearchTool returns null when EMMY_TELEMETRY=off (inherit kill-switch)
//   - registerWebSearchTool returns a tool spec (name=web_search, parameters { query, max_results })
//     under normal conditions
//   - Tool's invoke function dispatches to webSearch and returns results

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	registerWebSearchTool,
	type SearchResult,
	type WebSearchToolErrorResult,
} from "../src/web-search";

const ENV_KEYS = ["EMMY_WEB_SEARCH", "EMMY_TELEMETRY"] as const;

type EnvSnap = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let envBackup: EnvSnap = {};

beforeEach(() => {
	envBackup = {};
	for (const k of ENV_KEYS) {
		envBackup[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		const v = envBackup[k];
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe("registerWebSearchTool — kill-switch respected", () => {
	test("enabled=false → returns null", () => {
		const spec = registerWebSearchTool({
			enabled: false,
			config: {
				baseUrl: "http://127.0.0.1:8888",
				maxResultsDefault: 10,
				rateLimitPerTurn: 10,
				timeoutMs: 10000,
			},
		});
		expect(spec).toBeNull();
	});

	test("EMMY_WEB_SEARCH=off → returns null", () => {
		process.env.EMMY_WEB_SEARCH = "off";
		const spec = registerWebSearchTool({
			enabled: true,
			config: {
				baseUrl: "http://127.0.0.1:8888",
				maxResultsDefault: 10,
				rateLimitPerTurn: 10,
				timeoutMs: 10000,
			},
		});
		expect(spec).toBeNull();
	});

	test("EMMY_TELEMETRY=off → returns null (inherited kill-switch)", () => {
		process.env.EMMY_TELEMETRY = "off";
		const spec = registerWebSearchTool({
			enabled: true,
			config: {
				baseUrl: "http://127.0.0.1:8888",
				maxResultsDefault: 10,
				rateLimitPerTurn: 10,
				timeoutMs: 10000,
			},
		});
		expect(spec).toBeNull();
	});

	test("normal env → returns tool spec with name=web_search", () => {
		const spec = registerWebSearchTool({
			enabled: true,
			config: {
				baseUrl: "http://127.0.0.1:8888",
				maxResultsDefault: 10,
				rateLimitPerTurn: 10,
				timeoutMs: 10000,
			},
		});
		expect(spec).not.toBeNull();
		expect(spec!.name).toBe("web_search");
		// schema has query + max_results
		const params = spec!.parameters as {
			properties: Record<string, unknown>;
			required?: string[];
		};
		expect(params.properties).toHaveProperty("query");
		expect(params.properties).toHaveProperty("max_results");
		expect(params.required).toEqual(["query"]);
	});
});

describe("registerWebSearchTool — invoke dispatches webSearch", () => {
	test("invoke with a valid query dispatches to webSearch and returns results array", async () => {
		// Stand up a local Bun.serve that behaves as SearxNG JSON.
		const altServer = Bun.serve({
			port: 0,
			async fetch(_req) {
				return new Response(
					JSON.stringify({
						query: "integration",
						number_of_results: 1,
						results: [
							{
								title: "Integration",
								url: "https://example.org/",
								content: "integration content",
								engine: "google",
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			},
		});
		try {
			const spec = registerWebSearchTool({
				enabled: true,
				config: {
					baseUrl: `http://127.0.0.1:${altServer.port}`,
					maxResultsDefault: 10,
					rateLimitPerTurn: 10,
					timeoutMs: 5000,
				},
			});
			expect(spec).not.toBeNull();
			const out = await spec!.invoke({ query: "integration" });
			// Tool invoke returns either results array directly or a wrapped object
			// — the contract is that callers can distinguish error from ok. We
			// assert it's NOT a ToolError-shaped result and has results.
			if ((out as WebSearchToolErrorResult).isError) {
				throw new Error(`expected ok result, got error: ${JSON.stringify(out)}`);
			}
			const results = (out as { results: SearchResult[] }).results ?? (out as SearchResult[]);
			const arr = Array.isArray(results) ? results : (out as { results: SearchResult[] }).results;
			expect(arr).toBeTruthy();
			expect(arr[0]!.title).toBe("Integration");
			expect(arr[0]!.url).toBe("https://example.org/");
		} finally {
			altServer.stop(true);
		}
	});
});
