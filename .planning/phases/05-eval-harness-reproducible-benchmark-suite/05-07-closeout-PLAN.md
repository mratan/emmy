---
phase: 05
plan: 07
type: execute
wave: 4
depends_on: ["05-01", "05-02", "05-03", "05-04", "05-05", "05-06"]
files_modified:
  - eval/REPRODUCER.md
  - scripts/reproduce_eval.sh
  - .planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - docs/runbook.md
  - runs/phase5-sc/sc1-walkthrough.md
  - runs/phase5-sc/sc2-walkthrough.md
  - runs/phase5-sc/sc3-walkthrough.md
  - runs/phase5-sc/sc4-walkthrough.md
  - runs/phase5-sc/sc5-walkthrough.md
  - runs/phase5-compare/qwen-moe-vs-dense-tbench.md
  - runs/phase5-compare/qwen-moe-vs-dense-swe-lite.md
  - runs/phase5-compare/gemma-moe-vs-dense-tbench.md
  - runs/phase5-compare/gemma-moe-vs-dense-swe-lite.md
  - runs/phase5-compare/qwen-vs-gemma-moe-tbench.md
  - runs/phase5-compare/qwen-vs-gemma-moe-swe-lite.md
  - runs/phase5-compare/tbench-matrix.md
  - runs/phase5-compare/swe-lite-matrix.md
  - runs/phase5-compare/prior-phase1-matrix.md
  - runs/phase5-compare/holdout-matrix.md
  - runs/phase5-compare/livecodebench-matrix.md
autonomous: false
requirements: [EVAL-03, EVAL-09]
tags: [closeout, reproducer-manifest, sc-walkthroughs, requirements-traceability, operator-attended]

must_haves:
  truths:
    - "eval/REPRODUCER.md is the single-document Phase 5 reproducibility manifest: 4-profile MATRIX hashes + container digests + model SHAs + Llama judge profile hash + judge container digest + emmy git SHA + suite manifest hashes (5 suites: tbench-2.0, swe-lite, prior-phase1, holdout, livecodebench-rolling) + air-gap lane split documentation (STRICT inference / PERMISSIVE judge+grading) + scripts/reproduce_eval.sh entry point"
    - "scripts/reproduce_eval.sh: a single bash script that, given the same git SHA + container digests + model SHAs + suite manifest hashes (all from REPRODUCER.md), runs the full Phase 5 evaluation pipeline reproducibly. Phase 5 ships the SCRIPT (per D-06); actually verifying it runs on a second box is Phase 7."
    - "All 5 Phase 5 SC walkthroughs evidence captured at runs/phase5-sc/sc{1..5}-walkthrough.md: SC-1 (run produces JSON+markdown reports with provenance — operator-curated example), SC-2 (reproducer script exists + dry-runs locally — not on second box per D-06), SC-3 (contamination signal fires on a synthetic gap), SC-4 (subset-run --declare-improvement blocked), SC-5 (SP_OK canary fail aborts batch)"
    - "9 EVAL-* + UX-06 + POLISH-01 REQ-IDs flipped Pending → Done in REQUIREMENTS.md traceability table"
    - "A/B compare reports authored across 6 logical comparisons (Qwen-MoE vs Qwen-dense × 2 suites; Gemma-MoE vs Gemma-dense × 2 suites; Qwen-MoE vs Gemma-MoE × 2 suites) under runs/phase5-compare/"
    - "5 matrix aggregations authored (one per suite: tbench, swe-lite, prior-phase1, holdout, livecodebench) under runs/phase5-compare/"
    - "STATE.md updated: Phase 5 CLOSED, cumulative REQ-IDs count +9-10 (43 + 10 = 53/68)"
    - "ROADMAP.md updated: Phase 5 row marked Closed; all 7 plan checkboxes flipped to [x]; status table updated"
    - "docs/runbook.md extended with 'Running an eval batch' section citing the primitives shipped in Plans 05-02 + 05-05; documents the STRICT/PERMISSIVE air-gap lane split for inference vs judge vs grading"
    - "Daily-driver default UNCHANGED (verified — `cat profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT` returns `v3.1` byte-identical pre vs post Phase 5)"
  artifacts:
    - path: "eval/REPRODUCER.md"
      provides: "Single-document Phase 5 reproducibility manifest; the artifact a stranger uses to reproduce numbers on a fresh DGX Spark"
      contains: "## Reproduction Steps"
      min_lines: 80
    - path: "scripts/reproduce_eval.sh"
      provides: "Single-bash-script reproduction entry point; pulls digests, mounts caches, runs eval pipeline"
      contains: "#!/usr/bin/env bash"
    - path: ".planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md"
      provides: "Phase 5 closeout: 5/5 SCs verdicts + REQ-ID traceability + deferrals + Phase 6 handoff"
      contains: "Phase 5 CLOSED"
    - path: "runs/phase5-sc/sc1-walkthrough.md"
      provides: "Operator narrative: walkthrough of one tbench profile's report demonstrating SC-1 'JSON+markdown report with full provenance'"
      contains: "sc1 phase5 green"
    - path: "runs/phase5-compare/tbench-matrix.md"
      provides: "4-profile cross-cell matrix on terminal-bench-2.0; consumes the 4 tbench reports"
      contains: "qwen3.6-35b-a3b"
  key_links:
    - from: "eval/REPRODUCER.md"
      to: "all 4 profile bundles (eval/MATRIX.md row hashes) + Llama judge profile hash"
      via: "embedded hash references"
      pattern: "sha256:"
    - from: "scripts/reproduce_eval.sh"
      to: "packages/emmy-eval/bin/pi-emmy-eval.ts"
      via: "invokes pi-emmy-eval run + compare + matrix per profile"
      pattern: "pi-emmy-eval"
    - from: ".planning/REQUIREMENTS.md"
      to: ".planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md"
      via: "REQ-ID flips cite the closeout for evidence"
      pattern: "Plan 05-0"
    - from: "docs/runbook.md"
      to: "packages/emmy-eval/bin/pi-emmy-eval.ts + emmy_serve/eval/swe_lite_grade.py + scripts/eval/fetch_lcb_dataset.py"
      via: "documents primary user commands"
      pattern: "pi-emmy-eval"
