---
profile_id: mistral-medium-3.5
profile_version: v1
created: 2026-05-01
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: 0.78  # CONTEXT D-04 — STRUCTURAL ceiling, NOT validated by boot smoke (T-01 backend gap blocked it; see "GGUF backend experimental status (T-01)" body section)
  decode_throughput_p50_smoke_tokps: null  # NOT measured — Plan 04.7-02 boot smoke blocked at T-01; v2 (Mistral architecture support upstream) re-runs
  cold_start_seconds: null  # NOT measured — same reason
  # NO thermal fields — D-06 skips 2× 2h thermal replay; CLAUDE.md Pitfall #4 retained for daily-drivers only.
  # NO KV-bisection fields — D-05 skips formal protocol; gmu=0.78 is structural fit, not measured ceiling.
validation_runs:
  # Plan 04.7-02 boot smoke attempts — Wave 1 (BOTH FAILED — T-01 GGUF backend gap on vLLM nightly; see "GGUF backend experimental status (T-01)" + "Plan 04.7-02 boot-smoke failure timeline" body sections)
  - "20260502T214035Z-004263-boot  # FAIL Wave 1 attempt 1 — wait_for_vllm 900s; container exited 1 with huggingface_hub.errors.LocalEntryNotFoundError; --tokenizer mistralai/Mistral-Medium-3.5-128B not in HF cache + HF_HUB_OFFLINE=1; led to per-profile tokenizer-fallback edit"
  - "20260502T222054Z-576671-boot  # FAIL Wave 1 attempt 2 — same wait_for_vllm symptom; container exited 1 with `ValueError: GGUF model with architecture mistral3 is not supported yet.`; T-01 backend gap, no profile knob fixes this"
  # Plan 04.7-02 boot smoke attempts — Wave 2 (BOTH FAILED — Workaround A surfaced new vLLM bug; T-01 still blocking; see "Workaround A empirical results" body section)
  - "20260502T231011Z-e07024-boot  # FAIL Wave 2 attempt 3 — repo:quant model + hf_config_path; HFValidationError on colon in repo_id at vllm/transformers_utils/repo_utils.py:220 (get_model_path naively forwards `bartowski/...:Q4_K_M` to snapshot_download). Workaround A repo:quant variant infeasible without vLLM patch."
  - "20260502T231409Z-8f35fc-boot  # FAIL Wave 2 attempt 4 — local file model + hf_config_path; T-01 still fires (`ValueError: GGUF model with architecture mistral3 is not supported yet`). hf_config_path consulted only after speculators check at config.py:633+; speculators check at config.py:587-591 unconditionally GGUF-parses local-file model paths. Workaround A hf_config_path-only variant does NOT bypass T-01."
  # Plan 04.7-02 boot smoke attempts — Wave 3 (Decision Option 5 sitecustomize hot-patch — T-01 CLEARED but downstream architectural blocker reached; see "Option 5 sitecustomize hot-patch iteration (2026-05-02)" body section)
  - "20260502T233850Z-6282d9-boot  # FAIL Wave 3 attempt 5 — sitecustomize patch fired (mistral3 → GGUF allowlist + cfg_map alias of mistral). T-01 CLEARED. New error class #1: `Loading a multimodal GGUF model needs to use original tokenizer. Please specify the unquantized hf model's repo name or path using the --tokenizer argument.` from vllm/engine/arg_utils.py:1448 create_model_config. vLLM resolved arch as Mistral3ForConditionalGeneration (multimodal); GGUF-embedded tokenizer fallback rejected for multimodal path."
  - "20260502T234040Z-5af3fe-boot  # FAIL Wave 3 attempt 6 — `tokenizer: /models/Mistral-Medium-3.5-128B-config` (Rule 3 auto-fix; pointed at operator-staged dir with HF tokenizer.json). Past tokenizer barrier. New error class #2: `torch.bfloat16 is not supported for quantization method gguf. Supported dtypes: [torch.float16, torch.float32]` from vllm/engine/arg_utils.py:2094 VllmConfig validation. Plus warning gguf.py:69 `GGUF has precision issues with bfloat16 on Blackwell`. Mistral 3.x source config.json declares dtype=bfloat16."
  - "20260502T234222Z-e848d9-boot  # FAIL Wave 3 attempt 7 — `dtype: float16` (Rule 3 auto-fix via new EngineConfig.dtype schema field + --dtype CLI emission). Past dtype barrier. Engine init code begins (Asynchronous scheduling enabled, IR op priority configured). New error class #3 (architectural): `The tokenizer must be an instance of MistralTokenizer.` from VllmConfig validation. The mistral tool_call_parser path requires a Mistral-format tokenizer (mistral_common.MistralTokenizer, typically loaded from tekken.json via --tokenizer-mode mistral). Operator-staged dir has only HF tokenizer.json — no tekken.json. Architectural blocker; needs operator decision (Path 7 added to refined menu)."
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

| Attempt | gmu | max_model_len | Outcome | run_id |
|---|---:|---:|---|---|
| 1 | 0.78 | 131072 | **NOT REACHED** — boot blocked at vLLM startup before any GPU allocation; failed first on tokenizer fetch (LocalEntryNotFoundError), then on GGUF architecture support gap | 20260502T214035Z-004263 (tokenizer fetch) and 20260502T222054Z-576671 (mistral3 architecture) |

