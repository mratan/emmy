---
phase: 01-serving-foundation-profile-schema
plan: 07
subsystem: thermal
tags: [sc-5, sampler-fix, dgx-spark, uma, thermal-replay, pitfall-7, gap-closure, partial]
gap_closure: true
status: task-1-complete-tasks-2-3-blocked-on-dgx-spark

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: "Plan 01-04 emmy_serve.thermal.sampler.GpuSampler (the file being fixed); emmy_serve.thermal.replay.compute_floors (which already filters via `if \"gpu_clock_mhz\" in s`, making the omit-on-[N/A] strategy safe)"
provides:
  - "emmy_serve.thermal.sampler._parse_float_or_none(raw) — per-field nvidia-smi parser tolerant of [N/A] / N/A / \"\" / nan sentinels"
  - "emmy_serve.thermal.sampler._NA_SENTINELS — grep-able frozenset of nvidia-smi 'unsupported' markers"
  - "GpuSampler._sample tolerance contract: structural failures return None; individual [N/A] fields OMIT the key but keep the rest (compute_floors-compatible)"
  - "tests/unit/test_thermal_sampler.py — 7 regression tests covering (a) dedicated-GPU all-numeric, (b) DGX Spark UMA [N/A], (c) bare N/A, (d) structural malformed, (e) empty output, (f) all-[N/A], (g) only-clock-numeric compute_floors contract"
affects:
  - "Phase 1 verifier SC-5: sampler layer of the gap is now fixed; the two DGX Spark replays (record-floors #2 + assert-floors #3) remain operator-gated"
  - "profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md measured_values.gpu_clock_* — will be populated with real MHz values by Task 2"
  - "profiles/qwen3.6-35b-a3b/v1/profile.yaml.hash — will be recomputed after Task 2 PROFILE_NOTES.md rewrite"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-field sentinel parser with frozenset + casefold + contains — idiom for driver/vendor CLIs that emit heterogeneous placeholder strings. Avoids the common 'one ValueError collapses the whole row' anti-pattern."
    - "RED→GREEN pair with the RED test reproducing the real observed hardware row — the test docstring cites the exact nvidia-smi output (2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]) so future readers can see the regression anchor without re-deriving it."
    - "Unchanged public-API contract: GpuSampler ctor / start / stop / run still take and return the same types; a single-field sentinel just omits that key from the dict. No caller touched; compute_floors' `if \"gpu_clock_mhz\" in s` invariant is the contract."

key-files:
  created:
    - "tests/unit/test_thermal_sampler.py — 7 tests, all green; covers three nvidia-smi output shapes + edge cases"
    - ".planning/phases/01-serving-foundation-profile-schema/01-07-SUMMARY.md — this file"
  modified:
    - "emmy_serve/thermal/sampler.py — +55 / -14 lines; added _NA_SENTINELS + _parse_float_or_none; rewrote GpuSampler._sample to build the sample dict key-by-key; module docstring refreshed to describe the new tolerance contract"

key-decisions:
  - "OMIT the key on [N/A] rather than set it to None. Rationale: compute_floors in replay.py already uses `if \"gpu_clock_mhz\" in s` as its filter idiom; setting the key to None would pass the `in` check and then crash on the subsequent numeric sort. Omitting matches the existing contract verbatim."
  - "Module-level _NA_SENTINELS frozenset instead of inline `in {...}` literal. Makes the set of recognised placeholders greppable and gives a single audit site if future nvidia-smi versions add new sentinels (e.g. `[Not Supported]`). casefold() on both sides handles `N/A` vs `n/a` drift."
  - "Left VllmMetricsSampler untouched. The bug was isolated to GpuSampler's CSV parse step; VllmMetricsSampler goes through scrape_metrics (prometheus_client text parser) which already returns a dict with per-metric optional presence. Scope discipline — one bug, one fix."
  - "RED commit contains 4 failing tests + 3 passing tests. The 3 passing RED tests (all-numeric, malformed, empty) confirm the test file itself isn't bogus — without them, a RED commit of all-failures could hide a bug in the test harness. This is the TDD hygiene dgx_stack patterns prescribe."

