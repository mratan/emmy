// packages/emmy-telemetry/test/feedback-idempotent.test.ts
//
// Plan 03-05 Task 1 (RED). Idempotency contract for rating capture:
// repeated Alt+Up/Down on the same turn UPDATES the existing JSONL row
// (last-writer-wins) rather than appending a duplicate. Implements via
// read-all → mutate → tempfile-rename pattern (atomic rewrite).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	appendFeedback,
	readFeedback,
	updateFeedback,
	upsertFeedback,
	type FeedbackRow,
} from "../src/feedback";
import { FeedbackNotFoundError } from "../src/feedback-schema";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "emmy-feedback-idem-"));
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
		model_response: "ok",
		tool_calls: [],
		latency_ms: 100,
		kv_used: 10,
		tokens_in: 32,
		tokens_out: 4,
		...overrides,
	};
}

describe("updateFeedback", () => {
	test("rewrites the matching row; file still has exactly that many lines", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			appendFeedback(path, sampleRow({ turn_id: "T-1" }));
			appendFeedback(path, sampleRow({ turn_id: "T-42", rating: 1, comment: "" }));
			appendFeedback(path, sampleRow({ turn_id: "T-3" }));

			updateFeedback(path, "T-42", { rating: -1, comment: "bad" });

			const rows = readFeedback(path);
			expect(rows.length).toBe(3);
			const patched = rows.find((r) => r.turn_id === "T-42");
			expect(patched).toBeDefined();
			expect(patched!.rating).toBe(-1);
			expect(patched!.comment).toBe("bad");
			// Adjacent rows untouched:
			expect(rows.find((r) => r.turn_id === "T-1")!.rating).toBe(1);
			expect(rows.find((r) => r.turn_id === "T-3")!.rating).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("unknown turn_id throws FeedbackNotFoundError", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			appendFeedback(path, sampleRow({ turn_id: "T-1" }));
			expect(() => updateFeedback(path, "T-999", { rating: -1 })).toThrow(
				FeedbackNotFoundError,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rewrite is atomic — intermediate tempfile is cleaned up on success", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			appendFeedback(path, sampleRow({ turn_id: "T-1" }));
			updateFeedback(path, "T-1", { comment: "updated" });
			// Hidden .tmp files MUST NOT leak into the telemetry dir.
			const content = readFileSync(path, "utf8");
			expect(content.split("\n").filter((l) => l.length > 0).length).toBe(1);
			const parsed = JSON.parse(content.trim()) as FeedbackRow;
			expect(parsed.comment).toBe("updated");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("upsertFeedback (Alt+Up/Down idempotency)", () => {
	test("first press appends; second press on same turn_id updates", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			upsertFeedback(path, sampleRow({ turn_id: "T-42", rating: 1 }));
			expect(readFeedback(path).length).toBe(1);

			upsertFeedback(path, sampleRow({ turn_id: "T-42", rating: -1, comment: "second" }));
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			expect(rows[0]!.rating).toBe(-1);
			expect(rows[0]!.comment).toBe("second");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("3 up-presses on same turn_id leave exactly 1 row (not 3)", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			upsertFeedback(path, sampleRow({ turn_id: "T-1", rating: 1 }));
			upsertFeedback(path, sampleRow({ turn_id: "T-1", rating: 1 }));
			upsertFeedback(path, sampleRow({ turn_id: "T-1", rating: 1 }));
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("upsert across different turn_ids appends new rows", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			upsertFeedback(path, sampleRow({ turn_id: "T-1" }));
			upsertFeedback(path, sampleRow({ turn_id: "T-2" }));
			upsertFeedback(path, sampleRow({ turn_id: "T-3" }));
			const rows = readFeedback(path);
			expect(rows.length).toBe(3);
			expect(rows.map((r) => r.turn_id).sort()).toEqual(["T-1", "T-2", "T-3"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
