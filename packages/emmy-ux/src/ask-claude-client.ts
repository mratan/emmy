// packages/emmy-ux/src/ask-claude-client.ts
//
// Plan 04.6-04 Task 2 — Sidecar HTTP client for POST /ask-claude. Counterpart
// to sidecar-status-client.ts (GET /status) and sidecar-lifecycle-client.ts
// (POST→SSE for /start /stop). The /ask-claude endpoint is sync POST→JSON
// (no SSE) per Plan 04.6-01's contract — Claude can take 30s+ for hard
// questions but the response shape itself is single-shot.
//
// D-14 LOCKED: identical UX between pi-emmy (Spark loopback) and emmy (Mac
// tailnet). The slash command and tool-form callers both take a baseUrl
// resolved via EMMY_SERVE_URL precedence at the wire-up site (pi-emmy-extension)
// and pass it down to this module — this module never reads process.env
// itself, mirroring sidecar-status-client.ts (the GET sibling).
//
// Pattern source: sidecar-status-client.ts:getSidecarStatus — same trailing-
// slash strip + AbortController timeout idiom, just POST instead of GET and
// JSON body instead of empty-body.
//
// Error contract: throws AskClaudeError with structured fields so the slash
// command can surface specific reason → user-visible message mappings:
//
//   .reason            string — sidecar's reason code: env_disabled,
//                      claude_cli_not_found, scrubber_blocked,
//                      rate_limited_{concurrent,min_gap,hourly},
//                      subprocess_failed, timeout, or "unknown" fallback
//   .pattern_class     string | undefined — only on scrubber_blocked
//   .detail            string | undefined — extra context for subprocess errors
//                      (e.g. exit code, stderr tail)
//
// FastAPI envelope tolerance: HTTPException emits {detail: {reason, ...}} but
// a minimal handler that sets response_model directly might emit {reason, ...}
// flat. This module accepts BOTH shapes — never tied to FastAPI's specific
// envelope. The sidecar test suite (Plan 04.6-01) uses {detail: {...}} via
// HTTPException; the flat shape is tolerated for forward-compatibility.

/**
 * AskClaudeResponse — mirrors emmy_serve.swap.controller.AskClaudeResponse
 * (Pydantic model from Plan 04.6-01) byte-identically. Field names MUST
 * match — Plan 01's controller.py is the source of truth.
 */
export interface AskClaudeResponse {
	response: string;
	duration_ms: number;
	rate_limit_remaining_hour: number;
}

/**
 * AskClaudeError — Error subclass with structured fields the slash command
 * uses to render specific reason → user-message mappings. Plain Error +
 * `.reason` field rather than a class (matches the lifecycle client's
 * inline-Error idiom) keeps `instanceof Error` checks working transparently.
 */
export interface AskClaudeError extends Error {
	reason: string;
	pattern_class?: string;
	detail?: string;
}

/**
 * DI-friendly fetch signature. Production callers omit `fetchImpl` and get
 * Bun's native fetch; unit tests inject a fake that returns canned Response
 * objects. Mirrors sidecar-lifecycle-client.ts FetchSseImpl pattern, except
 * the body here is JSON (not SSE) so we don't need the eventsource-parser
 * pipeline — a single `await resp.json()` suffices.
 */
export type FetchImpl = (
	url: string,
	init: RequestInit & { signal?: AbortSignal },
) => Promise<Response>;

/**
 * POST `${baseUrl}/ask-claude` with `{prompt}` body and parse the JSON
 * response. Resolves with AskClaudeResponse on 200; throws AskClaudeError
 * on any non-2xx with the sidecar's reason code attached.
 *
 * @param args.baseUrl    Sidecar base URL (e.g. "http://127.0.0.1:8003" or
 *                        "https://spark.tailnet.ts.net:8003"). Trailing
 *                        slash is tolerated and stripped. Caller resolves
 *                        EMMY_SERVE_URL precedence; this module never reads
 *                        process.env (D-14: identical UX is a property of
 *                        the call site, not this module).
 * @param args.prompt     Free-form question for Claude. Sidecar enforces a
 *                        200K-char ceiling (Plan 04.6-01 D-08); client-side
 *                        validation is the slash command's job (rejecting
 *                        empty/whitespace-only prompts before the round-trip).
 * @param args.timeoutMs  Abort the fetch after this many ms (default 120000).
 *                        Claude can take 30s+ for hard reasoning questions;
 *                        120s is the safety ceiling. The sidecar itself
 *                        enforces a shorter timeout (D-08 default), so a
 *                        timeout here is "the sidecar plus its own subprocess
 *                        timeout plus network budget all elapsed."
 * @param args.fetchImpl  Test seam — defaults to Bun's native fetch.
 *
 * Throws AskClaudeError with `.reason`:
 *   - "env_disabled" (503): sidecar's EMMY_ASK_CLAUDE not set
 *   - "claude_cli_not_found" (503): claude binary missing on sidecar PATH
 *   - "scrubber_blocked" (400): D-06 scrubber rejected the prompt;
 *     `.pattern_class` carries the matched class
 *   - "rate_limited_concurrent" / "_min_gap" / "_hourly" (429): D-07 limits
 *   - "subprocess_failed" (500): claude exited non-zero;
 *     `.detail` may carry the exit code / stderr tail
 *   - "timeout" (504): claude subprocess exceeded the sidecar's timeout
 *   - "unknown": status code didn't match any of the above OR the response
 *     body wasn't JSON we could parse (rare; usually a network/proxy error)
 */
export async function callAskClaude(args: {
	baseUrl: string;
	prompt: string;
	timeoutMs?: number;
	fetchImpl?: FetchImpl;
}): Promise<AskClaudeResponse> {
	const fetchImpl: FetchImpl =
		args.fetchImpl ?? ((url, init) => fetch(url, init));
	const url = `${args.baseUrl.replace(/\/$/, "")}/ask-claude`;
	const ctl = new AbortController();
	const timeoutMs = args.timeoutMs ?? 120_000;
	const t = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const resp = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ prompt: args.prompt }),
			signal: ctl.signal,
		});
		if (!resp.ok) {
			// Try JSON first (FastAPI HTTPException emits {detail: {...}}).
			// Fall back to text + reason="unknown" so the slash command's
			// default branch can surface resp.statusText to the operator.
			let body: unknown = null;
			try {
				body = await resp.json();
			} catch {
				// Not JSON — leave body null; reason becomes "unknown".
			}
			const detailObj =
				body !== null &&
					typeof body === "object" &&
					"detail" in (body as Record<string, unknown>) &&
					typeof (body as { detail?: unknown }).detail === "object" &&
					(body as { detail?: unknown }).detail !== null
					? ((body as { detail: Record<string, unknown> }).detail)
					: body !== null && typeof body === "object"
						? (body as Record<string, unknown>)
						: null;
			const reason =
				detailObj !== null && typeof detailObj.reason === "string"
					? detailObj.reason
					: "unknown";
			const pattern_class =
				detailObj !== null && typeof detailObj.pattern_class === "string"
					? detailObj.pattern_class
					: undefined;
			const detail =
				detailObj !== null && typeof detailObj.detail === "string"
					? detailObj.detail
					: undefined;
			const err = new Error(
				`ask-claude HTTP ${resp.status}: ${reason}`,
			) as AskClaudeError;
			err.reason = reason;
			if (pattern_class !== undefined) err.pattern_class = pattern_class;
			if (detail !== undefined) err.detail = detail;
			throw err;
		}
		return (await resp.json()) as AskClaudeResponse;
	} finally {
		clearTimeout(t);
	}
}
