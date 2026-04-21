---
phase: 01-serving-foundation-profile-schema
plan: 04
subsystem: infra
tags: [kv-finder, thermal-replay, prometheus, nvidia-smi, pitfall-1, pitfall-7, serve-08, serve-11, dgx-spark]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: "Plan 01-01 test scaffolding (tests/integration/test_kv_budget.py + tests/unit/test_serving_yaml.py xfail); Plan 01-02 emmy_serve.profile (loader + immutability + hash round-trip); Plan 01-03 emmy_serve.canary (run_sp_ok, run_tool_call, run_generate) + emmy_serve.boot.probe + emmy_serve.diagnostics.atomic + EmmyRunLayout"
provides:
  - "emmy_serve.thermal.corpus — 25-prompt ThermalPrompt corpus (5 prior CODE + 9 agent-synthetic + 11 tool-call-shape) with deterministic text generators"
  - "emmy_serve.thermal.audit — §9.5 representativeness audit (AuditReport + audit_corpus + `python -m` CLI)"
  - "emmy_serve.thermal.sampler — GpuSampler + VllmMetricsSampler (5s cadence, append_jsonl_atomic-backed, graceful on nvidia-smi/scrape failure)"
  - "emmy_serve.thermal.replay — run_replay + compute_floors + assert_floors + record_floors_first_run; pre-replay audit + canary gate"
  - "emmy_serve.kv_finder.metrics — Prometheus text parser for vllm:num_preemptions_total + kv_cache_usage + waiting/running counters (verified against live vLLM 0.17.1+nvinternal)"
  - "emmy_serve.kv_finder.load_driver — finder subset (5 CODE + 3 agent_*_Nk) with drive_load() mixed-prefill loop"
  - "emmy_serve.kv_finder.bisect — full §8 algorithm (start 0.75, step up, bisect halving, back off 5%, max_iters 12) + run_finder + argparse CLI"
  - "scripts/find_kv_budget.py — executable shim for the KV-finder (Phase B entry point)"
  - "scripts/thermal_replay.py — executable shim for 2-hour replay (Phase B entry point)"
  - ".planning/phases/01/01-04-THERMAL-AUDIT.md — signed audit doc; `PASSES: True` on 25-prompt corpus"
  - "tests/unit/test_thermal_audit.py, test_kv_finder.py, test_thermal_replay.py — 47 GREEN unit tests"
affects:
  - "Phase 1 verifier (`/gsd-verify-work`) — still requires Phase B (empirical KV-finder + thermal replay) to complete Phase 1 success criteria SC-2 (zero preemption) and SC-3 (hour-2 floors recorded)"
  - "tests/unit/test_serving_yaml.py::test_kv_budget_final — xfail remains in place; Phase C clears it after the finder writes the measured value"
  - "profiles/qwen3.6-35b-a3b/v1/serving.yaml.engine.gpu_memory_utilization — remains at placeholder 0.75 through Phase A; Phase B overwrites it"
  - "profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md.measured_values — remains null through Phase A; first thermal replay in Phase B records the hour-2 floors"
  - "Phase 5 eval — will re-use the thermal corpus for eval shaping (SYNTHETIC_AGENT_PROMPTS are agent-loop-shaped; TOOL_CALL_SEQUENCE is the wire-format exerciser)"

# Tech tracking
tech-stack:
  added:
    - "prometheus-client.parser.text_string_to_metric_families (already pinned in Plan 01-01) — /metrics parser"
    - "threading.Thread (daemon=True, event.wait for bounded shutdown) — background samplers"
    - "subprocess.check_output('nvidia-smi --query-gpu=timestamp,utilization.gpu,clocks.current.graphics,temperature.gpu,memory.used') — GPU sampler"
    - "itertools.cycle — corpus cycling over 2-hour replay window"
  patterns:
    - "Deterministic-text generators for synthetic prompts (_build_pasted_python_file, _build_multifile_codebase, _build_conversation_history, _build_multiturn_context) — no random seeds; byte-stable across re-generation so profile hashes stay stable"
    - "Pre-replay gate chain (corpus audit → SP_OK → tool_call → generate) — any gate fails aborts the 2-hour run before wasting GPU time"
    - "§9.7 hour-2 filter + percentile math — hard gates on preempt/OOM, soft tolerances on clock/decode (5%/7%/10%)"
    - "Helper-level mocking over subprocess.run — Python 3.12 check_output delegates to run, so broad patches break sibling subprocess calls. Targeted patches on emmy_serve.kv_finder.bisect._restart_vllm / _stop_vllm / _hardware_id keep _hardware_id's real hostname call functional during tests."
    - "Graceful-on-hardware-missing: every hardware-touching helper (dmesg, nvidia-smi, scrape_metrics, emmy-hash subprocess) catches Exception and degrades rather than aborts; a 2-hour finder/replay run tolerates transient env errors"

