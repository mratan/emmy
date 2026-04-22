// packages/emmy-ux/test/keybind-capture.test.ts
//
// Plan 03-05 Task 1 (RED). Alt+Up / Alt+Down ANSI sequences + tracker wiring.
//
// pi 0.68 types.d.ts (VERIFIED 2026-04-21 line 534-552):
//   interface InputEvent { type: "input"; text: string; source: InputSource }
//   type InputEventResult = { action: "continue" } | { action: "transform", ... } | { action: "handled" }
//
// Common Pitfalls #1 (RESEARCH): pi 0.68 binds alt+up/down to app.message.dequeue.
// Emmy intercepts BEFORE pi's keybind resolution by returning {action: "handled"}.
// ANSI sequences:
//   \x1b[1;3A = alt+up  (thumbs-up, rating = +1, empty comment)
//   \x1b[1;3B = alt+down (thumbs-down, rating = -1, open free-text prompt)

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ANSI_ALT_DOWN,
	ANSI_ALT_UP,
	handleFeedbackKey,
	type FeedbackUiContext,
} from "../src/feedback-ui";
import type { FeedbackRow } from "@emmy/telemetry";
import { readFeedback, TurnTracker } from "@emmy/telemetry";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "emmy-keybind-"));
}

function completedTurn() {
	return {
		turn_id: "S-1:0",
		session_id: "S-1",
		profile_id: "qwen3.6-35b-a3b",
		profile_version: "v2",
		profile_hash:
			"24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b",
		model_response: "Here is the result",
		tool_calls: [],
		latency_ms: 1200,
		kv_used: 34,
		tokens_in: 2048,
		tokens_out: 128,
		completed_at: new Date().toISOString(),
	};
}

function mkCtx(overrides: Partial<FeedbackUiContext> = {}): FeedbackUiContext {
	return {
		ui: {
			input: mock(async () => undefined as string | undefined),
		},
		enabled: true,
		...overrides,
	};
}

describe("ANSI literal constants", () => {
	test("ANSI_ALT_UP is the verbatim ESC-[1;3A sequence", () => {
		expect(ANSI_ALT_UP).toBe("\x1b[1;3A");
	});
	test("ANSI_ALT_DOWN is the verbatim ESC-[1;3B sequence", () => {
		expect(ANSI_ALT_DOWN).toBe("\x1b[1;3B");
	});
});

describe("handleFeedbackKey — thumbs-up", () => {
	test("Alt+Up on most-recent completed turn → appendFeedback rating=+1, comment=''", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const ctx = mkCtx();
			const result = await handleFeedbackKey(
				{ text: ANSI_ALT_UP },
				ctx,
				tracker,
				path,
			);
			expect(result).toEqual({ action: "handled" });
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			const row = rows[0]! as FeedbackRow;
			expect(row.rating).toBe(1);
			expect(row.comment).toBe("");
			expect(row.turn_id).toBe("S-1:0");
			expect(row.model_response).toBe("Here is the result");
			// input() must NOT be called on thumbs-up
			expect((ctx.ui.input as ReturnType<typeof mock>).mock.calls.length).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("handleFeedbackKey — thumbs-down", () => {
	test("Alt+Down calls ctx.ui.input() and stores the typed comment", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const inputFn = mock(async () => "compaction mid-stream would be better");
			const ctx = mkCtx({ ui: { input: inputFn } });
			const result = await handleFeedbackKey(
				{ text: ANSI_ALT_DOWN },
				ctx,
				tracker,
				path,
			);
			expect(result).toEqual({ action: "handled" });
			expect(inputFn.mock.calls.length).toBe(1);
			// Prompt string must mention thumbs-down or "why"
			expect(String(inputFn.mock.calls[0]![0])).toMatch(/thumbs-down|why/i);
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			expect(rows[0]!.rating).toBe(-1);
			expect(rows[0]!.comment).toBe("compaction mid-stream would be better");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("Alt+Down with user cancel (undefined) records empty-string comment (not undefined)", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const inputFn = mock(async () => undefined as string | undefined);
			const ctx = mkCtx({ ui: { input: inputFn } });
			await handleFeedbackKey({ text: ANSI_ALT_DOWN }, ctx, tracker, path);
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			expect(rows[0]!.rating).toBe(-1);
			expect(rows[0]!.comment).toBe(""); // NOT undefined
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("Alt+Down with empty-string entry also records empty comment", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const inputFn = mock(async () => "");
			const ctx = mkCtx({ ui: { input: inputFn } });
			await handleFeedbackKey({ text: ANSI_ALT_DOWN }, ctx, tracker, path);
			const rows = readFeedback(path);
			expect(rows[0]!.comment).toBe("");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("handleFeedbackKey — non-action paths", () => {
	test("arbitrary keypress 'a' returns {action: 'continue'} and writes nothing", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const result = await handleFeedbackKey(
				{ text: "a" },
				mkCtx(),
				tracker,
				path,
			);
			expect(result).toEqual({ action: "continue" });
			expect(readFeedback(path).length).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("Alt+Up with NO completed turn in tracker → {action: 'continue'}, no write", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			// Intentionally no recordTurnComplete — user hit Alt+Up before first turn.
			const result = await handleFeedbackKey(
				{ text: ANSI_ALT_UP },
				mkCtx(),
				tracker,
				path,
			);
			expect(result).toEqual({ action: "continue" });
			expect(readFeedback(path).length).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("telemetry disabled → Alt+Up returns 'continue' and writes nothing", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const result = await handleFeedbackKey(
				{ text: ANSI_ALT_UP },
				mkCtx({ enabled: false }),
				tracker,
				path,
			);
			expect(result).toEqual({ action: "continue" });
			expect(readFeedback(path).length).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("handleFeedbackKey — idempotency (Alt+Up twice on same turn)", () => {
	test("two Alt+Up presses on same turn produce exactly 1 JSONL row", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			await handleFeedbackKey({ text: ANSI_ALT_UP }, mkCtx(), tracker, path);
			await handleFeedbackKey({ text: ANSI_ALT_UP }, mkCtx(), tracker, path);
			const content = readFileSync(path, "utf8");
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("Alt+Up then Alt+Down on same turn → 1 row with the LATEST rating (-1)", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			await handleFeedbackKey({ text: ANSI_ALT_UP }, mkCtx(), tracker, path);
			const ctxDown = mkCtx({
				ui: { input: mock(async () => "changed my mind") },
			});
			await handleFeedbackKey({ text: ANSI_ALT_DOWN }, ctxDown, tracker, path);
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			expect(rows[0]!.rating).toBe(-1);
			expect(rows[0]!.comment).toBe("changed my mind");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
