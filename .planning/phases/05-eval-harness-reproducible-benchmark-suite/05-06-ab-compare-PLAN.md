---
phase: 05
plan: 06
type: execute
wave: 4
depends_on: ["05-02", "05-03", "05-04"]
files_modified:
  - packages/emmy-eval/src/compare/ab-compare.ts
  - packages/emmy-eval/src/compare/aggregator.ts
  - packages/emmy-eval/src/compare/index.ts
  - packages/emmy-eval/src/report/markdown.ts
  - packages/emmy-eval/src/report/json.ts
  - packages/emmy-eval/bin/pi-emmy-eval.ts
  - packages/emmy-eval/tests/ab-compare.test.ts
  - packages/emmy-eval/tests/aggregator.test.ts
  - packages/emmy-eval/tests/report-md.test.ts
  - packages/emmy-eval/src/index.ts
autonomous: true
requirements: [POLISH-01]
tags: [eval, ab-compare, report-generator, polish]

must_haves:
  truths:
    - "POLISH-01: pi-emmy-eval compare --baseline <run-dir-A> --candidate <run-dir-B> --out <markdown-path> produces a side-by-side markdown report comparing two run dirs' report.json"
    - "Comparison is statistical: per-task delta = mean_B - mean_A; suite-level verdict computed via three-way classifier — 'different' (mean delta > std_pooled), 'same' (delta within ±std_pooled overlap), 'inconclusive' (insufficient samples in either side)"
    - "ab-compare.ts is a pure function over two SuiteRunResult objects; testable without GPU; comparison result is a SuiteComparison object with fields {suite_id_a, suite_id_b, profile_a, profile_b, per_task: {task_id, mean_a, std_a, mean_b, std_b, delta, verdict}, suite_verdict, total_tasks_compared, mismatched_tasks, mismatched_skips}"
    - "aggregator.ts: cross-cell 4-profile MATRIX aggregator — given a directory containing one report.json per profile, produces a single matrix table (profiles × tasks) for inclusion in REPRODUCER.md (Plan 05-07)"
    - "Markdown report format includes (a) header with both profiles + suite + provenance summary, (b) per-task table with deltas highlighted, (c) statistical summary line per suite, (d) callouts for mismatched_skips (different SKIP_LIST.yaml between runs)"
    - "JSON output format: SuiteComparison object serialized; consumable by Plan 05-07's REPRODUCER.md generator"
    - "EVAL-08 inheritance with Blocker-4 disambiguation: comparison switches on each run's suite_complete_reason field (Plan 05-02 contract). 'filter' / 'max-tasks' → comparable_warning carries EVAL-08 callout. 'smoke-N1' → comparable_warning carries Tier-B-D-01 callout (NOT EVAL-08; D-01 dense N=1 is expected Tier-B-coverage). 'complete' → no warning. Plan 05-06 ships dedicated unit tests for each reason path"
    - "ab-compare.test.ts covers: (a) mean(B) > mean(A) + std(A) → 'different' favoring B, (b) mean(B) within ±std(A) → 'same', (c) one side has insufficient_samples → 'inconclusive', (d) different SKIP_LIST.yaml → mismatched_skips emitted, (e) suite_id mismatch → throws (cannot compare across different suites)"
  artifacts:
    - path: "packages/emmy-eval/src/compare/ab-compare.ts"
      provides: "Pure-function 2-profile comparison; consumes two SuiteRunResult; produces SuiteComparison"
      contains: "export function compareSuiteRuns"
      min_lines: 60
    - path: "packages/emmy-eval/src/compare/aggregator.ts"
      provides: "4-profile MATRIX aggregator; consumes a dir of report.json files; produces a matrix table"
      contains: "aggregateMatrix"
    - path: "packages/emmy-eval/src/report/markdown.ts"
      provides: "Updated markdown renderer with comparison-table support (extended from Plan 05-02 base)"
      contains: "renderComparisonMarkdown"
    - path: "packages/emmy-eval/bin/pi-emmy-eval.ts"
      provides: "CLI compare + report subcommands wired (replacing Plan 05-02 stubs)"
      contains: "case \"compare\""
    - path: "packages/emmy-eval/tests/ab-compare.test.ts"
      provides: "5+ unit tests for ab-compare logic"
      contains: "compareSuiteRuns"
  key_links:
    - from: "packages/emmy-eval/src/compare/ab-compare.ts"
      to: "packages/emmy-eval/src/stats/mean-std.ts (computeStats)"
      via: "import"
      pattern: "computeStats"
    - from: "packages/emmy-eval/bin/pi-emmy-eval.ts"
      to: "packages/emmy-eval/src/compare/ab-compare.ts (compareSuiteRuns)"
      via: "subcommand wiring"
      pattern: "compareSuiteRuns"
    - from: "packages/emmy-eval/src/compare/aggregator.ts"
      to: "runs/phase5-tbench/{4 profile slugs}/<iso>/report.json"
      via: "filesystem glob"
      pattern: "report.json"
