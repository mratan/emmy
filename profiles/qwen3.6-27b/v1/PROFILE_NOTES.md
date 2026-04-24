---
profile_id: qwen3.6-27b
profile_version: v1
created: 2026-04-24
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: <will-be-written-by-find_kv_budget>
  gpu_clock_p5_hour2_mhz: 2476
  gpu_clock_p50_hour2_mhz: 2476
  decode_throughput_p50_hour2_tokps: 7.6
  decode_throughput_p1_hour2_tokps: 6.5
  cold_start_seconds: <will-be-written-by-smoke_test>
  warm_throughput_tokps: <will-be-written-by-smoke_test>
validation_runs: []
---

# Qwen3.6-27B-FP8 — v1 Profile Notes

Phase 4.1 dense sibling profile. Qwen3.6-27B-FP8 (Qwen dense, 27B params) served
in the emmy-serve NGC fastsafetensors image on DGX Spark GB10. Clone-and-retarget
from `qwen3.6-35b-a3b@v3.1`; diffs limited to model path, served_model_name,
container digest (re-verified), and the post-bisection gpu_memory_utilization.
Daily-driver default stays on `qwen3.6-35b-a3b@v3.1` — this profile is additive
and opt-in via `/profile qwen3.6-27b`.

## Phase 4.1 clone provenance

Clone source: `profiles/qwen3.6-35b-a3b/v3.1/` (source hash
`sha256:f9dcabd1dbee8f29b7ee8439140da83d84e9784dab08a1304474e1d06901fc73`).

Retargeted fields (`serving.yaml`):

| Field | v3.1 source value | v1 dense value |
|-------|-------------------|----------------|
| `engine.model` | `/models/Qwen3.6-35B-A3B-FP8` | `/models/Qwen3.6-27B-FP8` |
| `engine.model_hf_id` | `Qwen/Qwen3.6-35B-A3B-FP8` | `Qwen/Qwen3.6-27B-FP8` |
| `engine.served_model_name` | `qwen3.6-35b-a3b` | `qwen3.6-27b` |
| `engine.container_image_digest` | `sha256:77321e416cf49702ed6f04af9e5d39945726fea48970bb013617fddc659f9486` | `sha256:77321e416cf49702ed6f04af9e5d39945726fea48970bb013617fddc659f9486` (re-verified 2026-04-24; see `runs/phase4.1-qwen-kv/container-inspect.txt`) |
| `engine.gpu_memory_utilization` | `0.55` | SEED `0.55` — overwritten by `find_kv_budget.py` |

Retargeted fields (`profile.yaml`):

| Field | v3.1 source value | v1 dense value |
|-------|-------------------|----------------|
| `id` | `qwen3.6-35b-a3b` | `qwen3.6-27b` |
| `version` | `v3.1` | `v1` |
| `base_model` | `Qwen/Qwen3.6-35B-A3B-FP8` | `Qwen/Qwen3.6-27B-FP8` |
| `description` | Phase 3.1 v3.1 operational polish | Phase 4.1 dense sibling |
| `created` | `2026-04-22` | `2026-04-24` |
| `tags` | `[coding, dgx-spark, fp8, qwen3.6, phase-3, phase-3.1]` | `[coding, dgx-spark, fp8, qwen3.6, phase-4.1, dense]` |
| `hash` | `sha256:f9dcabd1...` | `sha256:PENDING` → recomputed via `emmy profile hash --write` |
| `community_sources` | v3.1 list (5 entries) | Qwen3.6-27B-FP8 HF card + vLLM Qwen3.5/3.6 recipes (2 entries) |

Byte-identical from v3.1 (no dense-specific changes): `harness.yaml`, `prompts/*`,
`tool_schemas/*` (9 JSON files), `grammars/tool_call.lark`, all other `serving.yaml`
fields (`max_model_len: 131072`, `kv_cache_dtype: fp8`, `enable_prefix_caching: true`,
`enable_chunked_prefill: true`, `max_num_batched_tokens: 8192`, `load_format:
fastsafetensors`, `quantization: fp8`, `tool_call_parser: qwen3_coder`,
`enable_auto_tool_choice: true`, `attention_backend: flashinfer`, `host: 0.0.0.0`,
`port: 8000`), sampling defaults (temperature 0.2, top_p 0.95, top_k 40,
repetition_penalty 1.05, max_tokens 8192), `speculative: null`, `guided_decoding:
xgrammar`, quirks, env.

Rationale for byte-identical prompt / tool / grammar clone: per Phase 4.1 research
(04.1-CONTEXT.md § "Research already done"), Qwen3.6-27B dense shares tokenizer,
chat template, and tool-call format with the 35B-A3B MoE sibling. No dense-specific
adjustments are required at the profile layer.

