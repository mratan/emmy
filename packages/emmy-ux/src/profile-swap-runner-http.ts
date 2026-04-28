// packages/emmy-ux/src/profile-swap-runner-http.ts
//
// Plan 04.2-03 Task 1 — HTTP+SSE branch sibling of profile-swap-runner.ts.
// Routes a /profile swap through the FastAPI sidecar (Plan 04.2-01) at
// ${EMMY_SERVE_URL}/profile/swap, consuming the SSE stream and re-emitting
// the same (phase, pct?) callbacks the spawn-based runner does.
//
// D-04 LOCKED contract: identical SwapResult {exit, envelope?} shape,
// identical onProgress signature; downstream harness-swap.ts consumer
// untouched. Local-mode spawn path (profile-swap-runner.ts) byte-stable.
//
// C-06 LOCKED contract: SSE frames wrap Phase-4 D-02 LOCKED JSON-per-line
// records verbatim — sidecar emits, eventsource-parser parses, this module
// dispatches by record shape:
//   {phase, pct?}      → onProgress(phase, pct?)
//   {rolled_back, ...} → result.envelope captured
//   {exit: N}          → result.exit captured
//   {state, phase}     → idempotent same-variant short-circuit (state→ready)
//   {phase, details}   → sidecar-only events (draining/error) pass through
//
// T-04.2-S5 mitigation: connect-refuse / unreachable sidecar returns
// {exit: 1} — NEVER silently falls back to spawning the orchestrator
// locally on a Mac (which has no Docker/GPU/profile bundles).

import { createParser } from "eventsource-parser";
import type { SwapResult } from "./profile-swap-runner";

/**
 * Strip an absolute profile path down to the portion the sidecar can resolve
 * relative to its own filesystem. Returns the path unchanged if it doesn't
 * contain a `/profiles/` segment (already-relative paths or paths the
 * sidecar happens to share with the client).
 *
 * Examples:
 *   "/Users/me/code/emmy/profiles/gemma-4-26b-a4b-it/v2.1"
 *     → "profiles/gemma-4-26b-a4b-it/v2.1"
 *   "/data/projects/emmy/profiles/gemma-4-26b-a4b-it/v2-default"
 *     → "profiles/gemma-4-26b-a4b-it/v2-default"
 *   "profiles/gemma-4-26b-a4b-it/v2.1" (already relative)
 *     → "profiles/gemma-4-26b-a4b-it/v2.1"
 *   "" (empty — cold-start has no `from` path)
 *     → ""
 *
 * Exported for unit testing.
 */
export function _relativizeProfilePath(p: string): string {
	if (!p) return p;
	const idx = p.lastIndexOf("/profiles/");
	if (idx < 0) {
		// Already relative or non-standard layout — pass through as-is and
		// let the sidecar surface a real error.
		return p;
	}
	// Strip the leading slash too — keep "profiles/..." as the canonical
	// relative root the sidecar joins against its WorkingDirectory.
	return p.slice(idx + 1);
}

/**
 * DI-friendly fetch signature for SSE consumption. Mirrors the spawnFn
 * pattern from profile-swap-runner.ts: production callers omit it and get
 * Bun's native fetch; unit tests inject a fake that returns a Response
 * wrapping a ReadableStream of canned SSE chunks.
 */
export type FetchSseImpl = (
	url: string,
	init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;

/**
 * POST to ${EMMY_SERVE_URL}/profile/swap and stream its SSE response to
 * args.onProgress. Resolves with the same {exit, envelope?} shape the
 * spawn-based runner returns — downstream consumers (harness-swap.ts,
 * the inline progress meter) cannot tell which path produced the result.
 *
 * Default base URL is http://127.0.0.1:8003 (loopback fallback for
 * Spark-side testing without env override). EMMY_SERVE_URL overrides;
 * trailing slash is stripped to keep the joined URL canonical.
 *
 * Failure modes (all return {exit: 1}, no envelope, no callbacks fired):
 *   - fetch throws (ECONNREFUSED, DNS fail, abort signal)
 *   - HTTP non-2xx response
 *   - missing response.body
 *
 * Mid-stream abort silently truncates: returns whatever {exit, envelope}
 * was captured before the disconnect. Sidecar always emits a final
 * {exit: N} frame on clean close; if missing, exit stays 0.
 */
export async function runSwapAndStreamProgressHttp(args: {
	from: string;
	to: string;
	port: number;
	onProgress: (phase: string, pct?: number) => void;
	fetchSseImpl?: FetchSseImpl;
}): Promise<SwapResult> {
	const fetchSse: FetchSseImpl =
		args.fetchSseImpl ?? ((url, init) => fetch(url, init));
	const ctl = new AbortController();
	const baseUrl = process.env.EMMY_SERVE_URL ?? "http://127.0.0.1:8003";
	const url = `${baseUrl.replace(/\/$/, "")}/profile/swap`;

	let resp: Response;
	try {
		// Phase 04.2 follow-up — relativize profile paths before sending.
		// The local-mode dispatcher receives ABSOLUTE paths from
		// profileIndex.resolve() (e.g. "/Users/x/code/emmy/profiles/qwen.../v3.1").
		// In local mode that's fine (Mac runs the orchestrator on Mac paths).
		// In remote mode (this dispatcher), the sidecar runs on Spark and
		// CANNOT resolve "/Users/x/..." — schema validation fails with exit 5
		// "prior model still serving". Strip everything up to and including
		// the parent of "profiles/" so the sidecar resolves
		// "profiles/<name>/<variant>" against its own cwd (/data/projects/emmy
		// per the systemd unit's WorkingDirectory).
		resp = await fetchSse(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify({
				from: _relativizeProfilePath(args.from),
				to: _relativizeProfilePath(args.to),
				port: args.port,
			}),
			signal: ctl.signal,
		});
	} catch {
		// Connect failure (ECONNREFUSED, DNS, abort). T-04.2-S5: fail fast,
		// never silently fall back to local execution.
		return { exit: 1 };
	}

	if (!resp.ok || !resp.body) {
		// Phase 04.2 follow-up — surface sidecar HTTP error detail (same fix
		// applied to sidecar-lifecycle-client.ts). For /profile/swap the
		// common 409 is "swap requires state=ready, currently=<X>".
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
	// Phase 04.2 follow-up — flip default to 1 (fail-loud). Pre-fix default
	// of 0 meant any SSE stream that closed without an exit frame (e.g.
	// network drop mid-stream) was reported as success. Now: only an explicit
	// {exit:0} frame from the controller promotes to success.
	let exitCode = 1;

	// eventsource-parser v3 API: createParser({ onEvent: fn }) — the v2
	// callback-as-positional-arg form was removed.
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
				};
				// {phase, pct?} → onProgress
				if (typeof rec.phase === "string") {
					const pct =
						typeof rec.pct === "number" ? rec.pct : undefined;
					args.onProgress(rec.phase, pct);
					return;
				}
				// {rolled_back, ...} → envelope
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
				// {exit: N} → exit code (final frame)
				if (typeof rec.exit === "number") {
					exitCode = rec.exit;
					return;
				}
				// {state, phase} idempotent short-circuit — handled above by the
				// `typeof rec.phase === "string"` branch (Plan 01 emits state+phase
				// together for the D-02 same-variant fast path).
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
		// Mid-stream abort (network drop, abort signal) — return what we have.
		// (Plan 01's controller emits final {exit:N} before close; if missing,
		// exit stays 0 from initialization. Caller decides to surface as error
		// via the missing envelope/phase indicators.)
	}

	return { exit: exitCode, envelope };
}
