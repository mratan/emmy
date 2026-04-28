// packages/emmy-ux/test/feedback-flow.integration.test.ts
//
// Plan 03-05 Task 1 (RED). Full cycle test:
//   - Register 3 synthetic completed turns via TurnTracker.recordTurnComplete
//   - User presses Alt+Up on the most-recent (3rd) turn
//   - Feedback JSONL gets a row with turn_id matching turn 3
//   - All 13 schema fields populated; tokens + latency carried over from the
//     turn-complete record (proving the tracker → appendFeedback wiring is
//     end-to-end).

import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleFeedbackRating } from "../src/feedback-ui";
import { readFeedback, TurnTracker, type TurnMeta } from "@emmy/telemetry";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "emmy-feedback-flow-"));
}

function turnMeta(session_id: string, turnIndex: number, overrides: Partial<TurnMeta> = {}): TurnMeta {
	return {
		turn_id: `${session_id}:${turnIndex}`,
		session_id,
		profile_id: "gemma-4-26b-a4b-it",
		profile_version: "v2",
		profile_hash:
			"24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b",
		model_response: `turn-${turnIndex} response text`,
		tool_calls: [{ name: "read", args: { path: "x.ts" } }],
		latency_ms: 1000 + turnIndex * 100,
		kv_used: 20 + turnIndex,
		tokens_in: 500 + turnIndex * 50,
		tokens_out: 50 + turnIndex * 10,
		completed_at: new Date().toISOString(),
		...overrides,
	};
}

describe("feedback flow — 3 turns, rate the last one (Alt+Up)", () => {
	test("after 3 turn-complete events, Alt+Up records ONE row against turn 3 with all 13 fields", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();

			// Simulate 3 completed turns (most-recent wins per D-19).
			tracker.recordTurnComplete(turnMeta("S-AA", 0));
			tracker.recordTurnComplete(turnMeta("S-AA", 1));
			tracker.recordTurnComplete(turnMeta("S-AA", 2));

			const ctx = {
				ui: { input: mock(async () => undefined as string | undefined) },
				enabled: true,
			};
			const res = await handleFeedbackRating(1, ctx, tracker, path);
			expect(res).toEqual({ action: "handled" });

			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			const row = rows[0]!;
			// Attribution: most-recent turn (D-19) is S-AA:2
			expect(row.turn_id).toBe("S-AA:2");
			expect(row.session_id).toBe("S-AA");
			expect(row.rating).toBe(1);
			expect(row.comment).toBe("");

			// All 13 TELEM-02 fields populated:
			expect(row.profile_id).toBe("gemma-4-26b-a4b-it");
			expect(row.profile_version).toBe("v2");
			expect(row.profile_hash.length).toBe(64);
			expect(row.model_response).toBe("turn-2 response text");
			expect(row.tool_calls).toEqual([{ name: "read", args: { path: "x.ts" } }]);
			expect(row.latency_ms).toBe(1200);
			expect(row.kv_used).toBe(22);
			expect(row.tokens_in).toBe(600);
			expect(row.tokens_out).toBe(70);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("thumbs-down on turn 2 captures free-text; feedback.jsonl carries turn 2's metadata", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(turnMeta("S-BB", 0));
			tracker.recordTurnComplete(turnMeta("S-BB", 1)); // most recent

			const ctx = {
				ui: { input: mock(async () => "the assistant got the filename wrong") },
				enabled: true,
			};
			await handleFeedbackRating(-1, ctx, tracker, path);
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			expect(rows[0]!.turn_id).toBe("S-BB:1");
			expect(rows[0]!.rating).toBe(-1);
			expect(rows[0]!.comment).toBe("the assistant got the filename wrong");
			expect(rows[0]!.model_response).toBe("turn-1 response text");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
