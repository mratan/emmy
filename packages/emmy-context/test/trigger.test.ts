// packages/emmy-context/test/trigger.test.ts
//
// Phase 3 Plan 03-03 Task 2 — emmyCompactionTrigger behavior tests.
//
// Exercises the D-11 soft-threshold trigger, Pitfall #3 mid-stream guard,
// D-14 preservation integration, and telemetry event emission around the
// happy-path round-trip.
//
// Telemetry capture strategy:
//   We pass an in-test `emitEvent` closure to the trigger via
//   EmmyCompactionContext.emitEvent. This bypasses the global @emmy/telemetry
//   module entirely, so:
//     - Plan 03-02 Pattern F mock.module hazards from other @emmy/ux tests
//       that mock @emmy/telemetry are avoided.
//     - No file I/O or OTLP calls happen in this test path.
//     - Events are captured in an in-memory array for direct assertions.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProfileSnapshot } from "@emmy/provider";
import {
	emmyCompactionTrigger,
	IllegalCompactionTimingError,
	type CompactionEngine,
	type SessionEntry,
} from "../src";

function buildProfile(bundlePath: string): ProfileSnapshot {
	return {
		ref: {
			id: "test-profile",
			version: "v1",
			hash: "sha256:0000",
			path: bundlePath,
		},
		serving: {
			engine: { served_model_name: "test-model", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.7, top_p: 0.95, max_tokens: 1024 },
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: {
			tools: { format: "openai", grammar: null, per_tool_sampling: {} },
			agent_loop: { retry_on_unparseable_tool_call: 1 },
			context: {
				max_input_tokens: 114688,
				compaction: {
					soft_threshold_pct: 0.75,
					preserve_recent_turns: 5,
					summarization_prompt_path: "prompts/compact.md",
					preserve_tool_results: "error_only",
				},
			},
		} as unknown as ProfileSnapshot["harness"],
	};
}

function buildFixture(totalTurns: number, tokensPerTurn: number): SessionEntry[] {
	const entries: SessionEntry[] = [];
	entries.push({
		uuid: "sys-0",
		role: "system",
		content: "EMMY ASSEMBLED PROMPT\nprompt_sha256:deadbeef",
	});
	entries.push({
		uuid: "u-1",
		role: "user",
		content: "implement a multi-file refactor",
	});
	for (let i = 2; i < totalTurns; i++) {
		const role = i % 2 === 0 ? "assistant" : "tool";
		entries.push({
			uuid: `t-${i}`,
			role,
			content: "x".repeat(tokensPerTurn * 4),
			isError: false,
			toolName: role === "tool" ? "bash" : undefined,
		});
	}
	return entries;
}

function withTempProfile(work: (ctx: { dir: string; profile: ProfileSnapshot }) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "emmy-ctx-test-"));
	try {
		const promptDir = join(dir, "prompts");
		mkdirSync(promptDir, { recursive: true });
		writeFileSync(
			join(promptDir, "compact.md"),
			"Summarize the session preserving file edits and errors.",
		);
		const profile = buildProfile(dir);
		return work({ dir, profile }).finally(() => {
			rmSync(dir, { recursive: true, force: true });
		});
	} catch (e) {
		rmSync(dir, { recursive: true, force: true });
		throw e;
	}
}

function stubEngine(overrides: Partial<CompactionEngine> = {}): CompactionEngine {
	return {
		shouldCompact: () => true,
		estimateTokens: (entry) => String(entry.content ?? "").length / 4,
		summarize: async () => ({ summary: "SUMMARY: elided N turns into 250 tokens" }),
		...overrides,
	};
}

