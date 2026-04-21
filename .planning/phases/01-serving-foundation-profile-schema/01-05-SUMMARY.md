---
phase: 01-serving-foundation-profile-schema
plan: 05
subsystem: infra
tags: [airgap, ci, self-hosted-runner, d-12, profile-immutability, github-actions, pre-commit-hook, session-replay]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: "Plan 01-01 test skeletons (test_session_jsonl.py, test_workflows.py); Plan 01-02 emmy_serve.profile (validator CLI + immutability gate); Plan 01-03 emmy_serve.canary.run_replay + scripts/start_emmy.sh --airgap; Plan 01-01 docs/ci-runner.md (self-hosted runner operator setup)"
provides:
  - "air_gap/session.jsonl — 50-turn deterministic replay fixture covering all 8 Phase-2 tool types (read/write/edit/bash/grep/find/ls/web_fetch) per 01-RESEARCH.md §10.3"
  - "air_gap/tool_registry.json — OpenAI-format 8-tool schema the replay hands to vLLM"
  - "air_gap/README.md — fixture provenance + pattern-mix table"
  - "emmy_serve/airgap/probe.py — D-12 four-layer probe helpers (layer_a_network_devices, layer_b_dns_audit, layer_c_telemetry_env, layer_d_hf_offline_env)"
  - "emmy_serve/airgap/validator.py — run_airgap_probe + AirGapReport + argparse CLI with pre-boot / post-boot subcommands"
  - "emmy_serve/airgap/__init__.py — public API re-exports"
  - "scripts/airgap_probe.py — executable CLI shim around the validator"
  - ".github/workflows/airgap.yml — two-job workflow (profile-hash-integrity on ubuntu-latest + airgap-replay on [self-hosted, dgx-spark])"
  - ".githooks/pre-commit — PROFILE-06 Layer 2 enforcement (invokes emmy profile validate on staged profile bundles)"
  - "docs/profile-immutability.md — 3-layer enforcement documentation + operator setup"
affects:
  - "Phase 1 closeout — SC-4 provable; once the self-hosted runner is registered per docs/ci-runner.md and the workflow runs green, REPRO-03 + SERVE-09 flip to GREEN"
  - "Phase 2 harness — 50-turn session fixture becomes the regression corpus; any Phase-2 change that touches emmy_serve.canary.replay re-triggers the airgap job automatically via path filter"
  - "Phase 3 observability — airgap CI emits runs/ci-airgap/airgap-report.json as workflow artifact; Phase 3 Langfuse ingestor treats one report per trace"

# Tech tracking
tech-stack:
  added:
    - "GitHub Actions self-hosted runner label `[self-hosted, dgx-spark]` — first workflow to target it (docs/ci-runner.md Plan 01-01 already registered the label as the contract)"
    - "astral-sh/setup-uv@v3 GitHub Action — for the profile-hash-integrity ubuntu-latest job"
    - "actions/upload-artifact@v4 — used to publish runs/ci-airgap/airgap-report.json from the self-hosted job"
  patterns:
    - "Two-job workflow with explicit `needs` dependency: profile-hash-integrity (cheap, no GPU) gates airgap-replay (expensive, self-hosted). A schema/hash regression on any PR fails within ~30s on a cloud runner before the self-hosted DGX Spark runner is ever consulted."
    - "Deterministic ephemeral generator pattern: the 50-turn fixture is hand-authored once via /tmp/gen_session.py (uncommitted); the generator's output is the committed artifact. Future fixture extensions follow the same pattern — generator is scratch; the JSONL file is the checked-in contract; test_session_jsonl.py is the schema."
    - "4-layer D-12 probe composed of independent `layer_*` functions that each return a `LayerResult`. Validator aggregates them into a single `AirGapReport` with a JSON-serializable report; individual layer failures are named in the `failures` list with the layer letter (a/b/c/d) — matches the 'any single layer failure fails the job with the layer identified' contract from 01-RESEARCH.md §10.4."
    - "3-layer profile-immutability enforcement: Layer 1 (validator, always on) + Layer 2 (pre-commit hook, developer-side, opt-in via `git config core.hooksPath .githooks`) + Layer 3 (CI hash-integrity job, server-side, cannot be bypassed with --no-verify)."

