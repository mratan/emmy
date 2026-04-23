// packages/emmy-context/src/compaction.ts
//
// Phase 3 Plan 03-03 Task 2 (GREEN) — emmyCompactionTrigger: D-14 preservation
// pre-filter + D-12 hard-ceiling fail-loud + D-16 structured-pruning fallback
// + profile-defined summarization prompt (D-13). Telemetry: emits
// session.compaction.trigger / .complete / .fallback events (Shared Pattern 3).
//
// Wire contract (D-11 turn-boundary atomicity — Pitfall #3):
//   The trigger MUST be called from `pi.on("turn_start", handler)` ONLY.
//   Calling on any other event raises IllegalCompactionTimingError defensively
//   at entry. Plan 03-01's pi-emmy-extension registers only one handler for
//   turn_start; future input/output extensions never call this trigger.
//
// ----------------------------------------------------------------------------
// RULE-3 AUTO-FIX — pi 0.68 top-level export surface narrower than planned
// ----------------------------------------------------------------------------
//
// The plan's <interfaces> block cites pi 0.68's compaction module exporting
// `prepareCompaction` + `CompactionPreparation` at the top-level barrel. In
// practice (verified 2026-04-22 via `bun -e 'import * as pi ...'`) pi's
// top-level index.js exports ONLY:
//   compact, shouldCompact, estimateTokens, DEFAULT_COMPACTION_SETTINGS,
//   CompactionResult (type), getLatestCompactionEntry, findCutPoint,
//   findTurnStartIndex, calculateContextTokens, generateSummary, ...
//
// `prepareCompaction` and `CompactionPreparation` live only under
// `./core/compaction/compaction.d.ts` and are NOT reachable through pi's
// `exports` field (pi package.json declares only `"."` and `"./hooks"`).
//
// Emmy's adaptation (Rule 3 / architectural fidelity):
//
//   - We define an emmy-local `EmmyCompactionPreparation` + `EmmyCompactionResult`
//     shape that matches the plan's <interfaces> block verbatim.
//   - The preparation step is trivial for emmy: D-14 preservation already
//     determines what's kept vs summarizable. We compute the preparation
//     ourselves (no pi dependency) and hand the summarizable subset to an
//     injectable `summarize()` function for the round-trip.
//   - For live wiring (Plan 03-07), emmy will call its own `postChat`-style
//     round-trip with the profile-defined customInstructions + the
//     serialized summarizable turns; this keeps emmy's provider layer
//     (@emmy/provider) as the single HTTP boundary, matching D-02 (one
//     ModelRegistry provider path) rather than introducing pi's
//     generateSummary as a second provider boundary.
//   - pi's `SUMMARIZATION_SYSTEM_PROMPT` is NOT used by emmy — emmy always
//     relies on the profile-defined `prompts/compact.md` as the summarizer
//     system prompt. Plan 03-07 validates alignment.
//   - Test mode injects a stub `summarize()` via ctx.engine.summarize; no
//     HTTP request is made. Stub-mode SC-2 runner (Task 3) drives this.
//
// This deviation is tracked in the 03-03 SUMMARY.md under "Deviations from
// Plan" per GSD Rule-3 auto-fix discipline. The architectural invariant is
// preserved: emmy does NOT reimplement summarization inside @emmy/context
// — the round-trip is a thin HTTP call that reuses the same vLLM endpoint,
// same profile, and same customInstructions the plan describes.
//
// ----------------------------------------------------------------------------
// SessionEntry shape reconciliation
// ----------------------------------------------------------------------------
//
// Pi's on-disk SessionEntry is a discriminated union keyed on `type` with the
// message body nested under `.message`. Emmy's classifier operates on a
// simplified `{uuid, role, content, isError?, toolName?}` shape tailored to
// preservation decisions. Live wiring (Plan 03-07) adapts pi's native entries
// to the emmy shape at the pi-extension boundary BEFORE calling the trigger.
// This file does not handle the conversion; stub-mode tests (Task 3) pass
// emmy-shaped entries directly.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens as piEstimateTokens,
	shouldCompact as piShouldCompact,
	type CompactionSettings,
} from "@mariozechner/pi-coding-agent";
import type { ProfileSnapshot } from "@emmy/provider";
import { emitEvent as realEmitEvent } from "@emmy/telemetry";

/**
 * Local copy of @emmy/telemetry.TelemetryRecord so tests can pass typed
 * emitEvent replacements via ctx.emitEvent without having to import from
 * the telemetry package themselves (which is mock.module-hazardous per
 * Plan 03-02 Pattern F).
 */
