# Phase 5: Eval Harness + Reproducible Benchmark Suite — Research

**Researched:** 2026-04-25
**Domain:** Eval orchestration over a 4-profile MATRIX (Qwen MoE/dense × Gemma MoE/dense), driven through `@emmy/ux` SDK; reproducibility-grade artifact (provenance + variance + contamination control); air-gap-aware judge model integration
**Confidence:** HIGH on terminal-bench BaseAgent contract + LiveCodeBench + SWE-bench harness mechanics + Phase 2 SC-2/3 patterns we extend; **MEDIUM** on SWE-bench-Verified-on-aarch64 wall-clock (epoch.ai numbers are x86_64 + 32 cores; DGX Spark is aarch64 + 20 cores + likely-emulated images); **MEDIUM** on judge-model choice (multiple defensible options, all with tradeoffs documented in §Q5); **LOW** on outside-reproducer CI (no reference implementation found for a single-machine, aarch64, Spark-class verifier)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

> **No CONTEXT.md exists yet for Phase 5** — this research is upstream of `/gsd-discuss-phase`. The constraints below are extracted from `CLAUDE.md` (project invariants), `.planning/REQUIREMENTS.md` (EVAL-01..09 + UX-06 + POLISH-01..03), `.planning/ROADMAP.md` § Phase 5, and `eval/MATRIX.md` (the 4-profile participant manifest).

### Hard project constraints (from CLAUDE.md)

- **No cloud INFERENCE in the loop.** SearxNG is the one allowed loopback egress. Claude API for LLM-as-judge would breach this *if* run inside the same loop as inference; out-of-loop post-hoc judging is the architectural escape (see §Q5/Q13).
- **Profiles are immutable.** Field change → new version directory. Phase 5 hashes-and-pins; never mutates.
- **Every observability event embeds `{profile.id, profile.version, profile.hash}`.** Eval results extend this list with `vllm_version, container_digest, cuda_version, model_sha, eval_driver_commit, hardware_id` (EVAL-03).
- **No model-shaped logic in code.** All model-shaped behavior in YAML profiles (Phase 4 D-19 audit gate; Phase 5 must not reintroduce conditionals in eval driver).
- **YOLO + git for undo.** No approval popups in eval runs; eval dirs are gitignored runs/ artifacts.
- **`VLLM_NO_USAGE_STATS=1`** + air-gap STRICT CI gate every release.
- **DGX Spark thermal envelope.** 2-hour sustained-load already validated per profile. A multi-hour eval batch must respect this — operator may need to checkpoint and resume.

### Locked Decisions (from existing MATRIX + ROADMAP)

- **Phase 5 evaluates the 4 profiles in `eval/MATRIX.md`** — Qwen 35B MoE v3.1, Qwen 27B dense v1.1, Gemma 26B-A4B MoE v2, Gemma 31B-it dense v1.1. Daily-driver default unchanged.
- **Throughput is informational only**, not a Phase 5 acceptance gate (operator directive `feedback_dense_model_throughput.md`). Eval gates: correctness (tool-call shape, edit precision, plan quality, executable correctness, judge agreement) — NOT tok/s.
- **Eval imports the harness as a library** (EVAL-02). Never bypass the SDK. The Phase 2 SC-2 runner (`eval/phase2/sc2/run_sc2.ts`) and Phase 2 SC-3 runner are the existing reference shape — they import `@emmy/ux loadProfile` + `@emmy/provider postChat` + `@emmy/tools` directly.
- **N≥3 samples per task** (EVAL-04). Mean ± std reported.
- **`[SP_OK]` canary gates every benchmark loop** (EVAL-07). Already shipped in Phase 1 (`emmy_serve/canary/sp_ok.py`) and Phase 2 (`packages/emmy-ux/src/sp-ok-canary.ts`).
- **Full eval suite required to declare any change positive** (EVAL-08). Subset runs cannot promote.
- **Judge model from a different family than generation** (EVAL-06). Self-judging not allowed.
- **Suite includes:** terminal-bench 2.0 (primary) + prior-repo Phase 1 prompts (continuity baseline) + SWE-bench Verified (milestone) + LiveCodeBench (rolling contamination-resistant) [EVAL-01].

### Claude's Discretion (research recommends)

