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
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from ..profile.loader import ProfileRef
from .atomic import write_json_atomic, write_text_atomic
from .layout import EmmyRunLayout


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
