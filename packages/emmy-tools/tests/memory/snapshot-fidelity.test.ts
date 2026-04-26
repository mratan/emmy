// Plan 04.4-05 Task 2 — V6 byte-identical snapshot fidelity (E2E).
//
// Pre-populates a T0_GLOBAL fixture, applies it, runs the full memory
// dispatcher through every command shape, reverts the snapshot, and
// asserts the live root walks back to byte-identical with T0_GLOBAL.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
	applyMemorySnapshot,
	buildMemoryTool,
	DEFAULT_MEMORY_CONFIG,
	resolveMemoryConfig,
	revertMemorySnapshot,
} from "../../src/index";

function sha256(p: string): string {
	return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function walkFiles(
	root: string,
): Map<string, { size: number; sha: string }> {
	const out = new Map<string, { size: number; sha: string }>();
	const stack = [root];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		if (!existsSync(cur)) continue;
		const st = statSync(cur);
		if (st.isDirectory()) {
			for (const e of readdirSync(cur)) stack.push(join(cur, e));
		} else if (st.isFile()) {
			out.set(relative(root, cur), {
				size: st.size,
				sha: sha256(cur),
			});
		}
	}
	return out;
}

let workspace: string;
let t0Global: string;
let liveCwd: string;
let liveHome: string;
let liveGlobalAbs: string;

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "memory-v6-"));
	t0Global = join(workspace, "T0_GLOBAL");
	liveCwd = join(workspace, "cwd");
	liveHome = join(workspace, "home");
	liveGlobalAbs = join(liveHome, "memory");
	mkdirSync(join(t0Global, "nested/deeper"), { recursive: true });
	writeFileSync(join(t0Global, "a.md"), "a".repeat(100));
	writeFileSync(join(t0Global, "nested/b.md"), "b".repeat(200));
	writeFileSync(join(t0Global, "nested/deeper/c.md"), "c".repeat(50));
	writeFileSync(join(t0Global, "d.txt"), "d");
	mkdirSync(liveCwd, { recursive: true });
	mkdirSync(liveHome, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(workspace, { recursive: true, force: true });
	} catch {}
});

describe("memory tool — V6 snapshot/restore byte-identical fidelity", () => {
	test("global-only round-trip preserves PRE-APPLY state byte-identically", async () => {
		// Pre-populate liveGlobalAbs with the operator's actual notes (the
		// "before" state we want to preserve across the eval run).
		mkdirSync(liveGlobalAbs, { recursive: true });
		writeFileSync(join(liveGlobalAbs, "operator-1.md"), "OPERATOR-1");
		writeFileSync(join(liveGlobalAbs, "operator-2.md"), "OPERATOR-2-LONG-CONTENT");
		const beforeApply = walkFiles(liveGlobalAbs);
		expect(beforeApply.size).toBe(2);

		const cfg = resolveMemoryConfig({
			profileMemory: {
				...DEFAULT_MEMORY_CONFIG,
				project_root: null,
				global_root: liveGlobalAbs,
			},
		});
		const handles = applyMemorySnapshot({
			globalSnapshotDir: t0Global,
			resolvedConfig: cfg,
			cwd: liveCwd,
			home: liveHome,
		});

		// Confirm the snapshot took: live now mirrors T0, NOT the operator's notes.
		const duringEval = walkFiles(liveGlobalAbs);
		expect(duringEval.size).toBe(walkFiles(t0Global).size);
		expect(existsSync(join(liveGlobalAbs, "operator-1.md"))).toBe(false);

		const tool = buildMemoryTool({ config: cfg, cwd: liveCwd });
		const exec = (params: unknown) =>
			tool.execute(
				"t",
				params,
				new AbortController().signal,
				() => {},
			);

		// Run the full dispatcher exercise.
		await exec({ command: "view", path: "/memories/global" });
		await exec({ command: "view", path: "/memories/global/a.md" });
		await exec({
			command: "create",
			path: "/memories/global/new.md",
			file_text: "new",
		});
		await exec({
			command: "str_replace",
			path: "/memories/global/a.md",
			old_str: "aa",
			new_str: "AA",
		});
		await exec({
			command: "insert",
			path: "/memories/global/d.txt",
			insert_line: 0,
			insert_text: "PRE",
		});
		await exec({
			command: "rename",
			old_path: "/memories/global/new.md",
			new_path: "/memories/global/renamed.md",
		});
		await exec({
			command: "delete",
			path: "/memories/global/renamed.md",
		});

		revertMemorySnapshot(handles);

		// V6 invariant: live root walks back BYTE-IDENTICAL to pre-apply state.
		const afterRevert = walkFiles(liveGlobalAbs);
		expect(afterRevert.size).toBe(beforeApply.size);
		for (const [k, v] of beforeApply) {
			const got = afterRevert.get(k);
			expect(got).toBeDefined();
			expect(got!.size).toBe(v.size);
			expect(got!.sha).toBe(v.sha);
		}
	});

	test("project + global transactional round-trip preserves both pre-apply states", async () => {
		// Pre-populate live project + global with operator-owned files.
		const liveProjectAbs = join(liveCwd, ".emmy/notes");
		mkdirSync(liveProjectAbs, { recursive: true });
		mkdirSync(liveGlobalAbs, { recursive: true });
		writeFileSync(join(liveProjectAbs, "operator-proj.md"), "OPERATOR-P");
		writeFileSync(join(liveGlobalAbs, "operator-glob.md"), "OPERATOR-G");
		const projBefore = walkFiles(liveProjectAbs);
		const globBefore = walkFiles(liveGlobalAbs);

		// Build a project snapshot fixture.
		const t0Project = join(workspace, "T0_PROJECT");
		mkdirSync(t0Project, { recursive: true });
		writeFileSync(join(t0Project, "p1.md"), "P".repeat(80));
		writeFileSync(join(t0Project, "p2.md"), "Q".repeat(40));

		const cfg = resolveMemoryConfig({
			profileMemory: {
				...DEFAULT_MEMORY_CONFIG,
				project_root: ".emmy/notes",
				global_root: liveGlobalAbs,
			},
		});
		const handles = applyMemorySnapshot({
			projectSnapshotDir: t0Project,
			globalSnapshotDir: t0Global,
			resolvedConfig: cfg,
			cwd: liveCwd,
			home: liveHome,
		});
		const tool = buildMemoryTool({ config: cfg, cwd: liveCwd });
		const exec = (params: unknown) =>
			tool.execute(
				"t",
				params,
				new AbortController().signal,
				() => {},
			);

		await exec({
			command: "create",
			path: "/memories/project/x.md",
			file_text: "x",
		});
		await exec({
			command: "str_replace",
			path: "/memories/project/p1.md",
			old_str: "PP",
			new_str: "QQ",
		});
		await exec({
			command: "delete",
			path: "/memories/project/p2.md",
		});

		revertMemorySnapshot(handles);

		// V6 invariant: both scopes walk back to pre-apply state.
		const projAfter = walkFiles(liveProjectAbs);
		expect(projAfter.size).toBe(projBefore.size);
		for (const [k, v] of projBefore) {
			const got = projAfter.get(k);
			expect(got).toBeDefined();
			expect(got!.sha).toBe(v.sha);
		}
		const globAfter = walkFiles(liveGlobalAbs);
		expect(globAfter.size).toBe(globBefore.size);
		for (const [k, v] of globBefore) {
			const got = globAfter.get(k);
			expect(got).toBeDefined();
			expect(got!.sha).toBe(v.sha);
		}
	});
});
