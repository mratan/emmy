#!/usr/bin/env bash
# observability/langfuse/test_stack_healthy.sh — Phase 3 Plan 03-02 Task 1 verification.
#
# Assert that the Langfuse v3 compose stack is up and all 6 services are
# either healthy (healthcheck defined) or running (no healthcheck). This
# script is invoked by the Wave-0 test scaffold OR directly by the operator
# after `scripts/start_observability.sh` returns.
#
# Exit codes:
#   0 - all 6 services up
#   1 - fewer than 6 running/healthy services

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="observability/langfuse/docker-compose.yaml"
ENV_FILE="observability/langfuse/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE missing; run scripts/start_observability.sh first" >&2
  exit 1
fi

# Enumerate service states via JSON. Count services where State=running AND
# (Health empty OR Health=healthy). Expect exactly 6.
PS_JSON="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format json)"
if [[ -z "$PS_JSON" ]]; then
  echo "ERROR: compose stack is not up (docker compose ps returned empty)" >&2
  exit 1
fi

COUNT=$(echo "$PS_JSON" | python3 -c '
import sys, json
c = 0
for line in sys.stdin:
  line = line.strip()
  if not line: continue
  try:
    obj = json.loads(line)
  except Exception:
    continue
  state = obj.get("State") or obj.get("state") or ""
  health = obj.get("Health") or obj.get("health") or ""
  if state == "running" and (health == "" or health == "healthy"):
    c += 1
print(c)
')

if [[ "$COUNT" -ne 6 ]]; then
  echo "ERROR: expected 6 healthy services, got $COUNT" >&2
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps >&2 || true
  exit 1
fi

echo "observability: all 6 services running/healthy" >&2
exit 0
