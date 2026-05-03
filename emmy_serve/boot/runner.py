"""Render `docker run` args from serving.yaml. Used by scripts/start_emmy.sh.

Contract (per test_docker_run_build.py):
    `render_docker_args(profile_path, run_dir, port, *, airgap=False)` returns
    the COMPLETE argv that goes after `docker run --name emmy-serve --detach`:
    docker-level flags + pinned image reference + vllm serve CLI flags.

Three helper accessors are exposed for start_emmy.sh to read individual pieces:
    `render_image_ref(profile_path)` -> 'nvcr.io/nvidia/vllm@sha256:<hex>'
    `render_vllm_cli_args(profile_path)` -> list[str] of vllm serve flags
    `render_docker_only_args(profile_path, ..., airgap=False)` -> docker flags only
"""
from __future__ import annotations

import argparse
import shlex
import sys
from pathlib import Path

from ..profile.loader import load_serving


# --- public renderers ---------------------------------------------------------


def render_image_ref(profile_path: Path) -> str:
    """Return a content-addressable docker image reference pinned by digest.

    For registry-hosted images (``container_image`` contains a registry host
    such as ``nvcr.io/...``), returns ``<repo>@<digest>`` — the canonical
    docker pull-spec form. For locally-built / derived images (e.g. the
    emmy-derived ``emmy-serve/vllm:26.03.post1-fst`` from
    ``scripts/build_emmy_image.sh``), returns the bare ``sha256:<64-hex>``
    image ID, which ``docker run`` accepts natively without requiring a
    RepoDigest.

    Either form pins by content hash (SERVE-01 / REPRO-01 / T-03-01): the
    running container is exactly the digest captured in serving.yaml, never
    whatever ``:tag`` currently resolves to.
    """
    serving = load_serving(profile_path / "serving.yaml")
    image = serving.engine.container_image
    digest = serving.engine.container_image_digest
    repo = image.split(":")[0]
    # Heuristic: a registry-hosted repo has a dot in its first path segment
    # (e.g. "nvcr.io/nvidia/vllm", "ghcr.io/...", "docker.io/...").
    first_segment = repo.split("/", 1)[0]
    if "." in first_segment:
        return f"{repo}@{digest}"
    return digest


def render_vllm_cli_args(profile_path: Path) -> list[str]:
    """Render the `vllm serve …` CLI flags (after `docker run IMAGE`).

    Canonical flag set includes ``--load-format fastsafetensors`` (SERVE-10,
    ~3x cold-start speedup), ``--enable-prefix-caching`` +
    ``--enable-chunked-prefill`` (SERVE-07), and ``--tool-call-parser
    qwen3_coder`` driven by serving.yaml. Values come from the validated
    ServingConfig schema; this function only emits them.
    """
    serving = load_serving(profile_path / "serving.yaml")
    e = serving.engine

    cli: list[str] = [
        "vllm",
        "serve",
        e.model,
        "--host",
        e.host,
        "--port",
        str(e.port),
        "--max-model-len",
        str(e.max_model_len),
        "--served-model-name",
        e.served_model_name,
        "--gpu-memory-utilization",
        f"{e.gpu_memory_utilization:.3f}",
        "--load-format",
        e.load_format,
        "--kv-cache-dtype",
        e.kv_cache_dtype,
        "--max-num-batched-tokens",
        str(e.max_num_batched_tokens),
        "--quantization",
        e.quantization,
    ]
    if e.enable_prefix_caching:
        cli.append("--enable-prefix-caching")
    if e.enable_chunked_prefill:
        cli.append("--enable-chunked-prefill")
    if e.tool_call_parser:
        cli += ["--tool-call-parser", e.tool_call_parser]
    if e.enable_auto_tool_choice:
        cli.append("--enable-auto-tool-choice")
    if e.attention_backend:
        cli += ["--attention-backend", e.attention_backend]
    # Phase 04.7 — orphaned-flag fix: schema fields existed but were never emitted.
    # Forces explicit pass for Mistral (whose tokenizer MUST be set explicitly
    # because GGUF tokenizer extraction is "time-consuming and unstable" per
    # vLLM docs) AND surfaces Gemma's reasoning_parser/max_num_seqs through the
    # CLI (previously vLLM auto-detected reasoning_parser from
    # tokenizer_config.json — see 04.7-RESEARCH.md §1.2). Conditional emission
    # preserves byte-identical render for pre-04.7 profiles where these are unset.
    if e.reasoning_parser:
        cli += ["--reasoning-parser", e.reasoning_parser]
    if e.max_num_seqs is not None:
        cli += ["--max-num-seqs", str(e.max_num_seqs)]
    if e.tokenizer:
        cli += ["--tokenizer", e.tokenizer]
    # Phase 04.7-02 (Workaround A) — explicit HF config path. Forces vLLM's
    # get_config() to construct the PretrainedConfig from a directory-on-disk
    # rather than letting it derive one from the model path (which, for local
    # GGUF files, triggers transformers' GGUF parser and the per-architecture
    # allowlist gap that blocks `mistral3` as of vLLM 0.19.2rc1.dev134). When
    # set, the value points at a container-internal directory (typically
    # mounted under /models) containing config.json + optionally tokenizer*.
    # Conditional emission preserves byte-identical render for pre-04.7-02
    # profiles where the field is unset.
    if e.hf_config_path:
        cli += ["--hf-config-path", e.hf_config_path]
    # Phase 04.7-02 follow-up Decision Option 5 — explicit dtype override.
    # Required for Mistral 3.x GGUF profiles whose source config.json declares
    # bfloat16 (vLLM GGUF backend rejects bf16 — see schema docstring for
    # the precise error class). Conditional emission preserves byte-identical
    # render for pre-04.7-02-followup profiles where the field is unset
    # (vLLM continues to auto-detect from config).
    if e.dtype is not None:
        cli += ["--dtype", e.dtype]
    # Phase 04.7-02 follow-up Decision Option 7a — explicit tokenizer_mode.
    # Required for Mistral 3.x GGUF profiles whose `tool_call_parser: mistral`
    # routes through a chat-template implementation that needs
    # `mistral_common.MistralTokenizer` — see schema docstring for the precise
    # `pydantic_core.ValidationError: The tokenizer must be an instance of
    # MistralTokenizer.` error class surfaced by Plan 04.7-02 Wave 3 attempt 7.
    # Conditional emission preserves byte-identical render for every pre-04.7-02-
    # followup profile where the field is unset (vLLM defaults to "auto" itself).
    if e.tokenizer_mode is not None:
        cli += ["--tokenizer-mode", e.tokenizer_mode]
    return cli


