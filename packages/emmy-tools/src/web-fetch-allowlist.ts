// packages/emmy-tools/src/web-fetch-allowlist.ts
//
// Plan 03-06 Task 2 (GREEN) — web_fetch runtime enforcement hook (D-27).
//
// Tiny function + named error. The hook checks `url` against the allowlist
// via @emmy/telemetry's auditWebFetchUrl (hostname-exact, loopback-permits)
// and, on miss:
//   1. Fires emitEvent("tool.web_fetch.violation", ...) into the dual sink.
//   2. Invokes the optional onViolation callback (session.ts wires this to
//      updateOfflineBadge → red badge flip per D-27).
//   3. Throws WebFetchAllowlistError — the caller (web_fetch wrapper) maps
//      it to a ToolError-shaped return value so pi's agent loop CONTINUES
//      (D-28 warn-and-continue; session does NOT terminate on allowlist miss).
//
// Shape parallels mcp-poison-check.assertNoPoison: pure classifier + named
// error (03-PATTERNS role-match analog).

import { auditWebFetchUrl, emitEvent } from "@emmy/telemetry";

export class WebFetchAllowlistError extends Error {
	constructor(
		public readonly url: string,
		public readonly hostname: string,
	) {
		super(
			`web_fetch blocked: host '${hostname}' not in allowlist (URL: ${url}) — add '${hostname}' to profile.harness.tools.web_fetch.allowlist to permit`,
		);
		this.name = "WebFetchAllowlistError";
	}
}

export interface EnforcementContext {
	/** Hostname-exact allowlist. Empty → default-deny (web_fetch itself flips red). */
	allowlist: readonly string[];
	/** Profile ref stamped onto the violation event for provenance. */
	profileRef: { id: string; version: string; hash: string };
	/** Optional callback fired when a violation is detected (session.ts wires
	 *  this to updateOfflineBadge for the red flip per D-27). */
	onViolation?: (details: { url: string; hostname: string }) => void;
}

/**
 * Enforce the web_fetch allowlist at call time. No-op on pass; throws
 * WebFetchAllowlistError on miss AFTER firing the violation event + callback.
 *
 * Callers (web_fetch wrapper) catch the error and convert it to a
 * ToolError-shaped return object so pi's agent loop surfaces the error text
 * without aborting the session (D-28 warn-and-continue).
 */
export function enforceWebFetchAllowlist(url: string, ctx: EnforcementContext): void {
	if (auditWebFetchUrl(url, ctx.allowlist)) return;
	// auditWebFetchUrl already parsed the URL (it would have thrown on
	// malformed input); re-parse here for the authoritative hostname used
	// in the event + error message. Parse failure would have been surfaced
	// by auditWebFetchUrl; this branch never reaches a try/catch.
	const hostname = new URL(url).hostname;
	emitEvent({
		event: "tool.web_fetch.violation",
		ts: new Date().toISOString(),
		profile: ctx.profileRef,
		url,
		hostname,
	});
	if (ctx.onViolation) {
		try {
			ctx.onViolation({ url, hostname });
		} catch {
			// Never let the UX callback mask the original violation; the
			// error thrown below is the authoritative signal to the caller.
		}
	}
	throw new WebFetchAllowlistError(url, hostname);
}
