---
phase: 05
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/emmy-eval/package.json
  - packages/emmy-eval/tsconfig.json
  - packages/emmy-eval/src/index.ts
  - packages/emmy-eval/src/orchestrator.ts
  - packages/emmy-eval/src/provenance.ts
  - packages/emmy-eval/src/airgap-lane.ts
  - packages/emmy-eval/src/sp-ok-gate.ts
  - packages/emmy-eval/src/stats/mean-std.ts
  - packages/emmy-eval/src/stats/promotion-gate.ts
  - packages/emmy-eval/src/judge/family-guard.ts
  - packages/emmy-eval/src/suites/loader.ts
  - packages/emmy-eval/src/suites/prior-phase1.ts
  - packages/emmy-eval/src/report/json.ts
  - packages/emmy-eval/src/report/markdown.ts
  - packages/emmy-eval/bin/pi-emmy-eval.ts
  - packages/emmy-eval/tests/uses-sdk.test.ts
  - packages/emmy-eval/tests/provenance-shape.test.ts
  - packages/emmy-eval/tests/stats.test.ts
  - packages/emmy-eval/tests/promotion-gate.test.ts
  - packages/emmy-eval/tests/sp-ok-gate.test.ts
  - packages/emmy-eval/tests/airgap-lane.test.ts
  - packages/emmy-eval/tests/judge-family-guard.test.ts
  - packages/emmy-eval/tests/orchestrator.test.ts
  - packages/emmy-eval/tests/print-environment.test.ts
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_01_csv.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_02_fibonacci.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_03_pytest_email.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_04_binary_search.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_05_lru_cache.json
  - eval/suites/prior-phase1.yaml
  - packages/emmy-ux/src/print-environment.ts
  - packages/emmy-ux/src/index.ts
  - packages/emmy-ux/bin/pi-emmy.ts
  - package.json
  - tsconfig.base.json
  - scripts/eval/validate_holdout.ts
  - eval/holdout/_TEMPLATE.json
  - eval/holdout/rephrased/_TEMPLATE_REPHRASED.json
autonomous: true
requirements: [EVAL-02, EVAL-03, EVAL-04, EVAL-07, EVAL-08, EVAL-09, UX-06]
tags: [eval, sdk, provenance, statistics, promotion-gate, sp-ok-canary, air-gap, prior-phase1-continuity]

must_haves:
  truths:
    - "packages/emmy-eval/ exists as a Bun workspace package with workspace:* deps on @emmy/{provider,tools,ux,context,telemetry}; bun typecheck across all 6 packages exits 0"
    - "EVAL-02: a static-analysis test (uses-sdk.test.ts) greps packages/emmy-eval/src/**/*.ts for direct fetch()/postChat() calls to vLLM endpoints; only @emmy/ux runSpOk is allowlisted; any other bypass route fails the test"
    - "EVAL-03: provenance.ts captures the full schema documented in 05-RESEARCH.md §Q6; every field has a deterministic capture path (env var, subprocess, profile YAML field, or sentinel '[unverified]')"
    - "EVAL-04: stats/mean-std.ts computes per-task pass-rate over N samples + suite-level mean ± std; rejects N<3 with InsufficientSamplesError"
    - "EVAL-07: sp-ok-gate.ts wraps @emmy/ux runSpOk; orchestrator calls it as the FIRST step of every batch; canary fail → orchestrator throws EvalAbortError exit 7; orchestrator re-canaries every 50 samples and aborts batch if mid-run canary fails"
    - "EVAL-08: promotion-gate.ts enforces (a) suite_complete=true (no --filter active), (b) N_new>=3 AND N_old>=3, (c) mean(new_per_task) > mean(old_per_task) + std(old_per_task); --declare-improvement flag fails fast with EVAL08PromotionBlockedError if any predicate is false"
    - "EVAL-09: pi-emmy --print-environment dumps the §Q6 schema (subset, no eval-specific fields) as JSON to stdout; eval orchestrator invokes via Bun.spawn once per batch; output written to <run-dir>/provenance.json"
    - "UX-06: @emmy/eval is importable as a library — `import { runSuite, captureProvenance } from '@emmy/eval'` works from outside the package (bun typecheck across packages); CLI is a thin wrapper over the library"
    - "Air-gap lane verifier (airgap-lane.ts) reads EMMY_AIRGAP at startup; STRICT refuses --judge=cloud-claude (LaneMismatchError, exit 5); PERMISSIVE allows; default = STRICT"
    - "Orchestrator runs the prior-Phase-1 5 coding tasks suite end-to-end against a stubbed vLLM (test fixture) producing a real JSON+markdown report with full provenance"
    - "judge-family-guard.ts: pure function rejecting same-family judge configurations (judge family root substring overlap with any generation profile family root); test fixtures cover qwen-judges-qwen, gemma-judges-gemma, qwen-judges-llama (allowed)"
    - "All 9 RED-stub tests from RESEARCH.md § Validation Architecture are GREEN by end of plan"
  artifacts:
    - path: "packages/emmy-eval/package.json"
      provides: "Workspace package manifest with workspace:* deps + bin entry pi-emmy-eval"
      contains: "@emmy/eval"
    - path: "packages/emmy-eval/src/orchestrator.ts"
      provides: "for-each-task × N-samples loop calling createEmmySession; the EVAL-02 SDK-only path"
      contains: "createEmmySession"
      min_lines: 80
    - path: "packages/emmy-eval/src/provenance.ts"
      provides: "EVAL-03 + EVAL-09 schema capture + serializer"
      contains: "schema_version"
      min_lines: 80
    - path: "packages/emmy-eval/src/sp-ok-gate.ts"
      provides: "EVAL-07 pre-flight + per-50-row re-canary"
      contains: "runSpOk"
    - path: "packages/emmy-eval/src/stats/promotion-gate.ts"
      provides: "EVAL-08 subset-run rejection + mean+std comparison"
      contains: "suite_complete"
    - path: "packages/emmy-eval/src/airgap-lane.ts"
      provides: "STRICT/PERMISSIVE lane verifier (D-08 from 05-CONTEXT)"
      contains: "EMMY_AIRGAP"
    - path: "packages/emmy-eval/bin/pi-emmy-eval.ts"
      provides: "pi-emmy-eval CLI: run, compare (stub), report (stub) subcommands"
      contains: "pi-emmy-eval"
    - path: "packages/emmy-ux/src/print-environment.ts"
      provides: "EVAL-09 environment dumper invoked by `pi-emmy --print-environment`"
      contains: "schema_version"
    - path: "eval/suites/prior-phase1.yaml"
      provides: "Suite manifest for the 5 coding tasks (CODE_01..CODE_05); D-05 literature tasks deferred"
      contains: "manifest_hash:"
  key_links:
    - from: "packages/emmy-eval/src/orchestrator.ts"
      to: "packages/emmy-ux/src/session.ts (createEmmySession)"
      via: "import from @emmy/ux"
      pattern: "createEmmySession"
    - from: "packages/emmy-eval/src/sp-ok-gate.ts"
      to: "packages/emmy-ux/src/sp-ok-canary.ts (runSpOk)"
      via: "import from @emmy/ux"
      pattern: "runSpOk"
    - from: "packages/emmy-eval/src/provenance.ts"
      to: "packages/emmy-provider/src/profile-loader.ts (ProfileSnapshot)"
      via: "import from @emmy/provider"
      pattern: "ProfileSnapshot"
    - from: "packages/emmy-eval/bin/pi-emmy-eval.ts"
      to: "packages/emmy-eval/src/orchestrator.ts (runSuite)"
      via: "library API"
      pattern: "runSuite"
    - from: "packages/emmy-eval/src/orchestrator.ts"
      to: "packages/emmy-eval/src/airgap-lane.ts (verifyAirgapLane)"
      via: "startup precondition"
      pattern: "verifyAirgapLane"
---

# Objective

Author the entire eval driver backbone — package skeleton + orchestrator + provenance + statistics + SP_OK gate + promotion gate + air-gap-lane verifier + judge family-guard + suite loader + the prior-Phase-1 continuity baseline as the first concrete suite + the `pi-emmy --print-environment` (EVAL-09) sibling. This plan covers 7 of the 9 EVAL/UX REQ-IDs (EVAL-02, 03, 04, 07, 08, 09 + UX-06). EVAL-01 lands in 05-03 + 05-04 (the heavy suites) + 05-02's prior-Phase-1 mini-suite. EVAL-05 lands in 05-01. EVAL-06 lands in 05-05.