---

# Objective

Wire POLISH-01 — the A/B profile comparison report generator. Author `pi-emmy-eval compare --baseline X --candidate Y` that consumes two run directories' `report.json`, computes per-task statistical deltas, produces a side-by-side markdown comparison + JSON output. Author the cross-cell 4-profile MATRIX aggregator that Plan 05-07's REPRODUCER.md generator will consume to render a full Qwen-MoE × Qwen-dense × Gemma-MoE × Gemma-dense table.

Purpose: The 4-profile MATRIX (Qwen MoE/dense × Gemma MoE/dense + the Llama judge) was authored explicitly so Phase 5 could *compare* — dense vs MoE on coding tasks, Qwen vs Gemma on the same axes. Without POLISH-01, Phase 5 ships isolated numbers per profile with no comparator; the eval is informational, not decisional. POLISH-02 (replay) and POLISH-03 (static dashboard) are deferred (D-09 from 05-CONTEXT.md).

Output:
- `packages/emmy-eval/src/compare/{ab-compare,aggregator,index}.ts` + 5+ unit tests
- `packages/emmy-eval/src/report/markdown.ts` extended with comparison-table renderer
- `pi-emmy-eval compare` and `pi-emmy-eval report` CLI subcommands wired (replacing Plan 05-02 stubs)
- All tests GREEN; library importable; no GPU required

# Execution Context

@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

# Context

@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CONTEXT.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-RESEARCH.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-02-eval-driver-core-PLAN.md
@CLAUDE.md
@eval/MATRIX.md

## Interfaces

SuiteRunResult shape (from Plan 05-02 — input to compare):

```typescript
export interface SuiteRunResult {
  suite_id: string;
  suite_complete: boolean;
  rows: Array<{ task_id: string; samples: SampleResult[]; mean_exec: number; std_exec: number; insufficient_samples: boolean }>;
  // ... other fields ...
}
```

SuiteComparison shape (output of compareSuiteRuns):

```typescript
export type Verdict = "different-favoring-a" | "different-favoring-b" | "same" | "inconclusive";

export interface PerTaskComparison {
  task_id: string;
  mean_a: number;
  std_a: number;
  mean_b: number;
  std_b: number;
  delta: number;        // mean_b - mean_a
  verdict: Verdict;
  reason: string;       // e.g. "delta 0.18 > std_pooled 0.12"
}

export interface SuiteComparison {
  suite_id: string;
  profile_a: { id: string; version: string; hash: string };
  profile_b: { id: string; version: string; hash: string };
  baseline_run_dir: string;
  candidate_run_dir: string;
  total_tasks_compared: number;
  per_task: PerTaskComparison[];
  suite_verdict: Verdict;
  suite_mean_a: number;
  suite_mean_b: number;
  suite_std_a: number;
  suite_std_b: number;
  mismatched_skips: { only_in_a: string[]; only_in_b: string[] };
  comparable_warning: string | null;   // Per Blocker 4: switches on each run's suite_complete_reason — EVAL-08 callout for filter/max-tasks; D-01 Tier-B callout for smoke-N1; null for complete/complete
}
```

Verdict classifier algorithm:

```typescript
function classify(meanA: number, stdA: number, meanB: number, stdB: number): { verdict: Verdict; reason: string } {
  const delta = meanB - meanA;
  const stdPooled = Math.sqrt((stdA ** 2 + stdB ** 2) / 2);   // pooled std assuming equal sample size
  if (Math.abs(delta) <= stdPooled) {
    return { verdict: "same", reason: `|delta ${delta.toFixed(4)}| <= pooled std ${stdPooled.toFixed(4)}` };
  }
  return delta > 0
    ? { verdict: "different-favoring-b", reason: `delta ${delta.toFixed(4)} > pooled std ${stdPooled.toFixed(4)}` }
    : { verdict: "different-favoring-a", reason: `delta ${delta.toFixed(4)} < -pooled std ${stdPooled.toFixed(4)}` };
}
```

Comparison comparable_warning sources (per checker Blocker 4 — disambiguate D-01 dense smoke from EVAL-08 violations):

