---
phase: 05
plan: 04
type: execute
wave: 3
depends_on: ["05-02", "05-05"]
files_modified:
  - packages/emmy-eval/src/suites/swe-lite.ts
  - packages/emmy-eval/tests/swe-lite-adapter.test.ts
  - eval/suites/swe-lite.yaml
  - packages/emmy-eval/src/suites/extract_unified_diff.ts
  - packages/emmy-eval/src/suites/extract_unified_diff.test.ts
  - eval/swe-bench-agent/SKIP_LIST.yaml
  - eval/swe-bench-agent/README.md
  - eval/swe-bench-agent/prepull_aarch64_images.sh
  - emmy_serve/eval/swe_lite_grade.py
  - emmy_serve/eval/swe_lite_smoke.py
  - emmy_serve/pyproject.toml
  - scripts/run_phase5_swe_lite.sh
  - runs/phase5-swe-lite/qwen35-a3b-v3.1/.gitkeep
  - runs/phase5-swe-lite/qwen27b-v1.1/.gitkeep
  - runs/phase5-swe-lite/gemma26b-a4b-v2/.gitkeep
  - runs/phase5-swe-lite/gemma31b-v1.1/.gitkeep
autonomous: false
requirements: [EVAL-01]
tags: [eval, swe-bench-lite, predictions-json, aarch64, tier-b-moe, dense-smoke, operator-attended, gpu-long-run]

must_haves:
  truths:
    - "packages/emmy-eval/src/suites/swe-lite.ts implements predictions JSON producer per RESEARCH.md §Q2: for each SWE-Lite instance, drives @emmy/ux createEmmySession against the staged repo at instance.base_commit, runs the issue prompt via runPrint, extracts unified diff from final assistant text, appends {instance_id, model_name_or_path, model_patch} to predictions.json"
    - "EVAL-02 inheritance: swe-lite.ts uses createEmmySession + runPrint only — no direct postChat or vLLM /v1/chat/completions calls; uses-sdk static check passes after this plan"
    - "EVAL-08 inheritance: --filter / --instance-ids subset → suite_complete=false; orchestrator's promotion gate refuses positive verdict on subset runs"
    - "Tier B per D-01: --samples 3 only allowed against MoE profile ids (qwen3.6-35b-a3b, gemma-4-26b-a4b-it); dense profiles (qwen3.6-27b, gemma-4-31b-it) refuse --samples > 1 with explicit Tier-B-violation message + --samples 1 allowed for smoke"
    - "EVAL-01: SWE-bench Lite (300 instances per princeton-nlp/SWE-bench_Lite, NOT Verified-500 per D-02) — pinned in eval/suites/swe-lite.yaml; manifest_hash computed; aarch64 skip-list authoritative"
    - "emmy_serve/eval/swe_lite_grade.py wraps `python -m swebench.harness.run_evaluation --dataset_name princeton-nlp/SWE-bench_Lite --predictions_path ... --max_workers ... --run_id emmy-phase5-<iso>` per RESEARCH.md §Q2; runs in PERMISSIVE lane (Docker registry pulls); produces graded JSON"
    - "emmy_serve/eval/swe_lite_smoke.py: 30-instance subset smoke gate before full 300-instance run — if >20% fail to grade due to aarch64 incompat, escalate per RESEARCH.md Risk 3 (potential Phase 7 move) rather than silently skip"
    - "eval/swe-bench-agent/prepull_aarch64_images.sh pre-pulls Docker images for SWE-Lite instances under PERMISSIVE lane before any STRICT-lane batch starts; refuses under STRICT"
    - "extract_unified_diff.ts: pure function with 5+ unit tests covering (a) clean diff in fenced code block, (b) diff inline, (c) multi-file diff, (d) malformed → returns null, (e) empty assistant message → returns null"
    - "Phase 5 SC-1 evidence extends across SWE-Lite: at least one MoE profile produces predictions.json + graded.json with full provenance"
  artifacts:
    - path: "packages/emmy-eval/src/suites/swe-lite.ts"
      provides: "@emmy/eval orchestrator adapter for SWE-bench Lite; produces predictions.json then invokes the swebench grader via PERMISSIVE-lane subprocess"
      contains: "createEmmySession"
      min_lines: 100
    - path: "eval/suites/swe-lite.yaml"
      provides: "Suite manifest pinning dataset (princeton-nlp/SWE-bench_Lite), instance count (300), expected wall-clock per profile, Tier-B coverage policy, aarch64 skip-list reference"
      contains: "dataset_name: princeton-nlp/SWE-bench_Lite"
    - path: "packages/emmy-eval/src/suites/extract_unified_diff.ts"
      provides: "Pure function extracting unified diff from pi-emmy's final assistant text"
      contains: "export function extractUnifiedDiff"
    - path: "eval/swe-bench-agent/SKIP_LIST.yaml"
      provides: "aarch64-incompatible SWE-Lite instances (smoke-discovered) with reasons; consumed by swe-lite.ts and swe_lite_grade.py"
      contains: "instances_skipped:"
    - path: "emmy_serve/eval/swe_lite_grade.py"
      provides: "PERMISSIVE-lane wrapper around swebench.harness.run_evaluation; refuses under STRICT"
      contains: "swebench.harness.run_evaluation"
    - path: "runs/phase5-swe-lite/<profile-slug>/<iso>/predictions.json"
      provides: "Per-profile generation phase output: 300 instance×model_patch pairs"
      contains: "model_name_or_path"
    - path: "runs/phase5-swe-lite/<profile-slug>/<iso>/graded.json"
      provides: "Per-profile grading phase output (PERMISSIVE lane); resolved/unresolved per instance"
      contains: "instance_id"
  key_links:
    - from: "packages/emmy-eval/src/suites/swe-lite.ts"
      to: "packages/emmy-ux/src/session.ts (createEmmySession)"
      via: "import from @emmy/ux"
      pattern: "createEmmySession"
    - from: "packages/emmy-eval/src/suites/swe-lite.ts"
      to: "emmy_serve/eval/swe_lite_grade.py"
      via: "subprocess invocation under PERMISSIVE lane"
      pattern: "swe_lite_grade"
    - from: "eval/swe-bench-agent/SKIP_LIST.yaml"
      to: "packages/emmy-eval/src/suites/swe-lite.ts"
      via: "loaded at suite start; instances_skipped excluded from rows"
      pattern: "instances_skipped"
    - from: "emmy_serve/eval/swe_lite_grade.py"
      to: "scripts/eval/airgap-lane.ts (CLI sibling)"
      via: "EMMY_AIRGAP=permissive required to start"
      pattern: "EMMY_AIRGAP"
