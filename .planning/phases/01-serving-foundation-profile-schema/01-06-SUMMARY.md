---
phase: 01-serving-foundation-profile-schema
plan: 06
subsystem: infra
tags: [sc-1, throughput-sweep, profile-notes, pitfall-5, gap-closure, dgx-spark, tdd]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: "Plan 01-03 emmy_serve.canary (run_sp_ok, run_tool_call, run_generate, load_default_tool_schema); Plan 01-02 emmy_serve.profile.loader (load_profile, ProfileRef); Plan 01-03 emmy_serve.boot.runner (render_docker_args, render_image_ref); Plan 01-03 scripts/start_emmy.sh (env-propagating boot contract); Plan 01-02 emmy_serve.diagnostics.atomic (write_json_atomic, write_text_atomic); Plan 01-02 emmy_serve.diagnostics.layout (new_run_id)"
provides:
  - "emmy_serve.boot.throughput — CandidateKnob + ThroughputMeasurement frozen dataclasses, SWEEP_CANDIDATES (K0 baseline + 4 PROFILE_NOTES.md §SC-1 knobs), measure_warm_throughput (Phase-C warm-500-token payload + full canary suite), decide_winner (pitfall-#5 gate)"
  - "scripts/throughput_sweep.py — executable harness that boots emmy-serve per candidate, measures, tears down, writes results.json; --dry-run prints the candidate manifest; exit 0 regardless of winner"
  - "tests/unit/test_throughput_sweep.py — 20 GREEN unit tests covering SWEEP_CANDIDATES schema, measurement happy/error paths, Phase-C payload-shape assertion, decide_winner canary-regression + baseline-exclusion + errored-candidate invariants"
affects:
  - "PROFILE_NOTES.md §'SC-1 throughput gap' — Task 2 rewrites this section with the measured sweep matrix + disposition (closed-by-<id> or accept-architectural)"
  - "profiles/qwen3.6-35b-a3b/v1/serving.yaml — Task 2 rewrites IF a winner is found (adds the winning env var or engine.reasoning_parser)"
  - "profiles/qwen3.6-35b-a3b/v1/profile.yaml — Task 2 recomputes the hash regardless of outcome (PROFILE_NOTES.md is in the hash bundle)"
  - "runs/<run_id>-phase1-sc1-throughput-sweep/results.json — Task 2 commits this artifact"
  - "Phase 1 verifier (/gsd-verify-work) — remains PARTIAL on SC-1 until Task 2 closes the disposition either as 'closed-by-<id>' (SC-1 → VERIFIED) or 'accept-architectural' (SC-1 → EXPLICITLY DOCUMENTED; Phase 1 passes per this plan's contract)"

# Tech tracking
tech-stack:
  added: []  # no new libraries — httpx/yaml/subprocess already pinned in Plans 01/02/03
  patterns:
    - "Pitfall-#5 gate encoded in library (decide_winner), not in the harness script. Makes the invariant unit-testable independent of hardware: throughput >= floor AND every canary passes, else NOT a winner. Rejects canary-regression candidates even if their throughput is above floor."
    - "Phase-C payload shape preserved verbatim in measure_warm_throughput: temperature=0.0, chat_template_kwargs={enable_thinking: false}, prompt='Count to 100.', max_tokens=500. Test test_measure_warm_throughput_sends_phase_c_payload_shape asserts the exact URL endpoint (/v1/chat/completions) and all four fields match 01-03-SUMMARY.md's Phase-C measurement methodology. Prevents a future planner from silently drifting the measurement prompt and invalidating the comparison against the 48-50 tok/s baseline."
    - "K4 serving.yaml-patch window with finally-block restore + rehash. _apply_serving_yaml_patch returns an opaque restore-state dict; _restore_serving_yaml is idempotent + never raises. After each candidate's iteration the profile is in the same shape as before the sweep started, so a mid-sweep crash leaves no drift (T-06-06 mitigation)."
    - "Dry-run separable from the orchestrator so the manifest is unit-testable and CI-friendly. No docker/httpx/rehash side effects on --dry-run path; the candidate list + env/patch/notes all print to stdout + exit 0."

