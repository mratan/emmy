#!/bin/bash
# V-protocol matrix runner for Mistral 128B NVFP4 v2.
#
# Runs V1 (20 tasks) + V3 (5 probes), captures per-task:
#   - JSONL transcript (copied from runs/phase2-sc3-capture/session-*.jsonl)
#   - stdout/stderr to taskNN.log / probeN.log
#   - timings.tsv: task,start_ts,end_ts,duration_s,exit_code
#
# Lift all timeouts. No --kill-after on tasks. Per operator: don't stop for
# anything except a real crash; run the full suite.

set -uo pipefail

REPO=/data/projects/emmy
cd "$REPO"

V1_RUNS_DIR="$REPO/runs/v1-matrix-mistral-128b-nvfp4"
V3_RUNS_DIR="$REPO/runs/v3-matrix-mistral-128b-nvfp4"
PROFILE="$REPO/profiles/mistral-medium-3.5/v2"
BASE_URL="http://127.0.0.1:8005"
TRANSCRIPT_DIR="$REPO/runs/phase2-sc3-capture"

mkdir -p "$V1_RUNS_DIR" "$V3_RUNS_DIR"
: > "$V1_RUNS_DIR/timings.tsv"
: > "$V3_RUNS_DIR/timings.tsv"
echo -e "task\tstart_ts\tend_ts\tduration_s\texit_code\ttranscript" > "$V1_RUNS_DIR/timings.tsv"
echo -e "probe\tstart_ts\tend_ts\tduration_s\texit_code\ttranscript" > "$V3_RUNS_DIR/timings.tsv"

# ============================================================
# V1 — 20 tasks, fresh sessions, accumulating memory
# ============================================================
# Memory-clean before task 1 ONLY (per OPERATOR-PROTOCOLS V1).
# We do this ONCE at the head of V1; tasks 2..20 inherit accumulated state.

echo "===== V1 setup: snapshot + clean memory roots =====" | tee -a "$V1_RUNS_DIR/runner.log"

V1_MEM_BACKUP="$V1_RUNS_DIR/_pre_v1_memory_snapshot"
mkdir -p "$V1_MEM_BACKUP"
[ -d "$REPO/.emmy/notes" ] && cp -r "$REPO/.emmy/notes" "$V1_MEM_BACKUP/.emmy-notes" 2>/dev/null || true
[ -d "$HOME/.emmy/memory" ] && cp -r "$HOME/.emmy/memory" "$V1_MEM_BACKUP/home-emmy-memory" 2>/dev/null || true

rm -rf "$REPO/.emmy/notes"
mkdir -p "$REPO/.emmy/notes"
rm -rf "$HOME/.emmy/memory"
mkdir -p "$HOME/.emmy/memory"

# Read all 20 tasks
mapfile -t TASKS < .planning/phases/04.4-filesystem-memory-tool-append-only-prefix-compaction-polish-/runs/v1-adoption-v2/v1-tasks.txt

if [ "${#TASKS[@]}" -ne 20 ]; then
  echo "WARN: expected 20 tasks, got ${#TASKS[@]}" | tee -a "$V1_RUNS_DIR/runner.log"
fi

