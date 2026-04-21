---
gsd_state_version: 1.0
milestone: v0.68.0
milestone_name: milestone
status: unknown
last_updated: "2026-04-21T21:43:53.295Z"
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 17
  completed_plans: 10
  percent: 59
---

# State: Emmy

**Last updated:** 2026-04-20
**Updated by:** roadmapper (initial creation)

---

## Project Reference

**Project:** Emmy — fully-local coding agent on NVIDIA DGX Spark
**Core Value:** A local coding agent good enough to be the author's daily driver, structured rigorously enough to be a public research artifact others can reproduce — with no cloud dependency anywhere in the loop.
**Current Focus:** Phase 02 — pi-harness-mvp-daily-driver-baseline

**Authoritative documents:**

- `.planning/PROJECT.md` — what Emmy is, constraints, key decisions
- `.planning/ROADMAP.md` — 7-phase plan with success criteria
- `.planning/REQUIREMENTS.md` — 66 v1 requirements with phase mappings
- `.planning/research/SUMMARY.md` — research synthesis
- `.planning/research/STACK.md` — recommended stack (NGC vLLM 0.19.x, Qwen3.6, Gemma 4 26B MoE, pi-mono v0.68.0, XGrammar, Langfuse v3, terminal-bench 2.0)
- `.planning/research/FEATURES.md` — MVP definition split v1/v1.x/v2 with P1/P2/P3 priority
- `.planning/research/ARCHITECTURE.md` — 4-component MVP spine, two-process topology
- `.planning/research/PITFALLS.md` — 20 pitfalls; 8 critical, mapped to phases

---

## Current Position

Phase: 02 (pi-harness-mvp-daily-driver-baseline) — EXECUTING
Plan: 2 of 9
**Phase:** 1 — Serving Foundation + Profile Schema — closed with 3 documented deferrals; see `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md`
**Next:** `/gsd-plan-phase 2` (pi-mono harness — daily-driver bar)
**Phase Progress:** 100% (8/8 plans landed; 3 plans carry deferrals owned by Phase 5 or Phase 7)

```
Phases: [✓][▢][▢][▢][▢][▢][▢]   1/7 phases complete
Current: Phase 2 (planning pending — daily-driver bar)
```

