---
phase: 05
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - eval/holdout/HOLDOUT_NOTES.md
  - eval/holdout/holdout_001.json
  - eval/holdout/holdout_002.json
  - eval/holdout/holdout_003.json
  - eval/holdout/holdout_004.json
  - eval/holdout/holdout_005.json
  - eval/holdout/rephrased/holdout_001_rephrased.json
  - eval/holdout/rephrased/holdout_002_rephrased.json
  - eval/holdout/rephrased/holdout_003_rephrased.json
  - eval/holdout/rephrased/holdout_004_rephrased.json
  - eval/holdout/rephrased/holdout_005_rephrased.json
  - eval/suites/holdout.yaml
  - eval/suites/livecodebench-rolling.yaml
  - eval/suites/rephrased.yaml
  - scripts/eval/fetch_lcb_dataset.py
  - scripts/eval/contamination_signal.ts
  - scripts/eval/contamination_signal.test.ts
  - .gitignore
autonomous: false
requirements: [EVAL-05, EVAL-01]
tags: [contamination-resistant, holdout, livecodebench, operator-authored, eval]

must_haves:
  truths:
    - "5 hand-written holdout coding tasks exist on disk under eval/holdout/holdout_00{1..5}.json with the documented schema (task_id, source: holdout-handwritten, exercises_edit, title, fixture_files, prompt, expected_rubric, contamination_resistance_rationale)"
    - "5 rephrased variants exist under eval/holdout/rephrased/ with original_id + rephrasing_seed fields linking back to the holdout originals (D-Q4 anti-rephrasing-loop discipline)"
    - "eval/holdout/HOLDOUT_NOTES.md documents authorship date, contamination-resistance reasoning per task (why operator believes each task is not in any pretraining set), and the rephrasing methodology"
    - "eval/suites/holdout.yaml + eval/suites/rephrased.yaml + eval/suites/livecodebench-rolling.yaml are valid YAML that future Plan 05-02 orchestrator consumes; each has a sha256 manifest_hash field that downstream provenance.json captures"
    - "scripts/eval/fetch_lcb_dataset.py runs against the LiveCodeBench HuggingFace dataset (PERMISSIVE air-gap lane only — pre-cached before STRICT eval batches), produces a local cache at eval/cache/livecodebench/release_v6.jsonl with one problem per line"
    - "scripts/eval/contamination_signal.ts implements the threshold check: pass@1 metric gap > 0.10 OR judge-normalized score gap > 1.0 → emit signal with the documented JSON shape"
    - "Bun unit test scripts/eval/contamination_signal.test.ts covers (a) below-threshold no-fire, (b) at-threshold fires, (c) above-threshold fires, (d) judge-metric path with theta_judge=1.0; all pass"
    - "eval/cache/ + eval/holdout/_solutions/ are gitignored (cache is regenerable; per-task reference solutions are operator-only and may contain spoilers if the same operator authors and grades)"
  artifacts:
    - path: "eval/holdout/HOLDOUT_NOTES.md"
      provides: "Operator-authored notes on holdout corpus authorship, contamination-resistance rationale, rephrasing methodology"
      contains: "## Contamination-resistance rationale"
    - path: "eval/holdout/holdout_001.json"
      provides: "First operator-authored holdout task (operator chooses problem; planner specifies schema + acceptance criteria)"
      contains: "\"source\": \"holdout-handwritten\""
    - path: "eval/holdout/rephrased/holdout_001_rephrased.json"
      provides: "Operator-authored rephrasing of holdout_001 with original_id linkback"
      contains: "\"original_id\": \"holdout_001\""
    - path: "eval/suites/holdout.yaml"
      provides: "Suite manifest for the 5-task holdout corpus; consumed by Plan 05-02 orchestrator"
      contains: "manifest_hash: sha256:"
    - path: "eval/suites/livecodebench-rolling.yaml"
      provides: "Suite manifest for LCB rolling slice (--start_date math + per-profile cutoff lookups)"
      contains: "release_version: release_v6"
    - path: "scripts/eval/contamination_signal.ts"
      provides: "Pure-function threshold check; returns {fired, tracks, metric, gap, threshold, tasks_flagged}"
      contains: "export function emitContaminationSignal"
    - path: "scripts/eval/contamination_signal.test.ts"
      provides: "Bun unit tests for contamination signal logic; runs without GPU"
      contains: "describe(\"contamination signal\""
    - path: "scripts/eval/fetch_lcb_dataset.py"
      provides: "PERMISSIVE-lane LCB dataset fetcher; pre-cache before STRICT eval batches"
      contains: "release_version=\"release_v6\""
  key_links:
    - from: "eval/holdout/holdout_001.json"
      to: "eval/holdout/rephrased/holdout_001_rephrased.json"
      via: "rephrased.original_id field"
      pattern: "\"original_id\": \"holdout_001\""
    - from: "eval/suites/holdout.yaml"
      to: "eval/holdout/holdout_*.json"
      via: "tasks: list pointer"
      pattern: "tasks:"
    - from: "scripts/eval/contamination_signal.ts"
      to: "eval/suites/livecodebench-rolling.yaml"
      via: "thresholds: {pass_at_1: 0.10, judge_normalized: 1.0}"
      pattern: "thresholds:"
    - from: "scripts/eval/fetch_lcb_dataset.py"
      to: "eval/cache/livecodebench/release_v6.jsonl"
      via: "huggingface_hub download under PERMISSIVE lane"
      pattern: "release_v6.jsonl"
