#!/usr/bin/env bash
# scripts/start_searxng.sh — Phase 3.1 Plan 03.1-02 (D-33).
#
# Bring up the SearxNG docker stack (searxng + own redis) and gate on both
# services becoming healthy. On first boot, copies
# observability/searxng/.env.example → .env and fills SEARXNG_SECRET_KEY with
# `openssl rand -hex 32`. Also expands settings.template.yml → settings.yml
# using that secret.
#
# Usage:
#   ./scripts/start_searxng.sh
#
# Exit codes:
#   0 - both services up, web_search tool can talk to SearxNG
#   1 - health gate timed out after 90s; actionable message + ps dump
#   4 - prerequisite missing (docker compose, openssl, python3)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="observability/searxng/docker-compose.yaml"
ENV_EXAMPLE="observability/searxng/.env.example"
ENV_FILE="observability/searxng/.env"
SETTINGS_TEMPLATE="observability/searxng/settings.template.yml"
SETTINGS_FILE="observability/searxng/settings.yml"

# --- 1. Pre-flight ---
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR (prereq): docker not installed" >&2; exit 4
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR (prereq): docker compose v2 not installed" >&2; exit 4
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR (prereq): openssl not installed (needed to generate SEARXNG_SECRET_KEY)" >&2; exit 4
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR (prereq): python3 not installed (used by compose ps JSON parser)" >&2; exit 4
fi

# --- 2. Generate .env on first boot ---
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "ERROR: $ENV_EXAMPLE missing; cannot bootstrap $ENV_FILE" >&2; exit 1
  fi
  echo "searxng: generating $ENV_FILE from $ENV_EXAMPLE (first boot)" >&2
  SECRET=$(openssl rand -hex 32)
  # Replace CHANGEME in a single line. openssl hex output is [0-9a-f] only →
  # safe for sed without escape gymnastics.
  sed -e "s/CHANGEME/${SECRET}/" "$ENV_EXAMPLE" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "searxng: generated secret in $ENV_FILE (mode 600)" >&2
fi

# --- 3. Expand settings template → settings.yml ---
# settings.yml is read-only mounted into the container (T-03.1-02-05). We
# rebuild it on every start so secret rotation is as simple as deleting .env
# and re-running this script.
echo "searxng: expanding settings.template.yml → settings.yml" >&2
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
# envsubst requires the package; use a pure-python fallback so operators on a
# minimal image don't need gettext installed. Substitutes ${SEARXNG_SECRET_KEY}
# verbatim.
python3 - "$SETTINGS_TEMPLATE" "$SETTINGS_FILE" <<'EOF'
import os, sys
template_path, output_path = sys.argv[1], sys.argv[2]
with open(template_path, encoding="utf-8") as f:
    txt = f.read()
secret = os.environ["SEARXNG_SECRET_KEY"]
txt = txt.replace("${SEARXNG_SECRET_KEY}", secret)
with open(output_path, "w", encoding="utf-8") as f:
    f.write(txt)
EOF
chmod 600 "$SETTINGS_FILE"

# --- 4. docker compose up -d ---
echo "searxng: docker compose up -d" >&2
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

# --- 5. Health gate (90s timeout; poll every 2s) ---
echo "searxng: waiting for services to become healthy (up to 90s)..." >&2
DEADLINE=$(( $(date +%s) + 90 ))
EXPECTED_SERVICES=2
while true; do
  PS_JSON="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format json)"
  if [[ -z "$PS_JSON" ]]; then
    HEALTHY_COUNT=0
  else
    HEALTHY_COUNT=$(echo "$PS_JSON" | python3 -c '
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
  fi
  if [[ "$HEALTHY_COUNT" == "$EXPECTED_SERVICES" ]]; then
    echo "searxng: all ${EXPECTED_SERVICES} services healthy" >&2
    break
  fi
  if (( $(date +%s) >= DEADLINE )); then
    echo "ERROR: health gate timed out after 90s — only ${HEALTHY_COUNT}/${EXPECTED_SERVICES} healthy" >&2
    echo "--- docker compose ps ---" >&2
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps >&2 || true
    exit 1
  fi
  sleep 2
done

# --- 6. Next-steps banner ---
cat <<EOF >&2

[emmy] SearxNG ready at http://127.0.0.1:8888

Smoke test:
  curl -s 'http://127.0.0.1:8888/search?q=bun+runtime&format=json' | jq '.results | length'

Teardown (preserves Redis cache):
  bash scripts/stop_searxng.sh
Teardown + wipe cache:
  bash scripts/stop_searxng.sh --volumes

Kill-switches:
  export EMMY_WEB_SEARCH=off   # pi-emmy will NOT register web_search tool
  export EMMY_TELEMETRY=off    # observability off + web_search off
EOF

exit 0
