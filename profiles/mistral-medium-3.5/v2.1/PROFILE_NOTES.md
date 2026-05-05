---
profile_id: mistral-medium-3.5
profile_version: v2.1
created: 2026-05-05
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: 0.84  # converged via Wave 5 attempts 6-9 (see v2 history below); v2.1 inherits unchanged
  decode_throughput_p50_smoke_tokps: 4.42  # measured V-protocol v9 (2026-05-04, V-RESULTS-v9), V1 completed-task throughput
  cold_start_seconds: 600  # ~10 min cold-start, validated v9 boot
  # NO thermal fields — D-06 skips 2× 2h thermal replay; CLAUDE.md Pitfall #4 retained for daily-drivers only.
  # NO KV-bisection fields — D-05 skips formal protocol; gmu=0.84 is structural converged value, not measured ceiling.
validation_runs:
  - run_id: V-RESULTS-v9-mistral-128b
    measured: 2026-05-04
    notes: "V1 = 20/20 = 100% (corrected from v9-reported 0/20 analyzer bug; see V-RESULTS-v10). V3 = 4/5 (probe4 abstention; see V-RESULTS-v10 manual hand-score). 2/20 SP_OK_ONLY fallback (task05, task10) — fixed in v2.1 by removing SP_OK from system.md."
  - run_id: V-RESULTS-v10-mistral-rule-following
    measured: 2026-05-05
    notes: "Phase A 9/9 PASS; analyzer bug discovered + fixed; v2.1 cut as the calibration follow-up."
---

# Mistral Medium 3.5 128B — v2.1 Profile Notes (NVFP4 + SP_OK fix)

> **v2 → v2.1 calibration note (2026-05-05):** v2.1 differs from v2 in exactly one byte: `prompts/system.md` is empty in v2.1 (was the SP_OK canary instruction in v2). Per CLAUDE.md profile-immutability rule, this behavioral change required a new version directory. See "v2 → v2.1 — SP_OK overgeneralization fix" section near the bottom of this file for full rationale + V-RESULTS-v10 references.

The body below describes v2's NVFP4 pivot history (carried forward unchanged into v2.1). For the v2 → v2.1 delta specifically, jump to the bottom section.

Phase 04.7 — heavyweight dense 128B-class alternate, eval-only opt-in via
`/profile mistral-medium-3.5`. **NVFP4 PIVOT** from v1 GGUF after the GGUF
backend hit a hardware-level OOM ceiling on the GB10 / 128 GB UMA Spark box.

This v2 bundle is the proven escape hatch: NVFP4 safetensors via fastsafetensors
streams chunks GPU-direct, structurally avoiding the kernel page-cache + vLLM
pool double-allocation OOM mode that killed v1.

## Why v2 — the v1 GGUF post-mortem

v1 (bartowski Q4_K_M GGUF) shipped to Plan 04.7-02 boot smoke and went through
**5 waves and 9 layers of vLLM/transformers compatibility patches** before
running into the OOM ceiling:

| Wave | Layer | Barrier cleared / failure |
|---|---|---|
| 1 | — | Tokenizer offline-cache collision |
| 2 | — | Workaround A repo:quant rejected by `get_model_path` HFValidationError; Workaround A hf_config_path-only does NOT bypass speculators-check GGUF parse |
| 3 | 1 | T-01 — `mistral3` not in transformers GGUF allowlist (sitecustomize hot-patch) |
| 3 | — | Multimodal-aware tokenizer requirement (Rule 3 auto-fix: `tokenizer:` to operator-staged dir) |
| 3 | — | bf16 unsupported on GGUF backend (Rule 3 auto-fix: `dtype: float16`) |
| 3 | — | MistralTokenizer requirement (Wave 4 fix: `tokenizer_mode: mistral` + tekken.json) |
| 4 | — | Multimodal init OSError (Wave 4 fix: text-only-config strip + `Ministral3ForCausalLM` arch) |
| 4 | — | Spark coexistence at gmu=0.78 (operator decision: stop daily-driver Gemma) |
| 5 | 6 | Mistral3 multimodal weight-loader assertion (`mm_proj.gguf` hard-assert) — REPLACE method |
| 5 | 7 | vocab_size top-level access (hybrid stripped config: top-level + nested text_config) |
| 5 | 8 | `language_model.` prefix in hf_name map values (WRAP method; remap → 1017 → 795) |
| 5 | 9 | **Linux OOM via page cache + vLLM pool double-allocation** — `posix_fadvise(POSIX_FADV_DONTNEED)` mitigation: PARTIAL (36.8 GB to GPU before kernel OOM-killed EngineCore) |

