// Plan 04.4-02 Task 1 — create command.
// Errors if file already exists (deliberate; forces explicit str_replace for
// updates). Auto-creates intermediate directories. Quota-checks pre-write.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkFileQuota, checkScopeQuota } from "../quotas";
import { MemoryError, type MemoryConfig, type MemoryResult } from "../types";

export interface CreateArgs {
	absPath: string;
	scope: "project" | "global";
	logicalPath: string;
	fileText: string;
	config: MemoryConfig;
	scopeRootAbs: string;
}

export async function createCommand(args: CreateArgs): Promise<MemoryResult> {
	if (existsSync(args.absPath)) {
		const st = statSync(args.absPath);
		if (st.isDirectory()) {
			return err(
				new MemoryError(
					"memory.is_directory",
					`path is a directory: ${args.logicalPath}`,
				),
			);
		}
		return err(
			new MemoryError(
				"memory.exists",
				`file already exists: ${args.logicalPath}; use str_replace or insert to update`,
			),
		);
	}
	const bytes = Buffer.byteLength(args.fileText, "utf8");
	try {
		checkFileQuota(bytes, args.config.max_file_bytes);
	} catch (e) {
		return err(e as MemoryError);
	}
	try {
		checkScopeQuota(
			args.scopeRootAbs,
			bytes,
			args.config.max_total_bytes,
		);
	} catch (e) {
		return err(e as MemoryError);
	}

	mkdirSync(dirname(args.absPath), { recursive: true });
	writeFileSync(args.absPath, args.fileText, "utf8");
	return {
		isError: false,
		command: "create",
		scope: args.scope,
		path: args.logicalPath,
		bytes,
		result: "ok",
		payload: { created: true },
		content: [{ type: "text", text: `created ${args.logicalPath} (${bytes} bytes)` }],
	};
}

function err(e: MemoryError): MemoryResult {
	return {
		isError: true,
		content: [{ type: "text", text: `Error (${e.code}): ${e.message}` }],
		code: e.code,
	};
}
