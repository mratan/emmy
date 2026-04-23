#!/usr/bin/env bash
# scripts/start_observability.sh — Phase 3 Plan 03-02 (D-05, D-06, D-09).
#
# Bring up the Langfuse v3 self-hosted stack and gate on all 6 services being
# healthy (or running where no healthcheck is defined). On first boot, copy
# observability/langfuse/.env.example -> observability/langfuse/.env and
# substitute CHANGEME tokens with `openssl rand`-backed secrets.
#
# Usage:
#   ./scripts/start_observability.sh
#
# Exit codes:
#   0 - all 6 services up, ready for pi-emmy OTLP exporter
#   1 - health gate timed out after 90s; actionable message + ps dump
#   4 - prerequisite missing (docker compose, openssl)
#
# Air-gap discipline (D-09): the compose file pins all 6 images by SHA256
# digest. On first boot the operator MUST be online to pull the images; all
# subsequent boots are fully offline. Images survive docker prune --volumes
# because they are stored in the daemon's image cache by digest.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="observability/langfuse/docker-compose.yaml"
ENV_EXAMPLE="observability/langfuse/.env.example"
ENV_FILE="observability/langfuse/.env"

# --- 1. Pre-flight ---
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR (prereq): docker not installed" >&2; exit 4
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR (prereq): docker compose v2 not installed (try: apt install docker-compose-plugin)" >&2; exit 4
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR (prereq): openssl not installed (needed to generate secrets)" >&2; exit 4
fi

# --- 2. Generate .env on first boot (fill CHANGEME tokens) ---
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "ERROR: $ENV_EXAMPLE missing; cannot bootstrap $ENV_FILE" >&2; exit 1
  fi
  echo "observability: generating $ENV_FILE from $ENV_EXAMPLE (first boot)" >&2
  cp "$ENV_EXAMPLE" "$ENV_FILE"

  # Each CHANGEME-marked secret is filled with an appropriate openssl rand
  # output. Keys are dotenv-quoted via Python-style escaping; we rely on
  # openssl's alphanumeric output to avoid needing shell-escape gymnastics.
  NEXTAUTH=$(openssl rand -base64 32)
  SALT_VAL=$(openssl rand -base64 16)
  ENCRYPTION=$(openssl rand -hex 32)
  CLICKHOUSE_PW=$(openssl rand -base64 24 | tr -d '=+/')
  REDIS_PW=$(openssl rand -base64 24 | tr -d '=+/')
  POSTGRES_PW=$(openssl rand -base64 24 | tr -d '=+/')
  MINIO_PW=$(openssl rand -base64 24 | tr -d '=+/')
  # The three LANGFUSE_S3_*_SECRET_ACCESS_KEY values MUST equal MINIO_PW —
  # chainguard's MinIO image only has root credentials (no IAM users), so
  # Langfuse connects as access-key-id="minio" / secret=MINIO_ROOT_PASSWORD.
  # Pre-2026-04-23 this script generated three *different* secrets, which
  # caused SignatureDoesNotMatch on every OTLP ingestion S3 upload.
  S3_EVENT_SK="$MINIO_PW"
  S3_MEDIA_SK="$MINIO_PW"
  S3_BATCH_SK="$MINIO_PW"

  # Use awk for in-place field replacement rather than sed -i because base64 +
  # hex secrets may contain characters sed treats specially (though we already
  # stripped =+/ for the non-base64-required ones). awk approach keeps the file
  # deterministic and legible.
  TMP_FILE="${ENV_FILE}.tmp"
  awk -v nextauth="$NEXTAUTH" \
      -v salt_val="$SALT_VAL" \
      -v encryption="$ENCRYPTION" \
      -v clickhouse_pw="$CLICKHOUSE_PW" \
      -v redis_pw="$REDIS_PW" \
      -v postgres_pw="$POSTGRES_PW" \
      -v minio_pw="$MINIO_PW" \
      -v s3_event_sk="$S3_EVENT_SK" \
      -v s3_media_sk="$S3_MEDIA_SK" \
      -v s3_batch_sk="$S3_BATCH_SK" '
    /^NEXTAUTH_SECRET=/ { print "NEXTAUTH_SECRET=" nextauth; next }
    /^SALT=/ { print "SALT=" salt_val; next }
    /^ENCRYPTION_KEY=/ { print "ENCRYPTION_KEY=" encryption; next }
    /^CLICKHOUSE_PASSWORD=/ { print "CLICKHOUSE_PASSWORD=" clickhouse_pw; next }
    /^REDIS_AUTH=/ { print "REDIS_AUTH=" redis_pw; next }
    /^POSTGRES_PASSWORD=/ { print "POSTGRES_PASSWORD=" postgres_pw; next }
    /^MINIO_ROOT_PASSWORD=/ { print "MINIO_ROOT_PASSWORD=" minio_pw; next }
    /^LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=/ { print "LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=" s3_event_sk; next }
    /^LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=/ { print "LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=" s3_media_sk; next }
    /^LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY=/ { print "LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY=" s3_batch_sk; next }
    { print }
  ' "$ENV_FILE" > "$TMP_FILE"
  mv "$TMP_FILE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "observability: generated secrets in $ENV_FILE (mode 600)" >&2
fi

# --- 3. docker compose up -d ---
echo "observability: docker compose up -d" >&2
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

# --- 4. Health gate (90s timeout; poll every 2s) ---
echo "observability: waiting for all services to become healthy (up to 90s)..." >&2
DEADLINE=$(( $(date +%s) + 90 ))
EXPECTED_SERVICES=6
while true; do
  # Count services whose State is running AND (Health is healthy OR Health is
  # empty, which means "no healthcheck"). The compose ps JSON output emits
  # one line per service.
  PS_JSON="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format json)"
  if [[ -z "$PS_JSON" ]]; then
    HEALTHY_COUNT=0
  else
    # Each line is a standalone JSON object; parse State + Health with awk.
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
    echo "observability: all ${EXPECTED_SERVICES} services healthy" >&2
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

# --- 5. Next-steps banner ---
cat <<EOF >&2

observability: Langfuse v3 ready at http://localhost:3000

Next steps (one-time, on first boot):
  1. Visit http://localhost:3000 in your browser
  2. Create your first user + organization + project
  3. Project Settings -> API Keys -> Create new API keys
  4. Paste the generated keys into ${ENV_FILE}:
       LANGFUSE_PUBLIC_KEY=pk-lf-...
       LANGFUSE_SECRET_KEY=sk-lf-...
  5. Export them in your shell (or restart pi-emmy):
       export LANGFUSE_PUBLIC_KEY=pk-lf-...
       export LANGFUSE_SECRET_KEY=sk-lf-...
  6. Start pi-emmy normally; boot banner now reads:
       OBSERVABILITY: ON -- JSONL + Langfuse OTLP

Teardown (preserves trace history):
  bash scripts/stop_observability.sh
Teardown + wipe (removes volumes, trace history lost):
  bash scripts/stop_observability.sh --volumes
EOF

exit 0
