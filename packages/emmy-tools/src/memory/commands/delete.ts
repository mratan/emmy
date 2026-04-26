// Plan 04.4-02 Task 2 — delete command.
// Non-recursive on directories (must be empty first; Anthropic semantics).
// Non-empty dir returns memory.dir_not_empty + contained-files list (capped).

import {
	existsSync,
	readdirSync,
	rmdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { MemoryError, type MemoryResult } from "../types";

export interface DeleteArgs {
	absPath: string;
	scope: "project" | "global";
	logicalPath: string;
}

export async function deleteCommand(args: DeleteArgs): Promise<MemoryResult> {
	if (!existsSync(args.absPath)) {
		return err(
			new MemoryError(
				"memory.not_found",
				`path not found: ${args.logicalPath}`,
			),
		);
	}
	const st = statSync(args.absPath);
	if (st.isDirectory()) {
		const entries = readdirSync(args.absPath);
		if (entries.length > 0) {
			const showing = entries.slice(0, 20);
			const more =
				entries.length > 20
					? ` (and ${entries.length - 20} more)`
					: "";
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Error (memory.dir_not_empty): directory ${args.logicalPath} is not empty (${entries.length} entries). Delete contents first or use a different path. Contents: ${showing.join(", ")}${more}`,
					},
				],
				code: "memory.dir_not_empty",
				details: { contained: showing, totalCount: entries.length },
			};
		}
		rmdirSync(args.absPath);
	} else {
		unlinkSync(args.absPath);
	}
	return {
		isError: false,
		command: "delete",
		scope: args.scope,
		path: args.logicalPath,
		result: "ok",
		payload: { deleted: st.isDirectory() ? "directory" : "file" },
		content: [
			{
				type: "text",
				text: `deleted ${st.isDirectory() ? "directory" : "file"}: ${args.logicalPath}`,
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
