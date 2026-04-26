// Plan 04.4-01 Task 3 — quota helpers + memoryTool surface smoke.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkFileQuota,
	checkScopeQuota,
	walkScopeBytes,
} from "../../src/memory/quotas";
import {
	memoryTool,
	MEMORY_TOOL_DESCRIPTION,
} from "../../src/memory/index";
import { MemoryError } from "../../src/memory/types";

let workDir: string;
let scopeRoot: string;

beforeAll(() => {
	workDir = mkdtempSync(join(tmpdir(), "emmy-mem-quota-"));
	scopeRoot = join(workDir, "scope");
	mkdirSync(scopeRoot, { recursive: true });
});

afterAll(() => {
	try {
		rmSync(workDir, { recursive: true, force: true });
	} catch {}
});

describe("checkFileQuota", () => {
	test("ok at exactly maxFileBytes", () => {
		expect(() => checkFileQuota(65536, 65536)).not.toThrow();
	});

	test("throws memory.quota_exceeded over maxFileBytes", () => {
		try {
			checkFileQuota(65537, 65536);
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(MemoryError);
			expect((e as MemoryError).code).toBe("memory.quota_exceeded");
		}
	});
});

describe("walkScopeBytes", () => {
	test("returns 0 for empty directory", () => {
		const empty = join(workDir, "empty");
		mkdirSync(empty, { recursive: true });
		expect(walkScopeBytes(empty)).toBe(0);
	});

	test("returns 0 for non-existent directory", () => {
		expect(walkScopeBytes(join(workDir, "ghost"))).toBe(0);
	});

	test("sums file bytes including nested subdirs", () => {
		const root = join(workDir, "summing");
		mkdirSync(join(root, "sub"), { recursive: true });
		writeFileSync(join(root, "a.txt"), "x".repeat(100));
		writeFileSync(join(root, "b.txt"), "x".repeat(200));
		writeFileSync(join(root, "sub/c.txt"), "x".repeat(300));
		expect(walkScopeBytes(root)).toBe(600);
	});

	test("does NOT cross symlinks (security)", () => {
		const root = join(workDir, "symlink-skip");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "real.txt"), "x".repeat(50));
		const targetDir = join(workDir, "symlink-target");
		mkdirSync(targetDir, { recursive: true });
		writeFileSync(join(targetDir, "outside.txt"), "x".repeat(9999));
		symlinkSync(targetDir, join(root, "linked"));
		// Should count only real.txt's 50 bytes.
		expect(walkScopeBytes(root)).toBe(50);
	});
});

describe("checkScopeQuota", () => {
	test("ok when current+pending under cap", () => {
		const root = join(workDir, "scope-ok");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "a"), "x".repeat(100));
		expect(() =>
			checkScopeQuota(root, 200, 1024),
		).not.toThrow();
	});

	test("throws memory.quota_exceeded when projected > cap", () => {
		const root = join(workDir, "scope-overflow");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "a"), "x".repeat(10485759));
		try {
			checkScopeQuota(root, 2, 10485760);
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(MemoryError);
			expect((e as MemoryError).code).toBe("memory.quota_exceeded");
		}
	});

	test("ok at exactly cap (current==cap, pending=0)", () => {
		const root = join(workDir, "scope-at-cap");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "a"), "x".repeat(1024));
		expect(() =>
			checkScopeQuota(root, 0, 1024),
		).not.toThrow();
	});
});

describe("memoryTool surface (smoke)", () => {
	test("name === 'memory'", () => {
		expect(memoryTool.name).toBe("memory");
	});

	test("description contains both scope path prefixes", () => {
		expect(MEMORY_TOOL_DESCRIPTION).toContain("/memories/project");
		expect(MEMORY_TOOL_DESCRIPTION).toContain("/memories/global");
	});

	test("dispatch on non-existent file returns memory.not_found (plan 02 wired)", async () => {
		const r = (await memoryTool.execute(
			"id",
			{
				command: "view",
				path: "/memories/project/zzz-nonexistent-99999.md",
			},
			undefined,
			undefined,
		)) as { code?: string; isError?: boolean };
		expect(r.isError).toBe(true);
		expect(r.code).toBe("memory.not_found");
	});

	test("dispatch rejects hostile path BEFORE not_implemented (V4 guarantee)", async () => {
		const r = (await memoryTool.execute(
			"id",
			{ command: "view", path: "/memories/project/../etc/passwd" },
			undefined,
			undefined,
		)) as { code?: string; isError?: boolean };
		expect(r.isError).toBe(true);
		expect(r.code).toBe("memory.traversal_blocked");
	});
});
