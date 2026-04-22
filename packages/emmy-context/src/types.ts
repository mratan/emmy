// packages/emmy-context/src/types.ts
//
// Phase 3 Plan 03-03 — type surface for the @emmy/context compaction +
// preservation machinery.
//
// IMPORTANT — SessionEntry shape note:
//   Pi 0.68's on-disk SessionEntry is a discriminated union with fields
//   {type, id, parentId, timestamp, message?, ...} wrapping an AgentMessage.
//   The Emmy-layer classifier (preservation.ts) + Emmy-layer trigger
//   (compaction.ts) operate on a SIMPLIFIED per-entry shape indexed by
//   `uuid` + `role` + `content`, which is sufficient to decide whether an
//   entry should be summarized or preserved verbatim. pi's real compaction
//   engine (prepareCompaction / compact) takes its own
//   AgentMessage-shaped arrays at the wire; the bridging between the two
//   shapes happens at the call site in pi-emmy-extension.ts (outside this
//   package). See plan 03-03 <interfaces> block for the emmy-local shape.
//
// This is intentional: D-14 preservation runs as a PRE-FILTER on emmy-shaped
// entries (ordered, uuid'd, role+content tagged). The Set<uuid> result is
// consumed downstream by the compaction trigger to decide which SessionEntry
// values are handed to pi's prepareCompaction — pi never sees the emmy
// classifier state.

/**
 * Simplified per-entry shape the @emmy/context classifier operates on.
 *
 * Contract:
 *   - `uuid` must be stable across the session lifetime. Preservation returns
 *     a Set<string> keyed on this UUID.
 *   - `role` matches the standard OpenAI chat-completion roles plus "tool"
 *     for tool-result entries. Additional pi-specific entry types (thinking /
 *     custom / branch_summary) are filtered out upstream before reaching the
 *     classifier.
 *   - `content` is the free-text content (string) for user/assistant/system
 *     entries, or the tool-result body for role === "tool". Rich content
 *     arrays are flattened to concatenated text before classification.
 *   - `isError` is the pi-native tool-result error flag; `true` pins the
 *     entry into the preserved set when `errorPayloadsVerbatim: true`.
 *   - `toolName` is the tool identifier for role === "tool" entries.
 */
export interface SessionEntry {
	uuid: string;
	role: "system" | "user" | "assistant" | "tool" | string;
	content: string;
	isError?: boolean;
	toolName?: string;
	[k: string]: unknown;
}

/**
 * D-14 preservation knobs. All four of D-14's guarantees map to boolean or
 * numeric fields on this options object. See compaction.ts for the default
 * set and config-loader.ts for the harness.yaml mapping.
 */
export interface PreservationOpts {
	/** system.md + AGENTS.md + tool defs + prompt.sha line (D-14 item 1) */
	structuralCore: boolean;
	/** tool_result.isError === true + stacktrace heuristic (D-14 item 2 / Pitfall #15) */
	errorPayloadsVerbatim: boolean;
	/** first user message in the session (D-14 item 3a) */
	activeGoal: boolean;
	/** last N turns kept verbatim (D-14 item 3b) */
	recentTurns: number;
	/** @file pins (D-14 item 4a / CONTEXT-03) */
	filePins: boolean;
	/** TODO/PLAN file edits (D-14 item 4b / TOOLS-09) */
	todoState: boolean;
}

/**
 * Shape of the `context.compaction` block in harness.yaml (D-15). Loaded by
 * config-loader.ts from `profile.harness` (which today does not carry this
 * block — Plan 03-07 extends v3 harness.yaml with these fields; Plan 03-03
 * ships the loader + validator so Plan 03-07 only wires the data).
 */
export interface EmmyCompactionConfig {
	soft_threshold_pct: number;
	preserve_recent_turns: number;
	summarization_prompt_path: string;
	preserve_tool_results: "error_only" | "none" | "all";
}

/**
 * Emmy-layer verdict from emmyCompactionTrigger. Tests assert on these fields
 * directly; the live wiring in pi-emmy-extension.ts may surface a pared-down
 * subset to the UI layer.
 */
export interface CompactionDecision {
	verdict: "skip" | "run";
	reason: string;
}
