---
phase: 01-serving-foundation-profile-schema
plan: 08
subsystem: infra
tags: [airgap, ci, sc-4, gap-closure, github-actions, self-hosted-runner, gh-cli, bash, operator-runbook, tdd]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: "Plan 01-05 .github/workflows/airgap.yml + airgap-report artifact shape (emmy_serve.airgap.validator._dump_report) + docs/ci-runner.md §1-§7 runner registration + air_gap/README.md path-filter target; Plan 01-02 emmy_serve.profile validator (used by profile-hash-integrity ubuntu-latest job)"
provides:
  - "emmy_serve/airgap/ci_verify.py — validate_airgap_report(report) classifier + main() CLI (exit 0/1/2)"
  - "scripts/trigger_airgap_ci.sh — operator trigger (clean-tree + non-main guards; touches air_gap/README.md only)"
  - "scripts/verify_airgap_ci.sh — operator verifier (gh auto-download OR --from-file fallback)"
  - "tests/fixtures/airgap_green.json + airgap_red_layer_a.json — golden fixtures for unit tests"
  - "tests/unit/test_airgap_ci_scripts.py — 13 unit tests pinning validator + script contracts"
  - "docs/airgap-green-run.md — operator runbook (prerequisite + 5-step flow + 4-layer table + failure handbook)"
  - "docs/ci-runner.md §8 — Certification after registration — 4-step pointer to the runbook + re-certification trigger list"
affects:
  - "Phase 1 closeout — SC-4 / REPRO-03 / SERVE-09 flip from FAILED/PARTIAL to VERIFIED AFTER operator executes Task 3 (register runner + run scripts + commit evidence)"
  - "Phase 2 harness — any change touching emmy_serve/** or air_gap/** re-triggers airgap.yml per path filter; verify_airgap_ci.sh is the gate that certifies each green run"
  - "Phase 3 observability — airgap-report.json shape is stable (pinned by committed fixtures); future Langfuse ingestor can treat the artifact as a trace without shape drift"

# Tech tracking
tech-stack:
  added:
    - "gh CLI (GitHub CLI) — used by both operator scripts for workflow-run discovery + artifact download; documented fallback via `--from-file` when gh is unavailable"
  patterns:
    - "Operator-script pattern: bash entry point + Python validator module. The shell script owns I/O (gh download, file discovery); the Python module owns pure validation (validate_airgap_report) so the gate is unit-testable without GitHub."
    - "Golden-fixture pattern for artifact validators: committed green + red JSON fixtures pin the artifact shape. Changes to emmy_serve.airgap.validator._dump_report must either preserve the shape OR update both fixtures in a paired commit — fixture drift breaks the unit tests at author time, not at operator time."
    - "Pre-flight contract in operator scripts: trigger_airgap_ci.sh refuses on (a) dirty working tree, (b) branch == main. These are RUNTIME invariants encoded in the script, not soft-documented reminders. Matches the scripts/start_emmy.sh exit-code-4-on-prereq-missing idiom from Plan 01-03."

key-files:
  created:
    - "emmy_serve/airgap/ci_verify.py — 100-line validator module"
    - "scripts/trigger_airgap_ci.sh — 86-line bash trigger"
    - "scripts/verify_airgap_ci.sh — 75-line bash verifier"
    - "tests/fixtures/airgap_green.json — 4-layer green golden fixture"
    - "tests/fixtures/airgap_red_layer_a.json — layer (a) red golden fixture"
    - "tests/unit/test_airgap_ci_scripts.py — 13 unit tests"
    - "docs/airgap-green-run.md — 150-line operator runbook"
  modified:
    - "emmy_serve/airgap/__init__.py — export validate_airgap_report"
    - "docs/ci-runner.md — append §8 Certification after registration"