The warning text depends on `suite_complete_reason` from each run's report.json (Plan 05-02 frontmatter contract):

| reason value | warning string contributed | Verdict authority |
|---|---|---|
| `complete`    | (none) | full authority |
| `filter`      | `EVAL-08: run had a --filter active; directional verdict not authoritative` | EVAL-08 caveat |
| `max-tasks`   | `EVAL-08: run was limited by --max-tasks; directional verdict not authoritative` | EVAL-08 caveat |
| `smoke-N1`    | `Tier-B smoke (D-01): N=1 by design; deltas indicative not statistical` | D-01 expected; NOT EVAL-08 |

Other warning sources unchanged:
- Either run has `mismatched_skips` non-empty → "skip lists differ; some tasks present in only one run"
- suite_id mismatch → throw (refuse to compare across different suites)

The `comparable_warning` field concatenates all triggered warnings with `; ` separators. A 4-profile MATRIX comparison where Qwen MoE is N=3 (`complete`) but Qwen dense is N=1 (`smoke-N1`) gets the **D-01 callout, not the EVAL-08 callout** — because dense smoke is the planned coverage, not a subset trap.

CLI shape:

```bash
pi-emmy-eval compare \
    --baseline runs/phase5-tbench/qwen35-a3b-v3.1/<iso>/ \
    --candidate runs/phase5-tbench/qwen27b-v1.1/<iso>/ \
    --out runs/phase5-compare/qwen-moe-vs-dense-tbench.md \
    [--json runs/phase5-compare/qwen-moe-vs-dense-tbench.json]

pi-emmy-eval report \
    --run runs/phase5-tbench/qwen35-a3b-v3.1/<iso>/ \
    --format markdown
    [--out path]      # default: <run-dir>/report.md (regenerates)

pi-emmy-eval matrix \
    --suite terminal-bench-2.0 \
    --runs-dir runs/phase5-tbench/ \
    --out runs/phase5-compare/tbench-matrix.md
```

## Key Files

- `packages/emmy-eval/src/orchestrator.ts` — produces report.json files; this plan consumes them
- `packages/emmy-eval/src/stats/mean-std.ts` — computeStats helper
- `packages/emmy-eval/src/report/markdown.ts` — Plan 05-02 base renderer (extended here)
- `packages/emmy-eval/bin/pi-emmy-eval.ts` — Plan 05-02 stubs for `compare` + `report` (this plan implements)
- `eval/MATRIX.md` — referenced for the 4-profile cross-cell table layout

# Tasks

## Task 1 (auto, tdd=true): ab-compare logic + aggregator + markdown renderer + tests

**Files:** `packages/emmy-eval/src/compare/{ab-compare,aggregator,index}.ts`, `packages/emmy-eval/src/report/markdown.ts` (extend), `packages/emmy-eval/tests/{ab-compare,aggregator,report-md}.test.ts`, `packages/emmy-eval/src/index.ts`

**Behavior:**
- 5+ tests for ab-compare per <interfaces>
- 3+ tests for aggregator (loads report.json files, builds profiles × tasks matrix, handles missing reports)
- 2+ tests for report-md renderer (renders comparison + matrix tables to valid markdown that parses with a markdown parser)

**Action:**

Step 1 — RED tests first. Author `packages/emmy-eval/tests/ab-compare.test.ts` covering:

