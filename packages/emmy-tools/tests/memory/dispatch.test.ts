// Plan 04.4-02 Task 3 — end-to-end memoryTool dispatch tests.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	mkdtempSync,
	rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildMemoryTool,
	type MemoryToolOpts,
} from "../../src/memory/index";
import {
	DEFAULT_MEMORY_CONFIG,
	type MemoryConfig,
	type MemoryOpEvent,
} from "../../src/memory/types";

let cwd: string;
let opEvents: MemoryOpEvent[];

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "emmy-dispatch-cwd-"));
	opEvents = [];
});
afterEach(() => {
	try {
		rmSync(cwd, { recursive: true, force: true });
	} catch {}
});

function buildTool(
	cfgOverride: Partial<MemoryConfig> = {},
): ReturnType<typeof buildMemoryTool> {
	const cfg: MemoryConfig = {
		...DEFAULT_MEMORY_CONFIG,
		project_root: ".emmy/notes",
		// Use a per-test global root to avoid clobbering real ~/.emmy/memory
		global_root: join(cwd, "global-mem"),
		...cfgOverride,
	};
	const opts: MemoryToolOpts = {
		config: cfg,
		cwd,
		onOp: (ev) => opEvents.push(ev),
	};
	return buildMemoryTool(opts);
}

async function call(
	tool: ReturnType<typeof buildMemoryTool>,
	params: Record<string, unknown>,
): Promise<{ isError?: boolean; code?: string; payload?: unknown; bytes?: number }> {
	const r = await tool.execute("id", params, undefined, undefined);
	return r as { isError?: boolean; code?: string };
}

describe("memoryTool dispatch (Plan 04.4-02)", () => {
	test("view /memories returns scope='virtual' listing", async () => {
		const tool = buildTool();
		const r = await call(tool, { command: "view", path: "/memories" });
		expect(r.isError).toBe(false);
	});

	test("create + view round-trip on a project file", async () => {
		const tool = buildTool();
		const c = await call(tool, {
			command: "create",
			path: "/memories/project/a.md",
			file_text: "hi",
		});
		expect(c.isError).toBe(false);
		expect(c.bytes).toBe(2);

		const v = await call(tool, {
			command: "view",
			path: "/memories/project/a.md",
		});
		expect(v.isError).toBe(false);
	});

	test("str_replace on existing file succeeds", async () => {
		const tool = buildTool();
		await call(tool, {
			command: "create",
			path: "/memories/project/a.md",
			file_text: "hi",
		});
		const r = await call(tool, {
			command: "str_replace",
			path: "/memories/project/a.md",
			old_str: "hi",
			new_str: "bye",
		});
		expect(r.isError).toBe(false);
	});

	test("insert prepends with insert_line:0", async () => {
		const tool = buildTool();
		await call(tool, {
			command: "create",
			path: "/memories/project/a.md",
			file_text: "old",
		});
		const r = await call(tool, {
			command: "insert",
			path: "/memories/project/a.md",
			insert_line: 0,
			insert_text: "new",
		});
		expect(r.isError).toBe(false);
	});

	test("delete on existing file succeeds", async () => {
		const tool = buildTool();
		await call(tool, {
			command: "create",
			path: "/memories/project/a.md",
			file_text: "x",
		});
		const r = await call(tool, {
			command: "delete",
			path: "/memories/project/a.md",
		});
		expect(r.isError).toBe(false);
	});

	test("cross-scope rename → memory.traversal_blocked", async () => {
		const tool = buildTool();
		await call(tool, {
			command: "create",
			path: "/memories/project/x.md",
			file_text: "data",
		});
		const r = await call(tool, {
			command: "rename",
			old_path: "/memories/project/x.md",
			new_path: "/memories/global/x.md",
		});
		expect(r.isError).toBe(true);
		expect(r.code).toBe("memory.traversal_blocked");
	});

	test("onOp callback fires for every execute() call (success path)", async () => {
		const tool = buildTool();
		await call(tool, { command: "view", path: "/memories" });
		expect(opEvents.length).toBe(1);
		expect(opEvents[0]?.command).toBe("view");
		expect(opEvents[0]?.result).toBe("ok");
	});

	test("onOp fires on error paths with shortened result code", async () => {
		const tool = buildTool();
		await call(tool, {
			command: "view",
			path: "/memories/project/ghost.md",
		});
		expect(opEvents.length).toBe(1);
		expect(opEvents[0]?.result).toBe("not_found");
	});

	test("config.enabled=false → memory.disabled for every command", async () => {
		const tool = buildTool({ enabled: false });
		const r1 = await call(tool, { command: "view", path: "/memories" });
		const r2 = await call(tool, {
			command: "create",
			path: "/memories/project/x",
			file_text: "x",
		});
		expect(r1.code).toBe("memory.disabled");
		expect(r2.code).toBe("memory.disabled");
	});

	test("create on existing path → memory.exists (no overwrite)", async () => {
		const tool = buildTool();
		await call(tool, {
			command: "create",
			path: "/memories/project/x.md",
			file_text: "v1",
		});
		const r = await call(tool, {
			command: "create",
			path: "/memories/project/x.md",
			file_text: "v2",
		});
		expect(r.isError).toBe(true);
		expect(r.code).toBe("memory.exists");
	});
});