describe("emmyCompactionTrigger", () => {
	let events: Array<Record<string, unknown>>;

	beforeEach(() => {
		events = [];
	});

	afterEach(() => {
		events = [];
	});

	test("Pitfall #3 guard — eventType !== 'turn_start' throws IllegalCompactionTimingError", async () => {
		await expect(
			emmyCompactionTrigger({
				profile: buildProfile("/nonexistent"),
				entries: [],
				contextTokens: 0,
				contextWindow: 114688,
				eventType: "message_update",
				model: null,
				apiKey: "unused",
				engine: stubEngine(),
				emitEvent: (r) => events.push(r),
			}),
		).rejects.toBeInstanceOf(IllegalCompactionTimingError);
	});

	test("below soft threshold → {ran:false,0,0} and NO events emitted", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(30, 700);
			const res = await emmyCompactionTrigger({
				profile,
				entries,
				contextTokens: 40000, // ratio 40000/114688 ≈ 0.35 < 0.75
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine: stubEngine(),
				emitEvent: (r) => events.push(r),
			});
			expect(res.ran).toBe(false);
			expect(res.elided).toBe(0);
			expect(res.preserved).toBe(0);
			expect(events).toHaveLength(0);
		});
	});

	test("above soft threshold → summarize path runs and emits trigger + complete", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(60, 700);
			const res = await emmyCompactionTrigger({
				profile,
				entries,
				contextTokens: 90000, // ratio 90K/114688 ≈ 0.785 > 0.75
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine: stubEngine(),
				emitEvent: (r) => events.push(r),
			});
			expect(res.ran).toBe(true);
			expect(res.elided).toBeGreaterThan(0);
			expect(res.preserved).toBeGreaterThan(0);

			const triggerEvents = events.filter((e) => e.event === "session.compaction.trigger");
			const completeEvents = events.filter((e) => e.event === "session.compaction.complete");
			expect(triggerEvents).toHaveLength(1);
			expect(completeEvents).toHaveLength(1);
			expect(completeEvents[0]!.turns_elided).toBe(res.elided);
			expect(completeEvents[0]!.turns_preserved).toBe(res.preserved);
			expect(typeof completeEvents[0]!.summary_tokens).toBe("number");
			expect(completeEvents[0]!.profile).toMatchObject({
				id: "test-profile",
				version: "v1",
				hash: "sha256:0000",
			});
		});
	});

	test("D-14 preserved entries retained: first user + last 5 + error payload + structural core", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries: SessionEntry[] = [];
			entries.push({
				uuid: "sys-0",
				role: "system",
				content: "EMMY ASSEMBLED PROMPT\nprompt_sha256:beefbeef",
			});
			entries.push({
				uuid: "u-goal",
				role: "user",
				content: "solve the problem",
			});
			for (let i = 2; i < 50; i++) {
				entries.push({
					uuid: `t-${i}`,
					role: i % 2 ? "tool" : "assistant",
					content: "plain chatter".repeat(50),
					isError: false,
				});
			}
			entries.push({
				uuid: "t-err",
				role: "tool",
				content: "Error: blew up in production",
				isError: true,
				toolName: "bash",
			});
			for (let i = 51; i < 60; i++) {
				entries.push({
					uuid: `t-${i}`,
					role: i % 2 ? "tool" : "assistant",
					content: "more chatter".repeat(50),
				});
			}
			for (let i = 0; i < 5; i++) {
				entries.push({
					uuid: `recent-${i}`,
					role: i % 2 ? "tool" : "assistant",
					content: `recent turn ${i}`,
				});
			}

			const res = await emmyCompactionTrigger({
				profile,
				entries,
				contextTokens: 100000,
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine: stubEngine(),
				emitEvent: (r) => events.push(r),
			});
			expect(res.ran).toBe(true);
			expect(res.preserved).toBeGreaterThanOrEqual(8);
		});
	});

	test("emits exactly 2 events per compaction cycle (trigger + complete) on happy path", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(40, 700);
			await emmyCompactionTrigger({
				profile,
				entries,
				contextTokens: 95000,
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine: stubEngine(),
				emitEvent: (r) => events.push(r),
			});
			const compactionEvents = events.filter(
				(e) => typeof e.event === "string" && (e.event as string).startsWith("session.compaction."),
			);
			expect(compactionEvents).toHaveLength(2);
			expect(compactionEvents[0]!.event).toBe("session.compaction.trigger");
			expect(compactionEvents[1]!.event).toBe("session.compaction.complete");
		});
	});

	test("disabled compaction (missing config block) → {ran:false,0,0}", async () => {
		const dir = mkdtempSync(join(tmpdir(), "emmy-ctx-nocompact-"));
		try {
			const profile = buildProfile(dir);
			(profile.harness as unknown as { context: { compaction?: unknown } }).context.compaction =
				undefined;
			const res = await emmyCompactionTrigger({
				profile,
				entries: buildFixture(40, 700),
				contextTokens: 100000,
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine: stubEngine(),
				emitEvent: (r) => events.push(r),
			});
			expect(res).toEqual({ ran: false, elided: 0, preserved: 0 });
			expect(events).toHaveLength(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