---

# Objective

Close Phase 5 via (a) the **REPRODUCER manifest** (`eval/REPRODUCER.md` + `scripts/reproduce_eval.sh`) — the single-artifact reproducibility story per D-06 from 05-CONTEXT.md, (b) **5 SC walkthroughs** demonstrating each Phase 5 success criterion is met (per Phase 1 D-15 operator-gated pattern), (c) **6 A/B compare reports + 5 matrix aggregations** consuming the 4 generator profiles' results across the 5 suites, (d) **REQUIREMENTS.md traceability** flipping 9 EVAL-* + UX-06 + POLISH-01 REQ-IDs to Done, (e) **CLOSEOUT.md** narrative + (f) **STATE.md / ROADMAP.md** advance + (g) **docs/runbook.md** extension. Closes Phase 5 with the **research-artifact bar reached** per ROADMAP.

Purpose: A research artifact is reproducible or it isn't. Plans 05-01..06 produced the components; Plan 05-07 stitches them into a single document a stranger can follow on a fresh DGX Spark to reproduce every number. Per D-06: this plan ships the **script + manifest**; whether it actually runs on a second box is Phase 7's concern.

Output:
- `eval/REPRODUCER.md` (the manifest)
- `scripts/reproduce_eval.sh` (the executable entry point)
- 5 SC walkthroughs at `runs/phase5-sc/sc{1..5}-walkthrough.md`
- 6 A/B compare reports + 5 matrix aggregations at `runs/phase5-compare/`
- `05-CLOSEOUT.md` + REQUIREMENTS.md + STATE.md + ROADMAP.md + docs/runbook.md updates
- Phase 5 closed; cumulative ~53/68 REQ-IDs Done

# Execution Context

@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

# Context

@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CONTEXT.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-RESEARCH.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-01-holdout-suite-PLAN.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-02-eval-driver-core-PLAN.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-03-terminal-bench-PLAN.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-04-swe-bench-lite-PLAN.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-05-llama-judge-profile-PLAN.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-06-ab-compare-PLAN.md
@CLAUDE.md
@eval/MATRIX.md
@.planning/phases/04-gemma-4-profile-profile-system-maturity/04-CLOSEOUT.md

## Interfaces

REPRODUCER.md skeleton (this plan authors):

```markdown
# Phase 5 Reproducer Manifest

**Generated:** <Plan 05-07 close date>
**Phase 5 status:** Closed; research-artifact bar reached.
**Daily-driver default:** UNCHANGED — qwen3.6-35b-a3b@v3.1.

## Pin set

### Hardware
- Platform: DGX Spark (GB10, aarch64, 128 GB UMA)
- Hardware-id sentinel: `[operator-set $EMMY_HARDWARE_ID]`

### Software
- emmy git SHA: `<git rev-parse HEAD at Phase 5 close>`
- Bun version: `bun --version`
- uv version: `uv --version`

### Containers
| Family | Container | Digest |
|---|---|---|
| Qwen | nvcr.io/nvidia/vllm:26.03.post1-py3 | `sha256:<from MATRIX.md>` |
| Gemma | vllm/vllm-openai:gemma4-0409-arm64-cu130 | `sha256:<from MATRIX.md>` |
| Llama (judge) | nvcr.io/nvidia/vllm:26.03.post1-py3 | `sha256:<from Plan 05-05 PROFILE_NOTES>` |

### Model SHAs
Per checker Blocker 6: model_sha values MUST be real (no `[offline-cache-only]` sentinels). Resolved at Plan 05-07 Task 1 via HF cache snapshot lookup (procedure below).

| Model HF id | SHA | Lookup |
|---|---|---|
| Qwen/Qwen3.6-35B-A3B-FP8 | `sha256:<resolved>` | `huggingface-cli scan-cache | grep "Qwen/Qwen3.6-35B-A3B-FP8"` → snapshot dir → `git rev-parse HEAD` inside |
| Qwen/Qwen3.6-27B-FP8 | `sha256:<resolved>` | (same procedure, different repo) |
| google/gemma-4-26B-A4B-it | `sha256:<resolved>` | (same procedure) |
| google/gemma-4-31B-it | `sha256:<resolved>` | (same procedure) |
| meta-llama/Llama-3.3-70B-Instruct | `sha256:<resolved>` | (same procedure) |

### Profile bundles (5 — 4 generators + 1 judge)
| Profile | Version | Hash | Role |
|---|---|---|---|
| qwen3.6-35b-a3b | v3.1 | `sha256:f9dcabd1...` | daily-driver default |
| qwen3.6-27b | v1.1 | `sha256:4f08e4e5...` | dense (eval) |
| gemma-4-26b-a4b-it | v2 | `sha256:ec14fb09...` | gemma sibling |
| gemma-4-31b-it | v1.1 | `sha256:55d5f8cc...` | gemma dense (eval) |
| llama-3.3-70b-instruct | v1 | `sha256:<measured>` | judge (eval-only) |

### Suite manifests (5)
| Suite | manifest_hash | Source plan |
|---|---|---|
| terminal-bench-2.0 | `sha256:...` | Plan 05-03 |
| swe-bench-lite | `sha256:...` | Plan 05-04 |
| prior-phase1-continuity | `sha256:...` | Plan 05-02 |
| holdout | `sha256:...` | Plan 05-01 |
| livecodebench-rolling | `sha256:...` | Plan 05-01 |

### Air-gap lane discipline
- **STRICT (`ci_verify_phase3` lane):** all inference. Eval driver verifies at startup; refuses --judge=cloud-claude or PERMISSIVE-only operations.
- **PERMISSIVE (`ci_verify_research_egress` lane):** dataset refresh (LCB HuggingFace pulls), SWE-bench Docker registry, optional cloud Claude judge. Pre-cached before STRICT batches start.

## Reproduction Steps

(Per D-06: this is the script a stranger runs. Phase 7 wraps it in a second-box CI.)

```bash
# 1. Clone repo at the pinned git SHA
git clone https://github.com/.../emmy.git
cd emmy
git checkout <git-sha-from-this-manifest>

