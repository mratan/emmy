// packages/emmy-context/test/compaction-schema.test.ts
//
// Phase 3 Plan 03-03 Task 1 — loadCompactionConfig() schema validation tests.

import { describe, expect, test } from "bun:test";

import type { ProfileSnapshot } from "@emmy/provider";
import { CompactionConfigError, loadCompactionConfig } from "../src";

// Helper: build a minimal ProfileSnapshot whose `harness` object optionally
// carries a `context.compaction` block. The production ProfileSnapshot type
// doesn't declare the field (D-15 lives in Plan 03-07), so we cast through
// unknown — same defensive shape the loader itself uses.
function snapshotWithContext(
	context: Record<string, unknown> | undefined,
): ProfileSnapshot {
	const harnessBase = {
		tools: { format: "openai", grammar: null, per_tool_sampling: {} },
		agent_loop: { retry_on_unparseable_tool_call: 1 },
	};
	const harness: Record<string, unknown> = { ...harnessBase };
	if (context !== undefined) harness.context = context;
	return {
		ref: { id: "t", version: "v1", hash: "sha256:0", path: "/tmp" },
		serving: {
			engine: { served_model_name: "t", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.7, top_p: 0.95, max_tokens: 1024 },
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: harness as unknown as ProfileSnapshot["harness"],
	};
}

describe("loadCompactionConfig — D-15 schema validator", () => {
	test("happy path returns typed EmmyCompactionConfig", () => {
		const snapshot = snapshotWithContext({
			max_input_tokens: 114688,
			compaction: {
				soft_threshold_pct: 0.75,
				preserve_recent_turns: 5,
				summarization_prompt_path: "prompts/compact.md",
				preserve_tool_results: "error_only",
			},
		});
		const cfg = loadCompactionConfig(snapshot);
		expect(cfg).not.toBeNull();
		expect(cfg!.soft_threshold_pct).toBe(0.75);
		expect(cfg!.preserve_recent_turns).toBe(5);
		expect(cfg!.summarization_prompt_path).toBe("prompts/compact.md");
		expect(cfg!.preserve_tool_results).toBe("error_only");
	});

	test("no compaction block returns null (compaction-disabled)", () => {
		const snapshot = snapshotWithContext({ max_input_tokens: 114688 });
		expect(loadCompactionConfig(snapshot)).toBeNull();
	});

	test("no context block returns null (compaction-disabled)", () => {
		const snapshot = snapshotWithContext(undefined);
		expect(loadCompactionConfig(snapshot)).toBeNull();
	});

	test("missing soft_threshold_pct throws CompactionConfigError with dotted path", () => {
		const snapshot = snapshotWithContext({
			max_input_tokens: 114688,
			compaction: {
				// soft_threshold_pct missing
				preserve_recent_turns: 5,
				summarization_prompt_path: "prompts/compact.md",
				preserve_tool_results: "error_only",
			},
		});
		expect(() => loadCompactionConfig(snapshot)).toThrow(CompactionConfigError);
		try {
			loadCompactionConfig(snapshot);
		} catch (err) {
			expect(err).toBeInstanceOf(CompactionConfigError);
			expect((err as CompactionConfigError).dottedPath).toBe(
				"context.compaction.soft_threshold_pct",
			);
		}
	});

	test("out-of-range soft_threshold_pct throws with actual value preserved", () => {
		const snapshot = snapshotWithContext({
			compaction: {
				soft_threshold_pct: 1.5,
				preserve_recent_turns: 5,
				summarization_prompt_path: "prompts/compact.md",
				preserve_tool_results: "error_only",
			},
		});
		expect(() => loadCompactionConfig(snapshot)).toThrow(/\[0, 1\]/);
		try {
			loadCompactionConfig(snapshot);
		} catch (err) {
			expect((err as CompactionConfigError).actualValue).toBe(1.5);
		}
	});

	test("preserve_tool_results not in enum throws", () => {
		const snapshot = snapshotWithContext({
			compaction: {
				soft_threshold_pct: 0.75,
				preserve_recent_turns: 5,
				summarization_prompt_path: "prompts/compact.md",
				preserve_tool_results: "ERRORS_ONLY",
			},
		});
		expect(() => loadCompactionConfig(snapshot)).toThrow(CompactionConfigError);
		try {
			loadCompactionConfig(snapshot);
		} catch (err) {
			expect((err as CompactionConfigError).dottedPath).toBe(
				"context.compaction.preserve_tool_results",
			);
		}
	});

	test("negative preserve_recent_turns throws", () => {
		const snapshot = snapshotWithContext({
			compaction: {
				soft_threshold_pct: 0.75,
				preserve_recent_turns: -1,
				summarization_prompt_path: "prompts/compact.md",
				preserve_tool_results: "error_only",
			},
		});
		expect(() => loadCompactionConfig(snapshot)).toThrow(CompactionConfigError);
	});

	test("empty summarization_prompt_path throws", () => {
		const snapshot = snapshotWithContext({
			compaction: {
				soft_threshold_pct: 0.75,
				preserve_recent_turns: 5,
				summarization_prompt_path: "",
				preserve_tool_results: "error_only",
			},
		});
		expect(() => loadCompactionConfig(snapshot)).toThrow(CompactionConfigError);
	});
});
