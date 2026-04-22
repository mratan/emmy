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
}