# 2. Pre-pull containers (PERMISSIVE)
EMMY_AIRGAP=permissive ./scripts/reproduce_eval.sh prepare

# 3. Run STRICT inference + grading + judge in sequence
EMMY_AIRGAP=strict ./scripts/reproduce_eval.sh run

# 4. Outputs land at runs/phase5-repro-<iso>/; compare against runs/phase5-{tbench,swe-lite,...}/ from this manifest's reference run
./scripts/reproduce_eval.sh verify --reference runs/phase5-tbench/qwen35-a3b-v3.1/<iso>/
```

## Suites + Coverage

(Tier A: all 4 profiles × N=3; Tier B: MoE only at N=3, dense at N=1 smoke)

[5 suite × 4 profile coverage table]

## Result reference

[Links to runs/phase5-tbench/, runs/phase5-swe-lite/, runs/phase5-lcb/, runs/phase5-prior-phase1/, runs/phase5-holdout/]
```

reproduce_eval.sh skeleton:

```bash
#!/usr/bin/env bash
# scripts/reproduce_eval.sh — Phase 5 reproducer entry point.
# Subcommands: prepare (PERMISSIVE pre-fetch), run (STRICT eval pipeline), verify (cross-check).

set -euo pipefail

SUBCOMMAND="${1:-help}"
case "$SUBCOMMAND" in
    help|--help)
        cat <<EOF
Phase 5 Reproducer

Subcommands:
  prepare   Pre-fetch all containers + datasets + models (PERMISSIVE air-gap)
  run       Run the full eval pipeline (STRICT inference + PERMISSIVE judge/grading)
  verify    Compare new run output against reference

Required env:
  EMMY_AIRGAP=strict|permissive (set per subcommand)
  HF_TOKEN (for prepare; gated models)
  ANTHROPIC_API_KEY (optional; only if --judge=cloud-claude)

See eval/REPRODUCER.md for full pin set.
EOF
        ;;
    prepare)
        if [ "${EMMY_AIRGAP:-strict}" != "permissive" ]; then
            echo "ERROR: prepare requires EMMY_AIRGAP=permissive" >&2; exit 5
        fi
        # Pull containers
        docker pull nvcr.io/nvidia/vllm:26.03.post1-py3@sha256:<from manifest>
        docker pull vllm/vllm-openai:gemma4-0409-arm64-cu130@sha256:<from manifest>
        # Pull models
        huggingface-cli download Qwen/Qwen3.6-35B-A3B-FP8 --local-dir /models/Qwen3.6-35B-A3B-FP8
        # ... 4 more models ...
        # Pull datasets
        ./eval/swe-bench-agent/prepull_aarch64_images.sh
        uv run python scripts/eval/fetch_lcb_dataset.py
        echo "prepare: complete"
        ;;
    run)
        if [ "${EMMY_AIRGAP:-permissive}" != "strict" ]; then
            echo "ERROR: run requires EMMY_AIRGAP=strict for inference phase" >&2; exit 5
        fi
        # Per-profile loop:
        for PROF in qwen3.6-35b-a3b@v3.1 qwen3.6-27b@v1.1 gemma-4-26b-a4b-it@v2 gemma-4-31b-it@v1.1; do
            # ... start_emmy.sh + pi-emmy-eval run --suite ... per suite ...
            # ... 5-min cool-down between profiles ...
        done
        # Judge phase (PERMISSIVE if cloud-claude opted-in; STRICT for self-hosted Llama swap):
        # ... runSelfHostedJudge invocation ...
        echo "run: complete"
        ;;
    verify)
        # ... pi-emmy-eval compare per cell ...
        ;;
    *)
        echo "unknown subcommand: $SUBCOMMAND" >&2; exit 1
        ;;
esac
```

REQ-IDs to flip (REQUIREMENTS.md traceability):

