// Plan 04.4-07 Task 1 — V7 D-16 structured-pruning fallback engages.
// References: COMPACTION-DESIGN.md §8 V7; D-16 fallback behavior.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
	emmyCompactionTrigger,
	type CompactionEngine,
	type EmmyCompactionContext,
	type SessionEntry,
} from "../src";
import type { ProfileSnapshot } from "@emmy/provider";

const REPO_ROOT = resolve(__dirname, "../../..");
const PROFILE_DIR = resolve(REPO_ROOT, "profiles/gemma-4-26b-a4b-it/v2.1");

function buildProfile(): ProfileSnapshot {
	const harness: Record<string, unknown> = {
		tools: { format: "openai", grammar: null, per_tool_sampling: {} },
		agent_loop: { retry_on_unparseable_tool_call: 2 },
		context: {
			max_input_tokens: 114688,
			compaction: {
				soft_threshold_pct: 0.75,
				preserve_recent_turns: 5,
				summarization_prompt_path: "prompts/compact.md",
				preserve_tool_results: "error_only",
			},
		},
	};
	return {
		ref: { id: "test", version: "v1", hash: "sha256:h", path: PROFILE_DIR },
		serving: {
			engine: { served_model_name: "t", max_model_len: 131072 },
			sampling_defaults: {
				temperature: 0.2,
				top_p: 0.95,
				max_tokens: 8192,
				stop: [],
			},
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: harness as ProfileSnapshot["harness"],
	};
}

function makeEntries(n: number): SessionEntry[] {
	const out: SessionEntry[] = [];
	for (let i = 0; i < n; i++) {
		out.push({
			uuid: `u${i}`,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `turn ${i} body`.repeat(20),
		});
	}
	return out;
}

function buildCtxN(
	entries: SessionEntry[],
	summarizeImpl: CompactionEngine["summarize"],
	recorder: Array<{ event: string; [k: string]: unknown }>,
): EmmyCompactionContext {
	return {
		profile: buildProfile(),
		entries,
		contextTokens: 80_000,
		contextWindow: 100_000,
		eventType: "turn_start",
		model: null,
		apiKey: "stub",
		engine: {
			shouldCompact: (() =>
				true) as unknown as CompactionEngine["shouldCompact"],
			estimateTokens: (e: { content?: unknown }) =>
				String(e.content ?? "").length / 4,
			summarize: summarizeImpl,
		},
		emitEvent: (rec) => recorder.push(rec),
	};
}

describe("V7 — D-16 structured-pruning fallback engages on persistent failure", () => {
	test("single persistent throw engages fallback with elided > 0", async () => {
		const recorder: Array<{ event: string; [k: string]: unknown }> = [];
		const r = await emmyCompactionTrigger(
			buildCtxN(
				makeEntries(12),
				async () => {
					throw new Error("dead");
				},
				recorder,
			),
		);
		expect(r.fallback).toBe(true);
		expect(r.ran).toBe(true);
		expect(r.elided).toBeGreaterThan(0);
		expect(
			recorder.find((e) => e.event === "session.compaction.fallback"),
		).toBeDefined();
	});

	test("structuredPruneFallback elides oldest non-preserved entries", async () => {
		const recorder: Array<{ event: string; [k: string]: unknown }> = [];
		const r = await emmyCompactionTrigger(
			buildCtxN(
				makeEntries(12),
				async () => {
					throw new Error("dead");
				},
				recorder,
			),
		);
		expect(r.fallback).toBe(true);
		expect(r.preserved).toBeGreaterThan(0);
		expect(r.elided).toBeGreaterThanOrEqual(1);
	});

	test("three back-to-back throws each emit a fallback event (3 distinct triggers)", async () => {
		const recorder: Array<{ event: string; [k: string]: unknown }> = [];
		const stub: CompactionEngine["summarize"] = async () => {
			throw new Error("dead");
		};
		const r1 = await emmyCompactionTrigger(
			buildCtxN(makeEntries(12), stub, recorder),
		);
		const r2 = await emmyCompactionTrigger(
			buildCtxN(makeEntries(12), stub, recorder),
		);
		const r3 = await emmyCompactionTrigger(
			buildCtxN(makeEntries(12), stub, recorder),
		);
		expect([r1.fallback, r2.fallback, r3.fallback]).toEqual([
			true,
			true,
			true,
		]);
		expect(
			recorder.filter((e) => e.event === "session.compaction.fallback")
				.length,
		).toBe(3);
	});
});