key-files:
  created:
    - "air_gap/session.jsonl — 50 turns, 8 tool types, 1 web_fetch mock marker"
    - "air_gap/tool_registry.json — 8-tool OpenAI-format schema"
    - "air_gap/README.md — fixture provenance + pattern-mix table"
    - "emmy_serve/airgap/__init__.py — public API"
    - "emmy_serve/airgap/probe.py — 4 layer_* helpers + LayerResult + subprocess wrapper"
    - "emmy_serve/airgap/validator.py — run_airgap_probe + AirGapReport + argparse main"
    - "scripts/airgap_probe.py — executable shim (chmod 755)"
    - ".github/workflows/airgap.yml — 2-job workflow (profile-hash-integrity + airgap-replay)"
    - ".githooks/pre-commit — PROFILE-06 Layer 2 (executable, chmod 755)"
    - "docs/profile-immutability.md — 3-layer enforcement + operator setup"
  modified: []

key-decisions:
  - "web_fetch tool-result turn prefixed with the literal comment `(mock — no network in air-gap)` at position 0 of content, so a reviewer grepping the fixture can instantly see the mock boundary. The test contract does not demand this marker (it checks tool-name coverage + turn count + required fields), but the reviewer contract does — the README + fixture together make it unambiguous that no outbound HTTP happens during web_fetch turns."
  - "Context-growing group (turns 43-50) uses 5 user + 3 assistant turns instead of 4 user + 4 assistant pairs. Rationale: test_session_jsonl.py::test_context_growing_turns_present asserts at least 5 user turns with turn >= 41; the plan-text pattern-mix table said '8 user turns' but the test is the contract (Plan-02 pattern: tests own the contract when plan prose and tests disagree). Two consecutive user turns at 45+46 model a realistic multi-question follow-up without requiring a scripted assistant reply between them."
  - "Pre-boot subcommand enforces the full 4-variable policy (VLLM_NO_USAGE_STATS + DO_NOT_TRACK + HF_HUB_OFFLINE + TRANSFORMERS_OFFLINE), not just the 2-variable cross-field policy that the profile immutability validator enforces. The immutability validator checks the 2 variables the schema's cross-field validator enforces (VLLM_NO_USAGE_STATS + HF_HUB_OFFLINE); pre-boot additionally enforces DO_NOT_TRACK + TRANSFORMERS_OFFLINE because those are required schema fields that can still be set to the wrong value ('0' or 'false'). Belt-and-suspenders."
  - "airgap-replay job executes `start_emmy.sh --airgap` rather than re-implementing docker run inline. Lets the workflow stay in lockstep with Plan 03's contract — any future change to boot semantics (e.g. a new AIRGAP env var) flows through the single start_emmy.sh file, not a per-workflow copy."
  - "Layer 3 CI job (profile-hash-integrity) runs on ubuntu-latest, NOT the self-hosted DGX Spark runner. Rationale: hash validation is pure-Python (no GPU), and running it on GH-hosted infra means it never competes with the self-hosted runner's single-job concurrency group. A schema/hash regression on ANY PR fails within ~30s on a cloud runner before the self-hosted runner is ever consulted."
  - "Phase A / Phase B split in the execution. The orchestrator deliberately stopped short of running the CI workflow because (1) the self-hosted runner registration is an operator step (per docs/ci-runner.md), (2) the running emmy-serve container on 127.0.0.1:8002 is owned by the orchestrator and must not be perturbed by our subprocesses, and (3) Task 4 is a human-verify checkpoint that lives outside this executor's automation scope. Phase B launch instructions below document the exact next steps."

patterns-established:
  - "D-12 layer-by-layer probe pattern: each layer is an independent function returning a LayerResult(layer, name, passed, detail, commands_run). Aggregator composes them into an AirGapReport. Reviewers can audit a single layer without reading the aggregator; CI can print the failure-layer letter directly."
  - "Two-job GitHub Actions workflow with `needs:` dependency: cheap gate (ubuntu-latest) before expensive gate (self-hosted). Keeps self-hosted runner utilization honest."
  - "Deterministic-fixture pattern: hand-authored generator lives in /tmp (ephemeral); committed artifact is the generator's output; test file is the schema contract. If a future plan needs to extend the fixture, write a new generator, assert against the existing test contract, commit only the artifact."