```typescript
import { describe, expect, it } from "bun:test";
import { compareSuiteRuns } from "../src/compare/ab-compare";

const synthRun = (
  id: string,
  complete: boolean,
  rows: Array<{ task_id: string; mean: number; std: number; insufficient?: boolean }>,
  reason: "complete" | "filter" | "max-tasks" | "smoke-N1" = complete ? "complete" : "filter",
) => ({
  suite_id: "test-suite",
  suite_complete: complete,
  suite_complete_reason: reason,    // Blocker 4
  rows: rows.map((r) => ({
    task_id: r.task_id,
    samples: [], mean_exec: r.mean, std_exec: r.std, insufficient_samples: !!r.insufficient,
  })),
  provenance_path: "", report_md_path: "", report_json_path: "",
  total_samples: 0, spok_failures: 0, declare_improvement_blocked_reason: null,
});
const profA = { id: "qwen3.6-35b-a3b", version: "v3.1", hash: "sha256:aaa" };
const profB = { id: "qwen3.6-27b", version: "v1.1", hash: "sha256:bbb" };

describe("compareSuiteRuns", () => {
  it("delta > pooled std → 'different-favoring-b'", () => {
    const a = synthRun("a", true, [{ task_id: "t1", mean: 0.5, std: 0.1 }]);
    const b = synthRun("b", true, [{ task_id: "t1", mean: 0.8, std: 0.1 }]);
    const c = compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" });
    expect(c.per_task[0]!.verdict).toBe("different-favoring-b");
    expect(c.suite_verdict).toBe("different-favoring-b");
  });

  it("delta within ±std → 'same'", () => {
    const a = synthRun("a", true, [{ task_id: "t1", mean: 0.5, std: 0.1 }]);
    const b = synthRun("b", true, [{ task_id: "t1", mean: 0.55, std: 0.1 }]);
    const c = compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" });
    expect(c.per_task[0]!.verdict).toBe("same");
  });

  it("insufficient_samples on either side → 'inconclusive'", () => {
    const a = synthRun("a", true, [{ task_id: "t1", mean: 0, std: 0, insufficient: true }]);
    const b = synthRun("b", true, [{ task_id: "t1", mean: 0.5, std: 0.1 }]);
    const c = compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" });
    expect(c.per_task[0]!.verdict).toBe("inconclusive");
  });

  it("suite_id mismatch → throws", () => {
    const a = { ...synthRun("a", true, []), suite_id: "S1" };
    const b = { ...synthRun("b", true, []), suite_id: "S2" };
    expect(() => compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" })).toThrow(/suite_id mismatch/);
  });

  it("suite_complete_reason='filter' → comparable_warning carries EVAL-08 callout (Blocker 4)", () => {
    const a = synthRun("a", false, [{ task_id: "t1", mean: 0.5, std: 0.1 }], "filter");
    const b = synthRun("b", true, [{ task_id: "t1", mean: 0.8, std: 0.1 }]);
    const c = compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" });
    expect(c.comparable_warning).toContain("EVAL-08");
    expect(c.comparable_warning).toContain("--filter");
  });

  it("suite_complete_reason='smoke-N1' → comparable_warning carries D-01 callout, NOT EVAL-08 (Blocker 4)", () => {
    // D-01 dense smoke is expected Tier-B-coverage behavior, not a subset-trap violation.
    const a = synthRun("a", true, [{ task_id: "t1", mean: 0.5, std: 0.1 }]);
    const b = synthRun("b", false, [{ task_id: "t1", mean: 0.4, std: 0.0 }], "smoke-N1");
    const c = compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" });
    expect(c.comparable_warning).toContain("Tier-B smoke (D-01)");
    expect(c.comparable_warning).not.toContain("EVAL-08");
  });

  it("suite_complete_reason='max-tasks' → comparable_warning carries EVAL-08 max-tasks callout", () => {
    const a = synthRun("a", true, [{ task_id: "t1", mean: 0.5, std: 0.1 }]);
    const b = synthRun("b", false, [{ task_id: "t1", mean: 0.7, std: 0.1 }], "max-tasks");
    const c = compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" });
    expect(c.comparable_warning).toContain("EVAL-08");
    expect(c.comparable_warning).toContain("--max-tasks");
  });

  it("mismatched_skips: a has t2, b lacks t2", () => {
    const a = synthRun("a", true, [{ task_id: "t1", mean: 0.5, std: 0.1 }, { task_id: "t2", mean: 0.7, std: 0.1 }]);
    const b = synthRun("b", true, [{ task_id: "t1", mean: 0.6, std: 0.1 }]);
    const c = compareSuiteRuns({ a, b, profileA: profA, profileB: profB, baselineRunDir: "/a", candidateRunDir: "/b" });
    expect(c.mismatched_skips.only_in_a).toContain("t2");
    expect(c.total_tasks_compared).toBe(1);
  });
});
```

Step 2 — Author `packages/emmy-eval/src/compare/ab-compare.ts`:

