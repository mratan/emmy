// packages/emmy-ux/src/feedback-ui.ts
//
// Plan 03-08 fix-forward — replaces the Plan 03-05 D-18 strategy
// (which incorrectly assumed `pi.on("input", handler)` intercepts keybinds)
// with pi 0.68's authoritative extension-shortcut API.
//
// Pi 0.68's `pi.on("input", handler)` is a message-SUBMISSION event — the
// payload `{text, images, source}` carries the typed message, NOT raw
// ANSI keystrokes. Verified in agent-session.js:689-700 (_extensionRunner
// .emitInput is called only when the user submits a prompt).
//
// Pi 0.68 exposes the correct API at types.d.ts:780:
//   pi.registerShortcut(shortcut: KeyId, { handler: (ctx) => ... })
//
// pi's default built-ins already claim ctrl+c, ctrl+d, ctrl+l, ctrl+o,
// ctrl+n, ctrl+p, ctrl+t, ctrl+v, ctrl+g, ctrl+z, alt+up, alt+down,
// alt+enter, alt+left/right, shift+tab, shift+l, shift+t, shift+ctrl+p,
// escape. `shift+ctrl+up` and `shift+ctrl+down` are unclaimed — emmy uses
// them for thumbs-up/down. (Alt+Up was the original plan but is taken by
// app.message.dequeue; colliding extension shortcuts are silently skipped
// per dist/core/extensions/runner.js:267.)
//
// Flow (D-19 "most-recent completed turn"):
//   1. Telemetry enabled? No → emmy's shortcut handlers aren't registered
//      at all (pi-emmy-extension.ts gates registration on telemetryEnabled);
//      kill-switch (EMMY_TELEMETRY=off) cannot hand the chord to emmy.
//   2. Tracker has a completed turn? No → silently return (user hit the
//      chord before the first turn completed). Pi's chord is unclaimed,
//      so nothing fires.
//   3. Thumbs-down → ctx.ui.input("Thumbs-down — why?", ...). undefined
//      and empty string both record `comment = ""` (plan truth #5).
//   4. upsertFeedback — idempotent on turn_id (plan truth #7).
//
// T-03-05-05 (info disclosure): `comment` stays in JSONL only; the
// "feedback.recorded" emitEvent span-trail sends session_id / turn_id /
// rating only. This module does NOT emit into span attrs directly —
// Plan 03-02's dual-sink emitEvent owns that.

import {
	defaultFeedbackPath,
	emitEvent,
	upsertFeedback,
	type FeedbackRow,
	type TurnTracker,
} from "@emmy/telemetry";

/** pi 0.68 KeyId for thumbs-up (unclaimed by default built-ins). */
export const EMMY_FEEDBACK_UP_KEYID = "shift+ctrl+up";
/** pi 0.68 KeyId for thumbs-down (unclaimed by default built-ins). */
export const EMMY_FEEDBACK_DOWN_KEYID = "shift+ctrl+down";

export interface FeedbackUiContext {
	ui: {
		input: (
			prompt: string,
			placeholder?: string,
		) => Promise<string | undefined>;
	};
	/** Mirrors @emmy/telemetry's resolveTelemetryEnabled(). When false, emmy's
	 *  shortcut handlers are never registered with pi in the first place,
	 *  so this flag is a defense-in-depth guard for handler-direct callers. */
	enabled: boolean;
}

/**
 * Rating handler body. Called directly by pi.registerShortcut's handler
 * closure (one closure per chord: up → +1, down → -1). Returns void because
 * pi.registerShortcut handlers don't signal "handled/continue" — pi always
 * treats extension-shortcut invocations as handled.
 *
 * Also callable directly (tests + programmatic probes) with an explicit
 * rating; the ANSI-event shape from the Plan 03-05 API is gone.
 */
export async function handleFeedbackRating(
	rating: 1 | -1,
	ctx: FeedbackUiContext,
	tracker: TurnTracker,
	feedbackPath: string = defaultFeedbackPath(),
): Promise<{ action: "handled" | "continue" }> {
	// EMMY_TELEMETRY=off kill-switch (plan truth #9). Defense-in-depth —
	// the registration-time gate is primary.
	if (!ctx.enabled) return { action: "continue" };

	const latest = tracker.getLatest();
	if (!latest) {
		// No completed turn to rate — user hit the chord before first turn.
		return { action: "continue" };
	}

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
