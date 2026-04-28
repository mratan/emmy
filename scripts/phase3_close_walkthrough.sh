#!/usr/bin/env bash
# scripts/phase3_close_walkthrough.sh
#
# Phase 3 CLOSEOUT walkthrough driver — runs the SC-1-class Track B
# walkthrough against the v3 profile with all 5 Phase-3 surfaces live:
#   - Plan 03-01 wire-through (provider / tools / prompt / enable_thinking / grammar)
#   - Plan 03-02 Langfuse OTel dual-sink + EmmyProfileStampProcessor
#   - Plan 03-03 compaction trigger (soft threshold + D-14 preservation)
#   - Plan 03-04 TUI footer (GPU/KV/spec-accept/tok/s)
#   - Plan 03-05 Alt+Up/Down rating → feedback.jsonl → --export-hf
#   - Plan 03-06 OFFLINE OK badge + web_fetch allowlist enforcement
#
# Per 03-07-PLAN.md Task 3, this is the phase-close verdict driver. Invoked
# after emmy-serve + Langfuse stack are up and the operator is ready to drive
# an interactive pi-emmy session.
#
# Usage:
#   bash scripts/phase3_close_walkthrough.sh [--no-telemetry] [--workdir PATH]
#
# Environment:
#   EMMY_BASE_URL   — emmy-serve endpoint (default: http://127.0.0.1:8002)
#   EMMY_PROFILE    — profile name (default: gemma-4-26b-a4b-it@v3)
#
# Prereqs:
#   1. emmy-serve running on EMMY_BASE_URL (bash scripts/start_emmy.sh)
#   2. Langfuse stack up (bash scripts/start_observability.sh) — OR run with
#      --no-langfuse to exercise JSONL-only dual-sink fallback
#   3. pi-emmy on PATH (bun link in packages/emmy-ux)
#
# Exit codes:
#   0 — walkthrough completed; verify in the TUI + Langfuse UI per the
#       7-criterion gate in plan Task 3
#   1 — prereq failure (endpoint unreachable, pi-emmy missing)

set -euo pipefail

WORKDIR="${WORKDIR:-/tmp/emmy-p3-close-walkthrough}"
EMMY_BASE_URL="${EMMY_BASE_URL:-http://127.0.0.1:8002}"
EMMY_PROFILE="${EMMY_PROFILE:-gemma-4-26b-a4b-it@v3}"
TELEMETRY_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-telemetry) TELEMETRY_FLAG="--no-telemetry"; shift ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,35p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

# Prereq: pi-emmy on PATH
if ! command -v pi-emmy >/dev/null 2>&1; then
  echo "ERROR: pi-emmy not on PATH. Run 'bun link' from packages/emmy-ux." >&2
  exit 1
fi

# Prereq: emmy-serve reachable
if ! curl -s -m 2 -o /dev/null "${EMMY_BASE_URL}/v1/models"; then
  echo "ERROR: emmy-serve not reachable at ${EMMY_BASE_URL}" >&2
  echo "  Run: bash scripts/start_emmy.sh" >&2
  exit 1
fi

# Fresh workdir
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"
git init -q
echo "# Phase 3 CLOSEOUT walkthrough" > README.md
git add -A
git commit -q -m "init"

echo "phase3_close_walkthrough: profile=${EMMY_PROFILE}, base_url=${EMMY_BASE_URL}, workdir=${WORKDIR}"
echo "telemetry_flag: ${TELEMETRY_FLAG:-<none>}"
echo ""
echo "Launch pi-emmy interactively:"
echo "  cd ${WORKDIR}"
echo "  EMMY_PROFILE=${EMMY_PROFILE} pi-emmy ${TELEMETRY_FLAG}"
echo ""
echo "Operator verify (7-criterion gate):"
echo "  1. Boot banner shows: telemetry=JSONL+Langfuse (or JSONL-only) + OFFLINE OK (green)"
echo "  2. TUI footer shows: [GPU N% • KV N% • spec accept - • tok/s N] at 1 Hz"
echo "  3. Issue multi-file task → agent completes using read+edit+bash+write"
echo "  4. Alt+Up after completion → feedback.jsonl updated with profile_version=v3"
echo "  5. Langfuse UI (http://localhost:3000/traces) shows session with profile.hash=<v3>"
echo "  6. ss -tnp state established | grep -v '127\\.\\|::1' returns empty (no outbound)"
echo "  7. bash scripts/sc2_200turn_compaction.sh --mode=stub --variant={default,alternate,disabled}"
echo "     all exit 0 (stub-mode matrix; live matrix operator-gated)"
echo ""
echo "Resume signal when all 7 green: 'sc1 phase3 green'"