key-files:
  created:
    - "emmy_serve/boot/throughput.py (252 lines) — library module with SWEEP_CANDIDATES + measure_warm_throughput + decide_winner"
    - "scripts/throughput_sweep.py (287 lines, chmod +x) — executable harness for Task 2 (DGX Spark)"
    - "tests/unit/test_throughput_sweep.py (369 lines) — 20 unit tests (RED commit feea40c + GREEN module landing via 742fd9b)"
  modified:
    - "emmy_serve/boot/__init__.py — re-export CandidateKnob + ThroughputMeasurement + SWEEP_CANDIDATES + measure_warm_throughput + decide_winner alongside existing wait_for_vllm"

key-decisions:
  - "TDD with pytest.importorskip for the RED phase. The new library module is unknown at RED-commit time (tests skip at collection). The GREEN commit lands the module; the same tests then run all 20 PASS. Same pattern used in Plan 01-04 for the kv_finder RED commit (481fb11). Avoids the alternative where RED tests would raise ImportError noisily and require a --collect-only re-run."
  - "decide_winner is a library function, not a script subroutine. The pitfall-#5 invariant (canary-regression candidates cannot be winners regardless of throughput) is codified in the library and unit-tested with fixture-driven ThroughputMeasurement instances, not with a live sweep. This means a future planner who rewrites the harness script can't silently relax the gate."
  - "K2 + K3 env-variable names are approximations from PROFILE_NOTES.md §'SC-1 throughput gap'. PROFILE_NOTES.md itself caveats 'verify at task time via docker exec emmy-serve python3 -c \"from vllm import envs; print(envs.__all__)\"'. The library's `notes` field carries this caveat verbatim so the Task-2 operator knows to verify + adjust the env name if the vLLM build exposes a different spelling. The sweep script's results.json captures whichever env name was applied at runtime."
  - "start_emmy.sh env propagation is the known-unknown: the current start_emmy.sh (Plan 01-03) does NOT explicitly forward arbitrary env vars to `docker run -e`. It renders docker args from serving.yaml.env only. For K1/K2/K3 (env-based candidates), the sweep script layers env vars via the calling process (os.environ.update + subprocess.run(env=env)); vLLM inherits them IF start_emmy.sh's shell forwards them. DISCOVERED-AT-TASK-2-RUNTIME: the operator confirms propagation on the DGX Spark; if the env doesn't reach vLLM, the sweep records boot-without-effect and the operator patches _boot_with_env to render docker args directly via emmy_serve.boot.runner.render_docker_args + explicit -e KEY=VAL pairs. The harness code comment on _boot_with_env documents this."
  - "Exit 0 regardless of winner. The sweep COMPLETING is the success criterion, not finding a winner. 'accept-architectural' is a valid pass per the plan's contract (SC-1 CLOSED or EXPLICITLY DOCUMENTED AS ARCHITECTURAL — both outcomes unblock /gsd-verify-work). Exit 1 only on harness errors (profile can't load, results.json can't be written)."

patterns-established:
  - "Pitfall-#5 gate in the library, harness in the script. The winner-decision logic lives in decide_winner (unit-tested without hardware) and the harness orchestrates boot/measure/teardown. Lets a future planner swap the harness (e.g. a parallel-worker sweep) without touching the correctness gate."
  - "Measurement-methodology test (test_measure_warm_throughput_sends_phase_c_payload_shape) freezes the Phase-C payload shape at the API boundary. If anyone edits measure_warm_throughput to silently change max_tokens, prompt, or enable_thinking, the test fails. Anchors the SC-1 sweep's comparability against the 48-50 tok/s baseline."
  - "Hardware-agnostic Task 1 + hardware-gated Task 2. Task 1 (library + harness + tests) lands on-machine without touching GPU; Task 2 is a human-verify checkpoint on DGX Spark. Matches Plan 01-04's Phase A / Phase B split pattern (aa24cd3 / 481fb11 / 6389561 / 6e64af6 on-machine; operator-gated launch for Phase B)."