def render_docker_only_args(
    profile_path: Path,
    run_dir: Path,
    port: int,
    *,
    airgap: bool = False,
    models_mount: str = "/data/models",
    hf_cache_mount: str = "/data/hf-cache",
) -> list[str]:
    """Render the docker-level flags (no image ref, no vllm CLI)."""
    serving = load_serving(profile_path / "serving.yaml")
    engine = serving.engine

    args: list[str] = [
        "--gpus",
        "all",
        "--shm-size",
        "8g",
        "-v",
        f"{models_mount}:/models:ro",
        "-v",
        f"{hf_cache_mount}:/hf-cache:ro",
    ]
    # Phase 04.7-02 follow-up (Decision Option 5 — sitecustomize hot-patch).
    # When set, mount the profile-bundle's airgap_patches dir into the
    # container and arrange for sitecustomize.py to be auto-imported on
    # Python startup (BEFORE vllm imports transformers). The path in
    # serving.yaml is bundle-relative; we resolve it via profile_path
    # (which IS the bundle dir) so the host-side bind source is absolute.
    # Container-internal path is fixed at /airgap_patches (referenced by
    # the docs in profiles/<bundle>/airgap_patches/README.md).
    if engine.airgap_patch_dir is not None:
        host_patch_dir = (profile_path / engine.airgap_patch_dir).resolve()
        args += ["-v", f"{host_patch_dir}:/airgap_patches:ro"]
    # Phase 4 v2 — optional per-profile entrypoint override. Used by upstream
    # vllm-openai images where the ENTRYPOINT is baked to `[vllm serve]` and
    # concatenates with our `vllm serve <flags>` CMD. Empty string clears it.
    if engine.container_entrypoint_override is not None:
        args += ["--entrypoint", engine.container_entrypoint_override]
    if airgap:
        args += ["--network", "none"]
    else:
        # Phase 04.2 follow-up — bind 127.0.0.1 only, NOT 0.0.0.0.
        #
        # Without the loopback prefix, Docker tries to bind 0.0.0.0:{port} on
        # the host, which collides with `tailscale serve --bg --https={port}
        # http://127.0.0.1:{port}` (tailscale's per-tailnet-IP listener owns
        # that port already). Container fails to start with:
        #     "failed to bind host port 0.0.0.0:{port}/tcp: address already
        #      in use"
        # — same architectural mistake we just fixed in the sidecar
        # controller (commit aa239b2). Tailscale Serve is the explicit,
        # ACL-gated tailnet exposure path; the container itself stays
        # loopback-only per CLAUDE.md two-hard-boundaries principle.
        args += ["-p", f"127.0.0.1:{port}:{engine.port}"]

    env = serving.env
    args += [
        "-e",
        f"VLLM_NO_USAGE_STATS={env.VLLM_NO_USAGE_STATS}",
        "-e",
        f"DO_NOT_TRACK={env.DO_NOT_TRACK}",
        "-e",
        f"VLLM_LOAD_FORMAT={env.VLLM_LOAD_FORMAT}",
        "-e",
        f"VLLM_FLASHINFER_MOE_BACKEND={env.VLLM_FLASHINFER_MOE_BACKEND}",
        "-e",
        f"VLLM_DISABLE_COMPILE_CACHE={env.VLLM_DISABLE_COMPILE_CACHE}",
        "-e",
        f"HF_HUB_OFFLINE={env.HF_HUB_OFFLINE}",
        "-e",
        f"TRANSFORMERS_OFFLINE={env.TRANSFORMERS_OFFLINE}",
        "-e",
        "HF_HOME=/hf-cache",
    ]
    # Phase 04.7-02 follow-up (Decision Option 5 — sitecustomize hot-patch).
    # When the profile bundle ships an airgap_patches dir, prepend it to
    # PYTHONPATH so Python's site machinery imports /airgap_patches/
    # sitecustomize.py at process start (BEFORE vllm imports transformers).
    # Per-patch opt-in env vars are wired here too, so other Python
    # processes that happen to land on this PYTHONPATH (e.g. interactive
    # debug shells) do NOT trigger the patches by accident — the patch
    # gate is a deliberate operator gesture via this profile bundle.
    if engine.airgap_patch_dir is not None:
        args += [
            "-e",
            "PYTHONPATH=/airgap_patches",
            "-e",
            "EMMY_AIRGAP_PATCH_MISTRAL3=on",
        ]
    return args


