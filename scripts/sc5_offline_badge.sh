#!/usr/bin/env bash
# scripts/sc5_offline_badge.sh
#
# Phase 3 SC-5 — OFFLINE OK badge (UX-03) boot-green + red-flip demo driver.
# (Numbering: "SC-5" here refers to Phase 3's 5 success-criterion enumeration,
# not Phase 1's SC-5 throughput/thermal floor; Phase 3's ROADMAP success criteria
# are 1..5 per ROADMAP.md § Phase 3.)
#
# Exercises Plan 03-06's three states:
#   (a) boot-green — v3 profile with 5 doc-hosts allowlisted → stderr banner
#       prints "[emmy] OFFLINE OK" (green ANSI).
#   (b) per-call red flip — web_fetch to a non-allowlisted host during a live
#       session → badge flips to red "[emmy] NETWORK USED" + session continues
#       (D-28 warn-and-continue).
#   (c) EMMY_TELEMETRY=off does NOT suppress the badge (Plan 03-06 decision —
#       badge is UX, not telemetry).
#
# Usage:
#   bash scripts/sc5_offline_badge.sh [--workdir PATH]
#
# Per-state verification is documented in
# .planning/phases/03-observability-agent-loop-hardening-lived-experience/
# runs/p3-w3-walkthrough/03-06-badge.md (live-verified by orchestrator on DGX
# Spark); this script is the repeatable-driver surface for future runs.

set -euo pipefail

WORKDIR="${WORKDIR:-/tmp/emmy-p3-close-badge}"
EMMY_BASE_URL="${EMMY_BASE_URL:-http://127.0.0.1:8002}"
EMMY_PROFILE="${EMMY_PROFILE:-gemma-4-26b-a4b-it@v3}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir) WORKDIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,25p' "$0"
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

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "=== (a) Boot-green demo ==="
echo "  Run: EMMY_PROFILE=${EMMY_PROFILE} pi-emmy --print 'reply with the single word ok' 2>&1 | head -20"
echo "  Expect: stderr contains '[emmy] OFFLINE OK' in green ANSI (ESC[32m)."
echo "  Evidence: .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w3-walkthrough/03-06-boot-banner.log"
echo ""
echo "=== (b) Red-flip demo (interactive) ==="
echo "  Start interactive session; prompt pi-emmy to web_fetch a non-allowlisted URL (e.g. https://example.com)."
echo "  Expect: (i) tool returns WebFetchToolErrorResult (isError:true, agent continues)"
echo "           (ii) stderr logs 'tool.web_fetch.violation' emitEvent"
echo "           (iii) TUI badge flips to red '[emmy] NETWORK USED (web_fetch -> example.com)'"
echo "  Evidence: packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts (43 unit tests)"
echo ""
echo "=== (c) Kill-switch does NOT suppress badge ==="
echo "  Run: EMMY_TELEMETRY=off EMMY_PROFILE=${EMMY_PROFILE} pi-emmy --print 'hello' 2>&1 | head -20"
echo "  Expect: stderr contains '[emmy] OFFLINE OK' even though telemetry=OFF."
echo "          Demonstrates UX-as-first-class: badge is NOT telemetry-gated."
echo ""
echo "Resume signal when all 3 green: 'p3-06 badge green' (operator-gated)."
