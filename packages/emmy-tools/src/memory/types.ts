// packages/emmy-tools/src/memory/types.ts
//
// Plan 04.4-01: filesystem memory tool — TypeBox discriminated-union schema +
// MemoryConfig + MemoryError + MemoryResult mirror of WebFetchToolResult.
//
// MEMORY-TOOL-SPEC.md §2 lifts the six commands verbatim from Anthropic's
// memory_20250818 tool. We keep the schema literal so the model sees a
// surface it has been trained on.

import { Type, type Static } from "@sinclair/typebox";
import { ToolsError } from "../errors";

// ---- Command schemas (TypeBox discriminated union) -----------------------

const MemoryViewInput = Type.Object({
	command: Type.Literal("view"),
	path: Type.String(),
	view_range: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
});

const MemoryCreateInput = Type.Object({
	command: Type.Literal("create"),
	path: Type.String(),
	file_text: Type.String(),
});

const MemoryStrReplaceInput = Type.Object({
	command: Type.Literal("str_replace"),
	path: Type.String(),
	old_str: Type.String(),
	new_str: Type.String(),
});

const MemoryInsertInput = Type.Object({
	command: Type.Literal("insert"),
	path: Type.String(),
	insert_line: Type.Number(),
	insert_text: Type.String(),
});

const MemoryDeleteInput = Type.Object({
	command: Type.Literal("delete"),
	path: Type.String(),
});

const MemoryRenameInput = Type.Object({
	command: Type.Literal("rename"),
	old_path: Type.String(),
	new_path: Type.String(),
});

export const MemoryToolInput = Type.Union([
	MemoryViewInput,
	MemoryCreateInput,
	MemoryStrReplaceInput,
	MemoryInsertInput,
	MemoryDeleteInput,
	MemoryRenameInput,
]);

export type MemoryToolInputT = Static<typeof MemoryToolInput>;

// ---- MemoryConfig — mirrors harness.yaml memory.* (§3.2) -----------------

export interface MemoryConfig {
	/** Master kill switch. False ⇒ tool description omitted, all ops return memory.disabled. */
	enabled: boolean;
	/** Project-scope physical root (cwd-relative or absolute). null disables /memories/project/... */
	project_root: string | null;
	/** Global-scope physical root (~ expanded). null disables /memories/global/... */
	global_root: string | null;
	/** Whether the model auto-views /memories at session start. */
	read_at_session_start: boolean;
	/** Per-file write cap (bytes). MEMORY-TOOL-SPEC.md §3.2 default 65536. */
	max_file_bytes: number;
	/** Per-scope total cap (bytes). MEMORY-TOOL-SPEC.md §3.2 default 10 MiB. */
	max_total_bytes: number;
	/** Belt-and-braces: refuse writes to paths ending in these extensions. */
	blocked_extensions: string[];
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
	enabled: true,
	project_root: ".emmy/notes",
	global_root: "~/.emmy/memory",
	read_at_session_start: true,
	max_file_bytes: 65536,
	max_total_bytes: 10_485_760,
	blocked_extensions: [".env", ".key", ".pem"],
};

// ---- MemoryError — typed result codes per MEMORY-TOOL-SPEC.md §5 ---------
//
// `code` field carries one of the dotted names below. `MemoryError` itself
// extends `ToolsError` (the package convention) so the existing tool error
// renderer + telemetry redactor can handle it uniformly.

export type MemoryErrorCode =
	| "memory.exists"
	| "memory.not_found"
	| "memory.quota_exceeded"
	| "memory.traversal_blocked"
	| "memory.ambiguous_match"
	| "memory.disabled"
	| "memory.blocked_extension"
	| "memory.dir_not_empty"
	| "memory.is_directory"
	| "memory.not_implemented"
	| "memory.invalid_input";

export class MemoryError extends ToolsError {
	constructor(
		public readonly code: MemoryErrorCode,
		message: string,
		public readonly details?: Record<string, unknown>,
	) {
		// ToolsError prepends "tools." to the field, so we strip the leading
		// "memory." here and let the field re-add it via "memory.<rest>".
		const field = code.startsWith("memory.")
			? code.slice("memory.".length)
			: code;
		super(`memory.${field}`, message);
		this.name = "MemoryError";
	}
}

// ---- MemoryResult — mirrors WebFetchToolResult shape so pi tool wiring matches

export interface MemoryToolErrorResult {
	isError: true;
	content: Array<{ type: "text"; text: string }>;
	code: string;
	details?: Record<string, unknown>;
}

export interface MemoryToolOkResult {
	isError?: false;
	command: string;
	scope: "project" | "global" | "virtual";
	path: string;
	bytes?: number;
	result: "ok";
	payload: unknown;
	content: Array<{ type: "text"; text: string }>;
}

export type MemoryResult = MemoryToolErrorResult | MemoryToolOkResult;

// ---- MemoryOpEvent — telemetry shape (Plan 04.4-04 consumes it) ----------
//
// Defined here to keep the contract stable across plan boundaries; plan 04
// wires the actual OTel emit path.

export type MemoryOpResult =
	| "ok"
	| "exists"
	| "not_found"
	| "quota_exceeded"
	| "traversal_blocked"
	| "ambiguous_match"
	| "disabled"
	| "blocked_extension"
	| "dir_not_empty"
	| "is_directory";

export interface MemoryOpEvent {
	command: string;
	scope: "project" | "global" | "virtual";
	path: string;
	bytes?: number;
	result: MemoryOpResult;
}
