---
phase: 02-pi-harness-mvp-daily-driver-baseline
plan: 07
subsystem: profile-registry
tags: [profile-v2, harness-yaml, xgrammar, lark-grammar, tool-schemas, hash-anchored-edit, max-model-len, sc-5, phase-1-schema-patch]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: profile bundle schema + hasher + validator CLI (emmy profile validate/hash --write), v1 profile reference with KV-measured gpu_memory_utilization=0.88
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-01)
    provides: v2 profile bundle cloned from v1 (harness.yaml with TODO(Phase-2) placeholders; stale v1 hash marked KNOWN-STALE)
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-02)
    provides: "@emmy/provider GrammarConfig {path, mode} type (nested shape); ProfileSnapshot with REQUIRED max_model_len"
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-04)
    provides: "@emmy/ux computeMaxInputTokens (honest SC-5 derivation); profile-loader.parseGrammarConfig that rejects flattened-string grammar; max-model-len.test.ts with TODO(plan-07) skipped regression"
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-06)
    provides: "registerNativeTools parameter schemas (the SOURCE OF TRUTH projected into v2/tool_schemas/*.schema.json)"
provides:
  - "v2 profile bundle is Phase-2-production-ready: every TODO(Phase-2) field in harness.yaml filled with a real value + PROFILE_NOTES.md provenance citation"
  - "v2 harness.yaml tools.grammar is NESTED {path: grammars/tool_call.lark, mode: reactive} per CONTEXT D-11 (B3/C3 fix); @emmy/ux profile-loader + @emmy/provider GrammarConfig both consume this directly"
  - "v2 context.max_input_tokens = 114688 — honest SC-5 derivation via scripts/compute_max_input_tokens.ts (max_model_len 131072 - output_reserve 16384)"
  - "v2 grammars/tool_call.lark (45-line XGrammar Lark; over-accepting per D-11 backstop discipline) covering all 8 native tool-call envelopes"
  - "v2 tool_schemas/*.schema.json (8 OpenAI-format JSON files mirror registerNativeTools declarations byte-for-byte in the parameters block)"
  - "v2 prompts/edit_format.md (Hashline hash-anchored per-line docs) + prompts/tool_descriptions.md (1786 chars < 2000 HARNESS-06 budget)"
  - "v2 PROFILE_NOTES.md Harness (Phase 2) provenance table (PROFILE-05) + Phase-1-schema-patch narrative"
  - "v2 profile.yaml.hash RECOMPUTED (sha256:0025799f...53fa41); KNOWN-STALE warning comment auto-stripped by hash --write"
  - "Phase-1 pydantic ToolsConfig.grammar accepts nested GrammarConfig (backward-compatible: None still valid; v1 still loads)"
  - "Plan-04 TODO(plan-07) max-model-len regression test un-skipped and GREEN — SC-5 consistency gate now enforced in CI"
  - "scripts/compute_max_input_tokens.ts — reusable bun script (profile-dir arg) printing JSON {max_input_tokens, derivation}; consumed by Plan 08 if it needs to re-derive"
affects:
  - "02-08 SC-2/3/4/5 evidence runners — targets profiles/qwen3.6-35b-a3b/v2/ which now validates and has the reactive grammar path populated; SC-3 no-grammar baseline path (D-14) will flip tools.grammar.mode=disabled on one run"
  - "02-09 SC-1 walkthrough + CLOSEOUT — references the Phase-1-schema-patch commit SHA 88e48a4 in its addendum so the dated history is discoverable"
  - "Phase 1 schema (emmy_serve/profile/schema.py): nested GrammarConfig now present; Phase-3/4/5/6 profiles can adopt the reactive knob or leave grammar: null"

# Tech tracking
tech-stack:
  added:
    - "js-yaml@4.1.0 at repo root (was emmy-ux-only) + @types/js-yaml@4.0.9 — enables scripts/*.ts to run via `bun scripts/*.ts` from the repo root"
    - "GrammarConfig pydantic BaseModel in emmy_serve/profile/schema.py (Phase-2 D-11 nested-shape lock)"
  patterns:
    - "CONTEXT D-11 reactive grammar activation (vs. always-on): tools.grammar.mode = reactive in production, disabled for SC-3 no-grammar baseline. The mode knob lives in the profile, not in code."
    - "XGrammar Lark backstop-not-shape-enforcer (D-11): grammar accepts any JSON object for arguments; per-tool shape validation lives in @emmy/tools (tool_schemas/*.schema.json). Tightening is reserved for Phase 5 once SC-3 data exists."
    - "PROFILE-05 provenance-table discipline: every default value in harness.yaml cites its source URL or measurement. Applies to v3+ profiles as they land."
    - "Hash-recompute ritual: after any v<N>/ file change, run `uv run emmy profile hash <dir> --write` then `uv run emmy profile validate <dir>`. The --write step auto-strips the KNOWN-STALE comment by rewriting profile.yaml."