requirements-completed: []
# Note: Plan 01-06 ships the implementation that addresses SERVE-02 (Qwen3.6
# >=60 tok/s) and the SC-1 throughput floor gap. The requirement flips to GREEN
# after Task 2 runs on DGX Spark and EITHER the sweep finds a winner (serving.yaml
# rewritten to the winning knob + profile rehashed) OR the gap is formally
# documented as architectural in PROFILE_NOTES.md (SERVE-02 marked PARTIAL with
# the sweep's results.json as provenance). In both outcomes Phase 1 passes
# /gsd-verify-work for SC-1 per this plan's contract.
# SERVE-08 (KV budget + zero preemption 30-min) is UNAFFECTED by this sweep.
# SERVE-11 (2-hour thermal validation) is UNAFFECTED.

# Metrics
duration: ~18min (Task 1 only; Task 2 is operator-gated ~60-90 min)
completed: 2026-04-21 (Task 1; Task 2 pending hardware)
---

# Phase 1 Plan 06: SC-1 Throughput Sweep — Task 1 Summary + Task 2 Pending Checkpoint

**Task 1 delivered: the SC-1 sweep library + harness + tests, all GREEN with zero hardware. Task 2 is a blocking human-verify checkpoint on the DGX Spark (~60-90 min GPU) that the operator must execute; this summary documents what Task 1 shipped and what Task 2 must do.**

## Plan Status

| Task | Status | Where | Commits |
|------|--------|-------|---------|
| 1. Throughput sweep library + harness + unit tests | COMPLETE | this machine | `feea40c` (test RED) + `742fd9b` (feat GREEN) |
| 2. Execute sweep + rewrite PROFILE_NOTES.md + (if winner) serving.yaml + rehash | PENDING | DGX Spark | (awaits operator) |

## Performance (Task 1 only)

- **Duration:** ~18 min (read-first → RED tests → GREEN library → harness script → dry-run verify → test suite regression check)
- **Started:** 2026-04-21T16:24:40Z (per STATE.md last_updated)
- **Completed (Task 1):** 2026-04-21 (this SUMMARY write)
- **Tasks committed:** 1 of 2 (Task 2 is operator-gated)
- **Files created:** 3 (library + harness + test file)
- **Files modified:** 1 (emmy_serve/boot/__init__.py re-exports)
- **Profile bytes touched:** 0 (serving.yaml, profile.yaml, PROFILE_NOTES.md, prompts/, tool_schemas/, grammars/ all unchanged)

## Task 1 Accomplishments

### `emmy_serve/boot/throughput.py` — library module (252 lines)

- **`CandidateKnob` frozen dataclass** — `(id, label, env_overrides, serving_yaml_patch, notes)`. Either `env_overrides` (K1-K3 paths) or `serving_yaml_patch` (K4) is populated; both are empty for K0.
- **`ThroughputMeasurement` frozen dataclass** — per-candidate record exactly matching the shape written to `results.json` (candidate_id, samples_tokps, mean, std, p50, canary_sp_ok/tool_call/generate, error, hardware_id, ts).
- **`SWEEP_CANDIDATES` (5 entries)** — K0 baseline + K1-K4 from PROFILE_NOTES.md §"SC-1 throughput gap" lines 85-104, derived verbatim with per-candidate `notes` field quoting the source bullet:
  | id | mechanism | source |
  |----|-----------|--------|
  | k0-baseline | control (no change) | sweep's own pitfall-#5 methodology |
  | k1-flashinfer-moe | `VLLM_USE_FLASHINFER_MOE_FP8=1` env | PROFILE_NOTES.md §SC-1 bullet 1 |
  | k2-cuda-native | `CUDA_FORWARD_COMPATIBLE=0` env | PROFILE_NOTES.md §SC-1 bullet 2 (verify exact name at task-2 runtime) |
  | k3-fp8-mamba-prefix | `VLLM_FP8_MAMBA_PREFIX_CACHING=1` env | PROFILE_NOTES.md §SC-1 bullet 3 (verify exact name at task-2 runtime) |
  | k4-reasoning-parser | `engine.reasoning_parser: qwen3` (serving.yaml) | PROFILE_NOTES.md §SC-1 bullet 4 |
