// packages/emmy-tools/tests/ask-claude.test.ts
//
// Phase 04.6 Plan 04.6-05 Task 1 (RED) — ask_claude tool unit tests.
//
// Covers (from PLAN):
//   - D-13 opt-in: createAskClaudeTool returns null when config.enabled=false
//   - D-05 structured args: input_schema declares {question, tried, relevant_context}
//     with question + tried required
//   - D-15 description carries the verbatim "X circumstances" guidance
//     (Use ask_claude WHEN: / Do NOT use ask_claude / forbids secrets/credentials/PII)
//   - Empty `tried` field rejected with structured ToolError-shaped result
//   - Boilerplate `tried` (e.g. "I tried thinking", "i don't know", "n/a", "tried",
//     "stuck") rejected too — the discipline-enforcing gate of the tool form
//   - Valid args dispatch to deps.callAskClaude(prompt) where prompt contains
//     "question:", "tried:", "relevant_context:" lines
//   - Per-turn rate-limit (D-07 harness side): 6th call in a turn is blocked
//   - Per-turn counter resets on _resetTurnCount() (wire-point for pi turn_end)
//   - scrubber_blocked error from sidecar surfaces as structured tool error
//     with the matched pattern_class
//
// Test strategy: pure-DI. callAskClaude is injected (no fetch, no network);
// the rate-limit counter is reset between tests via the exported reset helper.

import { beforeEach, describe, expect, test } from "bun:test";

import {
	__resetAskClaudeTurnCountForTests,
	createAskClaudeTool,
	type AskClaudeArgs,
	type AskClaudeCallResult,
} from "../src/ask-claude";

// --------------------------------------------------------------------------
// Per-test reset
// --------------------------------------------------------------------------

beforeEach(() => {
	__resetAskClaudeTurnCountForTests();
});

const ENABLED_CFG = {
	enabled: true,
	rate_limit_per_turn: 5,
	rate_limit_per_hour: 30,
} as const;

// A minimal "ok" stub for callAskClaude; tests override this when needed.
const OK_CALL = async (_prompt: string): Promise<AskClaudeCallResult> => ({
	response: "ok",
	duration_ms: 100,
	rate_limit_remaining_hour: 29,
});

// --------------------------------------------------------------------------
// Description + schema (D-05, D-13, D-15)
// --------------------------------------------------------------------------

describe("createAskClaudeTool — schema (D-05)", () => {
	test("registers with structured args (question, tried, relevant_context)", () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: ENABLED_CFG,
		});
		expect(tool).not.toBeNull();
		expect(tool!.name).toBe("ask_claude");
		const props = (tool!.parameters as { properties: Record<string, unknown> })
			.properties;
		expect(props.question).toBeDefined();
		expect(props.tried).toBeDefined();
		expect(props.relevant_context).toBeDefined();
		const required = (tool!.parameters as { required?: string[] }).required ?? [];
		expect(required).toContain("question");
		expect(required).toContain("tried");
	});
});

describe("createAskClaudeTool — description (D-15 verbatim)", () => {
	test("description contains 'Use ask_claude WHEN' (the X circumstances opener)", () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: ENABLED_CFG,
		});
		expect(tool).not.toBeNull();
		expect(tool!.description).toMatch(/Use ask_claude WHEN/);
	});

	test("description contains 'Do NOT use ask_claude' (the explicit anti-list)", () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: ENABLED_CFG,
		});
		expect(tool!.description).toMatch(/Do NOT use ask_claude/);
	});

	test("description forbids secrets/credentials/PII (T-01 mitigation)", () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: ENABLED_CFG,
		});
		expect(tool!.description).toMatch(/secrets, credentials, PII/);
	});

	test("description names the per-turn limit so the model knows the budget", () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: ENABLED_CFG,
		});
		expect(tool!.description.toLowerCase()).toContain("per-turn limit");
	});
});

// --------------------------------------------------------------------------
// D-13 opt-in
// --------------------------------------------------------------------------

describe("createAskClaudeTool — opt-in per profile (D-13)", () => {
	test("returns null when config.enabled is false", () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: { enabled: false, rate_limit_per_turn: 5, rate_limit_per_hour: 30 },
		});
		expect(tool).toBeNull();
	});
});

// --------------------------------------------------------------------------
// Boilerplate-tried gate (T-06 / discipline shaper)
// --------------------------------------------------------------------------