key-files:
  created:
    - "emmy_serve/thermal/__init__.py — package namespace + re-exports (14 public symbols)"
    - "emmy_serve/thermal/corpus.py — 25 ThermalPrompt entries + deterministic generators; ALL_THERMAL_PROMPTS + get_prompt accessor"
    - "emmy_serve/thermal/audit.py — AuditReport dataclass + audit_corpus + `python -m emmy_serve.thermal.audit` CLI (--format text|json)"
    - "emmy_serve/thermal/sampler.py — GpuSampler (nvidia-smi) + VllmMetricsSampler (/metrics)"
    - "emmy_serve/thermal/replay.py — run_replay + compute_floors + assert_floors + record_floors_first_run + main CLI"
    - "emmy_serve/kv_finder/__init__.py — package namespace + re-exports"
    - "emmy_serve/kv_finder/metrics.py — parse_preemption_metrics + scrape_metrics"
    - "emmy_serve/kv_finder/load_driver.py — drive_load + _finder_subset (mixed-prefill subset)"
    - "emmy_serve/kv_finder/bisect.py — run_finder + FinderState + helpers (_check_dmesg_oom, _rewrite_gpu_mem_util, _hardware_id, _restart_vllm, _stop_vllm, _classify_failure)"
    - "scripts/find_kv_budget.py — executable shim (chmod +x)"
    - "scripts/thermal_replay.py — executable shim (chmod +x)"
    - ".planning/phases/01-serving-foundation-profile-schema/01-04-THERMAL-AUDIT.md — the committed §9.5 audit document"
    - "tests/unit/test_thermal_audit.py — 11 tests, all green"
    - "tests/unit/test_kv_finder.py — 15 tests, all green (mocks hardware-facing helpers)"
    - "tests/unit/test_thermal_replay.py — 21 tests, all green (fixture-driven compute_floors + assert_floors)"
  modified: []

key-decisions:
  - "Corpus size tuned to N=25 to pass §9.5 threshold (5) max-single-prompt-share ≤15% — with the 30K-prefill AGENT_30K_HISTORY entry retained (§9.4-prescribed), the denominator needs 18 other prompts to keep its share ≤15%. Added 8 synthetic agent + 11 tool-call prompts (was 10, needed one more to cross the ≥30% prefill-≥10K threshold: TOOL_SEQ_MULTITURN_10K)."
  - "Deterministic synthetic prompt bodies — no random seeds. Every _build_* helper loops a structured template until it hits the target char count. This is load-bearing for profile-hash stability: if the prompts changed across Python process restarts, the profile's content hash would drift silently, and every CI run would report 'hash mismatch'."
  - "`enable_thinking: false` in top-level request body (not extra_body) — matches the Plan 03 finding: vLLM ignores the OpenAI SDK client's `extra_body` wrapper; the field lives at the request root. Applied to both drive_load (KV-finder) and run_replay (thermal). This isolates decode throughput from thinking-mode CoT behavior on Qwen3.6-A3B."
  - "render_docker_args subprocess patching kept out of test_kv_finder.py — Python 3.12's subprocess.check_output delegates to subprocess.run internally, so `monkeypatch.setattr(subprocess, 'run', Mock)` breaks the sibling _hardware_id() call which depends on `subprocess.check_output(['hostname'])`. Replaced with targeted helper patches via `_stub_finder_hardware()` that monkeypatches `_restart_vllm / _stop_vllm / _hardware_id / _check_dmesg_oom` directly. Subprocess.run is still patched but only for the `emmy profile hash` invocation, pass-through otherwise."
  - "§9.7 tolerance constants as module-level named constants (CLOCK_P5_TOLERANCE=0.95, DECODE_P50_TOLERANCE=0.93, DECODE_P1_TOLERANCE=0.90) — makes the 5%/7%/10% thresholds grep-able and lets tests assert they match the research spec. Changing a tolerance is a deliberate edit, not a literal-number drift."
  - "assert_floors tolerant of `null` measured_values — Phase 1 ships PROFILE_NOTES.md with nulls, which the first thermal replay (Phase B) fills. Without this tolerance, every Phase A CI run of assert_floors would fail spuriously. The hard gates (preempt=0, oom=0) still run; the soft tolerances only trigger when a numeric recorded value is present."