The gmu step-down protocol from CONTEXT D-05 was **NEVER EXERCISED** — both
boot attempts failed at vLLM startup before any GPU memory allocation, so
the gmu=0.78 structural fit hypothesis remains UNVERIFIED on this hardware.
See "Plan 04.7-02 boot-smoke failure timeline" body section below for the
full traces. v1 ships with gmu=0.78 as the structural prediction; whichever
follow-up plan unblocks T-01 will validate or revise it.

A successful run at attempt 1 was the expected outcome (structural math
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

## Plan 04.7-02 boot-smoke failure timeline (T-01 fired)

The Plan 04.7-02 boot smoke fired T-01 in its strongest form: vLLM's GGUF
backend (in the `vllm/vllm-openai:cu130-nightly-aarch64` image,
build `0.19.2rc1.dev134+gfe9c3d6c5`, pulled 2026-05-02) **does not yet
support the `mistral3` GGUF architecture**. Two attempts, two distinct
failure modes; the second is the load-bearing one.

**Attempt 1 — 2026-05-02 (run_id 20260502T214035Z-004263):**
Configuration: serving.yaml as committed by Plan 04.7-01 + Plan 04.7-02
Task 1, with `tokenizer: mistralai/Mistral-Medium-3.5-128B` set per the
RESEARCH §1.1 + vLLM GGUF docs recommendation. Container started; vLLM
crashed during arg parsing with:

```
huggingface_hub.errors.LocalEntryNotFoundError: Cannot find an appropriate
cached snapshot folder for the specified revision on the local disk and
outgoing traffic has been disabled.
```

Root cause: the explicit `--tokenizer mistralai/Mistral-Medium-3.5-128B`
points at a **gated** HF repo, the local `/data/hf-cache/` does not have
a snapshot of it, and `HF_HUB_OFFLINE=1` (D-12 air-gap) blocks the runtime
download. The plan + RESEARCH did not anticipate this — gated-repo +
offline-cache + tokenizer-extraction is a three-way collision.

**Attempt 2 — 2026-05-02 (run_id 20260502T222054Z-576671):**
Auto-fix applied (Rule 3 deviation): commented out the `tokenizer:` line in
serving.yaml so vLLM falls back to the GGUF-embedded tokenizer (the field
stays in `EngineConfig` schema; this is a per-profile fallback, not a
schema rollback). Bundle hash recomputed. Container started; vLLM crashed
during model load with:

```
ValueError: GGUF model with architecture mistral3 is not supported yet.
```

Root cause: vLLM's GGUF backend has a per-architecture allowlist, and
`mistral3` (the GGUF-embedded architecture string for Mistral 3.x family
models) is not on it as of build `0.19.2rc1.dev134+gfe9c3d6c5`. **No
profile knob fixes this** — gmu, max_model_len, max_num_seqs, kv_cache_dtype,
tool_call_parser, reasoning_parser are all irrelevant when the backend
rejects the architecture upfront. The CONTEXT D-05 gmu step-down protocol
was therefore **not exercised**: the failure was at startup, before any
GPU memory allocation.

### What this means for the v1 ship state

1. v1 ships with the configuration the plan specified (gmu=0.78,
   max_model_len=131072, kv_cache_dtype=fp8, max_num_seqs=1) PLUS the
   tokenizer-fallback edit (commented `tokenizer:` line). It is not
   bootable on this Spark with the currently-available vLLM nightly.
2. The structural-fit gmu=0.78 hypothesis (D-04) remains UNVERIFIED on
   this hardware — both boot attempts failed before GPU allocation.
3. CONTEXT G-1 (Bootable), G-2 (First chat completion), G-3 (Tool-call
   probe) all CANNOT close until upstream vLLM lands `mistral3` GGUF
   architecture support.

### Operator paths to unblock

Plan 04.7-02 surfaces these as a decision-checkpoint to the operator. In
order of expected effort:

1. **Wait for upstream support** — track the next `vllm/vllm-openai:cu130-nightly-aarch64`
   nightly until `mistral3` is on the GGUF arch allowlist; re-pull, capture
   new digest, re-run boot smoke. Lowest engineering cost, indeterminate
   timeline (depends on vLLM project priorities).
2. **Switch to a different Mistral 3.x quant path** — e.g., the rejected
   NVFP4 path (CONTEXT D-01 rejection rationale was "slower than FP16 on
   GB10 UMA" — still functional, just slower). RecViking's NVFP4 build is
   single-GPU re-tune away from booting. Phase 5 calibration question
   becomes "how slow is too slow for an eval-only escalation profile?"
3. **Switch to a llama.cpp-based serving path** — outside the vLLM-only
   architectural envelope (CONTEXT D-02); would require new sidecar shape,
   new harness adapter. Highest engineering cost, completely sidesteps T-01.
4. **Defer the entire phase** — drop Mistral 3.5 128B from the active
   stack until vLLM GGUF backend matures; re-open the phase when upstream
   support lands. Zero engineering cost; loses the Phase 5 dense-128B
   matrix participant slot.

The decision is operator-level; the plan-level executor cannot pick
unilaterally because (1) and (2) trigger different downstream artifact
shapes (different bundle hash, different evidence trail), (3) is a phase
re-architecture, and (4) abandons the phase. v1 is left in the documented
"structurally-correct, T-01-blocked" state pending the operator decision.

## Tokenizer fallback (T-tokenizer)

The `engine.tokenizer` field (Plan 04.7-01 Wave 0 schema extension) was
originally set to `mistralai/Mistral-Medium-3.5-128B` per vLLM GGUF docs
which warn that bundled-tokenizer extraction is "time-consuming and
unstable." Plan 04.7-02 boot smoke attempt 1 surfaced a previously-unmapped
collision:

- The base model `mistralai/Mistral-Medium-3.5-128B` is a **gated** HF
  repo (requires accepting T&C on the HF model card before even tokenizer
  files are downloadable).
- `HF_HUB_OFFLINE=1` (CONTEXT D-12 air-gap) is enforced at runtime, so the
  container CANNOT pull the gated tokenizer at boot even if the operator
  is authenticated.
- The local HF cache `/data/hf-cache/` was empty for this repo, and the
  bartowski GGUF source repo (which IS public) does NOT carry tokenizer
  files — the GGUF format embeds the tokenizer internally instead.

Resolution applied at 2026-05-02 (Plan 04.7-02 Task 3): commented out the
`tokenizer:` line in serving.yaml. vLLM's default behavior when
`--tokenizer` is unset is to extract the tokenizer from the GGUF file
itself. This is the path vLLM docs flag as "time-consuming and unstable"
but IT IS the only path that doesn't require gated-repo HF auth + cache
seeding.

The schema field stays in `EngineConfig` (Plan 04.7-01 Wave 0 work intact).
This is a per-profile fallback, not a schema rollback. If/when v2 is
authored, the operator path to re-enable explicit-tokenizer mode is:

1. `hf auth login` with a token that has accepted T&C for
   `mistralai/Mistral-Medium-3.5-128B` (visit the HF model card, click
   "Agree and access repository").
2. `huggingface-cli download mistralai/Mistral-Medium-3.5-128B
   --include "*tokenizer*" --include "*.json" --include "*.model"
   --local-dir /data/hf-cache/...` to seed just the tokenizer files
   (no weights — those are 200 GiB of safetensors we don't want).
3. Uncomment the `tokenizer:` line in serving.yaml (now in v2 bundle).
4. Re-run boot smoke — vLLM will read the cached tokenizer instead of
   trying to download.

NOTE: this resolution did NOT unblock boot smoke — attempt 2 then hit
T-01 (mistral3 architecture not supported). The tokenizer fallback is
documented here for completeness; T-01 is the load-bearing blocker.

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

## Workaround A wiring (2026-05-02 follow-up to T-01)

After the 2026-05-02 boot-smoke failure cascade documented in "Plan 04.7-02
boot-smoke failure timeline (T-01 fired)" above, the operator authenticated
to HuggingFace and pre-staged the unquantized base model's config files at
`/data/models/Mistral-Medium-3.5-128B-config/` (config.json, tokenizer.json,
tokenizer_config.json, generation_config.json, params.json — *no weights*,
the gated base repo's safetensors are 200+ GB and we don't need them for
inference; vLLM's GGUFModelLoader will load weights from the bartowski GGUF).
A second 04.7-02 wave then wired Workaround A: a different model-path shape
+ a new EngineConfig field (`hf_config_path`) + an out-of-band HF cache
staging step.

### What changed in v1's serving.yaml

| Key | Before (T-01-blocked v1) | After (Workaround A v1) | Rationale |
|---|---|---|---|
| `engine.model` | `/models/Mistral-Medium-3.5-128B-Q4_K_M.gguf` (local file path) | `bartowski/mistralai_Mistral-Medium-3.5-128B-GGUF:Q4_K_M` (HF repo:quant form) | The local-file path triggers vLLM's `maybe_override_with_speculators` (transformers_utils/config.py:587-591) → calls `PretrainedConfig.get_config_dict("/models", gguf_file=..., local_files_only=True)` → transformers' GGUF parser → `mistral3` not in `GGUF_SUPPORTED_ARCHITECTURES` → ValueError. The repo:quant form takes the `is_remote_gguf` branch (config.py:590-591) which does NOT pass `gguf_file=` to `get_config_dict` — so it reads a plain config.json from the bartowski snapshot dir instead of parsing the GGUF, sidestepping the allowlist gap. |
| `engine.hf_config_path` | _(field did not exist)_ | `/models/Mistral-Medium-3.5-128B-config` | Forces `get_config()` (config.py:633-700) to construct the PretrainedConfig from the operator-staged config dir directly. vLLM treats it as `config_format='hf'` (because it has a config.json) and parses normally as `Mistral3Config`. No GGUF parsing in this path. Mounted via the existing `/data/models:/models:ro` bind in runner.py:133. |

The bundle hash bumped: `sha256:5f3d2544…` (T-01-blocked snapshot) →
`sha256:cc7d8db8…` (Workaround A wiring). Recomputed via
`uv run emmy profile hash profiles/mistral-medium-3.5/v1 --write` per the
in-development-bundle convention used throughout 04.7-02 (4 prior in-place
hash bumps already committed; Workaround A is the 5th).

### Schema + runner extension (Plan 04.7-02 Wave 2)

`EngineConfig.hf_config_path: Optional[str] = None` was added to
`emmy_serve/profile/schema.py` (mirrors the Plan 04.7-01 tokenizer field
pattern exactly — strictly additive; pre-04.7-02 profiles validate
unchanged). `render_vllm_cli_args` in `emmy_serve/boot/runner.py` emits
`--hf-config-path <value>` when set; conditional emission preserves
byte-identical render for pre-04.7-02 profiles. Tests added to
`tests/unit/test_profile_schema_gguf.py` (positive + Optional default-None)
and `tests/unit/test_docker_run_build.py` (renderer positive + absence in
two pre-existing fixtures). Committed as
`feat(04.7-02): add hf_config_path EngineConfig field + runner CLI emission`.

### Operator-staged HF cache state (out-of-band; survives across boots)

These artifacts live OUTSIDE the source tree (under `/data/hf-cache/` and
`/data/models/`); they are inputs to v1's bootability, not products of it.
Re-staging required if `/data/hf-cache/` or `/data/models/` are wiped.

```
/data/models/Mistral-Medium-3.5-128B-config/                # operator-copied from gated mistralai HF repo
├── config.json                                              #  → also referenced by hf_config_path (above)
├── generation_config.json
├── params.json                                              # Mistral-format equivalent (informational)
├── tokenizer.json                                           # used by vLLM via GGUF-embedded fallback path
├── tokenizer_config.json
├── consolidated.safetensors.index.json                      # Mistral consolidated index (informational)
└── model.safetensors.index.json                             # HF safetensors index (informational; no weights)

/data/hf-cache/hub/models--bartowski--mistralai_Mistral-Medium-3.5-128B-GGUF/
├── refs/main                                                # operator-set to bartowski commit hash
└── snapshots/<commit-hash>/                                 # operator-staged for offline mode
    ├── config.json                                          # copy of /data/models/.../config.json (used by maybe_override_with_speculators)
    └── mistralai_Mistral-Medium-3.5-128B-Q4_K_M.gguf       # symlink → /models/Mistral-Medium-3.5-128B-Q4_K_M.gguf (used by GGUFModelLoader weight load)
```

The symlink target (`/models/Mistral-Medium-3.5-128B-Q4_K_M.gguf`) is the
container-internal view. From the host the symlink dangles, but inside
the container `/data/models` is bind-mounted to `/models` (runner.py:133),
so the link resolves correctly to the 78.4 GB merged GGUF on the same
filesystem (no double-storage).

### Boot precondition (HF_HUB_OFFLINE=1 stays the default)

CONTEXT D-12 air-gap is preserved at runtime. The operator's HF auth was a
populate-only operation (one-time download of config files). At boot the
container runs with `HF_HUB_OFFLINE=1` (env block enforces it), and vLLM's
`local_files_only` reads from the operator-staged cache without any
network access. STRICT air-gap CI (`ci_verify_phase3`) remains
correctness-equivalent to before.

### Workaround A empirical results (2026-05-02 follow-up boot smoke)

Two more boot attempts run on 2026-05-02 with the Workaround A wiring;
both failed at vLLM startup before any GPU memory allocation. Daily-driver
Gemma 4 26B-A4B v2.1 stayed up on port 8002 throughout (Mistral attempts
ran on port 8005 with container name `emmy-serve-mistral` to avoid
evicting the daily-driver — discipline carried over from the prior wave).

**Attempt 3 — repo:quant model + hf_config_path (run_id `20260502T231011Z-e07024`):**

```
engine.model: bartowski/mistralai_Mistral-Medium-3.5-128B-GGUF:Q4_K_M
engine.hf_config_path: /models/Mistral-Medium-3.5-128B-config
```

Container exited within ~10 seconds. Trace excerpt
(`runs/boot-failures/20260502T231011Z-e07024-boot-failure/vllm-stdout-stderr.log`):

```
File "/usr/local/lib/python3.12/dist-packages/vllm/engine/arg_utils.py", line 689, in __post_init__
    self.model = get_model_path(self.model, self.revision)
File "/usr/local/lib/python3.12/dist-packages/vllm/transformers_utils/repo_utils.py", line 220, in get_model_path
    return snapshot_download(repo_id=model, **common_kwargs)
File "/usr/local/lib/python3.12/dist-packages/huggingface_hub/utils/_validators.py", line 138, in validate_repo_id
    raise HFValidationError(...)
huggingface_hub.errors.HFValidationError: Repo id must use alphanumeric chars, '-', '_' or '.'.
The name cannot start or end with '-' or '.' and the maximum length is 96:
'bartowski/mistralai_Mistral-Medium-3.5-128B-GGUF:Q4_K_M'.
```

**Root cause:** vLLM's `get_model_path` (called from
`AsyncEngineArgs.__post_init__` line 689 when `HF_HUB_OFFLINE=1`) does
NOT recognize the `repo:quant` model format. It naively passes the
string to `huggingface_hub.snapshot_download(repo_id=...)`, which fails
the HF Hub repo_id validator on the colon. Only vLLM's
`GGUFModelLoader._prepare_weights` knows how to handle `repo:quant`
(model_loader/gguf_loader.py:60-67) — but the offline-mode short-circuit
runs FIRST and never reaches the GGUF loader. **Workaround A as the
orchestrator described it (repo:quant + hf_config_path) is INFEASIBLE
without a vLLM-side patch.**

**Attempt 4 — local file + hf_config_path (run_id `20260502T231409Z-8f35fc`):**

```
engine.model: /models/Mistral-Medium-3.5-128B-Q4_K_M.gguf
engine.hf_config_path: /models/Mistral-Medium-3.5-128B-config
```

Container exited within ~15 seconds. Trace excerpt
(`runs/boot-failures/20260502T231409Z-8f35fc-boot-failure/vllm-stdout-stderr.log`):

```
File "/usr/local/lib/python3.12/dist-packages/vllm/engine/arg_utils.py", line 1590, in create_engine_config
    maybe_override_with_speculators(...)
File "/usr/local/lib/python3.12/dist-packages/vllm/transformers_utils/config.py", line 596, in maybe_override_with_speculators
    config_dict, _ = PretrainedConfig.get_config_dict(...)
File "/usr/local/lib/python3.12/dist-packages/transformers/configuration_utils.py", line 759, in _get_config_dict
    config_dict = load_gguf_checkpoint(resolved_config_file, return_tensors=False)["config"]
File "/usr/local/lib/python3.12/dist-packages/transformers/modeling_gguf_pytorch_utils.py", line 648, in load_gguf_checkpoint
    raise ValueError(f"GGUF model with architecture {architecture} is not supported yet.")
ValueError: GGUF model with architecture mistral3 is not supported yet.
```

**Root cause:** Same T-01 blocker as the prior wave's Attempt 2. The
`maybe_override_with_speculators` path UNCONDITIONALLY parses the GGUF
file when given a local path (`config.py:587-591`: `check_gguf_file →
gguf_file=basename → get_config_dict(parent, gguf_file=...)`). The
`hf_config_path` field is consulted only AFTER, in `get_config()`
(`config.py:633+`), so it does NOT bypass the speculators check.

### Empirical conclusions

- **Workaround A repo:quant variant** does NOT work due to a separately-
  preexisting vLLM bug — the offline-mode short-circuit in
  `arg_utils.py:687-694` calls `get_model_path()` for ALL models when
  `HF_HUB_OFFLINE=1`, and `get_model_path` does not recognize `repo:quant`.
  This is a NEW upstream bug to file against vLLM (or a bug in our
  understanding of the orchestrator's "repo:quant bypass" hypothesis).

- **Workaround A hf_config_path-only variant** does NOT bypass T-01.
  The speculators check at `config.py:587-591` parses the GGUF
  unconditionally for local-file model paths, and the `hf_config_path`
  field is only consulted later in `get_config()`. T-01 still fires
  with the same `mistral3 not supported yet` error class.

- The schema/runner extension (`hf_config_path: Optional[str] = None`
  + `--hf-config-path` CLI emission) is correct work that lands
  regardless. It will be useful when paired with an alternative
  speculators-check bypass (e.g., a vLLM monkey-patch that gates
  GGUF parsing on `hf_config_path is None`, OR a transformers-side
  patch adding `mistral3` to `GGUF_SUPPORTED_ARCHITECTURES`).

### Refined operator decision menu (now 6 paths)

The Plan 04.7-02 v1 prior decision menu had 4 paths (wait / NVFP4 /
llama.cpp / defer). The empirical Workaround A failure adds 2 more
paths and refines the decision shape:

| # | Path | Engineering cost | Timeline | v1 impact |
|---|---|---|---|---|
| 1 | **Wait for upstream `mistral3` GGUF arch support** in transformers' `GGUF_SUPPORTED_ARCHITECTURES` (the load-bearing fix) | low (re-pull container + re-run smoke) | indeterminate (depends on transformers project) | none — v1 just waits |
| 2 | **Wait for upstream `repo:quant` fix** in vLLM's `get_model_path` so the orchestrator's Workaround A could be used | low (re-pull container + re-run smoke) | indeterminate (less-load-bearing than #1) | minimal — flip back to repo:quant model path |
| 3 | **Switch to NVFP4** (RecViking build) — sidesteps GGUF entirely | medium (new bundle authoring per Plan 04.7-01 pattern; Phase 5 calibration question becomes "is NVFP4 throughput acceptable on GB10 UMA?") | days | retire v1; cut v2 NVFP4 |
| 4 | **Switch to llama.cpp serving** | high (outside vLLM-only D-02 envelope; new sidecar shape; new harness adapter) | weeks | full architectural detour |
| 5 | **Hot-patch transformers `GGUF_SUPPORTED_ARCHITECTURES`** to add `mistral3` (alias of `mistral`) via a sitecustomize.py mounted into the container | medium (small hot-patch; risk of subtle GGUF parsing differences between mistral and mistral3 metadata-key naming conventions; requires testing each tensor) | hours | v1 ships with patch artifact in source tree (4 files: patch script + mount in runner.py + tests + PROFILE_NOTES section) |
| 6 | **Defer the entire phase** — drop Mistral 3.5 128B from the active stack until upstream GGUF support lands | zero | zero | drop the Phase 5 dense-128B matrix slot |

**Recommendation:** Option 1 + Option 2 (just wait for upstream — both
are no-cost and Phase 04.7 is eval-only). Option 5 is tempting but
unverified — the `mistral3` GGUF metadata uses keys like
`mistral3.context_length` (vs `mistral.context_length`); transformers'
GGUF_TO_TRANSFORMERS_MAPPING `mistral` → `context_length` mapping
might-or-might-not work with the mistral3 keys. Empirical verification
before claiming Option 5 is safe.

### What hf_config_path IS still good for

The schema/runner work is committed and operationally valid:
- Pre-04.7-02 profiles unaffected (Optional default None).
- A future Workaround A iteration that uses an architecture vLLM DOES
  allowlist (e.g., a hypothetical `mistral` GGUF where the GGUF
  architecture string was `mistral` not `mistral3`) would benefit from
  the field.
- Operator-side patching (Option 5) would benefit from having
  `hf_config_path` available so the patched config-load path can read
  from a local dir bypassing GGUF parsing.

The field stays in the bundle even though it doesn't unblock T-01 in
this profile because (a) it documents intent, (b) it's load-bearing for
any future Workaround A revision, (c) removing it later would be a
behavioral change requiring a v2 cut.

## Option 5 sitecustomize hot-patch iteration (2026-05-02)

After Wave 2's empirical-failure decision-checkpoint surface, the operator
selected **Decision Option 5** ("Hot-patch transformers
`GGUF_SUPPORTED_ARCHITECTURES` to add `mistral3` (alias of `mistral`) via a
sitecustomize.py mounted into the container") from the refined 6-path menu
in "Workaround A empirical results" above. This wave produced a working
hot-patch that EMPIRICALLY UNBLOCKED T-01 — and uncovered three new
downstream error classes, two of which were small Rule 3 auto-fixes, one
of which is a fundamental architectural blocker.

### Patch wiring (4 source-tree files)

The sitecustomize hot-patch ships as a profile-bundle artifact directory
mounted into the container at process start. The mechanism (schema field,
bind-mount, env wiring) lives in the source tree; the policy (which
arches to alias) lives in the profile bundle per CLAUDE.md anti-pattern
("model-shaped logic in code"):

| File | Change |
|---|---|
| `emmy_serve/profile/schema.py` | `EngineConfig.airgap_patch_dir: Optional[str] = None` field added (strictly additive — pre-04.7-02-followup profiles validate unchanged) |
| `emmy_serve/boot/runner.py` | `render_docker_only_args` (when set) emits: bind-mount `-v <bundle>/<airgap_patch_dir>:/airgap_patches:ro` + env `PYTHONPATH=/airgap_patches` + env `EMMY_AIRGAP_PATCH_MISTRAL3=on` (per-patch opt-in flag so other Python processes that happen to land on this PYTHONPATH don't accidentally trigger the patch) |
| `tests/unit/test_profile_schema_gguf.py` | 2 new tests (positive + Optional default-None) |
| `tests/unit/test_docker_run_build.py` | 5 new tests (bind-mount + 2 env vars when set; triple absence when unset; independence from hf_config_path) |

The patch artifact ships as 3 files under `airgap_patches/`:

| File | Purpose |
|---|---|
| `sitecustomize.py` | Auto-imported by Python at process start when on `sys.path`. Defers to `mistral3_gguf_allowlist.apply()` when `EMMY_AIRGAP_PATCH_MISTRAL3=on` is in env. |
| `mistral3_gguf_allowlist.py` | The actual patch. `arch_list.append("mistral3")` + `cfg_map["mistral3"] = cfg_map["mistral"]`. Idempotent (set membership + dict identity check) + defensive (raises clear AttributeError if upstream module shape changes). Mimics the existing in-tree `qwen2moe→qwen2_moe` / `gpt-oss→gpt_oss` / `minimax-m2→minimax_m2` aliasing patterns at lines 57-64 of upstream `transformers/modeling_gguf_pytorch_utils.py`. |
| `README.md` | Provenance + removal criteria. |

### Empirical pre-validation (probed in container before authoring patch)

Before authoring the patch artifact, exec'd into the bartowski-imaged container
and probed transformers' GGUF data structures + the bartowski GGUF metadata:

- `transformers.modeling_gguf_pytorch_utils.GGUF_SUPPORTED_ARCHITECTURES` is a
  `list[str]` of 24 entries (general, llama, mistral, qwen2, qwen2_moe,
  gpt_oss, lfm2, qwen3, qwen3_moe, falcon, tokenizer, phi3, bloom, t5,
  stablelm, gpt2, starcoder2, mamba, nemotron, gemma2, gemma3, umt5, deci,
  minimax_m2). `mistral3` is NOT on the list.
- `GGUF_CONFIG_MAPPING['mistral']` exists and maps GGUF metadata key suffixes
  (`context_length`, `block_count`, `feed_forward_length`, ...) to HF config
  field names (`max_position_embeddings`, `num_hidden_layers`, `intermediate_size`,
  ...). The bartowski GGUF uses `mistral3.context_length` etc. — the
  SUFFIXES are byte-identical between mistral and mistral3 (the rename is
  purely the prefix arch string).
- `GGUF_TO_TRANSFORMERS_MAPPING['config']` IS the same dict object as
  `GGUF_CONFIG_MAPPING` (verified via `is`). So aliasing
  `GGUF_CONFIG_MAPPING['mistral3']` automatically propagates through the
  config-mapping rename loop in `load_gguf_checkpoint` (lines 95-119).
- After applying the proposed patch in the container,
  `m.load_gguf_checkpoint('/models/...gguf', return_tensors=False)` succeeded
  end-to-end and produced a clean `parsed_parameters['config']` dict with
  `model_type='mistral3'`, `vocab_size=131072`, `num_hidden_layers=88`,
  `max_position_embeddings=262144`, etc. — confirming the patch is the
  load-bearing fix for T-01.
- transformers 5.6.0 already ships `Mistral3Config` (registered for
  `model_type='mistral3'` via `AutoConfig.for_model('mistral3')`). The GGUF
  allowlist gap was the ONLY blocker at the transformers layer.
- `gguf.MODEL_ARCH.MISTRAL3 = 116` exists with `MODEL_ARCH_NAMES[116] =
  'mistral3'` — the gguf-py side already supports the architecture, no
  additional patching needed there.

This pre-validation was the basis for picking Option 5 as a viable path
(vs the unverified hypothesis stated in the prior wave's decision menu).

### Boot-smoke timeline (3 attempts, each cleared a barrier and surfaced a new one)

**Attempt 5 — sitecustomize patch + Workaround A wiring intact (run_id `20260502T233850Z-6282d9`):**

Container started. First log line confirmed patch applied:
```
[mistral3_gguf_allowlist] v1.0.0 applied: mistral3 → GGUF allowlist + cfg_map alias of mistral. transformers.load_gguf_checkpoint should now parse Mistral 3.x GGUFs.
```

vLLM proceeded through arg parsing, NIXL setup, and architecture
resolution. **T-01 cleared:**
```
INFO 05-02 23:39:18 [model.py:554] Resolved architecture: Mistral3ForConditionalGeneration
INFO 05-02 23:39:18 [model.py:1685] Using max model len 131072
```

Failed downstream at `create_model_config`:
```
File "vllm/engine/arg_utils.py", line 1448, in create_model_config
    return ModelConfig(...)
pydantic_core.ValidationError: 1 validation error for ModelConfig
  Value error, Loading a multimodal GGUF model needs to use original tokenizer.
  Please specify the unquantized hf model's repo name or path using the
  --tokenizer argument.
```

Root cause: vLLM resolved `Mistral3ForConditionalGeneration` (multimodal),
which rejects the GGUF-embedded tokenizer fallback. Required `--tokenizer`
to point at a directory with HF tokenizer files.

→ **Rule 3 auto-fix**: uncomment `tokenizer:` line in serving.yaml; point
   at `/models/Mistral-Medium-3.5-128B-config` (the operator-staged dir
   from Workaround A which already contains tokenizer.json +
   tokenizer_config.json). Sidesteps the prior gated-repo +
   offline-cache collision because the dir is locally present.

**Attempt 6 — past tokenizer barrier (run_id `20260502T234040Z-5af3fe`):**

Failed at `create_engine_config` / `VllmConfig`:
```
File "vllm/engine/arg_utils.py", line 2094, in create_engine_config
    config = VllmConfig(...)
pydantic_core.ValidationError: 1 validation error for VllmConfig
  Value error, torch.bfloat16 is not supported for quantization method gguf.
  Supported dtypes: [torch.float16, torch.float32]
```

Plus the warning:
```
WARNING 05-02 23:41:00 [gguf.py:69] GGUF has precision issues with bfloat16 on Blackwell.
```

Root cause: `Mistral3Config` declares `dtype: bfloat16` (sourced from the
operator-staged config.json), but vLLM's GGUF backend only supports
float16 / float32. Engine cannot proceed without an explicit `--dtype`
override.

→ **Rule 3 auto-fix**: add `EngineConfig.dtype: Optional[Literal["auto",
   "float16", "bfloat16", "float32"]] = None` schema field;
   `render_vllm_cli_args` emits `--dtype <value>` when set;
   `engine.dtype: float16` in serving.yaml. Float16 narrows compute to
   what GGUF supports without doubling KV vs fp32.

**Attempt 7 — past dtype barrier; engine init begins (run_id `20260502T234222Z-e848d9`):**

vLLM cleared MUCH more code path: kv_cache configured (fp8), chunked
prefill enabled, asynchronous scheduling enabled, IR op priority
configured. Then failed at the final `VllmConfig` validation:

```
INFO 05-02 23:42:42 [vllm.py:840] Asynchronous scheduling is enabled.
INFO 05-02 23:42:42 [kernel.py:203] Final IR op priority after setting platform defaults: IrOpPriorityConfig(rms_norm=['native'])
...
pydantic_core.ValidationError: 1 validation error for VllmConfig
  Value error, The tokenizer must be an instance of MistralTokenizer.
```

**Root cause (architectural):** When the `mistral` `tool_call_parser` is
configured, vLLM's mistral-format chat-template path requires a Mistral-
format tokenizer (`mistral_common.MistralTokenizer`, typically loaded from
`tekken.json` via `--tokenizer-mode mistral`). The operator-staged dir has
only HF-format `tokenizer.json` and `tokenizer_config.json` — no
`tekken.json`. This is the architectural blocker that ends the wave.

### Refined operator decision menu (now 7 paths, was 6)

| # | Path | Engineering cost | Timeline | v1 impact |
|---|---|---|---|---|
| 1 | **Wait for upstream** transformers `mistral3` GGUF arch support | low | indeterminate | none — v1 just waits |
| 2 | **Wait for upstream vLLM** `repo:quant` fix in `get_model_path` | low | indeterminate | minimal |
| 3 | **Switch to NVFP4** (RecViking build) — sidesteps GGUF entirely | medium | days | retire v1; cut v2 NVFP4 |
| 4 | **Switch to llama.cpp serving** | high (outside vLLM-only D-02) | weeks | architectural detour |
| 5 | **Hot-patch transformers `GGUF_SUPPORTED_ARCHITECTURES`** | medium (DONE; patch ships in v1) | hours | DONE for T-01; new architectural blocker found |
| 6 | **Defer the entire phase** | zero | zero | drop the Phase 5 dense-128B matrix slot |
| 7 | **NEW: Source `tekken.json` for the operator-staged config dir** then add `--tokenizer-mode mistral` to the bundle. Two sub-paths: (a) operator re-downloads from gated `mistralai/Mistral-Medium-3.5-128B` HF repo (likely present alongside tokenizer.json); (b) generate from tokenizer.json via mistral-common conversion utility (less straightforward). Either subpath is a one-time staging op + `--tokenizer-mode mistral` schema/runner extension. | low (assuming sub-path a) — schema+runner field add + 1 file download + bundle hash recompute | hours | v1 ships with the additional `tokenizer_mode: mistral` field |

**Recommendation:** **Option 7 sub-path (a)** — operator re-runs
`huggingface-cli download mistralai/Mistral-Medium-3.5-128B --include
"tekken.json"` (or equivalent) to add the file to the operator-staged
dir. This is the lowest-cost path to actually closing G-1, because it
addresses the load-bearing architectural blocker discovered AFTER the
sitecustomize patch cleared T-01.

If sub-path (a) is infeasible (file not present in the HF repo, or the
operator no longer has HF auth), Option 1 (wait for upstream) becomes
the next-cheapest fallback.

### What this wave proved + what remains

**Proved:**
- The sitecustomize hot-patch IS the load-bearing fix for T-01. The
  patch fires correctly in the container (stderr confirmation logged
  on every boot of attempts 5/6/7).
- transformers 5.6.0 already ships full mistral3 model support
  (`Mistral3Config`, `Mistral3ForConditionalGeneration`, etc.); the
  allowlist gap was the only barrier between the GGUF parser and
  successful config construction.
- vLLM's GGUF backend reaches deep engine-init code (kv_cache config,
  scheduler, IR op priority) BEFORE failing on the MistralTokenizer
  requirement — confirming the GGUF parsing + model-load code path
  fundamentally works for `mistral3` after the patch.

**Remains (architectural):**
- vLLM's `mistral` tool_call_parser path requires
  `mistral_common.MistralTokenizer` (loaded from `tekken.json`); the
  operator-staged dir has only HF tokenizer.json. Resolution requires
  EITHER tekken.json staging (Option 7 sub-path a) OR a different
  parser path (which contradicts CONTEXT D-09 D-09 mistral-parser
  requirement — would force a v2 cut).

**Operator endpoint discipline:** Daily-driver Gemma 4 26B-A4B v2.1 stayed
up on port 8002 throughout this wave (Mistral attempts on port 8005 with
container name `emmy-serve-mistral`). Discipline carried over from Wave
2; operator endpoint never lapsed.

### Wave 3 hash trail

The bundle hash bumped 3 times in Wave 3:
- `c326add4...` (Wave 2 final, T-01-blocked snapshot — pre-Wave-3 starting point)
- `a5bb2689...` (Wave 3 commit B — airgap_patches dir + serving.yaml field)
- `75b0b841...` (Wave 3 commit C tokenizer fix — uncommented + pointed at local dir)
- `7ea0f1ad...` (Wave 3 commit C dtype fix — added float16 + new schema field)

### Removal criteria for the airgap_patches/ artifact

Remove `profiles/mistral-medium-3.5/v1/airgap_patches/` + the
`engine.airgap_patch_dir` line from serving.yaml + the
`EMMY_AIRGAP_PATCH_MISTRAL3` env when EITHER:

- transformers ships native `mistral3` GGUF allowlist support upstream
  (track: TBD upstream issue), OR
- v2 of this profile cuts to a different serving path (NVFP4, llama.cpp).

Either path is a v2 cut (behavioral change), not an in-place edit. v1
preserves the patch + the empirical-evidence trail of the 3-attempt boot
smoke iteration.

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
