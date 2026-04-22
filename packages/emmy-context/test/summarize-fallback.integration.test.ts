// packages/emmy-context/test/summarize-fallback.integration.test.ts
//
// Phase 3 Plan 03-03 Task 2 — D-16 summarize fallback + D-12 hard-ceiling
// integration tests.
//
// Telemetry capture: in-memory via injected EmmyCompactionContext.emitEvent
// (same Plan 03-02 Pattern F avoidance strategy as trigger.test.ts).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProfileSnapshot } from "@emmy/provider";
import {
	emmyCompactionTrigger,
	SessionTooFullError,
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
			engine: { served_model_name: "t", max_model_len: 131072 },
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
	entries.push({ uuid: "sys-0", role: "system", content: "SP" });
	entries.push({ uuid: "u-1", role: "user", content: "goal" });
	for (let i = 2; i < totalTurns; i++) {
		entries.push({
			uuid: `t-${i}`,
			role: i % 2 ? "tool" : "assistant",
			content: "x".repeat(tokensPerTurn * 4),
			isError: false,
		});
	}
	return entries;
}

function withTempProfile(work: (ctx: { profile: ProfileSnapshot }) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "emmy-ctx-fb-"));
	try {
		mkdirSync(join(dir, "prompts"), { recursive: true });
		writeFileSync(join(dir, "prompts", "compact.md"), "Summarize conservatively.");
		const profile = buildProfile(dir);
		return work({ profile }).finally(() => {
			rmSync(dir, { recursive: true, force: true });
		});
	} catch (e) {
		rmSync(dir, { recursive: true, force: true });
		throw e;
	}
}

function engineWith(summarize: CompactionEngine["summarize"]): CompactionEngine {
	return {
		shouldCompact: () => true,
		estimateTokens: (entry) => String(entry.content ?? "").length / 4,
		summarize,
	};
}

describe("emmyCompactionTrigger — D-16 fallback + D-12 hard ceiling", () => {
	let events: Array<Record<string, unknown>>;

	beforeEach(() => {
		events = [];
	});
	afterEach(() => {
		events = [];
	});

	test("summarize() throws (timeout simulation) → fallback event emitted, no complete event, session continues", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(60, 700);
			const engine = engineWith(async () => {
				throw new Error("simulated timeout");
			});
			const res = await emmyCompactionTrigger({
				profile,
				entries,
				contextTokens: 95000,
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine,
				emitEvent: (r) => events.push(r),
			});
			expect(res.ran).toBe(true);
			expect(res.fallback).toBe(true);
			expect(res.elided).toBeGreaterThan(0);

			const fallbackEvents = events.filter((e) => e.event === "session.compaction.fallback");
			const completeEvents = events.filter((e) => e.event === "session.compaction.complete");
			expect(fallbackEvents).toHaveLength(1);
			expect(completeEvents).toHaveLength(0);
			expect(fallbackEvents[0]!.error as string).toContain("simulated timeout");
		});
	});

	test("summarize() returns empty-string summary → NOT a fallback; complete emitted", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(60, 700);
			const engine = engineWith(async () => ({ summary: "" }));
			const res = await emmyCompactionTrigger({
				profile,
				entries,
				contextTokens: 95000,
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine,
				emitEvent: (r) => events.push(r),
			});
			expect(res.ran).toBe(true);
			expect(res.fallback).toBeFalsy();
			const completeEvents = events.filter((e) => e.event === "session.compaction.complete");
			const fallbackEvents = events.filter((e) => e.event === "session.compaction.fallback");
			expect(completeEvents).toHaveLength(1);
			expect(fallbackEvents).toHaveLength(0);
		});
	});

	test("post-compaction still > max_input_tokens → D-12 SessionTooFullError with full diagnosticBundle", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(60, 700);
			const hugeSummary = "S".repeat(400_000);
			const engine = engineWith(async () => ({ summary: hugeSummary }));
			await expect(
				emmyCompactionTrigger({
					profile,
					entries,
					contextTokens: 95000,
					contextWindow: 114688,
					eventType: "turn_start",
					model: null,
					apiKey: "unused",
					engine,
					emitEvent: (r) => events.push(r),
				}),
			).rejects.toBeInstanceOf(SessionTooFullError);

			let caught: SessionTooFullError | null = null;
			try {
				await emmyCompactionTrigger({
					profile,
					entries,
					contextTokens: 95000,
					contextWindow: 114688,
					eventType: "turn_start",
					model: null,
					apiKey: "unused",
					engine,
					emitEvent: (r) => events.push(r),
				});
			} catch (e) {
				caught = e as SessionTooFullError;
			}
			expect(caught).not.toBeNull();
			expect(caught!.diagnosticBundle.turn_index).toBe(entries.length);
			expect(caught!.diagnosticBundle.max_input_tokens).toBe(114688);
			expect(caught!.diagnosticBundle.tokens).toBeGreaterThan(114688);
			expect(caught!.diagnosticBundle.preservation_list.length).toBeGreaterThan(0);
			expect(caught!.diagnosticBundle.compaction_attempt_result.elided).toBeGreaterThan(0);
			expect(caught!.diagnosticBundle.compaction_attempt_result.summary_tokens).toBeGreaterThan(0);
		});
	});

	test("missing compaction prompt file → D-16 fallback (NOT hard fail)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "emmy-ctx-noprompt-"));
		try {
			const profile = buildProfile(dir);
			const entries = buildFixture(60, 700);
			const engine = engineWith(async () => ({ summary: "s" }));
			const res = await emmyCompactionTrigger({
				profile,
				entries,
				contextTokens: 95000,
				contextWindow: 114688,
				eventType: "turn_start",
				model: null,
				apiKey: "unused",
				engine,
				emitEvent: (r) => events.push(r),
			});
			expect(res.ran).toBe(true);
			expect(res.fallback).toBe(true);
			const fallbackEvents = events.filter((e) => e.event === "session.compaction.fallback");
			expect(fallbackEvents).toHaveLength(1);
			expect(fallbackEvents[0]!.error as string).toContain("compaction prompt missing");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