patterns-established:
  - "Graceful-on-sentinel per-field parsing for any vendor-CLI subprocess output. Plan 01-07's _parse_float_or_none + _NA_SENTINELS is the template for future nvidia-smi (or docker, or perf) parsers where individual fields may be unsupported on specific hardware."

# Metrics
duration: "2m 8s (code fix + tests only; Task 2 and Task 3 are 2-hour DGX Spark replays, NOT measured here)"
started: "2026-04-21T16:38:01Z"
completed_task_1: "2026-04-21T16:40:09Z"
tasks_completed_in_this_session: 1
tasks_pending: 2
---

# Phase 1 Plan 07: Task 1 Complete — GpuSampler UMA Fix (SC-5 Gap Closure)

**Task 1 of 3 complete on the main working tree. Tasks 2 and 3 require the DGX Spark and are blocked on operator — both are 2-hour sustained-GPU replays that this executor agent cannot perform. The sampler-layer of the SC-5 gap is now closed; the floor-reproducibility evidence (real MHz floor values + --assert-floors green run) lands after Tasks 2 and 3 execute on hardware.**

## Performance (Task 1 only)

- **Duration:** 2m 8s
- **Started:** 2026-04-21T16:38:01Z
- **Completed (Task 1):** 2026-04-21T16:40:09Z
- **Commits:** 2 (RED + GREEN)
- **Files created:** 2 (tests/unit/test_thermal_sampler.py + this summary)
- **Files modified:** 1 (emmy_serve/thermal/sampler.py; +55 / -14 lines)
- **Profile bytes touched:** 0 (profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md and profile.yaml are untouched — that is Task 2's scope, on the DGX Spark)

## Accomplishments (Task 1)

**The sampler-layer bug that made `gpu_clock_p5_hour2_mhz: 0` in PROFILE_NOTES.md is fixed.**

Before Plan 01-07: `GpuSampler._sample()` called `float(mem)` unconditionally. On the DGX Spark, `memory.used` returns `[N/A]` (because the GB10 SoC shares host UMA memory — no dedicated VRAM bank for nvidia-smi to report against). `float("[N/A]")` raised `ValueError`, the method returned `None`, and the ENTIRE row — including the valid 2405 MHz clock reading — was dropped. Result: `gpu_samples.jsonl` was empty after the 2-hour replay, `compute_floors` saw no clock rows, and `gpu_clock_p5_hour2_mhz` computed to 0.

After Plan 01-07: the parse is per-field. A new `_parse_float_or_none(raw)` helper recognises the `_NA_SENTINELS = {"[n/a]", "n/a", "", "nan"}` set (case-insensitive via `.casefold()`) and returns `None` rather than raising. `GpuSampler._sample` builds the sample dict key-by-key; when a field is `[N/A]` the corresponding key is OMITTED from the returned dict. `compute_floors`' existing `if "gpu_clock_mhz" in s` idiom is the contract, so a sample with only `gpu_util_pct + gpu_clock_mhz + gpu_temp_c + ts` (memory_used_mb absent) flows through unchanged.

The exact observed DGX Spark row from today — `2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]` — is codified verbatim as a regression test. Future driver-level changes that break the parse will fail this test anchor.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (RED) | `4214b71` (test) | 7 tests in tests/unit/test_thermal_sampler.py; 4 RED + 3 PASS at RED time |
| 1 (GREEN) | `b510d1b` (fix) | GpuSampler._sample builds dict per-field via _parse_float_or_none; all 7 tests PASS |
| 2 | **pending** | 2-hour thermal replay with `--record-floors` on DGX Spark (operator) |
| 3 | **pending** | 2-hour thermal replay with `--assert-floors` on DGX Spark (operator, after Task 2) |

## Files Created / Modified

### Task 1 RED (`4214b71`) — tests/unit/test_thermal_sampler.py

7 tests covering three real nvidia-smi output shapes:

| Test | RED status (pre-fix) | GREEN status (post-fix) | What it covers |
|------|----------------------|-------------------------|----------------|
| `test_parses_dedicated_gpu_row_all_numeric` | PASS | PASS | Baseline: all 5 fields numeric (dedicated-GPU case) |
| `test_parses_dgx_spark_uma_row_with_n_a_memory` | **FAIL** | PASS | The regression anchor — exact DGX Spark row `2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]` |
| `test_parses_bare_n_a_without_brackets` | **FAIL** | PASS | Driver variant emitting `N/A` instead of `[N/A]` |
| `test_drops_structurally_malformed_row` | PASS | PASS | < 5 CSV fields returns None |
| `test_drops_empty_output` | PASS | PASS | nvidia-smi silent → None |
| `test_handles_multiple_n_a_fields_keeps_timestamp` | **FAIL** | PASS | All-`[N/A]` numeric edge case — ts preserved |
| `test_only_clock_numeric_matches_dgx_spark_expectation` | **FAIL** | PASS | Post-fix compute_floors contract: `gpu_clock_mhz` key present and > 0 |

### Task 1 GREEN (`b510d1b`) — emmy_serve/thermal/sampler.py

- Added `_NA_SENTINELS = frozenset({"[n/a]", "n/a", "", "nan"})` at module scope (below imports, above `GpuSampler`).
- Added `_parse_float_or_none(raw: str) -> float | None` — casefold() + sentinel set check, then `float()` in a try/except.
- Rewrote `GpuSampler._sample()`:
  - Structural-failure branches (subprocess / empty / <5 fields) still return `None` as before — caller behaviour unchanged for those cases.
  - On a well-formed row: builds a `sample: dict = {"ts": ts}` and iterates `(key, raw)` pairs, calling `_parse_float_or_none(raw)`; only includes the key if the return is not `None`.
- Module docstring updated: previously said "samples are dropped silently" as a blanket claim; now distinguishes structural failures (dropped) from per-field sentinels (key omitted, row kept).
- `VllmMetricsSampler` untouched (bug was isolated to the nvidia-smi parse path).
- Public API unchanged: `GpuSampler(jsonl_path, interval_s, t_start)`, `.start()`, `.stop()`, `.run()` still take/return the same shapes.

## Verification (Task 1)

All evidence from `/data/projects/emmy` on the executor agent's working tree:

```text
$ uv run pytest tests/unit/test_thermal_sampler.py -v
============================= test session starts ==============================
...
tests/unit/test_thermal_sampler.py::test_parses_dedicated_gpu_row_all_numeric PASSED
tests/unit/test_thermal_sampler.py::test_parses_dgx_spark_uma_row_with_n_a_memory PASSED
tests/unit/test_thermal_sampler.py::test_parses_bare_n_a_without_brackets PASSED
tests/unit/test_thermal_sampler.py::test_drops_structurally_malformed_row PASSED
tests/unit/test_thermal_sampler.py::test_drops_empty_output PASSED
tests/unit/test_thermal_sampler.py::test_handles_multiple_n_a_fields_keeps_timestamp PASSED
tests/unit/test_thermal_sampler.py::test_only_clock_numeric_matches_dgx_spark_expectation PASSED
============================== 7 passed in 0.08s ===============================

$ uv run pytest tests/unit -q
124 passed, 1 skipped in 0.95s
# (1 skipped = test_start_script.py shellcheck absence — unrelated to this plan)

$ uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/
# exit 0 (profile bytes untouched — serving.yaml / harness.yaml / profile.yaml / PROFILE_NOTES.md all at their Plan 01-06 committed state)

$ uv run python3 -c "
from unittest.mock import patch
from emmy_serve.thermal.sampler import GpuSampler, VllmMetricsSampler
with patch('emmy_serve.thermal.sampler.subprocess.check_output',
           return_value='2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]\n'):
    s = GpuSampler._sample()
    assert s is not None, 'regression: sample still dropped'
    assert s['gpu_clock_mhz'] == 2405.0
    assert 'memory_used_mb' not in s
    print(f'smoke ok: {s}')"
smoke ok: {'ts': '2026/04/21 09:03:14.839', 'gpu_util_pct': 0.0, 'gpu_clock_mhz': 2405.0, 'gpu_temp_c': 48.0}
```

- RED → GREEN commit pair visible in `git log --oneline`: `4214b71` then `b510d1b`.
- No REFACTOR commit — the fix is already minimal; cleanup is not warranted.
- No files were deleted by either commit.
- All prior 47 thermal+kv-finder tests from Plan 01-04 remain PASS (21 in `test_thermal_replay.py`, 15 in `test_kv_finder.py`, 11 in `test_thermal_audit.py`).

## Deviations from Plan

### Auto-fixed Issues

**None.** The plan's Task 1 section was precise enough that the RED test file and the GREEN patch both landed exactly as specified, with zero in-flight adjustments. No Rule 1/2/3 deviations.

### Documentation breadcrumb

The plan suggested (optional) updating the sampler.py module docstring if it still said "samples are dropped silently". I made that update — the docstring now distinguishes structural drops from per-field omission, so a future reader understands the new tolerance contract without diving into the parse code.

**Total deviations:** 0 auto-fix, 1 in-scope documentation refresh that was explicitly optional in the plan.

## Deferred Items (Tasks 2 and 3 — DGX Spark operator scope)

Tasks 2 and 3 are `type="checkpoint:human-verify"`, `gate="blocking"`, and explicitly tagged `[CHECKPOINT — DGX Spark]` in the plan. They cannot be executed on this agent's working tree because they require ~2 hours of sustained GPU time each on the actual DGX Spark (GB10, 128 GB UMA). Both runbooks are reproduced verbatim below from `01-07-PLAN.md` so the operator has everything needed on one page.

### Task 2 runbook — Second `--record-floors` replay

**When:** Next evening slot after this SUMMARY ships. Requires ~2 hours of uninterrupted GPU.

**Preconditions (verify before starting):**

- `git log --oneline` shows `b510d1b` (the GREEN fix) in history on whatever branch the DGX Spark is running.
- `uv run pytest tests/unit/test_thermal_sampler.py -x -q` passes 7/7.
- The `emmy-serve` container is NOT running (Task 2 starts its own instance).

**Runbook (from 01-07-PLAN.md Task 2):**

```bash
cd /data/projects/emmy

# 0. Verify Task 1 fix is present on this machine
grep -q "_parse_float_or_none" emmy_serve/thermal/sampler.py && echo "sampler fix present" || { echo "FAIL: Task 1 not applied"; exit 1; }
uv run pytest tests/unit/test_thermal_sampler.py -x -q

# 1. Boot emmy-serve (required precondition per scripts/thermal_replay.py header)
docker stop emmy-serve 2>/dev/null; docker rm emmy-serve 2>/dev/null
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1 --port 8002

# 2. Sanity — confirm the sampler NOW produces non-zero clock rows against live nvidia-smi
uv run python3 -c "
from emmy_serve.thermal.sampler import GpuSampler
s = GpuSampler._sample()
assert s is not None, 'sampler returned None — nvidia-smi may not be reachable'
assert 'gpu_clock_mhz' in s, f'gpu_clock_mhz missing from {s}'
assert s['gpu_clock_mhz'] > 0, f'gpu_clock_mhz is {s[\"gpu_clock_mhz\"]} — expected > 0'
print(f'live sampler ok: gpu_clock_mhz={s[\"gpu_clock_mhz\"]}')
"

# 3. Run the second 2-hour thermal replay with --record-floors
uv run ./scripts/thermal_replay.py \
    --profile profiles/qwen3.6-35b-a3b/v1 \
    --target-wall-time-s 7200 \
    --record-floors 2>&1 | tee runs/thermal-sc5fix-record-$(date -u +%Y%m%dT%H%M%SZ).log

# 4. Verify the overwrite: gpu_clock_* fields are NOW non-zero
uv run python3 -c "
import yaml
text = open('profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md').read()
fm = yaml.safe_load(text.split('---')[1])
mv = fm['measured_values']
p5 = mv['gpu_clock_p5_hour2_mhz']; p50 = mv['gpu_clock_p50_hour2_mhz']
print(f'gpu_clock_p5_hour2_mhz  = {p5}'); print(f'gpu_clock_p50_hour2_mhz = {p50}')
assert p5 > 0 and p50 > 0, 'sampler fix did not propagate into gpu_samples.jsonl'
assert 500 <= p5 <= 5000 and 500 <= p50 <= 5000, 'p5/p50 outside plausible 500-5000 MHz range'
print('record ok')
"

# 5. If record_floors_first_run did not auto-append validation_runs, add the entry manually:
NEW_RUN_DIR=$(ls -1td runs/*-thermal | head -1)
NEW_HASH=$(sha256sum "$NEW_RUN_DIR/summary.json" | awk '{print $1}')
NEW_RUN_ID=$(basename "$NEW_RUN_DIR")
# Edit profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md — append to `validation_runs:`:
#   - run_id: <NEW_RUN_ID>
#     hash: sha256:<NEW_HASH>
#     purpose: "2-hour thermal replay (second --record-floors after SC-5 sampler fix); records real GPU clock floors"
# Also update the "Measured-values log (D-15, D-16)" table: replace "0 MHz (**sampler gap**)" with the real value.

# 6. Recompute the bundle hash + validate
uv run emmy profile hash profiles/qwen3.6-35b-a3b/v1/ --write
uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/    # exit 0

# 7. Commit
git add profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md \
        profiles/qwen3.6-35b-a3b/v1/profile.yaml \
        "$NEW_RUN_DIR/summary.json"
git commit -m "feat(01-07): record real GPU clock floors after SC-5 sampler fix

- 2nd --record-floors run: $NEW_RUN_ID
- gpu_clock_p5_hour2_mhz and gpu_clock_p50_hour2_mhz now non-zero
- PROFILE_NOTES.md measured_values updated; profile.yaml.hash recomputed
- Sampler gap section marked resolved (commit b510d1b)"
```

**Task 2 resume-signal:** type `"sc5 floors recorded"` to the orchestrator once (a) `uv run pytest tests/unit/test_thermal_sampler.py -x -q` is all-green on the DGX Spark, (b) the second 2-hour `--record-floors` replay completed with exit 0, (c) `PROFILE_NOTES.md measured_values.gpu_clock_p5_hour2_mhz` AND `gpu_clock_p50_hour2_mhz` are both non-zero and within 500-5000 MHz, (d) `validation_runs` has ≥2 entries, (e) `uv run emmy profile validate` exits 0, (f) the feat commit is in git log.

### Task 3 runbook — Third `--assert-floors` replay (SC-5 reproducibility gate)

**When:** Schedule for the next evening slot after Task 2 completes. Another ~2 hours of GPU.

**Runbook (from 01-07-PLAN.md Task 3):**

```bash
cd /data/projects/emmy

# 0. Preconditions: Task 2 must have committed non-zero measured_values.gpu_clock_*
uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/

# 1. Fresh boot
docker stop emmy-serve 2>/dev/null; docker rm emmy-serve 2>/dev/null
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1 --port 8002

# 2. Third 2-hour thermal replay with --assert-floors
uv run ./scripts/thermal_replay.py \
    --profile profiles/qwen3.6-35b-a3b/v1 \
    --target-wall-time-s 7200 \
    --assert-floors 2>&1 | tee runs/thermal-sc5fix-assert-$(date -u +%Y%m%dT%H%M%SZ).log
# Expect: exit 0 and "All floors pass" on stderr

# 3. Append the assert-floors run to validation_runs
ASSERT_RUN_DIR=$(ls -1td runs/*-thermal | head -1)
ASSERT_HASH=$(sha256sum "$ASSERT_RUN_DIR/summary.json" | awk '{print $1}')
ASSERT_RUN_ID=$(basename "$ASSERT_RUN_DIR")
# Edit profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md frontmatter; add:
#   - run_id: <ASSERT_RUN_ID>
#     hash: sha256:<ASSERT_HASH>
#     purpose: "2-hour thermal replay (--assert-floors); SC-5 reproducibility gate PASS; exit 0"

uv run emmy profile hash profiles/qwen3.6-35b-a3b/v1/ --write
uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/

# 4. Final sanity
uv run pytest tests/unit -q    # expect all green

# 5. Commit
git add profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md \
        profiles/qwen3.6-35b-a3b/v1/profile.yaml \
        "$ASSERT_RUN_DIR/summary.json"
git commit -m "feat(01-07): SC-5 reproducibility gate — 3rd thermal --assert-floors PASS

- assert-floors run: $ASSERT_RUN_ID (exit 0, 'All floors pass')
- validation_runs has ≥3 entries: 1st record-floors + 2nd record-floors + assert-floors
- SC-5 CLOSED: floors recorded and asserted reproducibility-passing"
```

**Task 3 resume-signal:** type `"sc5 reproducibility green"` to the orchestrator once (a) `uv run ./scripts/thermal_replay.py --assert-floors` exited 0 with "All floors pass", (b) PROFILE_NOTES.md validation_runs has been extended with the assert-floors run entry, (c) `uv run emmy profile validate` exits 0, (d) `uv run pytest tests/unit -q` remains all-green, (e) the feat commit is in git log.

**Rollback path for Task 3 if --assert-floors fails:** if the run fails on environmental noise (one failure; a subsequent re-run passes), record both runs in the log and commit only the passing run. If it fails persistently, the floor itself needs updating (legitimate `--record-floors` re-run with rationale in PROFILE_NOTES.md). This is the pitfall #5 / SC-5 pitfall #7 discipline — never rubber-stamp a failure.

## Issues Encountered

- **None.** Task 1 executed exactly as the plan prescribed. The RED test file landed with the expected 4-fail / 3-pass split; the GREEN patch produced 7/7 green with no regressions in the 124-test wider unit suite; profile validate stayed exit 0.

## Decisions Made

1. **OMIT the key on `[N/A]` rather than set it to `None`.** Rationale: `compute_floors` in `replay.py` already filters via `if "gpu_clock_mhz" in s` — setting the key to `None` would pass the `in` check and then crash on the subsequent numeric sort. Omitting matches the existing contract verbatim with zero downstream changes.

2. **`_NA_SENTINELS` at module scope, frozen, greppable.** A single audit site for future driver-level placeholder additions (e.g. `[Not Supported]` if a future nvidia-smi version adds more sentinels). `casefold()` on both sides handles `N/A` vs `n/a` drift without an explicit case matrix.

3. **VllmMetricsSampler left untouched.** The bug was isolated to the nvidia-smi CSV parse path; `scrape_metrics` (prometheus_client text parser) already returns a dict with per-metric optional presence. Scope discipline: one bug, one fix.

4. **RED commit deliberately contains 3 passing tests alongside the 4 failing ones.** The passing tests (all-numeric dedicated GPU, malformed row, empty output) confirm the test harness itself isn't bogus — a RED commit of all failures could hide a bug in `_sample_via_mock` / the `patch()` target. This is TDD hygiene.

5. **Module docstring refreshed in the GREEN commit**, not a separate `docs(...)` commit. The docstring change describes the new tolerance contract (structural failures drop the whole row; per-field sentinels drop just the key). Tightly coupling the prose with the code change means a future bisect on the sampler finds one commit, not two.

## Known Stubs

None. No stubs, placeholders, or TODOs introduced by Task 1.

## Threat Flags

No new security-relevant surface. The fix narrows attack surface slightly: previously a malicious nvidia-smi output could cause the sampler to silently drop every row; post-fix the sampler continues to emit rows with the numeric fields that parsed, so the replay loop can still observe throughput degradation.

The Plan 01-07 threat register (T-07-01, T-07-02) is directly mitigated by Task 1:

- **T-07-01 (Tampering — false floor from misparsed sampler output):** mitigated by the regression test anchor (`test_parses_dgx_spark_uma_row_with_n_a_memory`) which codifies the expected shape on the exact observed hardware row.
- **T-07-02 (Tampering — floor passes because sampler emitted no rows):** Task 1 fixes the emit-no-rows path specifically; Task 2's runbook step 2 adds a live pre-flight check that `GpuSampler._sample()` returns a dict with `gpu_clock_mhz > 0` before starting the 2-hour replay, so a silent nvidia-smi absence would abort upfront instead of producing a spurious 0-MHz floor.

## TDD Gate Compliance

Task 1 is `type="auto" tdd="true"`. Gate sequence verified against `git log --oneline`:

- RED gate: `4214b71 test(01-07): add failing test for DGX Spark UMA [N/A] row in GpuSampler`
- GREEN gate: `b510d1b fix(01-07): GpuSampler tolerates nvidia-smi [N/A] per-field (DGX Spark UMA fix)`
- REFACTOR: not performed; fix is already minimal.

Commits landed in RED → GREEN order on the same working tree with no intervening commits.

## Self-Check: PASSED

**Plan acceptance criteria (from 01-07-PLAN.md Task 1):**

- `test -f /data/projects/emmy/tests/unit/test_thermal_sampler.py` — FOUND
- `grep -q "test_parses_dgx_spark_uma_row_with_n_a_memory" tests/unit/test_thermal_sampler.py` — FOUND
- `grep -q "_parse_float_or_none\|_NA_SENTINELS" emmy_serve/thermal/sampler.py` — FOUND (both patterns present)
- `grep -q '\[N/A\]' emmy_serve/thermal/sampler.py` — FOUND (in _NA_SENTINELS + docstring)
- `uv run pytest tests/unit/test_thermal_sampler.py -x -v` — 7/7 PASS
- `uv run pytest tests/unit/test_thermal_replay.py -x` — 21/21 PASS (no regression)
- `uv run pytest tests/unit -q` — 124 passed, 1 skipped (shellcheck), 0 failed
- Two atomic commits in git log: `4214b71` (test) then `b510d1b` (fix)
- `uv run python3 -c "from emmy_serve.thermal.sampler import GpuSampler, VllmMetricsSampler; print('imports ok')"` — `imports ok`
- Plan's acceptance smoke one-liner (patch subprocess.check_output with the DGX Spark row, assert `s['gpu_clock_mhz'] == 2405.0` and `'memory_used_mb' not in s`) — `smoke ok: {'ts': '2026/04/21 09:03:14.839', 'gpu_util_pct': 0.0, 'gpu_clock_mhz': 2405.0, 'gpu_temp_c': 48.0}`

**Additional Phase-1-wide sanity:**

- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0 — CONFIRMED (no profile bytes touched)
- `emmy_serve/thermal/replay.py` unchanged — CONFIRMED (the fix is self-contained in sampler.py)
- No `VllmMetricsSampler` changes — CONFIRMED (bug was isolated to GpuSampler)

## Next Phase Readiness

**Task 1:** complete. On-machine sampler fix committed with RED→GREEN TDD discipline.

**Task 2 (operator-gated):** runbook above. Blocks Task 3.

**Task 3 (operator-gated, after Task 2):** runbook above. On green, Plan 01-07 closes SC-5's sampler-layer regression + the reproducibility evidence gap that `/gsd-verify-work` flagged on 2026-04-21.

**Phase 1 closure status:** After Tasks 2 and 3 complete on the DGX Spark and land commits, SC-5's "GPU clock not throttled below documented per-profile threshold" criterion becomes assertable (real MHz values recorded; --assert-floors gate proven to hold across two independent 2-hour runs). Two Phase 1 gaps still remain outside Plan 01-07's scope: SC-1 throughput floor (in Plan 01-06, parallel) and SC-4 self-hosted-runner registration (in Plan 01-08).

## Self-Check: PASSED (final verification)

- FOUND: tests/unit/test_thermal_sampler.py
- FOUND: emmy_serve/thermal/sampler.py (modified; +55 / -14 lines)
- FOUND: .planning/phases/01-serving-foundation-profile-schema/01-07-SUMMARY.md (this file)
- FOUND commit: `4214b71` (RED, test(01-07))
- FOUND commit: `b510d1b` (GREEN, fix(01-07))
- Unit suite: 124 passed, 1 skipped (shellcheck), 0 failed
- Profile validate: exit 0

---

*Phase: 01-serving-foundation-profile-schema*
*Plan: 01-07 (SC-5 gap closure — sampler fix complete; DGX Spark replays pending)*
*Task 1 completed: 2026-04-21T16:40:09Z*
*Tasks 2 and 3: operator-gated on DGX Spark — runbooks above*