patterns-established:
  - "Daemon-thread background samplers with event-bounded shutdown — both GpuSampler and VllmMetricsSampler use `event.wait(interval_s)` so `stop()` interrupts within the current tick rather than waiting a full interval. Shutdown path: stop() → join(timeout=10) in replay's finally block."
  - "Hour-2 steady-state filter — every long-run measurement in emmy that cares about thermal-stable numbers filters by `t_elapsed >= 3600`. compute_floors is the reference implementation."
  - "Shim-pattern for CLIs — same as scripts/validate_profile.py + scripts/hash_profile.py from Plan 02, and scripts/smoke_test.py from Plan 03: a 15-line Python entry shim that `sys.exit(main(sys.argv[1:]))` against the module CLI. Keeps `[project.scripts]` entrypoints optional."
  - "Appendable-with-fsync JSONL for any long-running event stream (iterations.jsonl in KV-finder, responses.jsonl + gpu_samples.jsonl + vllm_metrics.jsonl in thermal). A mid-run crash preserves every row that made it through append_jsonl_atomic."

requirements-completed: []
# Phase A of Plan 01-04 writes all the code but runs NO hardware. The three
# requirements the plan ultimately satisfies — SERVE-07 (prefix-order documented),
# SERVE-08 (KV budget non-placeholder + zero-preemption 30-min), SERVE-11
# (2-hour thermal floors recorded) — remain PENDING until Phase B/C complete.
#
#   SERVE-07 → GREEN today: test_profile_notes.py::test_prefix_order_documented
#     passes since Plan 02 committed the prefix-order block.
#   SERVE-08 → GREEN after Phase C: test_serving_yaml.py::test_kv_budget_final
#     (xfail today) flips when find_kv_budget.py writes the measured value.
#     tests/integration/test_kv_budget.py::test_zero_preemption runs in Phase B
#     (integration/slow — needs live vLLM + 30 minutes wall-clock).
#   SERVE-11 → GREEN after two 2-hour thermal replays: first records floors,
#     second --assert-floors exits 0.

# Metrics
duration: 22min
completed: 2026-04-21
---

# Phase 1 Plan 04: KV-Budget Finder + Thermal Replay Summary (Phase A — code-only)

**25-prompt §9.5-compliant thermal corpus + KV-finder bisection + thermal-replay harness + §9.7 floor-assertion machinery, committed as ready-to-run code with 47 GREEN unit tests. Zero hardware runs executed — the 70-110 min KV-finder and two 2-hour thermal replays are deferred to Phase B; empirical measurements land in serving.yaml + PROFILE_NOTES.md in Phase C.**

## Performance (Phase A only)

- **Duration:** ~22 min (code + tests only; no hardware bisection or replay)
- **Started:** 2026-04-21T05:35:25Z
- **Completed:** 2026-04-21T05:57:21Z
- **Tasks committed:** 3 of 4 (Task 4 is the Phase B + Phase C checkpoint)
- **Files created:** 16 (9 source + 2 CLI shims + 1 audit doc + 3 test files + this summary)
- **Files modified:** 0 (no touch to serving.yaml, profile.yaml, or PROFILE_NOTES.md measurement sections)

## Accomplishments (Phase A)

- `emmy_serve/thermal/corpus.py`: 25 deterministically-generated `ThermalPrompt` entries spanning 150-tok CODE prompts through 30K-tok AGENT_30K_HISTORY + 12K-tok TOOL_SEQ_MULTITURN_12K. Every prompt body is either verbatim-from-prior-repo (CODE_01..05) or built by a deterministic template loop — no random seeds, byte-stable content.
- `emmy_serve/thermal/audit.py`: D-14 audit `PASSES: True` on the committed corpus:

  | Threshold | Measured | Required | Status |
  |-----------|----------|----------|--------|
  | prefill:decode ratio | 1.90 | [0.5, 2.0] | PASS |
  | % ≥10K prefill | 32% | ≥30% | PASS |
  | % tool-call shape | 44% | ≥20% | PASS |
  | max single prompt share | 14% (agent_30k_history) | ≤15% | PASS |