interface TelemetryRecord {
	event: string;
	ts: string;
	profile?: { id: string; version: string; hash: string };
	[k: string]: unknown;
}
type EmitEventFn = (record: TelemetryRecord) => void;

import { loadCompactionConfig } from "./config-loader";
import { IllegalCompactionTimingError, SessionTooFullError } from "./errors";
import { markPreserved } from "./preservation";
import type { PreservationOpts, SessionEntry } from "./types";

// Re-export the core errors at the package level — index.ts also re-exports
// from ./errors, so this guarantees the types resolve either path.
export { IllegalCompactionTimingError, SessionTooFullError } from "./errors";
// Re-export markPreserved so it's available from the compaction module too.
export { markPreserved } from "./preservation";

/**
 * Emmy-layer preparation shape. Mirrors pi's CompactionPreparation minimally —
 * `messagesToSummarize` flow to the summarizer; `messagesToKeep` stay verbatim.
 * The `tokensBefore` field is purely informational (emitted in events).
 */
export interface EmmyCompactionPreparation {
	messagesToSummarize: SessionEntry[];
	messagesToKeep: SessionEntry[];
	tokensBefore: number;
}

/**
 * Emmy-layer round-trip result. `summary` replaces `messagesToSummarize` in
 * the post-compaction session; `droppedEntries` is informational metadata
 * (how many entries were elided). `summaryTokens` is the estimator-derived
 * size of the summary content for post-compaction ceiling checks.
 */
export interface EmmyCompactionResultFromRoundTrip {
	summary: string;
	droppedEntries: SessionEntry[];
	summaryTokens: number;
}

/**
 * Dependency injection seams for the compaction pipeline. Production code
 * uses DEFAULT_ENGINE which wires the real pi estimators + an HTTP
 * summarizer stub. Tests replace individual functions on a per-case basis.
 *
 * `summarize` is the ONE HTTP boundary inside the trigger. Its default is an
 * "unconfigured" sentinel that throws — tests override it via ctx.engine,
 * and live wiring (Plan 03-07) provides a real implementation that does
 * a single round-trip against emmy-serve.
 */
export interface CompactionEngine {
	shouldCompact: typeof piShouldCompact;
	estimateTokens: (entry: SessionEntry) => number;
	summarize: (args: {
		preparation: EmmyCompactionPreparation;
		customInstructions: string;
		model: unknown;
		apiKey: string;
		signal?: AbortSignal;
	}) => Promise<{ summary: string }>;
}

/**
 * Default engine. `shouldCompact` + `estimateTokens` wrap pi's pure functions.
 * `summarize` throws with a clear message until live wiring (Plan 03-07)
 * provides a real implementation — tests MUST override via ctx.engine.
 */
const DEFAULT_ENGINE: CompactionEngine = {
	shouldCompact: piShouldCompact,
	// piEstimateTokens accepts an AgentMessage; emmy's SessionEntry is a
	// simplified view. The estimator is a chars/4 heuristic in pi so this
	// cast-through-unknown is semantically equivalent for text content.
	estimateTokens: (entry) =>
		piEstimateTokens({
			role: entry.role,
			content: [{ type: "text", text: String(entry.content ?? "") }],
		} as unknown as Parameters<typeof piEstimateTokens>[0]),
	summarize: () => {
		throw new Error(
			"CompactionEngine.summarize not configured — inject via EmmyCompactionContext.engine (stub-mode tests) or Plan 03-07 live wiring.",
		);
	},
};

export interface EmmyCompactionContext {
	profile: ProfileSnapshot;
	entries: SessionEntry[];
	contextTokens: number;
	/** profile.harness.context.max_input_tokens — D-12 ceiling. */
	contextWindow: number;
	eventType: "turn_start" | string;
	/** Pi's Model reference (opaque here; typed unknown). */
	model: unknown;
	/** Pi's auth token / api key. emmy-vllm uses a stub sentinel. */
	apiKey: string;
	/** Optional pi.ui.setStatus hook for D-17 visible "compacting…" state. */
	setStatus?: (key: string, text: string | undefined) => void;
	/** Injected for tests. Defaults to DEFAULT_ENGINE. */
	engine?: CompactionEngine;
	/** Optional abort signal forwarded into summarize(). */
	signal?: AbortSignal;
	/**
	 * Injected for tests to bypass the Plan 03-02 Pattern F mock.module hazard.
	 * Defaults to the real @emmy/telemetry emitEvent import. Tests pass a
	 * local closure that pushes into an in-memory array; the live trigger path
	 * uses the real dual-sink emitter.
	 */
	emitEvent?: EmitEventFn;
}