---

<objective>
Stand up the contamination-resistant scaffolding Plan 05-02's eval driver consumes: 5 operator-authored hand-written coding tasks (the held-out corpus), 5 operator-authored rephrasings (the rephrased track), the LiveCodeBench rolling fetcher (cached locally before STRICT runs), and the contamination-signal threshold logic (pure-function; testable without GPU). This plan is **operator-attended** because EVAL-05 requires hand-written tasks the operator believes are not in any public training set — the planner cannot author them.

Purpose: Without holdout + rephrased + LCB-rolling, Phase 5's eval numbers are contamination-blind. The prior repo's Qwen3 tracked 8.5/10 on prompts that *were* in pretraining; Phase 5 cannot repeat that mistake. EVAL-05 is the architectural countermeasure.

**EVAL-01 coverage scope (revised post-checker Blocker 1):** This plan owns the **LiveCodeBench rolling track** of EVAL-01 — `eval/suites/livecodebench-rolling.yaml` is the third of EVAL-01's four suites alongside terminal-bench-2.0 (Plan 05-03), SWE-bench Lite (Plan 05-04), and prior-Phase-1 continuity (Plan 05-02). The LCB fetcher (`scripts/eval/fetch_lcb_dataset.py`) runs under PERMISSIVE pre-STRICT-batches, the suite YAML pins per-profile cutoff dates, and Plan 05-03's new Tier-A execution Task (post-checker Blocker 5) actually drives `pi-emmy-eval run --suite eval/suites/livecodebench-rolling.yaml --samples 3` against all 4 MATRIX profiles — completing the EVAL-01 closure for the LCB track.

Output:
- 5 holdout tasks + 5 rephrasings on disk in the documented schema
- 3 suite manifest YAMLs (holdout, rephrased, livecodebench-rolling) with sha256 manifest_hash for provenance
- LCB dataset fetcher (PERMISSIVE-lane Python; pre-runs before STRICT eval batches)
- Contamination-signal logic + Bun unit tests
- HOLDOUT_NOTES.md documenting authorship + rationale per task
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CONTEXT.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-RESEARCH.md
@eval/MATRIX.md
@CLAUDE.md
@/data/projects/setup_local_opencode/validation/eval_tasks.py
@/data/projects/setup_local_opencode/validation/PHASE1_RESULTS_QWEN3.json

