---
phase: 04
plan: 05
subsystem: quality-gates
tags: [audit, d-19, test-only, sc-2, model-agnostic, ci-gate]
requires:
  - pytest (already in dev deps)
  - bun:test (already in workspace)
provides:
  - D-19 structural enforcement of SC-2 across Python + TypeScript trees
  - Deliberate-positive fixtures locking regex strength (silent-weakening guard)
  - CI gate that fires on every `uv run pytest tests/unit/` + `bun test`
affects:
  - All future Phase-4+ plans introducing serving/harness code — any model-name
    conditional trips these tests at merge
tech-stack:
  added:
    - "no-model-conditionals audit (grep-based committed test; first instance of this pattern)"
  patterns:
    - "deliberate-positive fixture paired with self-test (validator-class pattern, parallels tests/fixtures/airgap_{green,red_layer_a}.json)"
    - "path-component allowlist (Python side) vs path-fragment allowlist (TS side) — both robust against nested .venv/node_modules in worktrees"
key-files:
  created:
    - tests/unit/test_no_model_conditionals.py
    - tests/fixtures/no_model_conditionals_positive.py
    - packages/emmy-ux/test/no-model-conditionals.test.ts
    - packages/emmy-ux/test/fixtures/no-model-conditionals-positive.ts
  modified: []
decisions:
  - "Added .claude/ to Python allowlist — parallel worktrees under .claude/worktrees/agent-*/ each carry their own .venv; enumerating absolute paths (REPO_ROOT / .venv) would miss nested third-party code. Switched Python allowlist from absolute-path set to path-COMPONENT name set for symmetry with TS side's fragment-match approach. Documented verbatim inside the test."
  - "Python allowlist uses frozenset of directory NAMES (matched against rel.parts) — treats 'fixtures' as allowlisted wherever it appears, so tests/fixtures/ is automatically skipped without a two-level path entry."
  - "TS regex omits elif/match/when (not JS/TS keywords) and keeps if/else/switch/case — documented divergence from Python regex."
metrics:
  duration_minutes: 15
  completed_date: 2026-04-23
  tasks_completed: 2
  files_created: 4
  files_modified: 0
  tests_added: 4 (2 Python + 2 TypeScript)
---

# Phase 4 Plan 05: No-Model-Conditionals Audit Summary

D-19 LOCKED audit committed as paired Python + TypeScript tests; each has a
self-test mode that requires the regex to fire against a deliberate-positive
fixture (silent-weakening guard) and a real-mode mode that walks the production
source tree and asserts zero hits. Phase 4 SC-2 is now structurally enforced on
every CI pass.

## What landed

### Committed regex patterns (verbatim)

**Python** (`tests/unit/test_no_model_conditionals.py`):

```python
PATTERN = re.compile(
    r"(?i)\b(if|elif|else|switch|when|match|case)\b.*\b(qwen|gemma|hermes|llama)\b"
)
```

**TypeScript** (`packages/emmy-ux/test/no-model-conditionals.test.ts`):

```typescript
const PATTERN = /(?:\b(if|else\s+if|else|switch|case)\b).*\b(qwen|gemma|hermes|llama)\b/i;
```

The TS regex omits `elif`/`match`/`when` (not JS/TS keywords) — the rest is identical in spirit.

### Allowlist contents (verbatim from the committed tests)

**Python — directory NAMES matched as path components** (frozenset):

```
profiles            — YAML/MD content NAMES models; it's data, not code
fixtures            — deliberate positives; caught by self-test only (tests/fixtures)
.venv               — third-party Python deps
node_modules        — third-party JS/TS deps
runs                — evidence/outputs; may contain model names in JSON logs
.planning           — markdown docs name models by design
docs                — markdown docs
dist                — build output
build               — build output
.git                — git internals
.pytest_cache       — test runner cache
__pycache__         — Python bytecode cache
.claude             — agent tooling + parallel worktrees (each has nested .venv)
.mypy_cache         — type-checker cache
.ruff_cache         — linter cache
```

**Python — explicit file allowlist** (frozenset of absolute paths):

```
REPO_ROOT / "tests" / "unit" / "test_no_model_conditionals.py"  — this file contains the regex
```

