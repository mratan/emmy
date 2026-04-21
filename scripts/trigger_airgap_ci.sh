#!/usr/bin/env bash
# scripts/trigger_airgap_ci.sh — Plan 01-08 SC-4 certification trigger.
#
# Touches air_gap/README.md (in .github/workflows/airgap.yml path filters),
# commits + pushes the current branch, and prints the PR URL so the operator
# can observe the airgap workflow run on the self-hosted DGX Spark runner.
#
# Prerequisites (enforced by this script):
#   - Working tree is clean.
#   - Current branch is NOT main.
#   - Upstream is configured, or `git push -u origin HEAD` is used on first push.
#   - Self-hosted runner already registered per docs/ci-runner.md §1-§7.
#
# Usage: ./scripts/trigger_airgap_ci.sh
#
# See docs/airgap-green-run.md for the full runbook and docs/ci-runner.md §8
# for the certification flow overview.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# --- Pre-flight: clean working tree ---
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

# --- Pre-flight: refuse on main branch ---
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "main" ]]; then
  echo "ERROR: refusing to trigger from main branch. Create a feature branch first:" >&2
  echo "       git checkout -b sc4-airgap-certification" >&2
  exit 1
fi

# --- Pre-flight: upstream configured? ---
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  push_args=()
else
  echo "NOTE: no upstream for branch '$branch'; will push with -u origin HEAD." >&2
  push_args=(-u origin HEAD)
fi

# --- Pre-flight: target file exists ---
readme="air_gap/README.md"
if [[ ! -f "$readme" ]]; then
  echo "ERROR: $readme not found — Plan 01-05 should have created it." >&2
  exit 1
fi

# --- Edit: append a timestamped marker (idempotent across re-runs) ---
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
marker="<!-- sc4-ci-trigger: $ts -->"
{
  echo ""
  echo "$marker"
} >> "$readme"

# --- Commit + push ---
git add "$readme"
git commit -m "chore(ci): trigger airgap workflow for SC-4 certification ($ts)"
git push "${push_args[@]}"

# --- Print PR / workflow URL ---
if command -v gh >/dev/null 2>&1; then
  pr_url="$(gh pr view --json url -q .url 2>/dev/null || true)"
  if [[ -z "$pr_url" ]]; then
    # No PR yet — create one
    gh pr create --fill
    pr_url="$(gh pr view --json url -q .url)"
  fi
  run_url="$(gh run list --branch "$branch" --workflow airgap.yml --limit 1 --json url -q '.[0].url' 2>/dev/null || echo '')"
  echo
  echo "PR URL:        $pr_url"
  if [[ -n "$run_url" ]]; then
    echo "Workflow URL:  $run_url"
  else
    echo "Workflow URL:  (not yet queued; poll with: gh run list --branch $branch --workflow airgap.yml)"
  fi
  echo
  echo "Once the airgap-replay job completes, run:"
  echo "  ./scripts/verify_airgap_ci.sh"
else
  echo
  echo "NOTE: 'gh' CLI not installed; open the GitHub UI and create the PR manually."
  echo "After the airgap-replay job completes, run:"
  echo "  ./scripts/verify_airgap_ci.sh --from-file <path-to-downloaded-airgap-report.json>"
fi
