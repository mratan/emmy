// packages/emmy-ux/src/sidecar-status-client.ts
//
// Plan 04.2-04 Task 1 — Pure GET /status fetch wrapper. Counterpart to
// vllm-metrics.ts (which fetches Prometheus format from vLLM directly);
// this fetches JSON from the sidecar's /status endpoint.
//
// Used by:
//   1. metrics-poller.ts remote branch (D-09) — replaces direct nvidia-smi +
//      vLLM /metrics calls when EMMY_REMOTE_CLIENT=1
//   2. /status slash command (this plan) — read-only display
//
// SidecarStatus interface mirrors emmy_serve.swap.controller.StatusResponse
// (Pydantic model from Plan 04.2-01) byte-identically. Field names MUST
// match — Plan 01's controller.py is the source of truth.
//
// Pattern source: vllm-metrics.ts:fetchVllmMetrics — same trailing-slash
// strip + AbortController + setTimeout + clearTimeout-in-finally idiom,
// just JSON instead of Prometheus text.

export interface SidecarStatus {
	state:
		| "stopped"
		| "starting"
		| "ready"
		| "swapping"
		| "draining"
		| "error";
	profile_id: string | null;
	profile_variant: string | null;
	profile_hash: string | null;
	vllm_up: boolean;
	vllm_pid: number | null;
	container_digest: string | null;
	/** Fraction 0..1 (NOT percentage). Multiply by 100 before displaying. */
	kv_used_pct: number | null;
	gpu_temp_c: number | null;
	in_flight: number | null;
	last_error: { ts: string; msg: string } | null;
}

/**
 * Fetch `${baseUrl}/status` from the emmy-sidecar and parse as `SidecarStatus`.
 *
 * @param baseUrl   Sidecar base URL (e.g. "http://127.0.0.1:8003" or
 *                  "https://spark.tailnet.ts.net:8003"). Trailing slash is
 *                  tolerated and stripped.
 * @param timeoutMs Abort the fetch after this many ms (default 2000).
 *
 * Throws `Error("sidecar /status returned status N")` on non-2xx responses.
 * Throws AbortError-flavored Error on timeout (lets the caller drive degrade
 * logic in metrics-poller's remote branch).
 */
export async function getSidecarStatus(
	baseUrl: string,
	timeoutMs = 2000,
): Promise<SidecarStatus> {
	const url = `${baseUrl.replace(/\/$/, "")}/status`;
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const resp = await fetch(url, { signal: ctl.signal });
		if (!resp.ok) {
			throw new Error(`sidecar /status returned status ${resp.status}`);
		}
		return (await resp.json()) as SidecarStatus;
	} finally {
		clearTimeout(t);
	}
}
