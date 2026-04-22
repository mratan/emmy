// packages/emmy-context/test/hard-ceiling.test.ts
//
// Phase 3 Plan 03-03 Task 1 — SessionTooFullError D-12 diagnostic bundle tests.

import { describe, expect, test } from "bun:test";

import { SessionTooFullError } from "../src";

describe("SessionTooFullError — D-12 diagnostic bundle", () => {
	test("constructor stores all 5 diagnostic keys on .diagnosticBundle", () => {
		const err = new SessionTooFullError({
			turn_index: 141,
			tokens: 120000,
			max_input_tokens: 114688,
			compaction_attempt_result: { elided: 80, summary_tokens: 2500 },
			preservation_list: ["sys-prompt", "turn-0", "turn-30", "turn-45"],
		});
		expect(err.diagnosticBundle.turn_index).toBe(141);
		expect(err.diagnosticBundle.tokens).toBe(120000);
		expect(err.diagnosticBundle.max_input_tokens).toBe(114688);
		expect(err.diagnosticBundle.compaction_attempt_result.elided).toBe(80);
		expect(err.diagnosticBundle.compaction_attempt_result.summary_tokens).toBe(2500);
		expect(err.diagnosticBundle.preservation_list).toHaveLength(4);
		expect(err.diagnosticBundle.preservation_list).toContain("turn-30");
	});

	test("toString() includes name + context.compaction.overflow message (named-error discipline)", () => {
		const err = new SessionTooFullError({
			turn_index: 200,
			tokens: 140000,
			max_input_tokens: 114688,
			compaction_attempt_result: { elided: 150, summary_tokens: 3000 },
			preservation_list: ["sys-prompt"],
		});
		const s = err.toString();
		expect(s).toStartWith("SessionTooFullError:");
		expect(s).toContain("context.compaction.overflow");
		expect(s).toContain("140000");
		expect(s).toContain("114688");
		expect(s).toContain("turn 200");
	});

	test("is instanceof Error and carries the ContextError dotted prefix", () => {
		const err = new SessionTooFullError({
			turn_index: 0,
			tokens: 0,
			max_input_tokens: 0,
			compaction_attempt_result: { elided: 0, summary_tokens: 0 },
			preservation_list: [],
		});
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("SessionTooFullError");
		expect(err.message).toContain("context.compaction.overflow");
	});
});
