"""D-06 boot-failure diagnostic bundle writer — RESEARCH.md §7.5.

On any boot-time smoke check failure, ``write_boot_failure_bundle`` writes
7 files under ``runs/boot-failures/<iso>-boot-failure/``:

    check.json             — which check failed + reason string
    profile.json           — profile id/version/hash/path at failure time
    prompt.txt             — assembled system + user prompt sent to model
    response.txt           — model response content (may be empty on exception)
    response.json          — full OpenAI JSON (when available)
    env.json               — filtered EMMY_/VLLM_/HF_/TRANSFORMERS_ env
    docker-logs.txt        — `docker logs --tail 5000 emmy-serve`
    metrics-snapshot.txt   — `/metrics` snapshot if reachable (callee provides)

The bundle is read by the operator post-failure and by Phase 3's Langfuse
ingestor (which slurps each boot-failure dir as a single trace).

Phase 4 (Plan 04-02) adds a companion ``write_swap_failure_bundle`` for
profile-swap failures. It writes a smaller subset (check + reason + env +
docker-logs + optional profile snapshot) under
``runs/boot-failures/<iso>-swap-{preflight|postboot|rollback}-failure/``,
reusing the same parent directory so the operator only has one place to
look after any engine-lifecycle failure.
"""
from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from ..profile.loader import ProfileRef
from .atomic import write_json_atomic, write_text_atomic
from .layout import EmmyRunLayout


SwapFailureType = Literal["preflight", "postboot", "rollback"]


def write_boot_failure_bundle(
    layout: EmmyRunLayout,
    *,
    profile_ref: ProfileRef,
    check: str,
    reason: str,
    prompt_text: str = "",
    response_text: str = "",
    response_json: dict | None = None,
    metrics_snapshot: str = "",
) -> None:
    """Write all 7 files per RESEARCH.md §7.5."""
    assert layout.kind == "boot-failure", (
        f"expected kind=boot-failure, got {layout.kind}"
    )
    layout.run_dir.mkdir(parents=True, exist_ok=True)

    write_json_atomic(layout.check_path, {"check": check, "reason": reason})
    write_json_atomic(
        layout.profile_snapshot_path,
        {
            "id": profile_ref.id,
            "version": profile_ref.version,
            "hash": profile_ref.hash,
            "path": str(profile_ref.path),
        },
    )
    write_text_atomic(layout.prompt_path, prompt_text)
    write_text_atomic(layout.response_path, response_text)

    if response_json is not None:
        write_json_atomic(layout.run_dir / "response.json", response_json)

    env = {
        k: v
        for k, v in os.environ.items()
        if k.startswith(("EMMY_", "VLLM_", "HF_", "TRANSFORMERS_"))
    }
    write_json_atomic(layout.env_path, env)

    try:
        out = subprocess.check_output(
            ["docker", "logs", "--tail", "5000", "emmy-serve"],
            stderr=subprocess.STDOUT,
            timeout=30,
        ).decode(errors="replace")
    except Exception as e:
        out = f"(docker logs failed: {e})"
    write_text_atomic(layout.docker_logs_path, out)

    write_text_atomic(layout.metrics_snapshot_path, metrics_snapshot or "")


# --- Phase 4 swap-failure bundle ---------------------------------------------


def _iso_ts() -> str:
    """Filesystem-safe ISO timestamp: ``YYYYMMDDTHHMMSSZ`` (matches new_run_id)."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_swap_failure_bundle(
    run_base_dir: Path,
    *,
    failure_type: SwapFailureType,
    reason: str,
    profile_path: Path | None = None,
    profile_ref: ProfileRef | None = None,
) -> Path:
    """Write a swap-failure bundle to
    ``<run_base_dir>/boot-failures/<iso>-swap-<failure_type>-failure/``.

    Minimal subset of the boot-failure bundle (no prompt/response fields — a
    swap has no user prompt). Docker logs + env dump + check reason are the
    diagnostic surface.

    Returns the directory path for callers that want to log it.

    Reuses the ``runs/boot-failures/`` parent dir so operators have a single
    place to hunt for any engine-lifecycle failure.
    """
    assert failure_type in ("preflight", "postboot", "rollback"), (
        f"unknown swap failure_type: {failure_type}"
    )

    out_dir = (
        Path(run_base_dir)
        / "boot-failures"
        / f"{_iso_ts()}-swap-{failure_type}-failure"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    write_json_atomic(
        out_dir / "check.json",
        {"check": f"swap-{failure_type}", "reason": reason},
    )

    if profile_ref is not None:
        write_json_atomic(
            out_dir / "profile.json",
            {
                "id": profile_ref.id,
                "version": profile_ref.version,
                "hash": profile_ref.hash,
                "path": str(profile_ref.path),
            },
        )
    elif profile_path is not None:
        # Pre-flight failures may arrive before the profile could be loaded —
        # fall back to recording just the path we were asked to validate.
        write_json_atomic(
            out_dir / "profile.json",
            {"path": str(profile_path)},
        )

    env = {
        k: v
        for k, v in os.environ.items()
        if k.startswith(("EMMY_", "VLLM_", "HF_", "TRANSFORMERS_"))
    }
    write_json_atomic(out_dir / "env.json", env)

    # Best-effort docker logs; on preflight failure the container may still be
    # the prior engine (which is exactly what we want to know survived).
    try:
        out = subprocess.check_output(
            ["docker", "logs", "--tail", "5000", "emmy-serve"],
            stderr=subprocess.STDOUT,
            timeout=30,
        ).decode(errors="replace")
    except Exception as e:
        out = f"(docker logs failed: {e})"
    write_text_atomic(out_dir / "docker-logs.txt", out)

    return out_dir