| REQ-ID | Status pre | Status post | Evidence |
|---|---|---|---|
| EVAL-01 | Pending | Done | Plan 05-02 prior-phase1 + 05-03 tbench + 05-04 swe-lite + 05-01 LCB suites all wired |
| EVAL-02 | Pending | Done | Plan 05-02 uses-sdk static check + orchestrator imports createEmmySession |
| EVAL-03 | Pending | Done | Plan 05-02 captureProvenance + Plan 05-07 REPRODUCER manifest |
| EVAL-04 | Pending | Done | Plan 05-02 computeStats + InsufficientSamplesError; N≥3 enforced; reports embed mean ± std |
| EVAL-05 | Pending | Done | Plan 05-01 holdout corpus + rephrased + LCB rolling; contamination_signal in reports |
| EVAL-06 | Pending | Done | Plan 05-05 Llama judge profile + family-guard; Cloud-Claude opt-in |
| EVAL-07 | Pending | Done | Plan 05-02 sp-ok-gate.ts wraps Phase 1 runSpOk; per-50 re-canary |
| EVAL-08 | Pending | Done | Plan 05-02 promotion-gate.ts; subset/N<3/variance overlap all reject |
| EVAL-09 | Pending | Done | Plan 05-02 print-environment.ts; pi-emmy --print-environment exits 0 + JSON |
| UX-06 | Pending | Done | Plan 05-02 @emmy/eval workspace package; library API exported |
| POLISH-01 | (V2 Polish bucket, no row) | Done | Plan 05-06 ab-compare CLI + render |

## Key Files

- `eval/MATRIX.md` — 4 generator profile rows + Llama judge row (post-Plan-05-05)
- `runs/phase5-{tbench,swe-lite,prior-phase1,holdout,livecodebench}/` — all evidence dirs from Plans 05-01..04
- `runs/phase5-llama-judge-{kv,thermal}/` — judge profile validation evidence
- `.planning/phases/04-gemma-4-profile-profile-system-maturity/04-CLOSEOUT.md` — reference for closeout doc structure
- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-CLOSEOUT.md` — earlier closeout reference

# Tasks

## Task 1 (auto): Author REPRODUCER.md + scripts/reproduce_eval.sh

**Files:** `eval/REPRODUCER.md`, `scripts/reproduce_eval.sh`

**Behavior:**
- REPRODUCER.md fills the skeleton in <interfaces> with REAL hashes pulled from each profile bundle's profile.yaml + each suite YAML's manifest_hash + each container's docker inspect digest
- reproduce_eval.sh is executable + has working --help; prepare subcommand refuses STRICT; run subcommand refuses PERMISSIVE for the inference phase

**Action:**

Step 1 — Read all 5 profile bundles' profile.yaml + extract `ref.hash`:

```bash
for prof in profiles/qwen3.6-35b-a3b/v3.1 profiles/qwen3.6-27b/v1.1 profiles/gemma-4-26b-a4b-it/v2 profiles/gemma-4-31b-it/v1.1 profiles/llama-3.3-70b-instruct/v1; do
    echo "=== $prof ==="
    grep -E "^  hash:" "$prof/profile.yaml" || echo "(missing — should be populated by Plans 05-01..05)"
done
```

Step 2 — Read all 5 suite YAMLs + extract `manifest_hash`:

```bash
for suite in eval/suites/{tbench-2.0,swe-lite,prior-phase1,holdout,livecodebench-rolling}.yaml; do
    echo "=== $suite ==="
    grep "^manifest_hash:" "$suite"
done
```

Step 3 — Read each container's digest from `docker inspect`:

```bash
for img in nvcr.io/nvidia/vllm:26.03.post1-py3 vllm/vllm-openai:gemma4-0409-arm64-cu130; do
    docker inspect "$img" --format='{{index .RepoDigests 0}}'
done
```

Step 4 — Author `eval/REPRODUCER.md` filling all the captured hashes. Use the skeleton from <interfaces>; expand each section with the live values. Cite the source plan for every value (e.g. `qwen3.6-35b-a3b/v3.1 hash captured 2026-04-23 at Phase 3.1 close; Plan 03.1-01`).

Step 5 — Author `scripts/reproduce_eval.sh` per the skeleton in <interfaces>. Make executable: `chmod +x scripts/reproduce_eval.sh`. Verify `./scripts/reproduce_eval.sh --help` exits 0 + shows the 3 subcommand names.

Step 6 — Verify lane discipline:

```bash
EMMY_AIRGAP=strict ./scripts/reproduce_eval.sh prepare; test $? -eq 5
EMMY_AIRGAP=permissive ./scripts/reproduce_eval.sh run; test $? -eq 5
```

**Verify:**

```
cd /data/projects/emmy && ./scripts/reproduce_eval.sh --help && grep -Ec "sha256:" eval/REPRODUCER.md   # expect >= 13 hash references (W2 raise + Blocker 6)
```

**Done:**
- eval/REPRODUCER.md exists with all 13+ pin hashes (5 profiles + 2 containers + 5 suite manifests + emmy git SHA + 5 real model SHAs per Blocker 6 = 18 total)
- 5 model_sha rows have real `sha256:<hex>` values from `huggingface-cli scan-cache` (no `[offline-cache-only]` sentinels — Blocker 6)
- /tmp/phase5_model_shas.txt captured during Step 3.5 (transient lookup output; cite in 05-07-SUMMARY)
- scripts/reproduce_eval.sh executable; --help works; STRICT/PERMISSIVE lane discipline enforced
- One commit `docs(05-07): author Phase 5 reproducer manifest + reproduce_eval.sh (real model_sha lookup per Blocker 6)`

***

## Task 2 (auto): Generate 6 A/B compare reports + 5 matrix aggregations

**Files:** `runs/phase5-compare/{6 compare reports + 5 matrix aggregations}.md`

**Behavior:**
- 6 A/B comparisons:
  - qwen-moe-vs-dense-tbench.md (Qwen 35B-A3B vs Qwen 27B on terminal-bench)
  - qwen-moe-vs-dense-swe-lite.md
  - gemma-moe-vs-dense-tbench.md
  - gemma-moe-vs-dense-swe-lite.md
  - qwen-vs-gemma-moe-tbench.md (Qwen 35B-A3B vs Gemma 26B-A4B)
  - qwen-vs-gemma-moe-swe-lite.md
- 5 matrix aggregations: tbench-matrix.md, swe-lite-matrix.md, prior-phase1-matrix.md, holdout-matrix.md, livecodebench-matrix.md (each from aggregateMatrix over all 4 profiles)

Each report inherits the comparable_warning text from compareSuiteRuns. Per Blocker 4: dense-profile runs with suite_complete_reason='smoke-N1' surface the **Tier-B-D-01** callout (NOT EVAL-08); only --filter / --max-tasks subset runs surface EVAL-08 callouts. The 6 A/B reports here are MoE-vs-dense pairs, so the dense side carries the D-01 callout.

**Action:**

Step 1 — Author a small script `scripts/eval/generate_phase5_reports.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p runs/phase5-compare/

