// Plan 04.4-02 Task 1 — insert command.
// insert_line is 1-indexed; 0 prepends; N=lineCount appends.
// Out-of-range insert_line returns memory.not_found.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { checkFileQuota, checkScopeQuota } from "../quotas";
import { MemoryError, type MemoryConfig, type MemoryResult } from "../types";

export interface InsertArgs {
	absPath: string;
	scope: "project" | "global";
	logicalPath: string;
	insertLine: number;
	insertText: string;
	config: MemoryConfig;
	scopeRootAbs: string;
}

export async function insertCommand(args: InsertArgs): Promise<MemoryResult> {
	if (!existsSync(args.absPath)) {
		return err(
			new MemoryError(
				"memory.not_found",
				`path not found: ${args.logicalPath}`,
			),
		);
	}
	if (statSync(args.absPath).isDirectory()) {
		return err(
			new MemoryError(
				"memory.is_directory",
				`cannot insert into directory: ${args.logicalPath}`,
			),
		);
	}
	const orig = readFileSync(args.absPath, "utf8");
	const trailingNewline = orig.length > 0 && orig.endsWith("\n");
	const lines = orig.split("\n");
	if (trailingNewline) lines.pop();
	const lineCount = lines.length;
	if (args.insertLine < 0 || args.insertLine > lineCount) {
		return err(
			new MemoryError(
				"memory.not_found",
				`insert_line ${args.insertLine} out of range (file has ${lineCount} lines)`,
			),
		);
	}
	lines.splice(args.insertLine, 0, args.insertText);
	const out = lines.join("\n") + (trailingNewline ? "\n" : "");

	const newBytes = Buffer.byteLength(out, "utf8");
	const origBytes = Buffer.byteLength(orig, "utf8");
	try {
		checkFileQuota(newBytes, args.config.max_file_bytes);
	} catch (e) {
		return err(e as MemoryError);
	}
	try {
		checkScopeQuota(
			args.scopeRootAbs,
			Math.max(0, newBytes - origBytes),
			args.config.max_total_bytes,
		);
	} catch (e) {
		return err(e as MemoryError);
	}
	writeFileSync(args.absPath, out, "utf8");
	return {
		isError: false,
		command: "insert",
		scope: args.scope,
		path: args.logicalPath,
		bytes: newBytes,
		result: "ok",
		payload: {
			insertedAt: args.insertLine,
			newLineCount: lineCount + 1,
		},
		content: [
			{
				type: "text",
				text: `inserted at line ${args.insertLine} of ${args.logicalPath}`,
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