Purpose: This is the **architectural backbone** of Phase 5. Everything else is suites and judges plugged into this core. The architectural rules — "uses SDK, never bypasses" (EVAL-02), "every row has full provenance" (EVAL-03), "subset runs cannot promote" (EVAL-08), "SP_OK gates every batch" (EVAL-07), "samples >= 3 enforces variance reporting" (EVAL-04), "STRICT inference / PERMISSIVE judge" (D-08) — are encoded HERE in shippable code, not just docs.

Output:
- `packages/emmy-eval/` workspace package with library + CLI
- `pi-emmy --print-environment` shipping in `@emmy/ux`
- `eval/suites/prior-phase1.yaml` + `eval/holdout/_TEMPLATE.json` + `scripts/eval/validate_holdout.ts` (the scaffolding Plan 05-01 operator-authoring depends on)
- 9 GREEN test files covering EVAL-02 through 09 + UX-06
- One end-to-end smoke run against a stubbed vLLM producing a real JSON+markdown report

# Execution Context

@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

# Context

@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CONTEXT.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-RESEARCH.md
@CLAUDE.md
@eval/MATRIX.md

## Interfaces

Key contracts. Plan 05-03/04/05/06/07 will all import from these.

From `packages/emmy-ux/src/index.ts` (the SDK entry points the orchestrator consumes):

```typescript
export { loadProfile } from "./profile-loader";
export { runSpOk, SP_OK_SYSTEM_PROMPT, SP_OK_USER_MESSAGE, SP_OK_ASSERTION_SUBSTR } from "./sp-ok-canary";
export { createEmmySession, type PiRuntime } from "./session";
```

PiRuntime.runPrint signature (from `packages/emmy-ux/src/session.ts:117-120`):

```typescript
runPrint?: (prompt: string, opts?: { mode: "text" | "json" }) => Promise<{
  text: string;
  messages: unknown[];
}>;
```

ProfileSnapshot from `@emmy/provider` (already loaded via @emmy/ux):

```typescript
export interface ProfileSnapshot {
  ref: { id: string; version: string; hash: string };
  serving: { engine: { ... } };
  harness: { ... };
}
```

Plan 05-02's library API (what 05-03/04/05/06 will import):

```typescript
// packages/emmy-eval/src/index.ts
export { runSuite, type SuiteRunResult, type SuiteRunArgs } from "./orchestrator";
export { captureProvenance, type Provenance } from "./provenance";
export { computeStats, InsufficientSamplesError, type TaskStats } from "./stats/mean-std";
export { evaluatePromotion, EVAL08PromotionBlockedError } from "./stats/promotion-gate";
export { runSpOkGate, EvalAbortError } from "./sp-ok-gate";
export { verifyAirgapLane, LaneMismatchError, type AirgapLane } from "./airgap-lane";
export { assertJudgeFamilyClean, JudgeFamilyConflictError, familyRoot } from "./judge/family-guard";
export { loadSuite, type Suite, type Task } from "./suites/loader";
export { writeReport } from "./report/json";
export { renderMarkdownReport } from "./report/markdown";
```

Suite shape (suites/loader.ts):

```typescript
export interface Task {
  task_id: string;
  source: string;
  prompt: string;
  fixture_files: Record<string, string>;
  expected_rubric?: string;
  executable_check?: { kind: "bash"; command: string; expected_exit_code: number; expected_stdout_contains?: string };
}
export interface Suite {
  suite_id: string;
  suite_version: string;
  manifest_hash: string;
  tasks: Task[];
  defaults: { samples: number; judge_required: boolean };
  thresholds?: { contamination_signal?: { pass_at_1_gap?: number; judge_normalized_gap?: number } };
}
```

SuiteRunResult shape:

```typescript
export interface SampleResult {
  sample_index: number;
  sp_ok_canary: boolean;
  exec_score: 0 | 1 | null;
  judge_score?: number;
  transcript_jsonl_path: string;
  duration_ms: number;
  tokens_in?: number;
  tokens_out?: number;
}
export interface TaskRow {
  task_id: string;
  samples: SampleResult[];
  mean_exec: number;
  std_exec: number;
  insufficient_samples: boolean;
}
export interface SuiteRunResult {
  suite_id: string;
  suite_complete: boolean;
  /**
   * Why suite_complete is what it is (per checker Blocker 4 — disambiguates D-01 dense smoke
   * from EVAL-08 subset-trap conditions). Plan 05-06's compareSuiteRuns reads this to decide
   * whether the comparable_warning carries an EVAL-08 callout or a Tier-B callout.
   *
   *   "complete"   — every task in the suite ran with samples >= 3; suite_complete=true
   *   "filter"     — operator passed --filter <regex>; suite_complete=false; EVAL-08 applies
   *   "max-tasks"  — operator passed --max-tasks N (N < total); suite_complete=false; EVAL-08 applies
   *   "smoke-N1"   — operator passed --samples 1 (D-01 dense smoke pattern); suite_complete=false;
   *                  this is EXPECTED Tier-B-coverage behavior, NOT an EVAL-08 violation
   */
  suite_complete_reason: "complete" | "filter" | "max-tasks" | "smoke-N1";
  rows: TaskRow[];
  provenance_path: string;
  report_md_path: string;
  report_json_path: string;
  total_samples: number;
  spok_failures: number;
  declare_improvement_blocked_reason: string | null;
}
```

CLI shape (`packages/emmy-eval/bin/pi-emmy-eval.ts`):

```bash
pi-emmy-eval run \
  --profile profiles/qwen3.6-35b-a3b/v3.1 \
  --suite eval/suites/prior-phase1.yaml \
  --samples 3 \
  --out runs/phase5/<iso>-<profile-hash8>-prior-phase1/ \
  [--base-url http://127.0.0.1:8002] \
  [--declare-improvement <baseline-run-dir>] \
  [--max-tasks N] \
  [--filter <task_id_regex>] \
  [--judge self-hosted-llama|cloud-claude|none]
```

Stable exit codes (Plans 05-03..07 inherit):

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | generic error |
| 5 | lane mismatch (e.g. --judge=cloud-claude under STRICT) |
| 6 | judge-family conflict (judge same family as generator) |
| 7 | SP_OK canary failure |
| 8 | EVAL-08 promotion blocked (subset run / N<3 / mean+std fails) |
| 9 | insufficient samples (--samples <3 explicitly set) |

## Key Files

- `packages/emmy-ux/src/session.ts:1-300` — createEmmySession reference
- `packages/emmy-ux/src/sp-ok-canary.ts` — runSpOk implementation Plan 05-02 wraps
- `packages/emmy-ux/src/profile-loader.ts` — loadProfile Plan 05-02 imports
- `packages/emmy-provider/src/post-chat.ts` — postChat (used ONLY by runSpOk; eval driver does not import directly)
- `eval/phase2/sc2/run_sc2.ts:1-432` — proven harness-as-library reference shape
- `/data/projects/setup_local_opencode/validation/eval_tasks.py` — prior-repo task definitions; CODE_01..CODE_05 source content
- `bunfig.toml` — Bun workspace config
- `package.json` (workspace root) — workspace declaration

# Tasks

## Task 1 (auto): Workspace package skeleton + RED test stubs (Wave 0)

**Files:** `packages/emmy-eval/package.json`, `packages/emmy-eval/tsconfig.json`, `packages/emmy-eval/src/index.ts`, `packages/emmy-eval/bin/pi-emmy-eval.ts`, 9 RED test files in `packages/emmy-eval/tests/`, root `package.json`, `tsconfig.base.json`, `scripts/eval/validate_holdout.ts`, `eval/holdout/_TEMPLATE.json`, `eval/holdout/rephrased/_TEMPLATE_REPHRASED.json`

**Behavior:**
- 9 RED test files (one per RESEARCH.md § Validation Architecture row) exist with placeholder failures (`expect(false).toBe(true)`)
- `bun test packages/emmy-eval/tests` reports 9 failures (all 9 specs visible)
- `bun typecheck` across all 6 workspace packages succeeds (TS compiles even though tests fail)