key-decisions:
  - "Validator is a pure Python function (validate_airgap_report) that takes a dict and returns (ok, reasons). The bash script's only job is I/O (gh download, file discovery, exit-code translation). This preserves unit-testability — the threat T-08-01 contradictory-report case is checked via a dict literal in the test file, no subprocess needed. Matches the §11 EVAL-07 pattern: logic lives in Python, scripts are thin shims."
  - "Threat T-08-01 (tampered passes=true with layer failure) is treated as a first-class test case. The validator does NOT short-circuit on `passes=true` — it independently verifies every layer. A report with passes=true but layer (a).passed=false still fails validation. Test test_validate_airgap_report_passes_true_but_layer_failed pins this invariant."
  - "Trigger script touches air_gap/README.md (not session.jsonl). Rationale: session.jsonl is declared immutable per Plan 01-05's schema contract; README.md is in the workflow's path filters AND has no downstream test dependency on its content. Test test_trigger_script_touches_workflow_path_filter asserts session.jsonl is NOT in the script to prevent future drift."
  - "verify_airgap_ci.sh supports two modes: gh auto-download (default) and --from-file manual fallback. Rationale: the DGX Spark operator has `gh` installed, but a CI host or air-gapped audit environment may not; the --from-file path lets any operator point the validator at a manually-downloaded JSON. This is threat T-08-03 mitigation (spoofing): in gh mode, the script downloads from the current branch's LATEST run — cannot substitute a different file unless --from-file is explicitly used."
  - "RuntimeWarning on `python3 -m emmy_serve.airgap.ci_verify` is accepted as cosmetic. The warning fires because emmy_serve.airgap.__init__.py imports ci_verify at package load, so the module is already in sys.modules before runpy executes it as __main__. Exit codes are correct; the warning is not visible in pytest captured output. Fixing it would require either removing the __init__.py export (which makes the Python-only unit tests uglier) or moving the CLI to a separate module — not worth the plumbing."

patterns-established:
  - "Gap-closure plan structure: (1) ship unit-testable machinery + golden fixtures + runbook; (2) return a human-action checkpoint for the operator-only step. The plan cannot register GitHub runners or execute server-side workflows, but it CAN make the operator's path a two-command sequence."
  - "Two-tier deviation-proof fixtures: a green fixture proves the happy path; a red fixture proves the error path; both are committed and both are exercised by unit tests. Future changes to the validator break the test at author time if they don't agree with the fixture shape."

requirements-completed: []
# Note: This plan SHIPS the certification machinery for SERVE-09 / REPRO-03, but
# those requirements flip to VERIFIED only after Task 3 (operator-executed) lands
# the first green-run evidence JSON. The requirements stay PARTIAL until that
# commit is on main.

# Metrics
duration: 15min
completed: 2026-04-21
---

# Phase 1 Plan 08: SC-4 Air-Gap CI Certification Machinery Summary

**SC-4 certification is now a two-script sequence: `trigger_airgap_ci.sh` pushes a PR that fires `.github/workflows/airgap.yml`; `verify_airgap_ci.sh` downloads the `airgap-report` artifact and gates on `passes=true` + all four D-12 layers green via the `emmy_serve.airgap.ci_verify` validator, which is independently unit-tested against golden JSON fixtures without hitting GitHub.**

## Performance

- **Duration:** ~15 min (Tasks 1 + 2; Task 3 is operator-only)
- **Started:** 2026-04-21 (session resumption)
- **Completed (Tasks 1-2):** 2026-04-21
- **Tasks committed on-machine:** 2 (Task 3 is the human-action checkpoint documented below)
- **Files created:** 7 (ci_verify.py + 2 fixtures + 1 test file + 2 bash scripts + 1 runbook)
- **Files modified:** 2 (emmy_serve/airgap/__init__.py export + docs/ci-runner.md §8)
- **Commits:** 3 (RED test, GREEN feat+fixtures+scripts, docs runbook+§8)

## Accomplishments

