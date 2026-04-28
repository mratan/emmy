# Phase 5 Eval — Profile Participants Matrix

**Generated:** Phase 04.1 close (2026-04-24); v1.1 RAM-headroom retune appended 2026-04-25; **2026-04-28 update — Qwen MoE dropped from active stack; Gemma MoE v2.1 + dense v1.2 added (256K context bump)**.
**Purpose:** Enumerate the profiles Phase 5 evaluates as a dense-vs-MoE × Qwen-vs-Gemma matrix (now Qwen-dense × Gemma-MoE × Gemma-dense — Qwen MoE removed per V-RESULTS-v8 decision). Phase 5's eval harness imports the harness-as-library and rotates through each profile via `/profile <id>@<version>`.

## Matrix (active participants)

| Family | Variant | Profile ID | Version | Param count | Quant | Container | gmu | max_model_len | Hash | Status | Smoke tok/s | Thermal-2h p50 tok/s | Role |
|---|---|---|---|---|---|---|---:|---:|---|---|---:|---:|---|
| Gemma 4 | **MoE (daily-driver)** | `gemma-4-26b-a4b-it` | **`v2.1`** (DEFAULT_VARIANT) | 26B (4B active) | FP8 (runtime) | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | **0.55** | **262144 (256K)** | `sha256:f5c11944...` | **Daily-driver since 2026-04-28** | ~37 (inherited) | inherited from v2 (smoke at 256K pending) | default |
| Gemma 4 | MoE (KV-ceiling audit) | `gemma-4-26b-a4b-it` | `v2` (frozen) | 26B (4B active) | FP8 (runtime) | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | 0.86 | 131072 (128K) | `sha256:5ff29567...` | Phase 4 KV-bisection audit, prior daily-driver | ~37 | 35.9 (Phase 4 measured) | n/a (audit) |
| Qwen 3.6 | **Dense (operational)** | `qwen3.6-27b` | **`v1.1`** (DEFAULT_VARIANT) | 27B | FP8 (publisher) | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` + fastsafetensors | **0.55** (D-29-equivalent retune) | 131072 (128K) | `sha256:4f08e4e5...` | Phase 4.1 follow-up; V1=100% V3=5/5 in V-RESULTS-v8 | 4.7 (inherited) | 7.6 (inherited from v1) | dense (opt-in) |
| Qwen 3.6 | Dense (KV-ceiling audit) | `qwen3.6-27b` | `v1` (frozen) | 27B | FP8 (publisher) | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` + fastsafetensors | 0.86 (KV bisection) | 131072 (128K) | `sha256:c3ccf1e1...` | Phase 4.1 LANDED — preserved as bisection-result audit artifact | 4.7 | 7.6 | n/a (audit) |
| Gemma 4 | **Dense (operational, 256K)** | `gemma-4-31b-it` | **`v1.2`** (DEFAULT_VARIANT) | 30.7B (BF16 weights → FP8 runtime quant) | FP8 (runtime) | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | **0.55** | **262144 (256K)** | `sha256:78a0c907...` | **2026-04-28 long-context bump from v1.1** | 6.5 (inherited) | inherited from v1.1 (smoke at 256K pending) | gemma dense (opt-in) |
| Gemma 4 | Dense (operational, 128K) | `gemma-4-31b-it` | `v1.1` (frozen) | 30.7B | FP8 (runtime) | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | 0.55 | 131072 (128K) | `sha256:7faa8a7e...` | Phase 4.1 follow-up; V1=95% V3=5/5 in V-RESULTS-v8 | 6.5 (inherited) | 6.4 (inherited from v1) | gemma dense (eval-only) |
| Gemma 4 | Dense (KV-ceiling audit) | `gemma-4-31b-it` | `v1` (frozen) | 30.7B | FP8 (runtime) | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | 0.86 (KV bisection) | 131072 (128K) | `sha256:fe9eded6...` | Phase 4.1 LANDED — preserved as bisection-result audit artifact | 6.5 | 6.4 | n/a (audit) |

## Dropped from active stack (2026-04-28)

`qwen3.6-35b-a3b` (Qwen 3.6 35B-A3B MoE) was removed. V-RESULTS-v8 measured V1 memory adoption at 55% across N=78 sessions vs the dense Qwen (100%) and both Gemma profiles (100% MoE / 95% dense); operator decision was to stop running it as a Phase 5 participant. Historical evidence preserved at `.planning/phases/04.4-…/runs/V-RESULTS-{v1..v8}*.md`. Profile bundles deleted from working tree; git history retains the v1/v2/v3/v3.1/v3.2/v3.1-* sibling chain.

## Notes

