// packages/emmy-ux/src/sidecar-lifecycle-client.ts
//
// Plan 04.2-04 Task 2 — Self-contained POST→SSE helpers for the sidecar
// /start and /stop endpoints. Independent of profile-swap-runner-http.ts
// (Plan 03's /profile/swap dispatcher) — no imports from it, no
// modifications to it. Enforces:
//
//   1. Plan 03's contract intact (its 11+ tests un-invalidated)
//   2. files_modified non-overlap across the wave-2 plans (no cross-plan
//      merge conflict)
//   3. Single-responsibility: profile-swap-runner-http owns /profile/swap;
//      this module owns /start + /stop
//
// Inlines the eventsource-parser SSE-consume idiom because /start and /stop
// ride the SAME C-06 LOCKED wire format the swap dispatcher consumes:
//   {phase, pct?}      → onProgress(phase, pct?)
//   {phase, details}   → onProgress(phase) (draining sidecar-only event)
//   {state, phase}     → onProgress(phase) (idempotent short-circuit)
//   {rolled_back, ...} → result.envelope captured (start path; rare for stop)
//   {exit: N}          → result.exit captured (final frame)
//
// T-04.2-S5 mitigation: connect-refuse / unreachable sidecar / HTTP 5xx all
// return {exit: 1} — NEVER silently falls back to local execution.
//
// Returns SwapResult shape for /start (rollback envelope possible if a
// cross-variant cold-start triggers internal swap orchestrator + exit 6);
// /stop returns the simpler {exit: number} since rollback only applies to
// the swap path.

import { createParser } from "eventsource-parser";
import type { SwapResult } from "./profile-swap-runner";

/**
 * DI-friendly fetch signature for SSE consumption. Mirrors profile-swap-runner-http's
 * FetchSseImpl pattern for testability without a real sidecar.
 */
