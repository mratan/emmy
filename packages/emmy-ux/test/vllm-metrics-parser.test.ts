// packages/emmy-ux/test/vllm-metrics-parser.test.ts
//
// Plan 03-04 Task 1 (RED). Imports `parseMetrics`, `fetchVllmMetrics`,
// `TokRateTracker`, `computeTokRate`, and type `MetricSnapshot` from
// ../src/vllm-metrics (not yet created — RED).
//
// Fixture semantics mirror the vLLM 0.19 Prometheus exposition surface
// verified in 03-RESEARCH.md §Summary #3:
//   vllm:gpu_cache_usage_perc{model_name="..."} 0.34      # Gauge 0-1
//   vllm:generation_tokens_total{model_name="..."} 15823  # Counter
// Note: KV cache metric name is `gpu_cache_usage_perc` — NOT
// `kv_cache_usage_perc` (CONTEXT D-22 transcribed wrong; RESEARCH §Summary
// #3 verified).
//
// Pitfall #6 guard: raw 1-second delta of generation_tokens_total is noisy
// — tok/s must be computed over a sliding window (5s) to smooth out
// per-request completion timing bumps.

import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";

import {
	fetchVllmMetrics,
	parseMetrics,
	TokRateTracker,
	computeTokRate,
	type MetricSnapshot,
	type MetricSample,
} from "../src/vllm-metrics";

describe("parseMetrics (Prometheus text -> MetricSnapshot)", () => {
	test("parses labeled metric line: `vllm:gpu_cache_usage_perc{model_name=\"x\"} 0.34`", () => {
		const text = `vllm:gpu_cache_usage_perc{model_name="gemma-4-26b-a4b-it"} 0.34`;
		const out: MetricSnapshot = parseMetrics(text);
		expect(out["vllm:gpu_cache_usage_perc"]).toBe(0.34);
	});

	test("parses multiple labeled metrics from a full /metrics body", () => {
		const text = [
			'# HELP vllm:gpu_cache_usage_perc GPU KV-cache usage percentage',
			'# TYPE vllm:gpu_cache_usage_perc gauge',
			'vllm:gpu_cache_usage_perc{model_name="gemma-4-26b-a4b-it"} 0.34',
			'vllm:num_requests_running{model_name="gemma-4-26b-a4b-it"} 1',
			'vllm:generation_tokens_total{model_name="gemma-4-26b-a4b-it"} 15823',
		].join("\n");
		const out = parseMetrics(text);
		expect(out["vllm:gpu_cache_usage_perc"]).toBe(0.34);
		expect(out["vllm:num_requests_running"]).toBe(1);
		expect(out["vllm:generation_tokens_total"]).toBe(15823);
	});

	test("ignores comment lines starting with #", () => {
		const text = `# HELP foo bar\n# TYPE foo gauge\nfoo 42`;
		const out = parseMetrics(text);
		expect(out["foo"]).toBe(42);
		expect(out["# HELP foo bar"]).toBeUndefined();
	});

	test("ignores empty lines", () => {
		const text = `\n\nfoo 42\n\n`;
		const out = parseMetrics(text);
		expect(out["foo"]).toBe(42);
	});

	test("parses metric without label braces: `metric_name 42.0`", () => {
		const text = `some_metric 42.0`;
		const out = parseMetrics(text);
		expect(out["some_metric"]).toBe(42);
	});

	test("skips non-numeric values (not NaN)", () => {
		const text = `broken_metric nope\ngood_metric 7`;
		const out = parseMetrics(text);
		expect("broken_metric" in out).toBe(false);
		expect(out["good_metric"]).toBe(7);
	});
});

describe("fetchVllmMetrics (HTTP GET + parse)", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("fetches /metrics from baseUrl and returns parsed snapshot", async () => {
		const body = [
			'# HELP x',
			'vllm:gpu_cache_usage_perc{model_name="m"} 0.5',
			'vllm:generation_tokens_total{model_name="m"} 1000',
		].join("\n");
		globalThis.fetch = (async (_url: string) =>
			new Response(body, { status: 200 })) as typeof globalThis.fetch;

		const snap = await fetchVllmMetrics("http://127.0.0.1:8002");
		expect(snap["vllm:gpu_cache_usage_perc"]).toBe(0.5);
		expect(snap["vllm:generation_tokens_total"]).toBe(1000);
	});

	test("throws on non-2xx HTTP status", async () => {
		globalThis.fetch = (async () =>
			new Response("oops", { status: 500 })) as typeof globalThis.fetch;
		await expect(fetchVllmMetrics("http://127.0.0.1:8002")).rejects.toThrow();
	});

	test("handles trailing slash in baseUrl", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			calls.push(String(url));
			return new Response("", { status: 200 });
		}) as typeof globalThis.fetch;
		await fetchVllmMetrics("http://127.0.0.1:8002/");
		expect(calls[0]).toBe("http://127.0.0.1:8002/metrics");
	});
});

describe("computeTokRate (5-sample sliding window over generation_tokens_total)", () => {
	test("computes tokens/sec across 5 samples", () => {
		// Pitfall #6 fixture from plan frontmatter behavior:
		//   [{ts:0, tokens:0}, {ts:1000, tokens:100}, {ts:2000, tokens:250},
		//    {ts:3000, tokens:400}, {ts:4000, tokens:580}]
		//   rate = (580 - 0) / ((4000 - 0) / 1000) = 145 tok/s
		const samples: MetricSample[] = [
			{ ts: 0, tokens: 0 },
			{ ts: 1000, tokens: 100 },
			{ ts: 2000, tokens: 250 },
			{ ts: 3000, tokens: 400 },
			{ ts: 4000, tokens: 580 },
		];
		expect(computeTokRate(samples)).toBe(145);
	});

	test("< 2 samples returns 0 (warmup)", () => {
		expect(computeTokRate([])).toBe(0);
		expect(computeTokRate([{ ts: 1000, tokens: 10 }])).toBe(0);
	});

	test("zero elapsed time returns 0 (divide-by-zero guard)", () => {
		const samples: MetricSample[] = [
			{ ts: 1000, tokens: 10 },
			{ ts: 1000, tokens: 20 },
		];
		expect(computeTokRate(samples)).toBe(0);
	});
});

describe("TokRateTracker (sliding window state machine)", () => {
	test("drops samples older than 5s from the window", () => {
		const tr = new TokRateTracker();
		tr.push(0, 0);
		tr.push(100, 1000);
		tr.push(200, 2000);
		// Advance well beyond window; push at t=10000 — old samples should drop
		tr.push(500, 10000);
		// Only the latest sample survives → less than 2 samples → rate = 0
		expect(tr.samplesInWindow()).toBe(1);
		expect(tr.rate(10000)).toBe(0);
	});

	test("warmup state: first push → rate = 0", () => {
		const tr = new TokRateTracker();
		tr.push(0, 0);
		expect(tr.rate(0)).toBe(0);
	});

	test("steady state matches computeTokRate for samples inside window", () => {
		const tr = new TokRateTracker();
		tr.push(0, 0);
		tr.push(100, 1000);
		tr.push(250, 2000);
		tr.push(400, 3000);
		tr.push(580, 4000);
		expect(tr.rate(4000)).toBe(145);
	});
});