def render_docker_args(
    profile_path: Path,
    run_dir: Path,
    port: int,
    *,
    airgap: bool = False,
    models_mount: str = "/data/models",
    hf_cache_mount: str = "/data/hf-cache",
) -> list[str]:
    """Render the COMPLETE argv that goes after `docker run --name emmy-serve --detach`.

    Includes: docker flags (mounts + env + network) + pinned image ref +
    ``vllm serve …`` CLI flags. This is one single list so tests can assert
    every flag lives in one rendered surface and start_emmy.sh can do::

        exec docker run --name emmy-serve --detach \
            $(python -m emmy_serve.boot.runner render-docker-args ...)
    """
    docker_args = render_docker_only_args(
        profile_path,
        run_dir,
        port,
        airgap=airgap,
        models_mount=models_mount,
        hf_cache_mount=hf_cache_mount,
    )
    image_ref = render_image_ref(profile_path)
    vllm_cli = render_vllm_cli_args(profile_path)
    return docker_args + [image_ref] + vllm_cli


# --- CLI subcommands ----------------------------------------------------------


def _cmd_render_docker_args(args: argparse.Namespace) -> int:
    parts = render_docker_args(
        Path(args.profile),
        Path(args.run_dir),
        args.port,
        airgap=args.airgap,
    )
    print(" ".join(shlex.quote(p) for p in parts))
    return 0


def _cmd_render_docker_only(args: argparse.Namespace) -> int:
    parts = render_docker_only_args(
        Path(args.profile),
        Path(args.run_dir),
        args.port,
        airgap=args.airgap,
    )
    print(" ".join(shlex.quote(p) for p in parts))
    return 0


def _cmd_render_vllm_cli(args: argparse.Namespace) -> int:
    parts = render_vllm_cli_args(Path(args.profile))
    print(" ".join(shlex.quote(p) for p in parts))
    return 0


def _cmd_render_image_ref(args: argparse.Namespace) -> int:
    print(render_image_ref(Path(args.profile)))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="emmy_serve.boot.runner")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("render-docker-args")
    d.add_argument("--profile", required=True)
    d.add_argument("--run-dir", default="runs/boot")
    d.add_argument("--port", type=int, default=8002)
    d.add_argument("--airgap", action="store_true")
    d.set_defaults(_handler=_cmd_render_docker_args)

    do = sub.add_parser("render-docker-only")
    do.add_argument("--profile", required=True)
    do.add_argument("--run-dir", default="runs/boot")
    do.add_argument("--port", type=int, default=8002)
    do.add_argument("--airgap", action="store_true")
    do.set_defaults(_handler=_cmd_render_docker_only)

    v = sub.add_parser("render-vllm-cli")
    v.add_argument("--profile", required=True)
    v.set_defaults(_handler=_cmd_render_vllm_cli)

    i = sub.add_parser("render-image-ref")
    i.add_argument("--profile", required=True)
    i.set_defaults(_handler=_cmd_render_image_ref)

    args = p.parse_args(argv)
    return args._handler(args)


if __name__ == "__main__":
    sys.exit(main())
