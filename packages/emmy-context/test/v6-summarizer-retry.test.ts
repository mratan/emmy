// Plan 04.4-07 Task 1 — V6 auto-retry on transient summarizer failure (D-16).

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
	emmyCompactionTrigger,
	type CompactionEngine,
	type EmmyCompactionContext,
} from "../src";
import type { ProfileSnapshot } from "@emmy/provider";

const REPO_ROOT = resolve(__dirname, "../../..");
const PROFILE_DIR = resolve(REPO_ROOT, "profiles/qwen3.6-35b-a3b/v3.1");

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
		ref: {
			id: "test",
			version: "v1",
			hash: "sha256:h",
			path: PROFILE_DIR,
		},
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

function buildCtx(
	summarizeImpl: CompactionEngine["summarize"],
	recorder: Array<{ event: string; [k: string]: unknown }>,
): EmmyCompactionContext {
	const entries = [];
	for (let i = 0; i < 12; i++) {
		entries.push({
			uuid: `u${i}`,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `turn ${i} body content`.repeat(10),
		});
	}
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

describe("V6 — first throw → fallback; second call (simulates pi retry) → clean", () => {
	test("first throw engages fallback; valid stub on second call does not", async () => {
		const recorder1: Array<{ event: string; [k: string]: unknown }> = [];
		const ctx1 = buildCtx(async () => {
			throw new Error("transient timeout");
		}, recorder1);
		const r1 = await emmyCompactionTrigger(ctx1);
		expect(r1.ran).toBe(true);
		expect(r1.fallback).toBe(true);
		expect(
			recorder1.some((e) => e.event === "session.compaction.fallback"),
		).toBe(true);

		const recorder2: Array<{ event: string; [k: string]: unknown }> = [];
		const ctx2 = buildCtx(
			async () => ({ summary: "valid summary" }),
			recorder2,
		);
		const r2 = await emmyCompactionTrigger(ctx2);
		expect(r2.ran).toBe(true);
		expect(r2.fallback).toBeUndefined();
		expect(
			recorder2.some((e) => e.event === "session.compaction.complete"),
		).toBe(true);
		expect(
			recorder2.some((e) => e.event === "session.compaction.fallback"),
		).toBe(false);
	});

	test("two consecutive throws both engage fallback (no cumulative state masking)", async () => {
		const recorder: Array<{ event: string; [k: string]: unknown }> = [];
		const stub = async () => {
			throw new Error("persistent");
		};
		const r1 = await emmyCompactionTrigger(buildCtx(stub, recorder));
		const r2 = await emmyCompactionTrigger(buildCtx(stub, recorder));
		expect(r1.fallback).toBe(true);
		expect(r2.fallback).toBe(true);
		expect(
			recorder.filter((e) => e.event === "session.compaction.fallback")
				.length,
		).toBe(2);
	});
});
