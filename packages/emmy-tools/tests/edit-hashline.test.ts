import {
	afterEach,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import * as nodeFs from "node:fs";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editHashline } from "../src/edit-hashline";
import {
	HashResolutionError,
	StaleHashError,
	ToolsError,
} from "../src/errors";
import { hash8hex } from "../src/hash";

// Helper: seed a text file and return its path + the hashes of its lines.
function seedLines(dir: string, name: string, lines: string[]): { p: string; h: string[] } {
	const p = join(dir, name);
	writeFileSync(p, lines.join("\n") + "\n", "utf8");
	return { p, h: lines.map((l) => hash8hex(l)) };
}

describe("editHashline (D-05 per-line / D-09 payload shape)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "emmy-edit-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("happy replace — {edits:[{hash, new_content}]} updates that line", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["foo", "bar", "baz"]);
		const r = await editHashline({
			path: p,
			edits: [{ hash: h[1]!, new_content: "BAR" }],
		});
		expect(r.applied.edits).toBe(1);
		expect(r.applied.inserts).toBe(0);
		expect(readFileSync(p, "utf8")).toBe("foo\nBAR\nbaz\n");
		expect(r.diff).toContain("--- a/");
		expect(r.diff).toContain("+++ b/");
	});

	test("happy delete — new_content:null removes the line", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["foo", "bar", "baz"]);
		const r = await editHashline({
			path: p,
			edits: [{ hash: h[1]!, new_content: null }],
		});
		expect(r.applied.edits).toBe(1);
		expect(readFileSync(p, "utf8")).toBe("foo\nbaz\n");
	});

	test("happy insert — {after_hash, insert:[...]} adds lines after the anchor", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["foo", "bar"]);
		const r = await editHashline({
			path: p,
			inserts: [{ after_hash: h[0]!, insert: ["A", "B"] }],
		});
		expect(r.applied.inserts).toBe(2);
		expect(readFileSync(p, "utf8")).toBe("foo\nA\nB\nbar\n");
	});

	test("replace + insert in one call — both applied, diff non-empty", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["foo", "bar", "baz"]);
		const r = await editHashline({
			path: p,
			edits: [{ hash: h[2]!, new_content: "BAZ" }],
			inserts: [{ after_hash: h[0]!, insert: ["NEW"] }],
		});
		expect(r.applied.edits).toBe(1);
		expect(r.applied.inserts).toBe(1);
		expect(readFileSync(p, "utf8")).toBe("foo\nNEW\nbar\nBAZ\n");
		expect(r.diff.length).toBeGreaterThan(0);
	});

	test("stale hash → StaleHashError; file unchanged on disk", async () => {
		const { p } = seedLines(dir, "a.txt", ["foo", "bar"]);
		const before = readFileSync(p, "utf8");
		await expect(
			editHashline({
				path: p,
				edits: [{ hash: "deadbeef", new_content: "X" }],
			}),
		).rejects.toBeInstanceOf(StaleHashError);
		expect(readFileSync(p, "utf8")).toBe(before);
	});

	test("duplicate hash (two identical lines) → HashResolutionError('duplicate'); file unchanged", async () => {
		const { p, h } = seedLines(dir, "dup.txt", ["same", "same", "other"]);
		const before = readFileSync(p, "utf8");
		let err: unknown;
		try {
			await editHashline({
				path: p,
				edits: [{ hash: h[0]!, new_content: "X" }],
			});
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(HashResolutionError);
		expect((err as HashResolutionError).reason).toBe("duplicate");
		expect(readFileSync(p, "utf8")).toBe(before);
	});

	test("multi-line new_content (contains \\n) → ToolsError('edit.new_content_multiline')", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["one", "two"]);
		let err: unknown;
		try {
			await editHashline({
				path: p,
				edits: [{ hash: h[0]!, new_content: "line1\nline2" }],
			});
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ToolsError);
		expect((err as ToolsError).field).toBe("edit.new_content_multiline");
	});

	test("binary file → ToolsError('edit.binary')", async () => {
		const p = join(dir, "bin.dat");
		writeFileSync(p, Buffer.from([0x89, 0x50, 0x00, 0x01]));
		let err: unknown;
		try {
			await editHashline({
				path: p,
				edits: [{ hash: "deadbeef", new_content: "x" }],
			});
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ToolsError);
		expect((err as ToolsError).field).toBe("edit.binary");
	});

	test("empty request on existing file → {0,0}, empty diff, file unchanged", async () => {
		const { p } = seedLines(dir, "a.txt", ["foo", "bar"]);
		const before = readFileSync(p, "utf8");
		const r = await editHashline({ path: p });
		expect(r.applied).toEqual({ edits: 0, inserts: 0 });
		expect(r.diff).toBe("");
		expect(readFileSync(p, "utf8")).toBe(before);
	});

	test("non-existent path + one insert with after_hash:'' → file created", async () => {
		const p = join(dir, "new.txt");
		expect(existsSync(p)).toBe(false);
		const r = await editHashline({
			path: p,
			inserts: [{ after_hash: "", insert: ["hello", "world"] }],
		});
		expect(existsSync(p)).toBe(true);
		expect(readFileSync(p, "utf8")).toBe("hello\nworld\n");
		expect(r.applied.inserts).toBe(2);
		expect(r.diff).toContain("+hello");
		expect(r.diff).toContain("+world");
	});

	test("non-existent path + non-empty edits → ToolsError('edit.new_file')", async () => {
		const p = join(dir, "nope.txt");
		let err: unknown;
		try {
			await editHashline({
				path: p,
				edits: [{ hash: "deadbeef", new_content: "x" }],
			});
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ToolsError);
		expect((err as ToolsError).field).toBe("edit.new_file");
	});

	test("existing file + insert with after_hash:'' → ToolsError('edit.insert_empty_anchor')", async () => {
		const { p } = seedLines(dir, "a.txt", ["foo"]);
		let err: unknown;
		try {
			await editHashline({
				path: p,
				inserts: [{ after_hash: "", insert: ["x"] }],
			});
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ToolsError);
		expect((err as ToolsError).field).toBe("edit.insert_empty_anchor");
	});

	test("atomic-write crash between write and rename — target unchanged, temp cleaned", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["foo", "bar"]);
		const before = readFileSync(p, "utf8");
		const entriesBefore = readdirSync(dir);

		const spy = spyOn(nodeFs, "renameSync").mockImplementationOnce(() => {
			throw new Error("simulated crash between write and rename");
		});
		try {
			await expect(
				editHashline({
					path: p,
					edits: [{ hash: h[0]!, new_content: "NEW" }],
				}),
			).rejects.toThrow(/simulated crash/);
		} finally {
			spy.mockRestore();
		}

		// Target file byte-identical to pre-edit state.
		expect(readFileSync(p, "utf8")).toBe(before);
		// No temp files leaked in the directory.
		const entriesAfter = readdirSync(dir);
		expect(entriesAfter.sort()).toEqual(entriesBefore.sort());
	});

	test("successful edit emits non-empty diff — TOOLS-08 post-hoc visible even in YOLO", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["alpha", "beta", "gamma"]);
		const r = await editHashline({
			path: p,
			edits: [{ hash: h[0]!, new_content: "ALPHA" }],
		});
		expect(r.diff).toContain("--- a/");
		expect(r.diff).toContain("+++ b/");
		expect(r.diff).toMatch(/^-alpha$/m);
		expect(r.diff).toMatch(/^\+ALPHA$/m);
	});

	test("before/after file hashes reflect the change", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["x", "y"]);
		const r = await editHashline({
			path: p,
			edits: [{ hash: h[0]!, new_content: "X" }],
		});
		expect(r.before_hash_file).toMatch(/^[0-9a-f]{8}$/);
		expect(r.after_hash_file).toMatch(/^[0-9a-f]{8}$/);
		expect(r.before_hash_file).not.toBe(r.after_hash_file);
	});

	test("edit that produces identical content → empty diff (idempotent no-op)", async () => {
		const { p, h } = seedLines(dir, "a.txt", ["foo", "bar"]);
		const r = await editHashline({
			path: p,
			edits: [{ hash: h[0]!, new_content: "foo" }],
		});
		expect(r.diff).toBe("");
		expect(r.before_hash_file).toBe(r.after_hash_file);
	});
});