**v1 final state: bootable to ~50% weight transfer; OOM-killed at the kernel
level.** The 73 GB GGUF mmap'd into page cache + vLLM's 99.8 GB pool reservation
exceeds the 128 GB UMA box's available headroom even with layer-9 fadvise
returning ~38 GB. This is a **vLLM GGUF backend architectural constraint** on
UMA (mmap-allocates the entire weight file alongside the pool), not an Emmy-
fixable bug. Pending vLLM `--no-mmap` upstream.

## v2 — what's different

**Quantization:** `compressed-tensors nvfp4-pack-quantized` (RecViking build,
quantized via `llm-compressor v0.10.1.dev121` — NOT ModelOpt 0.42.0, so the
CLAUDE.md-flagged NaN-in-weight_scale bug is N/A).

**Loader:** `fastsafetensors` (not `gguf`). vLLM's safetensors backend streams
tensor chunks GPU-direct without mmap'ing the entire file into page cache.
The OOM mode that killed v1 is structurally absent.

**Hybrid checkpoint shape:** 88 language_model layers in NVFP4 (W4A4-FP4 +
per-16 group scales, scale_dtype `float8_e4m3fn`); bf16 lm_head + embed_tokens;
bf16 vision_tower kept in safetensors but listed in `quantization_config.ignore`.
Total disk 80.3 GB (74.8 GiB).

**Architecture:** still routes through `Ministral3ForCausalLM` →
`MistralForCausalLM` via the text-only-config strip pattern proven in v1 Wave
4. The original RecViking config declares `Mistral3ForConditionalGeneration` +
`model_type: mistral3` (multimodal arch); the overlay dir overrides with
`Ministral3ForCausalLM` to bypass MultiModalBudget probes. Vision_tower bf16
tensors WILL still be in the safetensors files; vLLM's `MistralForCausalLM`
will see them as "unexpected keys" — at worst a load-time WARNING. If it errors
hard, an airgap_patch can filter; the v2 bundle keeps `airgap_patches/`
scaffolding for that contingency.

## Probe verification (2026-05-03 — pre-stage)

Before staging the 80 GB download, the dominant unknown was TP=4 vs TP=1
loadability. RecViking's HF card states the build was published for 4× RTX
5090 TP=4. A small-file probe (config.json + model.safetensors.index.json
only) confirmed:

| Check | Finding | Verdict |
|---|---|---|
| TP slicing | `hidden_size: 12288, num_attention_heads: 96, num_kv_heads: 8` byte-identical to upstream Mistral. 2 STORAGE shards, not 4 TP-rank shards. Tensor names have no rank suffixes. | **TP=1 portable ✓** |
| Quant format | `compressed-tensors nvfp4-pack-quantized v0.15.1.a20260428`, `kv_cache_scheme: None` (runtime-selectable) | Standard ✓ |
| Total disk | 80.3 GB (74.8 GiB) | Fits 128 GB UMA ✓ |
| Vision tower | NVFP4 ignore list = vision_tower + multi_modal_projector + lm_head (bf16 unquantized); included in safetensors | ⚠ Multimodal blocker, same workaround as v1 |
| Quantizer | `llm-compressor v0.10.1.dev121` | ModelOpt NaN bug N/A ✓ |

## v1 → v2 field deltas (`serving.yaml`)

