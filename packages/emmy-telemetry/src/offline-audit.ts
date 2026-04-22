// packages/emmy-telemetry/src/offline-audit.ts
//
// Plan 03-06 Task 2 (GREEN) — UX-03 offline audit pure functions.
//
// Two functions, zero I/O. Directly unit-testable with fixture tool arrays
// (plan truth #7).
//
// Design locks (PLAN must_haves.truths):
//   #1 LOOPBACK_HOSTS = {127.0.0.1, localhost, ::1, loopback} — D-26 VERBATIM.
//      The bind-all quad-zero address (INADDR_ANY) is EXCLUDED from the
//      loopback set; it is semantically bind-all and NOT a loopback alias.
//      Plan-checker WARNING fix.
//   #2 auditToolRegistry returns green iff every tool's required_hosts ⊆
//      union(LOOPBACK_HOSTS, allowlist). Short-circuits to first violation.
//   #3 auditWebFetchUrl is hostname-EXACT (no suffix matching, no DNS
//      resolution). Prevents CNAME bypass per RESEARCH Threat #6a / T-03-06-01.
//      URL parser normalizes loopback aliases (e.g. IPv6 [::1]) correctly via
//      `new URL(url).hostname`.
//   #8 Allowlist is hostname-exact — the module enforces default-deny by
//      never importing a suffix-match or wildcard helper.
//
// Threat register:
//   T-03-06-01 (CNAME bypass): mitigated — `allowlist.includes(hostname)` with
//     literal hostname from URL parser; `docs.python.org.evil.com` → hostname
//     = `docs.python.org.evil.com` (not a suffix of `docs.python.org`); blocked.
//   T-03-06-02 (URL credentials): mitigated — WHATWG URL parser extracts
//     authority correctly: `https://docs.python.org@evil.com/` → hostname
//     = `evil.com`; blocked.
//   T-03-06-03 (loopback SSRF): accepted — D-26 explicit. Operator owns
//     loopback-exposed services.

/**
 * D-26 VERBATIM. Four loopback aliases, nothing else. The bind-all quad-zero
 * (INADDR_ANY) address is explicitly EXCLUDED because it is the "bind to
 * all interfaces" convention and has distinct semantics from loopback.
 * Plan-checker WARNING guard; the test suite asserts `size === 4`.
 */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set<string>([
	"127.0.0.1",
	"localhost",
	"::1",
	"loopback",
]);

/**
 * Tool-registration metadata Emmy layers on top of pi's ToolDefinition. Each
 * registered tool declares the set of hosts it will contact during a call.
 * Pure-local tools declare `[]`; `web_fetch` declares `[]` too because its
 * URL is dynamic (runtime enforcement via auditWebFetchUrl gates actual calls).
 */
export interface EmmyToolRegistration {
	name: string;
	required_hosts: readonly string[];
}

/**
 * Result of the boot-time audit. `offline_ok: true` means all declared tool
 * hosts are permitted (loopback OR allowlisted); `offline_ok: false` surfaces
 * the FIRST violating tool+host pair (order-stable short-circuit).
 */
export interface OfflineAuditResult {
	offline_ok: boolean;
	violating_tool: string | null;
	violating_host: string | null;
}

/**
 * Boot-time audit: every tool's `required_hosts` must be in the permitted
 * set (LOOPBACK_HOSTS ∪ allowlist). Returns the first violation if any.
 *
 * Pure function — no I/O, no logging. Callers (session.ts) decide how to
 * render the result (green/red banner + badge + emitEvent).
 */
export function auditToolRegistry(
	tools: readonly EmmyToolRegistration[],
	webFetchAllowlist: readonly string[],
): OfflineAuditResult {
	const permitted = new Set<string>([...LOOPBACK_HOSTS, ...webFetchAllowlist]);
	for (const t of tools) {
		for (const h of t.required_hosts) {
			if (!permitted.has(h)) {
				return { offline_ok: false, violating_tool: t.name, violating_host: h };
			}
		}
	}
	return { offline_ok: true, violating_tool: null, violating_host: null };
}

/**
 * Runtime audit for a single web_fetch URL. Returns `true` iff the URL's
 * hostname is in LOOPBACK_HOSTS OR listed verbatim in the allowlist.
 *
 * Hostname-exact per T-03-06-01 (no suffix matching, no wildcards, no DNS).
 * Throws on malformed URLs (`new URL(...)` failure) so silent passes are
 * impossible — callers see the parse error and decide how to handle.
 */
export function auditWebFetchUrl(url: string, allowlist: readonly string[]): boolean {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		throw new Error(`invalid URL: ${url}`);
	}
	// Node WHATWG URL parser preserves brackets around IPv6 literals
	// (`http://[::1]:22/` → hostname = "[::1]"). LOOPBACK_HOSTS uses the
	// unbracketed form ("::1") per D-26 verbatim, so normalize the bracket
	// form for the loopback check. The normalization is only stripped for
	// IPv6 literals (strictly begins-with-[ + ends-with-]); any other
	// malformed bracketed input would already have failed parsing above.
	const normalized =
		hostname.startsWith("[") && hostname.endsWith("]")
			? hostname.slice(1, -1)
			: hostname;
	if (LOOPBACK_HOSTS.has(normalized)) return true;
	// Hostname-EXACT; NO suffix matching (T-03-06-01 CNAME bypass guard).
	// Use the raw (bracketed-if-IPv6) hostname for allowlist check so an
	// operator listing `[::1]` vs `::1` doesn't accidentally pass — the
	// loopback path above is the authoritative way in.
	return allowlist.includes(hostname);
}