---

# Objective

Wire SWE-bench Lite (300 instances per `princeton-nlp/SWE-bench_Lite`, **NOT** Verified-500 per D-02) into the eval driver as the **milestone scoreboard**. Author the predictions JSON producer (`packages/emmy-eval/src/suites/swe-lite.ts`) that drives @emmy/ux's createEmmySession over each instance's repo+issue and emits the swebench-shaped `predictions.json`. Author the grading wrapper (`emmy_serve/eval/swe_lite_grade.py`) that runs swebench's official `run_evaluation` harness under PERMISSIVE lane (Docker registry pulls). Author the aarch64 skip-list curation flow + a 30-instance smoke gate (Risk 3 mitigation per RESEARCH.md). Tier B coverage per D-01: 2 MoE × N=3 ≈ 90h GPU + 2 dense × N=1 ≈ 70h GPU = ~160h total operator-attended wall-clock window (split across multiple weekend slots; per-profile checkpointing).

Purpose: SWE-bench is the field's milestone scoreboard for "real-world coding agent" — accepting Lite (300) over Verified (500) per RESEARCH.md §Q2 + D-02 because aarch64 image coverage on Spark is ~80% best-effort and Verified-on-x86 reproducer is Phase 7 territory. Without SWE-Lite numbers, Phase 5 ships terminal-bench but no public-benchmark scoreboard alignment.

Output:
- `packages/emmy-eval/src/suites/swe-lite.ts` adapter (predictions producer)
- `packages/emmy-eval/src/suites/extract_unified_diff.ts` + tests (pure function isolating the patch-extraction edge cases) [W3: in-package; no cross-workspace imports]
- `emmy_serve/eval/swe_lite_grade.py` (PERMISSIVE-lane grading wrapper)
- `emmy_serve/eval/swe_lite_smoke.py` (30-instance Risk-3 gate)
- `eval/suites/swe-lite.yaml` suite manifest with aarch64 skip-list reference
- `eval/swe-bench-agent/prepull_aarch64_images.sh` PERMISSIVE-lane image pre-fetch
- 4 result directories under `runs/phase5-swe-lite/<profile-slug>/<iso>/{predictions.json, graded.json, report.json, report.md, provenance.json}`

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

