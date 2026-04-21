// Post-hoc unified diff renderer — TOOLS-08.
// Every successful edit returns a non-empty diff string (visible in YOLO mode).
import { createTwoFilesPatch } from "diff";

export function renderUnifiedDiff(
	before: string,
	after: string,
	path: string,
): string {
	if (before === after) return "";
	// `createTwoFilesPatch` lets us emit `--- a/<path>` and `+++ b/<path>`
	// directly — the standard unified-diff header shape callers expect.
	// Empty oldHeader/newHeader args suppress the timestamp column.
	return createTwoFilesPatch(
		`a/${path}`,
		`b/${path}`,
		before,
		after,
		"",
		"",
		{ context: 3 },
	);
}
