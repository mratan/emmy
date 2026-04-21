// Read-with-hashes: D-07 — tag every line with its 8-hex content hash.
// Rendered format is `{8hex}  {content}\n` per line (EXACTLY two spaces).
import { readFileSync } from "node:fs";
import { hash8hex, normalizeText } from "./hash";
import { isBinary } from "./text-binary-detect";
import type { HashedLine } from "./types";

export function readWithHashes(
	absPath: string,
	opts: { lineRange?: [number, number] } = {},
): { content: string; lines: HashedLine[]; path: string; binary: boolean } {
	const buf = readFileSync(absPath);
	if (isBinary(buf)) {
		return {
			content: buf.toString("base64"),
			lines: [],
			path: absPath,
			binary: true,
		};
	}
	const normalized = normalizeText(buf.toString("utf8"));
	const raw = normalized.split("\n");
	// If the file ends with a trailing newline, split produces a trailing "" —
	// drop it so line counts match "number of lines written".
	if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
	const all: HashedLine[] = raw.map((content, idx) => ({
		hash: hash8hex(content),
		content,
		line_number: idx + 1,
	}));
	const lines = opts.lineRange
		? all.slice(Math.max(0, opts.lineRange[0] - 1), opts.lineRange[1])
		: all;
	return { content: normalized, lines, path: absPath, binary: false };
}

export function renderHashedLines(lines: HashedLine[]): string {
	// D-07: TWO-space separator between hash and content.
	return lines.map((l) => `${l.hash}  ${l.content}\n`).join("");
}