SWE-bench Lite predictions JSON shape (per RESEARCH.md §Q2 + https://github.com/SWE-bench/SWE-bench README):

```json
[
  {
    "instance_id": "django__django-11099",
    "model_name_or_path": "emmy-qwen3.6-35b-a3b@v3.1",
    "model_patch": "diff --git a/path/to/file.py b/path/to/file.py\n--- a/path/to/file.py\n+++ b/path/to/file.py\n@@ -10,3 +10,5 @@\n ..."
  }
]
```

SWE-bench Lite grader command (RESEARCH.md §Q2):

```bash
EMMY_AIRGAP=permissive uv run python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path runs/phase5-swe-lite/<slug>/<iso>/predictions.json \
  --max_workers $(python -c "import os; print(min(int(0.75 * os.cpu_count()), 16))") \
  --run_id emmy-phase5-<iso> \
  --cache_level env
# → produces logs/run_evaluation/emmy-phase5-<iso>/<model>/<instance_id>/{report.json, run_instance.log, ...}
```

Grader output JSON shape:

```json
{
  "django__django-11099": {
    "instance_id": "django__django-11099",
    "resolved": true,
    "tests_status": { "FAIL_TO_PASS": { "success": [...], "failure": [...] }, ... },
    "test_log": "..."
  }
}
```

@emmy/eval suite adapter signature:

```typescript
export interface SweLiteRunArgs {
  profilePath: string;
  samples: number;
  outDir: string;
  baseUrl?: string;
  instanceIds?: string[];      // when present, suite_complete=false (EVAL-08)
  maxInstances?: number;       // when present, suite_complete=false
  judge?: "self-hosted-llama" | "cloud-claude" | "none";
  skipGrading?: boolean;       // dev mode: skip the PERMISSIVE-lane grader call
}
export async function runSweLite(args: SweLiteRunArgs): Promise<unknown>;
```

extractUnifiedDiff signature:

```typescript
/**
 * Extract a unified diff from pi-emmy's final assistant text.
 * Handles: fenced ```diff blocks; bare diffs preceded by blank line;
 * multi-file diffs; malformed input → returns null.
 *
 * Returns the canonicalized diff (trailing newline added if missing) or null.
 */
export function extractUnifiedDiff(assistantText: string): string | null;
```

Wall-clock budget per RESEARCH.md §Q12 (Spark, aarch64):
- Generation: ~3 min/instance × 300 instances × N=3 = ~45h MoE; ~225h dense (infeasible — D-01 forces N=1 dense smoke = ~25h)
- Grading: ~62-110 min full-set on aarch64 (CPU-bound; PERMISSIVE lane; runs sequentially after generation)

## Key Files

- `packages/emmy-eval/src/orchestrator.ts` — Plan 05-02's runSuite (this plan adds suite adapter)
- `packages/emmy-ux/src/session.ts:createEmmySession` — SDK session factory; swe-lite.ts uses it for each instance
- `eval/suites/holdout.yaml` — Plan 05-01 reference shape for suite YAMLs
- `emmy_serve/airgap/` — Phase 3.1 air-gap probe primitives (this plan extends with EMMY_AIRGAP gate logic in Python)

# Tasks

## Task 1 (auto, tdd=true): Predictions producer + diff extractor + grading wrapper + smoke gate

**Files:** `packages/emmy-eval/src/suites/swe-lite.ts`, `packages/emmy-eval/tests/swe-lite-adapter.test.ts`, `packages/emmy-eval/src/suites/extract_unified_diff.ts`, `packages/emmy-eval/src/suites/extract_unified_diff.test.ts`, `eval/swe-bench-agent/SKIP_LIST.yaml`, `eval/swe-bench-agent/README.md`, `eval/swe-bench-agent/prepull_aarch64_images.sh`, `eval/suites/swe-lite.yaml`, `emmy_serve/eval/swe_lite_grade.py`, `emmy_serve/eval/swe_lite_smoke.py`, `emmy_serve/pyproject.toml`, `scripts/run_phase5_swe_lite.sh`

**Behavior:**
- `packages/emmy-eval/src/suites/extract_unified_diff.test.ts` covers 5 scenarios: fenced diff block, bare diff, multi-file, malformed, empty
- `swe-lite-adapter.test.ts` (dry-run): mock createEmmySession to return canned tool-call output that emits a unified diff in the final assistant text; assert predictions.json shape
- `swe_lite_grade.py` refuses to run when EMMY_AIRGAP=strict (exit 5)
- `prepull_aarch64_images.sh` refuses to run when EMMY_AIRGAP=strict (exit 5)

**Action:**

Step 1 — Author `packages/emmy-eval/src/suites/extract_unified_diff.test.ts` (RED) — per W3 the diff extractor lives inside the eval workspace package to avoid `../../../eval/...` cross-workspace imports:

```typescript
import { describe, expect, it } from "bun:test";
import { extractUnifiedDiff } from "./extract_unified_diff";

describe("extractUnifiedDiff", () => {
  it("extracts diff from fenced ```diff block", () => {
    const text = "Here's the patch:\n\n```diff\ndiff --git a/foo.py b/foo.py\n--- a/foo.py\n+++ b/foo.py\n@@ -1,3 +1,4 @@\n line1\n+added\n line2\n line3\n```\n\nThat should fix it.";
    const out = extractUnifiedDiff(text);
    expect(out).toContain("--- a/foo.py");
    expect(out).toContain("+added");
    expect(out!.endsWith("\n")).toBe(true);
  });

  it("extracts bare diff preceded by blank line", () => {
    const text = "I'll patch this:\n\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n a\n+b\n";
    const out = extractUnifiedDiff(text);
    expect(out).toContain("--- a/x");
  });

  it("extracts multi-file diff", () => {
    const text = "```diff\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-x\n+y\n```";
    const out = extractUnifiedDiff(text);
    expect(out).toContain("--- a/a");
    expect(out).toContain("--- a/b");
  });

  it("returns null on malformed (no diff markers)", () => {
    const text = "I changed foo to bar in line 10.";
    const out = extractUnifiedDiff(text);
    expect(out).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(extractUnifiedDiff("")).toBeNull();
    expect(extractUnifiedDiff("   ")).toBeNull();
  });

  it("strips fenced markers but preserves diff content", () => {
    const text = "```diff\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n```";
    const out = extractUnifiedDiff(text);
    expect(out).not.toContain("```");
    expect(out).toContain("diff --git");
  });
});
```

Step 2 — Author `packages/emmy-eval/src/suites/extract_unified_diff.ts`:

```typescript
/**
 * Extract a unified diff from pi-emmy's final assistant text.
 *
 * Strategy:
 *  1. If a ```diff ... ``` fence exists, extract its inner content.
 *  2. Else if a `diff --git` line exists, take from there to end-of-text.
 *  3. Else null.
 *
 * Sanity check: result must contain at least one `diff --git` line OR `--- ` + `+++ ` pair.
 * Trailing newline is added if missing.
 */
export function extractUnifiedDiff(assistantText: string): string | null {
  const text = assistantText?.trim() ?? "";
  if (text === "") return null;

  // 1. Fenced ```diff ... ``` block
  const fencedMatch = text.match(/```(?:diff|patch)?\s*\n([\s\S]*?)\n```/m);
  if (fencedMatch) {
    const inner = fencedMatch[1]!;
    if (looksLikeDiff(inner)) return ensureTrailingNewline(inner);
  }

  // 2. Bare diff (must contain `diff --git` or unified header markers)
  const bareDiffStart = text.indexOf("diff --git ");
  if (bareDiffStart >= 0) {
    const slice = text.slice(bareDiffStart);
    if (looksLikeDiff(slice)) return ensureTrailingNewline(slice);
  }

  return null;
}

function looksLikeDiff(s: string): boolean {
  const hasGitHeader = /^diff --git /m.test(s);
  const hasUnifiedHeader = /^--- /m.test(s) && /^\+\+\+ /m.test(s);
  return hasGitHeader || hasUnifiedHeader;
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}
```

Step 3 — Run tests, expect 6/6 GREEN.

Step 4 — Author `eval/swe-bench-agent/SKIP_LIST.yaml` initially empty:

```yaml
# eval/swe-bench-agent/SKIP_LIST.yaml
# SWE-bench Lite instances that fail to grade on aarch64 DGX Spark.
# Smoke-discovered (Plan 05-04 Task 2 30-instance smoke); curated by operator.
# Each entry: {instance_id, reason: "x86-only-image" | "qemu-instability" | "other", discovered_in: <smoke-iso>}
instances_skipped: []
```

Step 5 — Author `eval/suites/swe-lite.yaml`:

```yaml
suite_id: swe-bench-lite
suite_version: "1"
manifest_hash: "sha256:PLACEHOLDER"
description: "SWE-bench Lite — 300 instances. Verified-500 deferred to Phase 7 per D-02 (aarch64 image coverage + outside-reproducer scope)."
dataset_name: princeton-nlp/SWE-bench_Lite
expected_instance_count: 300
skip_list_path: eval/swe-bench-agent/SKIP_LIST.yaml
swebench_package_version: "TBD-AT-FIRST-RUN"   # filled by prepull script
tier_coverage:
  moe_profiles: ["qwen3.6-35b-a3b@v3.1", "gemma-4-26b-a4b-it@v2"]
  moe_samples: 3
  dense_profiles: ["qwen3.6-27b@v1.1", "gemma-4-31b-it@v1.1"]
  dense_samples: 1
expected_walltime_per_profile:
  moe_n3_generation: "45h"
  moe_grading: "1.5h"
  dense_n1_generation: "25h"
  dense_grading: "1h"
defaults:
  samples: 3
  judge_required: false       # SWE-Lite is executable correctness only; judge not required
```

Run `bun run scripts/eval/manifest_hash.ts eval/suites/swe-lite.yaml --rewrite` to fill the hash.

Step 6 — Author `eval/swe-bench-agent/prepull_aarch64_images.sh`:

```bash
#!/usr/bin/env bash
# prepull_aarch64_images.sh — pre-pull SWE-bench Lite Docker images.
# PERMISSIVE air-gap lane only (DockerHub pulls).

set -euo pipefail

if [ "${EMMY_AIRGAP:-strict}" = "strict" ]; then
    echo "ERROR: prepull_aarch64_images.sh requires EMMY_AIRGAP=permissive" >&2
    exit 5
fi

echo "Listing SWE-bench Lite required base images..."
# Use the swebench package's util to enumerate (it knows the registry layout).
EMMY_AIRGAP=permissive uv run python -c "
from swebench.harness.utils import get_dataset_from_preds
import json
ds = get_dataset_from_preds('princeton-nlp/SWE-bench_Lite', None, None)
seen = set()
for inst in ds:
    img = f\"swebench/sweb.eval.x86_64.{inst['repo'].replace('/', '_').lower()}_{inst['version']}\"
    if img not in seen:
        seen.add(img)
        print(img)
" | tee /tmp/swelite_images.txt

# For each, attempt to pull aarch64 variant; fall back to x86_64 with platform flag.
while IFS= read -r img; do
    if docker pull --platform linux/arm64 "$img" 2>/dev/null; then
        echo "OK aarch64: $img"
    elif docker pull "$img"; then
        echo "FALLBACK x86_64 (will use QEMU): $img"
    else
        echo "FAIL: $img — add to SKIP_LIST.yaml" >&2
    fi
done < /tmp/swelite_images.txt
```

Step 7 — Author `emmy_serve/eval/swe_lite_grade.py`:

```python
"""SWE-bench Lite grading wrapper.

PERMISSIVE air-gap lane only — invokes swebench.harness.run_evaluation which
pulls Docker images and writes graded JSON.

Usage:
  EMMY_AIRGAP=permissive uv run python -m emmy_serve.eval.swe_lite_grade \
      --predictions runs/phase5-swe-lite/qwen35-a3b-v3.1/<iso>/predictions.json \
      --out runs/phase5-swe-lite/qwen35-a3b-v3.1/<iso>/graded.json
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys
from pathlib import Path

def main() -> int:
    if os.environ.get("EMMY_AIRGAP", "strict").lower() != "permissive":
        print("ERROR: swe_lite_grade requires EMMY_AIRGAP=permissive (Docker registry pulls)", file=sys.stderr)
        return 5

    ap = argparse.ArgumentParser()
    ap.add_argument("--predictions", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-workers", type=int, default=None)
    args = ap.parse_args()

    if args.max_workers is None:
        cpu = os.cpu_count() or 8
        args.max_workers = min(int(0.75 * cpu), 16)

    run_id = Path(args.predictions).parent.name + "-grade"
    proc = subprocess.run([
        "uv", "run", "python", "-m", "swebench.harness.run_evaluation",
        "--dataset_name", "princeton-nlp/SWE-bench_Lite",
        "--predictions_path", args.predictions,
        "--max_workers", str(args.max_workers),
        "--run_id", run_id,
        "--cache_level", "env",
    ], check=False)
    if proc.returncode != 0:
        print(f"swebench harness exited {proc.returncode}", file=sys.stderr)
        return proc.returncode

    # swebench writes per-instance reports under logs/run_evaluation/<run_id>/...
    # Aggregate into our flat graded.json.
    log_dir = Path("logs/run_evaluation") / run_id
    aggregated = {}
    for inst_dir in log_dir.glob("*/*"):
        report = inst_dir / "report.json"
        if not report.exists(): continue
        data = json.loads(report.read_text())
        for inst_id, inst_data in data.items():
            aggregated[inst_id] = inst_data
    Path(args.out).write_text(json.dumps(aggregated, indent=2))
    print(f"graded {len(aggregated)} instances → {args.out}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

Step 8 — Author `emmy_serve/eval/swe_lite_smoke.py`:

```python
"""SWE-Lite 30-instance smoke gate (Risk 3 mitigation).

Runs generation+grading on a fixed 30-instance subset. If grading fails on
>20% (i.e. >6 instances) due to aarch64 image incompatibility, escalate per
RESEARCH.md Risk 3 — possibly defer SWE-Lite to Phase 7 instead of growing
SKIP_LIST.yaml beyond plausible coverage.
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys
from pathlib import Path

# 30-instance smoke subset — diverse repos, mix of difficulty.
# Authoritative list captured at first run + appended to eval/suites/swe-lite.yaml manifest.
SMOKE_INSTANCES = [
    # Filled in at first execution; placeholder structure — Plan 05-04 Task 2 captures.
]

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    Path(args.out).mkdir(parents=True, exist_ok=True)
    # 1. Generate predictions for SMOKE_INSTANCES via emmy-eval
    gen = subprocess.run([
        "bun", "run", "packages/emmy-eval/bin/pi-emmy-eval.ts", "run",
        "--profile", f"profiles/{args.profile.replace('@','/')}",
        "--suite", "eval/suites/swe-lite.yaml",
        "--samples", "1",
        "--out", args.out,
        "--filter", "|".join(SMOKE_INSTANCES) or "demo",
    ])
    if gen.returncode != 0:
        return 1

    # 2. Grade (PERMISSIVE)
    os.environ["EMMY_AIRGAP"] = "permissive"
    grade = subprocess.run([
        "uv", "run", "python", "-m", "emmy_serve.eval.swe_lite_grade",
        "--predictions", str(Path(args.out) / "predictions.json"),
        "--out", str(Path(args.out) / "graded.json"),
    ])
    if grade.returncode != 0:
        return 2

    graded = json.loads(Path(args.out, "graded.json").read_text())
    aarch64_failures = [k for k, v in graded.items() if "aarch64" in str(v).lower() or "platform" in str(v).lower()]
    threshold = max(1, len(SMOKE_INSTANCES) // 5)   # 20%
    if len(aarch64_failures) > threshold:
        print(f"smoke FAIL: {len(aarch64_failures)}/{len(SMOKE_INSTANCES)} aarch64 failures > {threshold} threshold; escalate per RESEARCH.md Risk 3", file=sys.stderr)
        return 3
    print(f"smoke OK: {len(graded)} graded, {len(aarch64_failures)} aarch64 failures (within threshold)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

Step 9 — Author `packages/emmy-eval/src/suites/swe-lite.ts`:

```typescript
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEmmySession, loadProfile } from "@emmy/ux";
import { captureProvenance } from "../provenance";
import { runSpOkGate } from "../sp-ok-gate";
import { computeStats, InsufficientSamplesError } from "../stats/mean-std";
import { writeReport } from "../report/json";
import { renderMarkdownReport } from "../report/markdown";
import { extractUnifiedDiff } from "./extract_unified_diff";

const DENSE_IDS = new Set(["qwen3.6-27b", "gemma-4-31b-it"]);

export interface SweLiteRunArgs {
  profilePath: string;
  samples: number;
  outDir: string;
  baseUrl?: string;
  instanceIds?: string[];
  maxInstances?: number;
  judge?: "self-hosted-llama" | "cloud-claude" | "none";
  skipGrading?: boolean;
}

export async function runSweLite(args: SweLiteRunArgs): Promise<unknown> {
  const profile = await loadProfile(args.profilePath);
  const baseUrl = args.baseUrl ?? "http://127.0.0.1:8002";

  // Tier-B coverage policy (D-01)
  if (DENSE_IDS.has(profile.ref.id) && args.samples > 1) {
    process.stderr.write(
      `[tier-b-warning] dense profile '${profile.ref.id}' with samples=${args.samples}: ` +
      `per D-01 dense profiles are smoke-only (N=1).\n`,
    );
  }

  // SP_OK pre-flight
  await runSpOkGate({ baseUrl, servedModelName: profile.serving.engine.served_model_name });

  // Load suite manifest + skip list
  const suiteYaml = readFileSync("eval/suites/swe-lite.yaml", "utf8");
  const yamlMod = await import("yaml");
  const suite = yamlMod.parse(suiteYaml) as { suite_id: string; manifest_hash: string; expected_instance_count: number; skip_list_path: string };
  const skipList = yamlMod.parse(readFileSync(suite.skip_list_path, "utf8")) as { instances_skipped: Array<{ instance_id: string }> };
  const skipIds = new Set(skipList.instances_skipped.map((s) => s.instance_id));

  // Provenance capture
  mkdirSync(args.outDir, { recursive: true });
  const provenance = await captureProvenance({
    profile, suite: suite.suite_id, suiteManifestHash: suite.manifest_hash, samples: args.samples,
  });
  writeFileSync(join(args.outDir, "provenance.json"), JSON.stringify(provenance, null, 2));

  // Load SWE-bench Lite dataset (already cached by prepull_aarch64_images.sh; if not cached, fail loud)
  const datasetCache = "eval/cache/swe-bench-lite/instances.json";
  if (!existsSync(datasetCache)) {
    throw new Error(
      `SWE-bench Lite dataset cache missing at ${datasetCache}. ` +
      `Run: EMMY_AIRGAP=permissive uv run python -m emmy_serve.eval.swe_lite_grade --download-dataset-only`,
    );
  }
  const allInstances = JSON.parse(readFileSync(datasetCache, "utf8")) as Array<{ instance_id: string; repo: string; base_commit: string; problem_statement: string; version: string }>;

  // Filter
  let activeInstances = allInstances.filter((i) => !skipIds.has(i.instance_id));
  let suiteComplete = true;
  if (args.instanceIds) { activeInstances = activeInstances.filter((i) => args.instanceIds!.includes(i.instance_id)); suiteComplete = false; }
  if (args.maxInstances && activeInstances.length > args.maxInstances) { activeInstances = activeInstances.slice(0, args.maxInstances); suiteComplete = false; }

  // The N×instances loop
  const predictions: Array<{ instance_id: string; model_name_or_path: string; model_patch: string }> = [];
  const allRows: Record<string, Array<{ exec_score: 0 | 1 | null; sample_index: number; failure_mode: string | null }>> = {};

  let sampleCounter = 0;
  for (const instance of activeInstances) {
    const samples: Array<{ exec_score: 0 | 1 | null; sample_index: number; failure_mode: string | null }> = [];
    for (let s = 0; s < args.samples; s++) {
      sampleCounter++;
      if (sampleCounter > 0 && sampleCounter % 50 === 0) {
        await runSpOkGate({ baseUrl, servedModelName: profile.serving.engine.served_model_name });
      }

      // Stage repo at base_commit
      const workdir = await stageRepo(instance.repo, instance.base_commit);
      const session = await createEmmySession({
        profile, baseUrl, cwd: workdir, mode: "print",
        sessionId: `swe-lite-${instance.instance_id}-s${s}`,
        userPrompt: `Repository: ${instance.repo}\nIssue: ${instance.problem_statement}\n\nProduce a unified diff (git diff format) that resolves this issue. Apply the diff using the edit tool, then output the final diff in a fenced \`\`\`diff block as the last line of your response.`,
      });
      const { text } = await session.runPrint!(/* prompt already set above */ "", { mode: "json" });
      const patch = extractUnifiedDiff(text) ?? "";
      if (patch === "") {
        samples.push({ exec_score: 0, sample_index: s, failure_mode: "no-diff-extracted" });
      } else {
        predictions.push({
          instance_id: instance.instance_id,
          model_name_or_path: `emmy-${profile.ref.id}@${profile.ref.version}-sample-${s}`,
          model_patch: patch,
        });
        // exec_score is set during grading phase; placeholder null here
        samples.push({ exec_score: null, sample_index: s, failure_mode: null });
      }
    }
    allRows[instance.instance_id] = samples;
  }

  // Write predictions.json
  const predictionsPath = join(args.outDir, "predictions.json");
  writeFileSync(predictionsPath, JSON.stringify(predictions, null, 2));

  // Grading phase (PERMISSIVE lane required)
  if (!args.skipGrading) {
    const gradedPath = join(args.outDir, "graded.json");
    const grade = spawnSync("uv", [
      "run", "python", "-m", "emmy_serve.eval.swe_lite_grade",
      "--predictions", predictionsPath,
      "--out", gradedPath,
    ], { env: { ...process.env, EMMY_AIRGAP: "permissive" }, stdio: "inherit" });
    if (grade.status !== 0) throw new Error(`swe_lite_grade exited ${grade.status}`);

    // Re-merge graded results into samples
    const graded = JSON.parse(readFileSync(gradedPath, "utf8")) as Record<string, { resolved: boolean }>;
    for (const [instId, samples] of Object.entries(allRows)) {
      for (const s of samples) {
        // Match by predictions[*].model_name_or_path suffix `-sample-${s.sample_index}`
        const predFor = predictions.find((p) => p.instance_id === instId && p.model_name_or_path.endsWith(`-sample-${s.sample_index}`));
        if (!predFor) continue;
        const g = graded[instId];
        s.exec_score = g?.resolved ? 1 : 0;
      }
    }
  }

  // Aggregate per instance
  const rows = Object.entries(allRows).map(([instance_id, samples]) => {
    try {
      const stats = computeStats(samples.map((s) => ({
        sample_index: s.sample_index, sp_ok_canary: true, exec_score: s.exec_score,
        transcript_jsonl_path: "", duration_ms: 0,
      } as any)));
      return { task_id: instance_id, samples, mean_exec: stats.mean, std_exec: stats.std, insufficient_samples: false };
    } catch (e) {
      if (e instanceof InsufficientSamplesError) {
        return { task_id: instance_id, samples, mean_exec: NaN, std_exec: NaN, insufficient_samples: true };
      }
      throw e;
    }
  });

  const result = {
    // Blocker 4: populate suite_complete_reason — disambiguates D-01 dense smoke from EVAL-08 subset
    suite_id: suite.suite_id,
    suite_complete: suiteComplete,
    suite_complete_reason: (
      args.instanceIds ? "filter" :
      args.maxInstances ? "max-tasks" :
      args.samples < 3 ? "smoke-N1" :
      "complete"
    ) as const,
    rows,
    provenance_path: join(args.outDir, "provenance.json"),
    report_md_path: join(args.outDir, "report.md"),
    report_json_path: join(args.outDir, "report.json"),
    total_samples: args.samples * Object.keys(allRows).length,
    spok_failures: 0,
    declare_improvement_blocked_reason: null,
    skipped_instances: Array.from(skipIds),
  };
  writeReport(result.report_json_path, { result, provenance, suite });
  writeFileSync(result.report_md_path, renderMarkdownReport({ result, provenance, suite }));
  return result;
}

