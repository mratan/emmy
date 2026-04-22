// packages/emmy-ux/src/vllm-metrics.ts
//
// Plan 03-04 Task 2 (GREEN). Minimal Prometheus-text parser + HTTP GET
// wrapper + sliding-window token-rate tracker for the vLLM /metrics endpoint.
//
// RESEARCH-verified (2026-04-21 §Summary #3):
//   - KV cache metric is `vllm:gpu_cache_usage_perc` (Gauge, 0-1).
//     CONTEXT D-22 transcribed the wrong name — `vllm:kv[ELIDED]cache_usage_perc`
//     does NOT exist; planner must honor the verified name.
//   - Decode throughput comes from `vllm:generation_tokens_total` (Counter).
//     A 5-sample sliding window over this Counter gives a smooth tok/s
//     signal (Pitfall #6 — raw 1s delta is noisy because completions
//     bunch at request boundaries).
//
// "Don't hand-roll" guidance from RESEARCH §STACK: a simple regex-based
// parser is sufficient for this endpoint — we only consume 2-3 metrics,
// and the Prometheus text format is trivial. Pulling in `prom-client`
// just to parse would add a dependency for zero benefit.

export interface MetricSample {
	ts: number;   // milliseconds since epoch (or relative; monotonic is fine)
	tokens: number;
}

export interface MetricSnapshot {
	[name: string]: number;
}

// A Prometheus metric line has the shape:
//   name                     42.0
//   name{label="v",...}      42.0
//   name{labels} 42 <exemplar>
// Comments start with # and are ignored. We capture: metric name (no labels
// in the captured group) + value.
//
// The name pattern matches Prometheus naming rules: [a-zA-Z_:][a-zA-Z0-9_:]*
// with optional label brace block.
const METRIC_LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(\S+)(?:\s.*)?$/;

/**
 * Parse a Prometheus text-format body into a flat `{metric_name: value}` map.
 *
 * - Ignores lines starting with `#` (HELP / TYPE / exemplar annotations).
 * - Ignores empty lines.
 * - Skips lines whose value is not a finite number (e.g. `NaN`, `Inf`, `+Inf`).
 * - For duplicate metric names (different labels), LAST one wins. This is
 *   acceptable for our use case because vLLM emits one labeled series per
 *   model_name and we have a single model loaded.
 */
export function parseMetrics(text: string): MetricSnapshot {
	const out: MetricSnapshot = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.startsWith("#")) continue;
		const m = METRIC_LINE.exec(trimmed);
		if (!m) continue;
		const name = m[1];
		const rawValue = m[2];
		if (!name || !rawValue) continue;
		const v = Number(rawValue);
		if (!Number.isFinite(v)) continue;
		out[name] = v;
	}
	return out;
}

/**
 * Fetch `${baseUrl}/metrics` and parse the Prometheus-text response.
 *
 * @param baseUrl vLLM endpoint base URL (e.g. "http://127.0.0.1:8002"). A
 *                trailing slash is tolerated.
 * @param timeoutMs Abort the fetch after this many ms (default 2000).
 */
export async function fetchVllmMetrics(
	baseUrl: string,
	timeoutMs = 2000,
): Promise<MetricSnapshot> {
	const url = `${baseUrl.replace(/\/$/, "")}/metrics`;
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const resp = await fetch(url, { signal: ctl.signal });
		if (!resp.ok) throw new Error(`vllm /metrics returned status ${resp.status}`);
		const text = await resp.text();
		return parseMetrics(text);
	} finally {
		clearTimeout(t);
	}
}

/**
 * Pure-function rate calculator over a sequence of `(ts, tokens)` samples.
 *
 * rate = (lastTokens - firstTokens) / ((lastTs - firstTs) / 1000)   [tok/s]
 *
 * Returns 0 on warmup (< 2 samples) or on degenerate zero-Δt windows.
 */
export function computeTokRate(samples: MetricSample[]): number {
	if (samples.length < 2) return 0;
	const first = samples[0]!;
	const last = samples[samples.length - 1]!;
	const dtSec = (last.ts - first.ts) / 1000;
	if (dtSec <= 0) return 0;
	return (last.tokens - first.tokens) / dtSec;
}

/**
 * Stateful 5-second sliding-window rate tracker.
 *
 * Per Pitfall #6: the raw 1-second delta of `vllm:generation_tokens_total`
 * is noisy because completions bunch at request boundaries. A 5-sample
 * window smooths out the signal without introducing meaningful lag at
 * the 1 Hz TUI-footer cadence.
 *
 * Window shape: entries older than `windowMs` (default 5000) are evicted
 * on every push() and every rate() call. This gives exactly the "last 5
 * seconds of samples" semantics the plan's Pitfall #6 guard specifies.
 */
export class TokRateTracker {
	private _samples: MetricSample[] = [];
	private _windowMs: number;

	constructor(windowMs = 5000) {
		this._windowMs = windowMs;
	}

	push(tokensTotal: number, nowMs: number = Date.now()): void {
		this._samples.push({ ts: nowMs, tokens: tokensTotal });
		this._prune(nowMs);
	}

	rate(nowMs: number = Date.now()): number {
		this._prune(nowMs);
		return computeTokRate(this._samples);
	}

	samplesInWindow(): number {
		return this._samples.length;
	}

	private _prune(nowMs: number): void {
		const cutoff = nowMs - this._windowMs;
		// Keep samples whose ts is strictly within the window (ts > cutoff).
		// Strict > means a sample exactly at ts=nowMs-windowMs is dropped —
		// matches the natural "older than 5s" test expectation.
		this._samples = this._samples.filter((s) => s.ts > cutoff);
	}
}
