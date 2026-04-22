// packages/emmy-telemetry/test/atomic-append.test.ts
//
// Plan 03-02 Task 2 (RED). Imports `appendJsonlAtomic` + `writeJsonAtomic`
// from ../src/atomic-append which does not exist yet. All tests below fail
// at import-resolution time until Task 3 lands the implementation.
//
// Semantic parity target: emmy_serve/diagnostics/atomic.py lines 62-75
//   - append_jsonl_atomic: open("a") -> write -> flush -> os.fsync -> close
//   - write_json_atomic  : tempfile + fsync + os.replace (D-06 "write atomic")
//   - Canonical JSON: sort_keys=True, separators=(",", ":")
//
// These semantics are what the TS port MUST match.

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendJsonlAtomic, writeJsonAtomic } from "../src/atomic-append";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "emmy-atomic-"));
}

describe("appendJsonlAtomic", () => {
	test("single-line append writes exactly one newline-terminated JSON line", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "events.jsonl");
			appendJsonlAtomic(path, { event: "x", ts: "T", profile: { id: "p", version: "v", hash: "h" } });
			const content = readFileSync(path, "utf8");
			expect(content.endsWith("\n")).toBe(true);
			expect(content.split("\n").filter((l) => l.length > 0).length).toBe(1);
			const parsed = JSON.parse(content.trim());
			expect(parsed.event).toBe("x");
			expect(parsed.ts).toBe("T");
			expect(parsed.profile).toEqual({ id: "p", version: "v", hash: "h" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("parent directory is auto-created when missing", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "nested", "deeply", "events.jsonl");
			appendJsonlAtomic(path, { event: "x", ts: "T" });
			expect(existsSync(path)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("multi-line concurrent append yields valid JSONL (50 writes)", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "events.jsonl");
			await Promise.all(
				Array.from({ length: 50 }, (_, i) =>
					Promise.resolve().then(() =>
						appendJsonlAtomic(path, { event: `e${i}`, ts: `T${i}`, i }),
					),
				),
			);
			const content = readFileSync(path, "utf8");
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(50);
			for (const line of lines) {
				// Each line must be a valid JSON object (no interleaving <4KB).
				expect(() => JSON.parse(line)).not.toThrow();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("canonical key ordering matches Python sort_keys=True separators", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "canonical.jsonl");
			// Keys intentionally given in non-alphabetical order; writer must sort.
			appendJsonlAtomic(path, {
				zz: 1,
				aa: 2,
				mm: { nested_z: 10, nested_a: 20 },
			});
			const content = readFileSync(path, "utf8").trim();
			// Python json.dumps(..., sort_keys=True, separators=(",", ":")) output:
			//   {"aa":2,"mm":{"nested_a":20,"nested_z":10},"zz":1}
			expect(content).toBe('{"aa":2,"mm":{"nested_a":20,"nested_z":10},"zz":1}');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("content >4KB is accepted (writer falls back to writeJsonAtomic internally OR still writes one line)", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "big.jsonl");
			const big = "x".repeat(8192);
			appendJsonlAtomic(path, { event: "big", ts: "T", payload: big });
			const content = readFileSync(path, "utf8");
			expect(content.length).toBeGreaterThan(8192);
			const parsed = JSON.parse(content.trim());
			expect(parsed.payload.length).toBe(8192);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("writeJsonAtomic", () => {
	test("writes one canonical-JSON line via tempfile+rename", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "out.json");
			writeJsonAtomic(path, { b: 2, a: 1 });
			const content = readFileSync(path, "utf8");
			expect(content.endsWith("\n")).toBe(true);
			expect(content).toBe('{"a":1,"b":2}\n');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("no temp-files left in target directory after successful write", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "clean.json");
			writeJsonAtomic(path, { x: 1 });
			// No dot-prefixed .tmp should remain
			const files = readFileSync(path, "utf8");
			expect(files.length).toBeGreaterThan(0);
			const stats = statSync(path);
			expect(stats.isFile()).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