async function stageRepo(repo: string, baseCommit: string): Promise<string> {
  const cacheDir = `/tmp/emmy-swe-lite/${repo.replace("/", "_")}-${baseCommit.slice(0, 8)}`;
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
    execSync(`git clone --depth 1 https://github.com/${repo}.git ${cacheDir}`, { stdio: "inherit" });
    execSync(`git -C ${cacheDir} fetch --depth 50 origin ${baseCommit}`, { stdio: "inherit" });
    execSync(`git -C ${cacheDir} checkout ${baseCommit}`, { stdio: "inherit" });
  }
  return cacheDir;
}
```

NOTE: `stageRepo` does network during PERMISSIVE setup; under STRICT, `git clone` fails — repos are pre-cached by `prepull_aarch64_images.sh` extension. Document this in README.

Step 10 — Author `packages/emmy-eval/tests/swe-lite-adapter.test.ts` (dry-run; mock createEmmySession):

```typescript
import { describe, expect, it } from "bun:test";
import { extractUnifiedDiff } from "../src/suites/extract_unified_diff";

describe("swe-lite adapter (EVAL-01)", () => {
  it("extractUnifiedDiff is exported and pure", () => {
    expect(extractUnifiedDiff("```diff\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```")).toContain("--- a/x");
  });
  // Adapter integration tested manually via dry-run flag in Task 2/3 operator runs;
  // unit-testing the full createEmmySession-in-loop path requires test-only mocks
  // beyond the scope of this plan.
});
```

Step 11 — Author `scripts/run_phase5_swe_lite.sh` driver (mirroring 05-03's run_phase5_tbench.sh shape).

Step 12 — Verify:

```bash
cd /data/projects/emmy
bun test packages/emmy-eval/src/suites/extract_unified_diff.test.ts packages/emmy-eval/tests/swe-lite-adapter.test.ts
EMMY_AIRGAP=strict uv run python -m emmy_serve.eval.swe_lite_grade --predictions /tmp/x.json --out /tmp/y.json   # exits 5
EMMY_AIRGAP=strict bash eval/swe-bench-agent/prepull_aarch64_images.sh   # exits 5
```

**Verify:**

```
cd /data/projects/emmy && bun test packages/emmy-eval/src/suites/extract_unified_diff.test.ts packages/emmy-eval/tests/swe-lite-adapter.test.ts && EMMY_AIRGAP=strict uv run python -m emmy_serve.eval.swe_lite_grade --predictions /dev/null --out /dev/null; test $? -eq 5
```

**Done:**
- 6+ unit tests for extract_unified_diff GREEN
- swe-lite.ts adapter compiles + has dry-run path tested
- swe_lite_grade.py + prepull_aarch64_images.sh both refuse STRICT lane (exit 5)
- eval/suites/swe-lite.yaml has real manifest_hash
- README.md documents PERMISSIVE-vs-STRICT split + smoke-then-full flow
- Driver script `scripts/run_phase5_swe_lite.sh` exists + executable

***

## Task 2 (checkpoint:human-verify, gate=blocking): Operator pre-pulls aarch64 images + runs 30-instance smoke + populates SKIP_LIST

**what-built:**
- `prepull_aarch64_images.sh` (Task 1)
- `emmy_serve/eval/swe_lite_smoke.py` (Task 1)
- `eval/swe-bench-agent/SKIP_LIST.yaml` empty stub

**The OPERATOR runs:**

Pre-flight (PERMISSIVE; one-time; ~2-4h):

```bash
cd /data/projects/emmy

