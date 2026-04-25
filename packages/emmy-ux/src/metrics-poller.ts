// packages/emmy-ux/src/metrics-poller.ts
//
// Plan 03-04 Task 2 (GREEN). 1 Hz poller that reads vLLM /metrics +
// nvidia-smi, formats the result via formatFooter(), and calls
// ctx.ui.setStatus("emmy.footer", <text>).
//
// Design decisions:
//  - D-22: data sources = vLLM /metrics + nvidia-smi subprocess.
//  - D-23: 1 Hz refresh cadence.
//  - D-24: graceful degrade — `{lastGood}?` on failures 1..maxFailures
//    (default 3), blank beyond. Never aborts the session (unlike the
//    SP_OK canary which fails loud).
//  - D-25: spec-accept stays literal `-` until Phase 6.
//  - T-03-04-03 DoS: failed polls accumulate; bounded by the degrade
//    threshold — after maxFailures the field just blanks, poller keeps
//    ticking cheaply (fetch + nvidia-smi both have explicit timeouts).
//  - T-03-04-04 NaN-injection: parseMetrics + parseFloatOrUndefined both
//    skip non-finite values; formatFooter Math.round handles rounding.
//
// EMMY_TELEMETRY=off suppresses polling entirely (no interval created, no
// setStatus calls). Matches D-08 kill-switch semantics from Plan 03-02.

import { sampleNvidiaSmi, type NvidiaSample } from "./nvidia-smi";
import {
	fetchVllmMetrics,
	TokRateTracker,
	type MetricSnapshot,
} from "./vllm-metrics";
import { formatFooter, type FooterValues } from "./footer";
// Plan 04.2-04 D-09 — remote-mode branch reads sidecar /status instead of
// vLLM /metrics + nvidia-smi. Lazy import inside tick() to keep local-mode
// import cost at zero.
import type { SidecarStatus } from "./sidecar-status-client";

export interface FooterPollerOpts {
	/** vLLM endpoint (e.g. "http://127.0.0.1:8002"). */
	baseUrl: string;
	/** Called on every tick with key="emmy.footer" and the formatted text. */
	setStatus: (key: string, text: string | undefined) => void;
	/** Poll interval in ms. Default 1000 (D-23). */
	intervalMs?: number;
	/** D-24 degrade threshold. Default 3. */
	maxFailures?: number;
	/** Footer-key override — default "emmy.footer". */
	footerKey?: string;
	/** Test hook: inject setInterval (default: global setInterval). */
	intervalImpl?: (cb: () => void | Promise<void>, ms: number) => unknown;
	/** Test hook: inject clearInterval (default: global clearInterval). */
	clearIntervalImpl?: (handle: unknown) => void;
	/** Test hook: inject vLLM metrics fetcher (default: fetchVllmMetrics). */
	fetchMetricsImpl?: (baseUrl: string, timeoutMs: number) => Promise<MetricSnapshot>;
	/** Test hook: inject nvidia-smi sampler (default: sampleNvidiaSmi). */
	sampleNvidiaSmiImpl?: () => NvidiaSample | null;
	/**
	 * Plan 04.2-04 D-09 test hook — inject sidecar /status fetcher (default:
	 * lazy-imported getSidecarStatus from ./sidecar-status-client). Used by
	 * the EMMY_REMOTE_CLIENT='1' branch only; local-mode ticks never invoke
	 * this hook.
	 */
	getStatusImpl?: (baseUrl: string, timeoutMs: number) => Promise<SidecarStatus>;
}

export interface FooterPollerHandle {
	stop: () => void;
}

interface FieldState {
	lastValue: number | undefined;
	failCount: number;
}

/**
 * Start the footer poller. Returns a handle with a `stop()` method that
 * clears the interval.
 *
 * If `EMMY_TELEMETRY=off` at call time, returns a no-op handle and does
 * NOT install the interval (D-08 kill-switch).
 */
