// Plan 04.4-02 Task 2 — rename command.
// Within-scope file/dir rename. Cross-scope rejected to traversal_blocked
// (model uses create + delete to move across scopes — explicit by design).

import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { MemoryError, type MemoryResult } from "../types";

export interface RenameArgs {
	oldAbsPath: string;
	newAbsPath: string;
	oldScope: "project" | "global";
	newScope: "project" | "global";
	oldLogicalPath: string;
	newLogicalPath: string;
}

export async function renameCommand(args: RenameArgs): Promise<MemoryResult> {
	if (args.oldScope !== args.newScope) {
		return err(
			new MemoryError(
				"memory.traversal_blocked",
				`cross-scope rename rejected: ${args.oldScope} → ${args.newScope}. Use create + delete to move across scopes.`,
			),
		);
	}
	if (!existsSync(args.oldAbsPath)) {
		return err(
			new MemoryError(
				"memory.not_found",
				`source path not found: ${args.oldLogicalPath}`,
			),
		);
	}
	if (existsSync(args.newAbsPath)) {
		return err(
			new MemoryError(
				"memory.exists",
				`destination already exists: ${args.newLogicalPath}`,
			),
		);
	}
	mkdirSync(dirname(args.newAbsPath), { recursive: true });
	renameSync(args.oldAbsPath, args.newAbsPath);
	const wasDir = statSync(args.newAbsPath).isDirectory();
	return {
		isError: false,
		command: "rename",
		scope: args.newScope,
		path: args.newLogicalPath,
		result: "ok",
		payload: {
			from: args.oldLogicalPath,
			kind: wasDir ? "directory" : "file",
		},
		content: [
			{
				type: "text",
				text: `renamed ${args.oldLogicalPath} → ${args.newLogicalPath}`,
			},
		],
	};
}

function err(e: MemoryError): MemoryResult {
	return {
		isError: true,
		content: [{ type: "text", text: `Error (${e.code}): ${e.message}` }],
		code: e.code,
	};
}
