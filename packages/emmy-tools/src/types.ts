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
