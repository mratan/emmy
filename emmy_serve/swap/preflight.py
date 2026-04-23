"""Swap pre-flight validator — D-05 LOCKED "validate-first-then-stop".

Runs every check that CAN fail BEFORE the running engine is torn down:
    1. profile schema + hash (validate_bundle, strict)
    2. stored-vs-computed hash recompute
    3. image digest exists in local docker (via an inspect call)
    4. render_docker_args succeeds (serves as a deeper serving.yaml check)

D-05 invariant: preflight issues at most one docker inspect call and
NEVER any destructive lifecycle command. The invariant is enforced
behaviorally by the companion unit tests which spy on subprocess and
assert the negative.

Exit-code contract (mirrors start_emmy.sh):
    0  pre-flight OK
    2  schema invalid OR hash mismatch
    3  image digest missing from local docker
    4  render_docker_args raised (prereq missing / serving.yaml shape error)

Caller (swap_profile orchestrator) maps any non-zero into exit 5 when the
prior engine is still alive.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..boot.runner import render_docker_args, render_image_ref
from ..profile.hasher import hash_bundle
from ..profile.immutability import validate_bundle
from ..profile.loader import load_profile


class PreflightError(Exception):
    """Raised only by tests that opt into exception-based flow; the primary
    API returns a PreflightResult whose exit_code conveys failure.
    """


@dataclass(frozen=True)
class PreflightResult:
    """Outcome of pre-flight validation — a pure data envelope.

    On success: exit_code == 0, error_msg is None, image_ref and
    docker_args are populated. On failure: exit_code is 2/3/4 and
    error_msg carries a human-readable reason for the diagnostic bundle.
    """

    exit_code: int
    error_msg: str | None
    image_ref: str | None
    docker_args: list[str] | None


def run_preflight(
    new_profile: Path,
    port: int,
    run_dir: Path,
) -> PreflightResult:
    """Validate every swap prerequisite that can be checked while the
    running engine is left untouched. Return a PreflightResult.

    Contract: at most one docker inspect invocation; no destructive
    lifecycle call. Enforced behaviorally by the companion unit tests
    under tests/unit/test_swap_preflight_fail.py.
    """
    new_profile = Path(new_profile)

    # -- (1) Schema + stored-hash-shape validation ---------------------------
    rc = validate_bundle(new_profile, fix_hash=False, strict=True)
    if rc != 0:
        return PreflightResult(
            exit_code=2,
            error_msg=f"schema invalid: validate_bundle returned {rc}",
            image_ref=None,
            docker_args=None,
        )

    # -- (2) Stored-vs-computed hash recompute -------------------------------
    # validate_bundle already compares hashes; the extra recompute here is
    # a belt-and-suspenders guard — a monkeypatched hasher in tests can trip
    # this branch independently of the schema layer.
    try:
        _, _, profile_ref = load_profile(new_profile)
    except Exception as e:
        return PreflightResult(
            exit_code=2,
            error_msg=f"schema invalid: cannot load profile manifest: {e}",
            image_ref=None,
            docker_args=None,
        )
    stored = profile_ref.hash
    computed = hash_bundle(new_profile)
    if computed != stored:
        return PreflightResult(
            exit_code=2,
            error_msg=f"hash mismatch: stored={stored} computed={computed}",
            image_ref=None,
            docker_args=None,
        )

    # -- (3) Docker image digest check ---------------------------------------
    # render_image_ref returns either "<repo>@<digest>" or bare "sha256:<hex>".
    # docker inspect accepts both.
    try:
        image_ref = render_image_ref(new_profile)
    except Exception as e:
        return PreflightResult(
            exit_code=4,
            error_msg=f"render_image_ref failed: {e}",
            image_ref=None,
            docker_args=None,
        )
    inspect = subprocess.run(
        ["docker", "inspect", image_ref],
        capture_output=True,
    )
    if inspect.returncode != 0:
        return PreflightResult(
            exit_code=3,
            error_msg=f"image not in local docker: {image_ref}",
            image_ref=image_ref,
            docker_args=None,
        )

    # -- (4) render_docker_args (deeper serving.yaml check) ------------------
    try:
        docker_args = render_docker_args(
            new_profile, run_dir, port, airgap=False
        )
    except Exception as e:
        return PreflightResult(
            exit_code=4,
            error_msg=f"render_docker_args failed: {e}",
            image_ref=image_ref,
            docker_args=None,
        )

    return PreflightResult(
        exit_code=0,
        error_msg=None,
        image_ref=image_ref,
        docker_args=docker_args,
    )


__all__ = ["run_preflight", "PreflightResult", "PreflightError"]