<interfaces>
<!-- Schema authoring contracts. Plan 05-02's orchestrator will import these.
     The schemas are derived from eval/phase2/sc2/run_sc2.ts Fixture interface
     extended for contamination tracking. -->

Holdout task JSON shape (eval/holdout/holdout_NNN.json):
```json
{
  "task_id": "holdout_001",
  "source": "holdout-handwritten",
  "authored_by": "operator",
  "authored_at": "2026-04-25",
  "exercises_edit": true,
  "exercises_bash": false,
  "title": "<short title>",
  "fixture_files": { "<rel/path>": "<file content>" },
  "prompt": "<task description fed to pi-emmy as the user message>",
  "expected_rubric": "<2-5 sentence description of what 'correct' looks like; consumed by judge subsystem (Plan 05-05)>",
  "executable_check": {
    "kind": "bash",
    "command": "bun test || pytest -x || ...",
    "expected_exit_code": 0,
    "expected_stdout_contains": "<optional substring>"
  },
  "contamination_resistance_rationale": "<2-3 sentence operator note: why this task is unlikely to be in public training data — e.g. 'novel API combination not yet documented online', 'private repo refactor pattern', 'invented domain abstraction'>"
}
```

Rephrased variant shape (eval/holdout/rephrased/holdout_NNN_rephrased.json):
```json
{
  "task_id": "holdout_001_rephrased",
  "original_id": "holdout_001",
  "rephrasing_seed": "<short note: what was rewritten — e.g. 'changed problem framing from CSV to JSON; same algorithm'>",
  "rephrasing_authored_at": "2026-04-25",
  "source": "holdout-rephrased",
  "exercises_edit": true,
  "title": "<rephrased title>",
  "fixture_files": { ... },
  "prompt": "<rephrased prompt — same algorithm, different surface>",
  "expected_rubric": "<same correctness criteria; rephrased>",
  "executable_check": { ... }
}
```

Suite manifest YAML shape (eval/suites/holdout.yaml):
```yaml
suite_id: holdout
suite_version: "1"
manifest_hash: "sha256:<computed-on-write>"
description: "5 operator-authored hand-written tasks. Contamination-resistant via novel-domain authorship."
tasks:
  - eval/holdout/holdout_001.json
  - eval/holdout/holdout_002.json
  - eval/holdout/holdout_003.json
  - eval/holdout/holdout_004.json
  - eval/holdout/holdout_005.json
thresholds:
  contamination_signal:
    pass_at_1_gap: 0.10
    judge_normalized_gap: 1.0
defaults:
  samples: 3
  judge_required: true
```

Suite manifest YAML shape (eval/suites/livecodebench-rolling.yaml):
```yaml
suite_id: livecodebench-rolling
suite_version: "1"
manifest_hash: "sha256:<computed-on-write>"
release_version: release_v6
release_count: 1055
description: "Post-cutoff slice of LCB v6; cutoff = min(model_pretraining_cutoff, profile_first_release_date) + 1 day."
profile_cutoffs:
  qwen3.6-35b-a3b: "2026-04-17"      # Qwen 3.6 release 2026-04-16
  qwen3.6-27b: "2026-04-23"           # Qwen 3.6-27B-FP8 release 2026-04-22
  gemma-4-26b-a4b-it: "2026-04-03"    # Gemma 4 release 2026-04-02
  gemma-4-31b-it: "2026-04-03"        # Same family as 26B-A4B
local_cache_path: eval/cache/livecodebench/release_v6.jsonl
thresholds:
  contamination_signal:
    pass_at_1_gap: 0.10
defaults:
  samples: 3
  scenario: codegeneration
  judge_required: false
```