key-files:
  created:
    - profiles/qwen3.6-35b-a3b/v2/grammars/tool_call.lark
    - profiles/qwen3.6-35b-a3b/v2/prompts/edit_format.md
    - profiles/qwen3.6-35b-a3b/v2/prompts/tool_descriptions.md
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/read.schema.json
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/write.schema.json
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/edit.schema.json
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/bash.schema.json
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/grep.schema.json
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/find.schema.json
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/ls.schema.json
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/web_fetch.schema.json
    - scripts/compute_max_input_tokens.ts
  modified:
    - profiles/qwen3.6-35b-a3b/v2/harness.yaml (every TODO(Phase-2) replaced)
    - profiles/qwen3.6-35b-a3b/v2/profile.yaml (hash recomputed; KNOWN-STALE comment stripped)
    - profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md (Harness (Phase 2) provenance + Phase-1-schema-patch note appended)
    - emmy_serve/profile/schema.py (GrammarConfig BaseModel added; ToolsConfig.grammar Optional[str] → Optional[GrammarConfig])
    - emmy_serve/profile/__init__.py (GrammarConfig exported)
    - packages/emmy-ux/tests/max-model-len.test.ts (un-skipped Plan-07 regression; body implements SC-5 consistency check)
    - package.json (root devDeps += js-yaml, @types/js-yaml, @emmy/ux workspace link)
    - bun.lock
  deleted:
    - profiles/qwen3.6-35b-a3b/v2/grammars/.gitkeep (replaced by tool_call.lark)
    - profiles/qwen3.6-35b-a3b/v2/tool_schemas/.gitkeep (replaced by 8 .schema.json files)

key-decisions:
  - "Phase-1 schema patch WAS needed (B3/C3 discovery confirmed). ToolsConfig.grammar was Optional[str]; the CONTEXT D-11 nested shape required a GrammarConfig BaseModel. Narrow patch: added GrammarConfig class + changed grammar: Optional[str] → Optional[GrammarConfig]; all other fields unchanged. v1's `grammar: null` still validates (backward-compatible with Optional). Phase 1 tests: 137 pass / 1 skip unchanged. Committed as dated discrete commit `88e48a4` per plan Step 0 instruction so 02-09 CLOSEOUT can cite it."
  - "max_model_len kept at 131072 (unchanged from v1). The v1 serving.yaml already carried it as honest Phase-1-measured. CONTEXT notes Qwen3.6-35B-A3B supports up to 262K with YaRN but 131K is the honest native value Phase 1 chose. No newer HF revision data available in the local HF cache at plan-execution time (refs/main only, no config.json cached). Decision: use the already-committed 131072 value; no change to serving.yaml beyond confirming it passes validation with the new nested-grammar ToolsConfig."
  - "Grammar is deliberately over-accepting on the `arguments` object (any JSON). D-11 explicitly treats grammar as correctness backstop, not shape enforcer (CLAUDE.md Pitfall #6). Per-tool shape enforcement lives in tool_schemas/*.schema.json which @emmy/tools consults. Tightening the Lark to enforce per-tool argument shapes is Phase 5 territory once SC-3 parse-rate data surfaces concrete misparses."
  - "Removed `.gitkeep` from v2/grammars/ and v2/tool_schemas/ (both dirs now have real content). Phase 1 layout test test_grammars_empty_except_gitkeep targets v1 only (via profile_path fixture in conftest.py pointing at v1); removing v2's gitkeep does not regress it. Kept in v1 to preserve Phase 1 certification byte-identity."
  - "js-yaml + @emmy/ux promoted to root workspace devDeps so scripts/compute_max_input_tokens.ts resolves imports from repo root. Alternative was to move the script into packages/emmy-ux/scripts/; rejected because the script operates across profiles (input arg is a profile dir), which is a repo-level concern, not a package-level concern."
  - "Grammar Lark format: copied from the planner's CONTEXT example verbatim with minor comment expansion; kept at exactly 45 lines (>30 required). XGrammar compiles this the same as the planner's example; no empirical divergence."

