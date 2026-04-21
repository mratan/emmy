# Derived vLLM serving image for emmy.
# Adds fastsafetensors to the pristine NGC image. SERVE-10 (~3x cold-start
# speedup, proven in prior repo's setup_local_opencode) is not available in the
# upstream image — the 26.03.post1 container ships vLLM 0.17.1+nvinternal
# without fastsafetensors baked in, and the profile's air-gap policy forbids
# startup-time pip installs.
#
# Build: scripts/build_emmy_image.sh
# Pin:   the serving.yaml.engine.container_image_digest field records the
#        sha256 image ID of the build output; profile.yaml re-hashes after
#        every rebuild.

ARG BASE_IMAGE=nvcr.io/nvidia/vllm:26.03.post1-py3
FROM ${BASE_IMAGE}

# Re-declare build args after FROM so they are visible in this stage.
ARG BASE_IMAGE
ARG BASE_DIGEST=unknown
ARG FASTSAFETENSORS_VERSION=0.1.14

# Record the exact base digest that produced this derivative. Inspect with:
#   docker inspect --format '{{index .Config.Labels "emmy.base_digest"}}' <id>
LABEL emmy.base_image=${BASE_IMAGE}
LABEL emmy.base_digest=${BASE_DIGEST}
LABEL emmy.fastsafetensors_version=${FASTSAFETENSORS_VERSION}
LABEL emmy.fastsafetensors_source="pip (frozen by image build)"

# Pin fastsafetensors explicitly so rebuilds are deterministic. The prior repo
# (setup_local_opencode) pip-installed unversioned at boot — emmy's REPRO-01
# contract requires a pinned version.
RUN pip install --no-cache-dir "fastsafetensors==${FASTSAFETENSORS_VERSION}" \
    && python -c "from fastsafetensors import SafeTensorsFileLoader; print('fastsafetensors import ok')"
