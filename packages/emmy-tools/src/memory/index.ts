// packages/emmy-tools/src/memory/index.ts
//
// Plan 04.4-01 Task 3 — memoryTool ToolDefinition shell + dispatch surface.
// Plan 04.4-02 fills in the six command bodies (currently throw memory.not_implemented).
//
// Architecture: every command flows through resolveMemoryPath() FIRST. This
// guarantees the V4 traversal block runs before any command body sees an
// abspath. Plan 02 wires individual command files; until then the dispatch
// returns memory.not_implemented so plan 01 ships green.
//
// v1 description (~45 tokens) is calibration-protocol-locked
// per CONTEXT.md §decisions: only expand AFTER V1–V3 verification shows
// adoption < 60% OR rot protection < 100%.

import {
	MemoryToolInput,
	type MemoryConfig,
	MemoryError,
	DEFAULT_MEMORY_CONFIG,
	type MemoryOpEvent,
	type MemoryToolErrorResult,
} from "./types";
import { resolveMemoryPath } from "./path-resolver";

/**
 * v1 model-facing description (~45 tokens; CONTEXT.md §decisions LOCKED).
 * Calibration protocol: do NOT pre-emptively bloat. Expand only after
 * V1–V3 verification (Phase 04.4-09 closeout) shows adoption < 60% OR
 * rot protection < 100%.
 */
export const MEMORY_TOOL_DESCRIPTION =
	"memory — read and write notes that persist across sessions. Two scopes: " +
	"/memories/project/... for repo-specific knowledge, /memories/global/... " +
	"for cross-project preferences. Check what's there before non-trivial " +
	"work; write notes only when a discovery would help a future session.";

export interface MemoryToolOpts {
	config: MemoryConfig;
	cwd?: string;
	/** Plan 04.4-04 wires telemetry callbacks; plan 01 leaves the seam. */
	onOp?: (event: MemoryOpEvent) => void;
}

/**
 * Pi-mono `defineTool` cares about TypeBox parameters + name + execute.
 * We expose a shape compatible with both pi 0.68 (parameters field) and
 * the Anthropic surface (inputSchema). The session.ts wire-through passes
 * either through `customTools` or via `defineTool` adapter.
 */
export interface PiToolDefinitionShape {
	name: string;
	description: string;
	parameters: unknown;
	/** Alias of `parameters` for code paths that look for `inputSchema`. */
	inputSchema: unknown;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: ((chunk: unknown) => void) | undefined,
		ctx?: unknown,
	) => Promise<unknown>;
}

export function buildMemoryTool(opts: MemoryToolOpts): PiToolDefinitionShape {
	return {
		name: "memory",
		description: MEMORY_TOOL_DESCRIPTION,
		parameters: MemoryToolInput,
		inputSchema: MemoryToolInput,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			// We trust caller (pi's defineTool layer) ran TypeBox validation.
			const p = params as {
				command: string;
				path?: string;
				old_path?: string;
			};

			// Resolve path FIRST — every command (including rename, which uses old_path)
			// must reject hostile paths before any filesystem touch.
			const logicalPath =
				p.command === "rename" ? p.old_path ?? "" : p.path ?? "";
			const resolved = resolveMemoryPath(
				logicalPath,
				opts.config,
				opts.cwd,
			);
			if (!resolved.ok) {
				return memoryErrorToToolResult(resolved.error);
			}

			// Plan 02 wires command bodies here. Plan 01 stub:
			return memoryErrorToToolResult(
				new MemoryError(
					"memory.not_implemented",
					`command ${p.command} body lands in plan 04.4-02`,
				),
			);
		},
	};
}

/** Default-config convenience for tests + downstream wiring. */
export const memoryTool: PiToolDefinitionShape = buildMemoryTool({
	config: DEFAULT_MEMORY_CONFIG,
});

function memoryErrorToToolResult(err: MemoryError): MemoryToolErrorResult {
	return {
		isError: true,
		content: [{ type: "text", text: `Error (${err.code}): ${err.message}` }],
		code: err.code,
		details: err.details,
	};
}
