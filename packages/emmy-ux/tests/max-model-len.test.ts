// packages/emmy-ux/tests/max-model-len.test.ts
//
// Tests for computeMaxInputTokens.
//   - Happy path: (0.88, 131072, 16384) → 114688
//   - Low gpu_memory_utilization → MaxModelLenError
//   - Zero / negative max_model_len → MaxModelLenError
//   - Output reserve >= max_model_len → MaxModelLenError
//   - Plan-07 SC-5 regression: v2 harness.yaml.context.max_input_tokens is
//     consistent with computeMaxInputTokens(measured, serving.max_model_len, 16384).
//     Un-skipped in Plan 02-07 once harness.yaml was filled with the honest value.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import yaml from "js-yaml";
import { computeMaxInputTokens, MaxModelLenError } from "@emmy/ux";

describe("computeMaxInputTokens — happy path", () => {
  test("(0.88, 131072, 16384) → 114688", () => {
    const out = computeMaxInputTokens({
      measured_gpu_memory_utilization: 0.88,
      max_model_len: 131072,
      output_reserve_tokens: 16384,
    });
    expect(out.max_input_tokens).toBe(114688);
    expect(out.derivation).toContain("131072");
    expect(out.derivation).toContain("16384");
  });

  test("(0.90, 262144, 32768) → 229376", () => {
    const out = computeMaxInputTokens({
      measured_gpu_memory_utilization: 0.9,
      max_model_len: 262144,
      output_reserve_tokens: 32768,
    });
    expect(out.max_input_tokens).toBe(229376);
  });
});

describe("computeMaxInputTokens — error cases", () => {
  test("gpu_memory_utilization < 0.5 → MaxModelLenError", () => {
    expect(() =>
      computeMaxInputTokens({
        measured_gpu_memory_utilization: 0.3,
        max_model_len: 131072,
        output_reserve_tokens: 16384,
      }),
    ).toThrow(MaxModelLenError);
  });

  test("max_model_len <= 0 → MaxModelLenError", () => {
    expect(() =>
      computeMaxInputTokens({
        measured_gpu_memory_utilization: 0.88,
        max_model_len: 0,
        output_reserve_tokens: 16384,
      }),
    ).toThrow(MaxModelLenError);
  });

  test("output_reserve_tokens >= max_model_len → MaxModelLenError", () => {
    expect(() =>
      computeMaxInputTokens({
        measured_gpu_memory_utilization: 0.88,
        max_model_len: 16384,
        output_reserve_tokens: 16384,
      }),
    ).toThrow(MaxModelLenError);
  });
});

// Plan-07 SC-5 regression (un-skipped after harness.yaml v2 was filled by Plan 02-07):
// asserts harness.yaml.context.max_input_tokens equals
// computeMaxInputTokens(measured_gpu_memory_utilization from PROFILE_NOTES.md,
// max_model_len from serving.yaml, 16384 reserve). Any drift in any input file
// without re-running scripts/compute_max_input_tokens.ts surfaces here.
describe("Plan-07 regression — harness.yaml v2 SC-5 consistency", () => {
  test("harness.yaml v2 context.max_input_tokens matches computeMaxInputTokens", () => {
    const profileDir = resolve(__dirname, "../../../profiles/qwen3.6-35b-a3b/v2");
    const serving = yaml.load(
      readFileSync(`${profileDir}/serving.yaml`, "utf8"),
    ) as { engine: { max_model_len: number } };
    const harness = yaml.load(
      readFileSync(`${profileDir}/harness.yaml`, "utf8"),
    ) as { context: { max_input_tokens: number } };
    const notes = readFileSync(`${profileDir}/PROFILE_NOTES.md`, "utf8");
    const fm = notes.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    const measured = yaml.load(fm![1]!) as {
      measured_values: { gpu_memory_utilization: number };
    };

    const computed = computeMaxInputTokens({
      measured_gpu_memory_utilization: measured.measured_values.gpu_memory_utilization,
      max_model_len: serving.engine.max_model_len,
      output_reserve_tokens: 16384,
    });
    expect(harness.context.max_input_tokens).toBe(computed.max_input_tokens);
  });
});
