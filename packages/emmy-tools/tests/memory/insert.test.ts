// Plan 04.4-02 Task 1 — insert command tests.

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
import { insertCommand } from "../../src/memory/commands/insert";
import { DEFAULT_MEMORY_CONFIG } from "../../src/memory/types";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-insert-"));
});
afterEach(() => {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {}
});

describe("insert command", () => {
	test("insert_line:0 prepends (line 1 becomes insert_text)", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "alpha\nbeta\n");
		const r = await insertCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			insertLine: 0,
			insertText: "ZERO",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(false);
		// Phase 04.4-followup — insert refreshes/prepends `last_updated:` on every edit.
		const out = readFileSync(f, "utf8");
		expect(out).toMatch(/^last_updated: \d{4}-\d{2}-\d{2}T[\d:.]+Z\n\nZERO\nalpha\nbeta\n$/);
	});

	test("insert_line:N places between line N and line N+1", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "alpha\nbeta\ngamma\n");
		const r = await insertCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			insertLine: 1,
			insertText: "MID",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(false);
		expect(readFileSync(f, "utf8")).toMatch(/^last_updated: \d{4}-\d{2}-\d{2}T[\d:.]+Z\n\nalpha\nMID\nbeta\ngamma\n$/);
	});

	test("insert at lineCount appends as last line", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "a\nb\n");
		const r = await insertCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			insertLine: 2,
			insertText: "END",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(false);
		expect(readFileSync(f, "utf8")).toMatch(/^last_updated: \d{4}-\d{2}-\d{2}T[\d:.]+Z\n\na\nb\nEND\n$/);
	});

	test("insert_line out of range returns memory.not_found", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "a\nb\n");
		const r = await insertCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			insertLine: 100,
			insertText: "x",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});

	test("missing file returns memory.not_found", async () => {
		const r = await insertCommand({
			absPath: join(tmp, "ghost"),
			scope: "project",
			logicalPath: "/memories/project/ghost",
			insertLine: 0,
			insertText: "x",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});

	test("quota exceeded when post-insert size exceeds max_file_bytes", async () => {
		const f = join(tmp, "f");
		writeFileSync(f, "x".repeat(60000));
		const r = await insertCommand({
			absPath: f,
			scope: "project",
			logicalPath: "/memories/project/f",
			insertLine: 0,
			insertText: "y".repeat(10000),
			config: { ...DEFAULT_MEMORY_CONFIG, max_file_bytes: 65536 },
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.quota_exceeded");
	});
});
