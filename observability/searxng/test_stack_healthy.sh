#!/usr/bin/env bash
# observability/searxng/test_stack_healthy.sh
#
# Plan 03.1-02 Task 1 — SearxNG stack-healthy probe.
#
# 20-line smoke test used by:
#   (1) scripts/start_searxng.sh health-gate internal loop
#   (2) operator-driven Task 3 walkthrough
#
# Exit codes:
#   0 — searxng container running AND /search?format=json returns JSON with .results array
#   1 — container missing OR /search HTTP non-2xx OR body missing .results

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/observability/searxng/docker-compose.yaml"
SEARXNG_URL="${SEARXNG_URL:-http://127.0.0.1:8888}"

# 1. Container is running (compose ps says running + healthy if healthcheck defined)
if ! docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
		| grep -q '"Service":"searxng"'; then
	echo "searxng: container not running" >&2
	exit 1
fi

# 2. JSON endpoint returns an object with .results (array, non-empty)
#    Use --fail so curl exits non-zero on 5xx. Pipe into python for JSON check;
#    python is universally present on the Spark.
BODY="$(curl -sf "${SEARXNG_URL}/search?q=ping&format=json" || true)"
if [[ -z "$BODY" ]]; then
	echo "searxng: empty body from /search?format=json" >&2
	exit 1
fi
if ! echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d.get("results"), list)' 2>/dev/null; then
	echo "searxng: /search JSON missing .results array" >&2
	exit 1
fi

echo "searxng: healthy"
exit 0
