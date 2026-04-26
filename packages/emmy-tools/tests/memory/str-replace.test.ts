// Plan 04.4-02 Task 2 — str_replace tests.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strReplaceCommand } from "../../src/memory/commands/str-replace";
import { DEFAULT_MEMORY_CONFIG } from "../../src/memory/types";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-strrepl-"));
});
afterEach(() => {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {}
});

describe("str_replace command", () => {
	test("0-match returns memory.not_found", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "alpha beta gamma");
		const r = await strReplaceCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			oldStr: "delta",
			newStr: "x",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});

	test("1-match returns ok with replacedAtLine in payload", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "alpha\nbeta\ngamma\n");
		const r = await strReplaceCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			oldStr: "beta",
			newStr: "BB",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(false);
		const ok = r as { payload: { replacedAtLine: number } };
		expect(ok.payload.replacedAtLine).toBe(2);
		expect(readFileSync(f, "utf8")).toBe("alpha\nBB\ngamma\n");
	});

	test("2-match returns memory.ambiguous_match with both line numbers", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "alpha foo bar\nbeta foo bar\ngamma\n");
		const r = await strReplaceCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			oldStr: "foo bar",
			newStr: "X",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.ambiguous_match");
		const text = (r as { content: Array<{ text: string }> }).content[0].text;
		expect(text).toContain("matched 2 times");
		expect(text).toContain("1");
		expect(text).toContain("2");
	});

	test("3-match returns ambiguous_match with all 3 line numbers", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "X\nX\nY\nX\n");
		const r = await strReplaceCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			oldStr: "X",
			newStr: "Q",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(true);
		const text = (r as { content: Array<{ text: string }> }).content[0].text;
		expect(text).toContain("matched 3 times");
		expect(text).toContain("1");
		expect(text).toContain("2");
		expect(text).toContain("4");
	});

	test("empty old_str returns memory.not_found", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "x");
		const r = await strReplaceCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			oldStr: "",
			newStr: "y",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});

	test("quota_exceeded when post-replace size > max_file_bytes", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "AB");
		const r = await strReplaceCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			oldStr: "AB",
			newStr: "x".repeat(70000),
			config: { ...DEFAULT_MEMORY_CONFIG, max_file_bytes: 65536 },
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.quota_exceeded");
	});
});
