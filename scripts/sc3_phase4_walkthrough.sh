#!/usr/bin/env bash
# Phase 4 SC-3 walkthrough: exercise within-model role routing live on DGX Spark.
#
# Fires four pi-emmy --print invocations with prompts crafted to trigger each
# role classifier branch (plan / edit / critic / default). After each, scans
# the resulting events.jsonl for emmy.profile.variant + emmy.role attributes
# and asserts the routing matches routes.yaml.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.bun/bin:$PATH"
RUN_DIR="runs/phase4-sc3/walkthrough-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN_DIR"
REPORT_JSON="$RUN_DIR/report.json"

# Routes.yaml pins (must match the shipped file; any change breaks SC-3).
DEFAULT_VARIANT="v2.1"
PLAN_VARIANT="v2.1"
EDIT_VARIANT="v2.1"
CRITIC_VARIANT="v2.1"

echo "[sc3] Phase 4 SC-3 walkthrough — within-model role routing"
echo "[sc3] Run dir: $RUN_DIR"
echo "[sc3] Base profile: profiles/gemma-4-26b-a4b-it/v2.1/"
echo "[sc3] vLLM endpoint: http://127.0.0.1:8002 (gemma-4-26B-A4B-it)"
echo ""

# Sanity: Qwen is up
if ! curl -sS -m 3 http://127.0.0.1:8002/v1/models | grep -q gemma-4-26b-a4b-it; then
  echo "[sc3] FATAL: Qwen3.6 not responding on :8002" >&2
  exit 1
fi

# Four prompts, one per role classifier branch. Keep short so --print
# completes fast and the generation itself is not the bottleneck.
declare -A PROMPTS
PROMPTS[1_plan]="plan: outline three steps to write a python cli that lists directory sizes"
PROMPTS[2_edit]="edit README.md to add a line that says hello"
PROMPTS[3_critic]="review the following pseudocode for bugs: def sub(a,b): return a+b"
PROMPTS[4_default]="hello, what is two plus two"

declare -A EXPECTED_ROLE
EXPECTED_ROLE[1_plan]="plan"
EXPECTED_ROLE[2_edit]="edit"
EXPECTED_ROLE[3_critic]="critic"
EXPECTED_ROLE[4_default]="default"

declare -A EXPECTED_VARIANT
EXPECTED_VARIANT[1_plan]="$PLAN_VARIANT"
EXPECTED_VARIANT[2_edit]="$EDIT_VARIANT"
EXPECTED_VARIANT[3_critic]="$CRITIC_VARIANT"
EXPECTED_VARIANT[4_default]="$DEFAULT_VARIANT"

RESULTS_JSON="["
FIRST_RESULT=1
ALL_PASS=1

for KEY in 1_plan 2_edit 3_critic 4_default; do
  PROMPT="${PROMPTS[$KEY]}"
  EXPECTED_R="${EXPECTED_ROLE[$KEY]}"
  EXPECTED_V="${EXPECTED_VARIANT[$KEY]}"

  echo "[sc3] --- Turn $KEY ---"
  echo "[sc3] prompt: $PROMPT"
  echo "[sc3] expected: role=$EXPECTED_R variant=$EXPECTED_V"

  TURN_OUT="$RUN_DIR/turn-$KEY.stdout.log"
  TURN_ERR="$RUN_DIR/turn-$KEY.stderr.log"

  # Capture pre-run events.jsonl inventory so we can find the new session dir
  SESSIONS_BEFORE=$(ls -d runs/2026-*-sha256:* 2>/dev/null | wc -l)

  timeout 120 bun run packages/emmy-ux/bin/pi-emmy.ts \
    --profile profiles/gemma-4-26b-a4b-it/v2.1 \
    --base-url http://127.0.0.1:8002 \
    --print "$PROMPT" \
    > "$TURN_OUT" 2> "$TURN_ERR" || {
      echo "[sc3] WARN: pi-emmy returned non-zero; checking events.jsonl anyway"
    }

  # Locate the newly-created session dir (most recent one matching the pattern)
  NEW_SESSION=$(ls -td runs/2026-*-sha256:* 2>/dev/null | head -1)
  if [[ -z "$NEW_SESSION" ]]; then
    echo "[sc3] FAIL: no new session dir found after turn $KEY"
    ALL_PASS=0
    continue
  fi
  EVENTS="$NEW_SESSION/events.jsonl"
  if [[ ! -f "$EVENTS" ]]; then
    echo "[sc3] FAIL: events.jsonl missing at $EVENTS"
    ALL_PASS=0
    continue
  fi

  # Extract emmy.profile.variant + emmy.role attrs from ANY span in the JSONL.
  # (They appear on harness.assembly events and other span-backed emissions.)
  OBSERVED_ROLE=$(grep -oE '"emmy\.role":"[^"]*"' "$EVENTS" | head -1 | sed 's|.*"emmy\.role":"\([^"]*\)".*|\1|')
  OBSERVED_VARIANT=$(grep -oE '"emmy\.profile\.variant":"[^"]*"' "$EVENTS" | head -1 | sed 's|.*"emmy\.profile\.variant":"\([^"]*\)".*|\1|')

  # Also scan for harness.assembly / chat.request events that should carry these.
  ASSEMBLY_COUNT=$(grep -c '"harness.assembly"\|"chat.request"' "$EVENTS" 2>/dev/null || echo 0)
  TOTAL_EVENTS=$(wc -l < "$EVENTS" | tr -d ' ')

  echo "[sc3]   events.jsonl: $EVENTS  ($TOTAL_EVENTS events)"
  echo "[sc3]   observed role: '${OBSERVED_ROLE:-<none>}'  variant: '${OBSERVED_VARIANT:-<none>}'"

  if [[ "$OBSERVED_ROLE" == "$EXPECTED_R" ]] && [[ "$OBSERVED_VARIANT" == "$EXPECTED_V" ]]; then
    STATUS="PASS"
    echo "[sc3]   PASS"
  else
    STATUS="FAIL"
    ALL_PASS=0
    echo "[sc3]   FAIL (expected role=$EXPECTED_R variant=$EXPECTED_V)"
  fi

  # Copy the events.jsonl into the walkthrough dir so the evidence is co-located
  cp "$EVENTS" "$RUN_DIR/turn-$KEY.events.jsonl"

  if [[ $FIRST_RESULT -eq 0 ]]; then RESULTS_JSON+=","; fi
  FIRST_RESULT=0
  RESULTS_JSON+=$(cat <<JSONITEM
{
  "turn": "$KEY",
  "prompt": $(echo "$PROMPT" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read().strip()))'),
  "expected_role": "$EXPECTED_R",
  "expected_variant": "$EXPECTED_V",
  "observed_role": "${OBSERVED_ROLE:-}",
  "observed_variant": "${OBSERVED_VARIANT:-}",
  "assembly_event_count": $ASSEMBLY_COUNT,
  "total_events": $TOTAL_EVENTS,
  "events_jsonl": "$RUN_DIR/turn-$KEY.events.jsonl",
  "status": "$STATUS"
}
JSONITEM
)
  echo ""
done

RESULTS_JSON+="]"
echo "$RESULTS_JSON" | python3 -m json.tool > "$REPORT_JSON"

echo "[sc3] --- Summary ---"
cat "$REPORT_JSON"
echo ""

if [[ $ALL_PASS -eq 1 ]]; then
  echo "[sc3] VERDICT: sc3 phase4 green"
  exit 0
else
  echo "[sc3] VERDICT: FAIL (see $REPORT_JSON)"
  exit 2
fi
