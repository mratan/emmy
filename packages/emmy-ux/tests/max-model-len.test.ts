// packages/emmy-ux/tests/max-model-len.test.ts
//
// RED tests for computeMaxInputTokens (Plan 02-04 Task 1).
//   - Happy path: (0.88, 131072, 16384) → 114688
//   - Low gpu_memory_utilization → MaxModelLenError
//   - Zero / negative max_model_len → MaxModelLenError
//   - Output reserve >= max_model_len → MaxModelLenError
//
// Plan-07 regression (SC-5): skipped until Plan 07 fills harness.yaml v2 with the
// computed max_input_tokens. Marker: TODO(plan-07).

import { describe, expect, test } from "bun:test";
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

// TODO(plan-07): un-skip once Plan 07 fills
// profiles/qwen3.6-35b-a3b/v2/harness.yaml:context.max_input_tokens with the
// honest value matching PROFILE_NOTES.md measured_values.gpu_memory_utilization
// and serving.yaml.engine.max_model_len. SC-5 consistency regression.
test.skip("[TODO(plan-07)] harness.yaml v2 context.max_input_tokens is consistent with computeMaxInputTokens", () => {
  // Intentionally left skipped. See marker above.
  expect(true).toBe(true);
});
