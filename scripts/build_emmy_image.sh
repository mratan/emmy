#!/usr/bin/env bash
# build_emmy_image.sh — build the emmy-derived vLLM image and print its digest.
#
# The derived image layers fastsafetensors on top of the pristine NGC vLLM
# image. SERVE-10 (~3x cold-start speedup) requires fastsafetensors; NGC
# 26.03.post1-py3 does not ship it. The profile's air-gap policy forbids a
# startup-time pip install, so we bake fastsafetensors into a derived image.
#
# Usage:
#   ./scripts/build_emmy_image.sh                      # build with defaults
#   ./scripts/build_emmy_image.sh --tag emmy/v2        # override tag
#
# Exit codes:
#   0 — build succeeded; stdout is the image ID (sha256:<hex>)
#   1 — prerequisite missing (docker, base image not pulled)
#   2 — build failed

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_IMAGE="nvcr.io/nvidia/vllm:26.03.post1-py3"
TAG="emmy-serve/vllm:26.03.post1-fst"
FASTSAFETENSORS_VERSION="0.1.14"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --base) BASE_IMAGE="$2"; shift 2 ;;
    --fst-version) FASTSAFETENSORS_VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR (prereq): docker not installed" >&2; exit 1
fi
if ! docker inspect "$BASE_IMAGE" >/dev/null 2>&1; then
  echo "ERROR (prereq): base image $BASE_IMAGE not pulled locally. Run: docker pull $BASE_IMAGE" >&2
  exit 1
fi

# Capture the base digest so we can label the derivative with provenance
BASE_DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "$BASE_IMAGE" | sed 's/.*@//')"
if [[ -z "$BASE_DIGEST" ]]; then
  echo "ERROR: could not capture base digest from $BASE_IMAGE" >&2
  exit 2
fi

echo "emmy: building $TAG from $BASE_IMAGE ($BASE_DIGEST)" >&2
echo "emmy: pinning fastsafetensors==$FASTSAFETENSORS_VERSION" >&2

if ! docker build \
    --build-arg "BASE_IMAGE=$BASE_IMAGE" \
    --build-arg "BASE_DIGEST=$BASE_DIGEST" \
    --build-arg "FASTSAFETENSORS_VERSION=$FASTSAFETENSORS_VERSION" \
    --tag "$TAG" \
    --file docker/Dockerfile \
    . >&2; then
  echo "ERROR: docker build failed" >&2
  exit 2
fi

# Emit the derived-image ID (sha256:<hex>) — this is what gets written to
# serving.yaml.engine.container_image_digest. Locally-built images do not have
# a RepoDigest until pushed, so we use the content-addressable image ID, which
# Docker accepts natively in `docker run sha256:<hex>`.
IMAGE_ID="$(docker inspect --format='{{.Id}}' "$TAG")"
echo "emmy: built $TAG — $IMAGE_ID" >&2
echo "$IMAGE_ID"