- **D-Q1 Eval driver location.** Recommend `packages/emmy-eval/` as a new workspace package — sibling to emmy-{provider, tools, ux, telemetry, context}. See §Q10.
- **D-Q2 Judge model.** Recommend a **2-tier judge stack**: tier-A self-hosted Llama-3.3-70B-Instruct-FP8 (or similar non-Qwen non-Gemma family) running in a DIFFERENT vLLM container, swapped after generation phase via existing `/profile` machinery, for in-loop air-gapped judging; tier-B optional Anthropic Claude Sonnet judge run OUT-OF-LOOP after generation (preserves air-gap STRICT for inference; allows `ci_verify_research_egress` PERMISSIVE posture for the optional cloud-judge pass). See §Q5.
- **D-Q3 SWE-bench-Verified scope.** Recommend running only `princeton-nlp/SWE-bench_Lite` (300 instances) on DGX Spark in Phase 5; treat full Verified (500) as a **CI/cloud milestone** since aarch64 image coverage is ~80% best-effort + emulation overhead makes it a 6h+/profile run vs ~1h on x86. See §Q12.
- **D-Q4 LiveCodeBench rolling cutoff.** Recommend computing each profile's effective cutoff as `min(model_pretraining_cutoff, profile_first_release_date)` and slicing LCB to `--start_date {cutoff+1d}`. Document threshold for "contamination signal" warning in §Q8.
- **D-Q5 A/B + replay polish.** Recommend POLISH-01 (A/B compare) IS in scope (the 4-profile MATRIX exists specifically to be A/B'd); POLISH-02 (replay) DEFERRED unless cheap; POLISH-03 (static dashboard) DEFERRED to Phase 7 (public artifact).

### Deferred Ideas (OUT OF SCOPE for Phase 5)

- **New harness features** (Phase 2 follow-up bucket).
- **Fine-tuning, retraining, LoRA** (PROJECT.md anti-feature).
- **Models beyond MATRIX.md** — no Qwen3-Coder-Next-80B, no third Gemma variant, no DeepSeek/Llama exploration.
- **Cross-model routing** evaluation (Phase 6+).
- **Public artifact polish** — README citation pinning + HF dataset publication land in Phase 7.
- **Speculative decoding paired benchmark** — Phase 6 (depends on Phase 5 harness existing).
- **Static-site dashboard** (POLISH-03) — Phase 7.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **EVAL-01** | Suite extends prior Phase 1 prompts + terminal-bench 2.0 primary + SWE-bench Verified milestone + LiveCodeBench rolling. | §Q1 (terminal-bench BaseAgent contract), §Q2 (SWE-bench predictions+harness shape), §Q3 (LiveCodeBench `--start_date` cutoff slice), §Q4 (prior repo `eval_tasks.py` + `eval_judge.py` re-run shape). |
| **EVAL-02** | Eval runner imports harness as library; calls `session.run(task)` via public SDK; never bypasses. | §Q10 — `@emmy/ux createEmmySession` + `runPrint` are the SDK entry points; existing Phase 2 SC-2 runner is a working reference shape. |
| **EVAL-03** | Every result embeds `{profile.id, profile.version, profile.hash, vllm_version, container_digest, cuda_version, model_sha, eval_driver_commit, hardware_id}`. | §Q6 — concrete schema + runtime sources for each field. |
| **EVAL-04** | ≥3 samples per task; mean ± std reported. | §Q7 — sampling distribution choice (independent samples vs k-of-n; bootstrap CI for low N). |
| **EVAL-05** | Contamination-resistant tracks: held-out + rephrased + LiveCodeBench. | §Q8 — held-out shape (5–10 hand-written tasks), rephrased pipeline, LCB cutoff math, contamination-signal threshold. |
| **EVAL-06** | Executable correctness PAIRED WITH LLM-as-judge from different model family. | §Q5 — judge family selection, self-hosted vs cloud, family-bias mitigation patterns. |
| **EVAL-07** | `[SP_OK]` canary gates every benchmark loop. | Phase 1 + Phase 2 already ship this (`packages/emmy-ux/src/sp-ok-canary.ts` + `emmy_serve/canary/sp_ok.py`); §Q10 wires it as the eval driver's pre-flight. |
| **EVAL-08** | Full eval suite required to declare any prompt/sampling change positive. | §Q1 (prior-repo lesson: 8.5→6.8 from "more prompting"), §Q7 (statistical promotion gate `mean(new) > mean(old) + std(old)`). |
| **EVAL-09** | `pi-emmy --print-environment` dumps full environment for pasteable bug reports. | §Q6 — defines what gets dumped + format. |
| **UX-06** | SDK / RPC mode (programmatic embedding) — eval harness uses pi SDK directly. | §Q10 — recommends `@emmy/eval` extends `createEmmySession` ; existing Phase 2 SC runners already prove this works. |
</phase_requirements>

---

## Phase Boundary

### In scope

1. A new package `packages/emmy-eval/` (or `@emmy/eval`) exposing a CLI `pi-emmy-eval` plus library API.
2. Four eval suites driven by that package: `terminal-bench-2.0`, `prior-phase1-continuity`, `swe-bench-lite` (recommended over Verified for Phase 5 — see §Q12), `livecodebench-rolling`.
3. A judge subsystem with model-family safeguards (§Q5).
4. Provenance schema + dump tool (`pi-emmy --print-environment`, EVAL-09).
5. Statistics module: ≥3 samples → mean ± std; promotion gate `mean(new) > mean(old) + std(old)` (EVAL-04 + EVAL-08).
6. Contamination-resistant track: 5–10 held-out hand-written tasks + rephrased variants + LCB rolling cutoff (§Q8).
7. SP_OK canary pre-flight on every batch (EVAL-07).
8. Markdown + JSON report generators.
9. POLISH-01 A/B compare (4-profile MATRIX makes this load-bearing).

### Out of scope (deferred or other phases)

- New harness/tool features → Phase 2 follow-up.
- Speculative decoding A/B → Phase 6 (uses Phase 5 harness once it exists).
- Static dashboard, README citations, HF dataset publishing → Phase 7.
- Outside-reproducer CI as a published artifact → Phase 7 (Phase 5 ships the *replication script* that an outside-reproducer CI would run).
- Fine-tuning, retraining, alt models beyond MATRIX → out of scope per PROJECT.md.

---

## Validation Architecture (Nyquist Dim 8)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun test (TypeScript packages) + pytest (any Python eval pieces; `swebench` is a Python package) |
| Config file | `bunfig.toml` exists; new `packages/emmy-eval/package.json` will declare scripts |
| Quick run command | `bun test packages/emmy-eval` |
| Full suite command | `bun test && (cd emmy_serve && uv run pytest tests/)` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| EVAL-02 | Eval runner uses SDK (no direct vLLM bypass) | unit | `bun test packages/emmy-eval/tests/uses-sdk.test.ts` | ❌ Wave 0 |
| EVAL-03 | Provenance dict embedded in every JSON row | unit | `bun test packages/emmy-eval/tests/provenance-shape.test.ts` | ❌ Wave 0 |
| EVAL-04 | ≥3 samples produces mean+std; rejects N<3 | unit | `bun test packages/emmy-eval/tests/stats.test.ts` | ❌ Wave 0 |
| EVAL-05 | Contamination-signal threshold flag fires | unit | `bun test packages/emmy-eval/tests/contamination-signal.test.ts` | ❌ Wave 0 |
| EVAL-06 | Judge ≠ generation family (rejects same-family) | unit | `bun test packages/emmy-eval/tests/judge-family-guard.test.ts` | ❌ Wave 0 |
| EVAL-07 | SP_OK pre-flight aborts batch on canary fail | unit + integration | `bun test packages/emmy-eval/tests/sp-ok-gate.test.ts` | ❌ Wave 0 |
| EVAL-08 | Subset run rejected for promotion claim | unit | `bun test packages/emmy-eval/tests/subset-promotion-block.test.ts` | ❌ Wave 0 |
| EVAL-09 | `pi-emmy --print-environment` dumps fields | smoke | `bun run pi-emmy --print-environment | jq .` | ❌ Wave 0 |
| UX-06 | SDK API stable (createEmmySession importable from @emmy/eval) | unit (typecheck) | `bun typecheck` | ✅ existing |
| EVAL-01 | terminal-bench-2.0 task adapter wires custom agent | integration | `bun test packages/emmy-eval/tests/tbench-adapter.test.ts` | ❌ Wave 0 |

### Sampling rate

- **Per task commit:** `bun test packages/emmy-eval --watch` (sub-second feedback)
- **Per wave merge:** `bun test && bun typecheck` across workspace
- **Phase gate:** Full suite green + 4-profile A/B run completes + SC-1..5 verdicts attached before `/gsd-verify-work`

### Wave 0 gaps

- [ ] `packages/emmy-eval/package.json` + `tsconfig.json` + Bun workspace registration
- [ ] `packages/emmy-eval/src/index.ts` library entry point
- [ ] `packages/emmy-eval/bin/pi-emmy-eval.ts` CLI entry point
- [ ] `packages/emmy-eval/tests/` test suite (10 RED-stub tests above)
- [ ] `eval/holdout/` directory + 5–10 hand-written tasks
- [ ] `eval/suites/` directory: tbench, prior-phase1, swe-lite, lcb manifests
- [ ] No new framework install — Bun + pytest already present.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Task selection / suite manifest | `@emmy/eval` library | Filesystem (`eval/suites/*.yaml`) | Suites are versionable, hashable text artifacts — same shape as profiles. |
| Driving a single task | `@emmy/eval` → `@emmy/ux` `createEmmySession` → `@emmy/provider` postChat → emmy-serve | — | EVAL-02 mandates SDK; we already have a working reference shape (`eval/phase2/sc2/run_sc2.ts`). |
| Hash-anchored edits / file ops during a task | `@emmy/tools` (loaded by `@emmy/ux` automatically) | — | The harness owns tool execution; eval inherits the real production tool registry. |
| SP_OK canary gate | `@emmy/eval` calls `@emmy/ux runSpOk` before each profile-batch | — | Already exists; eval reuses, doesn't re-implement. |
| Profile swap between profiles in MATRIX | `emmy-serve` Python `swap-profile` primitive (Phase 4) | `@emmy/ux` `/profile` adapter | Eval is a new caller of an existing primitive — no new swap logic. |
| Provenance capture | `@emmy/eval` calls `pi-emmy --print-environment` once per profile-batch | OS / docker inspect / `git rev-parse` | Captured at boot of each batch; embedded in every row; never re-derived per task. |
| Judge orchestration (LLM-as-judge) | `@emmy/eval/judge` | Either second emmy-serve container OR Anthropic API (out-of-loop) | See §Q5 — judge is **not** in the inference loop; runs after all rows captured. |
| Statistics (mean ± std, promotion gate) | `@emmy/eval/stats` | — | Pure function; testable without GPU. |
| Contamination signal (gap threshold) | `@emmy/eval/contamination` | LCB date filter + held-out task scores | §Q8 documents threshold derivation. |
| Report generation (markdown + JSON) | `@emmy/eval/report` | — | Deterministic; consumes the rows + stats. |
| Outside-reproducer CI | DEFERRED to Phase 7 | — | Phase 5 ships the **script** an outside reproducer would run; CI infra lands in Phase 7 (REPRO-02 / SC-2 of Phase 7). |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mariozechner/pi-coding-agent` | 0.68.0 (already pinned) | Underlying agent runtime | The harness Phase 5 imports as a library — already in workspace. [VERIFIED: workspace bun.lock + packages/emmy-ux/package.json] |
| `terminal-bench` (`tb` CLI / Python pkg) | latest 2.0-compatible from PyPI | Primary coding-agent benchmark; 89 manually-verified tasks | Stanford × Laude Institute; 2026-04 announcement promotes "Harbor" framework alongside legacy `tb` CLI; the legacy `BaseAgent.perform_task` Python class is the documented custom-agent integration surface. [CITED: https://www.tbench.ai/docs/agent-introduction (verified perform_task signature 2026-04-25); https://www.tbench.ai/news/announcement-2-0 (Nov 2025 announcement, 89-task count)] |
| `swebench` (PyPI) | latest from `pip install swebench` | SWE-bench Verified/Lite harness | Official harness; predictions JSON in → graded JSON out; Docker-per-task. [CITED: https://github.com/SWE-bench/SWE-bench README + https://www.swebench.com/SWE-bench/guides/evaluation/] |
| `mini-swe-agent` (optional) | latest | Reference "minimal SWE-bench agent" — useful as a **comparison** client, NOT as Emmy's own agent | Only useful as a sanity check that emmy-serve responds OK to a known-good SWE-bench-shaped client. Not a dependency of the eval driver itself. [CITED: https://mini-swe-agent.com/latest/models/local_models/] |
| `livecodebench` (PyPI / GitHub) | release_v6 dataset (1055 problems May2023–Apr2025) | Rolling contamination-resistant benchmark | Continuously updated from coding-contest sites; supports `--start_date`/`--end_date` filters and `--release_version release_v6`. [CITED: https://github.com/LiveCodeBench/LiveCodeBench README] |
| `scipy` (Python) OR a Bun-native stats helper | 1.x | Mean ± std + bootstrap CI for low-N samples | Standard. [VERIFIED: training knowledge; commodity statistical methods.] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | already pinned | MCP brokered tools during tasks | Inherits from harness; eval doesn't add. |
| `@emmy/{ux,provider,tools,context,telemetry}` | workspace:* | The SDK Phase 5 imports | UX-06 mandates the eval consumes these as a library. |
| `simple-git` or shelling out to `git` | — | Capture `eval_driver_commit` (EVAL-03) | Standard. |
| `nvidia-smi` subprocess | — | Capture GPU UUID + driver version for `hardware_id` (EVAL-03) | Already used by `@emmy/ux nvidia-smi.ts` (Phase 3). |
| `docker inspect` subprocess | — | Capture `container_image_digest` (EVAL-03 + already in profile.serving.engine.container_image_digest) | The digest is already pinned in each profile's `serving.yaml`. Read from disk; no docker daemon round-trip needed. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `@emmy/eval` package | `EvalScope` framework (open-source, supports terminal-bench 2.0) [CITED: https://evalscope.readthedocs.io/en/latest/third_party/terminal_bench.html] | EvalScope is heavier and would not satisfy EVAL-02 ("imports harness as library, never bypasses") because it owns its own model-driving loop. Build our own. |
| Tier-A self-hosted Llama judge | OpenAI / Anthropic API as judge (Phase 1 prior-repo pattern) | Cloud API breaks `ci_verify_phase3` STRICT air-gap. Self-hosted is heavier (UMA pressure during swap) but keeps the inference loop pure. **Recommendation:** ship both — self-hosted as default; Anthropic as opt-in `--judge=cloud-claude` under `ci_verify_research_egress` PERMISSIVE posture. See §Q5. |
| SWE-bench Verified (500) on Spark | SWE-bench Lite (300) on Spark + SWE-bench Verified on x86 box (Phase 7) | Verified on aarch64 has ~20% missing pre-built images + QEMU emulation penalty; multi-hour-per-profile cost on Spark. Lite gives reasonable signal at ~⅓ the cost. [VERIFIED: https://github.com/SWE-bench/SWE-bench/issues/375 + Epoch AI registry coverage stats] |
| Statistical bootstrap CI on N=3 | Plain mean ± std on N=3 | Bootstrap with N=3 is mathematically weak (resamples are highly correlated). With N=3 plain mean ± std + Welch's t for promotion is honest. Bootstrap only meaningful at N≥10. [VERIFIED: https://en.wikipedia.org/wiki/Bootstrapping_(statistics) + standard intro stats.] |

**Installation (in `packages/emmy-eval/`):**

```bash
# TypeScript side (already in workspace via Bun)
# No new TS deps — emmy-eval uses workspace:* re-exports of existing @emmy/*

# Python side (for swebench harness + livecodebench + tbench)
uv pip install --upgrade swebench livecodebench terminal-bench
# (Or pin via emmy-serve/pyproject.toml if we want full reproducibility.)
```

**Version verification:** Before pinning, run `pip index versions <pkg>` for each Python package and `bun pm ls` for the @emmy/* lock. terminal-bench evolves rapidly (2.0 dataset version is HF-tracked at `harborframework/terminal-bench-2.0`).

---

## Architecture Patterns

### System Architecture Diagram (data flow, not file listing)

```
[ pi-emmy-eval CLI ] ──── (parses --suite, --profile, --samples) ────▶
        │
        ▼
[ @emmy/eval orchestrator ]
        │
        ├──▶ pre-flight: SP_OK canary against active profile (Phase 1+2 reuse) ─── fail → ABORT BATCH (EVAL-07)
        │
        ├──▶ provenance capture: pi-emmy --print-environment → provenance.json (EVAL-03/09)
        │
        ├──▶ for each task in suite:
        │       │
        │       ├──▶ for sample 1..N:                                                  (EVAL-04, N≥3)
        │       │       │
        │       │       ├─▶ stage workdir / pull SWE-bench Docker / fetch tbench task
        │       │       │
        │       │       ├─▶ createEmmySession({profile, cwd, mode:'print'})            (EVAL-02 SDK only)
        │       │       │
        │       │       ├─▶ session.runPrint(task_prompt) → text + tool_calls + transcript
        │       │       │       │
        │       │       │       └─▶ @emmy/provider → emmy-serve (vLLM, profile-aware sampling)
        │       │       │
        │       │       └─▶ executable correctness scorer (run tests / diff patches / pass@1 verifier)
        │       │
        │       └─▶ N-sample row { task_id, profile_ref, samples: [{exec_score, transcript_hash, ...}, …] }
        │
        ├──▶ judge phase (POST-INFERENCE — not in the loop):                          (EVAL-06)
        │       │
        │       ├─▶ EITHER: `/profile <judge-llama70b>` swap → judge each row via emmy-serve
        │       └─▶ OR: shell out to Anthropic API (only when EMMY_JUDGE=cloud-claude
        │                + ci_verify_research_egress PERMISSIVE posture)
        │
        ├──▶ aggregation: mean ± std per task; suite-level pass rate; A/B compare
        │
        ├──▶ contamination check: LCB-rolling vs LCB-public gap; held-out vs prior-repo gap
        │       └─▶ if gap > threshold → emit "contamination signal" warning           (EVAL-05)
        │
        ├──▶ promotion gate: blocks subset runs from declaring change positive          (EVAL-08)
        │
        └──▶ writers: runs/phase5/<suite>/<profile>/<run-id>/{report.json, report.md, transcripts/*.jsonl}
```

### Recommended Project Structure

```
packages/emmy-eval/                  # NEW Phase 5 package
├── package.json                     # workspace:* deps on @emmy/*
├── tsconfig.json
├── bin/
│   └── pi-emmy-eval.ts              # CLI entry: pi-emmy-eval run/compare/report
├── src/
│   ├── index.ts                     # public API
│   ├── orchestrator.ts              # the for-each-task-N-samples loop
│   ├── provenance.ts                # EVAL-03 + EVAL-09 schema + dump
│   ├── suites/                      # one per benchmark
│   │   ├── tbench.ts                # adapter: @emmy/eval ⇄ terminal-bench BaseAgent
│   │   ├── prior-phase1.ts          # adapter: 8 tasks from setup_local_opencode/validation/eval_tasks.py
│   │   ├── swe-lite.ts              # adapter: SWE-bench Lite predictions JSON producer
│   │   └── livecodebench.ts         # adapter: --start_date filtered LCB run
│   ├── judge/
│   │   ├── family-guard.ts          # blocks judge==generator-family
│   │   ├── self-hosted-judge.ts     # /profile-swap path (default)
│   │   └── cloud-claude-judge.ts    # opt-in path (gated by EMMY_JUDGE=cloud-claude)
│   ├── stats/
│   │   ├── mean-std.ts              # ≥3 samples gate; mean ± std
│   │   └── promotion-gate.ts        # subset-run rejection + Welch's t test
│   ├── contamination/
│   │   ├── threshold.ts             # gap calculation + signal emit
│   │   └── holdout-loader.ts        # eval/holdout/*.json loader
│   ├── report/
│   │   ├── markdown.ts
│   │   └── json.ts
│   └── compare/
│       └── ab-compare.ts            # POLISH-01 (in scope)
└── tests/                           # 10+ RED stubs from § Validation Architecture

eval/                                # Existing dir
├── MATRIX.md                        # Phase 04.1 participant manifest (already exists)
├── suites/                          # NEW — versioned suite manifests
│   ├── tbench-2.0.yaml
│   ├── prior-phase1.yaml
│   ├── swe-lite.yaml
│   └── livecodebench-rolling.yaml
├── holdout/                         # NEW — 5-10 hand-written tasks (EVAL-05 contam-resistant)
│   ├── HOLDOUT_NOTES.md
│   ├── holdout_001.json
│   └── ...
├── phase2/                          # existing SC-2..5 fixtures (continuity reference)
├── phase3/
└── phase5/                          # NEW — output dir for Phase 5 runs (gitignored)
    └── runs/
        └── <iso>-<profile_hash8>-<suite>-<sample_n>/
            ├── provenance.json
            ├── report.json
            ├── report.md
            └── transcripts/
                ├── task_001_sample_01.jsonl
                └── ...
```

### Pattern 1: Eval-as-library (EVAL-02)

**What:** The eval driver must call `createEmmySession` from `@emmy/ux` and use `runPrint` to send each task. It does NOT post directly to vLLM. Phase 2 SC-2 runner is the existing reference (it imports `loadProfile`, `postChat`, `editHashline`, etc. directly).

**Why:** EVAL-02 verbatim says "drives `session.run(task)` through the public SDK; never bypasses." The point is: we measure the agent (harness + tools + grammar + retry + compaction), not just the model. Bypassing erases the harness's contribution.

**Example (paraphrased from `eval/phase2/sc2/run_sc2.ts:282-432`):**

```typescript
// Source: existing eval/phase2/sc2/run_sc2.ts pattern (already proven Phase 2)
import { loadProfile, createEmmySession, runSpOk } from "@emmy/ux";

const profile = await loadProfile(profileDir);
const spok = await runSpOk(baseUrl, profile.serving.engine.served_model_name);
if (!spok.ok) abort("SP_OK canary failed — refusing to record numbers");  // EVAL-07

const session = await createEmmySession({
  profile, baseUrl, cwd: workdir, mode: "print",
  userPrompt: task.prompt,
  sessionId: emmySessionId,           // for telemetry correlation
});
const { text, messages } = await session.runPrint!(task.prompt, { mode: "json" });
// `messages` is the full event stream; we extract tool_calls + final text + token counts.
```

### Pattern 2: terminal-bench BaseAgent shim (EVAL-01)

**What:** Terminal-bench expects `class MyAgent(BaseAgent): def perform_task(self, task_description, session: TmuxSession, logging_dir) -> AgentResult`. We write a Python shim that, instead of calling Claude/etc, shells out to `bun run pi-emmy --print` (or to a Bun-side `pi-emmy-eval` adapter that drives the SDK directly).

**Why:** terminal-bench owns the tmux sandbox + scoring; we own the agent. The boundary is `perform_task`. Our agent's "session" parameter is the tmux pane — we send commands by `session.send_keys(...)`. Our agent's "tools" are the bash commands it runs in the tmux pane (which is the same as a real-life user typing into a terminal — exactly what tbench tests).

**Sub-decision (D-Q6):** Do we drive pi-emmy as a subprocess from inside the tbench Docker container, or do we run pi-emmy on the host and have it reach into the tmux pane? **Recommendation: subprocess inside the Docker container** — it's how every other custom agent integrates and it's architecturally cleaner. tbench's `BaseInstalledAgent` is the right base class for this: declares an install step + an exec step.

**Example skeleton:**

```python
# Source: https://www.tbench.ai/docs/agent-introduction (verified 2026-04-25)
from terminal_bench.agents import BaseAgent, AgentResult
from terminal_bench.terminal.tmux_session import TmuxSession  # path inferred; verify on impl

class PiEmmyAgent(BaseAgent):
    @staticmethod
    def name() -> str:
        return "pi-emmy"

    def perform_task(
        self, task_description: str, session: TmuxSession, logging_dir
    ) -> AgentResult:
        # Phase 5 implementation:
        # 1. From inside the tbench Docker container, exec a one-shot
        #    `pi-emmy --print --json --profile <id>@<ver>`
        # 2. pi-emmy resolves emmy-serve via $EMMY_BASE_URL (loopback to host)
        # 3. capture stdout (JSON event stream) → translate tool calls into
        #    tmux session.send_keys(...) so tbench sees the actual terminal effects
        # 4. on agent_end, return AgentResult{...}
        ...
```

### Pattern 3: SWE-bench-Lite predictions JSON producer (EVAL-01)

**What:** SWE-bench's harness consumes a `predictions.json` containing `[{instance_id, model_name_or_path, model_patch}, …]`. Emmy's role is just to produce that file: for each instance, drive the harness via the SDK to generate a patch, then write the patch + identifier.

**Why:** Decouples generation (Spark, our code) from grading (SWE-bench's harness, Docker). The grading harness is x86_64-best-effort on aarch64 — we accept the QEMU penalty on the grading step but not on the inference step.

**Example shape (paraphrased from https://github.com/SWE-bench/SWE-bench README):**

```typescript
// Source: SWE-bench docs https://www.swebench.com/SWE-bench/guides/evaluation/
const predictions = [];
for (const instance of swebench_lite_instances) {
  const session = await createEmmySession({
    profile, baseUrl,
    cwd: stageRepoAt(instance.repo, instance.base_commit),
    mode: "print",
  });
  const { text } = await session.runPrint!(
    `Repository: ${instance.repo}\nIssue: ${instance.problem_statement}\n` +
    `Produce a patch (unified diff) that resolves this issue.`
  );
  const patch = extractUnifiedDiff(text);
  predictions.push({
    instance_id: instance.instance_id,
    model_name_or_path: `emmy-${profile.ref.id}@${profile.ref.version}`,
    model_patch: patch,
  });
}
writeFileSync("predictions.json", JSON.stringify(predictions));

// Then shell out to the official grader:
// python -m swebench.harness.run_evaluation \
//   --dataset_name princeton-nlp/SWE-bench_Lite \
//   --predictions_path predictions.json \
//   --max_workers 4 --run_id emmy-phase5
```

### Anti-Patterns to Avoid

- **Bypassing the harness to get cleaner tok/s numbers.** EVAL-02 explicitly forbids this. We'd be measuring the model, not the agent.
- **Self-judging.** EVAL-06 + family-bias literature both block this; even Qwen-judging-Qwen-different-variant is borderline (still same training family).
- **Bootstrap CI on N=3.** Mathematically weak. Use plain mean ± std + Welch's t until N≥10.
- **One-shot (N=1) eval.** Hides batch-invariance variance (Pitfall #10). EVAL-04 minimum is 3.
- **Subset-run promotion.** EVAL-08 hard-blocks this. Phase 5 must implement the gate, not just document it.
- **Per-task profile swap.** Each profile swap is ~3 min (Qwen container) to ~8 min (Gemma container). Eval should run all tasks for one profile, then swap, not swap per task.
- **Cloud judge in the inference loop.** Breaks `ci_verify_phase3` STRICT air-gap. Cloud judge is acceptable ONLY in a separate post-inference pass under `ci_verify_research_egress` PERMISSIVE.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coding-task scoring | Pattern-match diffs against gold | `swebench` package + tbench's per-task `tests/test.sh` | Real agents emit semantically-equivalent-but-textually-different patches; only execution-based scoring is honest. |
| Test-set contamination check | Manually compare prompt SHAs against pretraining lists | LiveCodeBench `--start_date` filter (their whole job) | LCB exists *for* this. Don't reimplement. |
| Rephrased-variant generation | Have an LLM rephrase | LCB itself includes rephrased tracks; for prior-Phase-1 prompts, hand-author 1 rephrase per task | Auto-rephrasing introduces a generator-rephraser dependency we can't audit. Hand-author 8 rephrases (one per Phase 1 task) once. |
| Stats / promotion gate | Greater-than comparison | `mean(new) > mean(old) + std(old)` (Welch's t at α=0.05 if N≥10) | Standard statistical floor for "real signal vs noise" with low N. |
| terminal-bench tmux orchestration | Spawn pty + send commands | tbench's `TmuxSession` + `BaseAgent` | tbench owns the sandbox + sandbox-leak prevention. |
| SWE-bench task isolation | Build per-task Dockerfiles | `swebench.harness.run_evaluation` | Pre-built images, optimized layer caching (Epoch AI shrunk Verified from 189 GiB to 30 GiB). |
| `pi-emmy --print-environment` schema | Invent a new format | `nvidia-smi --query-gpu=...` + `docker inspect <container>` + `git rev-parse HEAD` + profile.yaml read + `uname -a` — concatenated into a single JSON | All these tools already produce machine-readable output. Just glue them. |
| Reproducer script | Build a verification framework | A single `bash` script that pulls digest-pinned container, downloads MATRIX-listed model SHAs, runs `pi-emmy-eval run --suite all`, hashes report.json | Phase 7 turns this into the public artifact; Phase 5 ships the script. |

**Key insight:** The eval phase is mostly **plumbing** between four existing benchmarks (each of which has invested far more in scoring infrastructure than we could) and the SDK we already have. The original work is in **provenance** (§Q6), **judge family-bias safeguards** (§Q5), the **promotion gate** (EVAL-08), the **contamination signal** (§Q8), and the **A/B compare** that consumes the 4-profile MATRIX.

---

## Per-Question Findings

### §Q1 — terminal-bench 2.0 integration

**Repository / package:** `pip install terminal-bench` ; CLI is `tb`. New users are pointed to "Harbor framework" (announcement 2025-11-07) but the legacy `tb` + `BaseAgent` Python class is still the documented agent integration surface. [CITED: https://www.tbench.ai/news/announcement-2-0 retrieved 2026-04-25; https://www.tbench.ai/docs/agent-introduction retrieved 2026-04-25]

**Task count:** **89 manually-verified tasks** in 2.0 (down from larger 1.x set; 229 crowd-sourced from 93 contributors → 89 selected after triple-review). [CITED: https://www.tbench.ai/news/announcement-2-0]

**Custom-agent contract — the one-method `BaseAgent` interface:**

```python
# VERIFIED via https://www.tbench.ai/docs/agent-introduction 2026-04-25
class MyAgent(BaseAgent):
    @staticmethod
    def name() -> str: ...

    def perform_task(
        self,
        task_description: str,
        session: TmuxSession,
        logging_dir: Path | None = None,
    ) -> AgentResult: ...
```

`AgentResult` carries token counts and an optional failure mode. `TmuxSession` is the harness-provided tmux pane abstraction (path on disk: `terminal_bench/terminal/tmux_session.py` per repo layout). For agents installable via CLI, prefer `AbstractInstalledAgent` (defines install script + run command + env). [CITED: https://github.com/laude-institute/terminal-bench (custom-agent docs)]

**Run command:**

```bash
tb run --agent-import-path my_module:PiEmmyAgent --dataset terminal-bench --dataset-version 2.0
# (some sources show --dataset-name; confirm against installed CLI's --help)
```

**Sandbox / hardware:** Each task runs in a Docker container with a tmux pane the agent drives. Tasks include "an instruction in English, a test script to verify if the LM/agent completed the task successfully, and a reference oracle solution." [CITED: https://github.com/laude-institute/terminal-bench README] Docker on aarch64 — most tasks are pure-shell so should not need x86 emulation, but task-specific Docker images may be x86-only. **Hardware estimate (DGX Spark):** 89 tasks × ~3 min/task average × N=3 samples × 4 profiles ≈ **~17 GPU-hours** for full coverage; if profile swaps interleave (~5 min each × 12 swaps) add another hour. Doable in a long overnight.

**Pitfalls flagged:**
- terminal-bench is the published `tb` CLI; "Harbor" is the new framework but the legacy CLI is the still-recommended path for custom-agent docs as of 2026-04. Pin to a commit / PyPI version inside the suite manifest (`eval/suites/tbench-2.0.yaml`).
- Tasks check terminal effects, NOT JSON tool calls. Our agent's tool calls (read/write/edit/bash) must materialize as actual filesystem + bash effects in the tmux pane. The shim must translate.

**Confidence:** HIGH on the contract; MEDIUM on aarch64 Docker image coverage (each task's Dockerfile is independent — some may pull x86-only base images and fail on Spark; we may need to skip + document those as Spark-incompatible).

### §Q2 — SWE-bench Verified harness pattern

**Predictions JSON shape (input to harness):**

```json
[
  {
    "instance_id": "django__django-11099",
    "model_name_or_path": "emmy-qwen3.6-35b-a3b@v3.1",
    "model_patch": "diff --git a/...\n--- a/...\n+++ b/...\n@@ ...\n"
  }
]
```

[CITED: https://github.com/SWE-bench/SWE-bench README — predictions schema]

**Harness command:**

```bash
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path predictions.json \
  --max_workers $(python -c "import os; print(min(int(0.75*os.cpu_count()), 24))") \
  --run_id emmy-phase5-<iso>
```

[CITED: https://github.com/SWE-bench/SWE-bench README + https://www.swebench.com/SWE-bench/guides/docker_setup/]

**Resource requirements:** 120 GB free disk minimum (default `cache_level=env`); 16 GB RAM minimum; 8+ CPU cores recommended. Spark has 4 TB NVMe + 128 GB UMA + 20 cores → fits comfortably on disk/RAM, somewhat tight on cores vs the 32-core x86 Epoch AI baseline (62 min run time). [CITED: https://www.swebench.com/SWE-bench/guides/docker_setup/ + https://epoch.ai/blog/swebench-docker]

**Wall-clock estimate on Spark:**
- Epoch AI achieved 62-73 min on x86 32-core 128 GB. Spark at 20 cores will be ~50-60% slower at the harness step (Docker grading is CPU-bound, not GPU).
- Inference-side: Verified is 500 tasks; Lite is 300. At ~1-3 minutes per task at Qwen 35B-A3B (~50 tok/s), Lite is ~5-15 inference-hours per profile. 4 profiles × 3 samples × 5-15h = **60-180 inference hours** for Verified. Lite at 300/500 ratio: **36-108 hours**.
- **Recommendation:** Run **SWE-bench Lite** (300 tasks) on Spark in Phase 5; defer Verified (500) to Phase 7's public-artifact certification on a CI box or x86 reproducer.

**aarch64 Docker images:** x86_64 has 500/500 Verified images; arm64 has ~1819/2294 best-effort. On Apple Silicon docs say to add `--namespace ''` to force local build. Not all SWE-bench Lite instances are guaranteed to build on Spark. [CITED: https://github.com/SWE-bench/SWE-bench/issues/375 + https://github.com/epoch-research/SWE-bench (Epoch AI registry)]. Expect some skip-list curation in Phase 5; this is a known limitation and should be documented in the suite manifest.

**Wall-clock budget summary (recommended Phase-5 Lite path):** ~40 hours per profile-batch, ~160 hours over all 4 profiles for SWE-bench-Lite + N=3. **Too long for a single overnight.** Mitigations: (a) checkpoint between profiles so partial runs don't waste; (b) thermal-aware pause every 90 min; (c) start with N=1 for a smoke run, then promote to N=3 after the wiring is proven.

**Confidence:** HIGH on the harness contract; MEDIUM on Spark-specific wall-clock; MEDIUM on aarch64 image coverage rate.

### §Q3 — LiveCodeBench rolling track

**Versions / problem counts:** `release_v6` is current as of 2026-04 — **1055 problems May 2023 → April 2025**. Earlier: v5 / v4 / v1-v3 / etc. — fine-grained slices available. [CITED: https://github.com/LiveCodeBench/LiveCodeBench README]

**Date filter (the contamination-resistant lever):**

```bash
python -m lcb_runner.runner.main \
  --model <model> \
  --scenario codegeneration \
  --release_version release_v6 \
  --start_date 2026-01-01 --end_date 2026-04-25 \
  --local_model_path /data/models/Qwen3.6-35B-A3B-FP8 \
  --tensor_parallel_size 1
```

[CITED: https://github.com/LiveCodeBench/LiveCodeBench README — `--start_date YYYY-MM-DD`]

**Cutoff math (D-Q4 recommendation):**
- Qwen3.6 release: 2026-04-16 → effective cutoff date `2026-04-16`. Slice LCB to `--start_date 2026-04-17`.
- Gemma 4 release: 2026-04-02 → effective cutoff date `2026-04-02`. Slice LCB to `--start_date 2026-04-03`.
- Both models' pretraining is bounded by their release date; problems posted after that date cannot be in pretraining.
- A rolling refresh post-Phase-5 just bumps `--start_date` to the most recent LCB ingest date.

**Inference style:** One-shot completion, NOT agentic. Default `n=10, temperature=0.2`. We can match: at our N=3 we run greedy + 2 stochastic; LCB's `pass@1` is the metric. [CITED: https://github.com/LiveCodeBench/LiveCodeBench README]

**vLLM integration:** `--local_model_path` flag drives vLLM directly. **But this bypasses our harness** — and EVAL-02 says we can't bypass. **Resolution:** We re-run LCB problems through `@emmy/eval` with a thin "code generation only" task adapter that calls `runPrint` and extracts the code block. Score with LCB's own `compute_scores` on the resulting submissions. This costs us LCB's pass@5/n=10 statistics but keeps EVAL-02 honest.

**Hardware:** `compute_scores` is CPU-only Python; trivial. Inference cost depends on whether we run the LCB-default n=10 or our N=3 — at 1055 × N tasks × 4 profiles, even N=3 is **~12,660 tasks** of inference work. At ~50 tok/s on Qwen 35B with ~500 tokens/response = ~35h per profile. **Recommendation:** run only the post-cutoff slice (estimated ~50-200 problems depending on cutoff), not all 1055.

**Confidence:** HIGH on filter mechanics; MEDIUM on the right N (LCB-default vs our N=3 trade-off).

### §Q4 — Prior-repo Phase 1 prompts continuity

**Source files (verified on disk 2026-04-25):**
- `/data/projects/setup_local_opencode/validation/eval_tasks.py` — 8 EvalTask dataclass instances: 5 coding (CSV CLI, Fibonacci, pytest email, debug binary search, LRU cache), 3 literature (CRISPR, mRNA, Doudna paper).
- `/data/projects/setup_local_opencode/validation/eval_judge.py` — Anthropic API judge (Claude Sonnet 4.5) scoring 5 dimensions × 1-5 each → total/25 → normalized 2.0-10.0.
- `/data/projects/setup_local_opencode/validation/PHASE1_RESULTS_QWEN3.json` — Qwen3-Next-80B-A3B-Instruct-FP8 baseline numbers; 8.5/10 average.
- `/data/projects/setup_local_opencode/validation/PHASE1_RESULTS_MINIMAX.json`, `PHASE1_RESULTS_GPTOSS.json` — comparison baselines.

**Continuity baseline goal:** Re-run the same 8 prompts on Emmy's 4 profiles. Detect regressions vs Qwen3-Next-80B's published 8.5/10 (per PROJECT.md and CLAUDE.md Pitfall #1 — the prior repo's hard-won baseline).

**Adaptation needed:**
- The 3 literature tasks require MCP servers (`mcp__pubmed__*, mcp__biorxiv__*`). Phase 5 does NOT add new tools (out of scope). Either: (a) skip the 3 literature tasks for the continuity baseline, OR (b) run them only when the relevant MCP servers are configured, AND (c) document the partial-coverage decision in the suite manifest.
- The 5 coding tasks need NO external tools — pi-emmy's read/write/edit/bash already cover them.

**Recommended scope for Phase 5 continuity baseline:**
- 5 coding tasks (CODE_01..CODE_05) — fully runnable via pi-emmy
- 3 literature tasks deferred to Phase 7 or until pubmed/biorxiv MCP servers are configured

**Judge mode:** The prior repo's `eval_judge.py` is the architectural pattern: rubric-driven 5-dimension scoring via a *different family* judge (Claude Sonnet). Phase 5 can re-use this exact prompt structure and rubric format, just swap the judge endpoint.

**Confidence:** HIGH (files verified on disk; prior repo's 8.5/10 baseline numbers are recorded in PHASE1_RESULTS_QWEN3.json).

### §Q5 — LLM-as-judge model-family safeguard

**Constraint:** EVAL-06 + literature on family bias both demand judge ≠ generation family. CLAUDE.md says "no cloud INFERENCE in the loop." The intersection is hard.

**Family bias evidence:** Self-preference bias inflates judge scores 5-7% when same-family. Even cross-variant within-family judging is risky. [CITED: https://llm-judge-bias.github.io/ + https://arxiv.org/html/2510.24367 (LLM-as-Judge for Software Engineering)]

**Three candidate paths:**

| Path | Cost | Air-gap | Family-clean | Reproducible |
|------|------|---------|--------------|--------------|
| **A. Anthropic Claude Sonnet API** | ~$0.003/task × ~600 tasks × N=3 ≈ $5/profile, $20 total | ❌ violates STRICT (OK under PERMISSIVE `ci_verify_research_egress`) | ✅ different family from Qwen and Gemma | ✅ if API version pinned (`claude-sonnet-4-5-20250929` is the prior-repo pin) |
| **B. Self-hosted Llama-3.3-70B-Instruct-FP8 in second container** | UMA pressure (~70B FP8 ≈ ~75 GB; competes with the Qwen/Gemma weights — must SWAP, not co-locate) | ✅ STRICT-compatible | ✅ Llama is its own family — distinct from Qwen and Gemma | ✅ HF model SHA-pinned |
| **C. Self-hosted GPT-OSS-120B-A4B (Hyperscaler family)** | ~50-60 GB FP8; same swap profile shape | ✅ STRICT | ✅ different family | ✅ |

**Recommendation: hybrid.**
- **Default (in-loop, post-inference):** Path B — Llama-3.3-70B-Instruct-FP8 swapped in via `/profile <judge-llama-70b>` after all generation rows captured. Adds one new "judge profile" to MATRIX (treated as eval-only, never daily-driver). Wall-clock cost: ~3 min profile swap + ~20s/judgment × 600 judgments ≈ 4-5h. STRICT air-gap clean.
- **Optional (out-of-loop, opt-in):** Path A — `--judge=cloud-claude` flag invokes Claude Sonnet *after* the JSONL transcript is written, *outside* the inference loop, *under PERMISSIVE air-gap CI* (`ci_verify_research_egress`). Continuity baseline with prior-repo numbers for free. **Default OFF.**
- **Reject:** Path C alone — GPT-OSS-120B is heavier than Llama 70B FP8 and we'd need a third container. Llama is the simpler self-host story. Re-evaluate in Phase 6 if EAGLE-3 changes the math.

**Family-guard test (RED stub):** A unit test that asserts `judge_profile.ref.id` does NOT contain any substring of any generation profile's `ref.id` family root (`qwen`, `gemma`). For Path A, asserts the API model card ID is not in `{qwen-*, gemma-*}` (true for Claude). For Path B, asserts `llama` family. Fails CI if a future operator accidentally configures Qwen-judges-Qwen.

**Confidence:** HIGH on the bias literature (multiple peer-reviewed sources); MEDIUM on Path B wall-clock (Llama 70B on Spark needs its own KV bisection — defer to a small Phase-5 sub-task or accept ~slow judgment as cost-of-honesty).

### §Q6 — Provenance schema for EVAL-03 + EVAL-09

**Recommended JSON schema (one provenance.json per profile-batch + flattened into every result row):**

```json
{
  "schema_version": "emmy.eval.provenance.v1",
  "captured_at": "2026-05-XXTHH:MM:SSZ",
  "eval_driver_commit": "<git rev-parse HEAD of emmy repo>",
  "profile": {
    "id": "qwen3.6-35b-a3b",
    "version": "v3.1",
    "hash": "sha256:f9dcabd1...",
    "variant": "default",            // when routes.yaml is in play
    "role": null                      // set per-turn at telemetry layer, not provenance
  },
  "engine": {
    "vllm_version": "0.19.1.dev6",
    "container_image": "nvcr.io/nvidia/vllm:26.03.post1-py3",
    "container_image_digest": "sha256:abc123...",   // from profile.serving.engine.container_image_digest
    "cuda_version": "13.1",                          // nvidia-smi
    "driver_version": "555.42.04",                   // nvidia-smi
    "fastsafetensors": true,                         // from profile.serving.engine.env
    "gpu_memory_utilization": 0.55                   // profile.serving.engine.gpu_memory_utilization
  },
  "model": {
    "served_model_name": "Qwen/Qwen3.6-35B-A3B-FP8",
    "model_sha": "sha256:def456...",                 // huggingface_hub.HfApi.repo_info(...).sha or local manifest
    "quantization": "fp8",
    "max_model_len": 86016
  },
  "hardware": {
    "hardware_id": "<sha256(gpu_uuid + cpu_serial + system_uuid)>",   // or operator-set $EMMY_HARDWARE_ID
    "gpu": "GB10 (Blackwell, SM12.1)",                                // nvidia-smi -q
    "gpu_uuid": "GPU-...",                                            // nvidia-smi -L
    "system_memory_gb": 128,
    "platform": "aarch64-linux"                                       // uname -m / uname -s
  },
  "harness": {
    "pi_coding_agent_version": "0.68.0",            // package.json
    "emmy_packages": {
      "@emmy/provider": "0.1.0",
      "@emmy/tools": "0.1.0",
      "@emmy/ux": "0.1.0",
      "@emmy/context": "0.1.0",
      "@emmy/telemetry": "0.1.0",
      "@emmy/eval": "0.1.0"
    }
  },
  "eval": {
    "suite": "terminal-bench-2.0",
    "suite_manifest_hash": "sha256:...",            // hash of eval/suites/tbench-2.0.yaml
    "samples_per_task": 3,
    "judge": {
      "model": "llama-3.3-70b-instruct-fp8",
      "family": "llama",
      "host": "self-hosted",
      "swap_at": "post-inference"
    }
  }
}
```

**Where each field comes from at runtime:**
- `eval_driver_commit` ← `git rev-parse HEAD` in emmy repo
- `profile.{id,version,hash}` ← `loadProfile().ref` (Phase 1 hasher already computes; never recomputed at runtime)
- `engine.container_image_digest` ← profile YAML field (already pinned in Phase 1+4)
- `engine.{cuda_version,driver_version}` ← `nvidia-smi --query-gpu=driver_version --format=csv,noheader` (single subprocess call); `nvcc --version` for CUDA toolkit if needed
- `engine.vllm_version` ← `docker exec <container> python -c "import vllm; print(vllm.__version__)"` cached at boot
- `model.model_sha` ← prefer reading `<model_dir>/.huggingface/snapshots/.../commit_sha` from local cache; fallback `huggingface_hub` API call (gated by `EMMY_AIR_GAP=strict` flag — fall back to "[unverified — offline]" sentinel under STRICT)
- `hardware.{gpu_uuid,gpu}` ← `nvidia-smi -L` + `nvidia-smi -q | head`
- `hardware.hardware_id` ← `sha256(gpu_uuid + uname -a + first 64 bytes of /etc/machine-id)`; operator can override via `$EMMY_HARDWARE_ID`
- `harness.pi_coding_agent_version` ← `packages/emmy-ux/package.json["dependencies"]["@mariozechner/pi-coding-agent"]`

**`pi-emmy --print-environment` (EVAL-09):** Emit the schema above to stdout (JSON). Phase 5 implements this in `packages/emmy-ux/src/print-environment.ts` (sibling to `profile-loader.ts`). Eval driver invokes it once per batch via `Bun.spawn(['pi-emmy', '--print-environment'])` and writes to `<run-dir>/provenance.json`.

**Provenance discipline (per-row):** Every result row in `report.json` carries `{profile.{id,version,hash}, eval.suite, eval_driver_commit, hardware.hardware_id}` inline (the four most identification-relevant fields). The full provenance dict is in `provenance.json` keyed by run-id; rows reference the run-id.

**Confidence:** HIGH (every field has a concrete capture path; existing Phase 1 + Phase 3 telemetry already capture profile.{id,version,hash}).

### §Q7 — Statistical reporting (EVAL-04)

**Floor:** N≥3 samples per task. Mean ± std reported. Any task with N<3 produces no number; only "insufficient-samples" sentinel.

**Sample independence:** Each sample is a fresh agent session — fresh tmp workdir (terminal-bench, SWE-Lite) or fresh prompt instantiation (LCB, prior-Phase-1). Same seed across samples is NOT desirable; we want sampling variance from temperature + batch-size jitter to surface.

**Aggregate metrics per suite:**
- terminal-bench: per-task pass rate (binary 0/1 from test.sh) → suite mean = mean across 89 tasks of mean-across-3-samples
- SWE-bench Lite: per-instance resolved (binary 0/1 from harness) → instance-level mean across 3 samples → suite mean
- LiveCodeBench: pass@1 per problem → mean across slice
- prior-Phase-1: judge-normalized 2.0-10.0 score per task (continuity with prior repo's headline metric) → mean ± std

**Promotion gate (EVAL-08):**
```
new_passes_promotion = (
  N_new >= 3 AND
  N_old >= 3 AND
  suite_run.complete = TRUE AND     # subset runs blocked
  mean(new_per_task) > mean(old_per_task) + std(old_per_task)   # crude but honest at N=3
)
```
At N≥10, replace the last line with a Welch's two-sample t-test at α=0.05.

**Bootstrap CI:** Defer until N≥10. With N=3, bootstrap is unreliable — too few independent points.

**Variance budget on DGX Spark:** Pitfall #10 documents 0.5-1.5 quality points typical run-to-run. The promotion gate `mean+std` correctly handles this — no "8.5 vs 8.4 differential" ever passes.

**Confidence:** HIGH (standard methodology); MEDIUM on the choice between mean+std vs Welch's t (favor mean+std at N=3 for honesty).

### §Q8 — Contamination signal threshold

**Two contamination proxies in Phase 5:**

1. **LCB-rolling vs LCB-public-historical gap.** Run LCB on (a) the post-cutoff slice and (b) the full release_v6 (or a representative pre-cutoff slice). Contamination signal fires if `gap = pre_cutoff_pass@1 - post_cutoff_pass@1 > θ`.
2. **Held-out vs prior-repo-Phase1 gap.** Score on the 5-10 hand-written held-out tasks vs the prior-repo Phase 1 prompts (which may be in pretraining). If `prior_phase1_score - holdout_score > θ_judge`, that's signal that public-style prompts get a contamination boost.

**Threshold derivation (recommendation):**
- For pass@1 metrics (binary): **θ = 0.10** (10 percentage points). Justification: typical run-to-run variance on coding pass@1 is 2-5%; a 10-point gap on the same model between contaminated-vs-non-contaminated slices is well outside noise.
- For judge-normalized 2.0-10.0 metric: **θ_judge = 1.0** (one full point). Justification: Pitfall #10 documents 0.5-1.5 quality points typical seed-variance; >1.0 indicates a systematic effect.

**These are starting-point thresholds; tighten in Phase 7 with real data.** Phase 5 ships them as the configured values in `eval/suites/livecodebench-rolling.yaml` with provenance citation back to this section.

**Signal emission shape:**
```json
{
  "contamination_signal": {
    "fired": true,
    "tracks": ["livecodebench-rolling"],
    "metric": "pass_at_1",
    "pre_cutoff": 0.42,
    "post_cutoff": 0.28,
    "gap": 0.14,
    "threshold": 0.10,
    "tasks_flagged": ["lcb_2024_03_15", "lcb_2024_05_02", ...]
  }
}
```

**Confidence:** MEDIUM (thresholds are defensible but not measured-on-Emmy yet; Phase 7 will tune).

### §Q9 — Outside-reproducer CI (Phase-5 vs Phase-7 split)

**Phase 5 deliverable:** A `bash` script `scripts/reproduce_eval.sh` that takes:
- Container digest (from `MATRIX.md` / profile YAML)
- Model SHA (from profile YAML / HF cache or fetched fresh)
- emmy git SHA
- And produces a fresh `runs/phase5/repro/<iso>/` directory with the same suite outputs.

**What Phase 5 does NOT ship:** A GitHub Actions runner config, second-DGX-Spark CI, or any external infrastructure.

**Phase 7 deliverable (REPRO-02 / SC-2):** Wrap the Phase 5 script in an outside-reproducer CI — either as a self-hosted Spark runner or as a documented "run this on your own Spark and confirm" recipe.

**Why split this way:** Phase 5's success criterion is "repro-able on a clean DGX Spark given the artifact." That's a script. The CI infra to actually run that script on a *second* box is Phase 7's "research-grade publication" job. Conflating them blows up Phase 5 scope.

**Phase 5 success criterion 2 verbatim:** "...verified by re-running on a second box (or via an 'outside-reproducer' CI job that pulls the artifact)." The "or" is the escape — Phase 5 ships the artifact; second-box verification is a one-time human walkthrough that happens at Phase 5 close, not a recurring CI job.

**Confidence:** HIGH on the split rationale; LOW on what a "real" outside-reproducer CI would look like at scale (no reference impl found for aarch64-Spark-class).

### §Q10 — Eval driver as a library

**Recommendation: `packages/emmy-eval/` as a workspace package.** Sibling to emmy-{provider,tools,ux,context,telemetry}. Bun-native TypeScript. Consumes `@emmy/ux` for `createEmmySession + loadProfile + runSpOk`, `@emmy/provider` for `postChat` (only when needed for raw-mode probes — not for task driving), `@emmy/tools` for hash-anchored edits if any post-hoc patch validation is needed.

**CLI shape:**
```bash
pi-emmy-eval run \
  --profile profiles/qwen3.6-35b-a3b/v3.1 \
  --suite terminal-bench-2.0 \
  --samples 3 \
  --out runs/phase5/qwen35-a3b-v3.1-tbench-<iso>/

pi-emmy-eval compare \
  --suite terminal-bench-2.0 \
  --baseline runs/phase5/qwen35-a3b-v3.1-tbench-<iso-1>/ \
  --candidate runs/phase5/qwen27b-v1.1-tbench-<iso-2>/

pi-emmy-eval report \
  --run runs/phase5/.../report.json \
  --format markdown
```

**Library API:**
```typescript
import { runSuite, compare, generateReport, type SuiteResult } from "@emmy/eval";
const result = await runSuite({
  profilePath: "profiles/qwen3.6-35b-a3b/v3.1",
  suiteName: "terminal-bench-2.0",
  samples: 3,
  outDir: "runs/phase5/...",
});
```

**Why a new package not `eval/`:** The existing `eval/` directory holds Phase 2/3 SC fixtures and the new MATRIX.md — it's data. The eval *driver* is code with its own deps and tests; it belongs in `packages/`. The Phase 2 SC-2/3/4/5 runners are scripts under `eval/phase2/<sc>/run_sc<N>.ts` — they directly import `@emmy/*` and are essentially mini-test-runners. Phase 5 generalizes that pattern into a reusable package.

**EVAL-02 enforcement (the "uses-sdk" test):** Static-analysis test grep `packages/emmy-eval/src/**/*.ts` for any direct `fetch(...)` or `postChat(...)` to a vLLM endpoint that bypasses `createEmmySession`. Allowlist: `@emmy/ux runSpOk` (which legitimately uses `postChat` directly because it's a bare-canary check). Anything else fails CI.

**Confidence:** HIGH (mirrors the existing Phase 2/3 pattern that already works).

### §Q11 — A/B compare + replay (POLISH scope)

- **POLISH-01 A/B compare — IN SCOPE.** The 4-profile MATRIX exists for this. `pi-emmy-eval compare --baseline X --candidate Y` produces a markdown side-by-side table with per-task delta + per-suite delta + statistical significance flag.
- **POLISH-02 Session replay — DEFERRED.** "Replay session under different profile" is a power-user feature; not load-bearing for the research artifact bar. Re-evaluate in Phase 7.
- **POLISH-03 Static dashboard — DEFERRED to Phase 7** (REPRO-02 territory).

**Confidence:** HIGH (POLISH-01 is what makes Phase 04.1 worth it).

### §Q12 — GPU wall-clock budget (the operator's actual question)

| Suite | Tasks | Tokens/task est. | tok/s @ Qwen MoE | tok/s @ Qwen dense 27B | Est. wall-clock per profile-batch (N=3) |
|-------|-------|------------------|------------------|------------------------|-------------------------------------------|
| terminal-bench-2.0 | 89 | ~2-5K (multi-turn) | ~50 | ~7.6 | MoE: ~89×3 tasks × ~2 min = ~9h; Dense: ~89×3 × ~10 min = ~45h |
| prior-Phase-1 (5 coding) | 5 | ~5K | ~50 | ~7.6 | MoE: 5×3 × ~2 min = ~30 min; Dense: 5×3 × ~10 min = ~2.5h |
| SWE-bench Lite | 300 | ~3-8K | ~50 | ~7.6 | MoE: 300×3 × ~3 min ≈ ~45h; Dense: ~225h. **TOO LONG ON DENSE.** |
| LiveCodeBench (post-cutoff slice ~50-200) | ~100 | ~1K (one-shot) | ~50 | ~7.6 | MoE: 100×3 × ~30s = ~2.5h; Dense: ~16h |

**Total per profile (excluding judge):**
- Qwen MoE: ~57h ≈ 2.5 days continuous
- Qwen dense: ~285h ≈ 12 days continuous **— infeasible**
- Gemma MoE: similar to Qwen MoE (~50 tok/s) → ~57h
- Gemma dense (~6.4 tok/s): worse than Qwen dense → ~340h **— infeasible**

**Conclusion:** Running the full 4-profile × full-suite × N=3 matrix is **infeasible on Spark within Phase 5's overnight budget.**

**Recommendations to land in CONTEXT.md:**
1. **Tier the suites:**
   - **Tier A (full coverage on all 4 profiles, N=3):** prior-Phase-1 (5 coding) + LiveCodeBench post-cutoff slice. Total: ~30h all profiles. **Doable in 1.5-2 days continuous.**
   - **Tier B (full coverage on 2 MoE profiles only, N=3):** terminal-bench-2.0 + SWE-bench Lite. Dense profiles get N=1 smoke run + a sample of 30 tbench tasks for shape-checking only. Total: ~110h ≈ 4.5 days.
   - **Tier C (Phase 7 deferred):** SWE-bench Verified (300 → 500), n=10 LCB, full N=3 dense coverage — those land in Phase 7 cloud / x86 reproducer.
2. **Checkpoint between profile-batches** so a thermal pause / overnight power blip doesn't waste 30h.
3. **Allow `--samples 1` smoke mode** for wiring shake-down. Promotion gate refuses to declare anything positive on N=1; just verifies the pipeline.

**Confidence:** HIGH on tok/s per profile (Phase 04.1 measured); HIGH on per-task token estimates being approximate; MEDIUM on the per-task wall-clock (some tbench tasks may be much longer multi-turn).

### §Q13 — Pitfall #5 air-gap reconciliation

**Sources of egress in Phase 5:**

| Source | When | Air-gap impact | Mitigation |
|--------|------|----------------|------------|
| LiveCodeBench dataset refresh | Once per Phase 5 run | Egress (HuggingFace download) | Pin LCB dataset version; cache locally; air-gap CI (STRICT) loads from cache |
| SWE-bench task data + Docker images | Once per Phase 5 run | Egress (HuggingFace + DockerHub) | Pre-pull all required images + dataset before STRICT runs |
| Anthropic API as judge | Per task × 3 samples | Egress (api.anthropic.com) | **Out-of-loop ONLY**, gated by `--judge=cloud-claude` flag, runs under `ci_verify_research_egress` PERMISSIVE — never under STRICT |
| terminal-bench task data | Per run | Egress (HuggingFace) | Pin dataset version; cache locally |
| Model SHA verification (HF API) | Provenance capture | Egress (huggingface.co) | Cache `model_sha` in `MATRIX.md` (already done — hash f9dcabd1 etc.); fallback "[offline]" sentinel under STRICT |

**The Phase-3.1 air-gap CI split is the architectural answer:**
- **`ci_verify_phase3` STRICT:** No outbound. INFERENCE ONLY. Runs `pi-emmy --print` against a pre-cached dataset slice with self-hosted judge. This is the gate that says "Emmy is air-gappable for inference."
- **`ci_verify_research_egress` PERMISSIVE:** Allows SearxNG + cloud-judge endpoints (Anthropic, OpenAI). Runs the eval suite end-to-end including optional cloud judge. This is the gate that says "Emmy's research artifact is reproducible."
- **Phase 5 runs default to STRICT.** Cloud judge is opt-in via `--judge=cloud-claude` and operator must explicitly switch the CI gate.

**Specific posture recommendation:**
1. Eval driver **always** runs inference under STRICT (no cloud during generation).
2. Eval driver **defaults to self-hosted judge** (Llama-3.3-70B-Instruct-FP8 via second profile swap).
3. Eval driver **optionally** pipes the JSONL transcripts to Anthropic API in a separate post-inference judge pass when operator opts in. This pass runs under PERMISSIVE.
4. Dataset/image fetching happens **before** the STRICT gate flips (pre-cached). The reproducer script documents both phases.

**Confidence:** HIGH (the Phase-3.1 split was designed exactly for this; we just inherit and apply consistently).

---

## Runtime State Inventory

> Phase 5 introduces new artifacts. The relevant categories:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — eval outputs are append-only `runs/phase5/` files; no DB | Write to gitignored `runs/` |
| Live service config | None — eval doesn't touch SearxNG, Langfuse, or systemd services | None |
| OS-registered state | None — no Task Scheduler, systemd, pm2 entries | None |
| Secrets/env vars | NEW: `ANTHROPIC_API_KEY` for opt-in cloud judge; existing `EMMY_VLLM_API_KEY` (dummy) | Document in `docs/runbook.md` for opt-in cloud judge; STRICT mode unsets it |
| Build artifacts | NEW: `packages/emmy-eval/dist/` (Bun build output) — usual workspace pattern | Add to `.gitignore` |

**Nothing found in OS-registered state or live service config.** Verified by enumeration of project topology (single-process harness + Docker containers; no scheduled tasks).

---

## Common Pitfalls

### Pitfall E-1: "More prompting" trap (Pitfall #1 from PITFALLS.md, EVAL-08 directly addresses)

**What goes wrong:** Operator adds a clarifying rule to the system prompt (e.g. "use hash-anchored edits more aggressively"); a SUBSET run shows improvement; rule promoted; full-suite later shows regression on a different task category.

**Why it happens:** Subset tests hide regressions. The prior repo's Qwen3 went from 8.5 → 6.8 by adding "Rule 10: When NOT to search."

**How to avoid:**
- **Promotion gate must require full-suite completion.** Phase 5 implements this as a hard fail in `pi-emmy-eval run`: any `--filter <subset>` flag forbids `--declare-improvement`.
- The promotion gate's `mean(new) > mean(old) + std(old)` comparison must run on every suite the change touches, not just the one the operator was tuning.

**Warning signs:**
- "Let me just test on the 5 hardest tasks" — STOP, run the full suite.
- Quality score up on subset, latency unchanged. Latency is a regression signal that subset tests miss.

### Pitfall E-2: Silent SP delivery failure during eval (Pitfall #6, EVAL-07)

**What goes wrong:** A profile swap or harness change breaks system-prompt delivery; eval continues; numbers look like a model-quality regression. (Prior repo's Phase 3 incident: 0/5 task success because system param wasn't honored on `/v1/messages`.)

**How to avoid:**
- **SP_OK canary as the first step of every batch.** Phase 1+2 already ship this; Phase 5's eval driver wires it as the pre-flight (`runSpOk` before any task starts).
- **Per-row canary verification** for long batches: every 50th row, re-run SP_OK; abort if it fails between in-progress rows.
- **Canary failure aborts the batch** — don't just log it.

### Pitfall E-3: Judge family bias inflates same-family scores

**What goes wrong:** Judge model from same training family as generation model rates self/family-mates 5-7% higher.

**How to avoid:**
- **Family-guard test in CI:** `bun test packages/emmy-eval/tests/judge-family-guard.test.ts` asserts judge.id has no substring overlap with any generator.id family root.
- **Default judge: Llama-3.3-70B-FP8** — distinct from Qwen and Gemma. Cloud Claude as opt-in.

### Pitfall E-4: Test-set contamination invalidates claims (Pitfall #9)

**What goes wrong:** Public-benchmark numbers look good because the model memorized them; real capability is lower.

**How to avoid:**
- LCB rolling cutoff filter (§Q3).
- Held-out hand-written tasks (§Q8).
- Contamination signal threshold (§Q8).

### Pitfall E-5: Single-shot variance hides real signal (Pitfall #10)

**What goes wrong:** N=1 eval, see 8.5 vs 7.8 differential, conclude "X is better"; actually within ±1.0 noise.

**How to avoid:**
- N≥3 (EVAL-04). Enforced by orchestrator: tasks with N<3 produce no number.
- Promotion gate: `mean(new) > mean(old) + std(old)`.
- Variance reported in every result row.

### Pitfall E-6: SWE-bench-on-aarch64 image gaps silently skip tasks

**What goes wrong:** Some SWE-bench instances have only x86_64 pre-built images; on Spark these run under QEMU (slow) or fail outright. Eval reports 285/300 instances completed without flagging the 15 skipped → false confidence.

**How to avoid:**
- The suite manifest (`eval/suites/swe-lite.yaml`) explicitly lists known-skipped instances with reason.
- Eval driver requires explicit `--skip-list-version` flag; mismatch with manifest fails CI.
- Skipped count is reported prominently in the markdown report header, not buried.

### Pitfall E-7: Profile swap mid-eval thrashes thermal envelope

**What goes wrong:** Operator swaps profiles every few tasks → repeated cold starts (3-8 min each) accumulate heat-soak; thermal throttle kicks in mid-batch.

**How to avoid:**
- Eval orchestrator runs ALL tasks for one profile, then swaps, then runs ALL for the next. Never per-task swaps.
- Between profile-batches, mandatory 5-min cool-down (operator-overridable with reason).
- 2-hour thermal floor from Phase 1 + Phase 04.1 measurements is the gate; fail batch if `nvidia-smi` reports sustained throttle.

---

## Code Examples

### Example 1: Eval driver entry point (sketch — not authoritative)

```typescript
// Source: extends pattern from eval/phase2/sc2/run_sc2.ts (proven Phase 2)
import { loadProfile, createEmmySession, runSpOk } from "@emmy/ux";
import { capture as captureProvenance } from "@emmy/eval/provenance";
import { runSuite } from "@emmy/eval/suites";
import { writeReport } from "@emmy/eval/report";

async function main(args) {
  const profile = await loadProfile(args.profilePath);

  // EVAL-07: SP_OK canary pre-flight
  const spok = await runSpOk(args.baseUrl, profile.serving.engine.served_model_name);
  if (!spok.ok) {
    process.exit(7);  // distinct exit code: SP_OK fail
  }

  // EVAL-03 + EVAL-09: provenance capture
  const provenance = await captureProvenance({ profile, suite: args.suite });

  // EVAL-04: ≥3 samples
  if (args.samples < 3 && args.declareImprovement) {
    throw new Error("EVAL-04: declareImprovement requires --samples >= 3");
  }

  // The actual loop — see suites/<name>.ts
  const result = await runSuite(args.suite, {
    profile, baseUrl: args.baseUrl,
    samples: args.samples,
    provenance,
  });

  // EVAL-08: subset run rejection for promotion claim
  if (args.declareImprovement && !result.suiteComplete) {
    throw new Error("EVAL-08: subset run cannot promote a change");
  }

  await writeReport(args.outDir, result, provenance);
}
```

### Example 2: terminal-bench BaseAgent shim (Python, runs inside tbench Docker)

```python
# Source: contract from https://www.tbench.ai/docs/agent-introduction (verified 2026-04-25)
import os, json, subprocess
from pathlib import Path
from terminal_bench.agents import BaseAgent, AgentResult

class PiEmmyAgent(BaseAgent):
    @staticmethod
    def name() -> str:
        return "pi-emmy"

    def perform_task(self, task_description, session, logging_dir=None):
        # Run pi-emmy in print mode against host-loopback emmy-serve.
        # The container needs --network=host or a similar bridge to reach 127.0.0.1:8002.
        env = os.environ.copy()
        env["EMMY_BASE_URL"] = env.get("EMMY_BASE_URL", "http://127.0.0.1:8002")
        proc = subprocess.run(
            ["pi-emmy", "--print", "--json", "--profile",
             env.get("EMMY_PROFILE", "qwen3.6-35b-a3b@v3.1")],
            input=task_description,
            capture_output=True, text=True, env=env, timeout=300,
        )
        events = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        # Translate the agent's bash tool calls into actual tmux send_keys so tbench
        # sees the terminal effects.
        for evt in events:
            if evt.get("type") == "tool_execution_end" and evt.get("tool") == "bash":
                # Side effects already happened in the host's bash — but tbench scores
                # via the Docker tmux pane. Need to mirror.
                # OPTION A: run pi-emmy INSIDE the tbench Docker (preferred — same FS).
                # OPTION B: replay command in tmux pane (this branch).
                session.send_keys(evt["args"]["command"], block=True)
        return AgentResult(
            total_input_tokens=sum(e.get("tokens_in", 0) for e in events),
            total_output_tokens=sum(e.get("tokens_out", 0) for e in events),
            failure_mode=None if proc.returncode == 0 else f"pi-emmy exit {proc.returncode}",
        )
```

(Implementation detail: option A — pi-emmy installed *inside* the tbench Docker — is cleaner because the agent's edits/bash directly mutate the same filesystem that tbench's `tests/test.sh` will inspect. This is the `BaseInstalledAgent` path.)

### Example 3: Provenance capture helper

```typescript
// Source: synthesized from §Q6 schema; new code in packages/emmy-eval/src/provenance.ts
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ProfileSnapshot } from "@emmy/provider";

export async function captureProvenance(args: {
  profile: ProfileSnapshot;
  suite: string;
}): Promise<Provenance> {
  const gitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const nvSmi = execSync("nvidia-smi --query-gpu=driver_version,uuid --format=csv,noheader", { encoding: "utf8" });
  const [driverVersion, gpuUuid] = nvSmi.split(",").map(s => s.trim());
  const pkg = JSON.parse(readFileSync("packages/emmy-ux/package.json", "utf8"));

  const machineId = readFileSync("/etc/machine-id", "utf8").trim();
  const hardwareId = createHash("sha256")
    .update(gpuUuid + execSync("uname -a") + machineId.slice(0, 64))
    .digest("hex");

  return {
    schema_version: "emmy.eval.provenance.v1",
    captured_at: new Date().toISOString(),
    eval_driver_commit: gitSha,
    profile: { ...args.profile.ref },
    engine: {
      vllm_version: process.env.EMMY_VLLM_VERSION ?? "[unverified]",
      container_image: args.profile.serving.engine.container_image,
      container_image_digest: args.profile.serving.engine.container_image_digest,
      cuda_version: process.env.EMMY_CUDA_VERSION ?? "[unverified]",
      driver_version: driverVersion,
      fastsafetensors: args.profile.serving.engine.env?.VLLM_LOAD_FORMAT === "fastsafetensors",
      gpu_memory_utilization: args.profile.serving.engine.gpu_memory_utilization,
    },
    model: {
      served_model_name: args.profile.serving.engine.served_model_name,
      model_sha: args.profile.serving.engine.model_sha ?? "[offline-cache-only]",
      quantization: args.profile.serving.engine.quantization ?? "fp8",
      max_model_len: args.profile.serving.engine.max_model_len,
    },
    hardware: {
      hardware_id: process.env.EMMY_HARDWARE_ID ?? hardwareId,
      gpu_uuid: gpuUuid,
      platform: `${process.arch}-${process.platform}`,
      system_memory_gb: 128,
    },
    harness: {
      pi_coding_agent_version: pkg.dependencies["@mariozechner/pi-coding-agent"],
      emmy_packages: { /* read from each pkg's package.json */ },
    },
    eval: { suite: args.suite, samples_per_task: 0 /* set by orchestrator */ },
  };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HumanEval / MBPP as primary coding benchmark | terminal-bench 2.0 + SWE-bench Verified + LiveCodeBench | 2024-2026 (HumanEval saturation; contamination concerns) | Phase 5 uses the modern stack; never primary-on-HumanEval. |
| Single-shot eval | N≥3 with std reporting | 2024-2026 (Pitfall #10 widely documented) | EVAL-04 enforces. |
| Anthropic API as default judge | Self-hosted Llama-class judge for air-gap; cloud opt-in | 2025-2026 (local-first agents) | §Q5 hybrid recommendation. |
| Subset eval to "iterate fast" | Full-suite gated by EVAL-08 | Prior-repo lesson 2026-02 | Hard-block in promotion gate. |
| `tb run --agent terminus` (tbench 1.x default agents) | Custom `BaseAgent` for any local model | 2026-04 (terminal-bench 2.0 ships custom-agent docs) | We implement `PiEmmyAgent(BaseAgent)`. |

**Deprecated/outdated:**
- HumanEval: contamination ceiling reached; not in Phase 5 suite.
- Original SWE-bench (full): superseded by Verified (500) + Lite (300); we use Lite for Spark practicality.
- Outlines as default constraints backend: superseded by XGrammar (already in profile).

---

## Recommended Plan-Level Decomposition (5–7 plans)

> Recommendations only — the planner makes the final call. Standard granularity is 5–8 phases × 3–5 plans; Phase 5 sits in the middle of that range.

### Plan 05-01: Wave 0 scaffold + RED stubs + suite manifests + holdout corpus

- Create `packages/emmy-eval/` workspace package skeleton (package.json, tsconfig, src/index.ts).
- Author 10 RED-stub tests (one per requirement from § Validation Architecture).
- Author 4 suite manifest YAMLs in `eval/suites/`.
- Author 5–10 hand-written held-out tasks in `eval/holdout/` (EVAL-05 contam-resistant track).
- Add `pi-emmy --print-environment` skeleton to `@emmy/ux` (provenance capture).
- Wire workspace + bun.lock; verify typecheck green.

### Plan 05-02: Provenance + statistics + promotion gate (the architectural backbone)

- Implement `packages/emmy-eval/src/provenance.ts` (§Q6 schema + nvidia-smi/git/pkg-json plumbing).
- Implement `packages/emmy-eval/src/stats/{mean-std.ts, promotion-gate.ts}` (§Q7).
- Implement `packages/emmy-eval/src/contamination/threshold.ts` (§Q8 thresholds).
- Implement `packages/emmy-eval/src/judge/family-guard.ts` (§Q5 sentinel).
- Wire all four into the RED stubs from 05-01 → GREEN.
- This plan ships the **non-GPU-bound** logic; everything is unit-testable against fixtures.

### Plan 05-03: Suite adapters — prior-Phase-1 + LiveCodeBench (the cheap suites)

- Implement `packages/emmy-eval/src/suites/prior-phase1.ts` — 5 coding tasks from prior repo.
- Implement `packages/emmy-eval/src/suites/livecodebench.ts` — `--start_date` filter + post-cutoff slice runner.
- Write the orchestrator loop (`packages/emmy-eval/src/orchestrator.ts`) that drives N samples per task via `createEmmySession`.
- Run a smoke pass on Qwen 35B MoE to validate end-to-end provenance + stats + reports (~3h).

### Plan 05-04: Suite adapters — terminal-bench + SWE-bench Lite (the heavy suites)

- Implement `packages/emmy-eval/src/suites/tbench.ts` — including the Python `PiEmmyAgent(BaseAgent)` shim that lives at `eval/tbench-agent/pi_emmy_agent.py`.
- Implement `packages/emmy-eval/src/suites/swe-lite.ts` — predictions JSON producer + `swebench.harness.run_evaluation` invocation.
- Pre-pull aarch64 SWE-bench images; document skip-list for known-incompatible instances.
- Smoke pass on a 5-task subset of each.

### Plan 05-05: Judge subsystem (default self-hosted Llama; opt-in Claude)

- Add `judge-llama-3.3-70b-instruct-fp8` profile bundle (NEW profile under `profiles/llama-3.3-70b-instruct-fp8/v1/`) — KV bisection + 2h thermal validation. **This is a real Phase 5 sub-task — Llama-70B-FP8 has its own profile discipline.**
- Implement `packages/emmy-eval/src/judge/self-hosted-judge.ts` — drives via `/profile`-swap after generation phase.
- Implement `packages/emmy-eval/src/judge/cloud-claude-judge.ts` — opt-in Anthropic API path (out-of-loop only).
- Family-guard test now has real fixtures.

### Plan 05-06: A/B compare + report generators (POLISH-01 in scope)

- Implement `packages/emmy-eval/src/compare/ab-compare.ts`.
- Implement `packages/emmy-eval/src/report/{markdown.ts, json.ts}`.
- Wire `pi-emmy-eval compare` and `pi-emmy-eval report` CLI subcommands.

### Plan 05-07: Phase close — full 4-profile A/B run + CLOSEOUT + REQUIREMENTS traceability

- Run the **Tier A** suite (prior-Phase-1 + LCB-rolling) on all 4 profiles, N=3, with self-hosted Llama judge. **~30h overnight × 2.**
- Run the **Tier B** suite (tbench-2.0 + SWE-bench Lite) on the 2 MoE profiles, N=3; the 2 dense profiles get N=1 smoke + 30-task tbench shape-check. **~70h spread over a long weekend.**
- Attach all SC-1..5 verdicts.
- Write `05-CLOSEOUT.md`.
- Flip 9 EVAL-* + UX-06 REQ-IDs Done in `REQUIREMENTS.md`.
- Cumulative trace 43 → 52/68.

**Why 7 plans not 5:** Phase 5 is genuinely big — it's the "research-artifact bar reached" phase. Splitting the cheap-suites adapter (05-03) from the heavy-suites adapter (05-04) lets the team validate end-to-end on cheap suites before paying SWE-bench's setup tax. Splitting the judge subsystem (05-05) into its own plan lets the Llama-70B judge profile bundle get the full Phase-1-class profile discipline (KV bisection + thermal). Compressing further would force tradeoffs.

---

## Top 3 Risks With Mitigations

### Risk 1 — Wall-clock infeasibility on dense profiles (HIGH likelihood)

**Risk:** Full 4-profile × full-suite × N=3 budget exceeds 400 GPU-hours; Phase 5 stalls.

**Mitigation:** Tiered scope (§Q12). Tier A (cheap suites, all profiles, N=3) + Tier B (heavy suites, MoE only at full coverage, dense at smoke-only). Document the dense-profile partial coverage as a Phase-5 **deliberate acceptance**, not a debt. Re-evaluate full coverage in Phase 7 with x86 reproducer.

**Detection:** Per-profile wall-clock estimate in suite manifest; orchestrator refuses to start a batch whose estimated wall-clock exceeds operator-configured `--max-hours` budget.

### Risk 2 — Judge wall-clock + family-guarantee tension (MEDIUM likelihood)

**Risk:** Self-hosted Llama-70B judge swap adds ~3 min latency × 4 profile-batches × 2 (in+out) = 24 min just in swap overhead, plus per-judgment latency ~20s × 600 judgments = 3.3h. Cloud Claude is faster but breaks STRICT air-gap. Operator chooses one or the other repeatedly.

**Mitigation:** Default to self-hosted Llama in Phase 5 (research-artifact bar); ship the cloud-Claude path as opt-in for ad-hoc faster iterations under PERMISSIVE. Document the swap-amortization cost in `docs/runbook.md`.

**Detection:** Judge profile inclusion in `eval/MATRIX.md` is the gating sign; if Phase 5 ships without a judge profile, family-guard test fails CI.

### Risk 3 — SWE-bench-Verified-on-aarch64 emulation overhead (MEDIUM likelihood)

**Risk:** Even SWE-bench Lite on aarch64 may have 15-40% of instances fail to grade due to x86-only Docker images + QEMU instability. Numbers look low; cause is infra, not model.

**Mitigation:** Pre-flight a 30-instance subset of SWE-bench Lite during Plan 05-04 to characterize the failure rate. If >20% fail, escalate: either skip-list those instances (with documentation) OR move SWE-bench to Phase 7 entirely. The decision happens in 05-04 with real data, not now.

**Detection:** Smoke-run failure rate on the 30-instance subset is the gate.

---

## Open Questions

> Items the planner / operator must resolve before execution.

1. **Llama judge profile authorship.** Plan 05-05 adds a new profile bundle under `profiles/llama-3.3-70b-instruct-fp8/v1/`. This needs a KV bisection + 2-hour thermal replay (Phase 1 / Phase 04.1 discipline). **Should the Llama judge profile be a Phase 5 sub-task, or punted to a Phase 04.2 follow-up?** Recommendation: keep in Phase 5 (Plan 05-05) since the judge is gating; otherwise Phase 5 ships incomplete.

2. **Tier A vs Tier B coverage commitment.** §Q12 recommends tiered coverage (cheap suites all-profile, heavy suites MoE-only-full + dense-smoke). **Does the operator accept this scope reduction, or insist on full coverage and accept the multi-week wall-clock?** Recommendation: accept tiered. Document partial-coverage explicitly.

3. **SWE-bench Lite vs Verified.** §Q2 + §Q12 recommend SWE-bench Lite (300) for Phase 5; defer Verified (500) to Phase 7 / x86 reproducer. **Is Lite acceptable for the Phase 5 "research-artifact bar"?** Recommendation: yes — Lite is what the SWE-bench team themselves recommend for resource-constrained iteration. Verified is a gold-standard milestone, but the publication-grade reproduction story depends on it being runnable by an outside party, which means it lives at Phase 7 anyway.

4. **Cloud-judge default.** §Q5 recommends self-hosted Llama default + cloud Claude opt-in. **Does the operator want the opposite (cloud default for speed, local opt-in for STRICT)?** Recommendation: keep local default; the project's whole identity is "local-first."

5. **Holdout task authorship.** EVAL-05 + §Q8 mandate 5-10 hand-written held-out tasks. **Who authors them?** They need to be (a) representative of daily-driver coding work, (b) NOT in any public training set, (c) covered by emmy's existing toolset (no new tools). Recommendation: operator authors during Plan 05-01; Phase 5 cannot start without these.

6. **Continuity baseline literature tasks.** §Q4 recommends scoping prior-Phase-1 to the 5 coding tasks (skipping 3 literature tasks that need pubmed/biorxiv MCP servers). **Does the operator plan to add those MCP servers later?** Recommendation: defer to Phase 6+ unless operator considers them critical.

7. **Outside-reproducer logistics.** Phase 5 SC-2 says "verified by re-running on a second box." **Does the operator have access to a second DGX Spark, or is "outside-reproducer CI" the path?** Recommendation: ship the script in Phase 5; defer the actual second-box verification to Phase 7 unless the operator already has access.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | terminal-bench 2.0 has ~89 manually-verified tasks | §Q1 | Low — count may be slightly off, but order of magnitude is right; impacts only wall-clock estimate |
| A2 | DGX Spark Lite-on-aarch64 image coverage will be sufficient for ≥80% of instances | §Q2, Risk 3 | MEDIUM — if coverage is poor, we materially change the SWE-bench scope. Plan 05-04 smoke-probe gates this. |
| A3 | Llama-3.3-70B-Instruct-FP8 fits on Spark with KV ceiling similar to other ~70B models (~75 GB FP8 + ~10 GB KV) | §Q5, Plan 05-05 | MEDIUM — if it doesn't fit, fall back to a smaller Llama (8B/11B Instruct) — still family-distinct from Qwen/Gemma but capability-weaker as judge |
| A4 | LCB v6 (1055 problems) has a meaningful post-cutoff slice (~50-200 problems) for our 2026-04-released models | §Q3 | LOW — LCB is rolling; post-Apr-2026 problems either exist or v7 will exist by Phase 5 execution |
| A5 | Per-task token estimates (2-5K tbench, 3-8K SWE, 5K prior-Phase-1, 1K LCB) are accurate to ±50% | §Q12 | MEDIUM — if multi-turn agentic tbench tasks are 10K+ tokens average, dense-profile budget blows up further; mitigation is N=1 smoke |
| A6 | Bun + pytest as the only test frameworks needed; no new install required | § Validation Architecture | LOW — `swebench` and `terminal-bench` and `livecodebench` are pip-installable Python; we already have a uv venv |
| A7 | Anthropic Claude Sonnet API still available in 2026 with `claude-sonnet-4-5-20250929` style pinning | §Q5 | LOW — the prior repo's pin is from 2025-09; current Sonnet versions are similar shape; opt-in path so fallback to local doesn't block release |
| A8 | Phase-3.1's two-track CI split (`ci_verify_phase3` STRICT + `ci_verify_research_egress` PERMISSIVE) is the correct architectural answer for Phase 5 air-gap reconciliation | §Q13 | LOW — it was designed for this; reusing |
| A9 | Promotion gate `mean(new) > mean(old) + std(old)` is honest at N=3 | §Q7 | LOW — standard methodology, conservative compared to Welch's t |
| A10 | Daily-driver default stays unchanged through Phase 5 (per MATRIX.md). Phase 5 informs whether the post-Phase-5 default should change | §Phase Boundary | LOW — explicitly locked in MATRIX |
| A11 | The "research artifact bar reached at end of Phase 5" mandate from ROADMAP means the *artifact + its reproducer script* are shipped, not the *outside-CI infrastructure to verify it* | §Q9 | MEDIUM — if operator interprets "research artifact" as including the CI infra, scope expands materially |

---

## Sources

### Primary (HIGH confidence)

- [Phase 1+2+3+04.1 closed plans] — `.planning/phases/0[1-4]*/*CLOSEOUT.md` and `eval/MATRIX.md` (4-profile participant manifest, 2026-04-25)
- [Existing Phase 2 SC runners] — `eval/phase2/sc{2,3,4,5}/run_sc*.ts` — proven harness-as-library pattern
- [`@emmy/ux session.ts`] — `packages/emmy-ux/src/session.ts` — `createEmmySession` + `runPrint` SDK surface
- [`@emmy/ux sp-ok-canary.ts`] — `packages/emmy-ux/src/sp-ok-canary.ts` — EVAL-07 already shipped
- [Prior-repo eval driver] — `/data/projects/setup_local_opencode/validation/{eval_tasks.py, eval_judge.py, PHASE1_RESULTS_QWEN3.json}` — continuity baseline source
- [terminal-bench BaseAgent docs] — https://www.tbench.ai/docs/agent-introduction (retrieved 2026-04-25; verified `perform_task` signature)
- [terminal-bench 2.0 announcement] — https://www.tbench.ai/news/announcement-2-0 (retrieved 2026-04-25; 89 tasks, 2025-11-07 announcement)
- [SWE-bench README + harness docs] — https://github.com/SWE-bench/SWE-bench + https://www.swebench.com/SWE-bench/guides/evaluation/ (predictions schema, harness CLI)
- [SWE-bench Docker setup] — https://www.swebench.com/SWE-bench/guides/docker_setup/ (resource requirements, cache levels)
- [LiveCodeBench README] — https://github.com/LiveCodeBench/LiveCodeBench (retrieved 2026-04-25; `--release_version release_v6`, `--start_date YYYY-MM-DD`, 1055 problems)
- [pi-coding-agent SDK docs] — https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md (`createAgentSession` vs `createAgentSessionRuntime`)
- [Project research baseline] — `.planning/research/{STACK.md, PITFALLS.md, SUMMARY.md}`

### Secondary (MEDIUM confidence)

- [Epoch AI SWE-bench Docker registry] — https://epoch.ai/blog/swebench-docker (62-min run on 32-core x86 baseline; image size optimization tricks)
- [SWE-bench arm64 issue thread] — https://github.com/SWE-bench/SWE-bench/issues/375 (aarch64 status; ~80% best-effort coverage)
- [mini-swe-agent local-models docs] — https://mini-swe-agent.com/latest/models/local_models/ (vLLM integration shape; useful as comparison client)
- [Harbor framework custom-agent docs] — https://harborframework.com/docs/agents (BaseAgent/BaseInstalledAgent; future-proof path for tbench 2.0+)
- [LLM-as-Judge bias survey] — https://llm-judge-bias.github.io/ + https://arxiv.org/html/2510.24367 (5-7% same-family bias; cross-family judge required)
- [SWE-bench-fast arm64 build] — https://gist.github.com/greynewell/497005bb33641503f1a5874f16578088 (Feb 2026 third-party arm64 build effort)

### Tertiary (LOW confidence — flag for validation)

- [Bootstrap CI methodology] — Wikipedia + standard intro stats (general; not eval-specific)
- [Various 2026 LLM-judge guides] — labelyourdata.com, sureprompts.com, evidentlyai.com (general guidance, not specifically validated against coding-eval workflows)
- [SWE-bench Lite vs Verified scope decision] — extrapolation; no published "Lite is acceptable for research artifact" precedent found

### Internal / prior work

- `.planning/CLAUDE.md` (project invariants, including air-gap posture and SearxNG egress allowance)
- `.planning/research/PITFALLS.md` (Pitfall #1, #2, #5, #6, #7, #9, #10, #11 directly inform Phase 5)
- `.planning/phases/03.1-operational-polish-minimal-ram-profile-live-auto-compaction-/` (CI split between STRICT + PERMISSIVE — the air-gap pattern Phase 5 inherits)
- `eval/phase2/sc2/run_sc2.ts` (the working harness-as-library reference shape — Phase 5 generalizes its pattern)

---

## Metadata

**Confidence breakdown:**
- terminal-bench BaseAgent contract: **HIGH** — `perform_task` signature verified across multiple sources
- SWE-bench Lite-on-aarch64 wall-clock: **MEDIUM** — Epoch baseline is x86; Spark estimate has ±50% range
- Judge model selection (Llama vs Claude vs alternatives): **MEDIUM** — multiple defensible options; final choice depends on operator priorities
- Provenance schema (EVAL-03): **HIGH** — every field has a concrete capture path
- Statistics methodology (EVAL-04 + EVAL-08): **HIGH** — standard low-N coding-eval practice
- Contamination thresholds (§Q8): **MEDIUM** — defensible starting points, will tune in Phase 7
- Wall-clock budget (§Q12): **MEDIUM** — rough estimates; tiered scope mitigates
- Outside-reproducer CI (§Q9): **LOW** — no aarch64-Spark precedent found; Phase 7 problem
- Recommended plan decomposition: **MEDIUM** — depends on Open Questions 1-7 resolution

**Research date:** 2026-04-25
**Valid until:** ~30 days for stable claims (terminal-bench, SWE-bench harness contract, profile/SDK shape); ~7 days for fast-moving (LCB releases, vLLM minor versions, terminal-bench dataset-version tags). Re-validate before Plan 05-04 if Phase 5 execution slips beyond 2026-05-25.

---

## RESEARCH COMPLETE

Phase 5 is a plumbing-heavy phase that wires four existing benchmarks (terminal-bench 2.0, prior-repo Phase 1, SWE-bench Lite, LiveCodeBench rolling) through Emmy's SDK with a self-hosted Llama judge by default, ≥3-sample variance + promotion gate, full provenance dump, and tiered coverage on dense vs MoE profiles to fit Spark's wall-clock envelope; 7 plans recommended, 7 open questions for the operator.