patterns-established:
  - "Pattern: `uv run emmy profile hash <dir> --write` is the authoritative way to roll a profile version. It recomputes SHA + rewrites profile.yaml.hash + strips any stale `KNOWN-STALE` comment block from the top of profile.yaml. Later plans that edit v2 files (e.g., 02-08 SC evidence runs appending to validation_runs) must re-run this and commit the rewritten profile.yaml."
  - "Pattern: Phase-1-schema patch is a SEPARATE DATED COMMIT, not part of the harness-yaml fill commit. This lets 02-09 CLOSEOUT reference the schema SHA independently for its addendum. Applies to any future Phase-1-schema extension driven by Phase 2+ discoveries."
  - "Pattern: regression-test un-skip is part of the feat commit that makes it green, not a separate commit. Un-skipping without the implementation to back it up would break CI."

requirements-completed:
  - CONTEXT-04
  - CONTEXT-05
  - HARNESS-06
  - HARNESS-07
  - SERVE-05

# Metrics
duration: 8min
completed: 2026-04-21
---

# Phase 02 Plan 07: Profile v2 fill + hash lock + Phase-1-schema patch Summary

**v2 is Phase-2-production-ready: every harness.yaml TODO filled with nested `tools.grammar.{path, mode}` shape; 8 tool schemas + XGrammar Lark + 2 prompt files + PROFILE_NOTES provenance all landed; content hash recomputed; Phase-1 pydantic schema patched for nested grammar; Plan-04 max-model-len regression un-skipped and green.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-21T22:48:17Z
- **Completed:** 2026-04-21T22:56:58Z
- **Tasks:** 1 main task + 1 Phase-1-schema-patch (discrete commit per plan Step 0 instruction)
- **Files created:** 12 (1 grammar + 2 prompt + 8 tool-schema + 1 script)
- **Files modified:** 7 (harness.yaml, profile.yaml, PROFILE_NOTES.md, schema.py, __init__.py, max-model-len.test.ts, package.json + bun.lock)
- **Files deleted:** 2 (v2 .gitkeep placeholders under grammars/ and tool_schemas/)

## Accomplishments

### Phase-1 schema patch (discrete commit `88e48a4`)

Narrow extension of `emmy_serve/profile/schema.py`:

