---
profile_id: qwen3.6-35b-a3b
profile_version: v1
created: 2026-04-20
hardware_id: dgx-spark-01                      # filled at first measurement
measured_values:
  gpu_memory_utilization: null                  # D-13 fills this
  gpu_clock_p5_hour2_mhz: null                   # D-15 fills this
  decode_throughput_p50_hour2_tokps: null        # D-15 fills this
  decode_throughput_p1_hour2_tokps: null         # D-15 fills this
  cold_start_seconds: null                       # measured at first boot
  warm_throughput_tokps: null                    # smoke-test 100-token generation
validation_runs:
  - run_id: null                                 # runs/<iso>-phase1-validation/ reference
    hash: null                                   # content hash of the run directory
---

# Qwen3.6-35B-A3B-FP8 — v1 Profile Notes

Phase 1 baseline profile. Qwen3.6-35B-A3B-FP8 (Qwen MoE, 3B active) served in
`nvcr.io/nvidia/vllm:26.03.post1-py3` on a DGX Spark.

## Provenance of defaults (PROFILE-05)

Every non-trivial default in `serving.yaml` and `harness.yaml` is sourced below.

### Engine

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `container_image` | `nvcr.io/nvidia/vllm:26.03.post1-py3` | [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm) | 2026-04-18 |
| `container_image_digest` | sha256:<DIGEST> | `docker inspect` after first pull | 2026-04-20 |
| `load_format: fastsafetensors` | Set | STACK.md + [prior repo README.md "Fast model loading"](/data/projects/setup_local_opencode/README.md) | 2026-04-20 |
| `kv_cache_dtype: fp8` | Set | [vLLM Qwen3.5/3.6 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) | 2026-04-18 |
| `tool_call_parser: qwen3_coder` | Set | [vLLM Qwen3 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) — Qwen3-Coder XML format | 2026-04-18 |
| `attention_backend: flashinfer` | Set | [NVIDIA DGX Spark vLLM thread](https://discuss.vllm.ai/t/nvidia-dgx-spark-compatibility/1756) | 2026-04-18 |
| `enable_prefix_caching: true` | Set | SERVE-07 project requirement + vLLM 0.19 default behavior | — |
| `enable_chunked_prefill: true` | Set | SERVE-07 + vLLM 0.19 V1 default | — |
| `gpu_memory_utilization` | 0.75 (initial) → <FINAL> (post-finder) | D-13 automated finder; see [runs/<iso>-kv-finder](#) | 2026-04-?? |

### Sampling

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `temperature: 0.2` | Set | [Qwen3.6 HF model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) sampling defaults | 2026-04-18 |
| `top_p: 0.95` | Set | Qwen3.6 HF model card | 2026-04-18 |
| `top_k: 40` | Set | Qwen3.6 HF model card | 2026-04-18 |
| `repetition_penalty: 1.05` | Set | Qwen3.6 HF model card | 2026-04-18 |

### Why `speculative: null`

Speculative decoding (Qwen3-MTP) deferred to Phase 6 per ROADMAP.md + PITFALLS.md #4.
Paired spec-on/spec-off benchmark is the gate; we don't have the eval harness until
Phase 5, so measuring correctly isn't possible yet. No-spec baseline is recorded
here as the Phase 1 measured throughput.

## Prefix-order policy (SERVE-07)

Prompts are assembled in this order, never reordered, for maximum KV-cache reuse:

1. System prompt (static across a session)
2. AGENTS.md / project context (static across a session)   ← Phase 2 fills
3. Tool definitions (static across a session)              ← Phase 2 fills
4. Conversation history (grows turn-by-turn)
5. Latest user message

Reordering any of 1-3 busts prefix cache. This rule is a profile contract.

## Measured-values log (D-15, D-16)

| Measurement | Value | Method | Run artifact |
|-------------|-------|--------|--------------|
| `gpu_memory_utilization` (final) | <filled by D-13> | `scripts/find_kv_budget.py` | [`runs/<iso>-kv-finder/`](#) |
| GPU clock floor p5 hour 2 | <filled> MHz | `scripts/thermal_replay.py` | [`runs/<iso>-thermal/`](#) |
| Decode throughput p50 hour 2 | <filled> tok/s | `scripts/thermal_replay.py` | [`runs/<iso>-thermal/`](#) |
| Decode throughput p1 hour 2 | <filled> tok/s | `scripts/thermal_replay.py` | [`runs/<iso>-thermal/`](#) |
| Cold-start (fastsafetensors) | <filled> s | `start_emmy.sh` timing | [`runs/<iso>-thermal/`](#) |

## Validation runs (D-16)

| Run ID | Date | Purpose | Hash |
|--------|------|---------|------|
| <filled> | <date> | Initial Phase 1 validation | <sha256> |

## Deferred / future

- Spec decode (Phase 6); when enabled, bump to v2 with `speculative:` block and paired benchmark recorded here.
- `reasoning_parser` (Phase 2 will decide); if set, bump version.
- Per-tool sampling overrides (Phase 2 fills `harness.yaml.tools.per_tool_sampling`).

### KV-finder result (run 20260421T062726Z_dc65a5)

| Measurement | Value |
|---|---|
| `gpu_memory_utilization` (final) | 0.88 |
| First-preemption value | never observed (boot ceiling hit first) |
| Highest clean value | 0.93 |
| Iterations | 10 (of 12 max) |
| Iteration values walked | 0.75, 0.77, 0.79, 0.81, 0.83, 0.85, 0.87, 0.89, 0.91, 0.93 (step-up 2%) |
| Stop reason | Iteration 11 (value=0.95) `start_emmy.sh` boot-timeout at 300s — likely thermal-throttled cold-start, not preemption |
| Safety margin applied | 5.0% (`0.93 - 0.05 = 0.88`) |
| Hardware | DGX Spark (GB10 GPU) |
| vLLM image | `emmy-serve/vllm:26.03.post1-fst` (NGC 26.03.post1-py3 + fastsafetensors 0.1.14) |
| Run artifact | `runs/20260421T062726Z_dc65a5-kv-finder/iterations.jsonl` |
| Finder bug | Iteration 11's boot-timeout aborted the finder instead of classifying as "too-high → bisect down". Fixed in `fix(01-04): classify start_emmy boot-timeout as preemption-equivalent` commit. |

All 10 recorded iterations completed a 10-minute sustained-load drive with zero preemption and zero dmesg OOM hits, confirming `gpu_memory_utilization=0.88` is a conservative floor. The true ceiling is between 0.93 (last clean) and 0.95 (boot failure); the 5% safety margin absorbs both any preemption ceiling below 0.95 and thermal-throttle cold-start drift.
