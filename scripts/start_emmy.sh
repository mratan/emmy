#!/usr/bin/env bash
# start_emmy.sh — Phase 1 one-command contract (REPRO-01, RESEARCH.md §14).
#
# Usage:
#   ./scripts/start_emmy.sh [--profile profiles/qwen3.6-35b-a3b/v1] [--port 8002] [--airgap]
#   ./scripts/start_emmy.sh --install-sidecar-unit  # one-time: install systemd user unit for emmy-sidecar
#
# Exit codes:
#   0 — vLLM is up, smoke test passed, ready for harness
#   1 — boot rejected (diagnostic bundle in runs/boot-failures/)
#   2 — profile schema invalid
#   3 — container digest mismatch (local image not found or digest drift)
#   4 — prerequisite missing (docker, nvidia-smi, uv, model dir, HF cache)
#
# The image reference (nvcr.io/nvidia/vllm@sha256:<hex>) is rendered from
# serving.yaml.engine.container_image_digest via the boot.runner CLI —
# this script never hardcodes a digest. Operator captures the digest once
# (see docs/ci-runner.md + RESEARCH.md §12), writes it into serving.yaml,
# and commits. All subsequent boots read it from there.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROFILE="profiles/qwen3.6-35b-a3b/v3.1"
PORT=8002
AIRGAP=0
INSTALL_SIDECAR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --airgap) AIRGAP=1; shift ;;
    --install-sidecar-unit) INSTALL_SIDECAR=1; shift ;;
    -h|--help) sed -n '1,19p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 4 ;;
  esac
done

# --- Phase 04.2 — one-time sidecar systemd user-unit install (early-exit) ---
# Idempotent: cp -f overwrites; systemctl --user enable --now is a no-op the
# second time. Does NOT proceed to the vLLM boot path — operator wants this
# as a setup step, not coupled to a vLLM run.
if [[ "$INSTALL_SIDECAR" = "1" ]]; then
  mkdir -p "$HOME/.config/systemd/user"
  # Substitute WorkingDirectory with the actual repo location at install time.
  # The template uses %h/code/emmy as the conventional Mac client-install layout,
  # but Spark hosts (and any non-default checkout) live elsewhere — without this
  # rewrite systemd would exit 200/CHDIR on start.
  sed -e "s|^WorkingDirectory=.*|WorkingDirectory=${ROOT_DIR}|" \
      "$ROOT_DIR/emmy_serve/systemd/emmy-sidecar.service" \
      > "$HOME/.config/systemd/user/emmy-sidecar.service"
  systemctl --user daemon-reload
  systemctl --user enable --now emmy-sidecar
  if ! loginctl show-user --property=Linger 2>/dev/null | grep -q "Linger=yes"; then
    echo "WARNING: loginctl enable-linger \$USER not run — sidecar will die on logout" >&2
    echo "Run: loginctl enable-linger \$USER" >&2
  fi
  echo "emmy-sidecar installed and started. Check: systemctl --user status emmy-sidecar"
  exit 0
fi

RUN_ID="$(date -u +'%Y%m%dT%H%M%SZ')-$(head -c 6 /dev/urandom | xxd -p | head -c 6)"
RUN_DIR="runs/${RUN_ID}-boot"
mkdir -p "$RUN_DIR"
BOOT_START=$(date +%s)

echo "emmy: starting profile=${PROFILE} port=${PORT} airgap=${AIRGAP} run_id=${RUN_ID}" >&2

# --- 1. Pre-flight (exit 4 on any missing prereq) ---
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR (prereq): docker not installed" >&2; exit 4
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR (prereq): cannot connect to Docker daemon (try: sudo usermod -aG docker \$USER)" >&2; exit 4
fi
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "ERROR (prereq): nvidia-smi not installed" >&2; exit 4
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR (prereq): uv not installed" >&2; exit 4
fi
if [[ ! -d /data/models ]]; then
  echo "ERROR (prereq): /data/models not mounted" >&2; exit 4
