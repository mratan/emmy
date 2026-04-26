// Plan 04.4-02 Task 2 — rename tests.

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
import { renameCommand } from "../../src/memory/commands/rename";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-rename-"));
});
afterEach(() => {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {}
});

describe("rename command", () => {
	test("file → file rename", async () => {
		const a = join(tmp, "a");
		const b = join(tmp, "b");
		writeFileSync(a, "data");
		const r = await renameCommand({
			oldAbsPath: a,
			newAbsPath: b,
			oldScope: "project",
			newScope: "project",
			oldLogicalPath: "/memories/project/a",
			newLogicalPath: "/memories/project/b",
		});
		expect(r.isError).toBe(false);
		expect(existsSync(a)).toBe(false);
		expect(existsSync(b)).toBe(true);
	});

	test("dir → dir rename", async () => {
		const a = join(tmp, "dirA");
		const b = join(tmp, "dirB");
		mkdirSync(a, { recursive: true });
		writeFileSync(join(a, "x"), "data");
		const r = await renameCommand({
			oldAbsPath: a,
			newAbsPath: b,
			oldScope: "project",
			newScope: "project",
			oldLogicalPath: "/memories/project/dirA",
			newLogicalPath: "/memories/project/dirB",
		});
		expect(r.isError).toBe(false);
		expect(existsSync(b)).toBe(true);
		expect(existsSync(join(b, "x"))).toBe(true);
	});

	test("auto-creates parent dir for new path", async () => {
		const a = join(tmp, "src");
		const b = join(tmp, "deep/nested/dst");
		writeFileSync(a, "data");
		const r = await renameCommand({
			oldAbsPath: a,
			newAbsPath: b,
			oldScope: "project",
			newScope: "project",
			oldLogicalPath: "/memories/project/src",
			newLogicalPath: "/memories/project/deep/nested/dst",
		});
		expect(r.isError).toBe(false);
		expect(existsSync(b)).toBe(true);
	});

	test("target exists returns memory.exists", async () => {
		const a = join(tmp, "a");
		const b = join(tmp, "b");
		writeFileSync(a, "1");
		writeFileSync(b, "2");
		const r = await renameCommand({
			oldAbsPath: a,
			newAbsPath: b,
			oldScope: "project",
			newScope: "project",
			oldLogicalPath: "/memories/project/a",
			newLogicalPath: "/memories/project/b",
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.exists");
	});

	test("cross-scope rejected with memory.traversal_blocked", async () => {
		const a = join(tmp, "a");
		writeFileSync(a, "data");
		const r = await renameCommand({
			oldAbsPath: a,
			newAbsPath: join(tmp, "global-target"),
			oldScope: "project",
			newScope: "global",
			oldLogicalPath: "/memories/project/a",
			newLogicalPath: "/memories/global/a",
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe(
			"memory.traversal_blocked",
		);
		// File still in original location
		expect(existsSync(a)).toBe(true);
	});

	test("source missing returns memory.not_found", async () => {
		const r = await renameCommand({
			oldAbsPath: join(tmp, "ghost"),
			newAbsPath: join(tmp, "x"),
			oldScope: "project",
			newScope: "project",
			oldLogicalPath: "/memories/project/ghost",
			newLogicalPath: "/memories/project/x",
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});
});
