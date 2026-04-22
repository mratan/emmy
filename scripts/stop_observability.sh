#!/usr/bin/env bash
# scripts/stop_observability.sh — Phase 3 Plan 03-02 (D-05).
#
# Bring down the Langfuse v3 self-hosted stack. Volumes are PRESERVED by
# default (so trace history survives restarts). Pass --volumes to also wipe
# langfuse_postgres_data + langfuse_clickhouse_data + langfuse_minio_data.
#
# Usage:
#   ./scripts/stop_observability.sh            # preserve volumes (default)
#   ./scripts/stop_observability.sh --volumes  # also wipe trace history

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="observability/langfuse/docker-compose.yaml"
ENV_FILE="observability/langfuse/.env"

WIPE_VOLUMES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --volumes) WIPE_VOLUMES=1; shift ;;
    -h|--help)
      sed -n '1,15p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# docker compose needs the env file to avoid "variable is not set" warnings
# even during `down` (for port-binding substitution). Use a placeholder file
# if the real one is missing (teardown must never require live secrets).
ENV_FILE_ARG=()
if [[ -f "$ENV_FILE" ]]; then
  ENV_FILE_ARG=(--env-file "$ENV_FILE")
fi

if [[ "$WIPE_VOLUMES" = "1" ]]; then
  echo "observability: docker compose down --volumes (TRACE HISTORY WILL BE LOST)" >&2
  docker compose "${ENV_FILE_ARG[@]}" -f "$COMPOSE_FILE" down --volumes
else
  echo "observability: docker compose down (volumes preserved)" >&2
  docker compose "${ENV_FILE_ARG[@]}" -f "$COMPOSE_FILE" down
fi

echo "observability: stopped" >&2
exit 0