# Helpers — find the most recent run dir per profile per suite
latest_run() {
    local profile_slug="$1" suite_root="$2"
    ls -1 "$suite_root/$profile_slug" 2>/dev/null | grep -E '^\d{4}-' | sort | tail -1 | sed "s|^|$suite_root/$profile_slug/|"
}

# 6 comparisons
for SUITE in tbench swe-lite; do
    SUITE_ROOT="runs/phase5-${SUITE}"
    bun run packages/emmy-eval/bin/pi-emmy-eval.ts compare \
        --baseline "$(latest_run qwen35-a3b-v3.1 "$SUITE_ROOT")" \
        --candidate "$(latest_run qwen27b-v1.1 "$SUITE_ROOT")" \
        --out "runs/phase5-compare/qwen-moe-vs-dense-${SUITE}.md"

    bun run packages/emmy-eval/bin/pi-emmy-eval.ts compare \
        --baseline "$(latest_run gemma26b-a4b-v2 "$SUITE_ROOT")" \
        --candidate "$(latest_run gemma31b-v1.1 "$SUITE_ROOT")" \
        --out "runs/phase5-compare/gemma-moe-vs-dense-${SUITE}.md"

    bun run packages/emmy-eval/bin/pi-emmy-eval.ts compare \
        --baseline "$(latest_run qwen35-a3b-v3.1 "$SUITE_ROOT")" \
        --candidate "$(latest_run gemma26b-a4b-v2 "$SUITE_ROOT")" \
        --out "runs/phase5-compare/qwen-vs-gemma-moe-${SUITE}.md"
done

# 5 matrix aggregations
for SUITE in tbench swe-lite prior-phase1 holdout livecodebench; do
    SUITE_ROOT="runs/phase5-${SUITE}"
    SUITE_ID=$(grep "^suite_id:" "eval/suites/${SUITE/-}*.yaml" | head -1 | awk '{print $2}')
    [ -d "$SUITE_ROOT" ] || { echo "skipping $SUITE (no runs)"; continue; }
    bun run packages/emmy-eval/bin/pi-emmy-eval.ts matrix \
        --suite "$SUITE_ID" \
        --runs-dir "$SUITE_ROOT" \
        --out "runs/phase5-compare/${SUITE}-matrix.md"
