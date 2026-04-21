// RED stub — Plan 02-03 Task 1.
import type { HashedLine } from "./types";

export function readWithHashes(
	_absPath: string,
	_opts?: { lineRange?: [number, number] },
): { content: string; lines: HashedLine[]; path: string; binary: boolean } {
	throw new Error("not implemented");
}

export function renderHashedLines(_lines: HashedLine[]): string {
	throw new Error("not implemented");
}