Contamination signal output JSON shape (scripts/eval/contamination_signal.ts return value):
```typescript
export interface ContaminationSignal {
  fired: boolean;
  tracks: Array<"holdout" | "rephrased" | "livecodebench-rolling">;
  metric: "pass_at_1" | "judge_normalized";
  pre_cutoff_or_public: number;
  post_cutoff_or_holdout: number;
  gap: number;
  threshold: number;
  tasks_flagged: string[];
}

export function emitContaminationSignal(args: {
  publicScores: Record<string, number>;       // task_id -> score on public/pre-cutoff slice
  resistantScores: Record<string, number>;    // task_id -> score on holdout/post-cutoff slice
  metric: "pass_at_1" | "judge_normalized";
  threshold: number;                          // 0.10 or 1.0 per metric
  trackName: "holdout" | "rephrased" | "livecodebench-rolling";
}): ContaminationSignal;
```
</interfaces>

<key_files>
- eval/phase2/sc2/run_sc2.ts:40-49 — existing Fixture interface that holdout schema extends
- /data/projects/setup_local_opencode/validation/eval_tasks.py — prior-repo task shape (we deliberately do NOT inherit; holdout is fresh-authored to be contamination-resistant)
- packages/emmy-tools/src/edit-hashline.ts — what holdout's exercises_edit fixtures should be solvable by
- bunfig.toml — Bun test config; Bun test will pick up *.test.ts under scripts/eval/
</key_files>
</context>

<tasks>

<task type="checkpoint:human-author" gate="blocking">
  <name>Task 1: Operator authors 5 hand-written holdout tasks + 5 rephrasings</name>
  <files>eval/holdout/holdout_00{1..5}.json, eval/holdout/rephrased/holdout_00{1..5}_rephrased.json, eval/holdout/HOLDOUT_NOTES.md</files>
  <what-built>
Claude has scaffolded:
- The directory tree (eval/holdout/, eval/holdout/rephrased/, eval/holdout/_solutions/)
- A template file at eval/holdout/_TEMPLATE.json with the documented schema
- A template at eval/holdout/rephrased/_TEMPLATE_REPHRASED.json
- HOLDOUT_NOTES.md with the rationale section pre-headed but blank-bodied
- An updated .gitignore covering eval/cache/ and eval/holdout/_solutions/
- Schema validator at scripts/eval/validate_holdout.ts (run via `bun run scripts/eval/validate_holdout.ts` to check operator-authored JSON conforms)

The OPERATOR authors:
1. Five holdout coding tasks (eval/holdout/holdout_001.json through holdout_005.json) following the schema in <interfaces>. Each task MUST include:
   - A short, well-defined coding problem solvable by pi-emmy's existing tools (read/write/edit/bash/grep/find/ls — NO new tools)
   - A fixture_files dict with starting state (can be empty if task creates everything)
   - An executable_check that pi-emmy's bash tool can run to verify success (e.g. `bun test`, `pytest -x`, a custom script)
   - An expected_rubric Plan 05-05's judge will use for qualitative scoring
   - A contamination_resistance_rationale: 2-3 sentences explaining why the operator believes this task is unlikely in any pretraining set (novel API combo, invented domain, private-repo style refactor, etc.)

2. Five rephrasings (eval/holdout/rephrased/holdout_001_rephrased.json through holdout_005_rephrased.json):
   - Each MUST set original_id to its source holdout
   - Each MUST set rephrasing_seed to a short note describing what was changed (problem framing, surface domain, variable names — NOT the algorithm)
   - The underlying algorithm/correctness criterion stays the same; only the surface description changes
   - This is the "rephrased variants" track for EVAL-05; manual authoring per RESEARCH.md §Q8 (rejecting auto-rephrasing to avoid generator-rephraser dependency)

3. HOLDOUT_NOTES.md body: write a paragraph per task documenting authorship rationale; cite the section schema; explicitly note "operator authored 2026-04-25, before any model in MATRIX.md was queried for the prompts" or similar.