describe("ask_claude.invoke — `tried` discipline gate", () => {
	test("empty tried field rejected with structured error", async () => {
		const tool = createAskClaudeTool({
			callAskClaude: async () => {
				throw new Error("should not be called");
			},
			config: ENABLED_CFG,
		});
		const result = (await tool!.invoke({
			question: "what is 2+2",
			tried: "",
			relevant_context: "math",
		})) as { isError?: boolean; content: Array<{ type: string; text: string }> };
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toMatch(/tried.*concrete prior attempts/i);
	});

	test("boilerplate tried rejected ('I tried thinking', 'i don't know', 'n/a', 'tried', 'stuck')", async () => {
		const boilerplate = [
			"I tried thinking about it",
			"i don't know",
			"n/a",
			"tried",
			"stuck",
			"   ", // pure whitespace
			"thinking",
			"none",
			"nothing",
		];
		for (const t of boilerplate) {
			const tool = createAskClaudeTool({
				callAskClaude: async () => {
					throw new Error("should not be called");
				},
				config: ENABLED_CFG,
			});
			const result = (await tool!.invoke({
				question: "q",
				tried: t,
				relevant_context: "",
			})) as { isError?: boolean; content: Array<{ type: string; text: string }> };
			expect(result.isError).toBe(true);
			expect(result.content[0]!.text).toMatch(/concrete prior attempts/i);
		}
	});
});

// --------------------------------------------------------------------------
// Happy path
// --------------------------------------------------------------------------

describe("ask_claude.invoke — valid args dispatch to sidecar", () => {
	test("valid structured args dispatches and returns response", async () => {
		let captured: string | undefined;
		const tool = createAskClaudeTool({
			callAskClaude: async (prompt: string): Promise<AskClaudeCallResult> => {
				captured = prompt;
				return {
					response: "the answer is 4",
					duration_ms: 1500,
					rate_limit_remaining_hour: 29,
				};
			},
			config: ENABLED_CFG,
		});
		const result = (await tool!.invoke({
			question: "what is 2+2",
			tried: "I tried symbolic computation but my interpreter doesn't support arithmetic.",
			relevant_context: "Building a calculator from scratch in BF.",
		})) as { isError?: boolean; content: Array<{ type: string; text: string }> };
		expect(result.isError).toBeFalsy();
		expect(result.content[0]!.text).toContain("the answer is 4");
		// Prompt sent to sidecar must include all three structured args (D-05 contract).
		expect(captured).toBeDefined();
		expect(captured!).toContain("question:");
		expect(captured!).toContain("what is 2+2");
		expect(captured!).toContain("tried:");
		expect(captured!).toContain("relevant_context:");
	});

	test("relevant_context omitted by caller → prompt notes '(none provided)'", async () => {
		let captured: string | undefined;
		const tool = createAskClaudeTool({
			callAskClaude: async (prompt: string): Promise<AskClaudeCallResult> => {
				captured = prompt;
				return {
					response: "ok",
					duration_ms: 1,
					rate_limit_remaining_hour: 29,
				};
			},
			config: ENABLED_CFG,
		});
		await tool!.invoke({
			question: "q",
			tried: "real and specific prior attempt that failed in way Z",
		} as AskClaudeArgs);
		expect(captured).toBeDefined();
		expect(captured!).toContain("relevant_context: (none provided)");
	});
});

// --------------------------------------------------------------------------
// Per-turn rate-limit (D-07 harness pool)
// --------------------------------------------------------------------------

describe("ask_claude.invoke — per-turn rate-limit (D-07)", () => {
	test("6th call in a turn blocked with structured rate-limit error", async () => {
		let calls = 0;
		const tool = createAskClaudeTool({
			callAskClaude: async (): Promise<AskClaudeCallResult> => {
				calls += 1;
				return {
					response: "ok",
					duration_ms: 100,
					rate_limit_remaining_hour: 29,
				};
			},
			config: ENABLED_CFG,
		});
		const args: AskClaudeArgs = {
			question: "q",
			tried: "concrete attempt that failed for specific reason X",
			relevant_context: "ctx",
		};
		// First 5 calls succeed.
		for (let i = 0; i < 5; i++) {
			const r = (await tool!.invoke(args)) as { isError?: boolean };
			expect(r.isError).toBeFalsy();
		}
		// 6th call blocked.
		const blocked = (await tool!.invoke(args)) as {
			isError?: boolean;
			content: Array<{ type: string; text: string }>;
		};
		expect(blocked.isError).toBe(true);
		expect(blocked.content[0]!.text.toLowerCase()).toMatch(
			/rate.?limit.*per.?turn/,
		);
		// callAskClaude was NOT invoked for the 6th call.
		expect(calls).toBe(5);
	});

	test("__resetAskClaudeTurnCountForTests / resetAskClaudeTurnCount re-enables after cap", async () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: ENABLED_CFG,
		});
		const args: AskClaudeArgs = {
			question: "q",
			tried: "specific prior attempt that failed for reason X",
			relevant_context: "",
		};
		for (let i = 0; i < 5; i++) {
			await tool!.invoke(args);
		}
		const capped = (await tool!.invoke(args)) as { isError?: boolean };
		expect(capped.isError).toBe(true);

		// Simulate turn_end via the exported reset.
		__resetAskClaudeTurnCountForTests();

		const after = (await tool!.invoke(args)) as { isError?: boolean };
		expect(after.isError).toBeFalsy();
	});
});

