---
profile_id: gemma-4-31b-it
profile_version: v1
created: 2026-04-24
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: <will-be-written-by-find_kv_budget>
  gpu_clock_p5_hour2_mhz: 2405
  gpu_clock_p50_hour2_mhz: 2496
  decode_throughput_p50_hour2_tokps: 6.3
  decode_throughput_p1_hour2_tokps: 0.7
  cold_start_seconds: <will-be-written-by-smoke_test>
  warm_throughput_tokps: <will-be-written-by-smoke_test>
validation_runs: []
---

# Gemma 4 31B-it — v1 Profile Notes

Phase 4.1 dense sibling profile. `google/gemma-4-31B-it` (dense, 30.7B params,
BF16 weights runtime-quantized to FP8) served in upstream
`vllm/vllm-openai:gemma4-0409-arm64-cu130` on DGX Spark GB10. Clone-and-retarget
from `gemma-4-26b-a4b-it@v2`; diffs limited to model path, served_model_name,
model_hf_id, and the post-bisection gpu_memory_utilization. Gemma MoE default
stays on `gemma-4-26b-a4b-it@v2` — this profile is additive and opt-in via
`/profile gemma-4-31b-it`.

## Phase 4.1 clone provenance

Clone source: `profiles/gemma-4-26b-a4b-it/v2/` (source hash
`sha256:ec14fb0980a1a5bbf41ee062d6c007d68a3ec1b872d47c5065215dfdf356fe6f`).

Retargeted fields (`serving.yaml`):

| Field | v2 source value | v1 dense value |
|-------|-----------------|----------------|
| `engine.model` | `/models/gemma-4-26B-A4B-it` | `/models/gemma-4-31B-it` |
| `engine.model_hf_id` | `google/gemma-4-26B-A4B-it` | `google/gemma-4-31B-it` |
| `engine.served_model_name` | `gemma-4-26b-a4b-it` | `gemma-4-31b-it` |
| `engine.container_image_digest` | `sha256:db59febc6c47...` | `sha256:db59febc6c47...` (same upstream vllm-openai image, re-verified 2026-04-24; see `runs/phase4.1-gemma-kv/container-inspect.txt`) |
| `engine.gpu_memory_utilization` | `0.86` | SEED `0.45` — overwritten by `find_kv_budget.py`. Seed chosen more conservative than v2 because 31B BF16 weights ≈ 61 GB of 128 GB UMA leaves less KV headroom. |

Retargeted fields (`profile.yaml`):

| Field | v2 source value | v1 dense value |
|-------|-----------------|----------------|
| `id` | `gemma-4-26b-a4b-it` | `gemma-4-31b-it` |
| `version` | `v2` | `v1` |
| `base_model` | `google/gemma-4-26B-A4B-it` | `google/gemma-4-31B-it` |
| `description` | Phase 4 v2 container upgrade | Phase 4.1 dense sibling |
| `created` | `2026-04-23` | `2026-04-24` |
| `tags` | `[coding, dgx-spark, fp8, gemma-4, phase-4, phase-4-followup]` | `[coding, dgx-spark, fp8, gemma-4, phase-4.1, dense]` |
| `hash` | `sha256:ec14fb09...` | `sha256:PENDING` → recomputed via `emmy profile hash --write` |
| `community_sources` | v2 list (9 entries) | v2 list + new entry at top: Gemma 4 31B-it HF model card |

Byte-identical from v2 (no dense-specific changes): `harness.yaml`, `prompts/*`,
`tool_schemas/*` (9 JSON files), `grammars/tool_call.lark`, all other `serving.yaml`
fields (`max_model_len: 131072`, `kv_cache_dtype: fp8`, `enable_prefix_caching: true`,
`enable_chunked_prefill: true`, `max_num_batched_tokens: 8192`, `max_num_seqs: 4`,
`load_format: safetensors`, `quantization: fp8` (runtime quant of BF16),
`tool_call_parser: gemma4`, `reasoning_parser: gemma4`, `enable_auto_tool_choice:
true`, `container_entrypoint_override: ""` (CRITICAL — without it start_emmy.sh
produces `vllm serve vllm serve` collision on this upstream image's baked
ENTRYPOINT), attention_backend unset (FlashInfer does not support Gemma 4's
head_size on this container), `host: 0.0.0.0`, `port: 8000`), sampling defaults
(Google card: temperature 1.0, top_p 0.95, top_k 64, repetition_penalty 1.0,
max_tokens 8192), `speculative: null`, `guided_decoding: xgrammar`, `quirks:
{strip_thinking_tags: true, promote_reasoning_to_content: false,
buffer_tool_streams: false}`, `env:` block.

Rationale for byte-identical prompts / schemas / grammars clone: per Phase 4.1
research (04.1-CONTEXT.md § "Research already done"), Gemma 4 dense shares
tokenizer, chat template, function-calling format, and channel-bleed behavior
with the 26B A4B MoE sibling. The `strip_thinking_tags: true` quirk (harness
backstop for vLLM 0.19.1.dev6 gemma4 reasoning_parser channel-bleed) applies
equally to dense.

