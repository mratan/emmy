---
profile_id: gemma-4-26b-a4b-it
profile_version: v2
created: 2026-04-23
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: 0.55
  cold_start_seconds: 0
  warm_throughput_tokps: 0
  decode_throughput_p50_hour2_tokps: 35.9
  decode_throughput_p1_hour2_tokps: 33.3
  gpu_clock_p5_hour2_mhz: 2405
  gpu_clock_p50_hour2_mhz: 2496
validation_runs: []
---

# Gemma 4 26B A4B MoE — v2 Profile Notes

## v1 → v2 delta (Phase 4 post-close follow-up, 2026-04-23)

v1 could not boot — the NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3` ships vLLM 0.17.1 with a Transformers library that pre-dates `Gemma4ForCausalLM`. Two live boot attempts on 2026-04-23 both failed at engine start: the first on `KeyError: invalid tool call parser: gemma4` (the parser name hadn't stabilized in 0.17.1 — the legacy name was `functiongemma` for Gemma 3), the second — after patching to `functiongemma` — on `pydantic_core._pydantic_core.ValidationError: The checkpoint you are trying to load has model type 'gemma4' but Transformers does not recognize this architecture`. Both failures exercised the D-04 rollback path cleanly; prior Qwen engine restored in both cases. See `runs/phase4-sc1/walkthrough.md` and the post-close container research report for the full diagnosis.

**v2 swaps to upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130`** (vLLM 0.19+, Transformers 5.5.0, aarch64, CUDA 13.0). This is the vLLM team's official Day-1 Gemma 4 release image — used by the ai-muninn DGX Spark benchmark, the NVIDIA Developer Forum Day-1 thread, and eugr/spark-vllm-docker. Three independent working references on GB10. Qwen slots stay on NGC 26.03.post1 (no reason to move them — Qwen3.6 works there); this is a per-slot container divergence.