- New `GrammarConfig(BaseModel)` with `path: str` + `mode: Literal["reactive", "disabled"] = "reactive"` + `extra=forbid, frozen=True`.
- `ToolsConfig.grammar: Optional[str]` → `Optional[GrammarConfig]` (None still valid → v1 `grammar: null` still validates).
- Exported `GrammarConfig` from `emmy_serve/profile/__init__.py` `__all__`.
- Phase 1 unit tests stayed green (137 passed / 1 skipped — unchanged from baseline). `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0.

Committed as a discrete dated commit per plan Step 0 so Plan 02-09 CLOSEOUT can cite the SHA in its addendum.

### v2 harness.yaml — every TODO filled with a real value

Before: 11 `TODO(Phase-2)` markers in harness.yaml. After: **ZERO**. Every field filled from the CONTEXT decisions + computed values + prior plans:

| Field | Value | Source anchor |
|-------|-------|---------------|
| `prompts.edit_format` | `prompts/edit_format.md` | D-05..D-09 Hashline |
| `prompts.tool_descriptions` | `prompts/tool_descriptions.md` | HARNESS-06 <2000 chars |
| `prompts.prepend_system_text` | `""` | CONTEXT-04 runtime layering |
| `context.max_input_tokens` | **114688** | Computed via scripts/compute_max_input_tokens.ts |
| `context.include_repo_map` | `false` | Phase 3 |
| `context.repo_map_max_tokens` | `0` | Phase 3 |
| `context.default_pruning` | `head_tail` | Planner decision; revisit Phase 3 |
| `tools.schemas` | `tool_schemas/` | 8 JSON files |
| `tools.grammar.path` | `grammars/tool_call.lark` | D-11 + vLLM XGrammar |
| `tools.grammar.mode` | `reactive` | D-11 + Pitfall #6 |
| `tools.per_tool_sampling.edit/bash/read` | `{temperature: 0.0}` | Qwen team + Emmy |
| `agent_loop.*` | unchanged from v1 stub | Tune at Phase 5 eval |
| `advanced_settings_whitelist` | `[reasoning_effort, thinking_budget]` | Aider pattern |

### v2 artifacts shipped

- **`grammars/tool_call.lark`** — 45-line XGrammar Lark grammar, `start:` rule present, over-accepting on `arguments` object per D-11 backstop discipline. Tool-name alternation enumerates all 8 native tools.
- **`tool_schemas/read,write,edit,bash,grep,find,ls,web_fetch.schema.json`** — 8 OpenAI-format JSON files whose `parameters` blocks mirror the `registerNativeTools` declarations in `packages/emmy-tools/src/native-tools.ts` byte-for-byte. Each validates as JSON schema; each `function.name` equals the filename stem.
- **`prompts/edit_format.md`** — Hashline hash-anchored per-line edit docs with example call, StaleHashError / HashResolutionError semantics, and the 6.7→68.3% citation.
- **`prompts/tool_descriptions.md`** — 1786 chars (< 2000 HARNESS-06 budget), one short section per native tool with args summary + usage norms.
- **`PROFILE_NOTES.md` Harness (Phase 2) appendix** — 17-row provenance table (every non-trivial harness.yaml default cites source + retrieval date) + Phase-1-schema-patch narrative referencing the discrete commit SHA.

### v2 profile.yaml hash recomputed

- **Before (stale v1 hash):** `sha256:b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913`
- **After (honest v2 hash):** `sha256:0025799f3bbbb802ebed207791e5e0b39624fa93f0ad6b315d7c488e3153fa41`
- KNOWN-STALE 3-line warning comment at top of profile.yaml was auto-stripped by `uv run emmy profile hash --write` (it rewrites the whole file in canonical YAML form).
- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/` exits 0.
- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` still exits 0 (v1 byte-identical to Phase 1 closeout; its hash `sha256:b91e747...21913` unchanged).

### Plan-04 max-model-len regression un-skipped and GREEN

`packages/emmy-ux/tests/max-model-len.test.ts`:

- `TODO(plan-07)` marker removed (grep count was 3 in Plan 04; now 0).
- `test.skip("[TODO(plan-07)] ...")` replaced with active `describe("Plan-07 regression — harness.yaml v2 SC-5 consistency", () => test(...))`.
- Test body loads v2/serving.yaml + v2/harness.yaml + v2/PROFILE_NOTES.md frontmatter, calls `computeMaxInputTokens(measured_gpu_memory_utilization, max_model_len, 16384)`, and asserts `harness.yaml.context.max_input_tokens === computed.max_input_tokens`. Any drift in any input file without re-running the compute script surfaces here as a failed test.
- Full bun suite: 192 pass / 0 fail (was 191 pass + 1 skip; +1 un-skipped regression).

### scripts/compute_max_input_tokens.ts

Reusable Bun script (`bun scripts/compute_max_input_tokens.ts <profile_dir>`) that prints JSON `{max_input_tokens, derivation}`. Loads serving.yaml engine block + PROFILE_NOTES.md measured_values frontmatter; calls `@emmy/ux` `computeMaxInputTokens`. Plan 08's SC runners can shell this if they need to re-derive the number (e.g., if future profiles change max_model_len).

## Task Commits

Committed atomically per plan instruction:

1. **Phase-1-schema patch** — `88e48a4` feat(phase-01-schema-patch): allow nested tools.grammar.{path,mode}; resolves Phase-2 D-11 discovery
2. **Main fill + ship + hash + un-skip** — `979a8d0` feat(02-07): fill v2 harness.yaml (nested grammar shape) + ship grammar/schemas/prompts + recompute hash + un-skip regression

**Plan metadata commit:** pending at final-commit step (includes this SUMMARY.md + STATE.md + ROADMAP.md updates).

## Files Created/Modified

### Created
- `profiles/qwen3.6-35b-a3b/v2/grammars/tool_call.lark` (45 lines)
- `profiles/qwen3.6-35b-a3b/v2/prompts/edit_format.md` (1870 chars)
- `profiles/qwen3.6-35b-a3b/v2/prompts/tool_descriptions.md` (1786 chars)
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/read.schema.json`
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/write.schema.json`
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/edit.schema.json`
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/bash.schema.json`
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/grep.schema.json`
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/find.schema.json`
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/ls.schema.json`
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/web_fetch.schema.json`
- `scripts/compute_max_input_tokens.ts`

### Modified
- `profiles/qwen3.6-35b-a3b/v2/harness.yaml` — every TODO(Phase-2) replaced with a real value (11 TODOs → 0)
- `profiles/qwen3.6-35b-a3b/v2/profile.yaml` — hash recomputed; KNOWN-STALE comment auto-stripped
- `profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md` — 17-row Harness (Phase 2) provenance table + Phase-1-schema-patch note appended
- `emmy_serve/profile/schema.py` — GrammarConfig class added; ToolsConfig.grammar Optional[str] → Optional[GrammarConfig] (discrete commit 88e48a4)
- `emmy_serve/profile/__init__.py` — GrammarConfig exported (discrete commit 88e48a4)
- `packages/emmy-ux/tests/max-model-len.test.ts` — TODO(plan-07) / test.skip removed; real regression test body implemented
- `package.json` — root devDeps += js-yaml, @types/js-yaml, @emmy/ux workspace link
- `bun.lock`

### Deleted
- `profiles/qwen3.6-35b-a3b/v2/grammars/.gitkeep` (replaced by tool_call.lark)
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/.gitkeep` (replaced by 8 .schema.json files)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Script could not find `js-yaml` from repo-root path**