done
```

Step 2 — Run the script. If a profile's run dir is missing (e.g. dense smoke yet to run), the matrix aggregator skips that cell gracefully + emits a warning row in the markdown.

Step 3 — For each of the 11 generated markdown files, manually inspect the headers + table structure for sanity (operator-eyeballed; no automated check).

Step 4 — Commit `docs(05-07): generate Phase 5 A/B compare reports + matrix aggregations`.

**Verify:**

```
cd /data/projects/emmy && ls runs/phase5-compare/ | wc -l   # expect >= 11
cd /data/projects/emmy && grep -l "different-favoring\|same\|inconclusive" runs/phase5-compare/*.md | wc -l   # expect >= 6
```

**Done:**
- 11 markdown files in runs/phase5-compare/ (6 A/B + 5 matrix)
- Each comparison report has comparable_warning section if applicable
- Each matrix aggregation lists 1-4 profile cells

***

## Task 3 (checkpoint:human-verify, gate=blocking): Operator-attended SC walkthroughs (5 SC walkthrough docs)

**what-built:**
- All Plan 05-01..06 evidence directories on disk
- A/B compare reports + matrix aggregations from Task 2
- Stub `runs/phase5-sc/sc{1..5}-walkthrough.md` files Claude pre-populated with templates the operator fills in

**The OPERATOR runs:**

Window: ~2-3h (no GPU; just verification + writeup).

**SC-1 walkthrough (run produces JSON+markdown reports with full provenance):**

```bash
cd /data/projects/emmy
# Pick one of the 4 generator profile result dirs from Plan 05-03 tbench (e.g. qwen35-a3b-v3.1)
RUNDIR=$(ls -d runs/phase5-tbench/qwen35-a3b-v3.1/*/ | sort | tail -1)
# Verify the 5 expected files exist
ls -la "$RUNDIR"{report.json,report.md,provenance.json,transcripts/}
# Verify provenance schema
jq '.schema_version' "$RUNDIR/provenance.json"   # → "emmy.eval.provenance.v1"
jq '.profile, .engine.container_image_digest, .model.served_model_name, .model.model_sha, .hardware.gpu_uuid, .eval_driver_commit' "$RUNDIR/provenance.json"
# Per Blocker 6: assert .model.model_sha is real (sha256:<hex>, NOT "[offline-cache-only]")
jq -e '.model.model_sha | startswith("sha256:") and (length == 71)' "$RUNDIR/provenance.json"
# Verify report.json has rows with mean ± std
jq '.result.rows[0] | {task_id, mean_exec, std_exec, samples_count: (.samples | length)}' "$RUNDIR/report.json"
```

Operator authors `runs/phase5-sc/sc1-walkthrough.md` documenting what was checked + the verdict line `sc1 phase5 green` at top.

**SC-2 walkthrough (reproducer script exists + dry-runs locally):**

```bash
# Dry-run (does NOT actually re-run the eval; just verifies the script's logic)
EMMY_AIRGAP=permissive bash -n scripts/reproduce_eval.sh   # syntax check
./scripts/reproduce_eval.sh --help
# Verify REPRODUCER.md has all 10+ hash pins
grep -c "sha256:" eval/REPRODUCER.md
# Per D-06: actually running on a second box is Phase 7. Phase 5's SC-2 is met when
# the script exists, the manifest exists, and locally it runs --help correctly.
```

Operator authors `runs/phase5-sc/sc2-walkthrough.md` with verdict `sc2 phase5 green` + explicit note "second-box verification deferred to Phase 7 per D-06" (NOT a blocker).

**SC-3 walkthrough (contamination signal fires on a synthetic gap):**

```bash
# Run a synthetic test feeding the contamination_signal function elevated public scores
# vs depressed holdout scores; verify it fires
bun run -e '
import { emitContaminationSignal } from "./scripts/eval/contamination_signal";
const r = emitContaminationSignal({
  publicScores: { t1: 0.8, t2: 0.85, t3: 0.9 },
  resistantScores: { t1: 0.6, t2: 0.65, t3: 0.7 },
  metric: "pass_at_1",
  threshold: 0.10,
  trackName: "holdout",
});
console.log(JSON.stringify(r, null, 2));
'
# Expect fired:true, gap ~0.20, tasks_flagged: t1, t2, t3
```

Operator authors `runs/phase5-sc/sc3-walkthrough.md` with verdict `sc3 phase5 green`.

**SC-4 walkthrough (subset-run --declare-improvement blocked):**

```bash
# Try to declare improvement with --filter (subset run); verify exit 8
bun run packages/emmy-eval/bin/pi-emmy-eval.ts run \
  --profile profiles/qwen3.6-35b-a3b/v3.1 \
  --suite eval/suites/prior-phase1.yaml \
  --samples 3 \
  --out /tmp/sc4-test \
  --filter '^CODE_01' \
  --declare-improvement runs/phase5-prior-phase1/qwen35-a3b-v3.1/<iso>/
echo "exit code: $?"   # expect 8
```

Operator authors `runs/phase5-sc/sc4-walkthrough.md` with verdict `sc4 phase5 green`.

**SC-5 walkthrough (SP_OK canary fail aborts batch):**

```bash
# Simulate a canary fail: stop emmy-serve mid-run OR (cleaner) point at a deliberately-misconfigured base URL
EMMY_AIRGAP=strict bun run packages/emmy-eval/bin/pi-emmy-eval.ts run \
  --profile profiles/qwen3.6-35b-a3b/v3.1 \
  --suite eval/suites/prior-phase1.yaml \
  --samples 3 \
  --out /tmp/sc5-test \
  --base-url http://127.0.0.1:9999   # vLLM not on this port
echo "exit code: $?"   # expect 7
```

Operator authors `runs/phase5-sc/sc5-walkthrough.md` with verdict `sc5 phase5 green`.

Resume signal: type `phase5 sc walkthroughs green` once all 5 walkthrough docs exist + each has its `sc{N} phase5 green` verdict line at top.

**how-to-verify:**

1. 5 walkthrough docs at `runs/phase5-sc/sc{1,2,3,4,5}-walkthrough.md`
2. Each contains `sc{N} phase5 green` literal line near the top
3. SC-2 walkthrough notes the Phase 7 carry-forward explicitly
4. SC-3..5 walkthroughs include the actual command output (transcript) demonstrating the verdict

**resume-signal:** Type `phase5 sc walkthroughs green` when all 5 walkthrough docs validate

***

## Task 4 (auto): Update REQUIREMENTS.md + ROADMAP.md + STATE.md + docs/runbook.md + author 05-CLOSEOUT.md

**Files:** `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `docs/runbook.md`, `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md`

**Action:**

Step 1 — Update `.planning/REQUIREMENTS.md` traceability table: flip 9 EVAL-* + UX-06 + POLISH-01 from Pending → Done with the citation pattern from <interfaces>.

Step 2 — Update `.planning/ROADMAP.md`:
- Phase 5 Plans list: flip all 7 plan checkboxes `[x]`
- Phase 5 Plans count: `**Plans:** 7 plans` (was TBD)
- `## Phases` top-level row: flip Phase 5 to `- [x] **Phase 5:** ...`
- Append closing line at bottom of file: `*Updated: <date> — Phase 5 closed; 9 EVAL-* + UX-06 + POLISH-01 REQ-IDs flipped Pending → Done; cumulative ~53/68 REQ-IDs Done; eval/REPRODUCER.md authored as the research-artifact bar.*`
- Update `## Progress Table`: Phase 5 row Closed
- Update `## Coverage`: EVAL row count match (already 9 in Phase 5; verify)

