// packages/emmy-ux/src/feedback-ui.ts
//
// Plan 03-05 Task 2 (GREEN) — Alt+Up / Alt+Down rating capture body.
//
// D-18 (plan frontmatter must_haves.truths #1): pi 0.68 binds alt+up to
// `app.message.dequeue`. Emmy intercepts BEFORE pi's keybind resolution
// via `pi.on("input", handler)` — when the handler returns
// `{action: "handled"}`, pi does NOT route the keypress to its built-in
// keybinding table. RESEARCH Pattern 4 / §Ex 4.
//
// ANSI sequences (RESEARCH §Common Pitfalls #1):
//   \x1b[1;3A — alt+up   (thumbs-up; rating = +1; empty comment)
//   \x1b[1;3B — alt+down (thumbs-down; rating = -1; free-text prompt)
//
// Flow (D-19 "most-recent completed turn"):
//   1. Telemetry enabled? No → {action: "continue"}; never write.
//   2. event.text one of the two ANSI sequences? No → {action: "continue"}.
//   3. Tracker has a completed turn? No → {action: "continue"} (user hit
//      Alt+Up before the first turn completed).
//   4. Thumbs-down → ctx.ui.input("Thumbs-down — why?", ...). undefined and
//      empty string both record `comment = ""` (plan truth #5).
//   5. upsertFeedback — idempotent on turn_id (plan truth #7).
//   6. Return {action: "handled"} so pi's default keybind doesn't fire.
//
// T-03-05-05 (info disclosure): `comment` stays in JSONL only; emitEvent
// for "feedback.recorded" (fired inside upsertFeedback? no — here so the
// span attributes are under our control) sends session_id/turn_id/rating
// only. This module does NOT emit into span attrs directly — Plan 03-02
// already emits via @emmy/telemetry's dual-sink when we call emitEvent.

import {
	defaultFeedbackPath,
	emitEvent,
	upsertFeedback,
	type FeedbackRow,
	type TurnTracker,
} from "@emmy/telemetry";

/** ANSI for Alt+Up (thumbs-up). */
export const ANSI_ALT_UP = "\x1b[1;3A";
/** ANSI for Alt+Down (thumbs-down). */
export const ANSI_ALT_DOWN = "\x1b[1;3B";

export interface FeedbackUiContext {
	ui: {
		input: (
			prompt: string,
			placeholder?: string,
		) => Promise<string | undefined>;
	};
	/** Mirrors @emmy/telemetry's resolveTelemetryEnabled(). When false, the
	 *  handler silently returns "continue" so pi proceeds with the keypress
	 *  as if emmy weren't listening. */
	enabled: boolean;
}

/**
 * Input-event body for Alt+Up/Down rating capture. Returns `{action: "handled"}`
 * iff the keypress matched and a rating was successfully recorded.
 */
export async function handleFeedbackKey(
	event: { text: string },
	ctx: FeedbackUiContext,
	tracker: TurnTracker,
	feedbackPath: string = defaultFeedbackPath(),
): Promise<{ action: "handled" | "continue" }> {
	// EMMY_TELEMETRY=off kill-switch (plan truth #9).
	if (!ctx.enabled) return { action: "continue" };

	// Only intercept exact ANSI sequences. Any other keypress — printable,
	// arrow without modifier, Alt+Left/Right — passes through.
	const text = event.text;
	if (text !== ANSI_ALT_UP && text !== ANSI_ALT_DOWN) {
		return { action: "continue" };
	}

	const latest = tracker.getLatest();
	if (!latest) {
		// No completed turn to rate — user hit Alt+Up before first turn.
		// Returning "continue" here lets pi handle the keypress (it'll noop
		// since app.message.dequeue has nothing to dequeue either).
		return { action: "continue" };
	}

	const rating: 1 | -1 = text === ANSI_ALT_UP ? 1 : -1;

	let comment = "";
	if (rating === -1) {
		// Thumbs-down opens pi's modal input dialog. undefined = user
		// pressed Escape / cancelled; we store "" rather than undefined so
		// FeedbackRow.comment satisfies the validateRow non-null contract.
		const typed = await ctx.ui.input(
			"Thumbs-down — why?",
			"optional free-text (Enter to skip)",
		);
		comment = typed ?? "";
	}

	const row: FeedbackRow = {
		session_id: latest.session_id,
		turn_id: latest.turn_id,
		profile_id: latest.profile_id,
		profile_version: latest.profile_version,
		profile_hash: latest.profile_hash,
		rating,
		comment,
		model_response: latest.model_response,
		tool_calls: latest.tool_calls,
		latency_ms: latest.latency_ms,
		kv_used: latest.kv_used,
		tokens_in: latest.tokens_in,
		tokens_out: latest.tokens_out,
	};
	upsertFeedback(feedbackPath, row);

	// Telemetry trail for Langfuse span correlation (T-03-05-07).
	// Deliberately does NOT include `comment` — free-text stays in JSONL only
	// (T-03-05-05 info disclosure mitigation).
	emitEvent({
		event: "feedback.recorded",
		ts: new Date().toISOString(),
		profile: {
			id: latest.profile_id,
			version: latest.profile_version,
			hash: latest.profile_hash,
		},
		session_id: latest.session_id,
		turn_id: latest.turn_id,
		rating,
	});

	return { action: "handled" };
}