// --------------------------------------------------------------------------
// Sidecar error mapping
// --------------------------------------------------------------------------

describe("ask_claude.invoke — sidecar error mapping", () => {
	test("scrubber_blocked from sidecar surfaces as structured tool error with pattern_class", async () => {
		const tool = createAskClaudeTool({
			callAskClaude: async () => {
				const err = new Error("scrubber blocked the prompt") as Error & {
					reason?: string;
					pattern_class?: string;
				};
				err.reason = "scrubber_blocked";
				err.pattern_class = "sk_prefixed_key";
				throw err;
			},
			config: ENABLED_CFG,
		});
		const r = (await tool!.invoke({
			question: "use my key sk-abc...",
			tried: "real attempt that failed",
			relevant_context: "real ctx",
		})) as { isError?: boolean; content: Array<{ type: string; text: string }> };
		expect(r.isError).toBe(true);
		expect(r.content[0]!.text).toContain("sk_prefixed_key");
		expect(r.content[0]!.text.toLowerCase()).toContain("scrubber_blocked");
	});

	test("rate_limited_hourly from sidecar surfaces with the reason verbatim", async () => {
		const tool = createAskClaudeTool({
			callAskClaude: async () => {
				const err = new Error("hourly cap reached") as Error & {
					reason?: string;
				};
				err.reason = "rate_limited_hourly";
				throw err;
			},
			config: ENABLED_CFG,
		});
		const r = (await tool!.invoke({
			question: "q",
			tried: "specific prior attempt that failed for reason X",
			relevant_context: "",
		})) as { isError?: boolean; content: Array<{ type: string; text: string }> };
		expect(r.isError).toBe(true);
		expect(r.content[0]!.text).toContain("rate_limited_hourly");
	});

	test("generic Error without `reason` surfaces with 'unknown' reason", async () => {
		const tool = createAskClaudeTool({
			callAskClaude: async () => {
				throw new Error("connect ECONNREFUSED 127.0.0.1:8003");
			},
			config: ENABLED_CFG,
		});
		const r = (await tool!.invoke({
			question: "q",
			tried: "specific prior attempt that failed for reason X",
			relevant_context: "",
		})) as { isError?: boolean; content: Array<{ type: string; text: string }> };
		expect(r.isError).toBe(true);
		// Either the message text shows up, or the unknown-reason fallback does.
		expect(r.content[0]!.text.toLowerCase()).toMatch(
			/(econnrefused|unknown|ask_claude failed)/,
		);
	});
});

// --------------------------------------------------------------------------
// Successful call increments the turn counter (regression guard)
// --------------------------------------------------------------------------

describe("ask_claude.invoke — counter accounting", () => {
	test("counter only increments on successful dispatch, not on validation rejects", async () => {
		const tool = createAskClaudeTool({
			callAskClaude: OK_CALL,
			config: ENABLED_CFG,
		});
		// 10 boilerplate-tried rejections — should not consume any rate-limit headroom.
		for (let i = 0; i < 10; i++) {
			await tool!.invoke({ question: "q", tried: "stuck", relevant_context: "" });
		}
		// Now we should still have the full 5-per-turn budget.
		for (let i = 0; i < 5; i++) {
			const r = (await tool!.invoke({
				question: "q",
				tried: "specific prior attempt that failed for reason X",
				relevant_context: "",
			})) as { isError?: boolean };
			expect(r.isError).toBeFalsy();
		}
		const blocked = (await tool!.invoke({
			question: "q",
			tried: "specific prior attempt that failed for reason X",
			relevant_context: "",
		})) as { isError?: boolean };
		expect(blocked.isError).toBe(true);
	});
});
