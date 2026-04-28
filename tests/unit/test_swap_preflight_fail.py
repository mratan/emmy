"""GREEN — Swap pre-flight validator exit codes (Plan 04-02 Task 1).

D-05 "validate-first-then-stop" invariant: preflight NEVER calls
``docker stop`` / ``docker rm`` / ``docker run``. Only ``docker inspect``
is permitted. Every failure branch is asserted not to mutate engine state.

Test matrix:
    happy path                   -> exit 0, image_ref + docker_args populated
    validate_bundle != 0         -> exit 2, error_msg contains "schema invalid"
    hash_bundle recompute drift  -> exit 2, error_msg contains "hash mismatch"
    docker inspect returncode≠0  -> exit 3, error_msg contains "image not in local docker"
    render_docker_args raises    -> exit 4, error_msg contains "render_docker_args failed"
    every failure                -> no "docker stop|run|rm" subprocess call
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

# Import the module under test eagerly — failure to import means the swap
# package does not exist yet (RED state in TDD parlance).
from emmy_serve.swap import preflight as preflight_mod
from emmy_serve.swap.preflight import PreflightResult, run_preflight


REPO_ROOT = Path(__file__).resolve().parents[2]
V31_PROFILE = REPO_ROOT / "profiles" / "gemma-4-26b-a4b-it" / "v2.1"


# --- subprocess spy -----------------------------------------------------------


class _SubprocessSpy:
    """Record every subprocess.run call for post-hoc invariant assertions.

    `returncode_for(argv)` decides what each call returns — by default
    `docker inspect` → 0, everything else → 0 as well. Tests override per-call.
    """

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.returncodes: dict[str, int] = {}  # first-arg-joined-by-space -> rc

    def set_rc(self, argv_prefix: str, rc: int) -> None:
        self.returncodes[argv_prefix] = rc

    def __call__(self, argv: list[str], *args: Any, **kwargs: Any) -> subprocess.CompletedProcess:
        self.calls.append(list(argv))
        key = " ".join(argv[:2]) if len(argv) >= 2 else argv[0]
        rc = self.returncodes.get(key, 0)
        return subprocess.CompletedProcess(args=argv, returncode=rc, stdout=b"", stderr=b"")

    # --- invariant helpers ---

    def ever_called_destructive_docker(self) -> bool:
        """True iff any call looks like `docker stop|rm|run`."""
        for argv in self.calls:
            if len(argv) < 2 or argv[0] != "docker":
                continue
            if argv[1] in ("stop", "rm", "run"):
                return True
        return False


@pytest.fixture
def spy(monkeypatch: pytest.MonkeyPatch) -> _SubprocessSpy:
    """Monkeypatch subprocess.run INSIDE the preflight module — each test
    gets a fresh spy that records calls and decides returncodes.
    """
    s = _SubprocessSpy()
    monkeypatch.setattr(preflight_mod.subprocess, "run", s)
    return s


# --- happy path ---------------------------------------------------------------


def test_preflight_happy_path_returns_0(tmp_path: Path, spy: _SubprocessSpy) -> None:
    """A valid profile + present image + render_docker_args success → exit 0."""
    run_dir = tmp_path / "runs"
    run_dir.mkdir()

    # Default spy returncode 0 for docker inspect — happy case.
    result = run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)

    assert isinstance(result, PreflightResult)
    assert result.exit_code == 0, f"expected exit 0, got {result.exit_code}: {result.error_msg}"
    assert result.error_msg is None
    assert result.image_ref is not None and result.image_ref.startswith(("sha256:", "nvcr.io/"))
    assert result.docker_args is not None and len(result.docker_args) > 5

    # Exactly one docker call was issued — docker inspect.
    docker_calls = [c for c in spy.calls if c and c[0] == "docker"]
    assert len(docker_calls) == 1, f"expected 1 docker call, got {docker_calls}"
    assert docker_calls[0][1] == "inspect"


# --- exit 2 — schema ----------------------------------------------------------


def test_preflight_schema_invalid_exits_2(
    tmp_path: Path, spy: _SubprocessSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """validate_bundle returns 1 → preflight returns exit_code=2."""
    monkeypatch.setattr(preflight_mod, "validate_bundle", lambda *a, **kw: 1)
    run_dir = tmp_path / "runs"
    run_dir.mkdir()

    result = run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)

    assert result.exit_code == 2
    assert result.error_msg is not None
    assert "schema invalid" in result.error_msg
    # Invariant: no docker stop/rm/run issued
    assert not spy.ever_called_destructive_docker()


# --- exit 2 — hash mismatch ---------------------------------------------------


def test_preflight_hash_mismatch_exits_2(
    tmp_path: Path, spy: _SubprocessSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """hash_bundle returns a different sha than stored → exit 2."""
    # Force validate_bundle to pass (so the hash check is the one that fails).
    monkeypatch.setattr(preflight_mod, "validate_bundle", lambda *a, **kw: 0)
    # Make hash_bundle return a value that cannot match stored.
    fake_hash = "sha256:" + "0" * 64
    monkeypatch.setattr(preflight_mod, "hash_bundle", lambda *a, **kw: fake_hash)
    run_dir = tmp_path / "runs"
    run_dir.mkdir()

    result = run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)

    assert result.exit_code == 2
    assert result.error_msg is not None
    assert "hash mismatch" in result.error_msg
    assert fake_hash in result.error_msg  # computed surfaced
    assert not spy.ever_called_destructive_docker()


# --- exit 3 — image missing ---------------------------------------------------


def test_preflight_image_missing_exits_3(
    tmp_path: Path, spy: _SubprocessSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """docker inspect returncode != 0 → exit 3."""
    spy.set_rc("docker inspect", 1)
    run_dir = tmp_path / "runs"
    run_dir.mkdir()

    result = run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)

    assert result.exit_code == 3
    assert result.error_msg is not None
    assert "image not in local docker" in result.error_msg
    # inspect was called (once), but no destructive docker ops.
    assert any(c[:2] == ["docker", "inspect"] for c in spy.calls)
    assert not spy.ever_called_destructive_docker()


# --- exit 4 — render_docker_args raises ---------------------------------------


def test_preflight_docker_args_render_fails_exits_4(
    tmp_path: Path, spy: _SubprocessSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """render_docker_args raising any exception → exit 4."""
    def _boom(*a: Any, **kw: Any) -> list[str]:
        raise RuntimeError("synthetic render failure")

    monkeypatch.setattr(preflight_mod, "render_docker_args", _boom)
    run_dir = tmp_path / "runs"
    run_dir.mkdir()

    result = run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)

    assert result.exit_code == 4
    assert result.error_msg is not None
    assert "render_docker_args failed" in result.error_msg
    assert "synthetic render failure" in result.error_msg
    assert not spy.ever_called_destructive_docker()


# --- invariant: no destructive docker commands ever -------------------------


def test_preflight_NEVER_calls_docker_stop_or_run(
    tmp_path: Path, spy: _SubprocessSpy, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Master invariant test (D-05): across ALL failure modes, preflight issues
    only `docker inspect` (and nothing else that starts with `docker`).

    Runs every failure path back-to-back against the same spy; a single call
    to `docker stop`, `docker rm`, or `docker run` fails the test.
    """
    run_dir = tmp_path / "runs"
    run_dir.mkdir()

    # 1. schema fail
    monkeypatch.setattr(preflight_mod, "validate_bundle", lambda *a, **kw: 1)
    run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)
    monkeypatch.setattr(preflight_mod, "validate_bundle", lambda *a, **kw: 0)

    # 2. hash mismatch
    monkeypatch.setattr(
        preflight_mod, "hash_bundle", lambda *a, **kw: "sha256:" + "1" * 64
    )
    run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)

    # Restore hash_bundle to original (will now match stored) so next test
    # hits docker inspect step.
    from emmy_serve.profile.hasher import hash_bundle as real_hash_bundle
    monkeypatch.setattr(preflight_mod, "hash_bundle", real_hash_bundle)

    # 3. image missing
    spy.set_rc("docker inspect", 1)
    run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)
    spy.set_rc("docker inspect", 0)

    # 4. render_docker_args raises
    def _boom(*a: Any, **kw: Any) -> list[str]:
        raise RuntimeError("boom")

    monkeypatch.setattr(preflight_mod, "render_docker_args", _boom)
    run_preflight(V31_PROFILE, port=8002, run_dir=run_dir)

    # MASTER ASSERTION: no docker stop/rm/run was ever called.
    destructive = [c for c in spy.calls if c[:1] == ["docker"] and len(c) >= 2 and c[1] in ("stop", "rm", "run")]
    assert destructive == [], (
        f"D-05 INVARIANT VIOLATED: preflight issued destructive docker commands: "
        f"{destructive}"
    )