- `emmy_serve/kv_finder/*`: full §8 bisection implementation — step up until preemption, bisect halving step each direction-change, back off 5% for safety, max_iters=12. Three failure signals (preemption delta, swap delta, dmesg OOM). Iteration log (JSONL) + summary.json + PROFILE_NOTES.md block append + profile-hash recompute.
- `emmy_serve/thermal/replay.py`: 2-hour loop with pre-replay audit + canary gate (SP_OK + tool_call + generate). Background GPU + vLLM samplers on 5s cadence. §9.7 hour-2 floor computation. First-run record + re-run assertion with 5%/7%/10% tolerances + hard preempt/oom gates.
- **47 unit tests total, all GREEN** (`test_thermal_audit.py` 11 + `test_kv_finder.py` 15 + `test_thermal_replay.py` 21). Full unit suite: 96 passed, 1 skipped (shellcheck absent on worktree), 1 xfailed (`test_kv_budget_final` — intentionally left for Phase C).
- Live /metrics parser tolerated against running emmy-serve at 127.0.0.1:8002 (returned `vllm:kv_cache_usage_perc`, `num_preemptions_total`, `num_requests_running`, `num_requests_waiting` as expected — parser is field-tolerant of the vLLM 0.17.1 metric naming).

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `aa24cd3` (feat) | Thermal corpus + D-14 audit (25 prompts, §9.5 passes) |
| 2 (RED) | `481fb11` (test) | RED tests for kv_finder bisect/metrics/load_driver |
| 2 (GREEN) | `6389561` (feat) | KV-finder bisection per §8 |
| 3 | `6e64af6` (feat) | Thermal replay harness per §9.6 + §9.7 |
| 4 | (deferred) | Phase B checkpoint — operator-gated on DGX Spark |

## Files Created

### Task 1 — corpus + audit (`aa24cd3`)

- `emmy_serve/thermal/__init__.py` (30 lines, subsequently extended to re-export replay + sampler)
- `emmy_serve/thermal/corpus.py` (710 lines; 25 prompts + 4 deterministic generators)
- `emmy_serve/thermal/audit.py` (180 lines; §9.5 threshold math + AuditReport dataclass)
- `.planning/phases/01-serving-foundation-profile-schema/01-04-THERMAL-AUDIT.md` (audit document with real §9.5 numbers)
- `tests/unit/test_thermal_audit.py` (11 tests)

### Task 2 (RED) — failing tests (`481fb11`)

- `tests/unit/test_kv_finder.py` (401 lines; tests SKIPPED at collection time via `pytest.importorskip`)

### Task 2 (GREEN) — KV-finder (`6389561`)

- `emmy_serve/kv_finder/__init__.py` (25 lines; 6 public symbols)
- `emmy_serve/kv_finder/metrics.py` (75 lines; `parse_preemption_metrics` + `scrape_metrics`)
- `emmy_serve/kv_finder/load_driver.py` (110 lines; `drive_load` + `_finder_subset`)
- `emmy_serve/kv_finder/bisect.py` (300 lines; `run_finder` + 6 helpers + argparse CLI)
- `scripts/find_kv_budget.py` (25 lines; executable shim)
- `tests/unit/test_kv_finder.py` (updated to use `_stub_finder_hardware` helper)

### Task 3 — thermal replay + sampler (`6e64af6`)

- `emmy_serve/thermal/sampler.py` (145 lines; `GpuSampler` + `VllmMetricsSampler`)
- `emmy_serve/thermal/replay.py` (420 lines; `run_replay` + `compute_floors` + `assert_floors` + `record_floors_first_run` + argparse CLI)
- `scripts/thermal_replay.py` (30 lines; executable shim)
- `tests/unit/test_thermal_replay.py` (21 tests)
- `emmy_serve/thermal/__init__.py` extended to re-export replay + sampler

## Decisions Made