for i in "${!TASKS[@]}"; do
  N=$(printf "%02d" $((i+1)))
  TASK="${TASKS[$i]}"
  if [ -z "$TASK" ]; then
    echo "WARN: task $N is empty, skipping" | tee -a "$V1_RUNS_DIR/runner.log"
    continue
  fi
  echo "===== V1 task $N: $TASK =====" | tee -a "$V1_RUNS_DIR/runner.log"
  START=$(date -u +%s)
  START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  bun packages/emmy-ux/bin/pi-emmy.ts \
    --profile "$PROFILE" \
    --base-url "$BASE_URL" \
    --print "$TASK" > "$V1_RUNS_DIR/task$N.log" 2>&1
  RC=$?
  END=$(date -u +%s)
  END_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  DUR=$((END - START))

  # Copy the latest session transcript
  LATEST=$(ls -t "$TRANSCRIPT_DIR"/session-*.jsonl 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    cp "$LATEST" "$V1_RUNS_DIR/task$N.jsonl"
    TRANSCRIPT_NAME=$(basename "$LATEST")
  else
    TRANSCRIPT_NAME="MISSING"
  fi

  echo -e "task$N\t$START_ISO\t$END_ISO\t${DUR}\t$RC\t$TRANSCRIPT_NAME" >> "$V1_RUNS_DIR/timings.tsv"
  echo "  done: rc=$RC duration=${DUR}s transcript=$TRANSCRIPT_NAME" | tee -a "$V1_RUNS_DIR/runner.log"
done

echo "===== V1 batch complete =====" | tee -a "$V1_RUNS_DIR/runner.log"

# ============================================================
# V3 — 5 probes against /tmp/v3-rot-test/ (fixture pre-planted)
# ============================================================
# Each probe is a FRESH session in the rot-test workspace; the planted notes
# are in $V3_PROJECT/.emmy/notes/, source-of-truth code is in $V3_PROJECT/src/.

V3_PROJECT=/tmp/v3-rot-test

# Verify fixture is in place
if [ ! -f "$V3_PROJECT/.emmy/notes/api-format.md" ] || [ ! -f "$V3_PROJECT/src/api/handler.ts" ]; then
  echo "FATAL: V3 fixture missing — run /tmp/v3-rot-fixture-setup.sh first" | tee -a "$V3_RUNS_DIR/runner.log"
  exit 2
fi

# Same global-memory-clean discipline (~/.emmy/memory still holds V1's accumulated state).
# For V3 we rely on the project-scoped notes inside $V3_PROJECT — global memory
# from V1 doesn't reference these specific contradicting topics, so leave it.

declare -a V3_PROBES=(
  "What's the JSON field convention here? Should I use camelCase or snake_case?"
  "What signing algorithm does src/auth.ts use?"
  "What's the max database connections this app uses?"
  "How do I enable debug logging in this app?"
  "What's the user-creation endpoint path?"
)

for i in "${!V3_PROBES[@]}"; do
  N=$((i+1))
  PROBE="${V3_PROBES[$i]}"
  echo "===== V3 probe $N: $PROBE =====" | tee -a "$V3_RUNS_DIR/runner.log"
  START=$(date -u +%s)
  START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  (
    cd "$V3_PROJECT"
    bun "$REPO/packages/emmy-ux/bin/pi-emmy.ts" \
      --profile "$PROFILE" \
      --base-url "$BASE_URL" \
      --print "$PROBE"
  ) > "$V3_RUNS_DIR/probe$N.log" 2>&1
  RC=$?
  END=$(date -u +%s)
  END_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  DUR=$((END - START))

  # Pi-emmy writes transcripts to $V3_PROJECT/runs/phase2-sc3-capture/ when run from cwd
  LATEST=$(ls -t "$V3_PROJECT"/runs/phase2-sc3-capture/session-*.jsonl 2>/dev/null | head -1)
  if [ -z "$LATEST" ]; then
    LATEST=$(ls -t "$TRANSCRIPT_DIR"/session-*.jsonl 2>/dev/null | head -1)
  fi
  if [ -n "$LATEST" ]; then
    cp "$LATEST" "$V3_RUNS_DIR/probe$N.jsonl"
    TRANSCRIPT_NAME=$(basename "$LATEST")
  else
    TRANSCRIPT_NAME="MISSING"
  fi

  echo -e "probe$N\t$START_ISO\t$END_ISO\t${DUR}\t$RC\t$TRANSCRIPT_NAME" >> "$V3_RUNS_DIR/timings.tsv"
  echo "  done: rc=$RC duration=${DUR}s transcript=$TRANSCRIPT_NAME" | tee -a "$V3_RUNS_DIR/runner.log"
done

echo "===== V3 batch complete =====" | tee -a "$V3_RUNS_DIR/runner.log"

# ============================================================
# RESTORE V1 memory snapshot (V1 mutated the operator's notes/memory)
# ============================================================

echo "===== Restoring V1 memory snapshot =====" | tee -a "$V1_RUNS_DIR/runner.log"
rm -rf "$REPO/.emmy/notes" "$HOME/.emmy/memory"
[ -d "$V1_MEM_BACKUP/.emmy-notes" ] && cp -r "$V1_MEM_BACKUP/.emmy-notes" "$REPO/.emmy/notes" 2>/dev/null || mkdir -p "$REPO/.emmy/notes"
[ -d "$V1_MEM_BACKUP/home-emmy-memory" ] && cp -r "$V1_MEM_BACKUP/home-emmy-memory" "$HOME/.emmy/memory" 2>/dev/null || mkdir -p "$HOME/.emmy/memory"

echo "===== ALL DONE =====" | tee -a "$V1_RUNS_DIR/runner.log"
echo "V1 timings: $V1_RUNS_DIR/timings.tsv"
echo "V3 timings: $V3_RUNS_DIR/timings.tsv"
