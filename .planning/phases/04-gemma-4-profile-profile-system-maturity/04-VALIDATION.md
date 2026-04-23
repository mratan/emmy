---
phase: 4
slug: gemma-4-profile-profile-system-maturity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Planner fills per-task rows after plans are written; this file bootstrapped from 04-RESEARCH.md §6.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (Python side) + bun test / vitest (TS side) — both already in use Phase 1–3 |
| **Config file** | `pyproject.toml` + `packages/*/tsconfig.json` + each package's `package.json` test scripts |
| **Quick run command** | `uv run pytest tests/unit -q && bun test` |
| **Full suite command** | `uv run pytest -q && bun test && bun run typecheck && uv run emmy profile validate profiles/*/v*/` |
| **Estimated runtime** | ~45-90 seconds quick; ~3-5 minutes full (excludes operator-gated DGX Spark runs — KV bisection + 2-hour thermal — which resume via signal) |

---

## Sampling Rate

- **After every task commit:** Run quick command (unit tests relevant to changed packages)
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green + four-way regression (bun test / typecheck / pytest / profile validate) per Phase 2 close precedent
- **Max feedback latency:** ~90 seconds (quick path); ~5 minutes (full suite); operator-gated DGX Spark runs deferred to resume signals per Phase 1 D-15 pattern

---

## Per-Task Verification Map

> Planner populates this table per plan / task after writing PLAN.md files. Bootstrap skeleton shows the three Nyquist dimensions from 04-RESEARCH.md §6.3.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *TBD — planner to fill* | *TBD* | *TBD* | SERVE-03 | *TBD* | Gemma 4 bundle validates + air-gap CI green | unit + e2e | `uv run emmy profile validate profiles/gemma-4-26b-a4b-it/v1/` | ❌ W0 | ⬜ pending |
| *TBD* | *TBD* | *TBD* | PROFILE-07 | *TBD* | Both profiles pass boot smoke test (SP_OK + tool-call parse) | integration | `scripts/smoke_test.py --profile ...` | ✅ (reuse) | ⬜ pending |
| *TBD* | *TBD* | *TBD* | PROFILE-08 | *TBD* | Swap primitive pre-flight validates / stops / starts / rolls back | integration | `uv run pytest tests/integration/test_swap.py` | ❌ W0 | ⬜ pending |
| *TBD* | *TBD* | *TBD* | HARNESS-08 | *TBD* | routes.yaml + within-model variant resolution; role in OTel span | unit + span assertion | `bun test packages/emmy-ux/tests/routes.test.ts + packages/emmy-telemetry/test/variant-span.test.ts` | ❌ W0 | ⬜ pending |
| *TBD* | *TBD* | *TBD* | UX-04 | *TBD* | Four progress phases fire verbatim; error surface on fail | integration | `bun test packages/emmy-ux/tests/profile-swap-ux.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Bootstrapped from 04-RESEARCH.md §6.4. Planner refines per-plan but these must exist before Wave 1 GREEN tasks begin.

- [ ] `profiles/gemma-4-26b-a4b-it/v1/` scaffold (bundle dir + `.gitkeep` files where needed) — enables REQ-SERVE-03 validator test to fail usefully
- [ ] `tests/integration/test_swap.py` — stubs for the swap primitive's three paths (pre-flight fail / success / post-stop rollback)
- [ ] `tests/unit/test_no_model_conditionals.py` + TS analog — stubs with a deliberate-positive fixture (confirms the audit catches what it should, then removes fixture and runs clean)
- [ ] `packages/emmy-ux/tests/profile-swap-ux.test.ts` — stubs for four-phase progress sequence
- [ ] `packages/emmy-ux/tests/routes.test.ts` — stubs for routes.yaml + variant resolution
- [ ] `packages/emmy-telemetry/test/variant-span.test.ts` — stubs asserting `emmy.profile.variant` + `emmy.role` OTel attributes on every turn span
- [ ] `profiles/routes.yaml` (may be empty or default-only at Wave 0, populated at Wave 1)
- [ ] Operator-gated scripts (reused): `scripts/find_kv_budget.py` + `scripts/thermal_replay.py` — no new install, confirm they accept a non-Qwen profile path

---

## Manual-Only Verifications

Operator-gated items follow the Phase 1 deferral pattern (D-15) — measured first, then the measured floor is asserted on re-runs by CI. SC walkthroughs follow the Phase 2 SC-1 walkthrough pattern (one human-driven end-to-end session with evidence captured to `runs/phase4-sc*/`).

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gemma 4 KV budget finder run | SERVE-03 + SERVE-08 | Operator-gated DGX Spark GPU time (~30-60 min) | `uv run python scripts/find_kv_budget.py --profile profiles/gemma-4-26b-a4b-it/v1/`; write `gpu_memory_utilization` into `serving.yaml`; commit. Resume signal: `"p4 kv green"` |
| Gemma 4 2-hour thermal replay (measure-then-assert) | SERVE-03 + SERVE-09 | Operator-gated DGX Spark GPU time (~2 hours) | `uv run python scripts/thermal_replay.py --profile profiles/gemma-4-26b-a4b-it/v1/ --record-floors`; write floors into `PROFILE_NOTES.md`. Second run: `--assert-floors`. Resume signals: `"p4 thermal floors recorded"` / `"p4 thermal green"` |
| SC-1 `/profile` swap walkthrough (Qwen3.6 → Gemma 4 → Qwen3.6) | PROFILE-08 + UX-04 | Human verifies four progress phases render, session resumes, error surface on deliberate-break | Author runs `pi-emmy` on clean repo, types `/profile gemma-4-26b-a4b-it`, observes four progress phases, completes a turn against Gemma 4, types `/profile qwen3.6-35b-a3b`, swaps back. Evidence: `runs/phase4-sc1/walkthrough.md` + `runs/phase4-sc1/transcript.json` |
| SC-4 swap failure walkthrough (corrupted weights / bad digest) | PROFILE-08 | Human verifies rollback semantics end-to-end | Operator temporarily mis-sets `engine.container_image_digest` in Gemma 4 bundle, triggers `/profile`, observes pre-flight fail with no engine stop. Then temp-corrupts a weight file, triggers swap, observes post-stop rollback to Qwen3.6. Evidence: `runs/phase4-sc4/walkthrough.md` |
| SC-3 role-routing walkthrough (within-model variants) | HARNESS-08 | Human verifies OTel spans carry variant + role fields across a mixed plan/edit/critic session | Author runs a multi-turn session with `routes.yaml` wired to three Qwen variants; inspects Langfuse / JSONL sink for `emmy.profile.variant` + `emmy.role` fields. Evidence: `runs/phase4-sc3/report.json` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s (quick) / 5min (full)
- [ ] Operator-gated items have resume signals registered in STATE.md per Phase 1 precedent
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (planner fills after PLAN.md files are written and the table is populated)