1. **Corpus size = 25 prompts** to pass all four static §9.5 thresholds simultaneously. Required iterative tuning: grew from N=16 to N=25 because threshold (5) — max-single-prompt-share ≤15% — forces a denominator ≥ (30K+4K)/0.15 = ~226K tokens, and the 30K-prefill AGENT_30K_HISTORY entry is §9.4-prescribed (can't be removed). Added 3 more synthetic agent prompts (AGENT_18K_MULTIFILE_TRACE, AGENT_8K_REFACTOR, AGENT_6K_DEBUG) and 5 more tool-sequence prompts (TOOL_SEQ_GREP_FILES, TOOL_SEQ_EDIT_AFTER_READ, TOOL_SEQ_MULTITURN_3K/6K/10K).

2. **Deterministic synthetic-prompt text generators** (no random seeds): each `_build_*(approx_tokens)` helper loops a structured template block until it hits `approx_tokens * 4` chars. This is load-bearing for profile-hash stability — any non-determinism would make every CI run report "hash mismatch" on corpus.py-consuming profiles.

3. **Metric parser tolerates vLLM version drift**: `_WATCHED_METRICS` includes both legacy (`vllm:num_requests_swapped`, `num_running_requests`) and current (`num_requests_running`, `num_requests_waiting`) spellings. Absent metrics are silently dropped rather than raising. Failure detection (`_classify_failure`) reads deltas from whatever's present; "no preemption counter in /metrics" isn't a finder abort, it's a "no failure observed" signal (degenerate but safe).

4. **Python 3.12 subprocess.run / check_output coupling**: `subprocess.check_output` internally calls `subprocess.run`, so `monkeypatch.setattr(subprocess, 'run', Mock)` breaks sibling `subprocess.check_output(['hostname'])` in `_hardware_id()`. Introduced `_stub_finder_hardware()` helper that patches specific bisect-module helpers (`_restart_vllm`, `_stop_vllm`, `_hardware_id`, `_check_dmesg_oom`) directly — leaves `subprocess.run` mostly intact (only short-circuits the `emmy profile hash` invocation).

5. **`enable_thinking: false` at request-body top level** (not `extra_body`): matches Plan 03 Finding 2 — vLLM ignores the OpenAI-SDK-client `extra_body` wrapper; the field lives at the request root. Applied consistently to `drive_load` (KV-finder loop) and `run_replay` (thermal loop) alongside Plan 03's canaries.

6. **Pre-replay gate chain, not a single audit**: `run_replay` runs four gates in sequence before starting the 2-hour loop: (1) corpus audit passes §9.5, (2) SP_OK canary, (3) tool_call canary, (4) generate canary. Any fail aborts immediately; rationale is that a broken canary halfway through a 2-hour run wastes ~1 hour of GPU time, while a broken canary caught upfront is a 15-second setback.

7. **§9.7 tolerance constants as module-level named constants**: `CLOCK_P5_TOLERANCE=0.95`, `DECODE_P50_TOLERANCE=0.93`, `DECODE_P1_TOLERANCE=0.90`. `test_tolerance_constants_match_research_spec` asserts these match the research document — any future change is a deliberate commit, not a literal-number drift.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corpus size grew from planned ~10 to 25 to satisfy §9.5 threshold (5)**

- **Found during:** Task 1 first audit run
- **Issue:** The plan's prose described "ALL_THERMAL_PROMPTS = PRIOR_CODING_TASKS + SYNTHETIC_AGENT_PROMPTS + TOOL_CALL_SEQUENCE = 10 + 4 turns". Running the audit produced `FAIL: single prompt 'agent_30k_history' at 20% share (cap: 15%) per §9.5`. With the §9.4-prescribed 30K-prefill prompt held constant, the denominator must be ≥225K tokens to keep its share ≤15%; N=10-12 can't reach that.
- **Fix:** Added 3 more agent synthetic prompts (AGENT_18K, AGENT_8K, AGENT_6K) and 5 more tool-sequence prompts (GREP, EDIT_AFTER_READ, MULTITURN 3K/6K/10K). Kept AGENT_30K_HISTORY at prefill=30000 but reduced its decode from 8000 → 4000 (realistic for a bug-fix response). Final N=25, max share 14%, all four static thresholds PASS.
- **Files modified:** `emmy_serve/thermal/corpus.py`
- **Verification:** `uv run python -m emmy_serve.thermal.audit --format json` → `"passes": true, "failures": []`
- **Committed in:** `aa24cd3`

**2. [Rule 1 - Bug] Python 3.12 subprocess.run patching breaks check_output**

- **Found during:** Task 2 first test run
- **Issue:** `monkeypatch.setattr(bisect.subprocess, 'run', Mock)` made `_hardware_id()` return a `Mock` object (from `subprocess.check_output(['hostname'], text=True).strip()` returning `mock.stdout.strip()`). Reason: Python 3.12's `check_output` is implemented internally via `run(...).stdout`. Caused `TypeError: Object of type Mock is not JSON serializable` when writing summary.json.
- **Fix:** Introduced `_stub_finder_hardware(monkeypatch, bisect_mod)` helper that patches specific bisect-module functions (`_restart_vllm`, `_stop_vllm`, `_hardware_id`, `_check_dmesg_oom`) rather than subprocess.run globally. The remaining `subprocess.run` patch short-circuits only the `emmy profile hash --write` call; all other subprocess calls pass through to real implementations.
- **Files modified:** `tests/unit/test_kv_finder.py`
- **Verification:** 15/15 kv_finder tests pass
- **Committed in:** `6389561`

**3. [Rule 2 - Missing Critical] `assert_floors` must tolerate null recorded floors**

- **Found during:** Task 3 test design
- **Issue:** Phase 1 PROFILE_NOTES.md ships with `measured_values: {gpu_clock_p5_hour2_mhz: null, ...}`. A strict `assert_floors` would fail every Phase-A CI run because the recorded floor is `None`, and comparing `computed < None * 0.95` raises `TypeError`. The hard gates (preempt/OOM) must still run even when tolerance gates have nothing to compare against.
- **Fix:** `assert_floors` checks `if r_clock not in (None, 0, 'null') and isinstance(r_clock, (int, float))` before computing the tolerance threshold. Hard gates (preempt/oom) always run. Added `test_assert_floors_tolerates_null_recorded` to codify the Phase-1-template-shape behavior.
- **Files modified:** `emmy_serve/thermal/replay.py`, `tests/unit/test_thermal_replay.py`
- **Verification:** 21/21 thermal_replay tests pass
- **Committed in:** `6e64af6`

---

**Total deviations:** 3 auto-fixed (1 blocking + 1 bug + 1 missing-critical). No architectural changes.

**Impact on plan:** All three deviations are in-scope fixes — (1) corpus tuning to actually pass §9.5, (2) test-harness-mocking idiom change for Python 3.12 compatibility, (3) sensible null-tolerance so Phase A CI doesn't spuriously fail against the null template. No scope creep, no new features, no new dependencies.

## Issues Encountered

- **Live vLLM was already running at 127.0.0.1:8002** when this executor started. Per the objective, this Phase A wave did NOT stop or restart that server — the metrics parser was sanity-checked against its /metrics endpoint (`scrape_metrics('http://127.0.0.1:8002')` returned the expected 4 watched metrics), but no load was driven and `start_emmy.sh` was not invoked.
- **Phase B has NOT been run**; all empirical measurements (finder-selected gpu_memory_utilization + recorded hour-2 floors) remain placeholders. See Phase B Launch Instructions below.

## Phase B Launch Instructions

**When:** Operator schedules overnight (or pairs this with `emmy-serve` already running).

**Preconditions:**
1. `emmy-serve` vLLM container running and /metrics reachable at http://127.0.0.1:8002
   (operator runs `./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1` first).
2. Approximately **4.5 hours of wall-clock time** budget:
   - ~70-110 min KV-finder (12 iterations × ~13.5 min each worst-case)
   - ~30 min zero-preemption integration test (SERVE-08 gate)
   - ~120 min first thermal replay with `--record-floors`
   - (Subsequent runs: another 2-hour replay with `--assert-floors` to verify reproducibility — can be same night or next day.)
3. `dmesg -T` readable by the emmy-ci user (tests for OOM signal in finder; safe to run as root if needed).
4. `nvidia-smi` accessible on the host (the thermal sampler shells out to it every 5s).

**Phase B launch commands (run in order; each is a distinct foreground job):**

```bash
cd /data/projects/emmy

# 0. Sanity check — corpus audit + start_emmy boot + smoke + /metrics reachability
uv run python -m emmy_serve.thermal.audit                    # must print PASSES: True
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1
# (wait for ready banner; leaves emmy-serve running)
uv run python -c "from emmy_serve.kv_finder.metrics import scrape_metrics; print(scrape_metrics('http://127.0.0.1:8002'))"
docker stop emmy-serve

# 1. KV-budget finder (~70-110 minutes; finder owns container lifecycle between iterations)
uv run ./scripts/find_kv_budget.py \
    --profile profiles/qwen3.6-35b-a3b/v1 \
    --drive-minutes 10 \
    --max-iters 12 2>&1 | tee runs/kv-finder-$(date -u +%Y%m%dT%H%M%SZ).log

# Finder output:
#   - profiles/qwen3.6-35b-a3b/v1/serving.yaml (updated: gpu_memory_utilization=<measured>)
#   - profiles/qwen3.6-35b-a3b/v1/profile.yaml (hash recomputed)
#   - profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md (KV-finder result block appended)
#   - runs/<iso>-kv-finder/iterations.jsonl + summary.json

# Verify the placeholder was cleared:
uv run python -c "
import yaml
d = yaml.safe_load(open('profiles/qwen3.6-35b-a3b/v1/serving.yaml'))
util = d['engine']['gpu_memory_utilization']
assert util != 0.75, f'still placeholder: {util}'
print(f'gpu_memory_utilization = {util}')"

# 2. Clear the xfail on test_kv_budget_final (Phase C step, but the finder is the trigger):
#    Edit tests/unit/test_serving_yaml.py and delete the
#    @pytest.mark.xfail(...) decorator on test_kv_budget_final.
#    Then:
uv run pytest tests/unit/test_serving_yaml.py::test_kv_budget_final -xvs    # must PASS

# 3. 30-minute zero-preemption integration test (SERVE-08 gate)
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1
uv run pytest tests/integration/test_kv_budget.py::test_zero_preemption \
    -xvs --run-integration --run-slow
# Must exit 0 with "after - before == 0"
docker stop emmy-serve

# 4. 2-hour thermal replay (first run — records floors)
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1
uv run ./scripts/thermal_replay.py \
    --profile profiles/qwen3.6-35b-a3b/v1 \
    --target-wall-time-s 7200 \
    --record-floors 2>&1 | tee runs/thermal-$(date -u +%Y%m%dT%H%M%SZ).log

# Thermal output:
#   - runs/<iso>-thermal/gpu_samples.jsonl (1440 rows over 2h at 5s cadence)
#   - runs/<iso>-thermal/vllm_metrics.jsonl
#   - runs/<iso>-thermal/responses.jsonl
#   - runs/<iso>-thermal/prompts_used.jsonl
#   - runs/<iso>-thermal/dmesg_tail.txt
#   - runs/<iso>-thermal/summary.json
#   - profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md (measured_values populated)
#   - profiles/qwen3.6-35b-a3b/v1/profile.yaml (hash recomputed by record_floors_first_run)

# Verify recorded floors:
grep -A 6 '^measured_values:' profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md

# 5. 2-hour thermal replay (re-run — asserts against recorded floors)
# Schedule for the following evening or early morning.
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v1
uv run ./scripts/thermal_replay.py \
    --profile profiles/qwen3.6-35b-a3b/v1 \
    --target-wall-time-s 7200 \
    --assert-floors
# Must exit 0 with "All floors pass"
docker stop emmy-serve

# 6. Commit the empirical measurements
git add profiles/qwen3.6-35b-a3b/v1/serving.yaml \
        profiles/qwen3.6-35b-a3b/v1/profile.yaml \
        profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md \
        tests/unit/test_serving_yaml.py
git commit -m "feat(01-04): record KV budget + thermal floors for Qwen3.6 v1 (Phase B)

- gpu_memory_utilization: 0.75 -> <MEASURED> (from KV-finder; see runs/<iso>-kv-finder/summary.json)
- measured_values populated: gpu_clock_p5/p50_hour2_mhz, decode_throughput_p50/p1_hour2_tokps
- profile.yaml.hash recomputed
- test_kv_budget_final xfail removed (flipped to PASS post-finder)
- test_zero_preemption PASS over 30-minute load
- two 2-hour thermal replays complete (first --record-floors, second --assert-floors)"

# 7. Final sanity
uv run pytest tests/unit -x                                  # expect all GREEN, no xfails
```

**Pre-flight for each command:**
- If the previous command left an `emmy-serve` container running, `docker stop emmy-serve` first.
- If `./scripts/start_emmy.sh` exits non-zero, inspect `runs/boot-failures/<iso>-boot-failure/` (the D-06 diagnostic bundle).

**Throughput gap carryover from Plan 03:** The Plan 03 checkpoint documented 50 tok/s measured vs 60 tok/s SC-1 floor. The KV-finder will not close this gap by itself — `gpu_memory_utilization` primarily affects preemption, not decode throughput. Further tuning (MoE backend, prefix-caching mode, attention-backend override) is beyond Plan 04's scope. If Phase B reports the KV-finder converging successfully (zero preemption over 30 min) but `test_throughput_floor` still shows 50 tok/s, that's the documented SC-1 regression to revisit in a follow-up plan.

**Failure modes + recovery:**
- **Finder step-up never triggers preemption**: the algorithm exits when `next_val >= 1.0` (§8 line 1280). Final value = `ok_value - 5%`. Acceptable outcome.
- **Finder converges with ok_value == initial (0.75)**: preemption on first step-up. Final value = 0.70. Worth investigating (Spark KV pressure is surprisingly high), but not a finder bug.
- **First thermal replay reports duty cycle <80%**: §9.5 threshold (4) fails. Re-augment the corpus (increase decode sizes, or reduce inter-request gap from 5s to 2s) and re-run the audit + replay.
- **Second thermal replay --assert-floors fails**: `FLOOR FAIL: ...` output names the specific threshold + measured/recorded values. Re-run once to rule out transient environmental variation; if persistent, investigate thermal envelope (fan, ambient temp, other GPU users) before updating recorded floors.

## Next Phase Readiness

**Phase A (this wave):** complete. All code/tests/docs landed on main via 4 commits.

**Phase B (operator-gated on DGX Spark):**
- Ready to launch — see Phase B Launch Instructions above.
- Running Plan 01-04's Task 4 checkpoint work.
- Expected outputs committed via a single `feat(01-04): record KV budget + thermal floors` commit.

**Phase C (post-Phase B bookkeeping):**
- Remove the `@pytest.mark.xfail` decorator on `test_serving_yaml.py::test_kv_budget_final` (Phase B's git diff shows the removal).
- Ensure `uv run pytest tests/unit` is all-green with no xfails.
- `/gsd-verify-work` for Phase 1 becomes reachable once Phase B completes successfully and Phase C's xfail removal is committed.

**Parallel Plan 01-05 (airgap + CI)** completed in this same worktree wave (commits `bc80722`, `32f889a`, `8d3a140`, `9977bd3` — see 01-05-SUMMARY.md). Plans 04 and 05 merge cleanly into main with no cross-plan file conflicts (disjoint files-modified scopes).

## Self-Check: PASSED

Verified against plan acceptance criteria:

**Task 1 — corpus + audit:**
- `test -f .planning/phases/01-serving-foundation-profile-schema/01-04-THERMAL-AUDIT.md && grep -q "PASS" ...` → FOUND (PASSES: True)
- `grep -q "Augmentation Decision" 01-04-THERMAL-AUDIT.md` → FOUND
- `grep -q "PRIOR_CODING_TASKS|SYNTHETIC_AGENT_PROMPTS|TOOL_CALL_SEQUENCE|ALL_THERMAL_PROMPTS" corpus.py` → all FOUND
- `grep -q "def audit_corpus" audit.py` → FOUND
- `uv run python -c "from emmy_serve.thermal.corpus import ALL_THERMAL_PROMPTS; print(len(ALL_THERMAL_PROMPTS))"` → 25 (≥10)
- `uv run python -m emmy_serve.thermal.audit` → exit 0 (PASSES: True)

**Task 2 — KV-finder:**
- `test -f emmy_serve/kv_finder/bisect.py && grep -q "def run_finder" ...` → FOUND
- `grep -q "safety_margin_pct|max_iters|min_step_pct|emmy profile hash" bisect.py` → all FOUND
- `grep -q "vllm:num_preemptions_total|text_string_to_metric_families" metrics.py` → FOUND
- `grep -q "finder_subset" load_driver.py` → FOUND
- `test -x scripts/find_kv_budget.py` → EXECUTABLE
- `uv run python -c "from emmy_serve.kv_finder.bisect import run_finder, main; print('ok')"` → ok
- `uv run ./scripts/find_kv_budget.py --help` → shows argparse usage, exit 0

**Task 3 — thermal replay + sampler:**
- `test -f emmy_serve/thermal/replay.py && grep -q "def run_replay|def compute_floors|def assert_floors" replay.py` → all FOUND
- `grep -q "itertools.cycle|target_wall_time_s|preemptions_hour2|decode_throughput_p50_hour2_tokps" replay.py` → all FOUND
- `grep -q "class GpuSampler|class VllmMetricsSampler|nvidia-smi" sampler.py` → all FOUND
- `test -x scripts/thermal_replay.py` → EXECUTABLE
- `uv run ./scripts/thermal_replay.py --help` → shows argparse usage, exit 0
- `uv run python -c "from emmy_serve.thermal.replay import run_replay, compute_floors, assert_floors, record_floors_first_run; from emmy_serve.thermal.sampler import GpuSampler, VllmMetricsSampler; print('ok')"` → ok

**Full suite:**
- `uv run pytest tests/unit` → 96 passed, 1 skipped (shellcheck), 1 xfailed (test_kv_budget_final — intentional, Phase C clears)

**Commits verified in git log:**
- `aa24cd3` Task 1 — FOUND (`feat(01-04): add thermal corpus + D-14 audit...`)
- `481fb11` Task 2 RED — FOUND (`test(01-04): add RED tests for kv_finder...`)
- `6389561` Task 2 GREEN — FOUND (`feat(01-04): implement KV-finder bisection...`)
- `6e64af6` Task 3 — FOUND (`feat(01-04): implement thermal replay harness...`)

## TDD Gate Compliance

Plan 01-04 is `type: execute` (not `type: tdd`), but Task 2 is marked `tdd="true"`. Gate sequence verified:
- RED commit exists: `481fb11` (test-only, tests skip at collection time via `pytest.importorskip`)
- GREEN commit exists after it: `6389561` (feat implementation makes the tests collectible → all 15 PASS)
- REFACTOR not needed — no behavior change planned post-GREEN for this plan's code.

---
*Phase: 01-serving-foundation-profile-schema*
*Phase A completed: 2026-04-21*
*Phase B + C: operator-gated, see Phase B Launch Instructions above*
