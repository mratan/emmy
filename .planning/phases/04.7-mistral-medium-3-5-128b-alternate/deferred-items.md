# Plan 04.7-02 — Deferred items (out-of-scope discoveries)

## 2026-05-02 — pytest environment skips schema/runner tests in worktree

**Discovered during:** Plan 04.7-02 Task 1 verification.

**Symptom:** Running `uv run pytest tests/unit/test_profile_bundle_mistral.py
tests/unit/test_profile_schema_gguf.py tests/unit/test_docker_run_build.py`
inside the worktree results in `pytest.importorskip` skipping all three test
files because pytest imports the user-site `pydantic_core` (in
`/home/mratanap/.local/lib/python3.12/site-packages/`) which lacks
`validate_core_schema` (a name the venv's pydantic uses).

The same `emmy_serve.profile.schema` import works perfectly via `uv run emmy
profile validate` (exits 0; ServingConfig pydantic model loads cleanly). The
issue is purely pytest's import resolution order picking the user-site
pydantic_core ahead of the venv's.

**Why out of scope for this plan:**
- Pre-existing — Plan 04.7-01 SUMMARY claims "342 passed" so the test infra
  works in *some* environment (likely the original Spark non-worktree clone,
  pre-user-site pollution).
- Not caused by this plan's edits — the test files themselves are
  Plan 04.7-01 artifacts; no changes to them in 04.7-02.
- Functional equivalent verification path is intact: `uv run emmy profile
  validate profiles/mistral-medium-3.5/v1` exits 0 (the schema invariant the
  unit tests assert is verified end-to-end).

**Suggested fix (for a future cleanup plan):**
- Add `PYTHONNOUSERSITE=1` to the project's pytest invocation, OR
- Pin `pytest` + plugins inside `[dependency-groups.dev]` of pyproject.toml so
  `uv run pytest` always uses the venv's pytest (currently `which pytest`
  resolves to a system path).
- Alternatively, replace `pytest.importorskip("emmy_serve.profile.schema")`
  with a direct `import` so the failure is loud and points at the real cause.
