// packages/emmy-context/test/preservation.test.ts
//
// Phase 3 Plan 03-03 Task 1 — D-14 preservation classifier tests.

import { describe, expect, test } from "bun:test";

import { markPreserved, type PreservationOpts, type SessionEntry } from "../src";

function buildFixture(): SessionEntry[] {
	// 60-entry fixture with the landmark entries the plan calls out:
	//   turn 0  — user goal ("make multi-file change")
	//   turn 1..29 — interleaved assistant/tool chatter
	//   turn 30 — tool_result with isError=true + 50KB stacktrace
	//   turn 31..44 — more chatter
	//   turn 45 — user "@file:src/foo.ts" pin
	//   turn 46..54 — more chatter
	//   turn 55..59 — recent 5 turns
	//
	// Entries are simplified: no `type` field — just {uuid, role, content, …}.
	const entries: SessionEntry[] = [];
	// System / structural-core entry at index -1 (prepend) so the goal turn
	// stays at index 0 as the plan describes.
	entries.push({
		uuid: "sys-prompt",
		role: "system",
		content: "EMMY ASSEMBLED PROMPT\nprompt_sha256:deadbeef1234",
	});
	// Turn 0 — goal
	entries.push({
		uuid: "turn-0",
		role: "user",
		content: "make multi-file change across the codebase",
	});
	// Turns 1..29 — alternating assistant / tool_result (no errors)
	for (let i = 1; i < 30; i++) {
		const role = i % 2 === 0 ? "assistant" : "tool";
		entries.push({
			uuid: `turn-${i}`,
			role,
			content: `step ${i}: ${role === "tool" ? "ok output" : "I'll do X"}`,
			isError: false,
			toolName: role === "tool" ? "bash" : undefined,
		});
	}
	// Turn 30 — tool_result with isError=true + 50KB stacktrace
	const stacktrace = `Error: something broke at /src/foo.ts:42
  at functionA (/src/foo.ts:42:10)
  at functionB (/src/bar.ts:15:3)
`.repeat(800); // ~50KB
	entries.push({
		uuid: "turn-30",
		role: "tool",
		content: stacktrace,
		isError: true,
		toolName: "bash",
	});
	// Turns 31..44 — more chatter (no structural markers)
	for (let i = 31; i < 45; i++) {
		const role = i % 2 === 0 ? "assistant" : "tool";
		entries.push({
			uuid: `turn-${i}`,
			role,
			content: `mid-session ${i}`,
			isError: false,
			toolName: role === "tool" ? "read" : undefined,
		});
	}
	// Turn 45 — user @file pin
	entries.push({
		uuid: "turn-45",
		role: "user",
		content: "@file:src/foo.ts please review",
	});
	// Turns 46..54 — more chatter
	for (let i = 46; i < 55; i++) {
		const role = i % 2 === 0 ? "assistant" : "tool";
		entries.push({
			uuid: `turn-${i}`,
			role,
			content: `late-session ${i}`,
			isError: false,
			toolName: role === "tool" ? "read" : undefined,
		});
	}
	// Turns 55..59 — recent 5 turns
	for (let i = 55; i < 60; i++) {
		const role = i % 2 === 0 ? "assistant" : "tool";
		entries.push({
			uuid: `turn-${i}`,
			role,
			content: `recent ${i}`,
			isError: false,
			toolName: role === "tool" ? "read" : undefined,
		});
	}
	return entries;
}

describe("markPreserved — D-14 preservation classifier", () => {
	const fullOpts: PreservationOpts = {
		structuralCore: true,
		errorPayloadsVerbatim: true,
		activeGoal: true,
		recentTurns: 5,
		filePins: true,
		todoState: true,
	};

	test("full D-14 opts preserve goal, error-result, pin, last 5, and structural core", () => {
		const entries = buildFixture();
		const preserved = markPreserved(entries, fullOpts);

		// D-14 item 3a: activeGoal (turn-0)
		expect(preserved.has("turn-0")).toBe(true);
		// D-14 item 2: error-flagged tool_result (turn-30)
		expect(preserved.has("turn-30")).toBe(true);
		// D-14 item 4a: @file pin (turn-45)
		expect(preserved.has("turn-45")).toBe(true);
		// D-14 item 3b: last 5 turns (55..59)
		for (let i = 55; i < 60; i++) {
			expect(preserved.has(`turn-${i}`)).toBe(true);
		}
		// D-14 item 1: structural core (sys-prompt — role === "system")
		expect(preserved.has("sys-prompt")).toBe(true);
	});

	test("errorPayloadsVerbatim=false removes turn-30 from preserved set", () => {
		const entries = buildFixture();
		const opts: PreservationOpts = { ...fullOpts, errorPayloadsVerbatim: false };
		const preserved = markPreserved(entries, opts);

		expect(preserved.has("turn-30")).toBe(false);
		// Other D-14 items still apply
		expect(preserved.has("turn-0")).toBe(true);
		expect(preserved.has("turn-45")).toBe(true);
	});

	test("recentTurns=3 keeps only turns 57..59 as 'recent'", () => {
		// Build a fixture variant that removes the @file pin and isError flag
		// so only the recentTurns rule would preserve anything in the 55..59
		// window. That isolates the N-most-recent semantics from the other D-14
		// rules.
		const entries: SessionEntry[] = [];
		entries.push({ uuid: "u-0", role: "user", content: "goal" });
		for (let i = 1; i < 60; i++) {
			entries.push({
				uuid: `t-${i}`,
				role: "assistant",
				content: `plain ${i}`,
				isError: false,
			});
		}
		const preserved = markPreserved(entries, {
			structuralCore: false,
			errorPayloadsVerbatim: false,
			activeGoal: false,
			recentTurns: 3,
			filePins: false,
			todoState: false,
		});

		// Last 3 indices: 57, 58, 59
		expect(preserved.has("t-57")).toBe(true);
		expect(preserved.has("t-58")).toBe(true);
		expect(preserved.has("t-59")).toBe(true);
		// Turn 56 is OUT of the 3-recent window
		expect(preserved.has("t-56")).toBe(false);
		// Earlier turns are OUT
		expect(preserved.has("t-40")).toBe(false);
		// Exactly 3 entries in set (no structural/goal/pin rules active)
		expect(preserved.size).toBe(3);
	});

	test("heuristic error signature preserves tool_result without isError flag", () => {
		// Tool result that does not set isError but contains a stack trace:
		// per D-14 Pitfall #15, the fallback heuristic must catch this.
		const entries: SessionEntry[] = [
			{ uuid: "u-0", role: "user", content: "goal" },
			{
				uuid: "t-1",
				role: "tool",
				content: "Traceback (most recent call last):\n  File foo.py line 42\n",
				toolName: "bash",
			},
		];
		const preserved = markPreserved(entries, {
			structuralCore: false,
			errorPayloadsVerbatim: true,
			activeGoal: false,
			recentTurns: 0,
			filePins: false,
			todoState: false,
		});
		expect(preserved.has("t-1")).toBe(true);
	});

	test("TODO-state preserves edits to PLAN.md", () => {
		const entries: SessionEntry[] = [
			{ uuid: "u-0", role: "user", content: "goal" },
			{
				uuid: "t-1",
				role: "tool",
				content: "wrote PLAN.md: created initial plan structure",
				toolName: "write",
			},
		];
		const preserved = markPreserved(entries, {
			structuralCore: false,
			errorPayloadsVerbatim: false,
			activeGoal: false,
			recentTurns: 0,
			filePins: false,
			todoState: true,
		});
		expect(preserved.has("t-1")).toBe(true);
	});
});