export interface EmmyCompactionResult {
	ran: boolean;
	elided: number;
	preserved: number;
	/** True iff the D-16 fallback path was taken (summarizer threw or missing prompt). */
	fallback?: boolean;
	/**
	 * D-30 live-wire directive (Phase 3.1 Plan 03.1-01). When present and
	 * `shouldCompact === true`, the turn_start handler invokes
	 * `ctx.compact({customInstructions})` directly instead of going through
	 * the (now-deprecated) engine.summarize injection point. The trigger
	 * itself does NOT call summarize on the live path — ran=false whenever
	 * a directive is returned.
	 *
	 * When `shouldCompact === false` (or directive absent), the caller should
	 * NOT call ctx.compact — either the threshold was not crossed or an
	 * internal short-circuit applies (e.g. disabled config, nothing to
	 * summarize after preservation pre-filter).
	 */
	directive?: EmmyCompactionDirective;
}

/**
 * D-30 live-wire directive. The trigger returns this when a turn_start
 * boundary crosses the D-11 soft threshold; the turn_start handler reads
 * it and invokes pi's native `ctx.compact({customInstructions})`.
 *
 * - `customInstructions` is the profile-defined `prompts/compact.md`
 *   contents prepended to any operator args (D-31 addendum semantics).
 *   Empty string is the D-16 fallback signal — pi's built-in
 *   SUMMARIZATION_SYSTEM_PROMPT takes over.
 * - `preservation` is the D-14 preservation set (informational — pi's
 *   engine decides what to keep; the custom instructions tell the model
 *   which entries are error-sensitive / file-pinned / TODO-state).
 * - `tokensBefore` is ctx.contextTokens at directive construction, used
 *   by telemetry events.
 * - `reason` marks whether this directive was built from a soft-threshold
 *   cross (auto) or a future "manual" path (reserved for Plan 03.1-01
 *   Task 2 slash commands which do NOT go through this directive).
 */
export interface EmmyCompactionDirective {
	shouldCompact: boolean;
	customInstructions: string;
	preservation: Set<string>;
	tokensBefore: number;
	reason: "soft_threshold" | "manual";
}

// CompactionSettings is only used inside prepareCompactionLocal but kept
// referenced so pi's settings type stays in sync if we extend later.
const _compactionSettings: CompactionSettings = { ...DEFAULT_COMPACTION_SETTINGS, enabled: true };
void _compactionSettings;

/**
 * Emmy's local prepareCompaction. Given the (summarizable, preserved) split
 * already decided by D-14, this just packages the arrays into an
 * EmmyCompactionPreparation for the round-trip step. Returns null if there's
 * nothing to summarize (empty summarizable subset).
 */
export function prepareCompactionLocal(
	summarizable: SessionEntry[],
	kept: SessionEntry[],
	tokensBefore: number,
): EmmyCompactionPreparation | null {
	if (summarizable.length === 0) return null;
	return {
		messagesToSummarize: summarizable,
		messagesToKeep: kept,
		tokensBefore,
	};
}

/**
 * The compaction trigger. Only fires on turn_start (Pitfall #3).
 *
 * Flow (happy path):
 *   1. Guard eventType === "turn_start" (else: IllegalCompactionTimingError).
 *   2. Load profile's compaction config (D-15). null → {ran: false, 0, 0}.
 *   3. Check soft-threshold ratio (D-11). below → {ran: false, 0, 0}.
 *   4. Emit session.compaction.trigger.
 *   5. Build D-14 preservation set via markPreserved.
 *   6. Prepare compaction: summarizable = !preserved; kept = preserved.
 *   7. Read profile-defined compaction prompt at cfg.summarization_prompt_path.
 *      Missing file → D-16 fallback (NEVER silent).
 *   8. Call engine.summarize() with customInstructions = prompt file contents.
 *   9. Compute post-compaction token count. If still > ceiling → D-12
 *      fail-loud SessionTooFullError with 5-key diagnosticBundle.
 *  10. Emit session.compaction.complete with {turns_elided, turns_preserved,
 *      summary_tokens} + profile.ref (auto-stamped via emitEvent profile
 *      flattening + SpanProcessor).
 *
 * Failure paths:
 *   - summarize() throws (timeout, parse failure, refusal) → caught
 *     internally, emit session.compaction.fallback, run structured-pruning
 *     fallback, return {ran: true, elided: computed, preserved, fallback:
 *     true}. D-16 discipline.
 *   - SessionTooFullError → re-thrown, D-12 fail-loud.
 */