## Provenance of defaults (PROFILE-05)

Every non-trivial default is sourced below. Same table as v3.1 — copied verbatim
because the dense variant inherits the entire Qwen3.6 family default surface.

### Engine

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `container_image` | `emmy-serve/vllm:26.03.post1-fst` | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` + fastsafetensors layer via `scripts/build_emmy_image.sh` | 2026-04-24 (re-verified) |
| `container_image_digest` | `sha256:77321e416cf4...9486` | `docker inspect --format '{{.Id}}' emmy-serve/vllm:26.03.post1-fst` | 2026-04-24 |
| `load_format: fastsafetensors` | Set | STACK.md + CLAUDE.md § Pinned Tech Stack ("fastsafetensors ~3× cold-start speedup") | 2026-04-20 |
| `kv_cache_dtype: fp8` | Set | [vLLM Qwen3.5/3.6 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) | 2026-04-24 |
| `tool_call_parser: qwen3_coder` | Set | [vLLM Qwen3 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) — Qwen3-Coder XML format | 2026-04-24 |
| `attention_backend: flashinfer` | Set | STACK.md + GB10 requirement | 2026-04-18 |
| `enable_prefix_caching: true` | Set | SERVE-07 project requirement + vLLM 0.19 default | — |
| `enable_chunked_prefill: true` | Set | SERVE-07 + vLLM 0.19 V1 default | — |
| `gpu_memory_utilization` | SEED `0.55` → `<FINAL>` (post-finder) | D-13 automated finder; `scripts/find_kv_budget.py` is sole writer (Pitfall #1) | 2026-04-24 |
| `max_num_batched_tokens: 8192` | Set | v3.1 Phase-3.1 tuning (D-29 RAM headroom); interactive-latency threshold | 2026-04-22 |

### Sampling

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `temperature: 0.2` | Set | [Qwen3.6 HF model card](https://huggingface.co/Qwen/Qwen3.6-27B-FP8) sampling defaults | 2026-04-24 |
| `top_p: 0.95` | Set | Qwen3.6 HF model card | 2026-04-24 |
| `top_k: 40` | Set | Qwen3.6 HF model card | 2026-04-24 |
| `repetition_penalty: 1.05` | Set | Qwen3.6 HF model card | 2026-04-24 |

### Why `speculative: null`

Speculative decoding deferred to Phase 6 per ROADMAP.md + PITFALLS.md #4. Paired
spec-on/spec-off benchmark is the gate; no-spec baseline recorded here when
KV + thermal validation completes.

## KV bisection result

Converged 2026-04-24. `scripts/find_kv_budget.py` ran 11 iterations against
`profiles/qwen3.6-27b/v1` on DGX Spark (run_id `20260424T085651Z_099b55-kv-finder`).

| Field | Value |
|---|---|
| `gpu_memory_utilization` (final) | **0.86** |
| Highest clean value | 0.91 |
| First-preemption value | 0.915 (narrowest-bisection boot-timeout) |
| Initial value | 0.75 |
| Safety margin applied | 5 percentage points (0.91 − 0.05 = 0.86) |
| Iterations | 11 (of 12 max) |
| Total duration | 11869s (~3.3 h) |
| Hardware | DGX Spark GB10 (hardware_id: spark-ff85) |
| vLLM image | `emmy-serve/vllm:26.03.post1-fst` (NGC 26.03.post1-py3 + fastsafetensors) |

Iteration walk:

| Iter | value | verdict | p50 latency (ms) | preemptions |
|---:|---:|---|---:|---:|
| 0 | 0.7500 | clean | 268,404 | 0 |
| 1 | 0.7700 | clean | 208,908 | 0 |
| 2 | 0.7900 | clean | 156,022 | 0 |
| 3 | 0.8100 | clean | 290,176 | 0 |
| 4 | 0.8300 | clean | 205,335 | 0 |
| 5 | 0.8500 | clean | 300,056 | 0 |
| 6 | 0.8700 | clean | 248,154 | 0 |
| 7 | 0.8900 | clean | 258,783 | 0 |
| 8 | 0.9100 | clean | 300,114 | 0 |
| 9 | 0.9300 | boot_failure (wait_for_vllm 900s timeout) | — | — |
| 10 | 0.9200 | boot_failure (wait_for_vllm 900s timeout) | — | — |
| 11 | 0.9150 | boot_failure (wait_for_vllm 900s timeout) | — | — |

All 9 recorded clean iterations completed a 10-min sustained-load drive with
zero preemption and zero OOM. 3 bisection failures above 0.91 were boot-
timeouts (`/v1/models did not respond in 900s`) — classified as preemption-
equivalent per the Phase 1 `fix(01-04): classify start_emmy boot-timeout as
preemption-equivalent` discipline. The true ceiling is between 0.91 (last
clean) and 0.915 (narrowest-bisection failure); the 5-point safety margin
absorbs both.

The same 0.86 final value landed on Qwen 35B-A3B MoE's v3 bundle (Phase 1),
and on Gemma 4 26B A4B MoE's v2 bundle (Phase 4). Consistent behavior
across 3 different model families on identical GB10 / 128 GB UMA hardware —
a natural ceiling more about the DGX Spark node than the model.

Run artifacts: `runs/20260424T085651Z_099b55-kv-finder/{summary.json,iterations.jsonl}`.
Prior false-positive run (first attempt, canary probe bug) at
`runs/20260424T085130Z_f480a7-kv-finder/` retained for audit trail; was
triggered by the tool_call canary's 128-token ceiling cutting off Qwen3.6-27B
dense's reasoning prefix (fixed via `fix(canary,tool_call): bump max_tokens
128 → 2048 for reasoning-style dense models`).

After Task 7 completes, `uv run emmy profile validate profiles/qwen3.6-27b/v1`
exits 0 (hash realigned to `sha256:314527e184ac0f192f19df73e6eb9ef703db3983303b17e4992f6291f8863877`).

## Thermal validation

<to be populated after Tasks 8 and 9>

Expected shape (reference `runs/phase4-thermal/pass2-assert-floors/summary.json`):

```
preemptions_hour2: 0
oom_events: 0
decode_throughput_p50_hour2_tokps: <observed>
decode_throughput_p1_hour2_tokps: <observed>
gpu_clock_p5_hour2_mhz: <observed>
gpu_clock_p50_hour2_mhz: <observed>
gpu_temp_p95_hour2_c: <observed>
target_wall_time_s: 7200
actual_wall_time_s: ~7200
```

Pass gate: `preemptions_hour2 == 0` AND `oom_events == 0`. Tok/s floors are
recorded by pass 1 and asserted by pass 2's default logic, but per operator
directive tok/s is NOT a blocking gate for this profile (see § Throughput
observation below).

## Throughput observation (informational, NOT a gate)

Per operator directive 2026-04-24 (`~/.claude/projects/-data-projects-emmy/memory/feedback_dense_model_throughput.md`),
dense variants are bandwidth-bound by design. Observed tok/s is recorded here
for Phase 5 eval context but is NOT an acceptance gate for this profile.

Expected range for Qwen3.6-27B-FP8 on DGX Spark GB10 per Phase 4.1 research:
**~40-55 tok/s** (bandwidth-bound dense vs ~75 tok/s for the 35B-A3B MoE, which
activates only 3B params per token).

Acceptance criterion for this profile is thermal stability (zero preemptions,
zero OOM, recorded floors) — NOT throughput.

<to be populated after smoke test + thermal passes>

## Prefix-order policy (SERVE-07)

Prompts are assembled in this order, never reordered, for maximum KV-cache reuse:

1. System prompt (static across a session)
2. AGENTS.md / project context (static across a session)
3. Tool definitions (static across a session)
4. Conversation history (grows turn-by-turn)
5. Latest user message

Reordering any of 1-3 busts prefix cache. This rule is a profile contract.

## Deferred / future

- Spec decode (Phase 6); when enabled, bump to v2 with `speculative:` block and
  paired benchmark recorded here.
- NVFP4 quantization: disqualified by STACK.md D-13 (−23.6 % at 32K context on
  GB10). Do not re-investigate without new hardware/silicon data.
- Head-to-head benchmark vs Qwen3.6-35B-A3B MoE: Phase 5 eval territory.

### KV-finder result (run 20260424T085130Z_f480a7)

| Measurement | Value |
|---|---|
| `gpu_memory_utilization` (final) | 0.7 |
| First-preemption value | 0.75 |
| Highest clean value | 0.75 |
| Iterations | 0 |
| Hardware | spark-ff85 |
| Run artifact | `runs/20260424T085130Z_f480a7-kv-finder/` |

### KV-finder result (run 20260424T085651Z_099b55)

| Measurement | Value |
|---|---|
| `gpu_memory_utilization` (final) | 0.86 |
| First-preemption value | 0.915 |
| Highest clean value | 0.91 |
| Iterations | 11 |
| Hardware | spark-ff85 |
| Run artifact | `runs/20260424T085651Z_099b55-kv-finder/` |
