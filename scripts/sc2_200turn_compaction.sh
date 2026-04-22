#!/usr/bin/env bash
# Phase 3 Plan 03-03 Task 3 — SC-2 200-turn compaction runner wrapper.
#
# Usage:
#   scripts/sc2_200turn_compaction.sh [--mode=stub|live] [--variant=default|alternate|disabled]
#
# Modes:
#   --mode=stub     default. Uses an in-script stub summarize() — no GPU, no
#                   HTTP. Suitable for CI and the Plan 03-03 green gate.
#   --mode=live     reserved for Plan 03-07 live-variant matrix. Falls back
#                   to stub behavior in Plan 03-03 (Plan 03-07 replaces).
#
# Variants (supports Plan 03-07 3-run matrix / Pitfall #5 guard):
#   --variant=default    reads profile's prompts/compact.md (D-13 default).
#   --variant=alternate  reads prompts/compact.alternate.md (Plan 03-07 Task 1
#                        creates this stub; Plan 03-03 falls back to default
#                        when missing).
#   --variant=disabled   forces compaction config to null; runner asserts
#                        {ran:false} + no SessionTooFullError at this
#                        fixture's ~35K-token-at-end sufficiency.
#
# Output:
#   runs/phase3-sc2/                         (mode=stub + variant=default alias)
#   runs/phase3-sc2-${MODE}-${VARIANT}/       (all other combinations)
#   Each with report.json + events.jsonl + fixture.jsonl.sha256.
#
# Exit code:
#   0 on verdict=pass
#   1 on verdict=fail
#   2 on runner crash or bad args

set -euo pipefail

MODE="stub"
VARIANT="default"
for arg in "$@"; do
	case "$arg" in
		--mode=*) MODE="${arg#*=}" ;;
		--variant=*) VARIANT="${arg#*=}" ;;
		*)
			echo "sc2_200turn_compaction: unknown arg $arg" >&2
			exit 2
			;;
	esac
done

case "$MODE" in
	stub | live) ;;
	*)
		echo "sc2_200turn_compaction: invalid --mode=$MODE (expected stub|live)" >&2
		exit 2
		;;
esac

case "$VARIANT" in
	default | alternate | disabled) ;;
	*)
		echo "sc2_200turn_compaction: invalid --variant=$VARIANT (expected default|alternate|disabled)" >&2
		exit 2
		;;
esac

# Default out-dir matches the runner's builder: stub+default → runs/phase3-sc2
if [[ "$MODE" == "stub" && "$VARIANT" == "default" ]]; then
	OUT_DIR="runs/phase3-sc2"
else
	OUT_DIR="runs/phase3-sc2-${MODE}-${VARIANT}"
fi
mkdir -p "$OUT_DIR"

# Resolve bun from PATH or $HOME/.bun/bin (matches Phase 2/3 invocation style).
if ! command -v bun >/dev/null 2>&1; then
	if [[ -x "$HOME/.bun/bin/bun" ]]; then
		export PATH="$HOME/.bun/bin:$PATH"
	else
		echo "sc2_200turn_compaction: bun not found on PATH" >&2
		exit 2
	fi
fi

export EMMY_SC2_MODE="$MODE"
export EMMY_SC2_VARIANT="$VARIANT"

bun run eval/phase3/sc2-runner.ts \
	--mode="$MODE" \
	--variant="$VARIANT" \
	--out-dir="$OUT_DIR"

# Post-run verdict check via jq (if available). If jq is missing, grep-fallback.
if ! test -f "$OUT_DIR/report.json"; then
	echo "sc2_200turn_compaction: report.json missing at $OUT_DIR" >&2
	exit 2
fi

if command -v jq >/dev/null 2>&1; then
	jq -e '.verdict == "pass"' "$OUT_DIR/report.json" >/dev/null
else
	grep -q '"verdict": "pass"' "$OUT_DIR/report.json"
fi

echo "SC-2 verdict pass: mode=$MODE variant=$VARIANT out=$OUT_DIR"