Suggested task domains (operator picks 5 — these are SUGGESTIONS not requirements):
- A small Bun + TypeScript refactor in a 3-file fixture (exercises hash-anchored edit + tsc check)
- An invented data structure with operations (operator names it something not-in-public-domain like "Quasi-Stack")
- A debugging task: fixture has a bug; pi-emmy must locate + fix; test must pass
- A multi-file pattern alignment (e.g. "make these 4 functions follow the same naming convention")
- A bash + grep workflow task (exercises bash + grep tools)

The 5 tasks should span: at least 3 with exercises_edit=true, at least 1 with exercises_bash=true, at least 1 multi-file. Total fixture size budget: ~50 KB across all 5 tasks (keeps eval workdir staging cheap).

Resume signal: type "holdout green" once all 11 files are authored AND `bun run scripts/eval/validate_holdout.ts eval/holdout/` exits 0.
  </what-built>
  <how-to-verify>
1. Open eval/holdout/_TEMPLATE.json; copy to holdout_001.json; fill in fields; repeat for 002-005.
2. Open eval/holdout/rephrased/_TEMPLATE_REPHRASED.json; copy to holdout_001_rephrased.json; fill in fields; repeat for 002-005.
3. Write the rationale paragraphs into HOLDOUT_NOTES.md.
4. Run `bun run scripts/eval/validate_holdout.ts eval/holdout/` — expect exit 0 with "5 holdout + 5 rephrased valid".
5. Verify gitignore covers eval/cache/: `git check-ignore eval/cache/foo` exits 0.
6. Optionally run `git status` to confirm only the 11 author-owned JSON files + HOLDOUT_NOTES.md show up (templates already committed by Claude).
  </how-to-verify>
  <resume-signal>Type "holdout green" when all 11 files validate</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Suite manifest YAMLs + LCB rolling fetcher (PERMISSIVE-lane only)</name>
  <files>eval/suites/holdout.yaml, eval/suites/rephrased.yaml, eval/suites/livecodebench-rolling.yaml, scripts/eval/fetch_lcb_dataset.py, scripts/eval/manifest_hash.ts, scripts/eval/manifest_hash.test.ts</files>
  <behavior>
    - manifest_hash.ts: pure function, computes sha256 over the canonicalized YAML body (excluding the manifest_hash field itself) so the hash is stable + reproducible
    - Test 1: same input twice → same hash (determinism)
    - Test 2: changing one byte in the body → different hash (sensitivity)
    - Test 3: changing the manifest_hash field's value does NOT change the computed hash (self-exclusion)
    - fetch_lcb_dataset.py: refuses to run when EMMY_AIRGAP=strict (verifies env at startup; exits 5 with explicit "PERMISSIVE lane required: this script reaches huggingface.co" message); otherwise downloads release_v6 to eval/cache/livecodebench/release_v6.jsonl with one problem-record per line
  </behavior>
  <action>
**Step 1 — Author manifest_hash.ts at scripts/eval/manifest_hash.ts:**
```typescript
// scripts/eval/manifest_hash.ts
// Pure-function manifest hasher. Used by Plan 05-02 provenance.ts to embed
// suite_manifest_hash in every result row (EVAL-03).
//
// Algorithm: parse YAML, drop manifest_hash key, re-serialize canonically
// (sorted keys, no comments, LF line endings), sha256 the bytes.

import { parse, stringify } from "yaml";
import { createHash } from "node:crypto";

export function computeManifestHash(yamlBody: string): string {
  const parsed = parse(yamlBody) as Record<string, unknown>;
  const { manifest_hash: _drop, ...rest } = parsed;
  // Canonical form: sort keys; LF endings; default style.
  const canonical = stringify(rest, { sortMapEntries: true, lineWidth: 0 });
  return "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function rewriteManifestHashInPlace(yamlBody: string): { updated: string; hash: string } {
  const hash = computeManifestHash(yamlBody);
  const updated = yamlBody.replace(
    /^manifest_hash:.*$/m,
    `manifest_hash: "${hash}"`,
  );
  return { updated, hash };
}
```