| Field | v1 (GGUF) | v2 (NVFP4) | Reason |
|---|---|---|---|
| `engine.model` | `/models/Mistral-Medium-3.5-128B-Q4_K_M.gguf` (single file) | `/models/Mistral-Medium-3.5-128B-NVFP4-text-only-config` (overlay dir) | NVFP4 = directory-shaped model with config.json + .safetensors |
| `engine.model_hf_id` | `mistralai/Mistral-Medium-3.5-128B` | `RecViking/Mistral-Medium-3.5-128B-NVFP4` | Source repo for v2 |
| `engine.tokenizer` | `/models/Mistral-Medium-3.5-128B-config` | `/models/Mistral-Medium-3.5-128B-NVFP4-text-only-config` | tekken.json symlinked into overlay; same dir as model |
| `engine.hf_config_path` | `/models/Mistral-Medium-3.5-128B-text-only-config` | (UNSET — removed) | Safetensors backend reads model_dir/config.json directly; the overlay IS the model dir |
| `engine.load_format` | `auto` (GGUF backend ignores fastsafetensors) | `fastsafetensors` | NVFP4 PIVOT — direct GPU streaming |
| `engine.dtype` | `float16` (GGUF Blackwell bf16-reject workaround) | UNSET (vLLM auto-detects bfloat16 from config) | NVFP4 backend handles bf16 fine |
| `engine.quantization` | `gguf` | `auto` | vLLM auto-detects compressed-tensors NVFP4 from config.json's quantization_config block. HF card: "No --quantization flag — already quantized" |
| `engine.tokenizer_mode` | `mistral` | `mistral` | UNCHANGED — still need MistralTokenizer for the `mistral` tool_call_parser |
| `engine.airgap_patch_dir` | `airgap_patches` (9 layers of GGUF hot-patches) | `airgap_patches` (kept scaffolding; GGUF patches don't apply but kept for NVFP4 contingency) | Cleanup candidate for v2.1 if first boot needs no patches |
| `env.VLLM_LOAD_FORMAT` | `auto` | `fastsafetensors` | matches engine.load_format |
| All other fields | (carried over) | (identical) | gmu, kv_cache_dtype, max_model_len, max_num_seqs, tool_call_parser, etc. |

## Operator-staged out-of-bundle artifacts

| Path | Purpose | How to re-stage if Spark reimaged |
|---|---|---|
| `/data/models/Mistral-Medium-3.5-128B-NVFP4/` | Raw RecViking download (80.3 GB) | `huggingface-cli download RecViking/Mistral-Medium-3.5-128B-NVFP4 --local-dir /data/models/Mistral-Medium-3.5-128B-NVFP4` |
| `/data/models/Mistral-Medium-3.5-128B-NVFP4-text-only-config/` | Overlay dir: stripped config.json + symlinks to .safetensors + tokenizer | See "Overlay dir setup" below |

### Overlay dir setup

```bash
RAW=/data/models/Mistral-Medium-3.5-128B-NVFP4
OVERLAY=/data/models/Mistral-Medium-3.5-128B-NVFP4-text-only-config
mkdir -p "$OVERLAY"

# 1. Stripped config.json (top-level Ministral3ForCausalLM + quantization_config preserved + multimodal fields dropped)
python3 - <<'EOF'
import json
RAW = "/data/models/Mistral-Medium-3.5-128B-NVFP4"
OVERLAY = "/data/models/Mistral-Medium-3.5-128B-NVFP4-text-only-config"
with open(f"{RAW}/config.json") as f:
    c = json.load(f)
qc = c.get("quantization_config", {})
tc = c.get("text_config", {})
stripped = {
    "architectures": ["Ministral3ForCausalLM"],
    "model_type": "ministral3",
    "torch_dtype": "bfloat16",
    "quantization_config": qc,
    **{k: v for k, v in tc.items() if k != "rope_scaling"},
    "text_config": tc,
}
for drop in ("vision_config", "image_token_index", "multimodal_projector_bias",
             "projector_hidden_act", "spatial_merge_size", "vision_feature_layer",
             "image_token_id"):
    stripped.pop(drop, None)
with open(f"{OVERLAY}/config.json", "w") as f:
    json.dump(stripped, f, indent=2)
EOF

# 2. Symlink everything else: safetensors + index + tokenizer + tekken
for f in "$RAW"/*.safetensors \
         "$RAW"/model.safetensors.index.json \
         "$RAW"/tokenizer.json \
         "$RAW"/tokenizer_config.json \
         "$RAW"/tekken.json \
         "$RAW"/generation_config.json \
         "$RAW"/chat_template.jinja \
         "$RAW"/SYSTEM_PROMPT.txt; do
  [ -f "$f" ] && ln -sf "$f" "$OVERLAY/$(basename "$f")"
done
```

## Open questions / Wave 5 boot smoke unknowns

These are the hypothesized vs unknown failure surfaces; Plan 04.7-02 Wave 5
boot smoke will resolve them empirically:

1. **Vision_tower bf16 tensors as "unexpected keys"** — vLLM's `MistralForCausalLM`
   doesn't expect `model.vision_tower.*` or `model.multi_modal_projector.*` keys.
   Best case: WARN-and-skip. Worst case: hard error → needs an airgap_patch
   filter analogous to v1 layer 8 (name-remap), but for safetensors.

2. **Compressed-tensors NVFP4 + Blackwell SM12.1 + vLLM nightly** — each
   combination individually claimed-supported per HF card and CLAUDE.md; the
   full stack on Spark has no public success report.

3. **`quantization: auto` honoring config.json's quantization_config** — vLLM
   should auto-detect compressed-tensors NVFP4 and dispatch to the right
   backend. If it doesn't, may need to extend the EngineConfig.quantization
   Literal with `"compressed-tensors"` or `"nvfp4"` (additive schema change).

4. **Coexistence with daily-driver Gemma** — same as v1 Wave 4: at gmu=0.78
   (99.8 GB pool target) Mistral cannot coexist with Gemma's ~68.7 GB. The
   `/profile mistral-medium-3.5` swap path stops Gemma first — same operator
   workflow as v1 envisioned.

## Rollback to v1

`profiles/mistral-medium-3.5/v1/` is preserved verbatim as the GGUF audit
artifact. If a future vLLM release ships `--no-mmap` (or equivalent UMA-aware
GGUF loader), v1 can be retried by flipping `DEFAULT_VARIANT` back to `v1`.
v1's hash `sha256:529a1cc0…` is unchanged; engine byte-identity preserved.

## Hash trail

- `sha256:529a1cc0…` — v1 final (GGUF, 9-layer airgap patch series)
- `sha256:28c0d7c3a3b81fe977ab7452c9cd67c43327cd03828bce6c9e21f3757e9121ce` — v2 (NVFP4 ship bundle, 2026-05-03)
- v2.1 (this bundle, 2026-05-05) — exact hash recorded only in `profile.yaml` (the canonical source). PROFILE_NOTES intentionally omits it because including a hash inside the bundle that itself goes into the hash creates a fixed-point dependency. Read `cat profile.yaml | grep hash:` for the live value.

The hash excludes `profile.yaml` per the canonicalization in
`emmy_serve/profile/hasher.py` (`EXCLUDE_ROOT_FILES = {"profile.yaml"}`).

## v2 → v2.1 — SP_OK overgeneralization fix (2026-05-05)

V-RESULTS-v10 cross-profile audit (`.planning/phases/04.4-…/runs/V-RESULTS-v10-cross-profile-audit.md`)
identified that 2/20 v9 V1 sessions (task05, task10) had Mistral
overgeneralize the SP_OK canary rule: when `memory.view` returned empty,
Mistral fell back to emitting `[SP_OK]` as the final response instead of
answering the user's actual substantive question. Same failure mode also
hit Qwen 35B-A3B MoE (1/8 preserved sessions, dropped from active stack).
Gemma profiles + Qwen 27B dense are clean.

The hypothesis (V-RESULTS-v10 H2): SP_OK occupies a privileged position
in MoE-style models' rule registry, and under uncertainty (empty memory
result) the model falls back to it. v10 Phase A's D2/D3 probes (SP_OK
removed from system.md) produced substantive answers, supporting the fix.