# 1. Pre-pull all SWE-Lite Docker images.
EMMY_AIRGAP=permissive bash eval/swe-bench-agent/prepull_aarch64_images.sh \
    2>&1 | tee runs/phase5-swe-lite/prepull-<iso>.log
# Inspect: any FAIL lines indicate aarch64-incompatible instances.

# 2. Cache the SWE-Lite dataset locally.
EMMY_AIRGAP=permissive uv run python -c "
from datasets import load_dataset
import json
from pathlib import Path
ds = load_dataset('princeton-nlp/SWE-bench_Lite', split='test')
out = Path('eval/cache/swe-bench-lite/instances.json')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps([dict(r) for r in ds], indent=2))
print(f'cached {len(ds)} instances')
"

# 3. Run 30-instance smoke against qwen3.6-35b-a3b@v3.1
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1
EMMY_AIRGAP=permissive uv run python -m emmy_serve.eval.swe_lite_smoke \
    --profile qwen3.6-35b-a3b@v3.1 \
    --out runs/phase5-swe-lite/smoke-<iso>/

# Smoke exits:
#   0 = OK; populate SKIP_LIST.yaml only with the discovered failures
#   1 = generation error
#   2 = grading error
#   3 = aarch64 incompat > 20% threshold; ESCALATE per RESEARCH Risk 3
```

If smoke exits 3: STOP. Open a discussion with the planner — possible Phase 7 SWE-bench move, or change to running grading on a separate x86 box with predictions transfer. Resume signal: `swe-lite escalate phase 7`.

Otherwise, populate `eval/swe-bench-agent/SKIP_LIST.yaml` with each failed instance's `{instance_id, reason, discovered_in: "<smoke-iso>"}`. Re-run `bun run scripts/eval/manifest_hash.ts eval/suites/swe-lite.yaml --rewrite` so the manifest hash captures the updated skip_list_path mtime.

Resume signal: type `swe-lite smoke green` once smoke exits 0 AND SKIP_LIST.yaml is populated AND swe-lite.yaml manifest hash recomputed.

**how-to-verify:**

1. `runs/phase5-swe-lite/prepull-<iso>.log` exists; no `FAIL: *` lines OR all FAIL'd images are in SKIP_LIST.yaml
2. `eval/cache/swe-bench-lite/instances.json` exists with 300 entries (jq length)
3. `runs/phase5-swe-lite/smoke-<iso>/graded.json` exists; smoke summary line "smoke OK"
4. `eval/swe-bench-agent/SKIP_LIST.yaml.instances_skipped` matches the smoke's aarch64-failure list (≤6 entries per Risk 3 threshold)
5. `eval/suites/swe-lite.yaml manifest_hash` reflects the updated skip_list_path

**resume-signal:** Type `swe-lite smoke green` once verified

***

## Task 3 (checkpoint:human-verify, gate=blocking): Operator runs Tier-B MoE batch + Tier-B dense smoke — multi-weekend GPU window

**what-built:**
- `scripts/run_phase5_swe_lite.sh` driver (Task 1)
- All Plan 05-04 Task 1 + Task 2 artifacts validated
- 4 placeholder dirs under `runs/phase5-swe-lite/`

**The OPERATOR runs:**

Window: ~140-160h total. Split into multiple weekend slots; per-profile checkpoints under `runs/phase5-swe-lite/<slug>/<iso>-checkpoint-<batch-id>.json` so a thermal pause / overnight power blip does not waste 30+h.

```bash
# Weekend 1: Qwen MoE 35B-A3B + Qwen 27B dense
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1
EMMY_AIRGAP=permissive ./scripts/run_phase5_swe_lite.sh --profile qwen3.6-35b-a3b@v3.1 --samples 3
# ~45h generation + 1.5h grading. Output runs/phase5-swe-lite/qwen35-a3b-v3.1/<iso>/