**Action:**

Step 1 — Author `packages/emmy-eval/package.json` with workspace:* deps on `@emmy/{provider,tools,ux,context,telemetry}` + dev deps `@types/bun` + `typescript` ^5.6.0 + runtime dep `yaml` ^2.6.0. Bin entry `pi-emmy-eval` → `./bin/pi-emmy-eval.ts`. Type=module, main+types pointing at `./src/index.ts`. Scripts: `typecheck` and `test`.

Step 2 — Author `packages/emmy-eval/tsconfig.json` mirroring `packages/emmy-ux/tsconfig.json` (extends `../../tsconfig.base.json`, paths to other workspace pkgs).

Step 3 — Update workspace root `package.json` `workspaces:` array to include `packages/emmy-eval`.

Step 4 — Create `packages/emmy-eval/src/index.ts` as an empty re-export stub (`export {};`). Tasks 2-4 populate it.

Step 5 — Create `packages/emmy-eval/bin/pi-emmy-eval.ts` with `#!/usr/bin/env bun` shebang + minimal stub `console.error("pi-emmy-eval: not yet implemented"); process.exit(1);`. Full CLI lands in Task 4.

Step 6 — Author the 9 RED-stub test files under `packages/emmy-eval/tests/`. Use `bun:test` imports. Each file has the test name from RESEARCH.md § Validation Architecture row + a single `expect(false).toBe(true)` placeholder.

Test file names:
- `uses-sdk.test.ts` (EVAL-02)
- `provenance-shape.test.ts` (EVAL-03)
- `stats.test.ts` (EVAL-04)
- `promotion-gate.test.ts` (EVAL-08)
- `sp-ok-gate.test.ts` (EVAL-07)
- `airgap-lane.test.ts` (D-08)
- `judge-family-guard.test.ts` (EVAL-06 partial — judge selection)
- `orchestrator.test.ts` (EVAL-02 + EVAL-04 integration)
- `print-environment.test.ts` (EVAL-09)

Step 7 — Create `scripts/eval/validate_holdout.ts` (small Bun script consumed by Plan 05-01 Task 1). Validates that every `holdout_NNN.json` + `rephrased/holdout_NNN_rephrased.json` has the required fields per the 05-01 schema. Required holdout fields: `task_id, source, authored_by, authored_at, exercises_edit, title, fixture_files, prompt, expected_rubric, executable_check, contamination_resistance_rationale`. Required rephrased fields: `task_id, original_id, rephrasing_seed, rephrasing_authored_at, source, exercises_edit, title, fixture_files, prompt, expected_rubric, executable_check`. Source must be `"holdout-handwritten"` for holdout, `"holdout-rephrased"` for rephrased. Exit 0 = all valid; exit 1 = errors.

Step 8 — Create `eval/holdout/_TEMPLATE.json` + `eval/holdout/rephrased/_TEMPLATE_REPHRASED.json` templates with the documented schema (placeholder strings with TODO markers) so Plan 05-01 Task 1 can copy them.

Step 9 — Run `bun install` at workspace root to materialize the new workspace package.

Step 10 — Verify `bun typecheck` exits 0 across all 6 packages; `bun test packages/emmy-eval` shows 9 failing tests.

**Verify:**

```
cd /data/projects/emmy && bun install && bun typecheck
bun test packages/emmy-eval/tests 2>&1 | grep -E '9 fail|9 expect.*failed'
```

**Done:**
- `packages/emmy-eval/` exists with `package.json` + `tsconfig.json` + `src/index.ts` + `bin/pi-emmy-eval.ts`
- workspace root `package.json` includes `packages/emmy-eval` in workspaces array
- 9 RED test files exist; bun test reports 9 failures
- `bun typecheck` across 6 packages exits 0
- `scripts/eval/validate_holdout.ts` + 2 template files exist

***

## Task 2 (auto, tdd=true): Architectural backbone — landed in two commits per W1 split

**Post-checker W1 split discipline:** This task lands in two commits, but the file/test/skeleton content below is unchanged. Pre-commit, the executor groups files by sub-task as follows.

**Task 2a — Stats + air-gap lane + SP_OK gate (commit 1):**
- Files in 2a: `packages/emmy-eval/src/stats/{mean-std,promotion-gate}.ts`, `packages/emmy-eval/src/airgap-lane.ts`, `packages/emmy-eval/src/sp-ok-gate.ts`, plus the 4 GREEN test files (`stats.test.ts`, `promotion-gate.test.ts`, `airgap-lane.test.ts`, `sp-ok-gate.test.ts`)
- 2a Verify: `bun test packages/emmy-eval/tests/stats.test.ts packages/emmy-eval/tests/promotion-gate.test.ts packages/emmy-eval/tests/airgap-lane.test.ts packages/emmy-eval/tests/sp-ok-gate.test.ts` — 4/4 GREEN
- 2a Commit message: `feat(emmy-eval): stats + airgap-lane + sp-ok-gate (Plan 05-02 Task 2a — 4 GREEN)`

**Task 2b — Provenance + judge-family-guard + print-environment (commit 2):**
- Files in 2b: `packages/emmy-eval/src/provenance.ts`, `packages/emmy-eval/src/judge/family-guard.ts`, `packages/emmy-ux/src/print-environment.ts`, `packages/emmy-ux/src/index.ts`, `packages/emmy-ux/bin/pi-emmy.ts`, plus the 3 GREEN test files (`provenance-shape.test.ts`, `judge-family-guard.test.ts`, `print-environment.test.ts`)
- 2b Verify: `bun test packages/emmy-eval/tests/provenance-shape.test.ts packages/emmy-eval/tests/judge-family-guard.test.ts packages/emmy-eval/tests/print-environment.test.ts` — 3/3 GREEN
- 2b Commit message: `feat(emmy-eval): provenance + judge-family-guard + print-environment (Plan 05-02 Task 2b — 3 GREEN)`

**`packages/emmy-eval/src/index.ts` re-export update is split across both commits** — 2a's update lands the 4 imports; 2b's update appends the 3 more.

The Action / RED-test / GREEN-implementation / Verify / Done content below is the same content executed in this 2a → 2b order. Original Task 2 heading retained for cross-reference.

### Task 2 (auto, tdd=true): Architectural backbone — provenance + stats + promotion-gate + airgap-lane + sp-ok-gate + judge-family-guard + print-environment

**Files:** `packages/emmy-eval/src/provenance.ts`, `packages/emmy-eval/src/stats/{mean-std,promotion-gate}.ts`, `packages/emmy-eval/src/airgap-lane.ts`, `packages/emmy-eval/src/sp-ok-gate.ts`, `packages/emmy-eval/src/judge/family-guard.ts`, `packages/emmy-eval/src/index.ts`, 7 GREEN test files, `packages/emmy-ux/src/print-environment.ts`, `packages/emmy-ux/src/index.ts`, `packages/emmy-ux/bin/pi-emmy.ts`

**Behavior:**
- `provenance.ts` `captureProvenance({profile, suite, samples, suiteManifestHash?})` returns the §Q6 schema; deterministic across two calls (modulo `captured_at` timestamp); `driver_version` + `gpu_uuid` from `nvidia-smi --query-gpu=driver_version,uuid --format=csv,noheader`; `eval_driver_commit` from `git rev-parse HEAD`; `pi_coding_agent_version` from `packages/emmy-ux/package.json`
- `stats/mean-std.ts`: `computeStats(samples)` throws `InsufficientSamplesError` when valid samples < 3; computes mean + population std at N=3; rounds to 4 decimals; null `exec_score` excluded from mean (re-checks N≥3 after exclusion)
- `stats/promotion-gate.ts`: `evaluatePromotion({newRun, oldRun})` returns `{promoted, reason}`; rejects when `newRun.suite_complete=false`; rejects when any task has N<3; rejects when `mean(new) <= mean(old) + std(old)`
- `airgap-lane.ts`: `verifyAirgapLane({requestedJudge})` reads `EMMY_AIRGAP` (defaults `strict`); STRICT + `requestedJudge='cloud-claude'` → throws `LaneMismatchError` with code 5
- `sp-ok-gate.ts`: `runSpOkGate({baseUrl, servedModelName})` wraps `@emmy/ux runSpOk`; throws `EvalAbortError` exit 7 on canary fail
- `judge/family-guard.ts`: `assertJudgeFamilyClean({judgeProfileRef, generatorProfileRefs})` pure function; throws `JudgeFamilyConflictError` exit 6 if judge family root matches any generator family root
- `print-environment.ts` (in @emmy/ux): `dumpEnvironment()` — same schema as captureProvenance MINUS eval-specific fields; `pi-emmy --print-environment` writes JSON to stdout + exits 0