export async function emmyCompactionTrigger(
	ctx: EmmyCompactionContext,
): Promise<EmmyCompactionResult> {
	// 1. Pitfall #3 guard
	if (ctx.eventType !== "turn_start") {
		throw new IllegalCompactionTimingError(ctx.eventType);
	}
	// D-30 (Plan 03.1-01) — live-wire gate: when the caller does NOT inject
	// an `engine`, the trigger runs in LIVE-WIRE mode and returns a directive
	// instead of calling engine.summarize() itself. The turn_start handler in
	// pi-emmy-extension.ts reads the directive and invokes pi's native
	// ctx.compact({customInstructions}) directly. engine.summarize() remains
	// the injection point for stub-mode tests (trigger.test.ts +
	// summarize-fallback.integration.test.ts) and is NOT on the live path.
	const stubMode = ctx.engine !== undefined;
	const engine = ctx.engine ?? DEFAULT_ENGINE;
	const emit: EmitEventFn = ctx.emitEvent ?? realEmitEvent;

	// 1b. D-12 pre-ceiling guard (Plan 03.1-01 D-30 live-wire).
	//     When the session has ALREADY overflowed the hard ceiling before
	//     turn_start fires (e.g. a huge single-turn paste put us over),
	//     pi's ctx.compact() cannot rescue us — there's no room for the
	//     summarization round-trip itself. Raise SessionTooFullError at
	//     entry so the turn_start handler aborts the turn with the
	//     5-key diagnostic bundle (D-12 fail-loud), matching the
	//     post-compaction path's error shape.
	//
	//     Note: this ONLY fires when ctx.contextWindow is a
	//     max_input_tokens value (not the model context window). The
	//     extension's readMaxInputTokens(profile) seeds contextWindow
	//     with the harness.context.max_input_tokens ceiling.
	if (ctx.contextWindow > 0 && ctx.contextTokens > ctx.contextWindow) {
		throw new SessionTooFullError({
			turn_index: ctx.entries.length,
			tokens: ctx.contextTokens,
			max_input_tokens: ctx.contextWindow,
			compaction_attempt_result: {
				elided: 0,
				summary_tokens: 0,
			},
			preservation_list: [],
		});
	}

	// 2. Load config
	const cfg = loadCompactionConfig(ctx.profile);
	if (!cfg) return { ran: false, elided: 0, preserved: 0 };

	// 3. Soft-threshold check
	const ratio = ctx.contextWindow > 0 ? ctx.contextTokens / ctx.contextWindow : 0;
	if (ratio < cfg.soft_threshold_pct) {
		return { ran: false, elided: 0, preserved: 0 };
	}

	// 4. Trigger event
	emit({
		event: "session.compaction.trigger",
		ts: new Date().toISOString(),
		profile: ctx.profile.ref,
		reason: "soft_threshold",
		context_tokens: ctx.contextTokens,
		context_window: ctx.contextWindow,
		ratio,
	});

	// 5. D-14 preservation pre-filter
	const preserveOpts: PreservationOpts = {
		structuralCore: true,
		errorPayloadsVerbatim: cfg.preserve_tool_results !== "none",
		activeGoal: true,
		recentTurns: cfg.preserve_recent_turns,
		filePins: true,
		todoState: true,
	};
	const preserved = markPreserved(ctx.entries, preserveOpts);
	const summarizable = ctx.entries.filter((e) => !preserved.has(e.uuid));
	const kept = ctx.entries.filter((e) => preserved.has(e.uuid));

	// 6. Preparation
	const prep = prepareCompactionLocal(summarizable, kept, ctx.contextTokens);
	if (!prep) {
		return { ran: false, elided: 0, preserved: preserved.size };
	}

	// D-17 visible status
	ctx.setStatus?.("emmy.compacting", `compacting ${prep.messagesToSummarize.length} turns…`);

	// 7. Profile-defined compaction prompt (D-13). Missing file → D-16 fallback
	//    (not a hard error — config-loader deliberately defers path-exists to
	//    first compaction, so a profile block without the prompt file still
	//    allows the session to continue in structured-prune mode).
	const promptFullPath = join(ctx.profile.ref.path, cfg.summarization_prompt_path);
	if (!existsSync(promptFullPath)) {
		emit({
			event: "session.compaction.fallback",
			ts: new Date().toISOString(),
			profile: ctx.profile.ref,
			error: `compaction prompt missing at ${promptFullPath}`,
		});
		ctx.setStatus?.("emmy.compacting", undefined);
		// D-30 live-wire path: still return a directive so the turn_start
		// handler can call ctx.compact({customInstructions: ""}) — pi's
		// built-in SUMMARIZATION_SYSTEM_PROMPT will take over.
		if (!stubMode) {
			return {
				ran: false,
				elided: 0,
				preserved: preserved.size,
				directive: {
					shouldCompact: true,
					customInstructions: "",
					preservation: preserved,
					tokensBefore: ctx.contextTokens,
					reason: "soft_threshold",
				},
			};
		}
		return {
			...structuredPruneFallback(ctx, preserved, engine),
			fallback: true,
		};
	}
	const customInstructions = readFileSync(promptFullPath, "utf8");

	// D-30 live-wire path (Plan 03.1-01) — return a directive and let the
	// turn_start handler drive pi's ctx.compact({customInstructions}) itself.
	// engine.summarize is NOT called. ran=false because we did not compact
	// internally; the caller reads directive.shouldCompact + customInstructions.
	if (!stubMode) {
		ctx.setStatus?.("emmy.compacting", undefined);
		return {
			ran: false,
			elided: 0,
			preserved: preserved.size,
			directive: {
				shouldCompact: true,
				customInstructions,
				preservation: preserved,
				tokensBefore: ctx.contextTokens,
				reason: "soft_threshold",
			},
		};
	}

	// 8. Summarization round-trip
	let summary: string;
	try {
		const r = await engine.summarize({
			preparation: prep,
			customInstructions,
			model: ctx.model,
			apiKey: ctx.apiKey,
			signal: ctx.signal,
		});
		summary = r.summary;
	} catch (err) {
		ctx.setStatus?.("emmy.compacting", undefined);
		// SessionTooFullError could only be re-thrown if summarize itself
		// happens to raise one — defensively re-throw.
		if (err instanceof SessionTooFullError) throw err;
		emit({
			event: "session.compaction.fallback",
			ts: new Date().toISOString(),
			profile: ctx.profile.ref,
			error: err instanceof Error ? err.message : String(err),
		});
		return {
			...structuredPruneFallback(ctx, preserved, engine),
			fallback: true,
		};
	}
	ctx.setStatus?.("emmy.compacting", undefined);

	// 9. Post-compaction token accounting + D-12 hard-ceiling guard
	const summaryEntry: SessionEntry = {
		uuid: "_emmy_summary_",
		role: "user",
		content: summary,
	};
	const summary_tokens = engine.estimateTokens(summaryEntry);
	const elidedTokens = prep.messagesToSummarize.reduce(
		(acc, m) => acc + engine.estimateTokens(m),
		0,
	);
	const postTokens = ctx.contextTokens - elidedTokens + summary_tokens;

	// 10. Complete event (emitted BEFORE throw on hard-ceiling so operators see
	//     the round-trip completed even though the session is about to abort).
	emit({
		event: "session.compaction.complete",
		ts: new Date().toISOString(),
		profile: ctx.profile.ref,
		turns_elided: prep.messagesToSummarize.length,
		turns_preserved: preserved.size,
		summary_tokens,
	});

	if (postTokens > ctx.contextWindow) {
		throw new SessionTooFullError({
			turn_index: ctx.entries.length,
			tokens: postTokens,
			max_input_tokens: ctx.contextWindow,
			compaction_attempt_result: {
				elided: prep.messagesToSummarize.length,
				summary_tokens,
			},
			preservation_list: Array.from(preserved),
		});
	}

	return {
		ran: true,
		elided: prep.messagesToSummarize.length,
		preserved: preserved.size,
	};
}

/**
 * D-16 structured-pruning fallback. Preserves the D-14 set and drops other
 * entries oldest-first until token budget is below 0.5 × contextWindow.
 *
 * Emmy does not mutate pi's session entries directly — pi's SessionManager
 * owns on-disk state. This helper RETURNS a synthetic result (`ran: true`
 * with elided count) so the extension handler's UI status reflects action.
 * The actual entry removal happens at the pi-extension layer in Plan 03-07.
 */
function structuredPruneFallback(
	ctx: EmmyCompactionContext,
	preserved: Set<string>,
	engine: CompactionEngine,
): { ran: boolean; elided: number; preserved: number } {
	const target = ctx.contextWindow * 0.5;
	let remaining = ctx.contextTokens;
	let elided = 0;
	for (const entry of ctx.entries) {
		if (preserved.has(entry.uuid)) continue;
		if (remaining <= target) break;
		remaining -= engine.estimateTokens(entry);
		elided++;
	}
	return { ran: true, elided, preserved: preserved.size };
}