Step 3 — Update `.planning/STATE.md`:
- `Last updated:` date
- `Updated by:` `executor (Phase 5 fully CLOSED — eval harness shipped, 4-profile MATRIX + Llama judge profile validated, 5/5 SCs green, REPRODUCER.md authored, 9-10 REQ-IDs flipped, daily-driver default UNCHANGED)`
- Progress table: Phase 5 row Closed
- `Current Position:` Phase 6 (speculative decoding) is next
- `Performance Metrics:` cumulative REQ-IDs (43 + ~10 = ~53/68)
- `Roadmap Evolution:` add a one-line note "Phase 5 closed <date>; research-artifact bar reached"

Step 4 — Extend `docs/runbook.md` with a `## Running an eval batch` section:

```markdown
## Running an eval batch (Phase 5 primitives)

Phase 5 ships `pi-emmy-eval` (TS workspace package `@emmy/eval`) for reproducible
benchmark runs. Inference always runs under STRICT (`EMMY_AIRGAP=strict`); judge
+ grading + dataset refresh run under PERMISSIVE.

### One-shot suite run

\`\`\`bash
EMMY_AIRGAP=strict bun run packages/emmy-eval/bin/pi-emmy-eval.ts run \\
    --profile profiles/qwen3.6-35b-a3b/v3.1 \\
    --suite eval/suites/prior-phase1.yaml \\
    --samples 3 \\
    --out runs/phase5-prior-phase1/qwen35-a3b-v3.1/<iso>/
\`\`\`

### A/B compare two runs

\`\`\`bash
bun run packages/emmy-eval/bin/pi-emmy-eval.ts compare \\
    --baseline <run-A-dir> --candidate <run-B-dir> \\
    --out runs/phase5-compare/A-vs-B.md
\`\`\`

### Full reproducer (per Plan 05-07 D-06)

\`\`\`bash
EMMY_AIRGAP=permissive ./scripts/reproduce_eval.sh prepare
EMMY_AIRGAP=strict     ./scripts/reproduce_eval.sh run
\`\`\`

See `eval/REPRODUCER.md` for the full pin manifest.

### Air-gap lane reminder

| Lane | What's allowed | Used for |
|---|---|---|
| STRICT | loopback only (emmy-serve over 127.0.0.1) | inference (every Phase 5 generation phase) |
| PERMISSIVE | + DockerHub + HuggingFace + (opt-in) Anthropic API | dataset refresh, SWE-bench grading, optional cloud-claude judge |

Eval driver verifies the active lane at startup; mismatched config exits with code 5.
```

Step 5 — Author `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md`:

```markdown
# Phase 5 Closeout — Eval Harness + Reproducible Benchmark Suite

**Closed:** <date>
**Status:** CLOSED with 5/5 SCs green; deferred items documented below.
**Daily-driver default:** UNCHANGED — `qwen3.6-35b-a3b@v3.1`.
**Research-artifact bar:** REACHED.

## Plans Closed

[7 plan rows with commit SHAs + 1-line summaries]

## Success Criteria Verdicts

| SC | Verdict | Evidence |
|---|---|---|
| SC-1: pi-emmy-eval run produces JSON+markdown reports with full provenance | green | runs/phase5-sc/sc1-walkthrough.md |
| SC-2: same command on clean DGX Spark reproduces every reported number | green | runs/phase5-sc/sc2-walkthrough.md (with Phase 7 carry-forward note) |
| SC-3: contamination-resistant tracks score within documented gap; signal fires above threshold | green | runs/phase5-sc/sc3-walkthrough.md |
| SC-4: subset --declare-improvement blocked by promotion gate | green | runs/phase5-sc/sc4-walkthrough.md |
| SC-5: SP_OK canary failure aborts batch | green | runs/phase5-sc/sc5-walkthrough.md |

## REQ-IDs Closed (10)

[Table referencing the REQUIREMENTS.md flips]

## Profile + Container + Suite Pin Set

[Cite eval/REPRODUCER.md as the authoritative manifest]

## Tier Coverage Per D-01

[Document the explicit tier-A/B coverage acceptance per 05-CONTEXT.md]

## Deferrals

| Item | Reason | Phase |
|---|---|---|
| SWE-bench Verified (500) | aarch64 image coverage; outside-reproducer scope | Phase 7 |
| Outside-reproducer second-box CI | per D-06; Phase 5 ships script, Phase 7 wraps in CI | Phase 7 |
| Prior-Phase-1 literature tasks (3 PubMed/bioRxiv) | need MCP servers Emmy doesn't ship | Phase 6+ |
| Full N=3 dense profile coverage on tbench/swe-lite | wall-clock infeasible on Spark | Phase 7 (x86 reproducer) |
| POLISH-02 session replay + POLISH-03 static dashboard | not load-bearing for research-artifact bar | Backlog/Phase 7 |

## Phase 6 Handoff

Phase 6 (Speculative Decoding) consumes the Phase 5 eval harness for paired spec-on/spec-off
benchmarks. The pi-emmy-eval CLI + @emmy/eval library API are the entry points; speculative
config goes in profile.serving.engine.speculative; eval reports the win envelope.

## Daily-driver default UNCHANGED confirmation

`cat profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT` = `v3.1` (byte-identical pre vs post Phase 5).
```

Step 6 — Final verification:

```bash
cd /data/projects/emmy
# Daily-driver default unchanged
diff -q profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT <(echo v3.1)

# All 9+ REQ-IDs flipped
grep -E "^\| EVAL-0[1-9] \| Phase 5 \| Done" .planning/REQUIREMENTS.md | wc -l   # expect 9
grep "^| UX-06 | Phase 5 | Done" .planning/REQUIREMENTS.md
grep "^| POLISH-01 |" .planning/REQUIREMENTS.md

# Phase 5 marked closed in roadmap
grep -E "^\- \[x\] \*\*Phase 5:" .planning/ROADMAP.md

# 7 plans all checked
grep -c "^\- \[x\] 05-0" .planning/ROADMAP.md   # expect 7

# Cumulative test count
bun test packages/   # all green; cumulative count documented in CLOSEOUT
```

