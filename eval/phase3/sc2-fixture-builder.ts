// eval/phase3/sc2-fixture-builder.ts
//
// Phase 3 Plan 03-03 Task 3 — deterministic 200-turn SC-2 fixture.
//
// Purpose: produce a synthetic session history that (a) crosses the
// 0.75 × 114688 soft threshold by turn ~130 given the default chars/4
// estimator, (b) exercises every D-14 preservation category, and (c)
// hash-stabilizes across runs so Plan 03-07's 3-run variant matrix
// (default / alternate / disabled) compares identical inputs.
//
// Fixture shape:
//   - Entry 0: system prompt (structural core; role === "system" +
//     "prompt_sha256:" + "# Tools available" markers so markPreserved's
//     structuralCore rule pins it).
//   - Entry 1: user goal — "implement full refactor across 40 files"
//     (D-14 activeGoal).
//   - Entries 2..totalTurns-1: alternating assistant / tool content with
//     role-appropriate structure. Every N-th tool entry is error-flagged
//     with a 4KB synthetic stacktrace (D-14 error-payloads verbatim /
//     Pitfall #15).
//   - Specific landmark entries:
//       turn 50  — tool entry with "wrote PLAN.md: …" content
//                  (D-14 todoState).
//       turn 90  — user entry with "@file:src/foo90.ts …" content
//                  (D-14 filePins + CONTEXT-03).
//       turn 140 — user entry with "@file:src/foo140.ts …" content.
//
// Token accounting: each chatter turn body is `avgTurnTokens * 4` chars
// to match pi's estimateTokens chars/4 heuristic. With defaults
// (avgTurnTokens=700, totalTurns=200), cumulative tokens cross 86016
// (= 0.75 × 114688) around turn 130.

import { createHash } from "node:crypto";

import type { SessionEntry } from "@emmy/context";

export interface Sc2FixtureOpts {
	totalTurns: number;
	/** Mean tokens (chars/4) per chatter turn. */
	avgTurnTokens: number;
	/** Every N-th tool entry is error-flagged with a 4KB stacktrace. */
	errorTurnInterval: number;
	/** Turn indices that carry an @file pin in user-role content. */
	pinTurns: number[];
	/** Turn indices that become PLAN.md / TODO.md writes (tool role). */
	todoTurns: number[];
}

export const DEFAULT_SC2_OPTS: Sc2FixtureOpts = {
	totalTurns: 200,
	avgTurnTokens: 700,
	errorTurnInterval: 20,
	pinTurns: [90, 140],
	todoTurns: [50],
};

/**
 * Deterministically generate a 200-turn SC-2 fixture.
 *
 * Returns ordered entries (oldest first). The sha256 of JSON.stringify(result)
 * is stable across runs — `fixtureHash()` below computes it.
 */
export function generateSc2Fixture(opts: Partial<Sc2FixtureOpts> = {}): SessionEntry[] {
	const cfg: Sc2FixtureOpts = { ...DEFAULT_SC2_OPTS, ...opts };
	const entries: SessionEntry[] = [];

	// Entry 0: structural-core system prompt. Markers chosen to match
	// preservation.ts STRUCTURAL_MARKERS so the classifier pins this entry.
	entries.push({
		uuid: "sys-0",
		role: "system",
		content: [
			"EMMY ASSEMBLED SYSTEM PROMPT",
			"# Tools available",
			"- read(path): read a file with hash-prefixed lines",
			"- write(path, content): atomic write",
			"- edit(path, edits): hash-anchored edit",
			"- bash(command): run a shell command (YOLO default)",
			"prompt_sha256:0000000000000000000000000000000000000000000000000000000000000000",
		].join("\n"),
		isError: false,
	});

	// Entry 1: active goal (first user message).
	entries.push({
		uuid: "u-goal",
		role: "user",
		content: "implement full refactor across 40 files with tests",
	});

	// Entries 2..totalTurns-1. Even indices = assistant, odd indices = tool.
	// Error-flag rule: every errorTurnInterval-th TOOL-role entry (indices
	// 21, 41, 61, ..., 181 for default interval 20) carries a 4KB synthetic
	// stacktrace. `role === "tool" && i % errorTurnInterval === 1` handles
	// the odd-parity mapping.
	for (let i = 2; i < cfg.totalTurns; i++) {
		const role = i % 2 === 0 ? "assistant" : "tool";
		const isError =
			role === "tool" && i % cfg.errorTurnInterval === 1 && i >= cfg.errorTurnInterval;
		let content: string;
		let toolName: string | undefined;

		if (role === "assistant") {
			// Assistant chatter — repeat a short fragment to reach the per-turn
			// token budget (chars/4 = avgTurnTokens tokens).
			const fragment = "I'll continue the refactor step " + i + ". ";
			content = fragment.repeat(Math.max(1, Math.floor((cfg.avgTurnTokens * 4) / fragment.length)));
		} else if (isError) {
			// Error-flagged tool_result with a ~4KB synthetic stacktrace.
			const frame = `Error: synthetic failure at turn ${i} /src/refactor.ts:${i}\n  at fn${i} (/src/refactor.ts:${i}:col)\n  at caller (/src/refactor.ts:${i - 1}:col)\n`;
			content = frame.repeat(Math.max(1, Math.floor(4096 / frame.length)));
			toolName = "bash";
		} else {
			// Plain tool_result.
			const fragment = `ok result ${i}: lines read successfully. `;
			content =
				"ok " +
				fragment.repeat(Math.max(1, Math.floor((cfg.avgTurnTokens * 4) / fragment.length)));
			toolName = i % 4 === 1 ? "read" : "bash";
		}

		// File-pin landmark turns (user role, override the default assistant/tool
		// alternation so the classifier's first-user rule leaves turn 1 alone).
		if (cfg.pinTurns.includes(i)) {
			entries.push({
				uuid: `pin-${i}`,
				role: "user",
				content: `@file:src/foo${i}.ts please review the refactor for this module.`,
			});
			continue;
		}
		// TODO-state landmark turns (tool role writing PLAN.md / TODO.md).
		if (cfg.todoTurns.includes(i)) {
			entries.push({
				uuid: `todo-${i}`,
				role: "tool",
				content: `wrote PLAN.md: milestone checkpoint at turn ${i}`,
				isError: false,
				toolName: "write",
			});
			continue;
		}

		entries.push({
			uuid: `${role}-${i}`,
			role,
			content,
			isError,
			...(toolName ? { toolName } : {}),
		});
	}

	return entries;
}

/**
 * Deterministic sha256 of the serialized fixture. Used by the runner for
 * 3-run-discipline — Plan 03-07 asserts the same fixtureHash across the
 * default/alternate/disabled variants so prompt-change deltas can't be
 * confused with fixture-change deltas.
 */
export function fixtureHash(fixture: SessionEntry[]): string {
	return createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
}

/**
 * Sum of pi-style estimateTokens (chars/4) across the fixture. Exposed so
 * the runner can determine the soft-threshold-crossing turn index.
 */
export function cumulativeTokens(fixture: SessionEntry[]): number[] {
	const out: number[] = [];
	let acc = 0;
	for (const e of fixture) {
		acc += String(e.content ?? "").length / 4;
		out.push(acc);
	}
	return out;
}
