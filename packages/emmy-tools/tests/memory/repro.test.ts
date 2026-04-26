// Plan 04.4-05 Task 1 — repro helpers tests.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyMemorySnapshot,
	createSnapshot,
	resolveMemoryConfig,
	restoreSnapshot,
	revertMemorySnapshot,
} from "../../src/memory/repro";
import { DEFAULT_MEMORY_CONFIG } from "../../src/memory/types";

let workspace: string;

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "emmy-repro-"));
});
afterEach(() => {
	try {
		rmSync(workspace, { recursive: true, force: true });
	} catch {}
});

describe("resolveMemoryConfig precedence", () => {
	test("no env, no flags → returns profile config", () => {
		const cfg = resolveMemoryConfig({
			profileMemory: {
				...DEFAULT_MEMORY_CONFIG,
				project_root: "profile_proj",
				global_root: "profile_glob",
			},
			env: {},
		});
		expect(cfg.project_root).toBe("profile_proj");
		expect(cfg.global_root).toBe("profile_glob");
	});

	test("EMMY_MEMORY_OVERRIDE_PROJECT wins over profile", () => {
		const cfg = resolveMemoryConfig({
			profileMemory: {
				...DEFAULT_MEMORY_CONFIG,
				project_root: "profile_proj",
			},
			env: { EMMY_MEMORY_OVERRIDE_PROJECT: "/tmp/x" },
		});
		expect(cfg.project_root).toBe("/tmp/x");
	});

	test("EMMY_MEMORY_OVERRIDE_GLOBAL wins over profile", () => {
		const cfg = resolveMemoryConfig({
			profileMemory: {
				...DEFAULT_MEMORY_CONFIG,
				global_root: "profile_glob",
			},
			env: { EMMY_MEMORY_OVERRIDE_GLOBAL: "/tmp/y" },
		});
		expect(cfg.global_root).toBe("/tmp/y");
	});

	test("both env vars override both roots", () => {
		const cfg = resolveMemoryConfig({
			profileMemory: DEFAULT_MEMORY_CONFIG,
			env: {
				EMMY_MEMORY_OVERRIDE_PROJECT: "/p",
				EMMY_MEMORY_OVERRIDE_GLOBAL: "/g",
			},
		});
		expect(cfg.project_root).toBe("/p");
		expect(cfg.global_root).toBe("/g");
	});

	test("noMemory:true short-circuits to enabled=false", () => {
		const cfg = resolveMemoryConfig({
			profileMemory: DEFAULT_MEMORY_CONFIG,
			noMemory: true,
			env: { EMMY_MEMORY_OVERRIDE_PROJECT: "/x" },
		});
		expect(cfg.enabled).toBe(false);
	});

	test("missing profileMemory falls back to DEFAULT_MEMORY_CONFIG", () => {
		const cfg = resolveMemoryConfig({ env: {} });
		expect(cfg.project_root).toBe(DEFAULT_MEMORY_CONFIG.project_root);
		expect(cfg.enabled).toBe(true);
	});

	test("empty-string env override does NOT count (treated as unset)", () => {
		const cfg = resolveMemoryConfig({
			profileMemory: {
				...DEFAULT_MEMORY_CONFIG,
				project_root: "kept",
			},
			env: { EMMY_MEMORY_OVERRIDE_PROJECT: "" },
		});
		expect(cfg.project_root).toBe("kept");
	});
});

describe("createSnapshot + restoreSnapshot", () => {
	test("apply + revert preserves original", () => {
		const live = join(workspace, "live");
		const src = join(workspace, "src");
		mkdirSync(live, { recursive: true });
		mkdirSync(src, { recursive: true });
		writeFileSync(join(live, "ORIG"), "original-content");
		writeFileSync(join(src, "NEW"), "new-content");

		const handle = createSnapshot(src, live);
		expect(existsSync(join(live, "NEW"))).toBe(true);
		expect(existsSync(join(live, "ORIG"))).toBe(false);

		restoreSnapshot(handle);
		expect(existsSync(join(live, "ORIG"))).toBe(true);
		expect(readFileSync(join(live, "ORIG"), "utf8")).toBe(
			"original-content",
		);
		expect(existsSync(join(live, "NEW"))).toBe(false);
	});

	test("apply on missing live root works (no parked-original needed)", () => {
		const live = join(workspace, "ghost");
		const src = join(workspace, "src");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "x"), "y");

		const handle = createSnapshot(src, live);
		expect(handle.parkedOriginal).toBeNull();
		expect(existsSync(join(live, "x"))).toBe(true);

		restoreSnapshot(handle);
		expect(existsSync(live)).toBe(false); // back to ghost
	});
});

describe("applyMemorySnapshot transactional behavior", () => {
	test("project + global apply is reversible (byte-identical original)", () => {
		const cwd = join(workspace, "cwd");
		const home = join(workspace, "home");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(home, { recursive: true });

		const projectLive = join(cwd, "proj");
		const globalLive = join(home, "glob");
		mkdirSync(projectLive, { recursive: true });
		mkdirSync(globalLive, { recursive: true });
		writeFileSync(join(projectLive, "p.md"), "PROJ-ORIG");
		writeFileSync(join(globalLive, "g.md"), "GLOB-ORIG");

		const projectSnap = join(workspace, "proj-snap");
		const globalSnap = join(workspace, "glob-snap");
		mkdirSync(projectSnap, { recursive: true });
		mkdirSync(globalSnap, { recursive: true });
		writeFileSync(join(projectSnap, "p.md"), "PROJ-SNAP");
		writeFileSync(join(globalSnap, "g.md"), "GLOB-SNAP");

		const cfg = {
			...DEFAULT_MEMORY_CONFIG,
			project_root: "proj",
			global_root: "glob",
		};
		const handle = applyMemorySnapshot({
			projectSnapshotDir: projectSnap,
			globalSnapshotDir: globalSnap,
			resolvedConfig: cfg,
			cwd,
			home,
		});

		expect(readFileSync(join(projectLive, "p.md"), "utf8")).toBe(
			"PROJ-SNAP",
		);
		expect(readFileSync(join(globalLive, "g.md"), "utf8")).toBe(
			"GLOB-SNAP",
		);

		revertMemorySnapshot(handle);

		expect(readFileSync(join(projectLive, "p.md"), "utf8")).toBe(
			"PROJ-ORIG",
		);
		expect(readFileSync(join(globalLive, "g.md"), "utf8")).toBe(
			"GLOB-ORIG",
		);
	});

	test("Atomic rollback when global snapshot dir is missing", () => {
		const cwd = join(workspace, "cwd");
		const home = join(workspace, "home");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(home, { recursive: true });
		const projectLive = join(cwd, "proj");
		mkdirSync(projectLive, { recursive: true });
		writeFileSync(join(projectLive, "x.md"), "ORIG");
		const projectSnap = join(workspace, "proj-snap");
		mkdirSync(projectSnap, { recursive: true });
		writeFileSync(join(projectSnap, "x.md"), "SNAP");

		const cfg = {
			...DEFAULT_MEMORY_CONFIG,
			project_root: "proj",
			global_root: "glob-doesnt-exist",
		};
		// global snapshot dir doesn't exist → cpSync throws
		expect(() =>
			applyMemorySnapshot({
				projectSnapshotDir: projectSnap,
				globalSnapshotDir: join(workspace, "missing"),
				resolvedConfig: cfg,
				cwd,
				home,
			}),
		).toThrow();
		// Project should be ROLLED BACK
		expect(readFileSync(join(projectLive, "x.md"), "utf8")).toBe(
			"ORIG",
		);
	});
});
