---
profile_id: mistral-medium-3.5
profile_version: v1
created: 2026-05-01
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: 0.78  # CONTEXT D-04 — operational ceiling, NOT bisected (D-05 skip)
  decode_throughput_p50_smoke_tokps: null  # filled at Plan 04.7-02 boot smoke; informational, NOT a gate (D-13)
  cold_start_seconds: null  # filled at Plan 04.7-02
  # NO thermal fields — D-06 skips 2× 2h thermal replay; CLAUDE.md Pitfall #4 retained for daily-drivers only.
  # NO KV-bisection fields — D-05 skips formal protocol; gmu=0.78 is structural fit, not measured ceiling.
validation_runs: []  # filled at Plan 04.7-02
---

# Mistral Medium 3.5 128B — v1 Profile Notes

Phase 04.7 — heavyweight dense 128B-class alternate, eval-only opt-in via
`/profile mistral-medium-3.5`. Bartowski `Q4_K_M` GGUF (~73 GB on disk, single-
file merged) served by vLLM's experimental `--quantization gguf` backend on
the upstream `vllm/vllm-openai:cu130-nightly-aarch64` container. Decode is
bandwidth-bound on GB10 LPDDR5X (~273 GB/s); estimated ~2.5–3 tok/s at 128K
context. **Not viable as a daily driver** (~3 tok/s), but the SWE-bench
Verified 77.6% / τ³-Telecom 91.4% quality bar makes it worth carrying as a
calibration data point in the Phase 5 dense-vs-MoE matrix and as an occasional
heavy-reasoning escalation target. Daily driver remains
`gemma-4-26b-a4b-it@v2.1` (CLAUDE.md Pinned Tech Stack — switched 2026-04-28).