export function startFooterPoller(opts: FooterPollerOpts): FooterPollerHandle {
	// Kill-switch: match Plan 03-02's resolveTelemetryEnabled shape (env check
	// only — per-invocation opt-out is handled by the CLI before we're called).
	if (process.env.EMMY_TELEMETRY === "off") {
		return { stop: () => { /* no-op */ } };
	}

	const intervalMs = opts.intervalMs ?? 1000;
	const maxFailures = opts.maxFailures ?? 3;
	const footerKey = opts.footerKey ?? "emmy.footer";
	const setInt = opts.intervalImpl ?? ((cb, ms) => setInterval(cb, ms) as unknown);
	const clearInt = opts.clearIntervalImpl ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
	const fetchMetrics = opts.fetchMetricsImpl ?? fetchVllmMetrics;
	const sampleSmi = opts.sampleNvidiaSmiImpl ?? sampleNvidiaSmi;
	// Plan 04.2-04 D-09 — sidecar /status fetcher resolver. Lazy import so
	// local-mode (the daily-driver) pays zero import cost. Bun's module cache
	// makes subsequent remote calls O(1).
	const getStatus =
		opts.getStatusImpl ??
		(async (b: string, t: number): Promise<SidecarStatus> => {
			const { getSidecarStatus } = await import("./sidecar-status-client");
			return getSidecarStatus(b, t);
		});

	const tokTracker = new TokRateTracker();
	const fields: Record<"gpu" | "kv" | "tok", FieldState> = {
		gpu: { lastValue: undefined, failCount: 0 },
		kv: { lastValue: undefined, failCount: 0 },
		tok: { lastValue: undefined, failCount: 0 },
	};

	function applyDegrade(field: FieldState, values: Record<string, unknown>, valueKey: string, degradeKey: string): void {
		// D-24: degrade marker when failCount <= maxFailures AND we have a
		// last-good value; blank when failCount > maxFailures.
		if (field.failCount <= maxFailures && field.lastValue !== undefined) {
			values[valueKey] = field.lastValue;
			values[degradeKey] = true;
		} else {
			values[valueKey] = undefined;
			values[degradeKey] = false;
		}
	}

	const tick = async (): Promise<void> => {
		const values: FooterValues = { specAccept: "-" };

		// Plan 04.2-04 D-09 LOCKED — remote-mode branch.
		// EMMY_REMOTE_CLIENT='1': single GET /status replaces vllm /metrics +
		// nvidia-smi. ANY other value (unset, '0', 'true', etc.) falls through
		// to the existing local-path body UNCHANGED below.
		// T-04.2-S5 mitigation: when getStatus throws, all 3 fields degrade
		// to `--`; we MUST NOT silently fall back to local nvidia-smi (which
		// would fail on a Mac with no NVIDIA tools). The early `return` at
		// the end of this branch ensures the local body never executes in
		// remote mode. D-04 BYTE-STABLE: local body unchanged below the
		// marker comment.
		if (process.env.EMMY_REMOTE_CLIENT === "1") {
			const sidecarUrl =
				process.env.EMMY_SERVE_URL ?? "http://127.0.0.1:8003";
			const statusTimeoutMs = Math.max(500, Math.floor(intervalMs / 2));
			let status: SidecarStatus | null = null;
			try {
				status = await getStatus(sidecarUrl, statusTimeoutMs);
			} catch {
				status = null;
			}
			if (
				status !== null &&
				status.kv_used_pct !== null &&
				Number.isFinite(status.kv_used_pct)
			) {
				values.kvPct = status.kv_used_pct * 100;
				fields.kv.lastValue = values.kvPct;
				fields.kv.failCount = 0;
			} else {
				fields.kv.failCount++;
				applyDegrade(
					fields.kv,
					values as Record<string, unknown>,
					"kvPct",
					"kvDegraded",
				);
			}
			// gpu_temp_c is temperature, not utilization — not directly mappable
			// to the existing gpuPct field. For v1 remote mode we leave gpuPct
			// undefined → renders as `--%` via the existing degrade pipeline.
			// tokPerS likewise unset (no tok-rate source in /status v1; revisit
			// when sidecar exposes a derived rate).
			fields.gpu.failCount++;
			applyDegrade(
				fields.gpu,
				values as Record<string, unknown>,
				"gpuPct",
				"gpuDegraded",
			);
			fields.tok.failCount++;
			applyDegrade(
				fields.tok,
				values as Record<string, unknown>,
				"tokPerS",
				"tokDegraded",
			);
			opts.setStatus(footerKey, formatFooter(values));
			return;
		}

		// ===== EXISTING LOCAL PATH (UNCHANGED below this line — D-04 BYTE-STABLE) =====
		// --- vLLM /metrics ---
		let snap: MetricSnapshot | null = null;
		try {
			snap = await fetchMetrics(opts.baseUrl, Math.max(500, Math.floor(intervalMs / 2)));
		} catch {
			snap = null;
		}

		if (snap) {
			const kvPerc = snap["vllm:gpu_cache_usage_perc"];
			if (kvPerc !== undefined && Number.isFinite(kvPerc)) {
				values.kvPct = kvPerc * 100;
				fields.kv.lastValue = values.kvPct;
				fields.kv.failCount = 0;
			} else {
				fields.kv.failCount++;
				applyDegrade(fields.kv, values as Record<string, unknown>, "kvPct", "kvDegraded");
			}

			const totalTokens = snap["vllm:generation_tokens_total"];
			if (totalTokens !== undefined && Number.isFinite(totalTokens)) {
				tokTracker.push(totalTokens);
				const rate = tokTracker.rate();
				// Only count as a real "success" if we have >=2 samples in the window;
				// warm-up (single sample) returns 0 but shouldn't reset failCount.
				if (tokTracker.samplesInWindow() >= 2) {
					values.tokPerS = rate;
					fields.tok.lastValue = rate;
					fields.tok.failCount = 0;
				} else {
					// Warmup: no rate yet, but the metric IS available — don't bump failCount.
					// Keep lastValue/failCount untouched; render as `--` or last-good if any.
					applyDegrade(fields.tok, values as Record<string, unknown>, "tokPerS", "tokDegraded");
				}
			} else {
				fields.tok.failCount++;
				applyDegrade(fields.tok, values as Record<string, unknown>, "tokPerS", "tokDegraded");
			}
		} else {
			// Whole fetch failed — bump both fields.
			fields.kv.failCount++;
			applyDegrade(fields.kv, values as Record<string, unknown>, "kvPct", "kvDegraded");
			fields.tok.failCount++;
			applyDegrade(fields.tok, values as Record<string, unknown>, "tokPerS", "tokDegraded");
		}

		// --- nvidia-smi ---
		let smi: NvidiaSample | null = null;
		try {
			smi = sampleSmi();
		} catch {
			smi = null;
		}

		if (smi && smi.gpu_util_pct !== undefined && Number.isFinite(smi.gpu_util_pct)) {
			values.gpuPct = smi.gpu_util_pct;
			fields.gpu.lastValue = smi.gpu_util_pct;
			fields.gpu.failCount = 0;
		} else {
			fields.gpu.failCount++;
			applyDegrade(fields.gpu, values as Record<string, unknown>, "gpuPct", "gpuDegraded");
		}

		opts.setStatus(footerKey, formatFooter(values));
	};

	const handle = setInt(tick, intervalMs);
	// Prime immediately so the footer doesn't show "--" for a full interval.
	// Unhandled rejection is swallowed: the function's catch blocks already
	// turn fetch + nvidia-smi failures into degrade state.
	void tick().catch(() => { /* swallowed — next tick will update */ });

	return {
		stop: () => {
			clearInt(handle);
		},
	};
}

/**
 * Backward-compat alias. Plan 03-04 frontmatter lists
 * `{startFooterPoller, stopFooterPoller}`; the latter is spelled as
 * `handle.stop()` on the returned object, but we also export a function
 * form so call sites that want an explicit stop symbol can use it.
 */
export function stopFooterPoller(handle: FooterPollerHandle): void {
	handle.stop();
}
