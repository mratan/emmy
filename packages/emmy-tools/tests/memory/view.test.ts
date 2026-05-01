// Plan 04.4-02 Task 1 — view command tests.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viewCommand } from "../../src/memory/commands/view";
import { DEFAULT_MEMORY_CONFIG } from "../../src/memory/types";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-view-"));
});
afterEach(() => {
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {}
});

describe("view command", () => {
	test("virtual root lists project/ and global/", async () => {
		const r = await viewCommand({
			absPath: "",
			scope: "virtual",
			logicalPath: "/memories",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(false);
		const ok = r as { payload: { listing: string[] } };
		expect(ok.payload.listing).toContain("project/");
		expect(ok.payload.listing).toContain("global/");
	});

	test("virtual root omits disabled scopes", async () => {
		const r = await viewCommand({
			absPath: "",
			scope: "virtual",
			logicalPath: "/memories",
			config: { ...DEFAULT_MEMORY_CONFIG, project_root: null },
		});
		const ok = r as { payload: { listing: string[] } };
		expect(ok.payload.listing).not.toContain("project/");
		expect(ok.payload.listing).toContain("global/");
	});

	test("missing path returns memory.not_found", async () => {
		const r = await viewCommand({
			absPath: join(tmp, "nope"),
			scope: "project",
			logicalPath: "/memories/project/nope",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});

	// 04.4-followup — scope-root tolerance.
	// Fresh checkout: <repo>/.emmy/notes/ doesn't exist. Fresh user: ~/.emmy/memory/
	// doesn't exist. The read_at_session_start instinct fires `view /memories/project`
	// at every session start; without this tolerance, the model surfaces an ugly
	// memory.not_found on every first-launch in a new project.
	test("missing project scope root returns empty listing (not error)", async () => {
		const r = await viewCommand({
			absPath: join(tmp, "does-not-exist-yet"),
			scope: "project",
			logicalPath: "/memories/project",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(false);
		const ok = r as { payload: { listing: string[] }; content: { text: string }[] };
		expect(ok.payload.listing).toEqual([]);
		expect(ok.content[0].text).toBe("");
	});

	test("missing global scope root returns empty listing (not error)", async () => {
		const r = await viewCommand({
			absPath: join(tmp, "does-not-exist-yet"),
			scope: "global",
			logicalPath: "/memories/global",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(false);
		const ok = r as { payload: { listing: string[] } };
		expect(ok.payload.listing).toEqual([]);
	});

	test("missing scope root with trailing slash also returns empty listing", async () => {
		const r = await viewCommand({
			absPath: join(tmp, "does-not-exist-yet"),
			scope: "project",
			logicalPath: "/memories/project/",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(false);
		const ok = r as { payload: { listing: string[] } };
		expect(ok.payload.listing).toEqual([]);
	});

	test("missing sub-path under scope still returns memory.not_found (regression guard)", async () => {
		// This guards against the tolerance over-reaching: a missing FILE under
		// the scope root must still error normally.
		const r = await viewCommand({
			absPath: join(tmp, "sub", "missing.md"),
			scope: "project",
			logicalPath: "/memories/project/sub/missing.md",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(true);
		expect((r as { code: string }).code).toBe("memory.not_found");
	});

	test("directory listing alphabetical with dir slash", async () => {
		mkdirSync(join(tmp, "sub"), { recursive: true });
		writeFileSync(join(tmp, "a.md"), "x");
		writeFileSync(join(tmp, "b.md"), "y");
		const r = await viewCommand({
			absPath: tmp,
			scope: "project",
			logicalPath: "/memories/project",
			config: DEFAULT_MEMORY_CONFIG,
		});
		const ok = r as { payload: { listing: string[] } };
		expect(ok.payload.listing).toEqual(["a.md", "b.md", "sub/"]);
	});

	test("file returns numbered lines (1-indexed)", async () => {
		writeFileSync(join(tmp, "f"), "alpha\nbeta\ngamma\n");
		const r = await viewCommand({
			absPath: join(tmp, "f"),
			scope: "project",
			logicalPath: "/memories/project/f",
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(false);
		const ok = r as { payload: { lines: string; lineCount: number } };
		expect(ok.payload.lineCount).toBe(3);
		expect(ok.payload.lines).toContain("\talpha");
		expect(ok.payload.lines).toContain("\tbeta");
		// Verify 1-indexed numbering
		expect(ok.payload.lines.split("\n")[0]).toMatch(/\s+1\talpha/);
	});

	test("view_range slices inclusive (1-indexed)", async () => {
		writeFileSync(join(tmp, "f"), "a\nb\nc\nd\ne\n");
		const r = await viewCommand({
			absPath: join(tmp, "f"),
			scope: "project",
			logicalPath: "/memories/project/f",
			viewRange: [2, 4],
			config: DEFAULT_MEMORY_CONFIG,
		});
		const ok = r as { payload: { lines: string; from: number; to: number } };
		expect(ok.payload.from).toBe(2);
		expect(ok.payload.to).toBe(4);
		expect(ok.payload.lines).toContain("\tb");
		expect(ok.payload.lines).toContain("\tc");
		expect(ok.payload.lines).toContain("\td");
		expect(ok.payload.lines).not.toContain("\ta\n");
	});

	test("view_range out of range returns empty (Anthropic semantics)", async () => {
		writeFileSync(join(tmp, "f"), "a\nb\n");
		const r = await viewCommand({
			absPath: join(tmp, "f"),
			scope: "project",
			logicalPath: "/memories/project/f",
			viewRange: [100, 200],
			config: DEFAULT_MEMORY_CONFIG,
		});
		expect(r.isError).toBe(false);
		const ok = r as { payload: { lines: string } };
		expect(ok.payload.lines).toBe("");
	});
});
