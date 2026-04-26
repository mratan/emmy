// Plan 04.4-01 Task 2 — V4 path-traversal battery (30 hostile inputs all reject)
// + happy-path scope resolution + symlink-escape post-realpath rejection.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
	resolveMemoryPath,
} from "../../src/memory/path-resolver";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from "../../src/memory/types";

let projectRoot: string;
let globalRoot: string;
let cwdRoot: string; // parent of projectRoot — what we pass as `cwd`
let outsideDir: string; // not under either root, used for symlink-out
let cfg: MemoryConfig;

beforeAll(() => {
	const tmp = mkdtempSync(join(tmpdir(), "emmy-mem-pr-"));
	cwdRoot = join(tmp, "repo");
	projectRoot = join(cwdRoot, ".emmy-notes");
	globalRoot = join(tmp, "global-mem");
	outsideDir = join(tmp, "outside");

	mkdirSync(projectRoot, { recursive: true });
	mkdirSync(globalRoot, { recursive: true });
	mkdirSync(outsideDir, { recursive: true });
	writeFileSync(join(outsideDir, "secret.txt"), "ignore me");

	// Real symlink that escapes projectRoot
	symlinkSync(outsideDir, join(projectRoot, "evil-link"));

	cfg = {
		...DEFAULT_MEMORY_CONFIG,
		project_root: ".emmy-notes", // relative to cwdRoot
		global_root: globalRoot, // absolute
	};
});

afterAll(() => {
	try {
		rmSync(cwdRoot, { recursive: true, force: true });
	} catch {}
});

// ---- V4 30 hostile inputs (all must reject) -----------------------------

const HOSTILE_INPUTS: Array<{ input: string; group: string }> = [
	// 1–6 .. segments
	{ input: "/memories/project/../etc/passwd", group: "dotdot" },
	{ input: "/memories/project/foo/../../bar", group: "dotdot" },
	{ input: "/memories/../", group: "dotdot" },
	{ input: "/memories/global/..", group: "dotdot" },
	{ input: "..", group: "dotdot" },
	{ input: "../../etc", group: "dotdot" },
	// 7–9 backslash variants
	{ input: "/memories/project/..\\etc", group: "backslash" },
	{ input: "\\memories\\project\\..\\..", group: "backslash" },
	{ input: "..\\foo", group: "backslash" },
	// 10–14 URL-encoded
	{ input: "/memories/project/%2e%2e%2fetc", group: "urlenc" },
	{ input: "/memories/project/%2E%2E/", group: "urlenc" },
	{ input: "%2e%2e%2f", group: "urlenc" },
	{ input: "/memories/project/foo%2f..%2f", group: "urlenc" },
	{ input: "/memories/global%2f..%2f", group: "urlenc" },
	// 15–17 null-byte / weird-suffix injection
	{ input: "/memories/project/foo\0.txt", group: "nullbyte" },
	{ input: "/memories/project/\0", group: "nullbyte" },
	{ input: "\0../etc", group: "nullbyte" },
	// 18–22 absolute-ish / non-/memories
	{ input: "/etc/passwd", group: "absolute" },
	{ input: "/tmp/x", group: "absolute" },
	{ input: "C:\\Windows\\System32", group: "absolute" },
	{ input: "file:///etc/passwd", group: "absolute" },
	{ input: "/notes/foo", group: "absolute" }, // missing /memories prefix
	// 23–25 prefix only / scope-missing
	{ input: "/memorieshax/foo", group: "prefix" }, // not /memories prefix
	{ input: "/memories/notrealscope/foo", group: "prefix" }, // unknown scope
	{ input: "", group: "prefix" }, // empty
	// 26 mixed scope/dotdot
	{ input: "/memories/project/foo/bar/../..", group: "dotdot" },
	// 27 backslash inside otherwise valid path
	{ input: "/memories/project/foo\\bar", group: "backslash" },
	// 28 URL-encoded variant of /
	{ input: "/memories/project/foo%2Fbar", group: "urlenc" }, // not strictly traversal but rejected as URL-encoded component
	// 29 dotdot inside global scope
	{ input: "/memories/global/foo/../../etc", group: "dotdot" },
	// 30 — symlink escape (handled in separate test below; placeholder here for count)
	{ input: "/memories/project/evil-link/secret.txt", group: "symlink" },
];

