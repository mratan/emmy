# Phase 04.6 — Deferred Items

Out-of-scope discoveries logged during execution. Per executor SCOPE BOUNDARY:
do not fix issues unrelated to the current task; record here for future cleanup.

## Pre-existing pydantic_core ImportError (worktree env)

**Discovered during:** Plan 04.6-02 (scrubber) GREEN verification.

**Symptom:** `ImportError: cannot import name 'validate_core_schema' from 'pydantic_core'`
at collection time for these test modules:

- `tests/unit/test_profile_schema_memory.py`
- `tests/unit/test_sidecar_sse.py`
- `tests/unit/test_sidecar_start.py`
- `tests/unit/test_sidecar_state.py`
- `tests/unit/test_sidecar_status.py`
- `tests/unit/test_sidecar_stop.py`
- `tests/unit/test_swap_preflight_fail.py`
- `tests/unit/test_swap_rollback.py`

Plus runtime failures in `test_thermal_sampler.py` from the same root cause
(`pydantic._internal._core_utils` chain into `pydantic_core` mismatch).

Skipped (collection-time guards) in:
- `test_docker_run_build.py`, `test_immutability.py`, `test_kv_finder.py`,
  `test_profile_schema_gemma4.py`, `test_schema.py`, `test_thermal_audit.py`,
  `test_thermal_replay.py`.

**Root cause:** Worktree's resolved `pydantic` (system site-packages at
`/home/srpost/shared/nvidia-venv`) imports `validate_core_schema` from a newer
pydantic-core than what is installed at `/home/mratanap/.local/lib/python3.12/
site-packages/pydantic_core`. Two interpreters/site-packages chains are
shadowing each other; the conflict pre-dates this plan's commits.

**Why deferred:**
- 100% pre-existing (reproducible at the plan's base commit `d12908c` before
  any 04.6-02 file was added).
- No scrubber work touches pydantic, schema loading, or any sidecar/thermal
  surface.
- Plan 04.6-02's scope is the standalone scrubber library; the 20 new tests
  collect and pass cleanly.

**Suggested follow-up:** Phase 04.6 close-out or a separate dev-environment
sweep should pin `pydantic-core` consistent with the `pydantic` resolved by
`uv run`. Not blocking ask-claude bridge functionality.
