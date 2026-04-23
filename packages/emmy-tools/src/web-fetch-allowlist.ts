// packages/emmy-tools/src/web-fetch-allowlist.ts
//
// Plan 03-06 Task 2 (GREEN) — web_fetch runtime enforcement hook (D-27).
// Plan 03.1-02 Task 2 (GREEN) — returned-URL bypass (D-35).
//
// Runtime semantics summary:
//   1. If the URL is EXACTLY in the recent-search-URL store (bypass), allow.
//   2. Else, defer to auditWebFetchUrl (loopback OR hostname-exact allowlist).
//   3. Else, emit tool.web_fetch.violation + call onViolation + throw
//      WebFetchAllowlistError (the caller maps to a ToolError-shaped return
//      so pi's agent loop continues per D-28).
//
// D-35 bypass semantics:
//   - EXACT URL match, NOT hostname-substring (T-03.1-02-02 SSRF guard).
//   - Store is populated ONLY by the web_search module's success path
//     (recordSearchUrl is the write API). An agent can't synthesize a bypass
//     entry by crafting a URL — it must have gone through SearxNG first.
//   - TTL'd via prune(nowMs); store.has() self-prunes before checking.
//   - Default in-memory store lazy-initialized on first recordSearchUrl call
//     OR getOrCreateDefaultStore call. Test-only __resetSearchStoreForTests
//     resets it between tests.

import { auditWebFetchUrl, emitEvent } from "@emmy/telemetry";

export class WebFetchAllowlistError extends Error {
	constructor(
		public readonly url: string,
		public readonly hostname: string,
	) {
		super(
			`web_fetch blocked: host '${hostname}' not in allowlist (URL: ${url}) — add '${hostname}' to profile.harness.tools.web_fetch.allowlist to permit, or use web_search first so the URL enters the recent-search bypass window`,
		);
		this.name = "WebFetchAllowlistError";
	}
}

/**
 * In-memory bypass store abstraction. Callers inject a store via
 * EnforcementContext.recentSearchUrls. The module also hosts a default
 * singleton `_defaultStore` that web-search.ts writes into via
 * recordSearchUrl; session.ts reads it into the EnforcementContext.
 */
export interface RecentSearchUrlStore {
	/** Returns true iff `url` is currently within TTL. Side-effect: self-prunes. */
	has(url: string): boolean;
	/** Record `url` with current time as the recorded-at timestamp. */
	record(url: string): void;
	/** Evict entries older than (nowMs - ttlMs). Caller drives cadence; has()
	 *  calls this with Date.now() on every invocation. */
	prune(nowMs: number): void;
}

class DefaultRecentSearchUrlStore implements RecentSearchUrlStore {
	private readonly entries = new Map<string, number>(); // url → recordedAtMs
	constructor(private readonly ttlMs: number) {}
	has(url: string): boolean {
		this.prune(Date.now());
		return this.entries.has(url);
	}
	record(url: string): void {
		this.entries.set(url, Date.now());
	}
	prune(nowMs: number): void {
		for (const [u, recordedAt] of this.entries) {
			if (nowMs - recordedAt > this.ttlMs) this.entries.delete(u);
		}
	}
}

let _defaultStore: DefaultRecentSearchUrlStore | null = null;
const DEFAULT_TTL_MS = 300000; // D-35 default — 5 min

export function getOrCreateDefaultStore(ttlMs: number = DEFAULT_TTL_MS): RecentSearchUrlStore {
	if (_defaultStore === null) {
		_defaultStore = new DefaultRecentSearchUrlStore(ttlMs);
	}
	return _defaultStore;
}

/**
 * Record a URL returned by a successful web_search call. Idempotent;
 * re-records reset the TTL timestamp.
 *
 * If no default store exists yet, one is created with DEFAULT_TTL_MS. For
 * production this is fine because session.ts's enforcement context reads
 * back via getOrCreateDefaultStore with the profile-configured TTL. Tests
 * that need a custom TTL should call getOrCreateDefaultStore FIRST, then
 * recordSearchUrl.
 */
export function recordSearchUrl(url: string): void {
	const store = getOrCreateDefaultStore();
	store.record(url);
}

/** Test-only: reset the default store so inter-test state doesn't leak. */
export function __resetSearchStoreForTests(): void {
	_defaultStore = null;
}

export interface EnforcementContext {
	/** Hostname-exact allowlist. Empty → default-deny (web_fetch itself flips red). */
	allowlist: readonly string[];
	/** Profile ref stamped onto the violation event for provenance. */
	profileRef: { id: string; version: string; hash: string };
	/** Optional callback fired when a violation is detected (session.ts wires
	 *  this to updateOfflineBadge for the red flip per D-27). */
	onViolation?: (details: { url: string; hostname: string }) => void;
	/** Plan 03.1-02 D-35 — recent search URL bypass store. When present, the
	 *  EXACT URL is checked against the store BEFORE the allowlist. Populated
	 *  by web-search module's success path via recordSearchUrl. */
	recentSearchUrls?: RecentSearchUrlStore;
}

/**
 * Enforce the web_fetch allowlist at call time.
 *
 * Order of checks (D-35 + Plan 03-06 combined):
 *   1. If `recentSearchUrls` store contains the exact URL → allow (bypass).
 *   2. Else if loopback or hostname in allowlist → allow.
 *   3. Else → emit violation + fire onViolation + throw.
 *
 * No-op on pass; throws WebFetchAllowlistError on miss.
 */
export function enforceWebFetchAllowlist(url: string, ctx: EnforcementContext): void {
	// D-35 bypass FIRST — cheaper + wins over allowlist when present.
	if (ctx.recentSearchUrls?.has(url)) return;

	// Plan 03-06 unchanged path.
	if (auditWebFetchUrl(url, ctx.allowlist)) return;

	// auditWebFetchUrl already parsed the URL (it would have thrown on
	// malformed input); re-parse here for the authoritative hostname used
	// in the event + error message.
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
