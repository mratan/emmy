---
phase: 05-eval-harness-reproducible-benchmark-suite
source: [ROADMAP.md § Phase 5, REQUIREMENTS.md § EVAL-01..09 + UX-06 + POLISH-01, 05-RESEARCH.md (1292 lines), eval/MATRIX.md, operator pre-commit 2026-04-25]
created: 2026-04-25
---

# Phase 5 — Eval Harness + Reproducible Benchmark Suite (CONTEXT)

## Goal (one sentence)

Ship a reproducible benchmark suite that imports the Phase 2 harness as a library through `@emmy/ux createEmmySession` (never bypassing the SDK), drives every task at N≥3 samples through the 4-profile MATRIX.md participants, embeds full provenance in every result, gates batches with the `[SP_OK]` canary, blocks subset-run promotion of changes, and pairs executable correctness with a different-family LLM-as-judge — landing Emmy at the **research-artifact bar**.

## Why now

Phase 04.1 closed the 4-profile MATRIX (Qwen MoE/dense × Gemma MoE/dense, all KV-bisected + thermal-validated, all gmu=0.86 hardware ceiling, dense profiles operationally retuned to gmu=0.55 for v1.1). The eval matrix is "eval-ready" — Phase 5 now needs to actually consume it. Phase 6 (speculative decoding paired benchmark) and Phase 7 (publication artifact) both depend on Phase 5's eval driver existing.

## Operator pre-committed decisions (locked 2026-04-25 — do NOT relitigate)

The user opted to skip `/gsd-discuss-phase` and lock these in directly. They bind every plan in this phase.

### D-01: Tier A/B coverage tradeoff — ACCEPTED

**Locked.** Per RESEARCH.md §Q12, full 4-profile × full-suite × N=3 ≈ 400+ GPU-hours on Spark is infeasible. Tiered scope:

- **Tier A** (all 4 profiles, N=3): Phase-1 continuity prompts + holdout + LiveCodeBench rolling. Total ~30h continuous.
- **Tier B** (MoE profiles only — `qwen3.6-35b-a3b@v3.1` + `gemma-4-26b-a4b-it@v2`, N=3): terminal-bench-2.0 + SWE-bench-Lite. Total ~110h spread over a long weekend.
- **Dense smoke** (`qwen3.6-27b@v1.1` + `gemma-4-31b-it@v1.1`, N=1 single-shot): heavy suites get pass/fail correctness signal only — explicitly documented as "dense correctness signal, not statistical claim".

This is a deliberate **acceptance**, not debt. Document partial-coverage explicitly in every report header.

### D-02: SWE-bench Lite (300), NOT Verified (500)

**Locked.** Per RESEARCH.md §Q2 + §Q12. Lite is feasible on aarch64 DGX Spark; Verified-on-x86 outside-reproducer is a Phase 7 problem. Plan 05-04 targets Lite. Verified stays a Phase 7 carry-forward.

### D-03: Hybrid judge subsystem — self-hosted Llama-3.3-70B-Instruct-FP8 default; cloud Claude opt-in

**Locked.** Per RESEARCH.md §Q5. Plan 05-05 authors a `profiles/llama-3.3-70b-instruct/v1/` brand-new bundle with KV bisection + 2×2h thermal validation (mirroring Phase 04.1 dense-profile flow exactly). Cloud Claude Sonnet judge is opt-in via `--judge=cloud-claude` flag; runs in PERMISSIVE air-gap CI lane (`ci_verify_research_egress`) only; **never in the inference loop**.

### D-04: Plan 05-01 holdout corpus is operator-authored

**Locked.** Per RESEARCH.md §Q8 + EVAL-05. Plan 05-01 carries a `checkpoint:human-author` task: 5–10 hand-written tasks the operator authors before Plan 05-02 runs end-to-end. Planner provides task templates + acceptance criteria; the actual prompts are operator-authored.

### D-05: Prior-repo Phase-1 literature tasks — DEFERRED to Phase 6+

**Locked.** Per RESEARCH.md §Q4. The 3 PubMed/bioRxiv tasks in `setup_local_opencode/validation/eval_tasks.py` need MCP servers Emmy doesn't ship (out of Phase 5 scope). Plan 05-02 includes only the 5 coding tasks (CODE_01..CODE_05).