- **Found during:** Step 2 first run of `bun scripts/compute_max_input_tokens.ts profiles/qwen3.6-35b-a3b/v2`
- **Issue:** `error: Cannot find package 'js-yaml' from '/data/projects/emmy/scripts/compute_max_input_tokens.ts'`. js-yaml was in emmy-ux's node_modules but not hoisted to root node_modules by Bun workspaces.
- **Fix:** Added `js-yaml@4.1.0` + `@types/js-yaml@4.0.9` + `@emmy/ux` (workspace link) to repo-root `package.json` devDependencies. `bun install` hoisted the package to root `node_modules/`.
- **Files modified:** `package.json`, `bun.lock`
- **Committed in:** `979a8d0` (folded into the main fill commit)

**2. [Rule 1 - Bug] PROFILE_NOTES.md false-positive TODO match**

- **Found during:** Post-Step-8 acceptance grep `grep -rc 'TODO(Phase-2)' profiles/qwen3.6-35b-a3b/v2/` returned 1 in PROFILE_NOTES.md.
- **Issue:** The appendix narrative said "Phase 2 filled every `TODO(Phase-2)` field in `harness.yaml`." The literal `TODO(Phase-2)` was a descriptive reference, not a live TODO. The plan's acceptance criterion demands 0 everywhere.
- **Fix:** Reworded to "Phase 2 filled every Phase-2-deferred field in `harness.yaml`." Same meaning, no literal grep match.
- **Files modified:** `profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md`
- **Committed in:** `979a8d0` (folded into the main fill commit)

**Total deviations:** 2 auto-fixed (1 blocking resolve-path issue, 1 grep-audit-wording bug). No architectural changes. Zero semantic change to the plan's intent.

## Confirmation of Plan Invariants

Pre-final-commit checklist (every acceptance criterion from the plan, verified):

- **TODOs cleared:**
  - `grep -c 'TODO(Phase-2)' profiles/qwen3.6-35b-a3b/v2/harness.yaml` → 0
  - `grep -rc 'TODO(Phase-2)' profiles/qwen3.6-35b-a3b/v2/` → 0 everywhere
- **profile.yaml hygiene:**
  - `grep -c 'KNOWN-STALE' profiles/qwen3.6-35b-a3b/v2/profile.yaml` → 0 (warning removed)
  - `grep -cE 'hash:[[:space:]]+sha256:[0-9a-f]{64}' profiles/qwen3.6-35b-a3b/v2/profile.yaml` → 1 (well-formed)
  - `grep -c 'b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913' profiles/qwen3.6-35b-a3b/v2/profile.yaml` → 0 (stale v1 hash absent)
- **Profile validate (both):**
  - `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` → exit 0 (v1 untouched)
  - `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/` → exit 0 (fresh hash)
- **Artifacts present:**
  - all 8 `profiles/qwen3.6-35b-a3b/v2/tool_schemas/{read,write,edit,bash,grep,find,ls,web_fetch}.schema.json` exist
  - `profiles/qwen3.6-35b-a3b/v2/grammars/tool_call.lark` exists; `grep -c '^start:'` → 1
  - `profiles/qwen3.6-35b-a3b/v2/prompts/edit_format.md` exists; `grep -c 'hash-anchored\|Hashline'` → 4
  - `profiles/qwen3.6-35b-a3b/v2/prompts/tool_descriptions.md` exists
  - `grep -c 'Harness (Phase 2)' profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md` → 1
- **W4 FIX — max_model_len present:**
  - `grep -c 'max_model_len: 131072' profiles/qwen3.6-35b-a3b/v2/serving.yaml` → 1
