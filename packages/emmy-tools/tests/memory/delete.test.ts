// Plan 04.4-02 Task 2 — delete tests.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteCommand } from "../../src/memory/commands/delete";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-delete-"));
});
afterEach(() => {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {}
});

describe("delete command", () => {
	test("file delete removes the file", async () => {
		const f = join(tmp, "x");
		writeFileSync(f, "x");
		const r = await deleteCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/x",
		});
		expect(r.isError).toBe(false);
		expect(existsSync(f)).toBe(false);
	});

	test("empty dir delete removes the dir", async () => {
		const d = join(tmp, "emptydir");
		mkdirSync(d, { recursive: true });
		const r = await deleteCommand({
			absPath: d,
			scope: "project",
			logicalPath: "/memories/project/emptydir",
		});
		expect(r.isError).toBe(false);
		expect(existsSync(d)).toBe(false);
	});

	test("non-empty dir returns memory.dir_not_empty with contents list", async () => {
		const d = join(tmp, "fulldir");
		mkdirSync(d, { recursive: true });
		writeFileSync(join(d, "a"), "x");
		writeFileSync(join(d, "b"), "y");
		const r = await deleteCommand({
			absPath: d,
			scope: "project",
			logicalPath: "/memories/project/fulldir",
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.dir_not_empty");
		const text = (r as { content: Array<{ text: string }> }).content[0]
			.text;
		expect(text).toContain("a");
		expect(text).toContain("b");
		expect(existsSync(d)).toBe(true);
	});

	test("missing path returns memory.not_found", async () => {
		const r = await deleteCommand({
			absPath: join(tmp, "ghost"),
			scope: "project",
			logicalPath: "/memories/project/ghost",
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});

	test("contained-files list capped at 20 entries", async () => {
		const d = join(tmp, "many");
		mkdirSync(d, { recursive: true });
		for (let i = 0; i < 25; i++) {
			writeFileSync(join(d, `f${i}`), "x");
		}
		const r = await deleteCommand({
			absPath: d,
			scope: "project",
			logicalPath: "/memories/project/many",
		});
		expect(r.isError).toBe(true);
		const text = (r as { content: Array<{ text: string }> }).content[0]
			.text;
		expect(text).toContain("(and 5 more)");
	});
});
