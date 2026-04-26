// packages/emmy-tools/src/memory/index.ts
//
// Plan 04.4-02 Task 3 — memoryTool dispatch wired through 6 command bodies.
//
// Architecture: every command flows through resolveMemoryPath() FIRST. This
// guarantees the V4 traversal block runs before any command body sees an
// abspath. onOp callback fires once per execute() call (success AND error
// paths) so plan 04.4-04 can wire OTel + JSONL counters.

import { homedir } from "node:os";
import { resolve as pathResolve } from "node:path";
import {
	MemoryToolInput,
	type MemoryConfig,
	MemoryError,
	DEFAULT_MEMORY_CONFIG,
	type MemoryOpEvent,
	type MemoryResult,
} from "./types";
import { resolveMemoryPath } from "./path-resolver";
import { viewCommand } from "./commands/view";
import { createCommand } from "./commands/create";
import { strReplaceCommand } from "./commands/str-replace";
import { insertCommand } from "./commands/insert";
import { deleteCommand } from "./commands/delete";
import { renameCommand } from "./commands/rename";

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
	/** Plan 04.4-04 wires telemetry callbacks; plan 02 stamps the seam. */
	onOp?: (event: MemoryOpEvent) => void;
}

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
	) => Promise<MemoryResult>;
}

function scopeRootAbs(
	scope: "project" | "global",
	config: MemoryConfig,
	cwd: string,
	home: string,
): string {
	const rel = scope === "project" ? config.project_root : config.global_root;
	if (!rel)
		throw new Error(
			"scope disabled — caller should have caught at resolveMemoryPath",
		);
	const expanded = rel.startsWith("~") ? rel.replace(/^~/, home) : rel;
	const base = scope === "project" ? cwd : home;
	return pathResolve(base, expanded);
}

export function buildMemoryTool(opts: MemoryToolOpts): PiToolDefinitionShape {
	const cwd = opts.cwd ?? process.cwd();
	const home = homedir();
	const cfg = opts.config;

	return {
		name: "memory",
		description: MEMORY_TOOL_DESCRIPTION,
		parameters: MemoryToolInput,
		inputSchema: MemoryToolInput,
		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			_ctx,
		): Promise<MemoryResult> {
			const p = params as Record<string, unknown> & { command: string };

			// 0. Master switch.
			if (!cfg.enabled) {
				const ev: MemoryOpEvent = {
					command: p.command,
					scope: "project",
					path: String(p.path ?? p.old_path ?? ""),
					result: "disabled",
				};
				opts.onOp?.(ev);
				return errResult(
					"memory.disabled",
					"memory tool disabled by config (enabled=false)",
				);
			}

			// 1. Resolve primary path.
			const logicalPath =
				p.command === "rename"
					? String(p.old_path ?? "")
					: String(p.path ?? "");
			const resolved = resolveMemoryPath(logicalPath, cfg, cwd);
			if (!resolved.ok) {
				const ev: MemoryOpEvent = {
					command: p.command,
					scope: "project",
					path: logicalPath,
					result: shortenCode(resolved.error.code),
				};
				opts.onOp?.(ev);
				return errResult(resolved.error.code, resolved.error.message);
			}

			let result: MemoryResult;
			try {
				switch (p.command) {
					case "view":
						result = await viewCommand({
							absPath: resolved.absPath,
							scope: resolved.scope,
							logicalPath,
							viewRange: p.view_range as
								| [number, number]
								| undefined,
							config: cfg,
						});
						break;
					case "create": {
						if (resolved.scope === "virtual") {
							result = errResult(
								"memory.is_directory",
								"cannot create on virtual root /memories",
							);
							break;
						}
						result = await createCommand({
							absPath: resolved.absPath,
							scope: resolved.scope,
							logicalPath,
							fileText: String(p.file_text ?? ""),
							config: cfg,
							scopeRootAbs: scopeRootAbs(
								resolved.scope,
								cfg,
								cwd,
								home,
							),
						});
						break;
					}
					case "str_replace": {
						if (resolved.scope === "virtual") {
							result = errResult(
								"memory.is_directory",
								"cannot str_replace on virtual root /memories",
							);
							break;
						}
						result = await strReplaceCommand({
							absPath: resolved.absPath,
							scope: resolved.scope,
							logicalPath,
							oldStr: String(p.old_str ?? ""),
							newStr: String(p.new_str ?? ""),
							config: cfg,
						});
						break;
					}
					case "insert": {
						if (resolved.scope === "virtual") {
							result = errResult(
								"memory.is_directory",
								"cannot insert on virtual root /memories",
							);
							break;
						}
						result = await insertCommand({
							absPath: resolved.absPath,
							scope: resolved.scope,
							logicalPath,
							insertLine: Number(p.insert_line ?? 0),
							insertText: String(p.insert_text ?? ""),
							config: cfg,
							scopeRootAbs: scopeRootAbs(
								resolved.scope,
								cfg,
								cwd,
								home,
							),
						});
						break;
					}
					case "delete": {
						if (resolved.scope === "virtual") {
							result = errResult(
								"memory.dir_not_empty",
								"cannot delete virtual root /memories",
							);
							break;
						}
						result = await deleteCommand({
							absPath: resolved.absPath,
							scope: resolved.scope,
							logicalPath,
						});
						break;
					}
					case "rename": {
						const newLogical = String(p.new_path ?? "");
						const newResolved = resolveMemoryPath(
							newLogical,
							cfg,
							cwd,
						);
						if (!newResolved.ok) {
							result = errResult(
								newResolved.error.code,
								newResolved.error.message,
							);
							break;
						}
						if (
							resolved.scope === "virtual" ||
							newResolved.scope === "virtual"
						) {
							result = errResult(
								"memory.traversal_blocked",
								"cannot rename virtual root",
							);
							break;
						}
						result = await renameCommand({
							oldAbsPath: resolved.absPath,
							newAbsPath: newResolved.absPath,
							oldScope: resolved.scope,
							newScope: newResolved.scope,
							oldLogicalPath: logicalPath,
							newLogicalPath: newLogical,
						});
						break;
					}
					default:
						result = errResult(
							"memory.not_found",
							`unknown command: ${p.command}`,
						);
				}
			} catch (e) {
				const code =
					e instanceof MemoryError ? e.code : "memory.not_found";
				const msg = e instanceof Error ? e.message : String(e);
				result = errResult(code, msg);
			}

			// Telemetry seam — plan 04.4-04 consumes this.
			const ev: MemoryOpEvent = {
				command: p.command,
				scope: resolved.scope === "virtual" ? "project" : resolved.scope,
				path: logicalPath,
				...(typeof (result as { bytes?: number }).bytes === "number"
					? { bytes: (result as { bytes: number }).bytes }
					: {}),
				result: result.isError
					? shortenCode((result as { code: string }).code)
					: "ok",
			};
			opts.onOp?.(ev);
			return result;
		},
	};
}

function shortenCode(code: string): MemoryOpEvent["result"] {
	const tail = code.replace(/^memory\./, "");
	return tail as MemoryOpEvent["result"];
}

function errResult(code: string, msg: string): MemoryResult {
	return {
		isError: true,
		content: [{ type: "text", text: `Error (${code}): ${msg}` }],
		code,
	};
}

/** Convenience default-config tool — mostly for tests. Production callers
 *  should use buildMemoryTool with profile config. */
export const memoryTool: PiToolDefinitionShape = buildMemoryTool({
	config: DEFAULT_MEMORY_CONFIG,
});
