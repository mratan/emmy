# Phase 5 Eval — Profile Participants Matrix

**Generated:** Phase 04.1 close (2026-04-24)
**Purpose:** Enumerate the four profiles that Phase 5 evaluates as a dense-vs-MoE × Qwen-vs-Gemma matrix. Phase 5's eval harness imports the harness-as-library and rotates through each profile via `/profile <id>@<version>`.

## Matrix

| Family | Variant | Profile ID | Version | Param count | Quant | Container | gmu (KV bisected) | Hash | Status | Smoke tok/s | Thermal-2h p50 tok/s | Role |
|---|---|---|---|---|---|---|---:|---|---|---:|---:|---|
| Qwen 3.6 | MoE | `qwen3.6-35b-a3b` | `v3.1` | 35B (3B active) | FP8 (publisher) | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` + fastsafetensors | 0.55 | `sha256:f9dcabd1...` | Phase 1 daily-driver | ~50 | 48.1 (Phase 1 measured) | default |
| Qwen 3.6 | **Dense** | `qwen3.6-27b` | `v1` | 27B | FP8 (publisher) | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` + fastsafetensors | 0.86 | `sha256:c3ccf1e1...` | **Phase 4.1 LANDED** | 4.7 | 7.6 | dense (opt-in) |
| Gemma 4 | MoE | `gemma-4-26b-a4b-it` | `v2` | 26B (4B active) | FP8 (runtime) | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | 0.86 | `sha256:ec14fb09...` | Phase 4 closed | ~37 | 35.9 (Phase 4 measured) | gemma sibling |
| Gemma 4 | **Dense** | `gemma-4-31b-it` | `v1` | 30.7B (BF16 weights → FP8 runtime quant) | FP8 (runtime) | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | 0.86 | `sha256:fe9eded6...` | **Phase 4.1 LANDED** | 6.5 | 6.4 | gemma dense (opt-in) |

## Notes

- **Daily-driver default UNCHANGED** — `qwen3.6-35b-a3b@v3.1` remains the boot-time and `/profile`-default. Phase 4.1 added two opt-in dense siblings; the post-Phase-5 eval informs whether to change the default.
- **All four converge to gpu_memory_utilization=0.86** on GB10 / 128 GB UMA via `scripts/find_kv_budget.py` — clearly a hardware-level vLLM allocation ceiling, not a model-specific knob. Pitfall #1 sole-writer discipline preserved.
- **Throughput is informational only**, NOT a Phase 5 acceptance gate (per operator directive `feedback_dense_model_throughput.md`). Phase 5 will eval correctness (tool-call shape, edit precision, plan quality, MMLU/HumanEval/etc) and treat tok/s as one signal among many — not as a pass/fail.
- **Container per family** — Qwen profiles boot on the NGC fastsafetensors-derived image (~3 min cold start); Gemma profiles boot on the upstream Day-1 Gemma 4 image (~8 min cold start). The `serving.yaml.engine.container_image_digest` field pins each.
- **Thermal validation** — every participant has a `runs/<phase>-{kv,thermal}/pass{1,2}-{record-floors,assert-floors}/summary.json` evidence trail with `preemptions_hour2: 0` and `oom_events: 0` recorded.

## Phase 5 axes

The four-cell matrix lets Phase 5 eval surface:

1. **Dense vs MoE on coding tasks** — does activating all params win on long-tail correctness, or does MoE's specialization carry?
2. **Qwen vs Gemma on the same axes** — different training mixes, different tool-call formats (qwen3_coder XML vs gemma4 native), different chat templates.
3. **Bandwidth-bound vs compute-bound bottlenecks** — dense profiles measure how DGX Spark's UMA bandwidth caps real-world throughput against the theoretical compute headroom.

Phase 5 eval scripts live under `eval/` and import the harness as a library (never bypass it).

## Profile swap commands (Phase 4.1-aware)

```bash
# Daily-driver (unchanged):
/profile qwen3.6-35b-a3b

# Phase 4.1 dense siblings:
/profile qwen3.6-27b           # dense Qwen 27B FP8
/profile gemma-4-31b-it        # dense Gemma 4 31B (BF16 weights, runtime FP8 quant)

# Existing Gemma MoE:
/profile gemma-4-26b-a4b-it    # Phase 4 Gemma 4 MoE
```

Each profile family has a `DEFAULT_VARIANT` marker (`v1` for both new dense families; `v3.1` for Qwen MoE; `v2` for Gemma MoE) — `/profile <family>` resolves to the marked default automatically.

## References

- `profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md` — Qwen MoE provenance + Phase-1 thermal evidence
- `profiles/qwen3.6-27b/v1/PROFILE_NOTES.md` — Qwen dense Phase 4.1 KV + thermal evidence
- `profiles/gemma-4-26b-a4b-it/v2/PROFILE_NOTES.md` — Gemma MoE Phase-4 KV + thermal evidence
- `profiles/gemma-4-31b-it/v1/PROFILE_NOTES.md` — Gemma dense Phase 4.1 KV + thermal evidence
- `.planning/phases/04.1-dense-variant-model-profiles-qwen3-6-27b-fp8-gemma-4-31b-it-/04.1-CONTEXT.md` — Phase 4.1 scope + research-already-done
- `runs/phase4.1-{qwen,gemma}-{kv,thermal}/` — Phase 4.1 KV bisection + thermal replay evidence (4 dirs)