fi
if [[ ! -d /data/hf-cache ]] && [[ ! -d "${HOME}/.cache/huggingface" ]]; then
  echo "ERROR (prereq): HF cache dir not found (tried /data/hf-cache and ~/.cache/huggingface)" >&2; exit 4
fi

# --- 2. Validate profile (exit 2 on schema invalid / hash mismatch) ---
# The validator reads container_image_digest from serving.yaml and rejects the
# sha256:REPLACE_AT_FIRST_PULL sentinel — clean "capture-first" guard rail.
if ! uv run emmy profile validate "$PROFILE" >&2; then
  echo "ERROR (schema/hash): profile failed validation" >&2; exit 2
fi

# --- 3. Resolve image ref from profile (exit 3 on digest issue) ---
# IMAGE_REF is the ONLY place the digest crosses into docker-land; read from
# serving.yaml.engine.container_image_digest via the boot.runner CLI.
if ! IMAGE_REF="$(uv run python -m emmy_serve.boot.runner render-image-ref --profile "$PROFILE")"; then
  echo "ERROR (digest): could not render image ref" >&2; exit 3
fi
if [[ -z "$IMAGE_REF" ]]; then
  echo "ERROR (digest): empty image ref" >&2; exit 3
fi
echo "emmy: image ref = $IMAGE_REF" >&2

# Assert local image matches the digest (pulled once by operator per REPRO-01)
if ! docker inspect "$IMAGE_REF" >/dev/null 2>&1; then
  echo "ERROR (digest): local image not found; run 'docker pull nvcr.io/nvidia/vllm:26.03.post1-py3' first" >&2
  exit 3
fi

# --- 4. Stop any existing emmy-serve container ---
docker stop emmy-serve >/dev/null 2>&1 || true
docker rm emmy-serve >/dev/null 2>&1 || true

# --- 5. Render docker args (complete argv: docker flags + image + vllm cli) ---
AIRGAP_FLAG=""
if [[ "$AIRGAP" = "1" ]]; then
  AIRGAP_FLAG="--airgap"
fi

# render-docker-args returns the COMPLETE argv (docker flags + image ref + vllm
# serve CLI) — start_emmy.sh does not compose the pieces separately.
DOCKER_RUN_ARGS="$(uv run python -m emmy_serve.boot.runner render-docker-args \
  --profile "$PROFILE" --run-dir "$RUN_DIR" --port "$PORT" $AIRGAP_FLAG)"

# --- 6. docker run (detached) ---
# shellcheck disable=SC2086
eval docker run --name emmy-serve --detach "$DOCKER_RUN_ARGS" \
  >"$RUN_DIR/docker-run.log" 2>&1

echo "emmy: container started; running smoke test" >&2

# --- 7. Smoke test (exit 1 on failure) ---
BASE_URL="http://127.0.0.1:${PORT}"
if ! uv run python scripts/smoke_test.py \
    --base-url "$BASE_URL" \
    --profile "$PROFILE" \
    --run-dir "$RUN_DIR" \
    --fail-dir "runs" 2>&1 | tee -a "$RUN_DIR/smoke.log"; then
  # D-06 bundle already written by smoke_test.py into runs/boot-failures/
  docker stop emmy-serve >/dev/null 2>&1 || true
  echo "BOOT REJECTED — see runs/boot-failures/" >&2
  exit 1
fi

# --- 8. Ready banner ---
BOOT_END=$(date +%s)
ELAPSED=$((BOOT_END - BOOT_START))
THROUGHPUT="$(grep 'smoke ok:' "$RUN_DIR/smoke.log" | tail -1 | sed 's/.*tok\/s=//' | awk '{print $1}')"
echo "emmy-serve ready — profile ${PROFILE} on ${BASE_URL} (cold-start ${ELAPSED}s, ${THROUGHPUT:-?} tok/s)"
exit 0
