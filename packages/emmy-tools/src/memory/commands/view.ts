// Plan 04.4-02 Task 1 — view command.
// Top-level virtual root → ["project/", "global/"]; directory → tree listing
// (alphabetic, dir-marked); file → 1-indexed numbered lines; with view_range
// clamps to lineCount.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildStalenessBanner } from "../staleness";
import { MemoryError, type MemoryConfig, type MemoryResult } from "../types";

export interface ViewArgs {
	absPath: string;
	scope: "project" | "global" | "virtual";
	logicalPath: string;
	viewRange?: [number, number];
	config: MemoryConfig;
}

export async function viewCommand(args: ViewArgs): Promise<MemoryResult> {
	// 1. Virtual root: list enabled scopes.
	if (args.scope === "virtual") {
		const lines: string[] = [];
		if (args.config.project_root) lines.push("project/");
		if (args.config.global_root) lines.push("global/");
		return ok({
			scope: "virtual",
			path: "/memories",
			payload: { listing: lines },
			contentText: lines.join("\n"),
		});
	}

	// 2. Path must exist.
	if (!existsSync(args.absPath)) {
		return err(
			new MemoryError(
				"memory.not_found",
				`path not found: ${args.logicalPath}`,
			),
		);
	}
	const st = statSync(args.absPath);

	// 3. Directory listing.
	if (st.isDirectory()) {
		const entries = readdirSync(args.absPath).sort();
		const formatted = entries.map((e) => {
			const eSt = statSync(join(args.absPath, e));
			return eSt.isDirectory() ? `${e}/` : e;
		});
		return ok({
			scope: args.scope,
			path: args.logicalPath,
			payload: { listing: formatted },
			contentText: formatted.join("\n"),
		});
	}

	// 4. File: 1-indexed numbered lines.
	const text = readFileSync(args.absPath, "utf8");
	const allLines = text.split("\n");
	if (text.length > 0 && text.endsWith("\n")) allLines.pop();
	const lineCount = allLines.length;

	let from = 1;
	let to = lineCount;
	if (args.viewRange) {
		from = Math.max(1, args.viewRange[0]);
		to = Math.min(lineCount, args.viewRange[1]);
	}
	const slice = from > lineCount ? [] : allLines.slice(from - 1, to);
	const numbered = slice
		.map((l, i) => `${String(from + i).padStart(6, " ")}\t${l}`)
		.join("\n");
	// Phase 04.4-followup: prepend verify-before-trust banner with staleness
	// info parsed from the note's `last_updated:` header (if present).
	// Surfaces to the model at every read, not reliant on prompt-language
	// adherence — addresses V3 rot vuln that prompt revisions did not close.
	const banner = buildStalenessBanner(text);
	const contentText = `${banner}${numbered}`;
	return ok({
		scope: args.scope,
		path: args.logicalPath,
		bytes: text.length,
		payload: { lines: numbered, lineCount, from, to },
		contentText,
	});
}

function ok(opts: {
	scope: "project" | "global" | "virtual";
	path: string;
	bytes?: number;
	payload: unknown;
	contentText: string;
}): MemoryResult {
	const result = {
		isError: false as const,
		command: "view",
		scope: opts.scope,
		path: opts.path,
		result: "ok" as const,
		payload: opts.payload,
		content: [{ type: "text" as const, text: opts.contentText }],
	};
	if (typeof opts.bytes === "number") {
		(result as { bytes?: number }).bytes = opts.bytes;
	}
	return result;
}

function err(e: MemoryError): MemoryResult {
	return {
		isError: true,
		content: [{ type: "text", text: `Error (${e.code}): ${e.message}` }],
		code: e.code,
	};
}
