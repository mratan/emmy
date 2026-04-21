import { describe, expect, test } from "bun:test";
import { renderUnifiedDiff } from "../src/diff-render";

describe("renderUnifiedDiff (TOOLS-08 post-hoc unified diff)", () => {
	test("identical strings → empty string", () => {
		expect(renderUnifiedDiff("hello\n", "hello\n", "a.txt")).toBe("");
	});

	test("differing strings → contains unified-diff --- / +++ headers", () => {
		const before = "foo\nbar\nbaz\n";
		const after = "foo\nBAR\nbaz\n";
		const d = renderUnifiedDiff(before, after, "a.txt");
		expect(d).toContain("--- a/a.txt");
		expect(d).toContain("+++ b/a.txt");
	});

	test("line-level changes appear as - and + hunks", () => {
		const before = "foo\nbar\nbaz\n";
		const after = "foo\nBAR\nbaz\n";
		const d = renderUnifiedDiff(before, after, "a.txt");
		expect(d).toMatch(/^-bar$/m);
		expect(d).toMatch(/^\+BAR$/m);
	});

	test("pure addition diff", () => {
		const before = "a\n";
		const after = "a\nb\n";
		const d = renderUnifiedDiff(before, after, "f.txt");
		expect(d).toMatch(/^\+b$/m);
	});

	test("pure deletion diff", () => {
		const before = "a\nb\n";
		const after = "a\n";
		const d = renderUnifiedDiff(before, after, "f.txt");
		expect(d).toMatch(/^-b$/m);
	});
});
