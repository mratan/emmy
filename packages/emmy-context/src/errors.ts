// packages/emmy-context/src/errors.ts
//
// Phase 3 Plan 03-03 — dotted-path error hierarchy for @emmy/context.
// Mirrors the convention used by @emmy/provider (ProviderError) and
// @emmy/tools (ToolsError): the message carries a dotted-path prefix
// ("context.<field>: ...") so CLI diagnostics can pattern-match across
// packages.
//
// Errors shipped here:
//   - ContextError         — base class; all others derive.
//   - SessionTooFullError  — D-12 hard-ceiling fail-loud when post-compaction
//                             tokens still exceed max_input_tokens. Carries a
//                             `diagnosticBundle` with the 5 keys required by
//                             D-12 (turn_index, tokens, max_input_tokens,
//                             compaction_attempt_result, preservation_list).
//   - CompactionConfigError — loader rejection when context.compaction shape
//                             is malformed (missing keys, wrong types, enum
//                             violations).
//   - IllegalCompactionTimingError — Pitfall #3 guard; trigger called on an
//                             event type other than "turn_start".
//   - CompactionFallbackError — D-16 fallback telemetry helper; caught
//                             internally and NEVER propagated to the caller.

export class ContextError extends Error {
	constructor(
		public readonly field: string,
		message: string,
	) {
		super(`context.${field}: ${message}`);
		this.name = "ContextError";
	}
}

export interface SessionTooFullDiagnostic {
	turn_index: number;
	tokens: number;
	max_input_tokens: number;
	compaction_attempt_result: {
		elided: number;
		summary_tokens: number;
	};
	preservation_list: string[];
}

/**
 * D-12 fail-loud: post-compaction assembled prompt still exceeds
 * max_input_tokens. Fires when the summarization round-trip did not free
 * enough budget OR a single surviving entry (e.g. a pinned file / huge error
 * payload) alone exceeds the window.
 *
 * Callers in pi-emmy-extension.ts surface `.message` to the TUI status area
 * and re-throw so the session halts (D-12 discipline — "silent degradation
 * on context overflow would violate the daily-driver contract"). Consumers
 * that need structured access read `.diagnosticBundle`.
 */
export class SessionTooFullError extends ContextError {
	public readonly diagnosticBundle: SessionTooFullDiagnostic;

	constructor(diagnostic: SessionTooFullDiagnostic) {
		super(
			"compaction.overflow",
			[
				`post-compaction tokens (${diagnostic.tokens})`,
				`exceed max_input_tokens (${diagnostic.max_input_tokens})`,
				`at turn ${diagnostic.turn_index}`,
				`; compaction elided ${diagnostic.compaction_attempt_result.elided} messages into ${diagnostic.compaction_attempt_result.summary_tokens} summary tokens;`,
				`${diagnostic.preservation_list.length} entries preserved (D-14)`,
			].join(" "),
		);
		this.name = "SessionTooFullError";
		this.diagnosticBundle = diagnostic;
	}

	override toString(): string {
		// Named-error discipline: name + message is the readable form.
		return `${this.name}: ${this.message}`;
	}
}

/**
 * Loader rejection for the context.compaction harness.yaml block (D-15).
 * Carries a dotted-path field so tests + CLI error printers can identify
 * which key was malformed:
 *   context.compaction.soft_threshold_pct
 *   context.compaction.preserve_recent_turns
 *   context.compaction.summarization_prompt_path
 *   context.compaction.preserve_tool_results
 */
export class CompactionConfigError extends ContextError {
	public readonly dottedPath: string;
	public readonly actualValue: unknown;

	constructor(dottedPath: string, message: string, actualValue: unknown) {
		super(dottedPath, message);
		this.name = "CompactionConfigError";
		this.dottedPath = `context.${dottedPath}`;
		this.actualValue = actualValue;
	}
}

/**
 * Pitfall #3 guard: compaction trigger fired on an event other than
 * `turn_start`. Indicates a wiring bug in the extension registration — the
 * handler should be attached via `pi.on("turn_start", ...)` ONLY. Mid-stream
 * compaction corrupts turn atomicity (D-11).
 */
export class IllegalCompactionTimingError extends ContextError {
	public readonly eventType: string;

	constructor(eventType: string) {
		super(
			"compaction.illegal_timing",
			`emmyCompactionTrigger called on event=${eventType}; only turn_start is allowed (D-11 turn-boundary)`,
		);
		this.name = "IllegalCompactionTimingError";
		this.eventType = eventType;
	}
}

/**
 * D-16 structured-pruning fallback helper. Caught internally by
 * emmyCompactionTrigger and converted to a
 * `session.compaction.fallback` telemetry event — NEVER propagated to the
 * caller. Exported only so the telemetry record shape has a named error
 * class to introspect.
 */
export class CompactionFallbackError extends ContextError {
	public readonly originalError: unknown;

	constructor(originalError: unknown) {
		super(
			"compaction.fallback",
			`summarization round-trip failed: ${originalError instanceof Error ? originalError.message : String(originalError)}`,
		);
		this.name = "CompactionFallbackError";
		this.originalError = originalError;
	}
}