```typescript
import type { SuiteRunResult } from "../orchestrator";

export type Verdict = "different-favoring-a" | "different-favoring-b" | "same" | "inconclusive";

export interface PerTaskComparison {
  task_id: string; mean_a: number; std_a: number; mean_b: number; std_b: number;
  delta: number; verdict: Verdict; reason: string;
}

export interface SuiteComparison {
  suite_id: string;
  profile_a: { id: string; version: string; hash: string };
  profile_b: { id: string; version: string; hash: string };
  baseline_run_dir: string;
  candidate_run_dir: string;
  total_tasks_compared: number;
  per_task: PerTaskComparison[];
  suite_verdict: Verdict;
  suite_mean_a: number;
  suite_mean_b: number;
  suite_std_a: number;
  suite_std_b: number;
  mismatched_skips: { only_in_a: string[]; only_in_b: string[] };
  comparable_warning: string | null;
}

function classify(meanA: number, stdA: number, meanB: number, stdB: number): { verdict: Verdict; reason: string } {
  const delta = meanB - meanA;
  const stdPooled = Math.sqrt((stdA * stdA + stdB * stdB) / 2);
  if (Math.abs(delta) <= stdPooled) {
    return { verdict: "same", reason: `|delta ${round4(delta)}| <= pooled std ${round4(stdPooled)}` };
  }
  return delta > 0
    ? { verdict: "different-favoring-b", reason: `delta ${round4(delta)} > pooled std ${round4(stdPooled)}` }
    : { verdict: "different-favoring-a", reason: `delta ${round4(delta)} < -pooled std ${round4(stdPooled)}` };
}

function round4(x: number): number { return Math.round(x * 10000) / 10000; }

export function compareSuiteRuns(args: {
  a: SuiteRunResult;
  b: SuiteRunResult;
  profileA: { id: string; version: string; hash: string };
  profileB: { id: string; version: string; hash: string };
  baselineRunDir: string;
  candidateRunDir: string;
}): SuiteComparison {
  if (args.a.suite_id !== args.b.suite_id) {
    throw new Error(`suite_id mismatch: cannot compare across different suites (${args.a.suite_id} vs ${args.b.suite_id})`);
  }

  const aRows = new Map(args.a.rows.map((r) => [r.task_id, r]));
  const bRows = new Map(args.b.rows.map((r) => [r.task_id, r]));
  const sharedIds = [...aRows.keys()].filter((id) => bRows.has(id));
  const onlyInA = [...aRows.keys()].filter((id) => !bRows.has(id));
  const onlyInB = [...bRows.keys()].filter((id) => !aRows.has(id));

  const perTask: PerTaskComparison[] = [];
  const sumA: number[] = []; const sumB: number[] = [];
  const stdsA: number[] = []; const stdsB: number[] = [];

  for (const id of sharedIds) {
    const a = aRows.get(id)!; const b = bRows.get(id)!;
    if (a.insufficient_samples || b.insufficient_samples) {
      perTask.push({
        task_id: id, mean_a: a.mean_exec, std_a: a.std_exec, mean_b: b.mean_exec, std_b: b.std_exec,
        delta: NaN, verdict: "inconclusive",
        reason: `insufficient samples: a=${a.insufficient_samples} b=${b.insufficient_samples}`,
      });
      continue;
    }
    const c = classify(a.mean_exec, a.std_exec, b.mean_exec, b.std_exec);
    perTask.push({ task_id: id, mean_a: a.mean_exec, std_a: a.std_exec, mean_b: b.mean_exec, std_b: b.std_exec, delta: round4(b.mean_exec - a.mean_exec), ...c });
    sumA.push(a.mean_exec); sumB.push(b.mean_exec);
    stdsA.push(a.std_exec); stdsB.push(b.std_exec);
  }

  const conclusive = perTask.filter((p) => p.verdict !== "inconclusive");
  const suiteMeanA = sumA.length ? avg(sumA) : NaN;
  const suiteMeanB = sumB.length ? avg(sumB) : NaN;
  const suiteStdA = stdsA.length ? avg(stdsA) : NaN;
  const suiteStdB = stdsB.length ? avg(stdsB) : NaN;
  const suiteVerdict = sumA.length === 0 ? "inconclusive" : classify(suiteMeanA, suiteStdA, suiteMeanB, suiteStdB).verdict;

  // Blocker 4: disambiguate by suite_complete_reason — D-01 smoke-N1 is NOT an EVAL-08 violation
  const warnings: string[] = [];
  for (const [label, run] of [["baseline", args.a], ["candidate", args.b]] as const) {
    switch (run.suite_complete_reason) {
      case "complete":  break;
      case "filter":    warnings.push(`EVAL-08: ${label} run had a --filter active; directional verdict not authoritative`); break;
      case "max-tasks": warnings.push(`EVAL-08: ${label} run was limited by --max-tasks; directional verdict not authoritative`); break;
      case "smoke-N1":  warnings.push(`Tier-B smoke (D-01): ${label} run is N=1 by design; deltas indicative not statistical`); break;
    }
  }
  if (onlyInA.length > 0 || onlyInB.length > 0) {
    warnings.push(`skip lists differ; only_in_a=${onlyInA.length} only_in_b=${onlyInB.length}`);
  }

  return {
    suite_id: args.a.suite_id,
    profile_a: args.profileA,
    profile_b: args.profileB,
    baseline_run_dir: args.baselineRunDir,
    candidate_run_dir: args.candidateRunDir,
    total_tasks_compared: sharedIds.length,
    per_task: perTask,
    suite_verdict: suiteVerdict,
    suite_mean_a: round4(suiteMeanA),
    suite_mean_b: round4(suiteMeanB),
    suite_std_a: round4(suiteStdA),
    suite_std_b: round4(suiteStdB),
    mismatched_skips: { only_in_a: onlyInA, only_in_b: onlyInB },
    comparable_warning: warnings.length > 0 ? warnings.join("; ") : null,
  };
}

function avg(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
```

