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
}
