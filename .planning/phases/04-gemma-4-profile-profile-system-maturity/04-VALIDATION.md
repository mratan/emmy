---
phase: 4
slug: gemma-4-profile-profile-system-maturity
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-23
updated: 2026-04-23
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated from 6 PLAN.md files (04-01 through 04-06) after planning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (Python) + bun test (TS) — both already in use Phase 1–3 |
| **Config file** | `pyproject.toml` + `packages/*/tsconfig.json` + each package's `package.json` test scripts |
| **Quick run command** | `uv run pytest tests/unit -q && bun test` |
| **Full suite command** | `uv run pytest -q && bun test && bun run typecheck && uv run emmy profile validate profiles/*/v*/` |
| **Estimated runtime** | ~45–90 s quick; ~3–5 min full (excludes operator-gated DGX Spark runs — KV bisection ~30–60 min + 2-hour thermal — which resume via signal) |

---

## Sampling Rate

- **After every task commit:** Run quick command (unit tests relevant to changed packages)
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green + four-way regression (bun test / typecheck / pytest / profile validate) per Phase 2 close precedent
- **Max feedback latency:** ~90 seconds (quick path); ~5 minutes (full suite); operator-gated DGX Spark runs deferred to resume signals per Phase 1 D-15 pattern

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T04-01-1 | 04-01 | 1 | SERVE-03, PROFILE-07 | T-04-01-02, T-04-01-05 | Schema extension accepts reasoning_parser; Qwen v3.1 still validates | unit | `uv run pytest tests/unit/test_profile_schema_gemma4.py::test_engine_accepts_reasoning_parser_gemma4 tests/unit/test_profile_schema_gemma4.py::test_engine_reasoning_parser_optional_qwen_v3_1_still_validates -x` | ❌ W0 (file created by T04-01-1) | ⬜ pending |
| T04-01-2 | 04-01 | 1 | SERVE-03, PROFILE-07 | T-04-01-01, T-04-01-02, T-04-01-03, T-04-01-05 | Gemma 4 v1 bundle validates + hash stamped + PROFILE_NOTES cites community sources per SC-5 | unit + validator | `uv run emmy profile validate profiles/gemma-4-26b-a4b-it/v1/ && uv run pytest tests/unit/test_profile_schema_gemma4.py -x` | ❌ created by this task | ⬜ pending |
| T04-02-1 | 04-02 | 1 | PROFILE-08 | T-04-02-01 | Preflight catches schema/hash/image/render failures; never issues destructive docker commands | unit (monkeypatched subprocess) | `uv run pytest tests/unit/test_swap_preflight_fail.py -x` | ❌ W0 | ⬜ pending |
| T04-02-2 | 04-02 | 1 | PROFILE-08 | T-04-02-02, T-04-02-04 | Orchestrator emits 4 progress phases verbatim; post-stop failure triggers rollback; rollback has no_rollback=True flag preventing recursion; CLI subcommand registered | unit + integration (mocked docker) | `uv run pytest tests/unit/test_swap_rollback.py tests/integration/test_swap.py -x` | ❌ W0 | ⬜ pending |
| T04-03-1 | 04-03 | 2 | PROFILE-08, UX-04 | T-04-03-04 | runSwapAndStreamProgress parses JSON lines; onProgress fires per phase; scanProfileIndex enumerates variants + skips routes.yaml; partial-chunk reassembly works | unit | `cd packages/emmy-ux && bun test profile-swap-runner.test.ts progress-phases.test.ts profile-index.test.ts` | ❌ W0 | ⬜ pending |
| T04-03-2 | 04-03 | 2 | PROFILE-08, UX-04 | T-04-03-01, T-04-03-02, T-04-03-03 | /profile registered; D-06 in-flight guard; all exit codes (0/5/6/other) surface distinct notify; reloadHarnessProfile called only on exit 0 | unit + integration | `cd packages/emmy-ux && bun test profile-command.test.ts profile-command.integration.test.ts swap-error-ui.test.ts && bun run typecheck` | ❌ W0 | ⬜ pending |
| T04-04-1 | 04-04 | 3 | HARNESS-08 | T-04-04-01, T-04-04-02 | 3 Qwen sibling variants validate; engine byte-identical; unique content hashes; routes.yaml parseable | unit (Python) | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v3.1-default/ && uv run emmy profile validate profiles/qwen3.6-35b-a3b/v3.1-reason/ && uv run emmy profile validate profiles/qwen3.6-35b-a3b/v3.1-precise/ && uv run pytest tests/unit/test_variant_engine_byte_identity.py -x` | ❌ W0 | ⬜ pending |
| T04-04-2 | 04-04 | 3 | HARNESS-08 | T-04-04-03, T-04-04-05 | routes-loader parses/errors correctly; before-request hook applies variant sampling; OTel span carries variant+role attrs; absent when no turn context | unit (TS) | `cd packages/emmy-ux && bun test routes-loader.test.ts && cd ../emmy-provider && bun test variant-sampling.test.ts && cd ../emmy-telemetry && bun test variant-stamp.test.ts variant-stamp-absent.test.ts` | ❌ W0 | ⬜ pending |
| T04-05-1 | 04-05 | 2 | (cross-cutting SC-2) | T-04-05-01 | Python audit: self-test catches deliberate fixture; real-mode scans emmy_serve/ + tests/ for zero hits | unit | `uv run pytest tests/unit/test_no_model_conditionals.py -xvs` | ❌ W0 | ⬜ pending |
| T04-05-2 | 04-05 | 2 | (cross-cutting SC-2) | T-04-05-01 | TS audit: self-test catches fixture; real-mode scans packages/*/src for zero hits | unit | `cd packages/emmy-ux && bun test no-model-conditionals.test.ts` | ❌ W0 | ⬜ pending |
| T04-06-1 | 04-06 | 4 | SERVE-03 | T-04-06-01 | Gemma 4 KV budget measured + committed to serving.yaml + PROFILE_NOTES measured_values frontmatter | operator + validator | `uv run emmy profile validate profiles/gemma-4-26b-a4b-it/v1/` (after Task 1) + resume signal `"p4 kv green"` | n/a (operator) | ⬜ pending |
| T04-06-2 | 04-06 | 4 | SERVE-03 | T-04-06-01 | 2-hour thermal replay record + re-assert both green; measured floors in PROFILE_NOTES frontmatter | operator + validator | `uv run python scripts/thermal_replay.py --profile profiles/gemma-4-26b-a4b-it/v1/ --assert-floors` exits 0 + resume signals `"p4 thermal floors recorded"` → `"p4 thermal green"` | n/a (operator) | ⬜ pending |
| T04-06-3 | 04-06 | 4 | PROFILE-08, UX-04 | T-04-06-02 | SC-1 /profile swap walkthrough on DGX Spark; 4 progress phases verbatim; round-trip Qwen↔Gemma | operator UAT | Evidence at `runs/phase4-sc1/walkthrough.md` with verdict `sc1 phase4 green` + resume signal | n/a (operator) | ⬜ pending |
| T04-06-4 | 04-06 | 4 | HARNESS-08, PROFILE-08 | T-04-06-02, T-04-06-03 | SC-3 role-routing walkthrough (5 turns across 3 variants with emmy.profile.variant + emmy.role stamped) + SC-4 failure/rollback walkthrough (exit 5 pre-flight + exit 6 rollback both observed) | operator UAT | Evidence at `runs/phase4-sc3/walkthrough.md` + `runs/phase4-sc4/walkthrough.md` with verdicts | n/a (operator) | ⬜ pending |
| T04-06-5 | 04-06 | 4 | SERVE-03, PROFILE-07, PROFILE-08, HARNESS-08, UX-04 | — | CLOSEOUT.md + REQUIREMENTS traceability + ROADMAP + STATE advance + docs/runbook.md extended | unit + validator | `test -f .planning/phases/04-gemma-4-profile-profile-system-maturity/04-CLOSEOUT.md && uv run pytest -x && bun test && bun run typecheck` | ❌ created by this task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Derived from Tasks' `<files>` and `<read_first>` blocks. Each MUST exist before the corresponding Wave 1/2 GREEN task runs; most are self-scaffolding (the task creates the file as it goes).

- [ ] `profiles/gemma-4-26b-a4b-it/v1/` directory + subdirs (Plan 04-01 Task 2 creates)
- [ ] `tests/unit/test_profile_schema_gemma4.py` (Plan 04-01 Task 1 creates with RED-then-GREEN tests)
- [ ] `tests/integration/test_swap.py` + `tests/unit/test_swap_preflight_fail.py` + `tests/unit/test_swap_rollback.py` (Plan 04-02 creates with RED stubs first; GREEN after orchestrator.py is authored)
- [ ] `packages/emmy-ux/test/profile-swap-runner.test.ts` + `progress-phases.test.ts` + `profile-index.test.ts` (Plan 04-03 Task 1)
- [ ] `packages/emmy-ux/test/profile-command.test.ts` + `profile-command.integration.test.ts` + `swap-error-ui.test.ts` (Plan 04-03 Task 2)
- [ ] `profiles/routes.yaml` + 3 sibling Qwen variant bundles (Plan 04-04 Task 1)
- [ ] `tests/unit/test_variant_engine_byte_identity.py` (Plan 04-04 Task 1)
- [ ] `packages/emmy-ux/test/routes-loader.test.ts` + `packages/emmy-provider/test/variant-sampling.test.ts` + `packages/emmy-telemetry/test/variant-stamp.test.ts` + `variant-stamp-absent.test.ts` (Plan 04-04 Task 2)
- [ ] `tests/unit/test_no_model_conditionals.py` + `tests/fixtures/no_model_conditionals_positive.py` (Plan 04-05 Task 1)
- [ ] `packages/emmy-ux/test/no-model-conditionals.test.ts` + `packages/emmy-ux/test/fixtures/no-model-conditionals-positive.ts` (Plan 04-05 Task 2)
- [ ] Operator-gated scripts (reused from Phase 1; no install): `scripts/find_kv_budget.py` + `scripts/thermal_replay.py` accept `--profile profiles/gemma-4-26b-a4b-it/v1/` without code changes (Plan 04-06 Tasks 1-2).

---

## Manual-Only Verifications

Operator-gated items follow the Phase 1 D-15 deferral pattern (measured first; measured floor asserted on re-runs). SC walkthroughs follow the Phase 2 SC-1 walkthrough pattern (human-driven end-to-end session with committed evidence).

| Behavior | Requirement | Why Manual | Test Instructions | Resume Signal |
|----------|-------------|------------|-------------------|---------------|
| Gemma 4 KV budget finder run | SERVE-03 + SERVE-08 | Operator-gated DGX Spark GPU time (~30–60 min) | `uv run python scripts/find_kv_budget.py --profile profiles/gemma-4-26b-a4b-it/v1/ --start 0.55 --step 0.02 --max 0.75`; commit measured value | `"p4 kv green"` |
| Gemma 4 2-hour thermal replay (measure-then-assert) | SERVE-03 + SERVE-09 | Operator-gated DGX Spark GPU time (~2 hrs) | First pass `scripts/thermal_replay.py --record-floors`; commit; then `--assert-floors` | `"p4 thermal floors recorded"` → `"p4 thermal green"` |
| SC-1 `/profile` swap walkthrough (Qwen↔Gemma 4) | PROFILE-08 + UX-04 | Human verifies 4 progress phases render verbatim, session resumes; evidence to `runs/phase4-sc1/` | Author runs `pi-emmy`, types `/profile gemma-4-26b-a4b-it`, observes phases, completes turn, swaps back | `"sc1 phase4 green"` |
| SC-3 role-routing walkthrough (within-model variants) | HARNESS-08 | Human verifies OTel spans carry `emmy.profile.variant` + `emmy.role` across a mixed plan/edit/default/critic session | 5 turns hitting all 3 variants; evidence to `runs/phase4-sc3/report.json` | `"sc3 phase4 green"` |
| SC-4 swap failure walkthrough (pre-flight fail + rollback) | PROFILE-08 | Human verifies D-04 contract end-to-end: exit 5 leaves prior engine alive; exit 6 executes rollback; evidence to `runs/phase4-sc4/` | Deliberate-break in two stages (bad digest for pre-flight; oversized max_model_len for post-stop); each followed by restore | `"sc4 phase4 green"` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies identified
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every plan has at least one automated test before operator checkpoint)
- [x] Wave 0 covers all MISSING references (the schema field + every test file + every fixture listed)
- [x] No watch-mode flags
- [x] Feedback latency < 90 s (quick) / 5 min (full)
- [x] Operator-gated items have resume signals registered in STATE.md per Phase 1 precedent (4 signals: p4 kv green, p4 thermal green, sc1/sc3/sc4 phase4 green)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner (2026-04-23) — pending operator verification in Plan 04-06 + any checker-raised revisions.
