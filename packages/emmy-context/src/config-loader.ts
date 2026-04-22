// packages/emmy-context/src/config-loader.ts
//
// Phase 3 Plan 03-03 — harness.yaml.context.compaction block loader + validator.
//
// D-15 contract (the exact shape Plan 03-07 extends v3/harness.yaml with):
//
//   context:
//     max_input_tokens: 114688
//     compaction:
//       soft_threshold_pct: 0.75
//       preserve_recent_turns: 5
//       summarization_prompt_path: prompts/compact.md
//       preserve_tool_results: error_only    # {error_only, none, all}
//
// The @emmy/provider ProfileSnapshot currently types `harness` narrowly around
// the grammar + per_tool_sampling + agent_loop knobs. This loader intentionally
// reads the `context.compaction` block via a defensive unknown-cast rather than
// extending ProfileSnapshot, because:
//   (a) Plan 03-03 ships the LOADER surface before Plan 03-07 wires the DATA.
//       A typed field would make Plan 03-07 a coordinated cross-package bump.
//   (b) The compaction block is optional (per plan truth: "profile without
//       compaction block returns null with 'compaction-disabled' disposition").
//   (c) Rule-3 safe: downstream changes land one wave at a time.
//
// Validation is fail-loud per field (dotted-path error carries actualValue
// for CLI diagnostics). Missing block returns null → compaction disabled.

import type { ProfileSnapshot } from "@emmy/provider";
import { CompactionConfigError } from "./errors";
import type { EmmyCompactionConfig } from "./types";

const VALID_PRESERVE_TOOL_RESULTS: ReadonlyArray<"error_only" | "none" | "all"> = [
	"error_only",
	"none",
	"all",
];

/**
 * Read and validate the `context.compaction` block from a profile bundle.
 *
 * Returns:
 *   - null if the block is absent (compaction disabled; plan truth: "returns
 *     null with 'compaction-disabled' disposition").
 *   - EmmyCompactionConfig if the block is present AND well-formed.
 *
 * Throws:
 *   - CompactionConfigError if ANY field is missing, wrong type, or out of
 *     range. Dotted-path error carries the offending key so CLI / tests can
 *     assert on the shape.
 */
export function loadCompactionConfig(
	profile: ProfileSnapshot,
): EmmyCompactionConfig | null {
	// Defensive read. ProfileSnapshot's type does not declare `harness.context`,
	// so the field is accessed via an unknown cast + narrowing.
	const harness = profile.harness as unknown as { context?: unknown };
	const context = harness.context;
	if (context == null || typeof context !== "object") return null;

	const block = (context as { compaction?: unknown }).compaction;
	if (block == null) return null;
	if (typeof block !== "object") {
		throw new CompactionConfigError(
			"compaction",
			"expected an object mapping (got non-object value)",
			block,
		);
	}

	const raw = block as Record<string, unknown>;

	// --- soft_threshold_pct ---
	const pct = raw.soft_threshold_pct;
	if (typeof pct !== "number" || !Number.isFinite(pct)) {
		throw new CompactionConfigError(
			"compaction.soft_threshold_pct",
			"expected a finite number in [0, 1]",
			pct,
		);
	}
	if (pct < 0 || pct > 1) {
		throw new CompactionConfigError(
			"compaction.soft_threshold_pct",
			`value must be in [0, 1] (got ${pct})`,
			pct,
		);
	}

	// --- preserve_recent_turns ---
	const n = raw.preserve_recent_turns;
	if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
		throw new CompactionConfigError(
			"compaction.preserve_recent_turns",
			"expected a non-negative integer",
			n,
		);
	}

	// --- summarization_prompt_path ---
	const promptPath = raw.summarization_prompt_path;
	if (typeof promptPath !== "string" || promptPath.length === 0) {
		throw new CompactionConfigError(
			"compaction.summarization_prompt_path",
			"expected a non-empty string (relative path under the profile bundle)",
			promptPath,
		);
	}

	// --- preserve_tool_results ---
	const mode = raw.preserve_tool_results;
	if (
		typeof mode !== "string" ||
		!VALID_PRESERVE_TOOL_RESULTS.includes(mode as "error_only" | "none" | "all")
	) {
		throw new CompactionConfigError(
			"compaction.preserve_tool_results",
			`expected one of ${VALID_PRESERVE_TOOL_RESULTS.join(", ")}`,
			mode,
		);
	}

	return {
		soft_threshold_pct: pct,
		preserve_recent_turns: n,
		summarization_prompt_path: promptPath,
		preserve_tool_results: mode as "error_only" | "none" | "all",
	};
}