**v2.1 changes (single-byte change to system.md, immutability rule cuts
new version per CLAUDE.md "behavioral changes ... → new version directory"):**

| File | v2 | v2.1 |
|---|---|---|
| `prompts/system.md` | "When the user says 'ping' you must reply with the exact literal text [SP_OK] and nothing else." | (empty file) |

All other files byte-identical to v2 (harness.yaml, serving.yaml, grammars/, tool_schemas/, airgap_patches/, prompts/{compact,edit_format,tool_descriptions}.md, subagents/).

**SP_OK canary delivery**: not lost — moved out of system-prompt enforcement
into the operational boot probe at `emmy_serve/canary/sp_ok.py`, which already
runs at boot and verifies the model can produce the canary on demand. The
system-prompt-level rule was a redundant secondary check for V1/V3 protocol
runs that wasn't tested as actually-load-bearing on Mistral.

**DEFAULT_VARIANT not flipped.** Per CONTEXT D-13 + CLAUDE.md, DEFAULT_VARIANT
for `mistral-medium-3.5/` remains v1 (the GGUF audit artifact) until Phase 5
calibration completes. v2.1 is opt-in via explicit `/profile mistral-medium-3.5@v2.1`
or `--profile profiles/mistral-medium-3.5/v2.1`.

**Operator follow-up:** when next running a full V-protocol matrix on Mistral
(or any model), use v2.1 instead of v2. Expected behavior: 0/20 SP_OK_ONLY
fallback (down from v2's 2/20). V1 strict adoption + V3 rot protection
unaffected (memory.view tool-call decision is independent of system.md content
beyond the `read_at_session_start` directive auto-injected by session.ts).