**Step 2 — RED test at scripts/eval/manifest_hash.test.ts:**
Three tests asserting determinism, sensitivity, self-exclusion (per <behavior>). Use bun:test imports. Confirm `bun test scripts/eval/manifest_hash.test.ts` passes.

**Step 3 — Author eval/suites/holdout.yaml:** Use the YAML shape from <interfaces>. Fill `tasks:` with the 5 holdout JSON paths. Set `manifest_hash: "sha256:PLACEHOLDER"` initially. Then run `bun run scripts/eval/manifest_hash.ts eval/suites/holdout.yaml --rewrite` (small CLI you add to manifest_hash.ts main()); confirms file rewritten with real hash.

**Step 4 — Author eval/suites/rephrased.yaml:** Same shape; tasks point to the 5 rephrased JSONs. Hash via same flow.

**Step 5 — Author eval/suites/livecodebench-rolling.yaml:** Use the LCB shape from <interfaces>. profile_cutoffs match the 4 MATRIX profiles. Hash via same flow.

**Step 6 — Author scripts/eval/fetch_lcb_dataset.py:**
```python
#!/usr/bin/env python3
"""
Fetch LiveCodeBench release_v6 dataset to eval/cache/livecodebench/release_v6.jsonl.

PERMISSIVE air-gap lane only — refuses when EMMY_AIRGAP=strict.

Usage: uv run python scripts/eval/fetch_lcb_dataset.py
"""
import os, sys, json
from pathlib import Path

def main() -> int:
    airgap = os.environ.get("EMMY_AIRGAP", "permissive").lower()
    if airgap == "strict":
        print("ERROR: fetch_lcb_dataset.py requires PERMISSIVE air-gap lane "
              "(this script downloads from huggingface.co). "
              "Set EMMY_AIRGAP=permissive or run under ci_verify_research_egress lane.",
              file=sys.stderr)
        return 5

    out = Path("eval/cache/livecodebench/release_v6.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)

    from datasets import load_dataset  # type: ignore
    ds = load_dataset("livecodebench/code_generation_lite",
                      split="test", version_tag="release_v6")
    with out.open("w") as f:
        for row in ds:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    count = sum(1 for _ in out.open())
    print(f"LCB cached: {out} ({count} problems)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

**Step 7 — Verify holdout.yaml hash gets recomputed if any holdout JSON changes** by editing one task's title and re-running the hasher; assert the hash diff is non-zero.

**Step 8 — Add `eval/cache/` to .gitignore** (line addition only).

References:
- D-08 air-gap discipline from 05-CONTEXT.md
- RESEARCH.md §Q3 LCB cutoff math
- D-04 holdout authorship from 05-CONTEXT.md
  </action>
  <verify>
    <automated>bun test scripts/eval/manifest_hash.test.ts</automated>
  </verify>
  <done>
- 3 suite manifest YAMLs validate as YAML (`bun -e "import('yaml').then(m => m.parse(require('node:fs').readFileSync('eval/suites/holdout.yaml','utf8')))"` exits 0)
- Each manifest_hash field starts with `sha256:` (64 hex chars)
- `EMMY_AIRGAP=strict uv run python scripts/eval/fetch_lcb_dataset.py` exits 5 with the documented error message
- `bun test scripts/eval/manifest_hash.test.ts` passes (3/3 tests)
- .gitignore contains `eval/cache/` line
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Contamination-signal threshold logic + Bun unit tests</name>
  <files>scripts/eval/contamination_signal.ts, scripts/eval/contamination_signal.test.ts</files>
  <behavior>
    - Test 1: pass_at_1 metric, gap=0.05, threshold=0.10 → fired=false
    - Test 2: pass_at_1 metric, gap=0.10, threshold=0.10 → fired=false (strict greater-than)
    - Test 3: pass_at_1 metric, gap=0.14, threshold=0.10 → fired=true; tasks_flagged lists tasks where individual gap > threshold
    - Test 4: judge_normalized metric, gap=1.0, threshold=1.0 → fired=false
    - Test 5: judge_normalized metric, gap=1.5, threshold=1.0 → fired=true
    - Test 6: empty publicScores OR empty resistantScores → throws "insufficient data" (don't fire on empty)
    - Test 7: signal output JSON includes all required fields per <interfaces> ContaminationSignal shape
  </behavior>
  <action>
**Step 1 — RED tests at scripts/eval/contamination_signal.test.ts** (write all 7 tests first, expect them to fail).

**Step 2 — Author scripts/eval/contamination_signal.ts:**
```typescript
// scripts/eval/contamination_signal.ts
//
// Pure-function contamination signal.
// Compares scores on a public/pre-cutoff slice vs holdout/post-cutoff slice.
// If the gap exceeds threshold, emits signal flagging tasks where the per-task
// gap exceeds threshold (so reports can show WHICH tasks look contaminated).
//
// Thresholds per RESEARCH.md §Q8: pass_at_1 gap > 0.10 OR judge_normalized gap > 1.0.

