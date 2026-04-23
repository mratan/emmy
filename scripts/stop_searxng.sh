#!/usr/bin/env bash
# scripts/stop_searxng.sh — Phase 3.1 Plan 03.1-02 (D-33).
#
# Bring down the SearxNG docker stack. Redis cache volume preserved by
# default; pass --volumes to also wipe.
#
# Usage:
#   ./scripts/stop_searxng.sh            # preserve cache
#   ./scripts/stop_searxng.sh --volumes  # also wipe cache

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="observability/searxng/docker-compose.yaml"
ENV_FILE="observability/searxng/.env"

WIPE_VOLUMES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --volumes) WIPE_VOLUMES=1; shift ;;
    -h|--help)
      sed -n '1,15p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

ENV_FILE_ARG=()
if [[ -f "$ENV_FILE" ]]; then
  ENV_FILE_ARG=(--env-file "$ENV_FILE")
fi

if [[ "$WIPE_VOLUMES" = "1" ]]; then
  echo "searxng: docker compose down --volumes (CACHE WIPED)" >&2
  docker compose "${ENV_FILE_ARG[@]}" -f "$COMPOSE_FILE" down --volumes
else
  echo "searxng: docker compose down (cache preserved)" >&2
  docker compose "${ENV_FILE_ARG[@]}" -f "$COMPOSE_FILE" down
fi

echo "searxng: stopped" >&2
exit 0