# 5-min cool-down

/profile qwen3.6-27b
EMMY_AIRGAP=permissive ./scripts/run_phase5_swe_lite.sh --profile qwen3.6-27b@v1.1 --samples 1
# ~25h generation + 1h grading. Output runs/phase5-swe-lite/qwen27b-v1.1/<iso>/

# Weekend 2: Gemma MoE + Gemma 31B dense
/profile gemma-4-26b-a4b-it
EMMY_AIRGAP=permissive ./scripts/run_phase5_swe_lite.sh --profile gemma-4-26b-a4b-it@v2 --samples 3
# ~45h gen + 1.5h grading

# 5-min cool-down

/profile gemma-4-31b-it
EMMY_AIRGAP=permissive ./scripts/run_phase5_swe_lite.sh --profile gemma-4-31b-it@v1.1 --samples 1
# ~25h gen + 1h grading
```

Resume signal: type `swe-lite green` when all 4 profile dirs each contain `predictions.json` + `graded.json` + `report.json` (with provenance embedded) + `report.md`. Each report's `total_samples` should match expected (samples × (300 - skip-list-size)).

**how-to-verify:**

1. 4 result directories under `runs/phase5-swe-lite/{qwen35-a3b-v3.1,qwen27b-v1.1,gemma26b-a4b-v2,gemma31b-v1.1}/<iso>/`
2. Each directory has: `predictions.json`, `graded.json`, `provenance.json`, `report.json`, `report.md`, `transcripts/`
3. Each `report.json`:
   - `suite_id == "swe-bench-lite"`
   - `suite_complete == true`
   - `spok_failures == 0`
   - `total_samples == samples * (300 - len(SKIP_LIST.yaml.instances_skipped))`
   - Each row: MoE has `samples.length == 3`; dense has `samples.length == 1` + `insufficient_samples: true`
4. `report.md` headers carry the Tier-B violation callout for dense profiles
5. nvidia-smi snapshots at start/end of each profile-batch show no preemption/OOM events

**resume-signal:** Type `swe-lite green` when all 4 reports validate

# Threat Model

## Trust Boundaries

| Boundary | Description |
|---|---|
| pi-emmy session → SWE-Lite repo at base_commit | Repo cloned under PERMISSIVE pre-flight; pi-emmy operates on local cwd; STRICT lane during inference is preserved |
| swebench grader → DockerHub | PERMISSIVE lane only; image pulls + container exec happen during grading phase; isolated from inference loop |
| Predictions JSON → graded JSON | Predictions are public-data-derived; graded.json is the result artifact; no secrets cross |
| extractUnifiedDiff → predictions.json | Pure function; if extraction fails, sample exec_score=0 with failure_mode="no-diff-extracted" rather than silent skip |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-05-04-01 | T (Tampering) | predictions.json after generation, before grading | mitigate | Provenance.json embeds eval_driver_commit; graded.json names predictions file by full path; tampering detectable by re-running grader |
| T-05-04-02 | E (Elevation of privilege) | swebench harness invoking docker run | mitigate | swe_lite_grade.py refuses STRICT lane (exit 5); air-gap CI verifier (Plan 05-07) double-checks lane at job-config level |
| T-05-04-03 | I (Information disclosure) | repos cloned under /tmp/emmy-swe-lite | accept | All repos are public; no secret cross |
| T-05-04-04 | D (DoS) | aarch64 instances >20% fail | mitigate | Smoke gate (Plan 05-04 Task 2) escalates to RESEARCH Risk 3 path before full run |
| T-05-04-05 | R (Repudiation) | SKIP_LIST.yaml grew during grading | mitigate | Each entry must have `discovered_in: <smoke-iso>` field; grader does NOT auto-add to skip list — only the smoke gate does |
| T-05-04-06 | S (Spoofing) | grader produces resolved=true on a wrong patch | accept | swebench's official harness runs the project's own test_patch; trust delegated to upstream maintainer |
| T-05-04-07 | T | model_patch invalid (wrong format) | mitigate | extractUnifiedDiff returns null on malformed → sample marked exec_score=0; grader cannot apply → resolved=false; not a silent pass |

# Verification

End-of-plan checks:

1. `bun test packages/emmy-eval/src/suites/extract_unified_diff.test.ts` — 6+ tests green (W3: in-package location)
2. `bun test packages/emmy-eval/tests/swe-lite-adapter.test.ts` — green
3. `EMMY_AIRGAP=strict uv run python -m emmy_serve.eval.swe_lite_grade ...` exits 5
4. `eval/suites/swe-lite.yaml manifest_hash` is real sha256
5. After Task 2: `eval/cache/swe-bench-lite/instances.json` has 300 entries; SKIP_LIST.yaml has ≤6 entries
6. After Task 3: 4 result directories with full predictions+graded+report artifacts; `jq '.suite_complete' runs/phase5-swe-lite/qwen35-a3b-v3.1/*/report.json` returns true

# Success Criteria

- Plan 05-06 A/B compare can ingest the 4 swe-lite report.json files alongside the 4 tbench reports for cross-profile + cross-suite analysis
- Plan 05-07 reproducer manifest captures swe-lite.yaml + SKIP_LIST.yaml + swe_lite_grade.py
- EVAL-01 closure: terminal-bench-2.0 ✓ (Plan 05-03) + SWE-bench Lite ✓ (this plan) + LCB rolling ✓ (Plan 05-01) = 3 of 4 EVAL-01 suites; prior-Phase-1 continuity ✓ (Plan 05-02) = full closure
- Phase 5 SC-1 evidence extends to SWE-Lite

# Output

After Tasks 1-3 complete, create `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-04-SUMMARY.md`. Cite:
- Final SKIP_LIST.yaml size + reasons
- Wall-clock per profile (actual vs predicted)
- Resume signals: `swe-lite smoke green`, `swe-lite green`
- Per-profile resolved% from graded.json
- swebench package version captured in manifest at first run
- Any escalations (smoke exit 3 path)
