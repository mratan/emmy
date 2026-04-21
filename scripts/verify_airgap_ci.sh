#!/usr/bin/env bash
# scripts/verify_airgap_ci.sh — Plan 01-08 SC-4 certification verifier.
#
# Downloads the airgap-report artifact from the most recent workflow run on
# the current branch (via `gh run download`), validates via the Python helper
# emmy_serve.airgap.ci_verify, and exits 0 iff passes=true + 4 layers green.
#
# Usage:
#   ./scripts/verify_airgap_ci.sh                         # auto-download via gh
#   ./scripts/verify_airgap_ci.sh --from-file <path>      # manual fallback
#
# Exit codes propagate from emmy_serve.airgap.ci_verify:
#   0 — green artifact (passes=true + 4 layers green + failures=[])
#   1 — red artifact (validation failed)
#   2 — file-not-found / JSON decode / gh CLI missing / artifact missing
#
# See docs/airgap-green-run.md for the full runbook.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mode="gh"
from_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-file)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --from-file requires a path argument" >&2
        exit 2
      fi
      mode="file"
      from_file="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$mode" == "gh" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: 'gh' CLI not installed. Install gh OR use --from-file <path>." >&2
    exit 2
  fi
  branch="$(git rev-parse --abbrev-ref HEAD)"
  run_id="$(gh run list --branch "$branch" --workflow airgap.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  if [[ -z "$run_id" ]]; then
    echo "ERROR: no airgap.yml run found for branch '$branch'. Run scripts/trigger_airgap_ci.sh first." >&2
    exit 2
  fi
  outdir="$(mktemp -d -t airgap-report-XXXXXX)"
  echo "downloading airgap-report artifact from run $run_id -> $outdir"
  if ! gh run download "$run_id" --name airgap-report --dir "$outdir"; then
    echo "ERROR: gh run download failed — artifact 'airgap-report' may not exist yet (job still running?)" >&2
    exit 2
  fi
  # Workflow uploads runs/ci-airgap/ directory; airgap-report.json lives at top level of the upload.
  from_file="$(find "$outdir" -name 'airgap-report.json' -print -quit)"
  if [[ -z "$from_file" ]]; then
    echo "ERROR: airgap-report.json not found in downloaded artifact. Inspect $outdir manually." >&2
    exit 2
  fi
fi

echo "validating $from_file"
uv run python3 -m emmy_serve.airgap.ci_verify --from-file "$from_file"