**Action:**

Step 1 — RED→GREEN cycle. Replace each placeholder test from Task 1 with real assertions covering:

`provenance-shape.test.ts`:
- captureProvenance returns object with `schema_version="emmy.eval.provenance.v1"`
- All §Q6 fields present (deep keys snapshot)
- `profile.{id,version,hash}` matches input ProfileSnapshot.ref
- `captured_at` is a valid ISO date string
- `engine.gpu_memory_utilization` equals `profile.serving.engine.gpu_memory_utilization`

`stats.test.ts`:
- `computeStats([{exec_score:1},{exec_score:1},{exec_score:0}])` → `{mean: 0.6667, std: 0.4714, n: 3}`
- `computeStats([{exec_score:1},{exec_score:1}])` throws `InsufficientSamplesError`
- 3 samples with same score → std=0
- 4 samples where 1 is null and 3 are valid → uses the 3 valid; if 2 valid + 2 null, throws

`promotion-gate.test.ts`:
- `newRun.suite_complete=false` → `{promoted:false, reason:"...subset run cannot promote..."}`
- Task with `samples.length<3` → `{promoted:false, reason:"...insufficient samples..."}`
- mean(new)=0.5, mean(old)=0.5, std(old)=0.1 → `{promoted:false, reason:"...variance overlap..."}`
- mean(new)=0.7, mean(old)=0.5, std(old)=0.1 → `{promoted:true, reason:null}`

`airgap-lane.test.ts`:
- EMMY_AIRGAP unset → lane='STRICT'
- EMMY_AIRGAP=strict + requestedJudge=null → lane='STRICT'
- EMMY_AIRGAP=strict + requestedJudge='cloud-claude' → throws LaneMismatchError code 5
- EMMY_AIRGAP=permissive + requestedJudge='cloud-claude' → lane='PERMISSIVE'
- EMMY_AIRGAP=permissive + requestedJudge='self-hosted-llama' → lane='PERMISSIVE'

`sp-ok-gate.test.ts`:
- Mock `@emmy/ux runSpOk` to return `{ok:true}` → resolves
- Mock to return `{ok:false}` → throws EvalAbortError code 7
- Import `SP_OK_ASSERTION_SUBSTR` and assert it === literal `"[SP_OK]"` (Phase 1+2 contract unchanged)

`judge-family-guard.test.ts`:
- judge.id="qwen3.6-35b-a3b", generators=[{id:"qwen3.6-35b-a3b"}] → throws (same family root "qwen3.6")
- judge.id="qwen3.6-27b", generators=[{id:"qwen3.6-35b-a3b"}] → throws (qwen3.6 vs qwen3.6)
- judge.id="llama-3.3-70b-instruct", generators=[{id:"qwen3.6-35b-a3b"},{id:"gemma-4-26b-a4b-it"}] → ok
- judge.id="cloud-claude-sonnet-4-5", generators=[{id:"qwen3.6-35b-a3b"}] → ok
- judge.id="gemma-anything", generators=[{id:"gemma-4-26b-a4b-it"}] → throws (gemma vs gemma)
- Family root = first segment before first hyphen or first dot if no hyphen

`print-environment.test.ts`:
- `spawnSync("bun","run","packages/emmy-ux/bin/pi-emmy.ts","--print-environment")` exits 0
- stdout is valid JSON
- JSON.schema_version === "emmy.eval.provenance.v1"
- JSON contains `hardware.gpu_uuid`, `harness.pi_coding_agent_version`, `eval_driver_commit`
- JSON does NOT contain `eval.suite` (eval-specific only added by captureProvenance)

Step 2 — GREEN: author each module per the schema documented in RESEARCH.md §Q6. The implementation skeleton is below; executor fills in obvious details (error messages, JSDoc with section refs).

`provenance.ts` skeleton:

```typescript
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ProfileSnapshot } from "@emmy/provider";

export interface Provenance {
  schema_version: "emmy.eval.provenance.v1";
  captured_at: string;             // ISO-8601 UTC timestamp (new Date().toISOString())
  eval_driver_commit: string;      // git rev-parse HEAD of emmy repo at run time
  profile: {
    id: string;                    // ProfileSnapshot.ref.id (e.g. "qwen3.6-35b-a3b")
    version: string;               // ProfileSnapshot.ref.version (e.g. "v3.1")
    hash: string;                  // ProfileSnapshot.ref.hash (sha256:...)
  };
  engine: {
    vllm_version: string;          // EMMY_VLLM_VERSION env or "[unverified]"
    fastsafetensors: boolean;      // ProfileSnapshot.serving.engine.env.VLLM_LOAD_FORMAT === "fastsafetensors"
    container_image: string;       // ProfileSnapshot.serving.engine.container_image
    container_image_digest: string;// ProfileSnapshot.serving.engine.container_image_digest (sha256:...)
    cuda_version: string;          // EMMY_CUDA_VERSION env or "[unverified]"
    kv_cache_dtype: string;        // ProfileSnapshot.serving.engine.kv_cache_dtype ?? "auto"
    gpu_memory_utilization: number;// ProfileSnapshot.serving.engine.gpu_memory_utilization (KV-bisected)
  };
  model: {
    model_hf_id: string;           // ProfileSnapshot.serving.engine.model_hf_id (e.g. "Qwen/Qwen3.6-35B-A3B-FP8")
    model_sha: string;             // HF snapshot sha (resolved from local cache; Plan 05-07 Task 1 fills via huggingface-cli scan-cache)
    quantization: string;          // ProfileSnapshot.serving.engine.quantization ?? "fp8"
    max_model_len: number;         // ProfileSnapshot.serving.engine.max_model_len
  };
  hardware: {
    node: string;                  // operator-set $EMMY_NODE_NAME or `${os.hostname()}`
    uma_total_gib: number;         // 128 on DGX Spark; from `free -g` total or hard-coded with override
    gpu_name: string;              // nvidia-smi --query-gpu=name --format=csv,noheader (e.g. "NVIDIA GB10")
    driver: string;                // nvidia-smi --query-gpu=driver_version --format=csv,noheader
    kernel: string;                // `uname -r` (kernel release; e.g. "6.14.0-1015-nvidia")
  };
  harness: {
    pi_coding_agent_version: string;  // packages/emmy-ux/package.json deps["@mariozechner/pi-coding-agent"]
    emmy_packages: {
      provider: string;            // packages/emmy-provider/package.json version
      tools: string;               // packages/emmy-tools/package.json version
      telemetry: string;           // packages/emmy-telemetry/package.json version
      context: string;             // packages/emmy-context/package.json version
      ux: string;                  // packages/emmy-ux/package.json version
    };
  };
  eval: {
    suite: string;                 // suite_id from suite manifest YAML (e.g. "terminal-bench-2.0")
    suite_manifest_hash: string;   // suite YAML's manifest_hash (sha256:...)
    samples_per_task: number;      // CLI --samples value
    judge: {
      model_id: string;            // e.g. "llama-3.3-70b-instruct" or "cloud-claude-sonnet-4-5" or "none"
      family: string;              // family root from family-guard.familyRoot()
      version: string;             // judge profile version OR API version pin for cloud
      lane: "STRICT" | "PERMISSIVE";  // active air-gap lane during the judge phase
    };
  };
}

export async function captureProvenance(args: {
  profile: ProfileSnapshot;
  suite: string;
  suiteManifestHash?: string;
  samples: number;
}): Promise<Provenance> {
  const gitSha = safe(() => execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(), "[unverified]");
  const nvSmi = safe(() => execSync("nvidia-smi --query-gpu=driver_version,uuid --format=csv,noheader", { encoding: "utf8" }), "[unverified],[unverified]");
  const [driverVersion, gpuUuid] = nvSmi.split(",").map((s) => s.trim());
  const machineId = safe(() => readFileSync("/etc/machine-id", "utf8").trim(), "no-machine-id");
  const uname = safe(() => execSync("uname -a", { encoding: "utf8" }), "");
  const hardwareId = process.env.EMMY_HARDWARE_ID
    ?? createHash("sha256").update(`${gpuUuid}|${uname}|${machineId.slice(0, 64)}`).digest("hex");
  // ... build Provenance object per §Q6 ...
}
function safe<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }
```