### D-06: Outside-reproducer second-box CI — DEFERRED to Phase 7

**Locked.** Per RESEARCH.md §Q9. Phase 5 ships the **reproducer SCRIPT + MANIFEST** (`scripts/reproduce_eval.sh` + `eval/REPRODUCER.md`) — the artifact someone could run on a fresh DGX Spark. Verifying it actually runs on a second box is Phase 7. Phase 5 SC-2 is satisfied by the script existing + being self-documented; the actual second-box run is a one-time human walkthrough at Phase 5 close, not a recurring CI job.

### D-07: Eval driver location — `packages/emmy-eval/` (new TS workspace package)

**Locked.** Per RESEARCH.md §Q10 + EVAL-02. Sibling to `emmy-{provider, tools, ux, telemetry, context}`. Consumes `@emmy/ux createEmmySession` + `@emmy/provider postChat` + `@emmy/tools` SDK directly via Bun workspace. **Does NOT shell out to `pi-emmy` CLI** for task driving (it does shell `pi-emmy --print-environment` for provenance, that's allowed).

### D-08: Air-gap two-lane discipline — STRICT inference always; PERMISSIVE only for opt-in cloud judge / dataset refresh

**Locked.** Per RESEARCH.md §Q13 + Phase 3.1 precedent. The eval driver MUST verify which CI lane it's running on at startup and refuse mismatched config. Specifically:
- Inference always under `ci_verify_phase3` STRICT (no outbound).
- Optional cloud judge runs under `ci_verify_research_egress` PERMISSIVE — separate post-inference pass on captured JSONL transcripts; never during generation.
- Dataset/image fetching (HuggingFace LCB pulls, SWE-bench-Lite Docker images, terminal-bench task data) happens **before** the STRICT gate flips (pre-cached). Reproducer script documents both phases.

### D-09: POLISH-01 A/B compare — IN SCOPE (Plan 05-06)

**Locked.** Per RESEARCH.md §Q11. The 4-profile MATRIX.md was authored explicitly for this comparison; deferring it leaves Phase 5 producing isolated numbers with no comparator. POLISH-02 (replay) and POLISH-03 (static dashboard) deferred to backlog / Phase 7.

### D-10: Daily-driver default UNCHANGED through Phase 5

**Locked.** Phase 5 evaluates against existing profiles; it does NOT change `qwen3.6-35b-a3b/DEFAULT_VARIANT` or any other family marker. Whether Phase 5's eval results justify changing the default is a post-Phase-5 decision (likely Phase 7 publication time, when full numbers are in).

### D-11: Profile immutability D-02 applies to the Llama judge profile

**Locked.** Plan 05-05's `profiles/llama-3.3-70b-instruct/v1/` is authored with the same Phase 04.1 dense-profile discipline: HF download → container digest pin → bundle write → hash → validate → smoke → KV bisect (`scripts/find_kv_budget.py` is sole writer of `gpu_memory_utilization`) → 2×2h thermal replay. Do NOT shortcut judge profile validation just because it's "only" the judge model.

### D-12: Throughput is informational, NOT a Phase 5 gate

**Locked.** Per `~/.claude/projects/-data-projects-emmy/memory/feedback_dense_model_throughput.md` operator directive (carried from Phase 04.1). Phase 5 gates on correctness (executable scoring + judge agreement + canary integrity), NOT tok/s.

## Plan breakdown (7 plans, 4 waves)

Per RESEARCH.md § Recommended plan-level decomposition:

| Plan | Wave | Autonomous | REQ-IDs | One-line summary |
|---|---|---|---|---|
| 05-01 holdout-suite | 1 | **false** (operator authors holdout corpus) | EVAL-05 | Author 5–10 hand-written holdout tasks + rephrased variants generator + LiveCodeBench rolling fetcher + contamination-signal threshold logic |
| 05-02 eval-driver-core | 1 | true | EVAL-02, EVAL-03, EVAL-04, EVAL-07, EVAL-08, EVAL-09, UX-06 | Author `packages/emmy-eval/` workspace package: orchestrator + provenance + stats + promotion gate + SP_OK gate + air-gap-lane verifier + Phase-1 continuity baseline (5 coding tasks) as first concrete suite |
| 05-05 llama-judge-profile | 2 | **false** (operator-attended ~12-16h GPU run) | EVAL-06 | Brand-new `profiles/llama-3.3-70b-instruct/v1/` bundle: HF pull → container pin → bundle → hash → validate → smoke → KV bisect → 2×2h thermal; wire LLM-as-judge subsystem (default self-hosted via `/profile`-swap; opt-in cloud-Claude under PERMISSIVE) |
| 05-03 terminal-bench | 3 | **false** (long GPU run) | EVAL-01 | terminal-bench-2.0 BaseInstalledAgent shim (Python `PiEmmyAgent`) + 89-task driver; Tier B (MoE N=3 + dense N=1 smoke) |
| 05-04 swe-bench-lite | 3 | **false** (long GPU run) | EVAL-01 | SWE-bench-Lite predictions JSON producer + aarch64 image pre-flight; Tier B (MoE N=3 + dense N=1 smoke); skip-list curation for x86-only images |
| 05-06 ab-compare | 4 | true | POLISH-01 | `pi-emmy-eval compare --baseline X --candidate Y` markdown side-by-side report generator + 4-profile MATRIX cross-cell aggregator |
| 05-07 closeout | 4 | **false** (operator-gated SC walkthroughs + REPRODUCER manifest) | EVAL-03, EVAL-09 (closeout-level) | Wave-final: full Tier-A + Tier-B-MoE A/B run + `eval/REPRODUCER.md` manifest + `scripts/reproduce_eval.sh` + STATE.md/ROADMAP.md update + 9 EVAL-* + UX-06 + POLISH-01 REQ-IDs flipped Done |

**Wave structure:**

- **Wave 1** (parallel): 05-01 (holdout authoring + LCB fetcher — operator-attended) + 05-02 (eval driver core — autonomous)
- **Wave 2**: 05-05 (Llama judge profile — operator-attended ~12-16h GPU run; depends on 05-02 driver existing for the judge subsystem wire-up)
- **Wave 3** (parallel): 05-03 (terminal-bench, depends on 05-02 + 05-05) + 05-04 (SWE-bench-Lite, depends on 05-02 + 05-05)
- **Wave 4**: 05-06 (A/B compare, depends on 05-02; can run any time after but lands here for cohesion) + 05-07 (closeout, depends on all above)

## Constraints (carried forward from earlier phases)

- **Pitfall #1 sole-writer** (KV-cache budget): only `scripts/find_kv_budget.py` writes `gpu_memory_utilization`. Plan 05-05 obeys this for the Llama judge profile.
- **Pitfall #2 [SP_OK] canary** (system-prompt delivery): every eval batch starts with `runSpOk()` against the active profile; canary failure aborts batch (EVAL-07). Per-row re-canary every 50 rows for long batches.
- **Pitfall #5 air-gap**: STRICT lane for inference always; PERMISSIVE only for opt-in cloud judge / dataset refresh; eval driver verifies lane at startup.
- **Pitfall #6 silent system-prompt failure**: shipped Phase 1 + Phase 2 (`packages/emmy-ux/src/sp-ok-canary.ts`); Plan 05-02 wires it as eval pre-flight.
- **Pitfall #7 thermal**: 2-hour validated profiles already; eval orchestrator enforces 5-min cool-down between profile-batches; no per-task profile swaps (would thrash thermal envelope).
- **Pitfall #9 contamination**: holdout + rephrased + LCB rolling; threshold-based contamination signal (Plan 05-01).
- **Pitfall #10 single-shot variance**: N≥3 enforced (EVAL-04); promotion gate `mean(new) > mean(old) + std(old)` at N=3 (Welch's t at α=0.05 only when N≥10).
- **EVAL-08 anti-prompting-trap**: subset runs are **hard-blocked** from declaring promotion. The runner refuses to write `verdict: positive` if either `--filter` was used or N<3.
- **D-19 no-model-conditionals audit (Phase 4)**: eval driver MUST NOT contain `if profile.id == 'qwen-...'` style branches. All model-shaped behavior in YAML profiles.
- **Profile immutability D-02**: Llama judge profile is a brand-new bundle, not a clone of an existing profile. Field changes → new version directory.
- **Daily-driver default UNCHANGED**: Phase 5 evaluates the existing `qwen3.6-35b-a3b@v3.1` default; whether to change is a post-Phase-5 decision.
- **No harness/SDK forking**: if a plan finds it needs a Phase 2 SDK API that doesn't exist, that's a finding to flag (potential phase-split or Phase 2 follow-up), NOT a license to edit `@emmy/ux` from inside Phase 5.

## Out of scope (deferred or other phases)

- New harness/tool features → Phase 2 follow-up bucket
- Speculative decoding paired benchmark → Phase 6 (uses Phase 5 harness once shipped)
- Static dashboard, README citations, HF dataset publishing → Phase 7
- Outside-reproducer CI as a published artifact → Phase 7 (Phase 5 ships the script; CI infra to verify on a second box is Phase 7)
- SWE-bench Verified (500) → Phase 7 / x86 reproducer
- Cross-model routing evaluation → Phase 6+
- Models beyond MATRIX.md + Llama judge → out of scope
- Fine-tuning, retraining, LoRA → out of scope per PROJECT.md
- POLISH-02 session replay + POLISH-03 static dashboard → backlog / Phase 7

## Success criteria (carried from ROADMAP § Phase 5)

These are the 5 SCs Plan 05-07 closes; the must_haves of every plan in the phase derive from them:

1. **`pi-emmy-eval run --profile <id> --suite <name> --samples 3` runs every task three times via the harness SDK (no direct vLLM bypass), produces a JSON results file and a markdown report, and the JSON embeds the full provenance dict for every row.**
2. **The same command on a clean DGX Spark, given the same git SHA + container digest + model SHA, reproduces every reported number within reported variance** — verified by re-running on a second box (or via an "outside-reproducer" CI job that pulls the artifact). [Per D-06: Phase 5 ships the *script*; second-box verification is Phase 7.]
3. **The contamination-resistant tracks (holdout + rephrased + LiveCodeBench) score within a documented gap of the public-benchmark numbers**; if the gap exceeds threshold, the suite emits a "contamination signal" warning and the report flags affected tasks. [θ_pass@1 = 0.10; θ_judge = 1.0 starting thresholds — Plan 05-01.]
4. **Attempting to declare a prompt or sampling change "positive" via a subset run is blocked by the runner** — the full suite must complete with mean(new) > mean(old) + std(old) before the change is recorded as a regression-passing tuning. [Plan 05-02 promotion gate.]
5. **Every result row carries the same `[SP_OK]` canary verification from Phase 1**; any failed canary in the run aborts the batch and forces investigation before numbers are recorded. [Plan 05-02 SP_OK gate; per-row re-canary every 50 rows for long batches.]

## References

- `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-RESEARCH.md` — 1292-line research synthesis covering all 13 questions
- `eval/MATRIX.md` — 4-profile Phase-5 participant manifest (Phase 04.1 close artifact)
- `eval/phase2/sc2/run_sc2.ts` — proven harness-as-library pattern Phase 5 generalizes
- `packages/emmy-ux/src/{session,sp-ok-canary,profile-loader}.ts` — SDK entry points Phase 5 imports
- `packages/emmy-provider/src/post-chat.ts` — vLLM HTTP layer (used only by `runSpOk`; eval driver goes through `createEmmySession`)
- `scripts/find_kv_budget.py` — KV bisection (sole writer of `gpu_memory_utilization`; Plan 05-05 reuses)
- `scripts/thermal_replay.py` — 2-hour thermal validation (Plan 05-05 reuses)
- `scripts/start_emmy.sh` — engine boot (already Phase-1-pinned to NGC container digest)
- `emmy_serve/canary/sp_ok.py` — Python canary sibling (eval Python adapters reuse)
- `.planning/phases/04.1-dense-variant-model-profiles-qwen3-6-27b-fp8-gemma-4-31b-it-/04.1-CONTEXT.md` — Phase 04.1 dense-profile discipline Plan 05-05 mirrors exactly
- `.planning/phases/03.1-operational-polish-minimal-ram-profile-live-auto-compaction-/` — air-gap two-lane CI split Phase 5 inherits
- `/data/projects/setup_local_opencode/validation/{eval_tasks.py, eval_judge.py, PHASE1_RESULTS_QWEN3.json}` — prior-repo Phase 1 continuity baseline
- `~/.claude/projects/-data-projects-emmy/memory/feedback_dense_model_throughput.md` — operator directive: throughput informational only, NOT a gate