Step 7 — Single closeout commit:

```
docs(05-07): close Phase 5 — eval harness + REPRODUCER manifest + 5 SC walkthroughs
- 9 EVAL-* + UX-06 + POLISH-01 REQ-IDs flipped Pending → Done (cumulative 53/68)
- eval/REPRODUCER.md + scripts/reproduce_eval.sh authored
- 5/5 SCs green; deferrals documented
- Daily-driver default UNCHANGED (qwen3.6-35b-a3b/DEFAULT_VARIANT = v3.1 byte-identical)
- Research-artifact bar reached
- Phase 6 (speculative decoding) handoff prepared
```

**Verify:**

```
cd /data/projects/emmy
diff -q profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT <(echo v3.1) && \
  grep -c "Phase 5 | Done" .planning/REQUIREMENTS.md && \
  grep -E "^\- \[x\] \*\*Phase 5:" .planning/ROADMAP.md && \
  test -f .planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md && \
  test -f eval/REPRODUCER.md && \
  test -x scripts/reproduce_eval.sh
```

**Done:**
- All 4 planning docs (REQUIREMENTS, ROADMAP, STATE, CLOSEOUT) updated
- docs/runbook.md extended
- Daily-driver default verified byte-identical
- Single closeout commit with the cumulative summary

# Threat Model

## Trust Boundaries

| Boundary | Description |
|---|---|
| eval/REPRODUCER.md ↔ external reproducer | Manifest is the trust contract; downstream consumer's reproducer-CI verifies hashes match |
| scripts/reproduce_eval.sh ↔ HF/DockerHub during prepare | PERMISSIVE-only; STRICT for inference phase |
| 05-CLOSEOUT.md REQ-ID flips ↔ REQUIREMENTS.md | Closeout cites which Plan/SC closed each REQ-ID; reviewer can cross-check |
| Daily-driver default ↔ Phase 5 evidence | Explicit byte-identical check at closeout (D-10 from 05-CONTEXT.md) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-05-07-01 | T (Tampering) | profile hashes in REPRODUCER.md drift from actual profile.yaml | mitigate | Closeout commit re-reads each profile.yaml at write time; reviewer can `bun run scripts/eval/manifest_hash.ts profiles/...` to verify |
| T-05-07-02 | I (Information disclosure) | REPRODUCER.md cites $EMMY_HARDWARE_ID | accept | Hardware ID is sha256 of (gpu_uuid + uname + machine-id slice) — not directly identifying; sentinel allows operator override |
| T-05-07-03 | E (Elevation of privilege) | reproduce_eval.sh prepare lane bypass | mitigate | First action in each subcommand is `[ "${EMMY_AIRGAP}" = "..." ]` check; exit 5 on mismatch |
| T-05-07-04 | R (Repudiation) | SC walkthrough verdicts forged | accept | Operator-attended; git commit log + transcript captures provide audit trail; pattern matches Phase 1 D-15 + Phase 4 closeout precedent |
| T-05-07-05 | S (Spoofing) | Daily-driver default file edited but not committed | mitigate | Final verification step diffs against literal `v3.1`; closeout commit refuses to land if diff is non-empty |
| T-05-07-06 | D (DoS) | reproducer script unbounded execution if generators fail | accept | Each subcommand has wall-clock budget documented in REPRODUCER.md; operator can Ctrl+C; per-profile checkpoints persist |

# Verification

End-of-plan checks:

1. `cat profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT` returns `v3.1` literal
2. `grep -c "^| EVAL-0[1-9] | Phase 5 | Done" .planning/REQUIREMENTS.md` returns 9
3. `grep "^| UX-06 |" .planning/REQUIREMENTS.md | grep -c Done` returns 1
4. `grep "^| POLISH-01" .planning/REQUIREMENTS.md | grep -c Done` returns 1
5. `grep -E "^\- \[x\] 05-0" .planning/ROADMAP.md | wc -l` returns 7
6. `test -f eval/REPRODUCER.md && test -x scripts/reproduce_eval.sh && test -f .planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md`
7. 5 SC walkthrough docs all contain their respective `sc{N} phase5 green` verdict line
8. `bun test packages/` — all green; cumulative test count comparison in CLOSEOUT vs Plan 04 baseline
9. `bun typecheck` exits 0 across all 6 packages

# Success Criteria

This plan IS the Phase 5 closeout. Success = phase closed.

- 5/5 SCs green
- 10 REQ-IDs flipped
- REPRODUCER.md exists with all pin hashes
- scripts/reproduce_eval.sh executable + lane discipline working
- Daily-driver default unchanged (D-10)
- Phase 6 unblocked (speculative decoding can now consume the eval harness)
- Phase 7 unblocked (publication-grade reproducer script + manifest already exist)
- Research-artifact bar — REACHED

# Output

The closeout IS the output. After Tasks 1-4, this plan is complete; no further SUMMARY needed beyond the inline 05-CLOSEOUT.md.

Final orchestrator-visible signal: post-commit, the user gets:
- `git log --oneline | head -10` shows the closeout commit
- `cat .planning/STATE.md | head -20` shows Phase 5 marked Closed
- `cat .planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CLOSEOUT.md` is the Phase 5 narrative
- `cat eval/REPRODUCER.md` is the research-artifact-bar manifest