export interface ContaminationSignal {
  fired: boolean;
  tracks: Array<"holdout" | "rephrased" | "livecodebench-rolling">;
  metric: "pass_at_1" | "judge_normalized";
  pre_cutoff_or_public: number;
  post_cutoff_or_holdout: number;
  gap: number;
  threshold: number;
  tasks_flagged: string[];
}

export function emitContaminationSignal(args: {
  publicScores: Record<string, number>;
  resistantScores: Record<string, number>;
  metric: "pass_at_1" | "judge_normalized";
  threshold: number;
  trackName: "holdout" | "rephrased" | "livecodebench-rolling";
}): ContaminationSignal {
  const pubKeys = Object.keys(args.publicScores);
  const resistantKeys = Object.keys(args.resistantScores);
  if (pubKeys.length === 0 || resistantKeys.length === 0) {
    throw new Error("contamination signal: insufficient data — both score maps must be non-empty");
  }

  const mean = (rec: Record<string, number>) =>
    Object.values(rec).reduce((a, b) => a + b, 0) / Object.values(rec).length;

  const pubMean = mean(args.publicScores);
  const resistantMean = mean(args.resistantScores);
  const gap = pubMean - resistantMean;     // positive = public did better → suspicious
  const fired = gap > args.threshold;       // strict > per Test 2

  // Per-task flag: task_id appears in BOTH maps AND publicScores[k] - resistantScores[k] > threshold.
  // (If the same task is in both, the per-task gap is comparable; otherwise we cannot pair.)
  const tasks_flagged = pubKeys
    .filter((k) => k in args.resistantScores)
    .filter((k) => args.publicScores[k]! - args.resistantScores[k]! > args.threshold);

  return {
    fired,
    tracks: fired ? [args.trackName] : [],
    metric: args.metric,
    pre_cutoff_or_public: round4(pubMean),
    post_cutoff_or_holdout: round4(resistantMean),
    gap: round4(gap),
    threshold: args.threshold,
    tasks_flagged,
  };
}