describe("V4 — 30 hostile inputs all reject", () => {
	for (const { input, group } of HOSTILE_INPUTS) {
		test(`reject [${group}] ${JSON.stringify(input)}`, () => {
			const r = resolveMemoryPath(input, cfg, cwdRoot);
			expect(r.ok).toBe(false);
			if (!r.ok) {
				expect(r.error.code.startsWith("memory.")).toBe(true);
				// All hostile inputs map to traversal_blocked / blocked_extension /
				// disabled (none of the 30 should map to "ok").
				// The symlink case maps to traversal_blocked AFTER realpath.
				expect([
					"memory.traversal_blocked",
					"memory.blocked_extension",
					"memory.disabled",
				]).toContain(r.error.code);
			}
		});
	}

	test("HOSTILE_INPUTS count is at least 30", () => {
		expect(HOSTILE_INPUTS.length).toBeGreaterThanOrEqual(30);
	});
});

// ---- Happy-path resolution ----------------------------------------------

describe("happy-path resolution", () => {
	test("/memories returns virtual scope (top-level listing)", () => {
		const r = resolveMemoryPath("/memories", cfg, cwdRoot);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.scope).toBe("virtual");
	});

	test("/memories/project resolves to project root", () => {
		const r = resolveMemoryPath("/memories/project", cfg, cwdRoot);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.scope).toBe("project");
			expect(r.absPath).toBe(projectRoot);
		}
	});

	test("/memories/global resolves to global root", () => {
		const r = resolveMemoryPath("/memories/global", cfg, cwdRoot);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.scope).toBe("global");
			expect(r.absPath).toBe(globalRoot);
		}
	});

	test("/memories/project/notes/conventions.md → under projectRoot", () => {
		const r = resolveMemoryPath(
			"/memories/project/notes/conventions.md",
			cfg,
			cwdRoot,
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.absPath).toBe(join(projectRoot, "notes/conventions.md"));
		}
	});

	test("/memories/global/preferences.md → under globalRoot", () => {
		const r = resolveMemoryPath(
			"/memories/global/preferences.md",
			cfg,
			cwdRoot,
		);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.absPath).toBe(join(globalRoot, "preferences.md"));
	});

	test("~ expansion in global_root uses HOME", () => {
		const cfgTilde = { ...cfg, global_root: "~/.emmy/memory" };
		const r = resolveMemoryPath(
			"/memories/global/x.md",
			cfgTilde,
			cwdRoot,
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.absPath).toBe(join(homedir(), ".emmy/memory/x.md"));
		}
	});
});

// ---- Disabled scope ------------------------------------------------------

describe("disabled scopes", () => {
	test("project_root=null → memory.disabled", () => {
		const cfgDis = { ...cfg, project_root: null };
		const r = resolveMemoryPath("/memories/project/foo", cfgDis, cwdRoot);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("memory.disabled");
	});

	test("global_root=null → memory.disabled", () => {
		const cfgDis = { ...cfg, global_root: null };
		const r = resolveMemoryPath("/memories/global/foo", cfgDis, cwdRoot);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("memory.disabled");
	});

	test("master enabled=false short-circuits to memory.disabled", () => {
		const cfgOff = { ...cfg, enabled: false };
		const r = resolveMemoryPath("/memories/project/foo", cfgOff, cwdRoot);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("memory.disabled");
	});
});

// ---- Blocked extensions --------------------------------------------------

describe("blocked extensions", () => {
	test(".env extension rejected", () => {
		const r = resolveMemoryPath(
			"/memories/project/secrets.env",
			cfg,
			cwdRoot,
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("memory.blocked_extension");
	});

	test(".key extension rejected (case-insensitive)", () => {
		const r = resolveMemoryPath("/memories/global/api.KEY", cfg, cwdRoot);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("memory.blocked_extension");
	});

	test(".pem extension rejected", () => {
		const r = resolveMemoryPath(
			"/memories/global/cert.pem",
			cfg,
			cwdRoot,
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("memory.blocked_extension");
	});
});

// ---- Symlink escape (post-realpath containment recheck) -----------------

describe("symlink escape (V4 input #30)", () => {
	test("evil-link/secret.txt rejected after realpath resolves outside root", () => {
		const r = resolveMemoryPath(
			"/memories/project/evil-link/secret.txt",
			cfg,
			cwdRoot,
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("memory.traversal_blocked");
	});
});