- **B3/C3 FIX — nested grammar shape:**
  - `grep -cE '^[[:space:]]+grammar:[[:space:]]*$' profiles/qwen3.6-35b-a3b/v2/harness.yaml` → 1 (nested key present)
  - `grep -cE '^[[:space:]]+path:[[:space:]]+grammars/tool_call\.lark' profiles/qwen3.6-35b-a3b/v2/harness.yaml` → 1
  - `grep -cE '^[[:space:]]+mode:[[:space:]]+reactive' profiles/qwen3.6-35b-a3b/v2/harness.yaml` → 1
  - `grep -cE '^[[:space:]]+grammar:[[:space:]]+grammars/tool_call\.lark' profiles/qwen3.6-35b-a3b/v2/harness.yaml` → 0 (flattened shape absent)
  - `grep -c 'grammar_mode:' profiles/qwen3.6-35b-a3b/v2/harness.yaml` → 0 (old pre-revision sibling-field shape absent)
- **Per-tool sampling:** `grep -cE 'edit:\s*\{\s*temperature: 0\.0\s*\}' profiles/qwen3.6-35b-a3b/v2/harness.yaml` → 1
- **Un-skipped regression test:**
  - `grep -c 'TODO(plan-07)' packages/emmy-ux/tests/max-model-len.test.ts` → 0
  - `grep -c 'test.skip' packages/emmy-ux/tests/max-model-len.test.ts` → 0
- **Phase-1-schema patch discoverable:**
  - `git log --oneline | grep -c 'phase-01-schema-patch'` → 1 (SHA 88e48a4)
- **Test suites green:**
  - `bun test` → 192 pass / 0 fail (was 191 pass + 1 skip; +1 un-skipped regression)
  - `bun test packages/emmy-ux/tests/max-model-len.test.ts` → 6 pass / 0 fail
  - `bun run typecheck` → all 4 packages exit 0
  - `uv run pytest tests/unit -q` → 137 passed / 1 skipped (unchanged from Phase 1 baseline)

## Computed Values Committed

- **`max_input_tokens`:** 114688
- **Derivation:** `max_input_tokens = max_model_len(131072) - output_reserve_tokens(16384) = 114688 (measured_gpu_memory_utilization=0.88, source: PROFILE_NOTES.md measured_values)`
- **`max_model_len`:** 131072 (unchanged from v1; Qwen3.6-35B-A3B-FP8 honest native window per CONTEXT.md + STACK.md)
- **v2 profile hash before:** `sha256:b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913` (stale v1 hash)
- **v2 profile hash after:** `sha256:0025799f3bbbb802ebed207791e5e0b39624fa93f0ad6b315d7c488e3153fa41`
- **Phase-1-schema-patch commit SHA (for 02-09 CLOSEOUT addendum):** `88e48a4`
- **Main feat commit SHA:** `979a8d0`

## Next Phase Readiness

Plan 02-07 is complete. Ready for:

- **Plan 02-08 (SC-2/3/4/5 evidence runners):** `profiles/qwen3.6-35b-a3b/v2/` validates, has the reactive grammar path + 8 tool schemas + honest max_input_tokens all in place. SC-3 100-call corpus will exercise the reactive retry path; the D-14 no-grammar baseline flips `tools.grammar.mode=disabled` for one run (this plan's nested shape makes that a single-line YAML edit + hash-recompute).
- **Plan 02-09 (SC-1 walkthrough + CLOSEOUT):** references the Phase-1-schema-patch commit SHA `88e48a4` in the addendum section per plan instruction. Uses v2 as the profile-under-test for the daily-driver walkthrough.

**No blockers.**

## Self-Check: PASSED

Verified:

- `profiles/qwen3.6-35b-a3b/v2/grammars/tool_call.lark` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/prompts/edit_format.md` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/prompts/tool_descriptions.md` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/read.schema.json` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/write.schema.json` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/edit.schema.json` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/bash.schema.json` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/grep.schema.json` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/find.schema.json` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/ls.schema.json` — FOUND
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/web_fetch.schema.json` — FOUND
- `scripts/compute_max_input_tokens.ts` — FOUND
- Commit `88e48a4` (Phase-1-schema patch) — FOUND
- Commit `979a8d0` (main fill + ship + hash + un-skip) — FOUND

---
*Phase: 02-pi-harness-mvp-daily-driver-baseline*
*Completed: 2026-04-21*