**Daily-driver bar:** end of Phase 2
**Research-artifact bar:** end of Phase 5
**Public artifact bar:** end of Phase 7

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 1 / 7 |
| v1 requirements complete | ongoing (Phase 2 in flight) |
| Critical pitfalls addressed | 1 / 8 (Pitfall #8 reproducibility via uv.lock + bun.lock discipline) |
| Daily-driver readiness | Not yet (blocked on Phase 2 plans 02-09) |
| Research-artifact readiness | Not yet (blocked on Phase 5) |

### Per-plan execution log

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02 P01 | 12min | 2 tasks | 20 files |

---

## Accumulated Context

### Decisions Made During Roadmapping

- **Phase 1 carries the SP_OK canary infrastructure** (EVAL-07), not just Phase 5. Rationale: PITFALLS.md ranks system-prompt-delivery failure as Critical and the prior repo's Phase 3 incident wasted 5/5 task scores at 0/5 success. The canary is shipped as boot-time smoke-test infrastructure used by every later phase.
- **Hash-anchored edits ship in Phase 2 as the default edit format** (TOOLS-03), not as later polish. Rationale: documented 6.7 → 68.3% improvement on 180 tasks for weak models; it is the highest-leverage single change for daily-driver feel. Plain string-replace falls back only when hashes can't be computed.
- **MCP client and web_fetch ship in Phase 2**, not later. Rationale: 2026 inflection point — MCP is now infrastructural (LF governance Dec 2025, 10k+ servers), and web_fetch is documentation reading (allowed under "no cloud inference" constraint). Daily-driver bar requires both.
- **Eval harness is sequenced as Phase 5** (parallelizable with P3/P4 after P2 stable). Rationale: it depends only on the Phase 2 SDK entry point per ARCHITECTURE.md, and isolating it means P3 and P4 don't gate on eval methodology decisions.
- **Speculative decoding is Phase 6, not earlier.** Rationale: PITFALLS.md #4 — spec decode requires working profiles + eval to measure correctly via paired benchmark; sequencing earlier would measure it against an unstable baseline.
- **Two first-class models proven at Phase 4, not Phase 1.** Rationale: adding the second model is what proves the profile abstraction is truly model-agnostic. Phase 1 ships one profile end-to-end; Phase 4 forces the abstraction by adding Gemma 4 with its own tool format and quirks.
- **Granularity calibration:** the natural phase count came out to 7, which sits at the upper edge of Standard granularity (5–8). All 7 phases are real coherent capabilities — none are padding.

### Decisions Made During Execution

- **Bun 1.3 text-lockfile (`bun.lock`) committed in place of legacy `bun.lockb`** (Plan 02-01). Bun ≥1.2 defaults to text lockfiles; the binary format is deprecated. Text lockfile preserves Pitfall #8 reproducibility while adding audit-diffability. Neither `bun.lock` nor `bun.lockb` is gitignored.
- **Profile v2 built as sibling of Phase 1-locked v1** (Plan 02-01). Preserves Phase 1 certification hash `sha256:b91e747...`; v2 harness.yaml TODO fills + hash recomputation owned by Plan 02-07.
- **pi-coding-agent 0.68.0 pinned EXACTLY (no `^`/`~`) in all four @emmy/* packages** (Plan 02-01). TS-side analog of Phase 1's `uv.lock` discipline per T-02-01-04 threat register.

### Key Constraints Carried Forward

- **Hardware:** DGX Spark (GB10, 128 GB unified memory). Single model loaded at a time (~75 tok/s Qwen3.6, ~38–52 tok/s Gemma 4 MoE).
- **Container:** must use NGC `nvcr.io/nvidia/vllm:26.03.post1-py3`; never upstream PyPI vLLM (SM121 kernel failures).
- **Quantization:** FP8 only on DGX Spark; NVFP4 is slower than FP16 on GB10 UMA (-23.6% at 32K context) and ModelOpt 0.42.0 has a NaN bug.
- **No Gemma-4-31B Dense:** bandwidth-bound at 6.9 tok/s; only the 26B MoE variant is practical.
- **Air-gap thesis:** the entire stack must run with the network cable pulled; verified in CI.

### TODOs / Blockers

- None at this time. Awaiting `/gsd-plan-phase 1` to begin execution.

### Open Questions for Plan-Phase

Per research/SUMMARY.md "Research Flags" — questions that may need deeper research during plan-phase:

- **Phase 2:** Harness language choice (TypeScript directly on pi-mono SDK, or Python calling pi as subprocess) — affects observability bus implementation. Default lean per research: TypeScript.
- **Phase 4:** EAGLE-3 speculator availability for Gemma-4-26B-A4B specifically (RedHatAI publishes for 31B); Gemma 4 chat template handling for tool calls.
- **Phase 5:** SWE-bench Verified + mini-swe-agent API compatibility with vLLM 0.19.x; which SWE-bench-Lite subset is reproducible offline on Spark in a single eval run.
- **Phase 6:** Qwen3.6 MTP acceptance rates on coding workloads; whether two profiles can co-load on 128 GB UMA without container swaps.

Phases with standard patterns (skip research-phase per SUMMARY.md):

- **Phase 1:** stack already deeply researched; planning starts from STACK.md directly.
- **Phase 7:** publication is process work, not technical research.

---

## Session Continuity

**Current position:** Phase 1 — two gap-closure plans in flight (both blocked on DGX Spark operator):

- **Plan 01-06 (SC-1 throughput):** Task 1 COMPLETE on-machine; Task 2 PENDING (DGX Spark sweep, ~60-90 min GPU)
- **Plan 01-07 (SC-5 sampler + reproducibility):** Task 1 COMPLETE on-machine (GpuSampler `[N/A]` per-field fix, 7 tests GREEN, commits `4214b71` + `b510d1b`); Tasks 2 + 3 PENDING (two 2-hour thermal replays on DGX Spark)

**Plan 01-06 Task 2 resume signal (from 01-06-PLAN.md):** Type `"sc1 resolved"` once the operator has (a) executed the sweep producing `runs/*-phase1-sc1-throughput-sweep/results.json` with 5 candidate entries + decision field, (b) rewritten PROFILE_NOTES.md §"SC-1 throughput gap" per Template A (winner) or Template B (accept-architectural), (c) if winner, applied the knob to serving.yaml, (d) recomputed profile.yaml.hash + confirmed `emmy profile validate` exits 0, (e) committed, and (f) `uv run pytest tests/unit -q` is all-green. See `.planning/phases/01-serving-foundation-profile-schema/01-06-SUMMARY.md` for the full runbook.

**Plan 01-07 Task 2 resume signal (from 01-07-PLAN.md):** Type `"sc5 floors recorded"` once the operator has (a) confirmed `uv run pytest tests/unit/test_thermal_sampler.py -x -q` is 7/7 GREEN on the DGX Spark, (b) completed the second 2-hour `--record-floors` replay with exit 0, (c) confirmed `PROFILE_NOTES.md measured_values.gpu_clock_p5/p50_hour2_mhz` are both non-zero and within 500-5000 MHz, (d) extended `validation_runs` to ≥2 entries, (e) confirmed `uv run emmy profile validate` exits 0, (f) committed the feat. See `.planning/phases/01-serving-foundation-profile-schema/01-07-SUMMARY.md` for the full runbook.

**Plan 01-07 Task 3 resume signal (depends on Task 2 being complete first):** Type `"sc5 reproducibility green"` once the third 2-hour `--assert-floors` replay exits 0 with "All floors pass", `validation_runs` has ≥3 entries, `emmy profile validate` exits 0, and the feat commit lands.

**Plan 01-08 Task 3 resume signal:** Type `"sc4 certified"` once the operator has (a) registered the self-hosted DGX Spark runner with label `dgx-spark` per `docs/ci-runner.md` §1-§7, (b) run `./scripts/trigger_airgap_ci.sh` from a feature branch (not main) and observed the PR create, (c) both `profile-hash-integrity` AND `airgap-replay` jobs on the PR completed GREEN, (d) `./scripts/verify_airgap_ci.sh` exited 0 with the "airgap-report OK: passes=True, 4 layers green, failures=[]" summary, (e) the airgap-report.json artifact has been committed under `.planning/phases/01-serving-foundation-profile-schema/evidence/airgap-report-sc4-certification.json`, and (f) `uv run pytest tests/unit -q` is all-green. See `.planning/phases/01-serving-foundation-profile-schema/01-08-SUMMARY.md` and `docs/airgap-green-run.md` for the full runbook.

**Next action (operator):** `/gsd-execute-phase 1` with whichever of the four resume signals arrives first. Three of the DGX Spark tasks can be serialised in any order (01-06 Task 2, 01-07 Task 2, 01-08 Task 3 are independent); 01-07 Task 3 must follow 01-07 Task 2. 01-08 Task 3 is the lowest-GPU-cost of the four (~5-10 min CI time vs. 2-hour thermal replays) and is a reasonable first action after runner registration.

**Resume signal:** STATE.md current focus + ROADMAP.md Phase 1 success criteria together fully specify what "Phase 1 done" means. Plans must satisfy success criteria 1–5 of Phase 1 to advance. SC-1 closure gates Plan 01-06; SC-5 closure (sampler + reproducibility) gates Plan 01-07.

---

*State initialized: 2026-04-20 by roadmapper*

**Planned Phase:** 2 (Pi-Harness MVP — Daily-Driver Baseline) — 8 plans — 2026-04-21T20:45:37.014Z

**Plan 01-06 Task 1 completed:** 2026-04-21 — commits `feea40c` (RED) + `742fd9b` (GREEN); SUMMARY.md written; awaiting DGX Spark operator for Task 2.

**Plan 01-07 Task 1 completed:** 2026-04-21T16:40:09Z — commits `4214b71` (RED) + `b510d1b` (GREEN); SUMMARY.md written at `.planning/phases/01-serving-foundation-profile-schema/01-07-SUMMARY.md`; GpuSampler now tolerates nvidia-smi `[N/A]` per-field (DGX Spark UMA case). 7/7 sampler tests GREEN, 124/124 unit suite GREEN (1 skip for missing shellcheck), `uv run emmy profile validate` exits 0. Awaiting DGX Spark operator for Task 2 (second 2-hour `--record-floors` replay) and Task 3 (third 2-hour `--assert-floors` replay).

**Plan 01-08 Tasks 1 + 2 completed:** 2026-04-21 — commits `93fab55` (test-RED) + `78ff0be` (feat-GREEN) + `3889724` (docs); SUMMARY.md written at `.planning/phases/01-serving-foundation-profile-schema/01-08-SUMMARY.md`. SC-4 certification machinery shipped: `emmy_serve/airgap/ci_verify.py` validator + `scripts/trigger_airgap_ci.sh` + `scripts/verify_airgap_ci.sh` + 2 golden fixtures + 13 unit tests + `docs/airgap-green-run.md` runbook + `docs/ci-runner.md` §8. 137/137 unit suite GREEN (1 skip for missing shellcheck), `uv run emmy profile validate` exits 0. Awaiting DGX Spark operator for Task 3 (register runner + trigger CI + verify + commit evidence; ~5-10 min of CI time).

**Plan 02-01 completed:** 2026-04-21T21:41Z — commits `4fa82ac` (Task 1 feat: workspace + four package shells + pi-emmy shim) + `ae97e04` (Task 2 feat: v1→v2 profile clone + docs templates). SUMMARY.md at `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-01-SUMMARY.md`. Bun 1.3.13 installed during pre-flight (Rule 3 deviation: host prereq), `bun-types 1.1.42` added to workspace devDeps (Rule 3: missing types dep blocked typecheck), `bun.lock` (text, Bun 1.3 default) committed in place of legacy `bun.lockb` (Rule 3: tool format drift — reproducibility spirit preserved). All four `@emmy/*` typecheck GREEN, `pi-emmy` shim on PATH prints wave-0 message + exits 0, `profiles/qwen3.6-35b-a3b/v2/` byte-for-byte clone of v1 (9-line diff in profile.yaml only). Phase 1 guardrails held: `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0, `uv run pytest tests/unit -q` → 137 passed / 1 skipped. **Next (Wave 1):** Plans 02-02 + 02-03 + 02-06 can run in parallel.
