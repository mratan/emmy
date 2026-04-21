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
    if airgap:
        args += ["--network", "none"]
    else:
        args += ["-p", f"{port}:{engine.port}"]

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