**TypeScript — path-fragment matches** (substring scans):

```
/node_modules/         — third-party JS/TS deps
/dist/                 — build output
/.vitest_cache/        — test runner cache
/test/fixtures/        — deliberate positives (explicit self-test reader only)
/.git/                 — git internals
/.claude/              — agent tooling + parallel worktrees
```

**TypeScript — explicit path allowlist** (Set<string>):

```
this test file itself        — contains the regex pattern
the positive fixture         — deliberate violations (redundant with /test/fixtures/ but explicit)
```

### Self-test assertion shape

Both languages follow the same pattern:

1. **Python** `test_audit_catches_fixture`:
   ```python
   hits = _find_hits(FIXTURE_POSITIVE)
   assert len(hits) >= 2, "audit failed to detect fixture — regex weakened."
   ```
2. **TypeScript** `test("audit catches fixture (self-test)")`:
   ```typescript
   const hits = findHits(FIXTURE_POSITIVE);
   expect(hits.length).toBeGreaterThanOrEqual(2);
   ```

Both fixtures contain exactly two intentional violations (`if "qwen"` / `elif "gemma"` on the Python side; `if (model.includes("qwen"))` / `else if (model.includes("gemma"))` on the TS side). The `>= 2` threshold provides a small margin for regex-evolution flexibility while still being tight enough that a silent weakening (e.g., dropping `qwen` from the alternation) fails the self-test immediately.

### Real-mode assertion shape

Both languages fail loud with per-line-locatable messages:

**Python** (`pytest.fail("\n".join([...]))`):
```
model-name conditional(s) found in Python source (SC-2 violation):
  path/to/file.py:42: if "qwen" in model_name:
  ...
```

**TypeScript** (`throw new Error(...)`):
```
model-name conditional(s) found in TS source (SC-2 violation):
  packages/emmy-ux/src/foo.ts:42:     if (model.includes("qwen")) { ... }
```

## Violations surfaced in production code

**Zero.** Both real-mode tests are green on first run:

- Python tree walked: `emmy_serve/**/*.py` + `scripts/**/*.py` + `tests/**/*.py` (except `tests/fixtures/`) + `conftest.py` — **0 hits**.
- TypeScript tree walked: `packages/emmy-{ux,telemetry,provider,tools,context}/src/**/*.ts` — **0 hits**.

Legitimate references to model names in the source tree (e.g., `family: gemma-4` as a pydantic `Literal[...]` type in `emmy_serve/profile/schema.py:284`, or a docstring/comment mentioning Gemma 4) are not on lines that also contain a conditional keyword, so the regex correctly ignores them.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `552033c` | test(04-05): add D-19 no-model-conditionals Python audit + self-test |
| 2 | `24a1ac8` | test(04-05): add D-19 no-model-conditionals TypeScript audit + self-test |

## Test results

| Suite | Result |
|-------|--------|
| `uv run pytest tests/unit/test_no_model_conditionals.py -xvs` | 2 passed in 0.31s |
| `uv run pytest tests/unit/ -x` | 173 passed, 1 skipped in 1.33s (no regressions) |
| `cd packages/emmy-ux && bun test test/no-model-conditionals.test.ts` | 2 pass, 0 fail in 16 ms |
| `cd packages/emmy-ux && bun test` | 175 pass, 0 fail in 1.76s (no regressions) |
| `bun test` (repo root, all 5 packages) | 460 pass, 1 skip, 0 fail in 2.96s |
| `bun run typecheck` | all 5 packages exit 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Switched Python allowlist from absolute paths to path-COMPONENT names**

