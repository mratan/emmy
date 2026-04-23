// @emmy/tools — public types (Plan 02-03 Task 1).
// Plan 06 may extend this file with MCP-related types (kept additive).

export interface HashedLine {
	hash: string;
	content: string;
	line_number: number;
}

export interface EditOp {
	hash: string;
	new_content: string | null;
}

export interface InsertOp {
	after_hash: string;
	insert: string[];
}

export interface EditRequest {
	path: string;
	edits?: EditOp[];
	inserts?: InsertOp[];
	hashesFromLastRead?: HashedLine[]; // advisory only — edit always re-reads
}

export interface EditResult {
	path: string;
	applied: { edits: number; inserts: number };
	diff: string;
	before_hash_file: string;
	after_hash_file: string;
}

// --- Plan 02-06 types (MCP bridge + native tools) ---
export interface McpServerSpec {
	command: string;
	args: string[];
	env?: Record<string, string>;
	alias?: string;
}

export interface McpServersConfig {
	servers: Record<string, McpServerSpec>;
}

export interface PiToolSpec {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	invoke: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface NativeToolOpts {
	cwd: string;
	profileRef: { id: string; version: string; hash: string };
	bashDenylist?: string[];
	/**
	 * Plan 03-06 (UX-03 / D-27): per-profile web_fetch allowlist. Hostname-exact
	 * (no DNS resolution, no wildcards). Loopback is always permitted. When
	 * absent or empty, web_fetch runtime enforcement flips the offline badge
	 * red on first call (default-deny). Populated from
	 * profile.harness.tools.web_fetch.allowlist by session.ts at registration
	 * time.
	 */
	webFetchAllowlist?: readonly string[];
	/**
	 * Plan 03-06: callback invoked when a web_fetch call hits a non-allowlisted
	 * host. Session-level callers wire this to updateOfflineBadge so the TUI
	 * badge flips red and a violation event is logged (D-27). Optional — absent
	 * in eval drivers and unit tests that don't care about the badge.
	 */
	webFetchOnViolation?: (details: { url: string; hostname: string }) => void;
	/**
	 * Plan 03.1-02 D-35 — recent search URL bypass store. When present, URLs
	 * returned by recent web_search calls are fetchable without allowlist
	 * entry (exact URL match, NOT hostname substring — T-03.1-02-02). The
	 * store's TTL comes from profile.harness.tools.web_fetch.search_bypass_ttl_ms.
	 * session.ts wires this to getOrCreateDefaultStore(ttlMs).
	 */
	recentSearchUrls?: import("./web-fetch-allowlist").RecentSearchUrlStore;
	/**
	 * Plan 03.1-02 D-34 — when set, registerNativeTools also registers the
	 * web_search native tool. cfg pulled from profile.harness.tools.web_search;
	 * absent means the profile doesn't have the block (no tool registered).
	 */
	webSearchConfig?: import("./web-search").WebSearchConfig;
	/**
	 * Plan 03.1-02 D-34 — opt-in master switch for the web_search tool. When
	 * false OR env kill-switches engage, tool is NOT registered.
	 */
	webSearchEnabled?: boolean;
	/**
	 * Plan 03.1-02 D-36 — hook fired on every successful web_search call so
	 * session.ts can flip the badge to yellow. Optional.
	 */
	webSearchOnSuccess?: (
		results: import("./web-search").SearchResult[],
	) => void;
	/**
	 * Plan 03.1-02 — hook fired on web_search failure/fallback so session.ts
	 * can flip the badge back to green. Optional.
	 */
	webSearchOnFallback?: (reason: string) => void;
}
