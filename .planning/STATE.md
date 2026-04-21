---
gsd_state_version: 1.0
milestone: v0.68.0
milestone_name: milestone
status: executing
last_updated: "2026-04-21T17:05:00.000Z"
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 8
  completed_plans: 5
  percent: 63
  in_progress_plan: "01-06"
  in_progress_task: "Task 2 (checkpoint:human-verify — DGX Spark ~60-90 min GPU)"
---

# State: Emmy

**Last updated:** 2026-04-20
**Updated by:** roadmapper (initial creation)

---

## Project Reference

**Project:** Emmy — fully-local coding agent on NVIDIA DGX Spark
**Core Value:** A local coding agent good enough to be the author's daily driver, structured rigorously enough to be a public research artifact others can reproduce — with no cloud dependency anywhere in the loop.
**Current Focus:** Phase --phase — 01

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

Phase: --phase (01) — EXECUTING
Plan: 1 of --name
**Phase:** 1 — Serving Foundation + Profile Schema
**Plan:** Not yet planned (next: `/gsd-plan-phase 1`)
**Status:** Executing Phase --phase
**Phase Progress:** 0% (0/0 plans complete)

```
Phases: [▢][▢][▢][▢][▢][▢][▢]   0/7 phases complete
Current: Phase 1 (planning pending)
```

**Daily-driver bar:** end of Phase 2
**Research-artifact bar:** end of Phase 5
**Public artifact bar:** end of Phase 7

---

## Performance Metrics

(populated after first plan executes)

| Metric | Value |
|--------|-------|
| Phases complete | 0 / 7 |
| v1 requirements complete | 0 / 66 |
| Critical pitfalls addressed | 0 / 8 |
| Daily-driver readiness | Not yet |
| Research-artifact readiness | Not yet |

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

**Current position:** Phase 1, Plan 01-06 (SC-1 throughput gap closure) — Task 1 COMPLETE (on-machine), Task 2 PENDING (DGX Spark checkpoint, ~60-90 min GPU).

**Plan 01-06 Task 2 resume signal (from 01-06-PLAN.md):** Type `"sc1 resolved"` once the operator has (a) executed the sweep producing `runs/*-phase1-sc1-throughput-sweep/results.json` with 5 candidate entries + decision field, (b) rewritten PROFILE_NOTES.md §"SC-1 throughput gap" per Template A (winner) or Template B (accept-architectural), (c) if winner, applied the knob to serving.yaml, (d) recomputed profile.yaml.hash + confirmed `emmy profile validate` exits 0, (e) committed, and (f) `uv run pytest tests/unit -q` is all-green. See `.planning/phases/01-serving-foundation-profile-schema/01-06-SUMMARY.md` for the full runbook.

**Next action (operator):** `/gsd-execute-phase 1` with the `sc1 resolved` signal to continue Plan 01-06 Task 2 AND/OR proceed to Plan 01-07 (SC-4 self-hosted runner registration) + Plan 01-08 (SC-5 second thermal replay + clock sampler fix).

**Resume signal:** STATE.md current focus + ROADMAP.md Phase 1 success criteria together fully specify what "Phase 1 done" means. Plans must satisfy success criteria 1–5 of Phase 1 to advance. SC-1 closure is the gate for Plan 01-06.

---

*State initialized: 2026-04-20 by roadmapper*

**Planned Phase:** 1 (Serving Foundation + Profile Schema) — 5 plans — 2026-04-21T02:23:42.515Z

**Plan 01-06 Task 1 completed:** 2026-04-21 — commits `feea40c` (RED) + `742fd9b` (GREEN); SUMMARY.md written; awaiting DGX Spark operator for Task 2.
