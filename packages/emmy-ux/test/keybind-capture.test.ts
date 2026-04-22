// packages/emmy-ux/test/keybind-capture.test.ts
//
// Plan 03-08 fix-forward. Rating capture via pi.registerShortcut (not the
// Plan 03-05 `pi.on("input", handler)` ANSI intercept — which was based on
// a mis-reading of pi 0.68's API; input-event fires on message submission,
// not on raw keybindings).
//
// handleFeedbackRating(rating, ctx, tracker, path) is the handler body that
// pi.registerShortcut's handler closure invokes — one closure per chord
// (shift+ctrl+up → +1, shift+ctrl+down → -1). Chord selection verified
// against dist/core/keybindings.js defaults (no collision with pi built-ins).

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	EMMY_FEEDBACK_DOWN_KEYID,
	EMMY_FEEDBACK_UP_KEYID,
	handleFeedbackRating,
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

describe("pi KeyId constants (shortcut chords)", () => {
	test("EMMY_FEEDBACK_UP_KEYID is shift+ctrl+up", () => {
		expect(EMMY_FEEDBACK_UP_KEYID).toBe("shift+ctrl+up");
	});
	test("EMMY_FEEDBACK_DOWN_KEYID is shift+ctrl+down", () => {
		expect(EMMY_FEEDBACK_DOWN_KEYID).toBe("shift+ctrl+down");
	});
	test("chords are NOT among pi 0.68 default built-ins", () => {
		// Guard against accidental collision. pi's built-in defaults claim:
		// ctrl+c/d/l/n/o/p/t/v/g/z, alt+up/down/left/right/enter, shift+tab,
		// shift+l, shift+t, shift+ctrl+p, escape, etc. shift+ctrl+up and
		// shift+ctrl+down are deliberately selected because they are UNCLAIMED
		// (collision → runner.js:267 silently skips our shortcut).
		const piBuiltins = new Set([
			"ctrl+c", "ctrl+d", "ctrl+l", "ctrl+n", "ctrl+o", "ctrl+p",
			"ctrl+t", "ctrl+v", "ctrl+g", "ctrl+z", "alt+up", "alt+down",
			"alt+left", "alt+right", "alt+enter", "shift+tab", "shift+l",
			"shift+t", "shift+ctrl+p", "escape",
		]);
		expect(piBuiltins.has(EMMY_FEEDBACK_UP_KEYID)).toBe(false);
		expect(piBuiltins.has(EMMY_FEEDBACK_DOWN_KEYID)).toBe(false);
	});
});

describe("handleFeedbackRating — thumbs-up", () => {
	test("rating=+1 on most-recent completed turn → appendFeedback rating=+1, comment=''", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const ctx = mkCtx();
			const result = await handleFeedbackRating(1, ctx, tracker, path);
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

describe("handleFeedbackRating — thumbs-down", () => {
	test("rating=-1 calls ctx.ui.input() and stores the typed comment", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const inputFn = mock(async () => "compaction mid-stream would be better");
			const ctx = mkCtx({ ui: { input: inputFn } });
			const result = await handleFeedbackRating(-1, ctx, tracker, path);
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

	test("rating=-1 with user cancel (undefined) records empty-string comment (not undefined)", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const inputFn = mock(async () => undefined as string | undefined);
			const ctx = mkCtx({ ui: { input: inputFn } });
			await handleFeedbackRating(-1, ctx, tracker, path);
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			expect(rows[0]!.rating).toBe(-1);
			expect(rows[0]!.comment).toBe(""); // NOT undefined
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rating=-1 with empty-string entry also records empty comment", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const inputFn = mock(async () => "");
			const ctx = mkCtx({ ui: { input: inputFn } });
			await handleFeedbackRating(-1, ctx, tracker, path);
			const rows = readFeedback(path);
			expect(rows[0]!.comment).toBe("");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("handleFeedbackRating — non-action paths", () => {
	test("rating call with NO completed turn in tracker → {action: 'continue'}, no write", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			// Intentionally no recordTurnComplete — user hit the chord before first turn.
			const result = await handleFeedbackRating(1, mkCtx(), tracker, path);
			expect(result).toEqual({ action: "continue" });
			expect(readFeedback(path).length).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("telemetry disabled → rating call returns 'continue' and writes nothing", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			const result = await handleFeedbackRating(
				1,
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

describe("handleFeedbackRating — idempotency (two +1 presses on same turn)", () => {
	test("two +1 calls on same turn produce exactly 1 JSONL row", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			await handleFeedbackRating(1, mkCtx(), tracker, path);
			await handleFeedbackRating(1, mkCtx(), tracker, path);
			const content = readFileSync(path, "utf8");
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("+1 then -1 on same turn → 1 row with the LATEST rating (-1)", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "feedback.jsonl");
			const tracker = new TurnTracker();
			tracker.recordTurnComplete(completedTurn());
			await handleFeedbackRating(1, mkCtx(), tracker, path);
			const ctxDown = mkCtx({
				ui: { input: mock(async () => "changed my mind") },
			});
			await handleFeedbackRating(-1, ctxDown, tracker, path);
			const rows = readFeedback(path);
			expect(rows.length).toBe(1);
			expect(rows[0]!.rating).toBe(-1);
			expect(rows[0]!.comment).toBe("changed my mind");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