requirements-completed: []
# Note: This plan SHIPS the artifacts that satisfy SERVE-09 / REPRO-03 / REPRO-04
# / PROFILE-06, but the requirements flip to GREEN only after the Phase-B
# launch-checkpoint steps below are executed on the DGX Spark:
#   SERVE-09 / REPRO-03 → GREEN after airgap-replay job first passes on the
#     self-hosted runner (requires operator runner registration per
#     docs/ci-runner.md + a PR push that triggers the workflow)
#   REPRO-04 → GREEN after the operator runs
#     `uv run pytest tests/integration/test_offline_hf.py --run-integration`
#     against the mounted /data/hf-cache (or equivalent) on the Spark
#   PROFILE-06 → partial GREEN: Layer 1 already enforces; Layer 2 hook
#     activates only when the operator runs `git config core.hooksPath
#     .githooks`; Layer 3 enforces automatically once the workflow is live.
# The orchestrator should mark SERVE-09 / REPRO-03 / REPRO-04 complete after the
# Phase-B launch checkpoint green-lights the workflow.

# Metrics
duration: 6min
completed: 2026-04-21
---

# Phase 1 Plan 05: Air-Gap CI + 50-Turn Replay + 3-Layer Immutability Summary

**Air-gap thesis made provable: 50-turn deterministic replay fixture, D-12 four-layer validator, two-job GitHub Actions workflow gating on both a cloud hash-integrity job and a self-hosted DGX Spark `--network none` replay job, and Layer-2 pre-commit hook + Layer-3 CI enforcement documented in docs/profile-immutability.md. Phase A (code + tests + docs) complete and committed; Phase B (registered-runner CI run) handed to the operator.**

## Performance

- **Duration:** ~6 min (Tasks 1-3)
- **Started:** 2026-04-21T05:35:57Z
- **Completed (Tasks 1-3):** 2026-04-21T05:42:43Z
- **Tasks committed:** 3 (Task 4 is the Phase-B human-verify checkpoint — documented below, not executed)
- **Files created:** 10 (3 fixture + 4 validator + 3 CI/hook/docs)
- **Files modified:** 0
- **Commits:** 3 atomic

## Accomplishments

