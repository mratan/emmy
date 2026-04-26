// Plan 04.4-02 Task 2 — str_replace command.
// Find unique substring or fail with diagnostics (Anthropic memory_20250818
// semantics; mirrors edit-hashline.ts's "all-line-numbers-on-collision" idiom).

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { checkFileQuota } from "../quotas";
import { MemoryError, type MemoryConfig, type MemoryResult } from "../types";

export interface StrReplaceArgs {
	absPath: string;
	scope: "project" | "global";
	logicalPath: string;
	oldStr: string;
	newStr: string;
	config: MemoryConfig;
}

export async function strReplaceCommand(
	args: StrReplaceArgs,
): Promise<MemoryResult> {
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
				`cannot str_replace on directory: ${args.logicalPath}`,
			),
		);
	}
	if (args.oldStr.length === 0) {
		return err(new MemoryError("memory.not_found", "empty old_str rejected"));
	}
	const orig = readFileSync(args.absPath, "utf8");

	const lineNumbers: number[] = [];
	let searchFrom = 0;
	while (searchFrom <= orig.length) {
		const idx = orig.indexOf(args.oldStr, searchFrom);
		if (idx < 0) break;
		const lineNum = orig.slice(0, idx).split("\n").length; // 1-indexed
		lineNumbers.push(lineNum);
		searchFrom = idx + Math.max(1, args.oldStr.length);
	}
	if (lineNumbers.length === 0) {
		return err(
			new MemoryError(
				"memory.not_found",
				`old_str not found in ${args.logicalPath}`,
			),
		);
	}
	if (lineNumbers.length > 1) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: `Error (memory.ambiguous_match): old_str matched ${lineNumbers.length} times at lines ${lineNumbers.join(", ")}. Resubmit with more context to disambiguate.`,
				},
			],
			code: "memory.ambiguous_match",
			details: { matchCount: lineNumbers.length, lineNumbers },
		};
	}
	const out = orig.replace(args.oldStr, args.newStr);
	const newBytes = Buffer.byteLength(out, "utf8");
	try {
		checkFileQuota(newBytes, args.config.max_file_bytes);
	} catch (e) {
		return err(e as MemoryError);
	}
	writeFileSync(args.absPath, out, "utf8");
	return {
		isError: false,
		command: "str_replace",
		scope: args.scope,
		path: args.logicalPath,
		bytes: newBytes,
		result: "ok",
		payload: { replacedAtLine: lineNumbers[0] },
		content: [
			{
				type: "text",
				text: `replaced at line ${lineNumbers[0]} of ${args.logicalPath}`,
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
