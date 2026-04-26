// Plan 04.4-02 Task 1 — create command tests.

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
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommand } from "../../src/memory/commands/create";
import { DEFAULT_MEMORY_CONFIG } from "../../src/memory/types";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-create-"));
});
afterEach(() => {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {}
});

describe("create command", () => {
	test("writes new file with file_text bytes", async () => {
		const target = join(tmp, "new.md");
		const r = await createCommand({
			absPath: target,
			scope: "project",
			logicalPath: "/memories/project/new.md",
			fileText: "hello world",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(false);
		expect((r as { bytes?: number }).bytes).toBe(11);
		expect(readFileSync(target, "utf8")).toBe("hello world");
	});

	test("rejects with memory.exists when file already exists", async () => {
		const target = join(tmp, "x.md");
		writeFileSync(target, "old");
		const r = await createCommand({
			absPath: target,
			scope: "project",
			logicalPath: "/memories/project/x.md",
			fileText: "new",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.exists");
		// Original NOT overwritten
		expect(readFileSync(target, "utf8")).toBe("old");
	});

	test("rejects directory paths with memory.is_directory", async () => {
		const dirPath = join(tmp, "subdir");
		mkdirSync(dirPath, { recursive: true });
		const r = await createCommand({
			absPath: dirPath,
			scope: "project",
			logicalPath: "/memories/project/subdir",
			fileText: "x",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.is_directory");
	});

	test("rejects file_text > max_file_bytes with memory.quota_exceeded", async () => {
		const r = await createCommand({
			absPath: join(tmp, "big.md"),
			scope: "project",
			logicalPath: "/memories/project/big.md",
			fileText: "x".repeat(70000),
			config: { ...DEFAULT_MEMORY_CONFIG, max_file_bytes: 65536 },
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.quota_exceeded");
	});

	test("rejects when scope total would exceed max_total_bytes", async () => {
		writeFileSync(join(tmp, "existing"), "x".repeat(10485759));
		const r = await createCommand({
			absPath: join(tmp, "small.md"),
			scope: "project",
			logicalPath: "/memories/project/small.md",
			fileText: "x".repeat(2),
			config: {
				...DEFAULT_MEMORY_CONFIG,
				max_file_bytes: 65536,
				max_total_bytes: 10485760,
			},
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.quota_exceeded");
	});

	test("auto-creates intermediate directories (mkdir -p)", async () => {
		const target = join(tmp, "deep/nested/notes.md");
		const r = await createCommand({
			absPath: target,
			scope: "project",
			logicalPath: "/memories/project/deep/nested/notes.md",
			fileText: "x",
			config: DEFAULT_MEMORY_CONFIG,
			scopeRootAbs: tmp,
		});
		expect(r.isError).toBe(false);
		expect(existsSync(target)).toBe(true);
	});
});