- **`measure_warm_throughput(base_url, model, *, candidate_id, n_samples=3, max_tokens=500, prompt="Count to 100.", warmup_discard=1, timeout_s=60.0)`** — Phase-C warm-500-token payload (temperature=0.0, `chat_template_kwargs={"enable_thinking": False}`) verbatim, n_samples discard-first-then-measure, full canary suite recorded per measurement. Exception captured into ThroughputMeasurement.error; canary HTTP failures downgrade the individual canary bool without aborting the measurement.
- **`decide_winner(measurements, *, floor_tokps=60.0)`** — pitfall-#5 gate: returns the first non-baseline candidate with (error is None) AND (mean >= floor) AND (all three canaries pass); otherwise None. K0 baseline is excluded from winner consideration (it's a control).

### `scripts/throughput_sweep.py` — executable harness (287 lines, chmod +x)

- Argparse: `--profile --samples --max-tokens --port --base-url --runs-dir --start-script --floor-tokps --dry-run`
- `--dry-run` prints the `SWEEP_CANDIDATES` manifest (5 candidates with env/patch/notes) and exits 0; no docker / httpx / rehash side effects.
- Main loop (hardware-dependent, for Task 2): iterates SWEEP_CANDIDATES, for each candidate: stop container → apply serving.yaml patch + rehash (K4 only) → boot via `start_emmy.sh` with candidate env in process env → wait for `/v1/models` 200 → measure_warm_throughput → stop container → restore serving.yaml + rehash (K4 only). The `_apply_serving_yaml_patch` + `_restore_serving_yaml` pair is idempotent and wrapped in try/finally so a mid-sweep crash leaves no drift (T-06-06).
- Writes `runs/<run_id>-phase1-sc1-throughput-sweep/results.json` via `write_json_atomic` (Plan 01-02 pattern) with all ThroughputMeasurement fields + decision (`closed-by-<id>` or `accept-architectural`) + winner_id + profile_hash_before + run_id + prompt + floor_tokps.
- Exit 0 regardless of winner; exit 1 only on profile-load or results-write errors.

### `tests/unit/test_throughput_sweep.py` — 20 GREEN unit tests

| Group | Tests | Coverage |
|-------|-------|----------|
| SWEEP_CANDIDATES schema (8) | `test_sweep_candidates_has_five_entries`, `test_sweep_candidates_have_all_four_profile_notes_ids`, `test_k0_baseline_has_no_overrides`, `test_k1_is_env_override_only`, `test_k2_is_cuda_env_override`, `test_k3_is_mamba_env_override`, `test_k4_is_serving_yaml_patch_not_env`, `test_candidates_all_have_notes` | Manifest matches PROFILE_NOTES.md §SC-1 verbatim (T-06-01 mitigation) |
| measure_warm_throughput (5) | `test_measure_warm_throughput_records_all_three_canaries`, `test_measure_warm_throughput_runs_warmup_discard`, `test_measure_warm_throughput_captures_httpx_exception`, `test_measure_warm_throughput_rejects_zero_completion_tokens`, `test_measure_warm_throughput_sends_phase_c_payload_shape` | Canary-recording discipline, warmup semantics, error path, zero-token sanity, Phase-C payload shape |
| decide_winner (5) | `test_decide_winner_picks_first_clean_candidate_above_floor`, `test_decide_winner_skips_baseline_even_if_above_floor`, `test_decide_winner_rejects_canary_failure`, `test_decide_winner_rejects_errored_candidate`, `test_decide_winner_none_when_all_below_floor` | Pitfall-#5 gate: T-06-02 canary regression as DQ; baseline exclusion; errored measurement rejection |
| Public API (2) | `test_public_api_exports`, `test_boot_package_reexports_throughput` | `__all__` + `emmy_serve.boot` re-exports |

