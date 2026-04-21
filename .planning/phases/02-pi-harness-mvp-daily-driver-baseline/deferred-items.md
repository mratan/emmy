# Deferred Items — Phase 02

Items out-of-scope for the current plan, logged for later attention.

## From Plan 02-03 (2026-04-21)

### Pre-existing Phase 1 Python regression failures (NOT introduced by 02-03)

`tests/unit/test_thermal_sampler.py` — 7 tests fail with:
```
ImportError: cannot import name 'validate_core_schema' from 'pydantic_core'
```

Verified against HEAD before any 02-03 changes via `git stash`. The failure
stems from a pydantic_core version mismatch that predates this plan. It is
independent of `@emmy/tools` and is therefore deferred. Likewise the
`SKIPPED` entries in `test_schema.py`, `test_thermal_audit.py`, and
`test_thermal_replay.py` are all the same pydantic_core import issue.

Suggested owner: whichever plan updates the Python environment / pydantic
pins next.