function round4(n: number): number { return Math.round(n * 10000) / 10000; }
```

**Step 3 — GREEN: re-run test; all 7 pass.**

**Step 4 — Self-document the function with a JSDoc reference back to RESEARCH.md §Q8 + 05-CONTEXT.md D-04** so future readers see the threshold provenance.

**Step 5 — Commit** as a single commit with message `feat(eval-contamination): pure-function contamination signal with thresholds 0.10 / 1.0 per RESEARCH §Q8`.
  </action>
  <verify>
    <automated>bun test scripts/eval/contamination_signal.test.ts</automated>
  </verify>
  <done>
- 7/7 tests pass
- Function is pure (no I/O, no globals, no Math.random)
- JSDoc cites RESEARCH.md §Q8 + 05-CONTEXT.md D-04 for threshold provenance
- Test file reads as a self-contained spec of the signal contract (Plan 05-02 provenance.ts will import this)
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator-authored holdout JSON → eval driver | Operator-authored content crosses into the eval pipeline. Schema validator enforces shape; nothing prevents operator from authoring a task that's actually in pretraining (rationale field is honor-system) |
| HuggingFace LCB dataset → local cache | External-data ingest; only runs under PERMISSIVE lane; cached locally; STRICT lane reads cache only |
| YAML manifest hash → provenance.json | Suite manifest hash flows into every result row's provenance; downstream consumers trust the hash to be deterministic |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-01-01 | T (Tampering) | eval/holdout/holdout_*.json | mitigate | Schema validator (scripts/eval/validate_holdout.ts) gates Task 1 resume signal; downstream provenance embeds the manifest_hash so any task-content edit invalidates the hash |
| T-05-01-02 | I (Information disclosure) | eval/holdout/_solutions/ | mitigate | Directory is gitignored; if operator places reference solutions there, they don't leak into git/the artifact bundle |
| T-05-01-03 | T | scripts/eval/contamination_signal.ts threshold values | accept | Thresholds (0.10 / 1.0) are starting-point values per RESEARCH §Q8; Phase 7 will tune with real data; current values err on the side of "more signals fire" which is conservative |
| T-05-01-04 | E (Elevation of privilege) | scripts/eval/fetch_lcb_dataset.py | mitigate | Refuses to run under STRICT (EMMY_AIRGAP=strict → exit 5); CI lane verifier in Plan 05-02 enforces this discipline at orchestrator startup |
| T-05-01-05 | R (Repudiation) | HOLDOUT_NOTES.md authorship dates | accept | Honor-system; mitigated by git commit timestamps (operator must commit holdout files before running them through the eval, so post-hoc adjustment is detectable in git log) |
| T-05-01-06 | S (Spoofing) | LCB dataset version pin (release_v6) | mitigate | Suite manifest pins release_version + release_count (1055); fetch script asserts the cache row count matches; mismatch → fail fast |

</threat_model>

<verification>
End-of-plan checks:
1. `bun test scripts/eval/manifest_hash.test.ts scripts/eval/contamination_signal.test.ts` → both pass green
2. `bun run scripts/eval/validate_holdout.ts eval/holdout/` exits 0 (after operator authoring)
3. `EMMY_AIRGAP=strict uv run python scripts/eval/fetch_lcb_dataset.py` exits 5 (lane discipline)
4. 5 holdout + 5 rephrased + 3 manifest YAMLs + HOLDOUT_NOTES.md present and committed
5. eval/cache/ in .gitignore (`grep -F 'eval/cache/' .gitignore`)
6. Each manifest YAML's manifest_hash field is `sha256:` followed by 64 hex chars
</verification>

<success_criteria>
- Plan 05-02 can import `emitContaminationSignal` from scripts/eval/contamination_signal.ts and call it with public/resistant score maps to gate the report's contamination-signal block (drives EVAL-05).
- Plan 05-02 can read the 3 suite YAMLs and resolve their tasks (drives EVAL-01 + EVAL-05).
- Plan 05-04 (terminal-bench, SWE-Lite) can rely on eval/cache/ being pre-populated by `fetch_lcb_dataset.py` having run under PERMISSIVE.
- The 5 holdout + 5 rephrased tasks are authored under EVAL-05 — operator-attested they're not in any public training set.
</success_criteria>

<output>
After completion, create `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-01-SUMMARY.md` per the standard summary template, citing:
- Resume signal "holdout green" + commit SHA(s) of the 11 author-owned files
- The 3 manifest_hash values
- Confirmation EMMY_AIRGAP=strict gate behaves
</output>