- **`emmy_serve/airgap/ci_verify.py` shipped.** 100-line validator module with `validate_airgap_report(report) -> (bool, list[str])` + `main(argv)` CLI. Exits 0 on green, 1 on red, 2 on file/JSON errors. Independently rejects contradictory reports (`passes=true` + any `layer.passed=false`) per threat T-08-01.
- **Operator scripts shipped.** `scripts/trigger_airgap_ci.sh` (86 lines, guards on dirty tree + main branch, appends timestamped marker to `air_gap/README.md`, commits + pushes + prints PR URL via `gh`). `scripts/verify_airgap_ci.sh` (75 lines, `gh run download --name airgap-report` by default OR `--from-file <path>` fallback, invokes `ci_verify.py`).
- **Golden fixtures committed.** `tests/fixtures/airgap_green.json` (4 layers pass, `passes=true`, `failures=[]`) and `tests/fixtures/airgap_red_layer_a.json` (layer (a) fail, layers b/c/d pass). Shape matches `emmy_serve.airgap.validator._dump_report` exactly — future drift breaks the unit tests at author time.
- **13 unit tests GREEN.** `tests/unit/test_airgap_ci_scripts.py` covers (a) validator classification against fixtures, (b) missing-layer rejection, (c) T-08-01 contradiction rejection, (d) main() CLI exit codes via `uv run python3 -m emmy_serve.airgap.ci_verify` subprocess, (e) script existence + executability + content contracts (guards + path-filter targets + gh fallback + clean-tree check).
- **Operator runbook shipped.** `docs/airgap-green-run.md` walks the full SC-4 certification flow (prerequisite + 5 steps + 4-layer table + 8-row failure mode handbook + CLAUDE.md pitfall #5 framing + cross-references). `docs/ci-runner.md` gained a new §8 "Certification after registration" pointing at the runbook + listing the 4 files whose change should trigger re-certification.
- **Zero regressions.** Full unit suite: 137 passed, 1 skipped (shellcheck absent). `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0. Profile bytes untouched.

## Task Commits

1. **Task 1 (RED): tests for airgap CI certification helpers** — `93fab55` (test)
2. **Task 1 (GREEN): airgap CI certification helpers + trigger/verify scripts** — `78ff0be` (feat)
3. **Task 2: airgap CI green-run runbook + ci-runner §8 certification** — `3889724` (docs)

_Task 3 is the human-action checkpoint — operator-only, no on-machine commit yet. See "Task 3 Pending Checkpoint" below._

## Files Created/Modified

### Task 1 RED (`93fab55`) — failing tests
- `tests/fixtures/airgap_green.json` — golden green artifact (4 layers pass, matches `_dump_report` shape)
- `tests/fixtures/airgap_red_layer_a.json` — red artifact (layer a fail)
- `tests/unit/test_airgap_ci_scripts.py` — 13 tests covering validator + scripts

### Task 1 GREEN (`78ff0be`) — validator + scripts
- `emmy_serve/airgap/ci_verify.py` — `validate_airgap_report` + `main` CLI
- `emmy_serve/airgap/__init__.py` — export `validate_airgap_report`
- `scripts/trigger_airgap_ci.sh` — operator trigger with pre-flight guards
- `scripts/verify_airgap_ci.sh` — operator verifier (gh auto / `--from-file` fallback)

### Task 2 (`3889724`) — docs
- `docs/airgap-green-run.md` — SC-4 certification runbook (new)
- `docs/ci-runner.md` — §8 "Certification after registration" appended

## Decisions Made

See the `key-decisions` block in frontmatter. Summary of the five load-bearing:

1. **Pure-Python validator, bash shim for I/O.** Mirrors the §11 EVAL-07 pattern: logic in Python (unit-testable), scripts thin. The `validate_airgap_report` function takes a dict and returns `(ok, reasons)` — no subprocess, no GitHub, testable on any machine.
2. **T-08-01 contradiction rejection.** Validator independently verifies every layer; a report with `passes=true` but any `layer.passed=false` still fails. Pinned by `test_validate_airgap_report_passes_true_but_layer_failed`.
3. **Trigger touches README.md, not session.jsonl.** Session.jsonl is immutable fixture; README.md is in path filters and has no downstream test dependency. Pinned by `test_trigger_script_touches_workflow_path_filter` asserting `session.jsonl NOT in script`.
4. **Two-mode verifier.** `gh` auto-download (default) or `--from-file <path>` (fallback). Covers both DGX Spark operator (gh installed) and air-gapped-audit operators (gh absent, manual artifact download). Also threat T-08-03 mitigation: gh mode downloads from current branch's LATEST run — cannot substitute without explicit `--from-file`.
5. **RuntimeWarning on `python3 -m ... ci_verify` is cosmetic.** Caused by `__init__.py` exporting the module; fixable only by uglier plumbing. Exit codes correct; pytest output clean. Accepted.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1/2/3/4 triggers fired during execution.

The plan's Task 1 behavior spec requested 11 tests; the final test file ships 13 (added `test_validate_airgap_report_passes_true_but_layer_failed` for T-08-01 threat coverage per the plan's own `<threat_model>` block, and `test_trigger_script_checks_clean_working_tree` to pin the pre-flight invariant that the plan's `<pitfall_discipline>` section called out). Both are additive, not substitutive — the original 11 are all present.

## Issues Encountered

None. Task 1 GREEN committed on first run; no debugging iterations. Task 2 docs written to plan spec; all acceptance-criteria greps passed on first check.

## Known Stubs

None. All shipped code is wired end-to-end. The only "stub" is the operator runbook's pointer to a not-yet-existing
`.planning/phases/01-serving-foundation-profile-schema/evidence/airgap-report-sc4-certification.json` — but that file is the **output** of Task 3 (operator), not a stub in this plan's code.

## Task 3 Pending Checkpoint (human-action, blocking)

Task 3 of `01-08-PLAN.md` is a human-verify/human-action checkpoint that CANNOT be automated from this executor:

1. **Operator registers the self-hosted GitHub Actions runner on the DGX Spark** per `docs/ci-runner.md` §1–§7. Requires `sudo useradd` + OAuth token from the GitHub UI — both outside this agent's authority.
2. **Operator runs `./scripts/trigger_airgap_ci.sh`** from a feature branch (not `main`). Script pushes a PR touching `air_gap/README.md`, which fires `.github/workflows/airgap.yml` on the registered runner.
3. **Operator waits for CI completion** (~5–10 min for `airgap-replay` on the self-hosted runner). Both `profile-hash-integrity` (ubuntu-latest, ~30s) and `airgap-replay` ([self-hosted, dgx-spark]) must be GREEN.
4. **Operator runs `./scripts/verify_airgap_ci.sh`**. Script downloads `airgap-report` via `gh run download`, invokes `emmy_serve.airgap.ci_verify`, exits 0 iff `passes=true` + all 4 D-12 layers green.
5. **Operator commits the evidence JSON** under `.planning/phases/01-serving-foundation-profile-schema/evidence/airgap-report-sc4-certification.json` per `docs/airgap-green-run.md` §5. That commit is the durable gate — it flips SC-4 / REPRO-03 / SERVE-09 from PARTIAL/FAILED to VERIFIED.

**Resume signal:** Type `"sc4 certified"` once steps 1–5 are complete AND `uv run pytest tests/unit -q` is still all-green on the DGX Spark.

## Re-certification Triggers

Per `docs/ci-runner.md` §8, re-run the certification flow whenever any of these change:

- `.github/workflows/airgap.yml` (workflow semantics)
- `scripts/start_emmy.sh` (boot path — `--airgap` wiring)
- `scripts/airgap_probe.py` / `emmy_serve/airgap/` (D-12 logic)
- `profiles/*/v*/serving.yaml.env` (telemetry / offline env vars)

The workflow's path filters already trigger on these; the operator certification (steps 1–5 above) is the durable gate that a PR changing any of these should carry before merge.

## Next Phase Readiness

- **Phase 1 closeout (`/gsd-verify-work` re-run) gated on:** Task 3 operator certification complete AND the two other open gap-closure tasks (01-06 Task 2 SC-1 throughput sweep; 01-07 Tasks 2+3 SC-5 thermal reproducibility) all landed.
- **No blockers for Phase 2 planning:** the certification scripts are self-contained; future plans that change emmy_serve/** or air_gap/** auto-retrigger the workflow via path filter, and the verify script gates every green run.
- **No blockers for Phase 3 observability:** the `airgap-report.json` shape is pinned by two committed fixtures. A Phase 3 Langfuse ingestor can safely treat the artifact as a stable trace schema without worrying about drift.

## Self-Check: PASSED

Verified against all plan acceptance criteria:

**Task 1:**
- `test -f /data/projects/emmy/emmy_serve/airgap/ci_verify.py` — FOUND
- `grep -q "def validate_airgap_report" emmy_serve/airgap/ci_verify.py` — FOUND
- `test -x /data/projects/emmy/scripts/trigger_airgap_ci.sh` — EXECUTABLE
- `test -x /data/projects/emmy/scripts/verify_airgap_ci.sh` — EXECUTABLE
- `test -f /data/projects/emmy/tests/fixtures/airgap_green.json` — FOUND
- `test -f /data/projects/emmy/tests/fixtures/airgap_red_layer_a.json` — FOUND
- `python3 -c "import json; d=json.load(open('tests/fixtures/airgap_green.json')); assert d['passes'] is True and len(d['layers']) == 4"` — exit 0
- `uv run python3 -m emmy_serve.airgap.ci_verify --from-file tests/fixtures/airgap_green.json` — exit 0, printed "airgap-report OK: passes=True, 4 layers green, failures=[]"
- `uv run python3 -m emmy_serve.airgap.ci_verify --from-file tests/fixtures/airgap_red_layer_a.json` — exit 1
- `grep -q "gh run download" scripts/verify_airgap_ci.sh` — FOUND
- `grep -q -- "--from-file" scripts/verify_airgap_ci.sh` — FOUND
- `grep -q "refusing to trigger from main" scripts/trigger_airgap_ci.sh` — FOUND
- `grep -q "air_gap/README.md" scripts/trigger_airgap_ci.sh` — FOUND
- `! grep -q "session.jsonl" scripts/trigger_airgap_ci.sh` — OK (not present)
- `uv run pytest tests/unit/test_airgap_ci_scripts.py -x` — 13/13 PASS
- `uv run pytest tests/unit -q` — 137 passed, 1 skipped (shellcheck absent); no regression
- Two atomic commits: `93fab55` (test) + `78ff0be` (feat) in git log

**Task 2:**
- `test -f /data/projects/emmy/docs/airgap-green-run.md` — FOUND
- `grep -q "SC-4 Certification" docs/airgap-green-run.md` — FOUND
- `grep -q "trigger_airgap_ci.sh" docs/airgap-green-run.md` — FOUND
- `grep -q "verify_airgap_ci.sh" docs/airgap-green-run.md` — FOUND
- `grep -q "4 layers green" docs/airgap-green-run.md` — FOUND
- `grep -q "Failure mode handbook" docs/airgap-green-run.md` — FOUND
- `grep -q "Certification after registration" docs/ci-runner.md` — FOUND
- `grep -q "verify_airgap_ci" docs/ci-runner.md` — FOUND
- One commit referencing docs: `3889724` — FOUND

**Commits verified in `git log`:**
- `93fab55` — `test(01-08): add tests for airgap CI certification helpers`
- `78ff0be` — `feat(01-08): airgap CI certification helpers + trigger/verify scripts`
- `3889724` — `docs(01-08): airgap CI green-run runbook + ci-runner §8 certification`

**No profile bytes touched:**
- `git diff 93fab55~1 3889724 -- profiles/` — empty (confirmed)
- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` — exit 0

**No workflow bytes touched:**
- `git diff 93fab55~1 3889724 -- .github/workflows/airgap.yml` — empty (Plan 01-05's workflow is immutable here per plan scope)

## TDD Gate Compliance

Plan 01-08 Task 1 is marked `tdd="true"`. Git log shows the gate sequence:

1. **RED gate:** `93fab55` — `test(01-08): ...` — RED test commit. Verified RED by running `uv run pytest tests/unit/test_airgap_ci_scripts.py -x -v` after RED commit: `FAILED ... ModuleNotFoundError: No module named 'emmy_serve.airgap.ci_verify'` (exit 1).
2. **GREEN gate:** `78ff0be` — `feat(01-08): ...` — GREEN implementation commit. Verified GREEN by re-running the same command after GREEN commit: 13/13 PASS.
3. **REFACTOR gate:** None required. Implementation was minimal on first pass; no refactoring.

RED and GREEN gate commits both present and properly sequenced.

---
*Phase: 01-serving-foundation-profile-schema*
*Plan: 08 (sc-4-airgap-ci-certification)*
*Tasks 1 + 2 completed: 2026-04-21 · Task 3 handed to DGX Spark operator*