- **Found during:** Task 1 dry-run of the real-mode sweep.
- **Issue:** The plan's action spec defined `ALLOWLIST_DIRS` as absolute paths (`REPO_ROOT / ".venv"`, etc.). The project runs multiple parallel worktrees under `.claude/worktrees/agent-*/`, each with its own nested `.venv/`. Scanning `REPO_ROOT.rglob("*.py")` picked up 8 violations from within `.claude/worktrees/agent-a0595344/.venv/lib/python3.12/site-packages/transformers/**/*.py` — third-party code whose allowlist logic was bypassed because the absolute-path check only matched `REPO_ROOT / ".venv"` (the top-level one).
- **Fix:** Replaced `ALLOWLIST_DIRS` (set of absolute paths) with `ALLOWLIST_DIR_NAMES` (frozenset of directory names) and compare each component of the relative path. Added `.claude`, `.mypy_cache`, and `.ruff_cache` to the set for completeness. This mirrors the TS side's `ALLOWLIST_DIR_FRAGMENTS` approach and is robust against nested dep dirs anywhere in the tree.
- **Files modified:** `tests/unit/test_no_model_conditionals.py` (only — plan iteration).
- **Rationale (Rule 3):** Without this fix, the real-mode test could never pass — it was blocking.
- **Commit:** `552033c` (Task 1 original commit).

**2. [Rule 3 — Blocking] Used `fileURLToPath(import.meta.url)` instead of `__dirname`/`__filename`**

- **Found during:** Task 2 scaffold (before writing).
- **Issue:** The plan's action spec referenced `__dirname` and `__filename`. The @emmy/ux package is ES Module (`"type": "module"` in package.json), so CommonJS-style `__dirname` is not reliably defined. The existing parallel file `packages/emmy-ux/test/profile-loader-no-telemetry.test.ts` uses `dirname(fileURLToPath(import.meta.url))` — that's the established convention.
- **Fix:** Used the ESM-safe pattern. No behavior change; just avoids a runtime `ReferenceError: __dirname is not defined` under bun's ESM loader.
- **Files modified:** `packages/emmy-ux/test/no-model-conditionals.test.ts` (only — plan iteration).
- **Rationale (Rule 3):** Blocking — the test could not execute otherwise.
- **Commit:** `24a1ac8` (Task 2 original commit).

No other deviations. All other aspects of the plan (regex shapes, test names, fixture contents, acceptance criteria) landed verbatim.

## Authentication gates

None. This plan is purely test-only + read-only tree walks; no auth, no secrets, no network.

## Notes for future plans

- **This plan's tests gate every future plan's merges.** Any plan that introduces a `.py` or `.ts` file with a model-name conditional code path will fail CI; author must refactor the model-shaped behavior into profile YAML (SC-2).
- **Allowlist discipline:** expanding the allowlist requires a visible diff in the committed test file; reviewers should challenge any allowlist additions on grounds of SC-2.
- **Known limitation** (T-04-05-04 accept disposition): grep-based audit cannot catch conditionals on a variable that was populated from a model name (e.g., `id = profile.family; if id == "qwen"`). Documented as acceptable; Phase 5+ may upgrade to AST-based if a violation slips through.
- **Fixture immutability:** do NOT modify `tests/fixtures/no_model_conditionals_positive.py` or `packages/emmy-ux/test/fixtures/no-model-conditionals-positive.ts` unless you also update the self-test threshold. Removing a violation from either fixture weakens the silent-weakening guard.

## Threat Flags

None. This plan introduces no new network endpoints, no auth paths, no schema changes at trust boundaries, and no file-access patterns outside the existing pytest/bun test directory walks. The committed threat register in the plan (T-04-05-01 through T-04-05-05) covers the relevant risks; none are extended by the actual implementation beyond what the plan documented.

## Self-Check: PASSED

Files verified:
- `tests/unit/test_no_model_conditionals.py` — FOUND
- `tests/fixtures/no_model_conditionals_positive.py` — FOUND
- `packages/emmy-ux/test/no-model-conditionals.test.ts` — FOUND
- `packages/emmy-ux/test/fixtures/no-model-conditionals-positive.ts` — FOUND

Commits verified:
- `552033c` test(04-05): add D-19 no-model-conditionals Python audit + self-test — FOUND
- `24a1ac8` test(04-05): add D-19 no-model-conditionals TypeScript audit + self-test — FOUND

Tests verified:
- Python self-test + real-mode — 2/2 PASS
- TypeScript self-test + real-mode — 2/2 PASS
- No regressions in tests/unit/ (173/173) or `bun test` (460/461, 1 skip)
- `bun run typecheck` — 5/5 packages exit 0