`stats/mean-std.ts`:

```typescript
import type { SampleResult } from "../orchestrator";
export class InsufficientSamplesError extends Error { readonly code = "EVAL_INSUFFICIENT_SAMPLES"; }
export interface TaskStats { mean: number; std: number; n: number }
export function computeStats(samples: SampleResult[]): TaskStats {
  const valid = samples.filter((s) => s.exec_score !== null) as Array<SampleResult & { exec_score: number }>;
  if (valid.length < 3) throw new InsufficientSamplesError(`computeStats requires N>=3 valid samples, got ${valid.length}`);
  const xs = valid.map((s) => s.exec_score);
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
  return { mean: round4(mean), std: round4(Math.sqrt(variance)), n };
}
function round4(x: number): number { return Math.round(x * 10000) / 10000; }
```

`stats/promotion-gate.ts` follows the same shape: imports computeStats; for each task in newRun.rows + oldRun.rows compute stats; if any throws InsufficientSamplesError → `promoted:false, reason:"EVAL-04: insufficient samples for task <id>"`; intersect task_ids; suite_complete=false → reject; else compare `mean(new) > mean(old) + std(old)` (mean-of-task-means + mean-of-task-stds aggregator).

`airgap-lane.ts`:

```typescript
export type AirgapLane = "STRICT" | "PERMISSIVE";
export class LaneMismatchError extends Error { readonly code = 5; }
export function verifyAirgapLane(opts: { requestedJudge: string | null }): { lane: AirgapLane } {
  const env = (process.env.EMMY_AIRGAP ?? "strict").toLowerCase();
  const lane: AirgapLane = env === "permissive" ? "PERMISSIVE" : "STRICT";
  if (opts.requestedJudge === "cloud-claude" && lane === "STRICT") {
    throw new LaneMismatchError(
      "EMMY_AIRGAP=strict refuses --judge=cloud-claude. Set EMMY_AIRGAP=permissive (run under ci_verify_research_egress).",
    );
  }
  return { lane };
}
```

`sp-ok-gate.ts`:

```typescript
import { runSpOk } from "@emmy/ux";
export class EvalAbortError extends Error { readonly code = 7; }
export async function runSpOkGate(args: { baseUrl: string; servedModelName: string }) {
  const r = await runSpOk(args.baseUrl, args.servedModelName);
  if (!r.ok) {
    throw new EvalAbortError(
      `EVAL-07: SP_OK canary failed. Aborting batch (Pitfall #6). Response: ${JSON.stringify(r.responseText.slice(0, 200))}`,
    );
  }
  return { ok: true as const, responseText: r.responseText };
}
```

`judge/family-guard.ts`:

```typescript
export class JudgeFamilyConflictError extends Error { readonly code = 6; }
export interface ProfileRefLike { id: string }
/** Family root = first segment before first '-' or '.' in id (lowercase). */
export function familyRoot(id: string): string {
  const seg = id.split(/[-.]/)[0]!;
  return seg.toLowerCase();
}
export function assertJudgeFamilyClean(args: {
  judgeProfileRef: ProfileRefLike;
  generatorProfileRefs: ProfileRefLike[];
}): void {
  const judgeRoot = familyRoot(args.judgeProfileRef.id);
  const conflicts = args.generatorProfileRefs
    .map((g) => ({ id: g.id, root: familyRoot(g.id) }))
    .filter((g) => g.root === judgeRoot);
  if (conflicts.length > 0) {
    throw new JudgeFamilyConflictError(
      `EVAL-06: judge '${args.judgeProfileRef.id}' (family '${judgeRoot}') conflicts with: ` +
      conflicts.map((c) => `${c.id}`).join(", ") + ". Use a different-family judge.",
    );
  }
}
```

NOTE: For judge id `cloud-claude-sonnet-4-5`, family root = `cloud`. This is acceptable since `cloud` is not a generator family root in MATRIX. Document this convention in the JSDoc.

`packages/emmy-ux/src/print-environment.ts`:

```typescript
// EVAL-09: pi-emmy --print-environment dumper.
// Subset of the EVAL-03 provenance schema — eval.suite/samples/judge fields excluded.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export interface Environment {
  schema_version: "emmy.eval.provenance.v1";
  captured_at: string;
  eval_driver_commit: string;
  engine: { vllm_version: string; cuda_version: string; driver_version: string };
  hardware: { hardware_id: string; gpu_uuid: string; platform: string; system_memory_gb: number };
  harness: { pi_coding_agent_version: string; emmy_packages: Record<string, string> };
}

export function dumpEnvironment(): Environment { /* same capture as provenance.ts but narrower; do not import @emmy/eval (avoid circular dep) */ }
```

Wire `pi-emmy --print-environment` flag into `packages/emmy-ux/bin/pi-emmy.ts`: detect at top of `main()` (BEFORE any profile loading), call `dumpEnvironment()`, write JSON to stdout, `process.exit(0)`. Export `dumpEnvironment` from `packages/emmy-ux/src/index.ts`.

Step 3 — Update `packages/emmy-eval/src/index.ts` to re-export the architectural backbone (per Library API listing in <interfaces>).

Step 4 — Run all 7 unit-test files; expect GREEN.

**Verify:**

```
cd /data/projects/emmy
bun test packages/emmy-eval/tests/provenance-shape.test.ts \
        packages/emmy-eval/tests/stats.test.ts \
        packages/emmy-eval/tests/promotion-gate.test.ts \
        packages/emmy-eval/tests/sp-ok-gate.test.ts \
        packages/emmy-eval/tests/airgap-lane.test.ts \
        packages/emmy-eval/tests/judge-family-guard.test.ts \
        packages/emmy-eval/tests/print-environment.test.ts
