// PLAN-03-MERGE-NOTE: Owned by Plan 02-03. Stubbed so native-tools.ts's `read`
// tool can delegate in isolation. On merge-back:
// `git checkout --theirs packages/emmy-tools/src/read-with-hashes.ts`.

import { readFileSync } from "node:fs";
import type { HashedLine } from "./types";
import { hash8hex, normalizeText } from "./hash";
import { isBinary } from "./text-binary-detect";

export function readWithHashes(
  absPath: string,
  opts: { lineRange?: [number, number] } = {},
): { content: string; lines: HashedLine[]; path: string; binary: boolean } {
  const buf = readFileSync(absPath);
  if (isBinary(buf)) {
    return { content: buf.toString("base64"), lines: [], path: absPath, binary: true };
  }
  const normalized = normalizeText(buf.toString("utf8"));
  const raw = normalized.split("\n");
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
  return lines.map((l) => `${l.hash}  ${l.content}\n`).join("");
}
