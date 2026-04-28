// packages/emmy-telemetry/test/feedback-append.test.ts
//
// Plan 03-05 Task 1 (RED). Imports from ../src/feedback-schema + ../src/feedback
// which do not yet exist. All tests below fail at import-resolution time
// until Task 2 GREEN lands.
//
// Targets: TELEM-02 13-field schema verbatim + atomic-append semantics ported
// from Plan 03-02's appendJsonlAtomic / writeJsonAtomic (> PIPE_BUF fallback).
// Canonical key ordering matches canonicalStringify in atomic-append.ts so row
// hashes are deterministic across runs.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	appendFeedback,
	defaultFeedbackPath,
	readFeedback,
	type FeedbackRow,
} from "../src/feedback";
import { FeedbackSchemaError } from "../src/feedback-schema";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "emmy-feedback-"));
}

function sampleRow(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
	return {
		session_id: "S-1",
		turn_id: "T-1",
		profile_id: "gemma-4-26b-a4b-it",
		profile_version: "v2",
		profile_hash:
			"24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b",
		rating: 1,
		comment: "",
		model_response: "Here is the result",
		tool_calls: [],
		latency_ms: 1200,
		kv_used: 34,
		tokens_in: 2048,
		tokens_out: 128,
		...overrides,
	};
}

describe("defaultFeedbackPath", () => {
	test("resolves to ~/.emmy/telemetry/feedback.jsonl (TELEM-02 verbatim)", () => {
		// Path resolution doesn't need mocking — the value must contain the
		// TELEM-02 canonical segment regardless of the host user's homedir.
		const p = defaultFeedbackPath();
		expect(p).toContain(".emmy/telemetry/feedback.jsonl");
	});
});

describe("appendFeedback", () => {
	test("writes one JSON line with all 13 TELEM-02 fields", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			appendFeedback(path, sampleRow());
			const content = readFileSync(path, "utf8");
			expect(content.endsWith("\n")).toBe(true);
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(1);
			const parsed = JSON.parse(lines[0]!) as FeedbackRow;
			// All 13 fields present (TELEM-02 schema):
			for (const k of [
				"session_id",
				"turn_id",
				"profile_id",
				"profile_version",
				"profile_hash",
				"rating",
				"comment",
				"model_response",
				"tool_calls",
				"latency_ms",
				"kv_used",
				"tokens_in",
				"tokens_out",
			]) {
				expect(parsed).toHaveProperty(k);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("auto-creates parent dir when missing", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "nested", "telemetry", "feedback.jsonl");
			appendFeedback(path, sampleRow());
			expect(readFileSync(path, "utf8").length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("missing required field throws FeedbackSchemaError with the field name", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			// Omit session_id — clone-and-delete to preserve the rest of the shape.
			const row = sampleRow();
			delete (row as Partial<FeedbackRow>).session_id;
			expect(() => appendFeedback(path, row as FeedbackRow)).toThrow(
				FeedbackSchemaError,
			);
			try {
				appendFeedback(path, row as FeedbackRow);
			} catch (e) {
				if (e instanceof FeedbackSchemaError) {
					expect(e.missing).toBe("session_id");
					expect(e.message).toContain("session_id");
				} else {
					throw e;
				}
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("invalid rating (not +1 / -1) throws FeedbackSchemaError", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const row = sampleRow({ rating: 0 as unknown as 1 });
			expect(() => appendFeedback(path, row)).toThrow(FeedbackSchemaError);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("row with model_response > 4KB uses tempfile+rename atomic path", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const bigText = "x".repeat(5000); // > PIPE_BUF (4096)
			const row = sampleRow({
				turn_id: "T-BIG",
				model_response: bigText,
			});
			appendFeedback(path, row);
			const content = readFileSync(path, "utf8");
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(1);
			const parsed = JSON.parse(lines[0]!) as FeedbackRow;
			expect(parsed.model_response.length).toBe(5000);
			expect(parsed.turn_id).toBe("T-BIG");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("three successive appends produce three distinct lines", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			appendFeedback(path, sampleRow({ turn_id: "T-1" }));
			appendFeedback(path, sampleRow({ turn_id: "T-2" }));
			appendFeedback(path, sampleRow({ turn_id: "T-3" }));
			const rows = readFeedback(path);
			expect(rows.length).toBe(3);
			expect(rows.map((r) => r.turn_id)).toEqual(["T-1", "T-2", "T-3"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("readFeedback", () => {
	test("returns empty array when file does not exist", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "missing.jsonl");
			expect(readFeedback(path)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("parses all valid JSONL lines in order", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			for (let i = 0; i < 5; i++) {
				appendFeedback(path, sampleRow({ turn_id: `T-${i}` }));
			}
			const rows = readFeedback(path);
			expect(rows.length).toBe(5);
			expect(rows[0]!.turn_id).toBe("T-0");
			expect(rows[4]!.turn_id).toBe("T-4");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