```

**Done:**
- 7/7 backbone test files GREEN (covers EVAL-03, 04, 06-judge-guard, 07, 08, 09 + D-08 air-gap)
- All modules exported from `packages/emmy-eval/src/index.ts`
- `pi-emmy --print-environment` exits 0 with valid JSON; schema_version field present
- `bun typecheck` exits 0 across 6 packages
- JSDoc on each module cites the relevant RESEARCH.md section + EVAL-* REQ-ID

***

## Task 3 (auto, tdd=true): Orchestrator + suite loader + prior-Phase-1 baseline + report writers + uses-sdk static check

**Files:** `packages/emmy-eval/src/orchestrator.ts`, `packages/emmy-eval/src/suites/{loader,prior-phase1}.ts`, `packages/emmy-eval/src/report/{json,markdown}.ts`, `packages/emmy-eval/tests/{uses-sdk,orchestrator}.test.ts`, `packages/emmy-eval/tests/fixtures/prior-phase1/CODE_0{1..5}_*.json`, `eval/suites/prior-phase1.yaml`

**Behavior:**
- `loadSuite(yamlPath)` parses suite YAML, resolves task JSON paths, returns `Suite` with normalized tasks
- `runSuite(args)` orchestrates: SP_OK pre-flight → provenance capture → for each task × N samples: stage workdir, `createEmmySession`, run task via `runPrint`, score, append sample → write report.json + report.md
- Per-50-sample re-canary mid-run; failure aborts batch with EvalAbortError code 7
- `uses-sdk.test.ts` greps `packages/emmy-eval/src/**/*.ts` for `fetch(`, `postChat(` patterns (excluding allowlisted file `sp-ok-gate.ts` which legitimately wraps runSpOk → postChat); fails if any other file imports postChat directly or calls vLLM endpoints via raw fetch
- `orchestrator.test.ts` end-to-end: stub `createEmmySession` factory + stub `runSpOk` to always return ok; run a 2-task fixture with N=3 samples; assert report.json structure + provenance embedding + suite_complete=true
- prior-phase1 suite has 5 coding fixtures derived from `setup_local_opencode/validation/eval_tasks.py` CODE_01..CODE_05

**Action:**

Step 1 — Author `packages/emmy-eval/src/suites/loader.ts`:
- Reads YAML via `yaml.parse`
- Resolves each `tasks:` path relative to the YAML file's directory
- For each task path, reads JSON, validates required fields (task_id, prompt, source, fixture_files, optional executable_check)
- Returns Suite object with `tasks: Task[]`
- Verifies `manifest_hash:` field exists; recomputes via Plan 05-01's `manifest_hash.ts` and asserts match (fail-loud if mismatch — provenance integrity)

Step 2 — Author 5 prior-phase1 fixture JSON files at `packages/emmy-eval/tests/fixtures/prior-phase1/`. Source content from `/data/projects/setup_local_opencode/validation/eval_tasks.py` CODE_01..CODE_05. Each fixture has:
- `task_id: "CODE_01_csv"` (etc)
- `source: "prior-phase1-continuity"`
- `prompt`: copy verbatim from `eval_tasks.py` task definition
- `fixture_files`: starting state if any (most prior-phase1 tasks create files from scratch)
- `expected_rubric`: copy from prior repo's judging rubric for this task
- `executable_check`: `{kind:"bash", command:"<task-specific test cmd>", expected_exit_code:0}`

D-05 enforced: do NOT include the 3 literature tasks (CRISPR/mRNA/Doudna) — they need pubmed/biorxiv MCP servers and are deferred to Phase 6+.

Step 3 — Author `eval/suites/prior-phase1.yaml`:

```yaml
suite_id: prior-phase1-continuity
suite_version: "1"
manifest_hash: "sha256:PLACEHOLDER"
description: "5 coding tasks from prior repo's Phase 1 validation suite (setup_local_opencode/validation/eval_tasks.py); D-05 literature tasks deferred to Phase 6+"
source_repo: /data/projects/setup_local_opencode
tasks:
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_01_csv.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_02_fibonacci.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_03_pytest_email.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_04_binary_search.json
  - packages/emmy-eval/tests/fixtures/prior-phase1/CODE_05_lru_cache.json
defaults:
  samples: 3
  judge_required: true
```

Then run `bun run scripts/eval/manifest_hash.ts eval/suites/prior-phase1.yaml --rewrite` (CLI from Plan 05-01 Task 2) to fill the real hash.

Step 4 — Author `packages/emmy-eval/src/orchestrator.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEmmySession, loadProfile } from "@emmy/ux";
import { captureProvenance, type Provenance } from "./provenance";
import { runSpOkGate } from "./sp-ok-gate";
import { verifyAirgapLane } from "./airgap-lane";
import { computeStats, InsufficientSamplesError } from "./stats/mean-std";
import { loadSuite, type Suite, type Task } from "./suites/loader";
import { writeReport } from "./report/json";
import { renderMarkdownReport } from "./report/markdown";
import type { SampleResult, SuiteRunResult, TaskRow } from "./orchestrator-types";

export interface SuiteRunArgs {
  profilePath: string;
  suitePath: string;
  samples: number;
  outDir: string;
  baseUrl?: string;
  filter?: RegExp;       // EVAL-08 — using --filter sets suite_complete=false
  maxTasks?: number;     // EVAL-08 — using --max-tasks sets suite_complete=false
  judge?: "self-hosted-llama" | "cloud-claude" | "none" | null;
  declareImprovement?: string;  // baseline run dir
}

export async function runSuite(args: SuiteRunArgs): Promise<SuiteRunResult> {
  // 0. Air-gap lane verification
  verifyAirgapLane({ requestedJudge: args.judge ?? null });

  // 1. EVAL-04: samples gate (refuse N<3 unless explicitly smoke mode)
  if (args.samples < 1) throw new Error(`samples must be >= 1, got ${args.samples}`);
  const isSmokeRun = args.samples < 3;

  // 2. Load profile + suite
  const profile = await loadProfile(args.profilePath);
  const suite = await loadSuite(args.suitePath);

  // 3. EVAL-07: SP_OK pre-flight (the FIRST step of every batch)
  const baseUrl = args.baseUrl ?? "http://127.0.0.1:8002";
  await runSpOkGate({ baseUrl, servedModelName: profile.serving.engine.served_model_name });

  // 4. EVAL-03 + EVAL-09: provenance capture
  mkdirSync(args.outDir, { recursive: true });
  const provenance = await captureProvenance({
    profile, suite: suite.suite_id, suiteManifestHash: suite.manifest_hash, samples: args.samples,
  });
  const provenancePath = join(args.outDir, "provenance.json");
  writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));

  // 5. Determine suite_complete (EVAL-08 anti-prompting-trap gate input)
  const allTasks = suite.tasks;
  let activeTasks: Task[] = allTasks;
  let suiteComplete = true;
  // Per checker Blocker 4: track WHY suite_complete became false. EVAL-08 reasons (filter/max-tasks)
  // are different from Tier-B-coverage smoke-N1 (D-01 expected). 05-06 compareSuiteRuns disambiguates.
  // Precedence (most-specific first): filter > max-tasks > smoke-N1 > complete.
  let suiteCompleteReason: "complete" | "filter" | "max-tasks" | "smoke-N1" = "complete";
  if (args.filter) {
    activeTasks = activeTasks.filter((t) => args.filter!.test(t.task_id));
    suiteComplete = false;
    suiteCompleteReason = "filter";
  } else if (args.maxTasks && activeTasks.length > args.maxTasks) {
    activeTasks = activeTasks.slice(0, args.maxTasks);
    suiteComplete = false;
    suiteCompleteReason = "max-tasks";
  } else if (isSmokeRun) {
    suiteComplete = false;
    suiteCompleteReason = "smoke-N1";   // Tier-B D-01 expected; not an EVAL-08 violation
  }

  // 6. The N-samples × tasks loop
  const rows: TaskRow[] = [];
  let totalSamples = 0;
  let spokFailures = 0;
  let sampleCounter = 0;

  for (const task of activeTasks) {
    const samples: SampleResult[] = [];
    for (let i = 0; i < args.samples; i++) {
      sampleCounter++;
      // Per-50-sample re-canary
      if (sampleCounter > 0 && sampleCounter % 50 === 0) {
        await runSpOkGate({ baseUrl, servedModelName: profile.serving.engine.served_model_name });
      }
      const sample = await runOneSample({ task, profile, baseUrl, sampleIndex: i, outDir: args.outDir });
      if (!sample.sp_ok_canary) spokFailures++;
      samples.push(sample);
      totalSamples++;
    }
    let row: TaskRow;
    try {
      const stats = computeStats(samples);
      row = { task_id: task.task_id, samples, mean_exec: stats.mean, std_exec: stats.std, insufficient_samples: false };
    } catch (e) {
      if (e instanceof InsufficientSamplesError) {
        row = { task_id: task.task_id, samples, mean_exec: NaN, std_exec: NaN, insufficient_samples: true };
      } else throw e;
    }
    rows.push(row);
  }

  const result: SuiteRunResult = {
    suite_id: suite.suite_id,
    suite_complete: suiteComplete,
    suite_complete_reason: suiteCompleteReason,   // Blocker 4 disambiguation
    rows,
    provenance_path: provenancePath,
    report_md_path: join(args.outDir, "report.md"),
    report_json_path: join(args.outDir, "report.json"),
    total_samples: totalSamples,
    spok_failures: spokFailures,
    declare_improvement_blocked_reason: null,
  };

  // 7. Write reports
  writeReport(result.report_json_path, { result, provenance, suite });
  writeFileSync(result.report_md_path, renderMarkdownReport({ result, provenance, suite }));

  // 8. EVAL-08 promotion gate (only if --declare-improvement was passed)
  if (args.declareImprovement) {
    const reason = await tryPromote({ result, baselineDir: args.declareImprovement });
    if (reason) result.declare_improvement_blocked_reason = reason;
  }

  return result;
}