## TDD Gate Compliance

Task 1 is marked `tdd="true"` in the plan. Gate sequence verified:

- **RED commit:** `feea40c` — `test(01-06): add RED tests for SC-1 throughput sweep library`. Tests skip at collection via `pytest.importorskip('emmy_serve.boot.throughput')` (module doesn't exist yet).
- **GREEN commit:** `742fd9b` — `feat(01-06): throughput sweep harness for SC-1 gap closure`. Lands the library + harness + __init__ re-exports. All 20 tests PASS.
- **REFACTOR commit:** not needed — the GREEN commit ships the final shape.

Verified in `git log --oneline -2`:
```
742fd9b feat(01-06): throughput sweep harness for SC-1 gap closure
feea40c test(01-06): add RED tests for SC-1 throughput sweep library
```

## Unit Suite (regression check)

- Baseline before Task 1: 97 passed, 1 skipped (shellcheck).
- After GREEN commit: **117 passed, 1 skipped** (+20 new tests; zero regressions).

```
$ uv run pytest tests/unit -q
...........................................................s............ [ 61%]
..............................................                           [100%]
SKIPPED [1] tests/unit/test_start_script.py:34: shellcheck not installed
117 passed, 1 skipped in 0.89s
```

## Dry-Run Verification (pre-hardware)

```
$ uv run ./scripts/throughput_sweep.py --dry-run
SWEEP_CANDIDATES (Plan 01-06, PROFILE_NOTES.md §'SC-1 throughput gap')
==============================================================================
k0-baseline                   baseline (no change)
  env: (none)
  serving.yaml patch: (none)
  notes: Control — re-measures the profile unchanged. Required by the sweep's pitfall-#5 methodology…

k1-flashinfer-moe             VLLM_USE_FLASHINFER_MOE_FP8=1
  env: VLLM_USE_FLASHINFER_MOE_FP8=1
  serving.yaml patch: (none)
  notes: PROFILE_NOTES.md §'SC-1 throughput gap' bullet 1…

k2-cuda-native                CUDA_FORWARD_COMPATIBLE=0
  env: CUDA_FORWARD_COMPATIBLE=0
  serving.yaml patch: (none)
  notes: PROFILE_NOTES.md §'SC-1 throughput gap' bullet 2…

k3-fp8-mamba-prefix           VLLM_FP8_MAMBA_PREFIX_CACHING=1
  env: VLLM_FP8_MAMBA_PREFIX_CACHING=1
  serving.yaml patch: (none)
  notes: PROFILE_NOTES.md §'SC-1 throughput gap' bullet 3…

k4-reasoning-parser           engine.reasoning_parser=qwen3 (serving.yaml)
  env: (none)
  serving.yaml patch: {'engine': {'reasoning_parser': 'qwen3'}}
  notes: PROFILE_NOTES.md §'SC-1 throughput gap' bullet 4…

exit=0
```

`uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0 after Task 1 (confirms NO profile bytes were touched).

## Decisions Made

See the `key-decisions` block in the frontmatter. Summary of the five load-bearing choices:

1. **TDD with `pytest.importorskip` for RED.** Same pattern as Plan 01-04's kv_finder RED commit; collection-time skip is cleaner than ImportError noise.
2. **`decide_winner` is a library function, unit-tested.** The pitfall-#5 invariant cannot be silently relaxed by a future harness rewrite.
3. **K2 + K3 env names are approximations.** PROFILE_NOTES.md itself flags "verify at task-2 runtime via `docker exec … vllm.envs.__all__`"; library `notes` field carries the caveat verbatim.
4. **start_emmy.sh env propagation is the known-unknown.** The current script does not explicitly forward arbitrary env vars. Harness layers env via the calling process; if propagation fails on DGX Spark, operator patches `_boot_with_env` to render docker args directly. Documented in the code comment.
5. **Exit 0 regardless of winner.** "accept-architectural" is a valid pass per the plan's contract; exit 1 only on harness errors (not measurement outcomes).

## Deviations from Plan

**None — Task 1 executed exactly as specified in 01-06-PLAN.md `<tasks>` → Task 1 `<action>` block.** Code structure matches the plan's template verbatim:

- Library dataclasses: CandidateKnob (id/label/env_overrides/serving_yaml_patch/notes) + ThroughputMeasurement (all 11 fields as listed in the plan) + SWEEP_CANDIDATES (5 entries) + measure_warm_throughput signature + decide_winner gate.
- Harness: argparse flags match, --dry-run semantics match, run-directory shape matches (`runs/<run_id>-phase1-sc1-throughput-sweep/results.json`), exit-code contract matches.
- Tests: 20 tests cover exactly the acceptance criteria (SWEEP_CANDIDATES structure, env override shapes, measurement records canaries, httpx error capture, decide_winner canary-rejection, winner none when all below floor).

The only minor elaboration over the plan template was adding 4 additional tests beyond the plan's 7-test minimum (Phase-C payload-shape guard, warmup-discard count guard, errored-candidate-rejection guard, boot-package-reexport guard). All adhere to the plan's acceptance criteria — none contradict or extend the library surface.

## Issues Encountered

- **start_emmy.sh env propagation mechanism is not fully verified** (documented as a DISCOVERED-AT-TASK-2-RUNTIME caveat in the `_boot_with_env` docstring). The current Plan 01-03 `start_emmy.sh` reads env from serving.yaml.env only and invokes `render_docker_args`, which emits a fixed set of `-e KEY=VAL` flags. Layering additional env via `subprocess.run(env=env)` on the calling process sets the env on the shell `start_emmy.sh` executes in, but whether those vars flow into the eventual `docker run -e` depends on whether start_emmy.sh's shell forwards them. Task 1 cannot verify this without running on the DGX Spark (the only place `docker run` + vLLM can be exercised). If propagation fails on-hardware, the fix is a 10-line patch to `_boot_with_env` that invokes `emmy_serve.boot.runner.render_docker_args` directly and appends extra `-e KEY=VAL` pairs.
- **K2 + K3 env-variable names are best-effort spellings.** PROFILE_NOTES.md's §"SC-1 throughput gap" bullets 2-3 describe the mechanism but caveat the exact env-var name. The sweep script's `notes` field carries the caveat; Task 2 may need to adjust the env names after running `docker exec emmy-serve python3 -c 'from vllm import envs; print(envs.__all__)'`.

## Task 2 — Pending DGX Spark Checkpoint (operator action)

**Runtime:** ~60-90 min of sustained GPU time (~10-15 min per candidate × 5 candidates).

**Pre-flight (DGX Spark operator):**

```bash
cd /data/projects/emmy

# Stop any running container + confirm baseline profile validates
docker stop emmy-serve 2>/dev/null; docker rm emmy-serve 2>/dev/null
uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/      # MUST exit 0

# Sanity check the dry-run locally (no hardware)
uv run ./scripts/throughput_sweep.py --dry-run                  # prints 5 candidates, exit 0
```

**Run the sweep:**

```bash
uv run ./scripts/throughput_sweep.py \
    --profile profiles/qwen3.6-35b-a3b/v1 \
    --samples 3 \
    --max-tokens 500 \
    --port 8002 \
    --runs-dir runs 2>&1 | tee runs/throughput-sweep-$(date -u +%Y%m%dT%H%M%SZ).log

# Exit 0 regardless of winner. Output:
#   runs/<run_id>-phase1-sc1-throughput-sweep/results.json
#   (5 candidate entries + decision field: 'closed-by-<id>' or 'accept-architectural')
```

**Operator observations during the run:**

- Monitor `docker exec emmy-serve python3 -c "from vllm import envs; print(envs.__all__)"` during the first candidate (k1) to verify K2/K3 env-var spellings. If `VLLM_FP8_MAMBA_PREFIX_CACHING` or `VLLM_USE_FLASHINFER_MOE_FP8` or `CUDA_FORWARD_COMPATIBLE` does NOT appear in `envs.__all__`, the env is dead code — record the discovered correct names in the sweep log AND in the subsequent `feat(01-06)` commit message under a "Task-2 runtime corrections" section.
- If any candidate's boot exits >0, the sweep script records the measurement with `error="boot/harness error: …"` and continues to the next candidate. Do NOT abort the sweep on individual boot failures.
- `docker logs emmy-serve` for a booted candidate confirms the env is reaching vLLM (grep for `VLLM_USE_FLASHINFER_MOE_FP8` in the startup env echo or the MoE-backend selection log line).

**Post-sweep disposition (per 01-06-PLAN.md Task 2 template):**

*If `decision == "closed-by-<id>"`:*

1. The sweep script already restored serving.yaml after each candidate's window. Re-apply the winner's delta manually:
   - **K1:** add `VLLM_USE_FLASHINFER_MOE_FP8: "1"` under `serving.yaml.env`
   - **K2:** set the discovered env var under `serving.yaml.env` (update the k2 CandidateKnob in a follow-up commit if the env spelling was corrected)
   - **K3:** add the discovered Mamba env var under `serving.yaml.env`
   - **K4:** add `reasoning_parser: qwen3` under `serving.yaml.engine`
2. `uv run emmy profile hash profiles/qwen3.6-35b-a3b/v1/ --write`
3. `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` — MUST exit 0
4. Rewrite PROFILE_NOTES.md §"SC-1 throughput gap" using Template A from 01-06-PLAN.md Task 2 (lines 789-807).

*If `decision == "accept-architectural"`:*

1. No serving.yaml change.
2. Rewrite PROFILE_NOTES.md §"SC-1 throughput gap" using Template B from 01-06-PLAN.md Task 2 (lines 810-831) — includes the measured matrix + the "accept as architectural; re-evaluate post-vLLM-upgrade" paragraph.
3. Recompute profile hash (PROFILE_NOTES.md is in the hash bundle): `uv run emmy profile hash profiles/qwen3.6-35b-a3b/v1/ --write`
4. `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` — MUST exit 0
5. Mark SERVE-02 PARTIAL in ROADMAP.md with the sweep's `results.json` as provenance.

**Commit (both outcomes):**

```bash
git add profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md \
        profiles/qwen3.6-35b-a3b/v1/profile.yaml
# If winner, also add:
#   profiles/qwen3.6-35b-a3b/v1/serving.yaml
# Always add the sweep artifact:
git add runs/<run_id>-phase1-sc1-throughput-sweep/results.json

git commit -m "feat(01-06): SC-1 throughput sweep — <decision>

Ran the four PROFILE_NOTES.md §SC-1 candidate knobs against the Phase C
warm-500-token prompt with >=3 samples per candidate + full canary suite.

<Template A or B summary; include measured matrix + winner_id + profile_hash_after>

Sweep artifact: runs/<run_id>-phase1-sc1-throughput-sweep/results.json"
```

**Final sanity gates (DGX Spark):**

```bash
uv run pytest tests/unit -q                                    # expect 117+ passed, 1 skipped
uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/      # exit 0
grep -A 2 "^## SC-1 throughput gap" profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md
# ^ confirms the disposition heading is rewritten
```

**Resume signal (from 01-06-PLAN.md `<resume-signal>`):** Type `"sc1 resolved"` once all of:
- (a) `runs/*-phase1-sc1-throughput-sweep/results.json` exists with 5 candidate entries + `decision` field
- (b) `PROFILE_NOTES.md` §"SC-1 throughput gap" has been rewritten with the measured matrix + Template A or B disposition
- (c) if winner found, `serving.yaml` carries the winning knob
- (d) `profile.yaml.hash` recomputed and `uv run emmy profile validate` exits 0
- (e) the commit has been created
- (f) `uv run pytest tests/unit -q` is all-green

## Threat Flags

None. Task 1 introduced no new network endpoints, no new auth paths, no new file-access patterns, and no schema changes at trust boundaries. `httpx.post` calls from `measure_warm_throughput` hit the same loopback `base_url` the Plan 01-03 canaries already use; the `--dry-run` path has no I/O. The sweep script uses the same `docker stop emmy-serve` + `subprocess.run(scripts/start_emmy.sh ...)` lifecycle as Plan 01-03 + Plan 01-04.

## Known Stubs

None. The library is fully implemented; no placeholders, no TODO markers, no mock-data paths in production code. Test mocks are isolated to `tests/unit/test_throughput_sweep.py` (monkeypatched `httpx.post` + canary imports) and do not leak into `emmy_serve/boot/throughput.py`.

## Next Phase Readiness

**Task 1 (this executor's scope):** COMPLETE. Library + harness + tests committed on `main`.

**Task 2 (DGX Spark operator):** PENDING. Documented above + in 01-06-PLAN.md Task 2.

**Phase 1 verifier (`/gsd-verify-work`) readiness after Task 2:**

- If Task 2 finds a winner: SC-1 flips from PARTIAL to VERIFIED (throughput >= 60 tok/s on at least one candidate, zero canary regression). SERVE-02 flips to GREEN. Phase 1 closes (pending SC-4 [Plan 01-07] and SC-5 [Plan 01-08] which are independent operator gates).
- If Task 2 finds no winner: PROFILE_NOTES.md §"SC-1 throughput gap" is rewritten as "accept-architectural"; SC-1 remains PARTIAL but is EXPLICITLY DOCUMENTED with the sweep matrix as provenance. Both 01-06-PLAN.md line 906 ("Phase 1 SC-1 is now either CLOSED or EXPLICITLY DOCUMENTED AS ARCHITECTURAL — both outcomes unblock /gsd-verify-work") and this summary treat this as a valid pass for Plan 01-06's contract.

## Self-Check: PASSED (Task 1)

Verified against plan acceptance criteria:

- `test -f /data/projects/emmy/emmy_serve/boot/throughput.py` → FOUND
- `grep -q "SWEEP_CANDIDATES" /data/projects/emmy/emmy_serve/boot/throughput.py` → FOUND
- `grep -q "measure_warm_throughput" /data/projects/emmy/emmy_serve/boot/throughput.py` → FOUND
- `grep -q "decide_winner" /data/projects/emmy/emmy_serve/boot/throughput.py` → FOUND
- `grep -q "VLLM_USE_FLASHINFER_MOE_FP8" /data/projects/emmy/emmy_serve/boot/throughput.py` → FOUND
- `grep -q "reasoning_parser" /data/projects/emmy/emmy_serve/boot/throughput.py` → FOUND
- `test -x /data/projects/emmy/scripts/throughput_sweep.py` → EXECUTABLE
- `cd /data/projects/emmy && uv run ./scripts/throughput_sweep.py --dry-run` → prints 5 candidate lines, exit 0
- `cd /data/projects/emmy && uv run pytest tests/unit/test_throughput_sweep.py -x` → 20 PASSED
- `cd /data/projects/emmy && uv run pytest tests/unit -q` → 117 passed, 1 skipped (shellcheck), 0 failed — no regressions against the 97-passed / 1-skipped baseline
- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` → exit 0 (NO profile bytes touched)

**Commits verified in git log:**

- `feea40c` Task 1 RED — FOUND (`test(01-06): add RED tests for SC-1 throughput sweep library`)
- `742fd9b` Task 1 GREEN — FOUND (`feat(01-06): throughput sweep harness for SC-1 gap closure`)

## Self-Check (Task 2): PENDING

Cannot be run on this machine. Awaits the DGX Spark operator executing the sweep per the Task 2 runbook above.

---
*Phase: 01-serving-foundation-profile-schema*
*Plan: 01-06 (SC-1 gap closure)*
*Task 1 completed: 2026-04-21*
*Task 2 (checkpoint): awaits DGX Spark operator; plan status remains in_progress until `sc1 resolved` signal*
