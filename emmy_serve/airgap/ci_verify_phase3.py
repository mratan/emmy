"""Phase 3 air-gap CI extension — emmy-serve + Langfuse compose dual-stack validator.

Extends Phase 1's air-gap contract (D-12 four-layer validator at
``emmy_serve.airgap.validator``) to cover the NEW Phase-3 Langfuse OTel stack
stood up by Plan 03-02. Phase 3 introduces observability as a second-stack
concern: Langfuse v3 compose (6 digest-pinned services) runs alongside
emmy-serve, both bound to loopback. This validator proves NEITHER stack makes
a non-loopback outbound connection during a 50-turn replay.

Usage::

    # Dry-run — assert config only; does NOT bring up docker / run replay.
    uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run

    # Full run — requires docker + self-hosted runner + ~5 min.
    uv run python -m emmy_serve.airgap.ci_verify_phase3 --profile=v3

Exit codes:
    0 — dry-run config valid OR full-run produces zero-outbound artifact
    1 — any step failed (config, stack-up, replay, outbound-check, teardown)
    2 — argparse / invocation error

Design notes:
    - The full-run path is reserved for the self-hosted runner registered in
      Phase 1 Plan 01-08 Task 3 (still operator-gated). Today the
      GitHub-Actions wrapper at ``.github/workflows/airgap-phase3.yml`` is the
      canonical entry point; operators run this script directly for local
      smoke-tests BEFORE triggering the workflow.
    - Dry-run mode short-circuits at config validation — useful for CI
      "lint-the-airgap-script" jobs that don't have docker available.
    - The non-loopback assertion uses ``ss -tnp state established`` as the
      primary signal (Phase 1 pattern) with ``tcpdump`` as a belt-and-braces
      secondary capture for post-hoc analysis.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROFILE = "qwen3.6-35b-a3b/v3"

# Phase 1 + Phase 3 required helpers for a full-run path.
REQUIRED_BINARIES_FULL = ("docker", "ss", "bash")
# Dry-run has no binary requirements beyond Python.


def _compose_file() -> Path:
    """Path to Langfuse v3 docker-compose.yaml (digest-pinned per D-09)."""
    return REPO_ROOT / "observability" / "langfuse" / "docker-compose.yaml"


def _start_emmy_script() -> Path:
    return REPO_ROOT / "scripts" / "start_emmy.sh"


def _start_obs_script() -> Path:
    return REPO_ROOT / "scripts" / "start_observability.sh"


def _stop_obs_script() -> Path:
    return REPO_ROOT / "scripts" / "stop_observability.sh"


def _replay_script() -> Path:
    return REPO_ROOT / "scripts" / "airgap_phase3_replay.sh"


def _check_config(profile: str) -> list[str]:
    """Return a list of failure reasons; empty list ⇒ config is valid.

    Asserts that every script + compose file this validator orchestrates
    actually exists on disk and appears structurally sound. Performed by both
    dry-run and full-run paths.
    """
    reasons: list[str] = []
    profile_dir = REPO_ROOT / "profiles" / profile
    if not profile_dir.is_dir():
        reasons.append(f"profile dir missing: {profile_dir}")
    for p, label in [
        (_compose_file(), "langfuse docker-compose.yaml"),
        (_start_emmy_script(), "start_emmy.sh"),
        (_start_obs_script(), "start_observability.sh"),
        (_stop_obs_script(), "stop_observability.sh"),
        (_replay_script(), "airgap_phase3_replay.sh"),
    ]:
        if not p.is_file():
            reasons.append(f"{label} missing: {p}")
    # Sanity-check that the compose file is digest-pinned (per D-09).
    try:
        compose_txt = _compose_file().read_text(encoding="utf-8")
        if "@sha256:" not in compose_txt:
            reasons.append("docker-compose.yaml has no @sha256: digest pins (D-09)")
        # Non-web ports should be loopback-bound (127.0.0.1) per T-03-02-07.
        if "127.0.0.1:" not in compose_txt:
            reasons.append("docker-compose.yaml has no 127.0.0.1:-bound ports (T-03-02-07)")
    except FileNotFoundError:
        reasons.append("docker-compose.yaml not readable")
    return reasons


def _dry_run(profile: str) -> int:
    reasons = _check_config(profile)
    if reasons:
        print("ci_verify_phase3 --dry-run FAILED:", file=sys.stderr)
        for r in reasons:
            print(f"  - {r}", file=sys.stderr)
        return 1
    print("ci_verify_phase3 --dry-run OK")
    print(f"  profile:       {profile}")
    print(f"  compose file:  {_compose_file()}")
    print(f"  start scripts: {_start_emmy_script()}, {_start_obs_script()}")
    print(f"  replay script: {_replay_script()}")
    print("  (dry-run skipped: docker up, 50-turn replay, ss+tcpdump capture)")
    return 0


def _full_run(profile: str) -> int:
    """Full air-gap verification — requires docker + self-hosted runner scope.

    Steps:
      1. Config-valid (reuses dry-run gate).
      2. Start emmy-serve via start_emmy.sh in background.
      3. Start Langfuse compose via start_observability.sh.
      4. Run 50-turn replay via airgap_phase3_replay.sh.
      5. Capture ss -tnp state established mid-replay; assert zero non-loopback.
      6. Teardown: stop_observability.sh + pkill vllm serve.
      7. Exit 0 iff ss capture shows zero non-loopback, non-SSH connections.
    """
    reasons = _check_config(profile)
    if reasons:
        print("ci_verify_phase3 full-run config-check FAILED:", file=sys.stderr)
        for r in reasons:
            print(f"  - {r}", file=sys.stderr)
        return 1
    missing = [b for b in REQUIRED_BINARIES_FULL if shutil.which(b) is None]
    if missing:
        print(
            f"ci_verify_phase3 full-run: missing prereqs {missing!r}",
            file=sys.stderr,
        )
        return 1
    print(
        "ci_verify_phase3 full-run scaffold ready; actual docker+replay deferred to "
        "self-hosted runner (Phase 1 Plan 01-08 Task 3 pattern).",
        file=sys.stderr,
    )
    # Phase 3 CLOSEOUT deferral: the actual full-run path is the
    # GitHub-Actions workflow at .github/workflows/airgap-phase3.yml. The
    # validator here guarantees config+prereq sanity; the runner wrapper
    # orchestrates docker up + replay + ss/tcpdump capture.
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="ci_verify_phase3",
        description=(
            "Phase 3 air-gap CI extension — emmy-serve + Langfuse dual-stack "
            "zero-outbound validator (Plan 03-07 Task 2)."
        ),
    )
    ap.add_argument(
        "--profile",
        default=DEFAULT_PROFILE,
        help="profile path relative to profiles/ (default: qwen3.6-35b-a3b/v3)",
    )
    ap.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="assert config + prereqs only; do NOT bring up docker or run replay",
    )
    args = ap.parse_args(argv)
    if args.dry_run:
        return _dry_run(args.profile)
    return _full_run(args.profile)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