async function runOneSample(args: { task: Task; profile: ProfileSnapshot; baseUrl: string; sampleIndex: number; outDir: string }): Promise<SampleResult> {
  // ... stage workdir, createEmmySession, runPrint, score, append transcript ...
}
```

Step 5 — Implement `runOneSample`: stages a fresh tmp workdir from `task.fixture_files`, calls `createEmmySession({profile, baseUrl, cwd: workdir, mode: "print", userPrompt: task.prompt, sessionId: "..."}`), invokes `session.runPrint(task.prompt, {mode: "json"})`, **runs the per-row SP_OK canary check on the response** (per checker Blocker 3 — SC-5 mandates per-row canary verification, not just batch-level), runs `task.executable_check.command` in workdir, captures exit code, returns the SampleResult with the **actual** per-row canary boolean.

**Per-row canary check (Blocker 3 fix):** Import `SP_OK_ASSERTION_SUBSTR` from `@emmy/ux` (already exported per Plan 02-04). After `runPrint` returns `{ text, messages }`, set `sp_ok_canary = text.includes(SP_OK_ASSERTION_SUBSTR)`. **Note:** the system prompt assembled by `createEmmySession` already includes the SP_OK canary instruction at the layered-prompt level (Plan 02-04 / @emmy/ux/prompt-assembly.ts), so the check is meaningful — the model SHOULD echo `[SP_OK]` somewhere in its response when functioning. If `sp_ok_canary === false`:

  - Set `exec_score = null` (don't record correctness numbers under broken SP-delivery)
  - Increment the orchestrator's `spokFailures` counter (existing logic at line 764)
  - **Do NOT throw mid-row** — that's the orchestrator's per-50-row gate's job; per-row failures get aggregated into the `spokFailures` count and surface in the report header

Concrete return shape:

```typescript
import { SP_OK_ASSERTION_SUBSTR } from "@emmy/ux";

async function runOneSample(args: { task: Task; profile: ProfileSnapshot; baseUrl: string; sampleIndex: number; outDir: string }): Promise<SampleResult> {
  const start = Date.now();
  const workdir = stageWorkdir(args.task.fixture_files);
  const session = await createEmmySession({
    profile: args.profile, baseUrl: args.baseUrl, cwd: workdir,
    mode: "print", userPrompt: args.task.prompt,
    sessionId: `eval-${args.task.task_id}-s${args.sampleIndex}`,
  });
  const { text, messages } = await session.runPrint!(args.task.prompt, { mode: "json" });

  // Blocker 3: per-row canary check (NOT hardcoded true)
  const sp_ok_canary = text.includes(SP_OK_ASSERTION_SUBSTR);

  // exec_score: null if canary failed (SC-5); otherwise run executable_check
  let exec_score: 0 | 1 | null = null;
  if (sp_ok_canary && args.task.executable_check) {
    const proc = spawnSync("bash", ["-c", args.task.executable_check.command], { cwd: workdir, env: { ...process.env, ...workdir_env() } });
    exec_score = (proc.status === args.task.executable_check.expected_exit_code) ? 1 : 0;
  }

  const transcriptPath = appendTranscript(args.outDir, args.task.task_id, args.sampleIndex, messages);
  return {
    sample_index: args.sampleIndex,
    sp_ok_canary,                                // ← actual per-row check, not hardcoded
    exec_score,
    transcript_jsonl_path: transcriptPath,
    duration_ms: Date.now() - start,
    // tokens_in/tokens_out extracted from messages event stream
  };
}
```

The `sp_ok_canary` field is now the SC-5 per-row evidence; the report's `sp_ok_pass_rate` summary is `(N_total - spok_failures) / N_total`.

Step 6 — Author `packages/emmy-eval/src/report/json.ts` (writes the full SuiteRunResult + provenance + suite-manifest-hash to JSON; pretty-printed) and `report/markdown.ts` (renders a markdown table with one row per task: task_id, mean_exec ± std_exec, samples_count, sp_ok_pass_rate; header includes profile.id@version + suite + provenance summary + spok_failures + insufficient_samples_count + suite_complete flag with EVAL-08 callout if false).

Step 7 — Author `uses-sdk.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWLISTED_FILES = new Set([
  "sp-ok-gate.ts",  // legitimately wraps runSpOk which uses postChat
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (e.name.endsWith(".ts")) files.push(p);
  }
  return files;
}

describe("EVAL-02 — eval driver uses SDK, never bypasses", () => {
  it("no postChat() or raw vLLM fetch() calls outside allowlist", () => {
    const violations: string[] = [];
    const files = walk("packages/emmy-eval/src");
    const PATTERNS = [/\bpostChat\s*\(/, /fetch\s*\([^)]*\/v1\/(chat\/completions|messages|models)/];
    for (const f of files) {
      const base = f.split("/").pop()!;
      if (ALLOWLISTED_FILES.has(base)) continue;
      const body = readFileSync(f, "utf8");
      for (const re of PATTERNS) {
        if (re.test(body)) violations.push(`${f} matches ${re}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
```

Step 8 — Author `orchestrator.test.ts`: end-to-end smoke test using a stubbed `createEmmySession` factory (via dependency injection or test-only env hook). Run with 2 fixture tasks (subset of prior-phase1) at N=3 samples; assert:
- `result.suite_complete === true` (no filter, no maxTasks, samples >=3)
- `result.rows.length === 2`
- Each row has `samples.length === 3`
- `provenance.json` exists at `result.provenance_path` with full schema
- `report.md` exists; contains the suite_id and profile.id@version

Step 9 — Re-run `bun test packages/emmy-eval/tests/orchestrator.test.ts packages/emmy-eval/tests/uses-sdk.test.ts`; expect both GREEN.

**Verify:**

```
cd /data/projects/emmy
bun test packages/emmy-eval/tests/uses-sdk.test.ts packages/emmy-eval/tests/orchestrator.test.ts
```

**Done:**
- `loadSuite()` correctly parses prior-phase1.yaml + resolves 5 task fixtures
- 5 prior-phase1 fixtures committed in `packages/emmy-eval/tests/fixtures/prior-phase1/`
- `eval/suites/prior-phase1.yaml` has real `manifest_hash:` (sha256: + 64 hex)
- Orchestrator end-to-end smoke (stubbed createEmmySession) produces valid report.json + report.md + provenance.json
- uses-sdk static check exits 0 (no bypass routes outside allowlist)
- All 9 RED-stub tests from Task 1 are now GREEN

***

## Task 4 (auto): pi-emmy-eval CLI + library exports + workspace integration smoke

**Files:** `packages/emmy-eval/bin/pi-emmy-eval.ts`, `packages/emmy-eval/src/index.ts` (final), root `package.json` (npm script), `packages/emmy-eval/tests/cli.test.ts` (optional sanity check)

**Behavior:**
- `pi-emmy-eval run --profile <path> --suite <yaml> --samples N --out <dir>` invokes `runSuite(args)` and prints "report at <path>"
- `pi-emmy-eval --help` documents all flags + exit codes
- Exit codes match the contract from <interfaces> (0/1/5/6/7/8/9)
- `pi-emmy-eval run --filter <regex> --declare-improvement <baseline>` exits 8 with EVAL-08 message

**Action:**

Step 1 — Author `packages/emmy-eval/bin/pi-emmy-eval.ts`:

```typescript
#!/usr/bin/env bun
// pi-emmy-eval — Phase 5 eval driver CLI.
//
// Subcommands: run, compare (Plan 05-06 wires real impl), report (Plan 05-06).
// This file owns argv parsing + exit-code mapping; orchestration is in @emmy/eval/runSuite.

import { runSuite, EVAL08PromotionBlockedError, evaluatePromotion, /* ... */ } from "../src/index";
import { LaneMismatchError } from "../src/airgap-lane";
import { JudgeFamilyConflictError } from "../src/judge/family-guard";
import { EvalAbortError } from "../src/sp-ok-gate";
import { InsufficientSamplesError } from "../src/stats/mean-std";

const HELP = `pi-emmy-eval <subcommand> [flags]
Subcommands:
  run       Run a suite against a profile, capture samples + provenance, write report
  compare   (Plan 05-06) Side-by-side comparison of two run dirs
  report    (Plan 05-06) Render report from existing run.json
Flags (run):
  --profile <path>           Profile directory (required)
  --suite <yaml>             Suite manifest YAML (required)
  --samples N                Samples per task (default 3; <3 = smoke run, cannot promote)
  --out <dir>                Output directory (required)
  --base-url <url>           vLLM base URL (default http://127.0.0.1:8002)
  --filter <regex>           Subset filter (sets suite_complete=false; cannot promote — EVAL-08)
  --max-tasks N              Limit tasks (sets suite_complete=false; cannot promote — EVAL-08)
  --judge <name>             self-hosted-llama | cloud-claude | none (cloud-claude requires PERMISSIVE)
  --declare-improvement <baseline-run-dir>  Promotion gate (EVAL-08); fails if conditions not met
Exit codes:
  0 success | 1 generic error | 5 lane mismatch | 6 judge family conflict
  7 SP_OK canary fail | 8 EVAL-08 promotion blocked | 9 explicit N<3 + --declare-improvement
`;

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help") { console.log(HELP); return 0; }
  const sub = argv[0];
  if (sub === "compare") { console.error("compare: implemented in Plan 05-06"); return 1; }
  if (sub === "report")  { console.error("report: implemented in Plan 05-06"); return 1; }
  if (sub !== "run")     { console.error(`unknown subcommand: ${sub}\n${HELP}`); return 1; }

  // ... parse remaining flags into SuiteRunArgs ...
  try {
    const result = await runSuite(args);
    if (args.declareImprovement && result.declare_improvement_blocked_reason) {
      console.error(`EVAL-08 promotion blocked: ${result.declare_improvement_blocked_reason}`);
      return 8;
    }
    console.log(`report at ${result.report_md_path}`);
    return 0;
  } catch (e) {
    if (e instanceof LaneMismatchError) { console.error(e.message); return 5; }
    if (e instanceof JudgeFamilyConflictError) { console.error(e.message); return 6; }
    if (e instanceof EvalAbortError) { console.error(e.message); return 7; }
    if (e instanceof EVAL08PromotionBlockedError) { console.error(e.message); return 8; }
    if (e instanceof InsufficientSamplesError) { console.error(e.message); return 9; }
    console.error(`pi-emmy-eval: ${(e as Error).message}`);
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
```

Step 2 — Make `pi-emmy-eval` executable: `chmod +x packages/emmy-eval/bin/pi-emmy-eval.ts`. Add the bin to root package.json devDependencies path mapping if needed.

Step 3 — Author optional `packages/emmy-eval/tests/cli.test.ts` smoke test using `Bun.spawnSync(["bun", "run", "packages/emmy-eval/bin/pi-emmy-eval.ts", "--help"])`; assert exit 0 + stdout contains `pi-emmy-eval <subcommand>`.

Step 4 — Final `packages/emmy-eval/src/index.ts` exports the full library API per <interfaces>.

Step 5 — Run full workspace test suite + typecheck:

```bash
cd /data/projects/emmy
bun typecheck
bun test packages/
```

Expect: typecheck green across all 6 packages; all 9 EVAL test files green; existing Phase 2/3/4 tests unchanged.

**Verify:**

```
cd /data/projects/emmy
bun typecheck && bun run packages/emmy-eval/bin/pi-emmy-eval.ts --help
bun test packages/emmy-eval
```

**Done:**
- `pi-emmy-eval --help` exits 0 with the documented help text
- `pi-emmy-eval run --filter foo --declare-improvement bar/...` exits 8 with EVAL-08 reason
- Workspace typecheck green (6 packages)
- All 9 emmy-eval test files green; no regressions in Phase 2/3/4 tests
- One commit per task in this plan; final commit message references Plan 05-02 EVAL-* IDs covered

# Threat Model

## Trust Boundaries

| Boundary | Description |
|---|---|
| eval driver → emmy-serve (loopback) | All inference goes through @emmy/ux createEmmySession; never raw fetch — enforced by uses-sdk static check |
| eval driver ← profile YAML | Profile schema already hardened in Phase 1+4; eval reads via @emmy/ux loadProfile |
| eval driver → /etc/machine-id + nvidia-smi + git | Provenance capture; fall back to "[unverified]" sentinels rather than failing eval |
| eval driver → cloud judge endpoint | ONLY under PERMISSIVE lane (D-08 verified at startup); STRICT refuses |
| Suite YAML → suite manifest hash | Recomputed on load; mismatch fails fast (provenance integrity) |
| Operator → --declare-improvement flag | Cannot promote on subset/N<3/variance overlap (EVAL-08); enforced at gate, not docs |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-05-02-01 | T (Tampering) | suite YAML manifest_hash | mitigate | Loader recomputes via `manifest_hash.ts` and asserts match; fail-loud on mismatch |
| T-05-02-02 | I (Information disclosure) | provenance.json eval_driver_commit | accept | Public git SHA; no secret content |
| T-05-02-03 | E (Elevation of privilege) | --judge=cloud-claude under STRICT | mitigate | airgap-lane.ts throws LaneMismatchError before any network call; CI lane verifier (Plan 05-07) double-checks at outer level |
| T-05-02-04 | S (Spoofing) | judge same family as generator | mitigate | judge-family-guard.ts asserts at runtime; orchestrator calls assertJudgeFamilyClean before judge invocation (judge wiring in Plan 05-05) |
| T-05-02-05 | R (Repudiation) | report.json verdict='positive' on subset | mitigate | EVAL-08 promotion-gate.ts enforces suite_complete=true + N>=3 + mean+std comparison; --filter / --max-tasks / --samples<3 all flip suite_complete=false |
| T-05-02-06 | T | SP_OK canary skipped | mitigate | runSpOkGate is the FIRST orchestrator step; per-50-sample re-canary catches mid-run breakage |
| T-05-02-07 | D (DoS) | provenance capture subprocess hangs (e.g. nvidia-smi flake) | mitigate | execSync with explicit timeout; safe() helper falls back to "[unverified]" rather than blocking |
| T-05-02-08 | I | --filter regex passed by operator could ReDoS | accept | Operator-controlled flag; pathological regex would only DoS the operator's own batch |
| T-05-02-09 | E | uses-sdk static check could be bypassed by future PR adding new vLLM endpoint pattern | mitigate | Pattern list is in test; reviewer must update both the test and the code; new vLLM endpoint paths must be added to the regex |

# Verification

End-of-plan checks:

1. `bun typecheck` exits 0 across 6 packages
2. `bun test packages/emmy-eval/tests` — all 9 RED stubs from Task 1 are now GREEN; no regressions in any of the 7 backbone tests
3. `bun test packages/` — Phase 2/3/4 tests unchanged (count comparison vs pre-plan baseline)
4. `bun run packages/emmy-eval/bin/pi-emmy-eval.ts --help` exits 0
5. `EMMY_AIRGAP=strict bun run packages/emmy-eval/bin/pi-emmy-eval.ts run --profile profiles/qwen3.6-35b-a3b/v3.1 --suite eval/suites/prior-phase1.yaml --samples 3 --out /tmp/x --judge cloud-claude` exits 5 (lane mismatch)
6. End-to-end stub run produces a valid `report.json` with the full provenance dict embedded + a markdown report with the EVAL-08 callout when subset run
7. `bun run packages/emmy-ux/bin/pi-emmy.ts --print-environment | jq -e '.schema_version == "emmy.eval.provenance.v1"'` exits 0
8. `git log --oneline` shows at least 4 commits (one per task), each referencing Plan 05-02 + EVAL-* IDs covered

# Success Criteria

- Plan 05-03/04/05/06 can `import { runSuite, captureProvenance, ... } from "@emmy/eval"` and add new suite adapters without touching the orchestrator core
- Plan 05-07's reproducer script can invoke `pi-emmy-eval run` with the documented flag set and trust the exit-code contract
- Phase 5 SC-1 (run produces JSON+markdown reports with full provenance) is met for the prior-Phase-1 suite by end of this plan; remaining suites land in 05-03/04
- Phase 5 SC-4 (subset-run promotion blocked) is met fully by this plan
- Phase 5 SC-5 (SP_OK gates every batch) is met fully by this plan

# Output

After completion, create `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-02-SUMMARY.md` per the standard summary template. Cite:
- Final test count delta (X new tests, all green)
- 9 EVAL/UX REQ-IDs status: 7 of 9 fully covered (EVAL-02, 03, 04, 07, 08, 09 + UX-06); EVAL-01 partial (prior-phase1 suite only — 05-03/04 add tbench + SWE-Lite); EVAL-05 in 05-01; EVAL-06 in 05-05
- Commit SHAs (one per task)
- Library API surface confirmed exportable from `@emmy/eval`