This is the **first GGUF profile** in the tree. Two prerequisite code changes
landed in the same plan (04.7-01 Wave 0): `EngineConfig.quantization` Literal
extended with `"gguf"`, and `EngineConfig.tokenizer: Optional[str] = None`
added so the GGUF tokenizer-extraction "time-consuming and unstable" warning
in vLLM's docs can be sidestepped by passing `--tokenizer
<base-model-hf-id>`. The renderer also now emits `--reasoning-parser`,
`--max-num-seqs`, and `--tokenizer` (previously orphaned schema fields, never
emitted — see Plan 04.7-01 commit message).

Per CONTEXT D-12: NOT a `routes.yaml` participant; NOT a daily-driver candidate;
NOT a `tools.ask_claude.enabled` flip target. Per CONTEXT D-13: throughput is
informational only — the Phase 04.7 acceptance gate is **bootability + first
chat completion + tool call**.

## Phase 04.7 clone provenance

Clone source: `profiles/gemma-4-31b-it/v1.2/` (source hash
`sha256:78a0c9070911fc3bf9b7954893bba2581e5be073f535b064451fcffaf5530670`).

Why Gemma 31B v1.2 specifically: dense profile (no MoE-specific routing
infrastructure), runtime-quantized BF16 → FP8 (so the upstream `vllm-openai`
container family is the same — just a different tag for GGUF support), ships
`reasoning_parser` alongside `tool_call_parser`, uses `safetensors`/`auto`
load (NOT fastsafetensors — same as our GGUF requirement), `attention_backend`
deliberately unset (vLLM auto-selects), has the `container_entrypoint_override:
""` discipline that upstream `vllm-openai` images require.

### Retargeted fields — `serving.yaml`

| Field | Gemma 31B v1.2 | Mistral v1 | Source |
|---|---|---|---|
| `engine.model` | `/models/gemma-4-31B-it` | `/models/Mistral-Medium-3.5-128B-Q4_K_M.gguf` | RESEARCH §1.3 (single merged GGUF file path; Plan 04.7-02 produces the basename) |
| `engine.model_hf_id` | `google/gemma-4-31B-it` | `mistralai/Mistral-Medium-3.5-128B` | BASE model, NOT bartowski's GGUF repo (vLLM extracts tokenizer+chat template from base — RESEARCH §1.1) |
| `engine.tokenizer` | (not present in v1.2; field added 04.7-01) | `mistralai/Mistral-Medium-3.5-128B` | NEW field per Plan 04.7-01 schema extension; vLLM GGUF docs strongly recommend base-model tokenizer |
| `engine.served_model_name` | `gemma-4-31b-it` | `mistral-medium-3.5` | matches `/profile mistral-medium-3.5` route per CONTEXT D-13 |
| `engine.container_image` | `vllm/vllm-openai:gemma4-0409-arm64-cu130` | `vllm/vllm-openai:cu130-nightly-aarch64` | CONTEXT D-10 + RESEARCH §1.4 — Docker-Hub-confirmed nightly aarch64+CUDA13 spelling. Plan 04.7-02 first task may rewrite if actual working tag differs at first pull. |
| `engine.container_image_digest` | `sha256:db59febc6c47…` | `sha256:REPLACE_AT_FIRST_PULL` | SCHEMA SENTINEL — Plan 04.7-02 captures real digest at `docker pull` and writes it into this line. `emmy profile validate` will reject this until then; that is the intentional G-5 handoff. |
| `engine.container_entrypoint_override` | `""` | `""` | CARRY OVER — upstream `vllm-openai` images still bake `ENTRYPOINT=[vllm serve]` |
| `engine.max_model_len` | `262144` | `131072` | CONTEXT D-03 (256K deferred to v2 per OOS list) |
| `engine.gpu_memory_utilization` | `0.55` | `0.78` | CONTEXT D-04 — STRUCTURAL, not RAM-headroom retune (see "D-05 substituted protocol" below) |
| `engine.kv_cache_dtype` | `fp8` | `fp8` | CONTEXT D-08 — required, not optional |
| `engine.max_num_batched_tokens` | `8192` | `8192` | CARRY OVER |
| `engine.max_num_seqs` | `4` | `1` | CONTEXT D-07 (single-stream; pool too tight for batching) |
| `engine.load_format` | `safetensors` | `auto` | GGUF backend ignores fastsafetensors; `auto` is valid Literal value per `schema.py:80` |
| `engine.quantization` | `fp8` | `gguf` | CONTEXT D-02 + Plan 04.7-01 Literal extension |
| `engine.tool_call_parser` | `gemma4` | `mistral` | CONTEXT D-09 |
| `engine.reasoning_parser` | `gemma4` | `mistral` | CONTEXT D-09 + RESEARCH §3.3 |
| `engine.enable_auto_tool_choice` | `true` | `true` | CARRY OVER |
| `engine.host` | `0.0.0.0` | `0.0.0.0` | CARRY OVER (container-internal bind) |
| `engine.port` | `8000` | `8000` | CARRY OVER (container-internal) |
| `sampling_defaults.temperature` | `1.0` | `0.15` | RESEARCH §2.5 ASSUMPTION (community-typical Mistral coding sampling); Phase 5 may revise |
| `sampling_defaults.top_p` | `0.95` | `0.95` | CARRY OVER |
| `sampling_defaults.top_k` | `64` | `40` | RESEARCH §2.5 ASSUMPTION |
| `sampling_defaults.repetition_penalty` | `1.0` | `1.0` | CARRY OVER |
| `quirks.strip_thinking_tags` | `true` (Gemma channel-bleed backstop) | `false` | No Mistral-specific channel-bleed analog known. Flip path documented under "Tool-call parser fallback (T-04)" below. |
| `env.VLLM_LOAD_FORMAT` | `safetensors` | `auto` | matches `engine.load_format` |

### Retargeted fields — `profile.yaml`

| Field | Gemma 31B v1.2 | Mistral v1 |
|---|---|---|
| `id` | `gemma-4-31b-it` | `mistral-medium-3.5` |
| `version` | `v1.2` | `v1` |
| `family` | `gemma-4` | `mistral` |
| `base_model` | `google/gemma-4-31B-it` | `mistralai/Mistral-Medium-3.5-128B` |
| `description` | Phase 4.1 dense + 256K context bump | Phase 04.7 GGUF eval-only alternate |
| `created` | `2026-04-25` | `2026-05-01` |
| `hash` | `sha256:78a0c907...` | `sha256:PENDING` → recomputed via `uv run emmy profile hash <bundle> --write` |
| `tags` | `[coding, dgx-spark, fp8, gemma-4, ...]` | `[coding, dgx-spark, gguf, mistral, phase-04.7, dense, alternate, eval-only, q4-k-m]` |
| `community_sources` | 10-entry Gemma list | 4-entry Mistral list (D-16 minimum: bartowski GGUF, mistralai HF base, vLLM GGUF docs, vLLM tool_calling docs) |

### Byte-identical from `profiles/gemma-4-31b-it/v1.2/`

- `prompts/system.md` (SP_OK canary, model-agnostic)
- `prompts/edit_format.md` (Hashline pattern, model-agnostic)
- `prompts/tool_descriptions.md` (9 native tools, model-agnostic)
- `prompts/compact.md` (compaction summarization prompt, model-agnostic)
- `tool_schemas/{bash,edit,find,grep,ls,read,web_fetch,web_search,write}.schema.json` (9 JSON-Schema files, model-agnostic)
- `grammars/tool_call.lark` (reactive backstop only — see "Tool-call parser fallback (T-04)" below for the flip path if the Gemma-shape envelope differs problematically)
- `subagents/{research,code-reviewer,bash-runner}/AGENTS.md` (3 personas, operator-facing not model-tied per RESEARCH §9 Q7)
- `harness.yaml` body (header comment retargeted to Mistral; all schema-relevant fields byte-identical, including `context.max_input_tokens: 114688` which equals `131072 - 16384` for Mistral the same way it equals `131072 - 16384` for the Gemma analog despite Gemma's 256K cap)

Rationale per CLAUDE.md Pitfall #1 ("more prompting" trap, Qwen3 8.5→6.8
regression): NO Mistral-specific prompt tweaks in v1. Phase 5 calibration
determines whether v2 needs Mistral-shape edits. The SP_OK canary is
model-agnostic; the Hashline edit format is model-agnostic; per-tool JSON
schemas are model-agnostic. The lark grammar is reactive backstop only —
RESEARCH §3.1 confirms the vLLM Mistral parser converts the
`[TOOL_CALLS]<json-array>` envelope to OpenAI shape upstream so the harness
sees parser-converted tool_calls and the lark rarely fires.

## Provenance of defaults (SC-5)

### Engine

| Field | Value | Source | Retrieved |
|---|---|---|---|
| `container_image` | `vllm/vllm-openai:cu130-nightly-aarch64` | CONTEXT D-10 + RESEARCH §1.4 — Docker-Hub nightly tag with GGUF backend support (NGC `26.03.post1-py3` is fastsafetensors-derived, doesn't ship GGUF on the version we need; upstream Gemma4 day-1 image is BF16-FP8 only) | 2026-05-01 |
| `container_image_digest` | SENTINEL → captured at first pull | Plan 04.7-02 — `docker pull` then `docker inspect --format '{{.Id}}'` | TBD |
| `container_entrypoint_override` | `""` | Upstream vllm-openai ENTRYPOINT=[vllm serve] collides with emmy runner.py's CMD; empty override clears it (Gemma 31B v1.2 finding carries forward) | 2026-04-23 |
| `tokenizer` | `mistralai/Mistral-Medium-3.5-128B` | [vLLM GGUF Quantization docs](https://docs.vllm.ai/en/stable/features/quantization/gguf/) — strongly recommends explicit `--tokenizer <base-hf-id>` because bundled GGUF tokenizer extraction is "time-consuming and unstable" | 2026-05-01 |
| `tool_call_parser` | `mistral` | [vLLM Tool Calling docs](https://docs.vllm.ai/en/latest/features/tool_calling/) — Mistral 3.x convention; the model is RL-trained for `[TOOL_CALLS]` envelope per upstream HF card | 2026-05-01 |
| `reasoning_parser` | `mistral` | Same source as tool_call_parser; CONTEXT D-09 + RESEARCH §3.3 | 2026-05-01 |
| `enable_auto_tool_choice` | `true` | CONTEXT D-09 — required alongside tool_call_parser | 2026-05-01 |
| `quantization` | `gguf` | CONTEXT D-02 + Plan 04.7-01 Literal extension. vLLM experimental GGUF backend; long-context flagged WIP by Mistral | 2026-05-01 |
| `kv_cache_dtype` | `fp8` | CONTEXT D-08 — required at this size; BF16 KV would push 128K to 117/128 GB pool | 2026-05-01 |
| `max_model_len` | `131072` | CONTEXT D-03 — half of native 256K; 256K deferred to v2 (operator-exclusive Spark mode only) | 2026-05-01 |
| `gpu_memory_utilization` | `0.78` | CONTEXT D-04 — STRUCTURAL, not RAM-headroom retune (see "D-05 substituted protocol" below) | 2026-05-01 |
| `max_num_seqs` | `1` | CONTEXT D-07 — single-stream; pool too tight for batching | 2026-05-01 |
| `max_num_batched_tokens` | `8192` | CARRY OVER from Gemma 31B v1.2 (RAM headroom + interactive latency) | 2026-04-23 |
| `load_format` | `auto` | GGUF backend ignores fastsafetensors; `auto` is valid Literal value per `schema.py:80` | 2026-05-01 |
| `attention_backend` | UNSET | vLLM auto-selects; FlashInfer support for GGUF backend not documented; safer to defer | 2026-05-01 |

### Sampling — RESEARCH §2.5 ASSUMPTION (flagged)

**Mistral HF model card does not pin coding-task sampling values.** The values
below are community-typical for Mistral coding workloads (lower temperature
than Gemma's 1.0; tighter top_k than Gemma's 64). **Phase 5 calibration may
revise.** Anti-Pitfall #1 discipline: NO experimental tuning runs in v1; we
ship community defaults and let benchmarks speak.

| Field | Value | Source |
|---|---|---|
| `temperature: 0.15` | Set | RESEARCH §2.5 community-typical for Mistral coding |
| `top_p: 0.95` | Set | Carry-over from Gemma analog (also community-typical) |
| `top_k: 40` | Set | RESEARCH §2.5 community-typical for Mistral (vs Gemma 64) |
| `repetition_penalty: 1.0` | Set | No repetition damping declared by Mistral |
| `max_tokens: 8192` | Set | Emmy convention |

### Why `speculative: null`

Deferred to Phase 6. No Mistral-shape spec-decode draft model surveyed; in
any case spec decode evaluation requires paired on/off benchmarks through
the Phase 5 eval harness. Container churn (T-02) makes nightly drift a
greater immediate concern.

## D-05 substituted protocol — no KV-bisection

Per CONTEXT D-05 verbatim:

> Skip formal KV-bisection protocol. Substitute: single boot smoke at
> gmu=0.78 + 32K prefill probe; step down 0.05 (0.78 → 0.73 → 0.68) if OOM.

The bundled `scripts/find_kv_budget.py` audit was **not run** for this
profile. Rationale: bisection's audit value (find the box ceiling) is
well-known — 4 prior profiles (Qwen 35B MoE v3, Qwen 27B dense v1, Gemma
26B MoE v2, Gemma 31B dense v1) all converge to `gpu_memory_utilization=0.86`
on this GB10 / 128 GB UMA box. The ceiling is the box, not the model.

For Mistral 128B Q4_K_M, the **operational** ceiling is determined by
**structural fit**, not bisection:

- Weights: 73 GB (Q4_K_M, single-merged GGUF)
- KV cache @ FP8 @ 128K context: 22 GB (per-token KV math: `2 × 88 layers
  × 8 KV heads × 128 head_dim × 1 byte` = 176 KB/token × 131072 = 22 GB)
- Scratch / activation: ~5 GB (engine-internal)
- **Total**: ~99.8 GB == 0.78 × 128 GB pool

Higher `gpu_memory_utilization` is **not a risk choice** — it's structurally
required. Any value below ~0.76 won't fit the weights; the dense-profile
0.55 convention (Phase 4.1 RAM-headroom retune) cannot apply here without
forcing a context downgrade.

The failure mode is loud (OOM at boot or first long prefill), not silent
— this is what makes the substituted protocol acceptable for an eval-only
profile. Plan 04.7-02 boot smoke fills the gmu-convergence table below at
first run; if 0.78 OOMs, the step-down protocol kicks in.

### gmu convergence table (filled at Plan 04.7-02 boot smoke)

| Attempt | gmu | max_model_len | Outcome | Notes |
|---|---:|---:|---|---|
| 1 (planned) | 0.78 | 131072 | TBD | First boot per CONTEXT D-05 |
| 2 (fallback) | 0.73 | 131072 | TBD | Step-down -0.05 if 0.78 OOMs |
| 3 (fallback) | 0.68 | 131072 | TBD | Step-down -0.05 if 0.73 OOMs |
| 4 (fallback) | 0.68 | 65536 | TBD | Halve context if 0.68 still OOMs at 128K |

A successful run at attempt 1 is the expected outcome (structural math
above predicts it). Any other outcome triggers a v2 cut with the converged
values + new bundle hash; this v1 stays as the structural-math evidence
artifact per CLAUDE.md immutability rules.

## D-06 substituted protocol — no thermal replay

Per CONTEXT D-06 verbatim:

> Skip 2× 2h thermal replay protocol. Empirical record on Spark: 8 hours
> of cumulative thermal-replay data across 4 prior profiles, **zero throttle
> observed**. The original "2.8→2 GHz throttle" claim originates from
> `PITFALLS.md` line 815 citing an NVIDIA Developer Forum report — never
> measured on this hardware. For Mistral 128B Q4_K_M specifically, the
> thermal envelope is **lighter** than the dense profiles that already
> passed (decode ~3 tok/s vs 7-8, less sustained heat, occasional-use not
> 8h/day). Pitfall #4 status updated to "characterized on Spark across 4
> profiles, no throttle observed; gate retained for daily-driver candidates,
> skipped for non-daily-driver alternates."

Plan 04.7-03 lands the CLAUDE.md Pitfall #4 status update (footer line +
Pinned Tech Stack thermal-characterization note). This profile is eval-only
(D-13) and explicitly NOT a daily-driver candidate (D-12) — the skip is
scoped tightly.

## Container nightly drift (T-02)

`vllm/vllm-openai:cu130-nightly-aarch64` is a moving target. The first
`docker pull` (Plan 04.7-02) pins a specific digest into
`serving.yaml.engine.container_image_digest`; that pin is the immutability
contract. **Re-pin every ~4 weeks** if this profile is to remain bootable
without operator intervention.

CLAUDE.md Pitfall #2 (vLLM API churn) acceptance: this is a re-pin debt,
acceptable for an eval-only profile and explicitly NOT acceptable for the
daily-driver. References:
- vLLM #39583 (GGUF deprecation RFC; tracking)
- vLLM #39923 (libcudart link bug; tracking)

If a future re-pull pulls a digest where GGUF is no longer supported (per
the deprecation RFC), this profile gets explicitly retired — not papered
over with a workaround.

## GGUF backend experimental status (T-01)

vLLM's GGUF backend is documented as **"highly experimental and
under-optimized"** (vLLM Quantization docs, retrieved 2026-05-01). Mistral
flagged GGUF long-context support as WIP. The acceptance gate for this
profile is bootability + first chat completion + tool call (CONTEXT D-13);
generation-quality calibration is Phase 5 work.

Specific risks tracked:
- Long-context degradation beyond ~32K (Mistral WIP flag) — boot smoke
  generation test at 32K context is the first signal; 128K listed as
  `max_model_len` but real-world use likely <16K for first-pass.
- Per-batch KV scheduling may have higher overhead than fastsafetensors
  paths — `max_num_seqs=1` (CONTEXT D-07) eliminates this dimension.
- Tokenizer extraction from bundled GGUF "time-consuming and unstable"
  (vLLM docs) — mitigated by explicit `tokenizer:` field per Plan 04.7-01
  schema extension.

If 128K turns out unusable, re-cap to 32K via v2 cut (NOT in-place edit
per immutability rules).

## Tool-call parser fallback (T-04)

`tool_call_parser: mistral` + `enable_auto_tool_choice: true` per CONTEXT
D-09 — Mistral 3.x convention. The model is RL-trained for `[TOOL_CALLS]`
envelope per the upstream HF card. vLLM's parser converts to OpenAI
`tool_calls` shape upstream so the harness layer is parser-format-agnostic
(emmy_serve/canary/tool_call.py asserts `tool_calls[0].function.name ==
"read_file"` after parser conversion — confirmed at lines 51-63).

If the boot-smoke tool-call canary fails (T-04), apply the RESEARCH §3.2
fallback playbook in this order:

1. **First** — try passing `--chat-template
   examples/tool_chat_template_mistral_parallel.jinja` to vLLM (the upstream
   examples repo ships a Mistral-shape parallel-tool-call template). This
   is the documentation-following path; tool calls are typically a
   chat-template wiring issue, not a parser implementation bug.

2. **Second** — if (1) doesn't fix, the `[TOOL_CALLS]` envelope is leaking
   into content (channel-bleed analog). Flip `quirks.strip_thinking_tags:
   false` → `true` AND author a Mistral analog of
   `stripGemma4ChannelBleed()` in the harness. The grammar
   (`grammars/tool_call.lark`) is byte-cloned from Gemma's
   `<|tool_call>...<tool_call|>` shape; if the Mistral envelope diverges
   problematically, swap to a Mistral-shape lark in v2 (NOT in-place edit
   per immutability rules).

3. **Third** — if both fail, flip `enable_auto_tool_choice: false` and
   surface tool calls through the harness's reactive-grammar retry path
   only. This is degraded mode; document in a v2 PROFILE_NOTES.md.

The lark grammar is reactive backstop only (CLAUDE.md Pitfall #6 — "grammar
is a correctness backstop, not a quality lever"). Per RESEARCH §3.1 it
rarely fires because the Mistral parser converts to OpenAI shape upstream.

## Open issues / future v2 candidates

- **256K context bump** — possible only with operator-exclusive Spark mode
  (no other workloads); not pursued in v1. Future v2 cut if demand
  justifies.
- **NVFP4 alternate** — RecViking's NVFP4 build is the obvious comparison
  point; Phase 5 may add it as an A/B if measurement is cheap. Not built
  in v1 because Q4_K_M GGUF is the higher-confidence path on GB10 UMA
  (NVFP4 is *slower* than FP16 here per CLAUDE.md Pinned Tech Stack
  -23.6% finding).
- **`ask_mistral` local-escalation tool** — local-only sibling of Phase
  04.6's `ask_claude` (no cloud egress). Worth considering if Mistral
  128B turns out high-quality enough that operator wants it as the "ask
  hard reasoning" path. Defer until Phase 5 quality data is in.
- **fastsafetensors-derived image** — possible future v2 bump if
  cold-start wall-clock becomes operationally painful AND a GGUF-aware
  fastsafetensors layer exists upstream.
- **Phase 4 SC-3 within-model role routing** — no plan/edit/critic
  siblings shipped; routes.yaml stays Gemma-only (currently dormant per
  CLAUDE.md Pinned Tech Stack). Ship Mistral siblings only if Phase 5
  shows the model is worth the effort.

## References

- HF: [mistralai/Mistral-Medium-3.5-128B](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B) (base, gated)
- HF: [bartowski/mistralai_Mistral-Medium-3.5-128B-GGUF](https://huggingface.co/bartowski/mistralai_Mistral-Medium-3.5-128B-GGUF) (source for D-01)
- HF: [RecViking/Mistral-Medium-3.5-128B-NVFP4](https://huggingface.co/RecViking/Mistral-Medium-3.5-128B-NVFP4) (rejected per D-01)
- vLLM docs: [Quantization — GGUF backend](https://docs.vllm.ai/en/stable/features/quantization/gguf/) (experimental; tokenizer extraction caveat)
- vLLM docs: [Tool Calling — Mistral parser](https://docs.vllm.ai/en/latest/features/tool_calling/)
- `.planning/phases/04.7-mistral-medium-3-5-128b-alternate/04.7-CONTEXT.md` (locked decisions)
- `.planning/phases/04.7-mistral-medium-3-5-128b-alternate/04.7-RESEARCH.md` (engine flag table §1.1, schema gaps §1.2, sampling assumption §2.5)
- `.planning/phases/04.7-mistral-medium-3-5-128b-alternate/04.7-PATTERNS.md` (file-by-file clone-and-retarget map)
- `CLAUDE.md` Pinned Tech Stack — Pitfall #4 (thermal), Pitfall #2 (container churn), Pitfall #1 (more-prompting)
