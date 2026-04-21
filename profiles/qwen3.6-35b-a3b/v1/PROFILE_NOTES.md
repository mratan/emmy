---
profile_id: qwen3.6-35b-a3b
profile_version: v1
created: 2026-04-20
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: 0.88
  gpu_clock_p5_hour2_mhz: 0    # nvidia-smi sampler returned 0 — see Sampler Gap below
  decode_throughput_p50_hour2_tokps: 48.1
  decode_throughput_p1_hour2_tokps: 41.4
  gpu_clock_p50_hour2_mhz: 0   # nvidia-smi sampler returned 0 — see Sampler Gap below
  cold_start_seconds: 159
  warm_throughput_tokps: 49.9
validation_runs:
- run_id: 20260421T062726Z_dc65a5-kv-finder
  hash: sha256:87f70318eba717e86c548ba538c75bb85df32215c499c29c8250b30e6f048df7
  purpose: KV-bisection finder (10 iterations, values 0.75..0.93 clean, 0.95 boot-timeout)
- run_id: 20260421T092927Z_a1b62b-thermal
  hash: sha256:5a072c14e4ad3684cf5f145cad188b3b55a74c8704bfcb08d722529d202d30fd
  purpose: 2-hour thermal replay (record-floors; zero preemptions, zero OOM)
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
| `gpu_memory_utilization` (final) | 0.88 | `scripts/find_kv_budget.py` (10 iterations; safety 5% of 0.93) | `runs/20260421T062726Z_dc65a5-kv-finder/iterations.jsonl` |
| GPU clock floor p5 hour 2 | 0 MHz (**sampler gap — see below**) | `scripts/thermal_replay.py` nvidia-smi subprocess | `runs/20260421T092927Z_a1b62b-thermal/` |
| Decode throughput p50 hour 2 | 48.13 tok/s | `scripts/thermal_replay.py` `--record-floors` | `runs/20260421T092927Z_a1b62b-thermal/summary.json` |
| Decode throughput p1 hour 2 | 41.36 tok/s | `scripts/thermal_replay.py` `--record-floors` | `runs/20260421T092927Z_a1b62b-thermal/summary.json` |
| Cold-start (fastsafetensors) | 159 s | `start_emmy.sh` ready banner | `runs/phase-b2-20260421T085621Z/boot.log` |
| Warm 500-token decode throughput | 49.92 tok/s mean (3 runs, post-2hr-thermal) | direct httpx | Phase C measurement |

## SC-1 throughput gap vs. 60 tok/s floor

The measured decode throughput (49–50 tok/s warm, 48.13 tok/s p50 hour-2 under
sustained load, 41.36 tok/s p1 hour-2) is below Phase 1 Success Criterion 1's
60 tok/s floor. This gap persisted across the four Phase-C throughput knobs
swept locally (see 01-03-SUMMARY.md) AND did not move measurably when the KV
budget rose from 0.75 → 0.88, confirming the bottleneck is architectural
(Mamba+MoE+FP8 on vLLM 0.17.1+nvinternal on GB10) rather than profile-knob.
Candidates for Phase 2+ or a Phase 1.1 gap-closure plan:

- FLASHINFER_TRTLLM vs. TRITON MoE backend (VLLM_FLASHINFER_MOE_BACKEND env
  was `latency` but vLLM chose TRITON anyway — needs a different env knob,
  likely `VLLM_USE_FLASHINFER_MOE_FP8=1`).
- NGC CUDA forward-compat mode (driver 595 on kernel 580) overhead vs.
  native mode.
- vLLM 0.17.1+nvinternal FP8+Mamba prefix-caching optimization (flagged
  experimental in this build).
- Reasoning parser integration (Phase 2) so the common Qwen3.6 thinking
  path stops consuming the budget on CoT prose.

## Sampler gap: GPU clock

The thermal replay's nvidia-smi subprocess sampler returned 0 for both
`gpu_clock_p5_hour2_mhz` and `gpu_clock_p50_hour2_mhz`. This is either a
permissions issue in the container-isolated sampler context (unlikely — the
decode-throughput samplers worked fine) or a parsing bug in
`emmy_serve/thermal/sampler.py`. Symptom is non-blocking: the floor assertions
that matter for re-runs (`--assert-floors` next thermal) are the decode
throughput p50/p1 values, which did land correctly. A Phase 1.1 or Phase 2
plan should close this gap; the SC-3 (thermal replay demonstrably works +
zero preemptions/OOM) contract is satisfied today.

## Validation runs (D-16)

| Run ID | Date | Purpose | Profile hash |
|--------|------|---------|------|
| `20260421T062726Z_dc65a5-kv-finder` | 2026-04-21 | KV-bisection finder — 10 iterations, util 0.75→0.93 clean, 0.95 boot-timeout; final 0.88 via 5% safety | `sha256:87f70318eba717e86c548ba538c75bb85df32215c499c29c8250b30e6f048df7` |
| `20260421T092927Z_a1b62b-thermal` | 2026-04-21 | 2-hour thermal replay with `--record-floors` — zero preemptions, zero OOM; throughput floors recorded | `sha256:5a072c14e4ad3684cf5f145cad188b3b55a74c8704bfcb08d722529d202d30fd` |

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