Step 3 — Author `packages/emmy-eval/src/compare/aggregator.ts`:

```typescript
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface MatrixCell { profile_id: string; profile_version: string; suite_mean: number; suite_std: number; total_samples: number; complete: boolean }
export interface MatrixTable { suite_id: string; cells: MatrixCell[]; tasks: string[] }

/**
 * Walk a directory like runs/phase5-tbench/{profile_slug}/<iso>/report.json
 * and aggregate into a profiles × tasks matrix.
 */
export function aggregateMatrix(args: { suiteId: string; runsRootDir: string }): MatrixTable {
  const cells: MatrixCell[] = [];
  let allTaskIds = new Set<string>();
  for (const profileSlug of readdirSync(args.runsRootDir)) {
    const profileDir = join(args.runsRootDir, profileSlug);
    if (!existsSync(profileDir)) continue;
    // pick the most recent ISO-named subdir
    const isoDirs = readdirSync(profileDir).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
    const latest = isoDirs[isoDirs.length - 1];
    if (!latest) continue;
    const reportPath = join(profileDir, latest, "report.json");
    if (!existsSync(reportPath)) continue;
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { result: { suite_id: string; rows: Array<{ task_id: string; mean_exec: number; std_exec: number }>; suite_complete: boolean; total_samples: number }; provenance: { profile: { id: string; version: string } } };
    if (report.result.suite_id !== args.suiteId) continue;
    const meanCellMean = avg(report.result.rows.map((r) => r.mean_exec).filter((n) => !isNaN(n)));
    const meanCellStd = avg(report.result.rows.map((r) => r.std_exec).filter((n) => !isNaN(n)));
    cells.push({
      profile_id: report.provenance.profile.id,
      profile_version: report.provenance.profile.version,
      suite_mean: round4(meanCellMean), suite_std: round4(meanCellStd),
      total_samples: report.result.total_samples,
      complete: report.result.suite_complete,
    });
    for (const r of report.result.rows) allTaskIds.add(r.task_id);
  }
  return { suite_id: args.suiteId, cells, tasks: Array.from(allTaskIds).sort() };
}

function avg(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function round4(x: number): number { return Math.round(x * 10000) / 10000; }
```

Step 4 — Extend `packages/emmy-eval/src/report/markdown.ts` with a `renderComparisonMarkdown(c: SuiteComparison): string` function and a `renderMatrixMarkdown(m: MatrixTable): string` function. Each emits a markdown table with appropriate header + footnotes (EVAL-08 callout if comparable_warning is set).

Step 5 — Author `packages/emmy-eval/tests/aggregator.test.ts` covering: (a) loads multiple profile directories and builds matrix correctly, (b) skips dirs without report.json, (c) chooses most recent ISO subdir per profile.

Step 6 — Author `packages/emmy-eval/tests/report-md.test.ts` covering: (a) renderComparisonMarkdown produces parseable markdown with task delta column, (b) renderMatrixMarkdown produces parseable markdown with one row per profile cell.

Step 7 — Update `packages/emmy-eval/src/index.ts` to re-export `from "./compare/ab-compare"` + `"./compare/aggregator"`.

Step 8 — Run all tests: `bun test packages/emmy-eval/tests/{ab-compare,aggregator,report-md}.test.ts`. Expect green.

**Verify:**

```
cd /data/projects/emmy && bun test packages/emmy-eval/tests/ab-compare.test.ts packages/emmy-eval/tests/aggregator.test.ts packages/emmy-eval/tests/report-md.test.ts
```

**Done:**
- 5+ ab-compare tests + 3+ aggregator tests + 2+ report-md tests all GREEN
- compareSuiteRuns + aggregateMatrix + renderComparisonMarkdown + renderMatrixMarkdown exported from `@emmy/eval`
- bun typecheck across packages exits 0

