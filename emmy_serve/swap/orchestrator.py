"""Atomic profile-swap orchestrator — the engine-layer half of PROFILE-08.

Pipeline (D-05 validate-first-then-stop):
    1. PRE-FLIGHT  — schema + hash + docker inspect + render_docker_args
                     On any failure: exit 5 (prior engine still running).
    2. STOP OLD    — emit("stopping vLLM"); docker stop emmy-serve; docker rm.
    3. START NEW   — emit("loading weights", pct=0); docker run --detach.
    4. WARMUP      — emit("warmup"); wait_for_vllm /v1/models.
                     On timeout: rollback (unless no_rollback=True).
    5. READY+SMOKE — emit("ready"); run scripts/smoke_test.py.
                     On smoke fail: rollback (unless no_rollback=True).
    6. return 0.

Exit codes (extend start_emmy.sh's 0/1/2/3/4):
    0 ok
    2 schema invalid / hash mismatch (happens only via --no-rollback
      re-invocation from rollback; primary callers see 5)
    3 image digest missing (same note)
    4 prereq (render_docker_args) failure (same note)
    5 pre-flight fail — PRIOR ENGINE STILL RUNNING (D-04 contract)
    6 post-stop fail — rollback attempted; envelope JSON reports outcome

D-04 LOCKED: rollback goes through the SAME primitive via ``no_rollback=True``
to prevent loops. D-02 LOCKED: four-phase progress labels verbatim.

CLI: ``uv run python -m emmy_serve.swap.orchestrator --from PATH --to PATH
--port N [--run-dir DIR] [--no-rollback]``
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

from ..diagnostics.bundle import write_swap_failure_bundle
from ..boot.probe import wait_for_vllm
from .preflight import run_preflight
from .progress import LOADING, READY, STOPPING, WARMUP, emit


# --- swap_profile ------------------------------------------------------------


def swap_profile(
    old_profile: Path,
    new_profile: Path,
    port: int,
    run_dir: Path,
    *,
    no_rollback: bool = False,
) -> int:
    """Atomically swap the loaded profile from ``old_profile`` to ``new_profile``.

    Emits JSON progress lines to stdout; returns an exit code aligned with
    start_emmy.sh's scheme plus 5 (pre-flight fail) / 6 (post-stop fail).
    """
    old_profile = Path(old_profile)
    new_profile = Path(new_profile)
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    # -- Step 1 — PRE-FLIGHT (D-05) -------------------------------------------
    pr = run_preflight(new_profile, port, run_dir)
    if pr.exit_code != 0:
        # D-04 contract: PRIOR ENGINE STILL RUNNING. Write a bundle and bail
        # with exit 5 (new code) so the caller can distinguish a pre-flight
        # failure from a post-stop failure.
        write_swap_failure_bundle(
            run_dir,
            failure_type="preflight",
            reason=pr.error_msg or "pre-flight failed (unspecified)",
            profile_path=new_profile,
        )
        return 5

    assert pr.docker_args is not None  # pr.exit_code == 0 ⇒ docker_args populated

    # -- Step 2 — STOP OLD ----------------------------------------------------
    emit(STOPPING)  # D-02 label 1
    subprocess.run(
        ["docker", "stop", "--time", "15", "emmy-serve"],
        check=False,
        capture_output=True,
    )
    subprocess.run(
        ["docker", "rm", "emmy-serve"],
        check=False,
        capture_output=True,
    )
    # Defensive CUDA drain — UMA contexts take a moment to release (04-RESEARCH §3.1).
    time.sleep(1)

    # -- Step 3 — START NEW ---------------------------------------------------
    emit(LOADING, pct=0)  # D-02 label 2
    run_result = subprocess.run(
        ["docker", "run", "--name", "emmy-serve", "--detach"] + list(pr.docker_args),
        capture_output=True,
    )
    if run_result.returncode != 0:
        # docker run itself failed before the container even began starting —
        # treat as post-stop failure and rollback (old engine is already gone).
        reason = (
            f"docker run failed (rc={run_result.returncode}): "
            f"{run_result.stderr.decode(errors='replace')[:500]}"
        )
        write_swap_failure_bundle(
            run_dir,
            failure_type="postboot",
            reason=reason,
            profile_path=new_profile,
        )
        return _maybe_rollback(old_profile, new_profile, port, run_dir, no_rollback)

    # Best-effort mid-load pct marker. We don't log-scrape vllm output in this
    # plan (Phase 5 polish) — just fire a midpoint signal so the TUI footer
    # moves. The final pct=90 lands just before WARMUP.
    emit(LOADING, pct=50)

    # -- Step 4 — WARMUP -------------------------------------------------------
    emit(LOADING, pct=90)
    emit(WARMUP)  # D-02 label 3
    try:
        wait_for_vllm(f"http://127.0.0.1:{port}", timeout_s=300)
    except TimeoutError as e:
        write_swap_failure_bundle(
            run_dir,
            failure_type="postboot",
            reason=f"wait_for_vllm timeout: {e}",
            profile_path=new_profile,
        )
        return _maybe_rollback(old_profile, new_profile, port, run_dir, no_rollback)

    # -- Step 5 — READY + SMOKE ------------------------------------------------
    emit(READY)  # D-02 label 4

    smoke_cmd = _build_smoke_cmd(port, new_profile, run_dir)
    smoke_rc = subprocess.run(smoke_cmd).returncode
    if smoke_rc != 0:
        write_swap_failure_bundle(
            run_dir,
            failure_type="postboot",
            reason=f"smoke_test failed (rc={smoke_rc})",
            profile_path=new_profile,
        )
        return _maybe_rollback(old_profile, new_profile, port, run_dir, no_rollback)

    return 0


def _build_smoke_cmd(port: int, profile: Path, run_dir: Path) -> list[str]:
    """Build the argv for scripts/smoke_test.py — reused in tests via monkeypatch."""
    return [
        "uv",
        "run",
        "python",
        "scripts/smoke_test.py",
        "--base-url",
        f"http://127.0.0.1:{port}",
        "--profile",
        str(profile),
        "--run-dir",
        str(run_dir),
        "--fail-dir",
        "runs",
    ]


def _maybe_rollback(
    old_profile: Path,
    failed_new: Path,
    port: int,
    run_dir: Path,
    no_rollback: bool,
) -> int:
    """Dispatch rollback unless no_rollback=True (recursive-safe short-circuit).

    Extracted so that unit tests can spy on the rollback decision point without
    going through the full orchestrator re-entry.
    """
    if no_rollback:
        # D-04 guard: this branch fires on the inner recursive call from
        # rollback() — return 6 immediately, no envelope (the outer rollback
        # will emit it).
        return 6

    from .rollback import rollback as do_rollback

    return do_rollback(failed_new, old_profile, port, run_dir)


# --- CLI ---------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="emmy-serve swap-profile",
        description=(
            "Atomically swap the loaded profile with pre-flight validation "
            "+ rollback on failure (PROFILE-08)."
        ),
    )
    p.add_argument(
        "--from",
        required=True,
        dest="old_profile",
        help="path to profiles/<name>/v<N>/ currently loaded",
    )
    p.add_argument(
        "--to",
        required=True,
        dest="new_profile",
        help="path to profiles/<name>/v<N>/ to swap IN",
    )
    p.add_argument("--port", type=int, default=8002)
    p.add_argument("--run-dir", default="runs/swap")
    p.add_argument(
        "--no-rollback",
        action="store_true",
        help=(
            "skip rollback on post-stop failure; only used internally by "
            "rollback() to prevent infinite recursion"
        ),
    )
    args = p.parse_args(argv)
    return swap_profile(
        Path(args.old_profile),
        Path(args.new_profile),
        args.port,
        Path(args.run_dir),
        no_rollback=args.no_rollback,
    )


__all__ = ["swap_profile", "main"]


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
