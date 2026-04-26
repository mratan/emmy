// Plan 04.4-07 Task 1 — V1 trigger timing + verbatim profile-content tests.
// References: COMPACTION-DESIGN.md §8 V1, D-16 fallback semantics, D-3X invariant.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	emmyCompactionTrigger,
	type CompactionEngine,
	type EmmyCompactionContext,
} from "../src";
import type { ProfileSnapshot } from "@emmy/provider";

const REPO_ROOT = resolve(__dirname, "../../..");

const PROFILES = [
	"profiles/qwen3.6-35b-a3b/v3.1/prompts/compact.md",
	"profiles/qwen3.6-27b/v1.1/prompts/compact.md",
	"profiles/gemma-4-26b-a4b-it/v2/prompts/compact.md",
	"profiles/gemma-4-31b-it/v1.1/prompts/compact.md",
];

const V1_PROMPT_VERBATIM =
	"Summarize the conversation above so a fresh context can resume the work. Preserve: explicit goals, decisions made, errors and their resolutions, files modified and their final state. Drop: dead-end exploration, redundant tool calls, transient state.\n";

function buildProfile(bundlePath: string): ProfileSnapshot {
	const harness: Record<string, unknown> = {
		tools: { format: "openai", grammar: null, per_tool_sampling: {} },
		agent_loop: { retry_on_unparseable_tool_call: 2 },
		// Inject the harness.context.compaction block directly — needed for
		// loadCompactionConfig() to return non-null. The Phase 3 ProfileSnapshot
		// type doesn't declare context, so we cast through unknown.
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
		ref: { id: "test", version: "v1", hash: "sha256:h", path: bundlePath },
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

function buildStubCtx(args: {
	contextTokens: number;
	contextWindow: number;
	profileFixture: string;
	summarizeImpl?: CompactionEngine["summarize"];
	recorder?: Array<{ event: string; [k: string]: unknown }>;
}): EmmyCompactionContext {
	const events = args.recorder ?? [];
	const stubEngine: CompactionEngine = {
		shouldCompact: (() =>
			true) as unknown as CompactionEngine["shouldCompact"],
		estimateTokens: (e: { content?: unknown }) =>
			String(e.content ?? "").length / 4,
		summarize:
			args.summarizeImpl ??
			(async () => ({ summary: "stub-summary" })),
	};
	// Need enough entries that some are NOT in the recent-5 preservation set
	// — otherwise prepareCompactionLocal returns null and the trigger short-
	// circuits to {ran:false}. 12 turns ⇒ 7+ summarizable.
	const entries = [];
	for (let i = 0; i < 12; i++) {
		entries.push({
			uuid: `u${i}`,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `turn ${i} body content with substance`.repeat(10),
		});
	}
	return {
		profile: buildProfile(args.profileFixture),
		entries,
		contextTokens: args.contextTokens,
		contextWindow: args.contextWindow,
		eventType: "turn_start",
		model: null,
		apiKey: "stub",
		engine: stubEngine,
		emitEvent: (rec) => events.push(rec),
	};
}

describe("V1 — compaction trigger fires within ±5% of soft threshold", () => {
	const max = 100_000;
	const PROFILE_DIR = resolve(REPO_ROOT, "profiles/qwen3.6-35b-a3b/v3.1");

	test("skips at 5% below threshold (0.94 × 0.75 = 0.705)", async () => {
		const ctx = buildStubCtx({
			contextTokens: 0.94 * 0.75 * max,
			contextWindow: max,
			profileFixture: PROFILE_DIR,
		});
		const r = await emmyCompactionTrigger(ctx);
		expect(r.ran).toBe(false);
		expect(r.elided).toBe(0);
	});

	test("runs at threshold crossing (1.0 × 0.75 = 0.75)", async () => {
		const ctx = buildStubCtx({
			contextTokens: 1.0 * 0.75 * max,
			contextWindow: max,
			profileFixture: PROFILE_DIR,
		});
		const r = await emmyCompactionTrigger(ctx);
		expect(r.ran).toBe(true);
	});

	test("runs at 6% over threshold (1.06 × 0.75 = 0.795)", async () => {
		const ctx = buildStubCtx({
			contextTokens: 1.06 * 0.75 * max,
			contextWindow: max,
			profileFixture: PROFILE_DIR,
		});
		const r = await emmyCompactionTrigger(ctx);
		expect(r.ran).toBe(true);
	});
});

describe("V1 — all 4 profile compact.md files are v1 verbatim (D-3X / COMPACTION-DESIGN.md §3)", () => {
	for (const rel of PROFILES) {
		test(`${rel} matches v1 verbatim`, () => {
			const content = readFileSync(resolve(REPO_ROOT, rel), "utf8");
			expect(content).toBe(V1_PROMPT_VERBATIM);
		});
	}
	test("all 4 profile compact.md files are byte-identical to each other", () => {
		const hashes = PROFILES.map((r) =>
			createHash("sha256")
				.update(readFileSync(resolve(REPO_ROOT, r)))
				.digest("hex"),
		);
		const distinct = new Set(hashes);
		expect(distinct.size).toBe(1);
	});
	test("v1 prompt is ≤ 50 tokens (word-split approximation)", () => {
		const tokenCount = V1_PROMPT_VERBATIM.trim().split(/\s+/).length;
		expect(tokenCount).toBeLessThanOrEqual(50);
	});
});