- **Daily-driver default — Gemma 4 26B-A4B v2.1** (since 2026-04-28). The original Phase-1 default (Qwen 3.6 35B-A3B v3.1) was switched per the V-RESULTS-v8 4-profile matrix and dropped same-day.
- **Phase 4.1 + 04.4 follow-ups: 256K + RAM-headroom retunes.** Both Gemma operational siblings (MoE v2.1 + dense v1.2) ride the 256K native context; Gemma 4 declares `max_position_embeddings=262144` with `sliding_window=1024`, making the 128K→256K bump architecturally cheap (sliding-window attention bounds per-layer KV regardless of context). gmu=0.55 across all operational siblings (mirrors the dense v1→v1.1 precedent that re-targets operator comfort over no-preempt KV ceiling).
- **Long-context thermal smoke pending** — v2.1 and v1.2 both validated by KV-math + audit-sibling thermal inheritance (gmu=0.55 < gmu=0.86 means strictly less memory pressure, so thermal cannot regress relative to the audit). A 256K-context behavioral + thermal smoke is queued for the next operator GPU window; design discussion in postmortem follow-ups.
- **Both dense KV-ceiling references (v1) bisected to gpu_memory_utilization=0.86** on GB10 / 128 GB UMA via `scripts/find_kv_budget.py` — same value all four GB10 profiles' bisections find, clearly a hardware-level vLLM allocation ceiling. The v1.1 retune is a Pitfall #3 (RAM headroom) override of Pitfall #1 (sole-writer), same exemption v3.1 took.
- **Throughput is informational only**, NOT a Phase 5 acceptance gate (per operator directive `feedback_dense_model_throughput.md`). Phase 5 will eval correctness (tool-call shape, edit precision, plan quality, MMLU/HumanEval/etc) and treat tok/s as one signal among many — not as a pass/fail.
- **Container per family** — Qwen profiles boot on the NGC fastsafetensors-derived image (~3 min cold start); Gemma profiles boot on the upstream Day-1 Gemma 4 image (~8 min cold start). The `serving.yaml.engine.container_image_digest` field pins each.
- **Thermal validation** — every participant has a `runs/<phase>-{kv,thermal}/pass{1,2}-{record-floors,assert-floors}/summary.json` evidence trail with `preemptions_hour2: 0` and `oom_events: 0` recorded. v1.1 inherits v1's thermal validation (gmu=0.55 < gmu=0.86 means strictly less memory pressure, so thermal cannot regress — same logic v3.1 applied vs v3).

## Phase 5 axes

The four-cell matrix lets Phase 5 eval surface:

1. **Dense vs MoE on coding tasks** — does activating all params win on long-tail correctness, or does MoE's specialization carry?
2. **Qwen vs Gemma on the same axes** — different training mixes, different tool-call formats (qwen3_coder XML vs gemma4 native), different chat templates.
3. **Bandwidth-bound vs compute-bound bottlenecks** — dense profiles measure how DGX Spark's UMA bandwidth caps real-world throughput against the theoretical compute headroom.

Phase 5 eval scripts live under `eval/` and import the harness as a library (never bypass it).

## Profile swap commands

```bash
# Daily-driver:
/profile gemma-4-26b-a4b-it    # Gemma 4 26B-A4B v2.1 (256K, gmu=0.55) — DEFAULT

# Phase 4.1 dense siblings (opt-in):
/profile qwen3.6-27b           # dense Qwen 27B FP8 v1.1 (128K, gmu=0.55)
/profile gemma-4-31b-it        # dense Gemma 4 31B v1.2 (256K, gmu=0.55)
```

Each profile family has a `DEFAULT_VARIANT` marker (`v2.1` for Gemma MoE; `v1.2` for Gemma dense; `v1.1` for Qwen dense) — `/profile <family>` resolves to the marked default automatically.

## References

- `profiles/gemma-4-26b-a4b-it/v2.1/PROFILE_NOTES.md` — Gemma MoE 256K daily-driver provenance
- `profiles/gemma-4-26b-a4b-it/v2/PROFILE_NOTES.md` — Gemma MoE Phase-4 KV-ceiling audit thermal evidence
- `profiles/qwen3.6-27b/v1/PROFILE_NOTES.md` — Qwen dense Phase 4.1 KV + thermal evidence
- `profiles/gemma-4-31b-it/v1/PROFILE_NOTES.md` — Gemma dense Phase 4.1 KV + thermal evidence
- `.planning/phases/04.1-dense-variant-model-profiles-qwen3-6-27b-fp8-gemma-4-31b-it-/04.1-CONTEXT.md` — Phase 4.1 scope + research-already-done
- `.planning/phases/04.4-filesystem-memory-tool-append-only-prefix-compaction-polish-/runs/V-RESULTS-v8-matrix-complete.md` — V-protocol matrix that triggered the 2026-04-28 daily-driver switch + Qwen MoE drop
- `runs/phase4.1-{qwen,gemma}-{kv,thermal}/` — Phase 4.1 KV bisection + thermal replay evidence (4 dirs)