## Provenance of defaults (SC-5)

### Engine

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `container_image` | `vllm/vllm-openai:gemma4-0409-arm64-cu130` | Upstream vLLM Day-1 Gemma 4 image (vLLM 0.19+, Transformers 5.5.0, aarch64, CUDA 13.0); same as v2 MoE bundle | 2026-04-24 (re-verified) |
| `container_image_digest` | `sha256:db59febc6c47...09f8` | `docker inspect --format '{{.Id}}' vllm/vllm-openai:gemma4-0409-arm64-cu130` | 2026-04-24 |
| `container_entrypoint_override` | `""` | Upstream vllm-openai ENTRYPOINT=[vllm serve] collides with emmy runner.py's CMD; empty override clears it (v2 finding carries forward) | 2026-04-23 |
| `tool_call_parser` | `gemma4` | [vLLM Gemma4 parser API docs](https://docs.vllm.ai/en/latest/api/vllm/tool_parsers/gemma4_tool_parser/) | 2026-04-23 |
| `reasoning_parser` | `gemma4` | [vLLM Gemma 4 serving recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html) + harness strip_thinking_tags backstop (channel-bleed bug) | 2026-04-24 |
| `enable_auto_tool_choice` | `true` | [vLLM Gemma 4 recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html) | 2026-04-23 |
| `quantization` | `fp8` (runtime quant of BF16) | STACK.md D-13 — NVFP4 disqualified on GB10 UMA (-23.6% at 32K context) | 2026-04-24 |
| `kv_cache_dtype` | `fp8` | [vLLM Gemma 4 recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html) | 2026-04-23 |
| `max_model_len` | `131072` | Google Gemma 4 card declares 256K native; 128K operator-cap matches v2 + Qwen | 2026-04-23 |
| `gpu_memory_utilization` | SEED `0.45` → `<FINAL>` (post-finder) | Pitfall #1 — `scripts/find_kv_budget.py` is sole writer. Seed more conservative than v2's 0.86 due to 31B BF16 weight footprint (≈61 GB vs 26B MoE's ≈25 GB) leaving less KV headroom | 2026-04-24 |
| `max_num_seqs` | `4` | [NVIDIA Gemma 4 Day-1 DGX Spark benchmarks](https://forums.developer.nvidia.com/t/gemma-4-day-1-inference-on-nvidia-dgx-spark-preliminary-benchmarks/365503); defensive against vLLM #39392 pad-token leak | 2026-04-23 |
| `max_num_batched_tokens` | `8192` | v2 tuning carries forward (RAM headroom + interactive latency) | 2026-04-23 |
| `load_format` | `safetensors` | Upstream vllm-openai image does not bundle fastsafetensors; accept ~8 min cold start (vs ~3 min NGC fastsafetensors) | 2026-04-23 |
| attention_backend | UNSET | FlashInfer does not support Gemma 4 head_size on this container (v2 observation) | 2026-04-23 |

### Sampling

Primary source: [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4).

| Field | Value | Source |
|-------|-------|--------|
| `temperature: 1.0` | Set | Google card default (vs Qwen 0.2) |
| `top_p: 0.95` | Set | Google card |
| `top_k: 64` | Set | Google card (vs Qwen 40) |
| `repetition_penalty: 1.0` | Set | Google card — no repetition damping declared |
| `max_tokens: 8192` | Set | Emmy convention |

### Why `speculative: null`

Deferred to Phase 6. EAGLE-3 availability for Gemma 4 31B dense TBD; in any case,
spec decode evaluation requires paired on/off benchmarks through the Phase 5
eval harness.

## KV bisection result

Converged 2026-04-24. `scripts/find_kv_budget.py` ran 11 iterations against
`profiles/gemma-4-31b-it/v1` on DGX Spark (run_id `20260424T165224Z_7cc616-kv-finder`).

| Field | Value |
|---|---|
| `gpu_memory_utilization` (final) | **0.86** |
| Highest clean value | 0.91 |
| First-preemption value | 0.915 (narrowest-bisection boot-timeout) |
| Initial value | 0.75 |
| Safety margin applied | 5 percentage points (0.91 − 0.05 = 0.86) |
| Iterations | 11 (of 12 max) |
| Total duration | 13802s (~3h 50min) |
| Hardware | DGX Spark GB10 (hardware_id: spark-ff85) |
| vLLM image | `vllm/vllm-openai:gemma4-0409-arm64-cu130` |

Iteration walk:

| Iter | value | verdict | p50 latency (ms) |
|---:|---:|---|---:|
| 0 | 0.7500 | clean | 166,519 |
| 1 | 0.7700 | clean | 156,371 |
| 2 | 0.7900 | clean | 166,008 |
| 3 | 0.8100 | clean | 159,588 |
| 4 | 0.8300 | clean | 158,478 |
| 5 | 0.8500 | clean | 173,267 |
| 6 | 0.8700 | clean | 170,788 |
| 7 | 0.8900 | clean | 171,126 |
| 8 | 0.9100 | clean | 175,839 |
| 9 | 0.9300 | boot_failure (wait_for_vllm 900s timeout) | — |
| 10 | 0.9200 | boot_failure (wait_for_vllm 900s timeout) | — |
| 11 | 0.9150 | boot_failure (wait_for_vllm 900s timeout) | — |

All 9 recorded clean iterations completed a 10-min sustained-load drive with
zero preemption and zero OOM. 3 bisection failures above 0.91 were boot-
timeouts (`/v1/models did not respond in 900s`) — classified as preemption-
equivalent per the Phase 1 `fix(01-04): classify start_emmy boot-timeout as
preemption-equivalent` discipline.

**Identical ceiling to Qwen 27B dense (Phase 4.1) and Gemma 4 26B MoE (Phase 4):**
all three converged at 0.86 with ok_value=0.91, preempted_at=0.915. This is
clearly a GB10 / 128 GB UMA / vLLM boot-time resource allocation ceiling,
not a model-specific limit. The 5-point safety margin absorbs both the
ceiling and any thermal-throttle cold-start drift.

Known-risk fallback (max_model_len 131072 → 65536 → 32768 → deferral) was
**not triggered** — the dense 31B fits cleanly at 131072 max_model_len and
0.86 gpu_memory_utilization.

Run artifacts: `runs/20260424T165224Z_7cc616-kv-finder/{summary.json,iterations.jsonl}`.

## Thermal validation

<to be populated after Tasks 8 and 9>

Expected shape (reference `runs/phase4-thermal/pass2-assert-floors/summary.json`):

```
preemptions_hour2: 0       # GATE
oom_events: 0              # GATE
decode_throughput_p50_hour2_tokps: <observed>   # informational, ~6-10 expected
decode_throughput_p1_hour2_tokps: <observed>    # informational
gpu_clock_p5_hour2_mhz: <observed>
gpu_clock_p50_hour2_mhz: <observed>
gpu_temp_p95_hour2_c: <observed>
target_wall_time_s: 7200
actual_wall_time_s: ~7200
profile_id: gemma-4-31b-it
profile_version: v1
profile_hash: <matches profile.yaml.hash>
```

## Throughput observation (informational, NOT a gate)

Per operator directive 2026-04-24 (`~/.claude/projects/-data-projects-emmy/memory/feedback_dense_model_throughput.md`
+ 04.1-CONTEXT.md § Plan 04.1-2 explicit throughput policy), Gemma-4-31B dense
is expected to land in the **6-10 tok/s** bandwidth-bound zone. This is **NOT**
a failure. The thermal gate is: zero preemptions + zero OOM + recorded floors.
Throughput observation is recorded here as informational context for Phase 5
eval.

CLAUDE.md § Pinned Tech Stack pre-research flagged this model as "bandwidth-bound
at 6.9 tok/s" — Phase 4.1 takes the position that this is the expected steady
state, not a problem to solve.

## Known-risk fallback branch

Per 04.1-CONTEXT.md § Known risks: **if KV bisection fails at every tested value
AND subsequent max_model_len reduction (131072 → 65536 → 32768) still fails**,
the model genuinely does not fit on this 128 GB UMA hardware. Document as a
deferral here and escalate to operator; do NOT attempt further workarounds.
This is an acceptable exit.

Fallback sequence:
1. KV bisection at seed 0.45 — if every value preempts or OOMs, proceed to step 2
2. Edit `max_model_len: 131072 → 65536`, recompute hash + re-validate, re-run bisection
3. If still failing, reduce to `max_model_len: 32768`, recompute hash + re-validate, re-run bisection
4. If 32K still fails, DEFER: append to this file a "deferred to post-Phase-5 hardware review" note and fail the plan

<fallback outcome to be populated if triggered>

## Prefix-order policy (SERVE-07)

Prompts are assembled in this order, never reordered, for maximum KV-cache reuse:

1. System prompt (static across a session)
2. AGENTS.md / project context (static across a session)
3. Tool definitions (static across a session)
4. Conversation history (grows turn-by-turn)
5. Latest user message

Reordering any of 1-3 busts prefix cache. This rule is a profile contract.

## Deferred / future

- Spec decode (Phase 6) — EAGLE-3 availability for Gemma 4 31B dense TBD
- Head-to-head benchmark vs Gemma-4-26B-A4B MoE: Phase 5 eval territory
- NVFP4 / alternative quantization: disqualified by STACK.md D-13
- fastsafetensors-derived image: possible future v2 bump if cold-start wall-clock
  becomes operationally painful (today's ~8 min is tolerated)

### KV-finder result (run 20260424T165224Z_7cc616)

| Measurement | Value |
|---|---|
| `gpu_memory_utilization` (final) | 0.86 |
| First-preemption value | 0.915 |
| Highest clean value | 0.91 |
| Iterations | 11 |
| Hardware | spark-ff85 |
| Run artifact | `runs/20260424T165224Z_7cc616-kv-finder/` |