---

## Task 2 (auto): Wire pi-emmy-eval compare/report/matrix subcommands

**Files:** `packages/emmy-eval/bin/pi-emmy-eval.ts`, `packages/emmy-eval/tests/cli-compare.test.ts`

**Behavior:**
- `pi-emmy-eval compare --baseline <run-dir> --candidate <run-dir> --out <md-path> [--json <json-path>]` reads both report.json files, calls compareSuiteRuns, writes markdown + optional JSON, exits 0
- `pi-emmy-eval report --run <run-dir> [--format markdown] [--out <path>]` re-renders the report.md from existing report.json (useful if Plan 05-02's renderer template improves)
- `pi-emmy-eval matrix --suite <suite_id> --runs-dir <root> --out <md-path>` invokes aggregateMatrix + renderMatrixMarkdown
- All subcommands emit clear stderr messages on missing inputs; exit 1 on error

**Action:**

Step 1 — Edit `packages/emmy-eval/bin/pi-emmy-eval.ts` replacing the Plan 05-02 stubs:

```typescript
// ... (existing imports + main() shell from Plan 05-02 Task 4) ...

import { compareSuiteRuns } from "../src/compare/ab-compare";
import { aggregateMatrix } from "../src/compare/aggregator";
import { renderComparisonMarkdown, renderMatrixMarkdown, renderMarkdownReport } from "../src/report/markdown";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function cmdCompare(argv: string[]): Promise<number> {
  // parse --baseline --candidate --out [--json]
  const args = parseArgs(argv, ["baseline", "candidate", "out", "json"]);
  const baselineReport = JSON.parse(readFileSync(join(args.baseline, "report.json"), "utf8"));
  const candidateReport = JSON.parse(readFileSync(join(args.candidate, "report.json"), "utf8"));
  const profA = baselineReport.provenance?.profile ?? { id: "?", version: "?", hash: "?" };
  const profB = candidateReport.provenance?.profile ?? { id: "?", version: "?", hash: "?" };
  const c = compareSuiteRuns({
    a: baselineReport.result, b: candidateReport.result,
    profileA: profA, profileB: profB,
    baselineRunDir: args.baseline, candidateRunDir: args.candidate,
  });
  writeFileSync(args.out, renderComparisonMarkdown(c));
  if (args.json) writeFileSync(args.json, JSON.stringify(c, null, 2));
  console.log(`comparison written: ${args.out}${args.json ? " + " + args.json : ""}`);
  return 0;
}

async function cmdReport(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["run", "format", "out"]);
  const report = JSON.parse(readFileSync(join(args.run, "report.json"), "utf8"));
  const out = args.out ?? join(args.run, "report.md");
  writeFileSync(out, renderMarkdownReport(report));
  console.log(`report rendered: ${out}`);
  return 0;
}

async function cmdMatrix(argv: string[]): Promise<number> {
  const args = parseArgs(argv, ["suite", "runs-dir", "out"]);
  const m = aggregateMatrix({ suiteId: args.suite, runsRootDir: args["runs-dir"] });
  writeFileSync(args.out, renderMatrixMarkdown(m));
  console.log(`matrix written: ${args.out}`);
  return 0;
}

// Main dispatcher
async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help") { console.log(HELP); return 0; }
  switch (argv[0]) {
    case "run":     return cmdRun(argv.slice(1));     // existing from Plan 05-02
    case "compare": return cmdCompare(argv.slice(1));
    case "report":  return cmdReport(argv.slice(1));
    case "matrix":  return cmdMatrix(argv.slice(1));
    default: console.error(`unknown subcommand: ${argv[0]}`); return 1;
  }
}
```

Update HELP string with the new subcommands' flags.

Step 2 — Author `packages/emmy-eval/tests/cli-compare.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("pi-emmy-eval compare CLI", () => {
  it("compare with two synthesized run dirs produces markdown output", () => {
    const root = `/tmp/emmy-cli-compare-${Date.now()}`;
    mkdirSync(`${root}/a`, { recursive: true });
    mkdirSync(`${root}/b`, { recursive: true });
    const synth = (mean: number, std: number) => ({
      result: {
        suite_id: "test-suite", suite_complete: true,
        rows: [{ task_id: "t1", mean_exec: mean, std_exec: std, samples: [], insufficient_samples: false }],
        provenance_path: "", report_md_path: "", report_json_path: "",
        total_samples: 3, spok_failures: 0, declare_improvement_blocked_reason: null,
      },
      provenance: { profile: { id: "x", version: "1", hash: "y" } },
      suite: {},
    });
    writeFileSync(join(root, "a/report.json"), JSON.stringify(synth(0.5, 0.1)));
    writeFileSync(join(root, "b/report.json"), JSON.stringify(synth(0.8, 0.1)));
    const proc = spawnSync("bun", ["run", "packages/emmy-eval/bin/pi-emmy-eval.ts", "compare",
      "--baseline", `${root}/a`, "--candidate", `${root}/b`, "--out", `${root}/cmp.md`,
    ]);
    expect(proc.status).toBe(0);
    const md = readFileSync(`${root}/cmp.md`, "utf8");
    expect(md).toContain("test-suite");
    expect(md).toContain("different-favoring-b");
    rmSync(root, { recursive: true, force: true });
  });
});
```

Step 3 — Run full test suite:

```bash
cd /data/projects/emmy
bun test packages/emmy-eval
bun typecheck
```

**Verify:**

```
cd /data/projects/emmy && bun test packages/emmy-eval/tests/cli-compare.test.ts && bun run packages/emmy-eval/bin/pi-emmy-eval.ts --help | grep -E "compare|matrix|report"
```

**Done:**
- pi-emmy-eval compare/report/matrix subcommands all wired
- HELP string updated with new subcommands
- CLI integration test green
- Full test suite (Plan 05-01..06 cumulative) green; bun typecheck across 6 packages exits 0
- One commit per task

# Threat Model

## Trust Boundaries

| Boundary | Description |
|---|---|
| compare reads two run dirs | Both inputs are filesystem-resident JSON; tampering detectable via provenance hashes embedded in each |
| matrix walks runs-root recursively | Operator-controlled directory structure; aggregator skips dirs lacking report.json (no filesystem traversal beyond runs-root) |
| comparison output → REPRODUCER.md (Plan 05-07) | Output is markdown; consumed downstream by Plan 05-07's manifest — not load-bearing for inference |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-05-06-01 | T (Tampering) | one report.json edited post-hoc | mitigate | Comparison output cites both runs' provenance hashes; downstream consumer (Plan 05-07) re-hashes for REPRODUCER.md authentication |
| T-05-06-02 | R (Repudiation) | comparison verdict 'different-favoring-b' on a subset run | mitigate | comparable_warning is set + bubbles to markdown header when either run.suite_complete=false; reader sees the EVAL-08 caveat next to any verdict |
| T-05-06-03 | I (Information disclosure) | comparison includes raw mean values | accept | Means + stds are the artifact; intentional |
| T-05-06-04 | D (DoS) | matrix on a runs-root with 1000s of subdirs | accept | Operator-controlled filesystem; aggregator is O(profiles); Plan 05-04 + 05-03 produce ≤4 profile dirs each |
| T-05-06-05 | S (Spoofing) | matrix could include a Llama judge profile cell as if it were a generator | mitigate | aggregateMatrix takes a suite_id arg; judge profiles never produce report.json under runs/phase5-{tbench,swe-lite,...}/ — they only produce judge_score augmentations of generation runs (Plan 05-05); aggregator naturally excludes |

# Verification

End-of-plan checks:

1. `bun test packages/emmy-eval/tests/{ab-compare,aggregator,report-md,cli-compare}.test.ts` — all green (>= 11 tests)
2. `bun typecheck` exits 0
3. `bun run packages/emmy-eval/bin/pi-emmy-eval.ts --help` shows compare + report + matrix subcommands
4. CLI integration test produces a real markdown comparison file
5. All Plan 05-01..06 tests green; Phase 2/3/4 tests unchanged
6. compareSuiteRuns + aggregateMatrix + renderComparisonMarkdown + renderMatrixMarkdown all importable from `@emmy/eval`

# Success Criteria

- Plan 05-07 closeout can run `pi-emmy-eval compare` for any of the 6 cells in the 4-profile MATRIX (4 generator profiles × 2 suites = 6 logical comparisons; e.g. Qwen MoE vs Qwen dense on tbench, Qwen MoE vs Gemma MoE on tbench, etc.)
- Plan 05-07 reproducer includes the comparison markdown alongside individual reports
- POLISH-01 fully closed: `pi-emmy-eval compare --profile A --profile B` (re-spelled as `--baseline / --candidate` for clarity) produces side-by-side report

# Output

After completion, create `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-06-SUMMARY.md` per standard template. Cite:
- New test count delta
- 4 CLI subcommands wired
- POLISH-01 closure rationale