- **50-turn fixture shipped.** `air_gap/session.jsonl` covers all 8 Phase-2 tool types (read, write, edit, bash, grep, find, ls, web_fetch) in exactly 50 turns matching 01-RESEARCH.md §10.3's pattern-mix table. Test `tests/unit/test_session_jsonl.py` flipped from 5 SKIP to 5 PASS.
- **D-12 four-layer validator shipped.** `emmy_serve/airgap/validator.py` exposes `run_airgap_probe` + `AirGapReport` + a two-subcommand CLI (`pre-boot` / `post-boot`). Pre-boot validates serving.yaml's env policy without a running container (exits 0 today against the committed profile); post-boot runs the four D-12 layers against a running container and emits a JSON report.
- **CI workflow shipped.** `.github/workflows/airgap.yml` defines two jobs: `profile-hash-integrity` (ubuntu-latest, Layer 3 of PROFILE-06) and `airgap-replay` ([self-hosted, dgx-spark], SC-4). The self-hosted job chains pre-boot policy check → start_emmy.sh --airgap → post-boot 4-layer probe → 50-turn replay via docker exec → REPRO-04 offline-HF test, then uploads the airgap report as an artifact. Path filters cover every file that could silently break air-gap discipline. Test `tests/unit/test_workflows.py` flipped from 4 SKIP to 4 PASS.
- **Layer-2 pre-commit hook shipped.** `.githooks/pre-commit` invokes `emmy profile validate` on every bundle touched by staged changes. Dry-run verified: a 1-byte edit to `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` triggers exit 1 with the stored + computed hashes + the v2/ remediation path printed. Operator activates once via `git config core.hooksPath .githooks`.
- **3-layer immutability contract documented.** `docs/profile-immutability.md` walks through Layers 1/2/3 with exit-code table, operator setup, bypass semantics, and the two legitimate Phase-1 recompute paths (find_kv_budget.py + thermal_replay.py --record-floors).
- **Zero regressions.** Full unit suite: 49 passed, 1 skipped (shellcheck unavailable), 1 xfail (Plan 04's KV-finder turf) — matches the Plan 02/03 baseline exactly.

## Task Commits

Each task committed atomically with `--no-verify` (parallel executor convention — the orchestrator runs Layer-1/2 validation upstream):

1. **Task 1: 50-turn scripted air-gap session fixture** — `bc80722` (feat)
2. **Task 2: D-12 four-layer air-gap validator + CLI shim** — `32f889a` (feat)
3. **Task 3: Airgap CI workflow + Layer-2 pre-commit hook + immutability docs** — `8d3a140` (feat)

_Task 4 is the Phase-B human-verify checkpoint — see "Phase B Launch Instructions" below._

## Files Created/Modified

### Task 1 (`bc80722`) — 50-turn fixture
- `air_gap/session.jsonl` — 50 JSONL turns, 8 tool types, deterministic pattern mix
- `air_gap/tool_registry.json` — 8-tool OpenAI-format schema registry
- `air_gap/README.md` — fixture provenance + pattern table + consumer pointer

### Task 2 (`32f889a`) — D-12 validator
- `emmy_serve/airgap/__init__.py` — public API re-exports
- `emmy_serve/airgap/probe.py` — 4 `layer_*` helpers + `LayerResult` + `_run` subprocess wrapper
- `emmy_serve/airgap/validator.py` — `run_airgap_probe` + `AirGapReport` + argparse main + `pre-boot` / `post-boot` subcommands
- `scripts/airgap_probe.py` — executable shim (chmod 755)

### Task 3 (`8d3a140`) — CI + hook + docs
- `.github/workflows/airgap.yml` — two-job workflow with path filters + concurrency group
- `.githooks/pre-commit` — PROFILE-06 Layer 2 enforcement (chmod 755)
- `docs/profile-immutability.md` — 3-layer enforcement contract + operator setup

## Decisions Made

See the `key-decisions` block in the frontmatter for the full list. Summary of the six most load-bearing:

1. **web_fetch mock marker** — turn's content starts with `(mock — no network in air-gap)` so the no-network boundary is unmistakable to a reviewer (test contract is silent on the marker; reviewer contract demands it).
2. **Context-growing group is 5 user + 3 assistant** — matches `test_context_growing_turns_present`'s ≥5-user-turns-at-turn-≥41 assertion; two consecutive user turns at 45+46 model a realistic follow-up without wasting a turn slot.
3. **Pre-boot subcommand validates 4 env vars, not 2** — DO_NOT_TRACK + TRANSFORMERS_OFFLINE are required schema fields but not cross-field-policy gated; pre-boot catches the "set to wrong value" failure mode the immutability validator misses.
4. **airgap-replay job calls start_emmy.sh --airgap** — single source of truth for boot semantics; future AIRGAP env var additions flow through one file.
5. **Layer 3 CI job runs on ubuntu-latest** — hash validation is pure Python; running it on a cloud runner means it never competes with the self-hosted runner's single-job concurrency group.
6. **Phase A / Phase B split** — Phase A (code + tests + docs) is what this executor owns; Phase B (registered-runner CI run + physical cable-pull sanity) is the human-verify checkpoint documented below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Re-balanced context-growing group to hit the test contract**
- **Found during:** Task 1 self-check (after generator ran and produced 50 turns)
- **Issue:** Plan-text said "8 user turns that reference earlier material" (group 10, turns 43-50). My first draft alternated 4 user + 4 assistant turns, producing only 4 user turns with `turn >= 43`. The test contract (`test_session_jsonl.py::test_context_growing_turns_present`) checks for ≥5 user turns with `turn >= 41`, which my first draft failed with "only 4 user turns in 43..50".
- **Fix:** Rewrote group 10 as 5 user + 3 assistant turns, including two consecutive user follow-up turns at 45+46 modeling a realistic multi-question exchange. Tests own the contract (Plan-02 pattern — when plan prose and tests disagree, tests win because they were committed in Plan 01-01 and are the Phase-1 validation surface).
- **Files modified:** `/tmp/gen_session.py` (ephemeral, never committed) regenerated `air_gap/session.jsonl`
- **Verification:** `test_context_growing_turns_present` PASSED; 5 user turns at turns [43, 45, 46, 48, 50] satisfy the ≥5 assertion.
- **Committed in:** `bc80722` (Task 1)

**Total deviations:** 1 auto-fixed (Rule 1 — test-contract compliance).
**Impact on plan:** Zero scope creep. The fix aligned the fixture with the committed test contract; the plan-text 8-user-turn number was a non-normative suggestion that predated the test skeleton.

## Issues Encountered

None besides the deviation above. The orchestrator's running emmy-serve container on 127.0.0.1:8002 was never perturbed; all work was local to the worktree under `/data/projects/emmy/.claude/worktrees/agent-a2315999/`. All three commits use `--no-verify` per parallel-executor convention.

## Phase B Launch Instructions

Phase A (code + tests + docs) is complete. Phase B gates on the operator performing three actions:

### Step 1 — Register the self-hosted GitHub Actions runner on the DGX Spark

Already documented in `docs/ci-runner.md` (Plan 01-01). Summary:

```bash
# On the DGX Spark, as root:
sudo useradd -m -s /bin/bash emmy-ci
sudo usermod -aG docker emmy-ci

# As the emmy-ci user, register the runner following
# GitHub Settings -> Actions -> Runners -> New self-hosted runner.
# Install into /data/ci-runner/_work/emmy/emmy/.
# Apply label: dgx-spark
```

Verify with:
```bash
# From GitHub UI: Settings -> Actions -> Runners shows the `dgx-spark` label online.
```

### Step 2 — Activate the Layer-2 pre-commit hook (developer side, optional)

On any machine where you commit to emmy:
```bash
cd /path/to/emmy
git config core.hooksPath .githooks
git config --get core.hooksPath   # expect: .githooks
```

Verify with the dry-run procedure documented in `docs/profile-immutability.md`.

### Step 3 — Trigger the airgap workflow via PR

Once the runner is online, push the Phase-A commits (`bc80722`, `32f889a`, `8d3a140`) to a branch and open a PR that touches any of the workflow's path filters (e.g. modifying `air_gap/README.md`):

```bash
# From a checkout with the Phase-A commits already on the branch:
git push -u origin HEAD
# Open a PR at https://github.com/<owner>/<repo>/pulls
```

Expected outcome:
1. `profile-hash-integrity` runs on ubuntu-latest in ~30 s; validates every `profiles/*/v*/` bundle with `emmy profile validate`. GREEN.
2. `airgap-replay` queues on the self-hosted runner once (1) is green; runs for ~5–10 min (boot + smoke + replay + offline-HF + teardown). GREEN.
3. `runs-on: [self-hosted, dgx-spark]` means the job ONLY runs on our registered runner — no risk of a cloud runner picking it up.
4. `concurrency: airgap-${{ github.ref }}` + `cancel-in-progress: true` means a later push to the same PR head cancels the in-flight run — no pile-up on the single self-hosted runner.

### Step 4 — (Optional, one-time) Physical cable-pull sanity test

Per 01-05-PLAN.md Task 4 `resume-signal` point (g): with the workflow green, physically unplug the network cable, run `./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1 --port 8002` (normal mode, NOT `--airgap`), and confirm the smoke test still passes using only local files. Re-plug after.

### Step 5 — (Local proof, operator-driven, optional)

If the self-hosted runner isn't ready yet but the operator wants to prove SC-4 locally:

```bash
cd /data/projects/emmy

# 1. Pre-boot policy check (no container needed)
uv run python -m emmy_serve.airgap.validator pre-boot \
  --profile profiles/qwen3.6-35b-a3b/v1

# 2. Boot emmy-serve with --airgap (requires a free port; orchestrator's
#    container on 8002 must be stopped or use a different port).
docker stop emmy-serve 2>/dev/null; docker rm emmy-serve 2>/dev/null
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1 --port 8003 --airgap

# 3. Run the 4-layer D-12 probe
mkdir -p runs/local-airgap
uv run python -m emmy_serve.airgap.validator post-boot \
  --container emmy-serve \
  --out runs/local-airgap/report.json

# 4. Replay the 50-turn session inside the container
docker cp air_gap/session.jsonl emmy-serve:/tmp/session.jsonl
docker cp air_gap/tool_registry.json emmy-serve:/tmp/tool_registry.json
docker exec emmy-serve python3 -c "
import json, os
from emmy_serve.canary.replay import run_replay
from emmy_serve.profile.loader import load_profile
tools = json.load(open('/tmp/tool_registry.json'))['tools']
serving, _, ref = load_profile('profiles/qwen3.6-35b-a3b/v1')
run_replay('http://127.0.0.1:8000', serving.engine.served_model_name, '/tmp/session.jsonl', tools=tools)
print('replay ok')
"

# 5. Tear down
docker stop emmy-serve; docker rm emmy-serve
```

Expected: all steps exit 0; `runs/local-airgap/report.json` shows `passes: true` with all four layers green.

## Next Phase Readiness

- **Phase 1 closeout (`/gsd-verify-work`) gated on:** (a) Phase-B launch steps 1 + 3 complete (self-hosted runner registered + airgap workflow green on a PR), (b) Plan 04's KV-finder + thermal-replay artifacts committed, (c) operator NGC-digest capture + xfail flips (inherited operator TODO from Plan 01-01 / 01-02).
- **No blockers for Phase 2 planning:** the 50-turn fixture is the Phase-2 regression corpus; the airgap workflow's path filter auto-retriggers on Phase-2 changes to emmy_serve/** so no workflow edits are needed as Phase 2 lands.
- **No blockers for Phase 3 observability:** the airgap-report JSON artifact shape is Phase-3 Langfuse-ingestor-ready (one file per trace, content-hash-anchored, frontmatter with ts + container + passes boolean + failures list + per-layer detail).

## Self-Check: PASSED

Verified against all plan acceptance criteria:

**Task 1:**
- `test -f air_gap/session.jsonl` → FOUND
- `wc -l < air_gap/session.jsonl` → 50
- All rows parse via `json.loads` → OK
- Union of tool_calls.function.name == {read, write, edit, bash, grep, find, ls, web_fetch} → OK
- `test -f air_gap/tool_registry.json && len(tools) == 8` → OK
- `grep "mock.*no network" air_gap/session.jsonl` → 1 match
- `test -f air_gap/README.md` → FOUND
- `uv run pytest tests/unit/test_session_jsonl.py -x` → 5 PASSED

**Task 2:**
- `test -f emmy_serve/airgap/validator.py && grep "def run_airgap_probe"` → FOUND
- `test -f emmy_serve/airgap/probe.py` + all 4 `def layer_*` functions → FOUND
- `grep huggingface.co` probe.py → FOUND
- `grep VLLM_NO_USAGE_STATS` probe.py → FOUND
- `grep HF_HUB_OFFLINE` probe.py → FOUND
- `test -x scripts/airgap_probe.py` → EXECUTABLE
- `uv run python -m emmy_serve.airgap.validator pre-boot --profile profiles/qwen3.6-35b-a3b/v1` → exit 0 ("pre-boot OK")
- `uv run python -m emmy_serve.airgap.validator --help | grep post-boot` → FOUND

**Task 3:**
- `test -f .github/workflows/airgap.yml` → FOUND
- `grep "\[self-hosted, dgx-spark\]"` → FOUND
- `grep "cancel-in-progress: true"` → FOUND
- `grep "airgap-${{ github.ref }}"` → FOUND
- Path filters cover emmy-serve/**, profiles/**, scripts/start_emmy.sh, air_gap/** → all FOUND
- `grep "profile-hash-integrity"` + `grep "airgap-replay"` → both FOUND
- `grep -- --airgap` → FOUND
- `grep post-boot` → FOUND
- `grep test_offline_hf` → FOUND
- `test -x .githooks/pre-commit && grep "emmy profile validate"` → OK
- `test -f docs/profile-immutability.md && grep core.hooksPath && grep "Layer 3"` → all OK
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/airgap.yml'))"` → exit 0
- `uv run pytest tests/unit/test_workflows.py -x` → 4 PASSED

**Commits verified in git log:**
- `bc80722` — Task 1 (feat: 50-turn air-gap session fixture)
- `32f889a` — Task 2 (feat: D-12 four-layer validator)
- `8d3a140` — Task 3 (feat: airgap CI + pre-commit hook + docs)

**Full test suite:**
- `uv run pytest tests/unit/` → 49 passed, 1 skipped (shellcheck), 1 xfail (Plan 04)
- `uv run pytest tests/integration/test_airgap.py` → 6 skipped without --run-integration (correct behavior)

**Files scoped per parallel-executor convention:**
- Created: `air_gap/*`, `emmy_serve/airgap/*`, `scripts/airgap_probe.py`, `.github/workflows/airgap.yml`, `.githooks/pre-commit`, `docs/profile-immutability.md`
- NOT touched: `emmy_serve/kv_finder/*`, `emmy_serve/thermal/*`, `scripts/find_kv_budget.py`, `scripts/thermal_replay.py`, `profiles/qwen3.6-35b-a3b/v1/*`, STATE.md, ROADMAP.md (01-04's scope + orchestrator's shared files)

---
*Phase: 01-serving-foundation-profile-schema*
*Plan: 05 (airgap-ci-50-turn-replay)*
*Phase A completed: 2026-04-21 · Phase B handed to operator*
