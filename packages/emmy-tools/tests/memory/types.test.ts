// Plan 04.4-01 Task 1 — TypeBox schema acceptance/rejection battery.

import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
	MemoryToolInput,
	DEFAULT_MEMORY_CONFIG,
	MemoryError,
} from "../../src/memory/types";

describe("MemoryToolInput — accepts valid command shapes", () => {
	test("view without view_range", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "view",
				path: "/memories/project/foo",
			}),
		).toBe(true);
	});

	test("view with view_range tuple [start,end]", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "view",
				path: "/memories/project/foo",
				view_range: [1, 10],
			}),
		).toBe(true);
	});

	test("create requires path + file_text", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "create",
				path: "/memories/global/x",
				file_text: "hi",
			}),
		).toBe(true);
	});

	test("str_replace requires path + old_str + new_str", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "str_replace",
				path: "/memories/project/foo",
				old_str: "a",
				new_str: "b",
			}),
		).toBe(true);
	});

	test("insert requires path + insert_line + insert_text", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "insert",
				path: "/memories/project/foo",
				insert_line: 5,
				insert_text: "x",
			}),
		).toBe(true);
	});

	test("delete requires path", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "delete",
				path: "/memories/project/foo",
			}),
		).toBe(true);
	});

	test("rename requires old_path + new_path", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "rename",
				old_path: "/memories/project/foo",
				new_path: "/memories/project/bar",
			}),
		).toBe(true);
	});
});

describe("MemoryToolInput — rejects invalid shapes", () => {
	test("rejects unknown command", () => {
		expect(
			Value.Check(MemoryToolInput, { command: "unknown", path: "/x" }),
		).toBe(false);
	});

	test("rejects view missing path", () => {
		expect(Value.Check(MemoryToolInput, { command: "view" })).toBe(false);
	});

	test("rejects view_range with wrong tuple length", () => {
		expect(
			Value.Check(MemoryToolInput, {
				command: "view",
				path: "/memories/x",
				view_range: [5],
			}),
		).toBe(false);
	});
});

describe("DEFAULT_MEMORY_CONFIG matches MEMORY-TOOL-SPEC.md §3.2", () => {
	test("defaults parse correctly", () => {
		expect(DEFAULT_MEMORY_CONFIG.enabled).toBe(true);
		expect(DEFAULT_MEMORY_CONFIG.project_root).toBe(".emmy/notes");
		expect(DEFAULT_MEMORY_CONFIG.global_root).toBe("~/.emmy/memory");
		expect(DEFAULT_MEMORY_CONFIG.read_at_session_start).toBe(true);
		expect(DEFAULT_MEMORY_CONFIG.max_file_bytes).toBe(65536);
		expect(DEFAULT_MEMORY_CONFIG.max_total_bytes).toBe(10_485_760);
		expect(DEFAULT_MEMORY_CONFIG.blocked_extensions).toEqual([
			".env",
			".key",
			".pem",
		]);
	});
});

describe("MemoryError carries dotted code", () => {
	test("preserves code on instance", () => {
		const e = new MemoryError("memory.traversal_blocked", "test");
		expect(e.code).toBe("memory.traversal_blocked");
		expect(e.message).toContain("traversal_blocked");
	});

	test("error chain is ToolsError-compatible", () => {
		const e = new MemoryError("memory.quota_exceeded", "over");
		expect(e.name).toBe("MemoryError");
		expect(e.message.startsWith("tools.memory.")).toBe(true);
	});
});