export type FetchSseImpl = (
	url: string,
	init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

interface _SseHelperArgs {
	url: string;
	body: unknown;
	onProgress: (phase: string, pct?: number) => void;
	fetchSseImpl?: FetchSseImpl;
}

interface _SseHelperResult {
	exit: number;
	envelope?: SwapResult["envelope"];
}

/**
 * Shared SSE-consume helper. POSTs `body` (JSON-serialized) to `url`,
 * consumes the SSE stream via eventsource-parser v3, dispatches frames by
 * shape, and returns the captured exit code + optional envelope.
 *
 * Hard-fails (returns {exit: 1}, no envelope, no callbacks fired):
 *   - fetch throws (ECONNREFUSED, DNS fail, abort)
 *   - HTTP non-2xx
 *   - missing response.body
 */
async function _streamSseHelper(args: _SseHelperArgs): Promise<_SseHelperResult> {
	const fetchSse: FetchSseImpl =
		args.fetchSseImpl ?? ((url, init) => fetch(url, init));
	const ctl = new AbortController();

	let resp: Response;
	try {
		resp = await fetchSse(args.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify(args.body),
			signal: ctl.signal,
		});
	} catch {
		// Connect failure (ECONNREFUSED, DNS, abort). T-04.2-S5: fail fast,
		// never silently fall back to local execution.
		return { exit: 1 };
	}

	if (!resp.ok || !resp.body) {
		// Phase 04.2 follow-up — surface the sidecar's HTTP error body so the
		// slash command can render an actionable message instead of bare
		// "exit 1". Common cases:
		//   400 — variant required (WARNING #10), path-traversal rejected
		//   409 — state guard rejection (e.g. "start requires state in (...)")
		// FastAPI emits {detail: "<msg>"} for HTTPException; pull that out
		// when present, fall back to the raw text for non-FastAPI bodies.
		try {
			const body = await resp.text();
			let detail = body;
			try {
				const parsed = JSON.parse(body) as { detail?: unknown };
				if (typeof parsed.detail === "string") detail = parsed.detail;
			} catch {
				// not JSON — keep raw
			}
			args.onProgress(`error: HTTP ${resp.status}: ${detail.slice(0, 200)}`);
		} catch {
			args.onProgress(`error: HTTP ${resp.status}`);
		}
		return { exit: 1 };
	}

	let envelope: SwapResult["envelope"];
	// Phase 04.2 follow-up — default exit=1 (fail-loud). Without this, an SSE
	// stream that ends WITHOUT an explicit {exit:N} frame (e.g. controller-side
	// exception emits only a {phase:"error"} frame and closes) would be
	// misreported as success (exit=0). Now: only an explicit {exit:0} frame
	// from the controller is treated as success; everything else is failure.
	// Pairs with controller.py emitting {exit:0} on idempotent short-circuit
	// and {exit:1} on handler exceptions so the contract is symmetric.
	let exitCode = 1;
	let sawExitFrame = false;

	// eventsource-parser v3 API: createParser({ onEvent: fn }).
	const parser = createParser({
		onEvent: (event) => {
			try {
				const rec = JSON.parse(event.data) as {
					phase?: unknown;
					pct?: unknown;
					rolled_back?: unknown;
					rollback_succeeded?: unknown;
					exit?: unknown;
					state?: unknown;
					details?: unknown;
				};
				if (typeof rec.phase === "string") {
					const pct =
						typeof rec.pct === "number" ? rec.pct : undefined;
					args.onProgress(rec.phase, pct);
					// Phase 04.2 follow-up — surface the controller's
					// {phase:"error", details:{msg}} frame as a progress callback
					// AND lock exitCode at non-zero so a follow-up exit frame
					// (or its absence) can't accidentally promote to success.
					if (rec.phase === "error") {
						const msg =
							rec.details && typeof rec.details === "object"
								? (rec.details as { msg?: unknown }).msg
								: undefined;
						if (typeof msg === "string") {
							args.onProgress(`error: ${msg}`);
						}
						// Stays exitCode=1; if a real {exit:N} follows, that wins.
					}
					return;
				}
				if ("rolled_back" in rec) {
					envelope = {
						rolled_back:
							typeof rec.rolled_back === "boolean"
								? rec.rolled_back
								: undefined,
						rollback_succeeded:
							typeof rec.rollback_succeeded === "boolean"
								? rec.rollback_succeeded
								: undefined,
					};
					return;
				}
				if (typeof rec.exit === "number") {
					exitCode = rec.exit;
					sawExitFrame = true;
					return;
				}
			} catch {
				// Malformed JSON / non-JSON frame — silently ignore (S-3 discipline).
			}
		},
	});

	const decoder = new TextDecoder();
	try {
		for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
			parser.feed(decoder.decode(chunk, { stream: true }));
		}
	} catch {
		// Mid-stream abort — return what we have. exitCode stays at its
		// default (1) unless an exit frame was already received, so partial
		// streams fail closed.
	}

	// Phase 04.2 follow-up — if the stream completed cleanly but never emitted
	// an exit frame, surface that as a separate progress signal so the operator
	// can tell "controller is broken" from "controller said exit:N".
	if (!sawExitFrame) {
		args.onProgress("warning: no exit frame from sidecar (treating as failure)");
	}

	return { exit: exitCode, envelope };
}

/**
 * POST `${baseUrl}/start` with `{profile_id, variant?}` body and stream the
 * SSE response to `args.onProgress`. Resolves with the same `SwapResult`
 * shape the spawn-based runner returns — the slash command handler can
 * consume it interchangeably with `runSwap`'s output.
 */
export async function runSidecarStartHttp(args: {
	baseUrl: string;
	profile_id: string;
	variant?: string;
	onProgress: (phase: string, pct?: number) => void;
	fetchSseImpl?: FetchSseImpl;
}): Promise<SwapResult> {
	const { exit, envelope } = await _streamSseHelper({
		url: `${args.baseUrl.replace(/\/$/, "")}/start`,
		body: { profile_id: args.profile_id, variant: args.variant },
		onProgress: args.onProgress,
		fetchSseImpl: args.fetchSseImpl,
	});
	return { exit, envelope };
}

/**
 * POST `${baseUrl}/stop` with `{}` body and stream the SSE response to
 * `args.onProgress`. The sidecar emits `draining` frames during the D-01
 * grace period followed by a final `{exit: 0}` once vLLM exits cleanly
 * (or `{exit: N}` on SIGKILL escalation).
 */
export async function runSidecarStopHttp(args: {
	baseUrl: string;
	onProgress: (phase: string, pct?: number) => void;
	fetchSseImpl?: FetchSseImpl;
}): Promise<{ exit: number }> {
	const { exit } = await _streamSseHelper({
		url: `${args.baseUrl.replace(/\/$/, "")}/stop`,
		body: {},
		onProgress: args.onProgress,
		fetchSseImpl: args.fetchSseImpl,
	});
	return { exit };
}