**All other fields preserved from v1** (same weights path, same sampling defaults, same tool-parser + reasoning-parser names which are now actually correct for the new container's vLLM version). The `container_image` + `container_image_digest` fields in serving.yaml are the only engine-section changes.

---

## Provenance of defaults (SC-5)

### Engine

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `tool_call_parser` | `gemma4` | [vLLM Gemma4 parser API docs](https://docs.vllm.ai/en/latest/api/vllm/tool_parsers/gemma4_tool_parser/) | 2026-04-23 |
| `reasoning_parser` | `gemma4` | [vLLM Gemma 4 serving recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html) + [Google function-calling docs](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4) | 2026-04-23 |
| `enable_auto_tool_choice` | `true` | [vLLM Gemma 4 recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html) — required alongside `tool_call_parser` | 2026-04-23 |
| `quantization` | `fp8` | [DGX Spark STACK.md](../../../.planning/research/STACK.md) lines 121–122 — NVFP4 is slower than FP16 on GB10 UMA *and* has ModelOpt 0.42.0 NaN bug; FP8 is the only sanctioned runtime quant | 2026-04-23 |
| `kv_cache_dtype` | `fp8` | [vLLM Gemma 4 recipe](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html) | 2026-04-23 |
| `max_model_len` | `131072` | [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) — 128K declared context | 2026-04-23 |
| `gpu_memory_utilization` | `0.55` (SEED) | Phase 3.1 UMA lesson (see `profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md` §"Phase 3.1"); operator-gated KV finder (D-15) bisects UP in Plan 04-06. Seed chosen low to preserve >40 GB system headroom on 128 GB UMA pool | 2026-04-23 |
| `max_num_seqs` | `4` | [NVIDIA Gemma 4 Day-1 DGX Spark benchmarks](https://forums.developer.nvidia.com/t/gemma-4-day-1-inference-on-nvidia-dgx-spark-preliminary-benchmarks/365503) — recipe value; also defensive against vLLM #39392 pad-token leak under concurrent batch | 2026-04-23 |
| `max_num_batched_tokens` | `8192` | Matches Qwen v3.1 Phase 3.1 RAM-headroom tuning (D-29); keeps CUDA workspace footprint bounded on UMA pool | 2026-04-23 |
| `load_format` | `fastsafetensors` | SERVE-10 (emmy ships this shared substrate) + [prior repo evidence of ~3× cold-start speedup](https://github.com/MattRa/setup_local_opencode) | 2026-04-23 |
| `attention_backend` | `flashinfer` | [DGX Spark STACK.md](../../../.planning/research/STACK.md) — GB10 requirement; SAME as Qwen | 2026-04-23 |

### Sampling

Sampling primary source: [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) + [HuggingFace google/gemma-4-26B-A4B-it](https://huggingface.co/google/gemma-4-26B-A4B-it). Phase-5 eval candidate documented below.

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `temperature` | `1.0` | [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) — card default (vs Qwen 0.2) | 2026-04-23 |
| `top_p` | `0.95` | [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) | 2026-04-23 |
| `top_k` | `64` | [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) (vs Qwen 40) | 2026-04-23 |
| `repetition_penalty` | `1.0` | [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) — no repetition-damping declared; 1.0 = disabled | 2026-04-23 |
| `max_tokens` | `8192` | Emmy convention, matches Qwen v3.1; Gemma 4 declared output budget comfortably exceeds this | 2026-04-23 |

### Per-tool sampling (harness.yaml)

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `tools.per_tool_sampling.edit.temperature` | `0.0` | Structured-output determinism; Google Gemma 4 card recommends low-T for structured output | 2026-04-23 |
| `tools.per_tool_sampling.bash.temperature` | `0.0` | Deterministic command emission; emmy convention | 2026-04-23 |
| `tools.per_tool_sampling.read.temperature` | `0.0` | File reads are deterministic; emmy convention | 2026-04-23 |

## Known parser bugs (D-17 RESEARCH output)

The Gemma 4 tool parser (`gemma4`) landed in vLLM 0.19.x. Two open issues are live at the time this bundle ships:

- [vLLM #39392](https://github.com/vllm-project/vllm/issues/39392) — pad-token leak under batch=2+ concurrent sequences. The `gemma4` parser intermittently emits a pad token inside tool-call bodies when multiple sequences stream simultaneously.
- [vLLM #39468](https://github.com/vllm-project/vllm/issues/39468) — format-corruption with `<|"` JSON wrapping. Under rare conditions the parser drops one of the `<|"|>` string delimiters, producing a malformed envelope.

**Mitigation (shipped):** `tools.grammar.mode: reactive` (Phase 2 D-11 lock) — the reactive retry path re-issues the request under the XGrammar Lark backstop if the unconstrained first attempt fails to parse. This catches both failure modes empirically.

**Experimental mitigation (NOT shipped in v1):** `engine.max_num_seqs: 1` — forces single-sequence decode, eliminating #39392's batch trigger at a throughput cost. If Phase 5 eval surfaces the bug firing on ≥50% of batched turns, flip to `max_num_seqs: 1` in a v1.1 variant bundle. The current v1 ships `max_num_seqs: 4` per the NVIDIA Day-1 recipe.

## Phase-5 eval candidates

Community experiments worth measuring in Phase 5 but NOT shipped in v1:

- **`temperature: 1.5`** — per [Unsloth HF discussion #21](https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/discussions/21) community reports that Gemma 4 behaves better at higher sampling temperature than the card default suggests. Only ship if Phase 5 eval shows a positive delta across the full benchmark suite (Pitfall #1: subset tests hide regressions).
- **`engine.max_num_seqs: 1`** — zero-risk tool calls (see Known parser bugs above); throughput cost TBD.

## Chat template handling

vLLM 0.19+ bundles the Gemma 4 chat template (no `--chat-template` override is needed). The `chat_template_kwargs.enable_thinking=false` injection is done at REQUEST time via the `before_provider_request` hook (`packages/emmy-provider/src/before-request-hook.ts` lines 70–74 — same site as Qwen's `enable_thinking` wiring), NOT here in the profile bundle.

## Air-gap posture

- `VLLM_NO_USAGE_STATS=1` + `DO_NOT_TRACK=1` + `HF_HUB_OFFLINE=1` + `TRANSFORMERS_OFFLINE=1` all present in `serving.yaml.env`. Schema `_airgap_policy` validator enforces `VLLM_NO_USAGE_STATS="1"` and `HF_HUB_OFFLINE="1"` cross-field.
- `web_fetch.allowlist` adds `ai.google.dev` for Gemma 4 model card + function-calling docs; all other hosts identical to Qwen v3.1 (documentation reading only).
- `web_search.base_url=http://127.0.0.1:8888` is loopback-only per Phase 3.1 D-34.
- Air-gap CI validators (`ci_verify_phase3` STRICT + `ci_verify_research_egress` PERMISSIVE) pass with ZERO changes per 04-RESEARCH.md §1 bullet 10.

## Validation runs

Empty — populated by Plan 04-06 once the operator runs `scripts/find_kv_budget.py` (KV bisection) and `scripts/thermal_replay.py` (2-hour sustained-load floor) on DGX Spark. The `measured_values` frontmatter above is overwritten in the same commit.

## Deferred / not-in-v1

- Speculative decoding (EAGLE-3) — Phase 6. RedHatAI publishes EAGLE-3 speculators for Gemma 4 31B but 26B availability is TBD (PATTERNS.md research flag).
- `routes.yaml` variants (plan/edit/critic) — Plan 04-04 (Phase 4 within-model routing).
- `emmy profile swap` primitive — Plan 04-02.
- `/profile` slash command — Plan 04-03.
- Boot-time smoke on DGX Spark (SP_OK + tool-call parse + 100-tok generation) — operator-gated; Plan 04-06 verifies `scripts/smoke_test.py --profile profiles/gemma-4-26b-a4b-it/v1/` exits 0 with this profile.

### KV-finder result (run 20260423T201355Z_847870)

| Measurement | Value |
|---|---|
| `gpu_memory_utilization` (final) | 0.86 |
| First-preemption value | 0.915 |
| Highest clean value | 0.91 |
| Iterations | 11 |
| Hardware | spark-ff85 |
| Run artifact | `runs/20260423T201355Z_847870-kv-finder/` |
