"""GREEN — Swap orchestrator post-stop failure paths + rollback (Plan 04-02 Task 2).

Test matrix:
    wait_for_vllm timeout      -> rollback fires, exit 6, envelope JSON on stdout
    smoke_test returncode != 0 -> rollback fires, exit 6, envelope JSON on stdout
    no_rollback=True short-circuit -> exit 6, NO rollback call, NO envelope
    preflight fail             -> exit 5, NO docker stop/run calls (D-05)
    rollback-of-rollback prevented -> rollback() invokes swap_profile(... no_rollback=True)
    rollback_succeeded=false envelope -> inner swap fails, envelope reflects it

D-04 LOCKED: rollback goes through the SAME primitive via no_rollback=True.
D-05 LOCKED: pre-flight failure ⇒ prior engine still running.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from emmy_serve.swap import orchestrator as orch_mod
from emmy_serve.swap import rollback as rb_mod
from emmy_serve.swap import preflight as preflight_mod
from emmy_serve.swap.orchestrator import swap_profile
from emmy_serve.swap.preflight import PreflightResult


REPO_ROOT = Path(__file__).resolve().parents[2]
V31_PROFILE = REPO_ROOT / "profiles" / "qwen3.6-35b-a3b" / "v3.1"


# --- subprocess spy shared across tests --------------------------------------


class _SubprocessSpy:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.returncodes: dict[str, int] = {}

    def set_rc(self, prefix: str, rc: int) -> None:
        self.returncodes[prefix] = rc

    def __call__(self, argv: list[str], *a: Any, **kw: Any) -> subprocess.CompletedProcess:
        self.calls.append(list(argv))
        key = " ".join(argv[:2]) if len(argv) >= 2 else argv[0]
        rc = self.returncodes.get(key, 0)
        return subprocess.CompletedProcess(args=argv, returncode=rc, stdout=b"", stderr=b"")

    def called_with(self, *prefix: str) -> bool:
        return any(argv[: len(prefix)] == list(prefix) for argv in self.calls)


@pytest.fixture
def spy(monkeypatch: pytest.MonkeyPatch) -> _SubprocessSpy:
    """Spy subprocess.run in both orchestrator and rollback modules."""
    s = _SubprocessSpy()
    monkeypatch.setattr(orch_mod.subprocess, "run", s)
    monkeypatch.setattr(rb_mod.subprocess, "run", s)
    return s


@pytest.fixture
def happy_preflight(monkeypatch: pytest.MonkeyPatch) -> None:
    """Short-circuit preflight to a successful result with synthetic args.

    Prevents tests from hitting the real pydantic schema / hasher / docker
    inspect flow — tests here are about the orchestrator pipeline AFTER
    preflight passes.
    """
    def _happy(new_profile: Path, port: int, run_dir: Path) -> PreflightResult:
        return PreflightResult(
            exit_code=0,
            error_msg=None,
            image_ref="sha256:" + "a" * 64,
            docker_args=["--mock", "docker-arg", "sha256:" + "a" * 64, "vllm", "serve"],
        )

    monkeypatch.setattr(orch_mod, "run_preflight", _happy)


@pytest.fixture
def time_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    """Collapse time.sleep so the defensive CUDA drain doesn't slow tests."""
    monkeypatch.setattr(orch_mod.time, "sleep", lambda *_a, **_kw: None)


# --- rollback call-site spy --------------------------------------------------


class _RollbackSpy:
    """Replace rollback(...) with a spy that records call args + returns a
    configurable exit code. Used to assert (a) rollback IS called on post-stop
    failure, (b) rollback is NOT called when no_rollback=True, and
    (c) rollback receives no_rollback=True on its recursive swap_profile call.
    """

    def __init__(self, envelope_succeeded: bool = True) -> None:
        self.calls: list[dict] = []
        self.envelope_succeeded = envelope_succeeded

    def __call__(
        self, failed_new: Path, prior_old: Path, port: int, run_dir: Path
    ) -> int:
        self.calls.append(
            {
                "failed_new": failed_new,
                "prior_old": prior_old,
                "port": port,
                "run_dir": run_dir,
            }
        )
        envelope = {
            "rolled_back": True,
            "rollback_succeeded": self.envelope_succeeded,
        }
        print(json.dumps(envelope), flush=True)
        return 6


# --- exit 6: wait_for_vllm timeout triggers rollback -------------------------


def test_rollback_fires_on_boot_timeout(
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
    spy: _SubprocessSpy,
    happy_preflight: None,
    time_fast: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """wait_for_vllm raises TimeoutError → rollback fires → exit 6."""
    def _timeout(*a: Any, **kw: Any) -> None:
        raise TimeoutError("/v1/models did not respond in 300s; last error: EOF")

    monkeypatch.setattr(orch_mod, "wait_for_vllm", _timeout)

    rb_spy = _RollbackSpy(envelope_succeeded=True)
    # Patch the lazy import inside _maybe_rollback — the function does
    # `from .rollback import rollback as do_rollback` at call-time, so
    # patch the attribute on the rollback MODULE (which is what that import
    # resolves to).
    monkeypatch.setattr(rb_mod, "rollback", rb_spy)

    rc = swap_profile(
        old_profile=Path("old/profile"),
        new_profile=V31_PROFILE,
        port=8002,
        run_dir=tmp_path / "runs" / "swap",
    )

    assert rc == 6
    assert len(rb_spy.calls) == 1, f"rollback should fire once, saw {rb_spy.calls}"
    # Final stdout line is the envelope.
    out = capsys.readouterr().out
    lines = [ln for ln in out.strip().splitlines() if ln.strip()]
    envelope = json.loads(lines[-1])
    assert envelope == {"rolled_back": True, "rollback_succeeded": True}


# --- exit 6: smoke_test returncode != 0 triggers rollback -------------------


def test_rollback_fires_on_smoke_fail(
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
    spy: _SubprocessSpy,
    happy_preflight: None,
    time_fast: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """scripts/smoke_test.py exits non-zero → rollback fires → exit 6."""
    # wait_for_vllm succeeds
    monkeypatch.setattr(orch_mod, "wait_for_vllm", lambda *a, **kw: None)
    # smoke_test subprocess returns non-zero. The `_build_smoke_cmd` result
    # starts with ["uv", "run", "python", ...] — our spy.__call__ matches on
    # first two argv (`"uv run"`), so we set rc there.
    spy.set_rc("uv run", 1)

    rb_spy = _RollbackSpy(envelope_succeeded=True)
    monkeypatch.setattr(rb_mod, "rollback", rb_spy)

    rc = swap_profile(
        old_profile=Path("old/profile"),
        new_profile=V31_PROFILE,
        port=8002,
        run_dir=tmp_path / "runs" / "swap",
    )

    assert rc == 6
    assert len(rb_spy.calls) == 1
    lines = [ln for ln in capsys.readouterr().out.strip().splitlines() if ln.strip()]
    envelope = json.loads(lines[-1])
    assert envelope["rolled_back"] is True
    assert envelope["rollback_succeeded"] is True


# --- exit 6 without envelope: no_rollback=True short-circuits ----------------


def test_no_rollback_flag_short_circuits(
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
    spy: _SubprocessSpy,
    happy_preflight: None,
    time_fast: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """swap_profile(..., no_rollback=True) on boot failure returns 6 without
    invoking rollback and without emitting the envelope line.
    """
    def _timeout(*a: Any, **kw: Any) -> None:
        raise TimeoutError("timeout")

    monkeypatch.setattr(orch_mod, "wait_for_vllm", _timeout)

    rb_spy = _RollbackSpy()
    monkeypatch.setattr(rb_mod, "rollback", rb_spy)

    rc = swap_profile(
        old_profile=Path("old/profile"),
        new_profile=V31_PROFILE,
        port=8002,
        run_dir=tmp_path / "runs" / "swap",
        no_rollback=True,
    )

    assert rc == 6
    assert rb_spy.calls == [], "rollback must NOT fire when no_rollback=True"
    # Confirm no envelope was printed.
    stdout = capsys.readouterr().out
    for line in stdout.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        assert "rolled_back" not in rec, f"unexpected envelope: {rec}"


# --- exit 5: preflight fail, prior engine untouched -------------------------


def test_preflight_fail_returns_5_prior_engine_untouched(
    tmp_path: Path,
    spy: _SubprocessSpy,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Preflight fail (synthetic) → exit 5, no docker stop/run/rm ever issued.

    Proves D-04/D-05: prior engine still running when pre-flight fails.
    """
    def _bad_preflight(new_profile: Path, port: int, run_dir: Path) -> PreflightResult:
        return PreflightResult(
            exit_code=2,
            error_msg="schema invalid: synthetic",
            image_ref=None,
            docker_args=None,
        )

    monkeypatch.setattr(orch_mod, "run_preflight", _bad_preflight)

    rc = swap_profile(
        old_profile=Path("old/profile"),
        new_profile=V31_PROFILE,
        port=8002,
        run_dir=tmp_path / "runs" / "swap",
    )

    assert rc == 5
    # NO destructive docker commands may have been issued.
    assert not spy.called_with("docker", "stop"), f"calls: {spy.calls}"
    assert not spy.called_with("docker", "rm"), f"calls: {spy.calls}"
    assert not spy.called_with("docker", "run"), f"calls: {spy.calls}"


# --- rollback-of-rollback prevention ----------------------------------------


def test_rollback_of_rollback_prevented(
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
    spy: _SubprocessSpy,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """rollback() invokes swap_profile with no_rollback=True to prevent loops.

    Test approach: patch swap_profile at the orchestrator-module level (which
    rollback imports via `from .orchestrator import swap_profile`) to a spy
    that records kwargs. Assert no_rollback=True is forwarded.
    """
    import emmy_serve.swap.orchestrator as orch

    captured_kwargs: list[dict] = []

    def _swap_spy(
        old_profile: Path,
        new_profile: Path,
        port: int,
        run_dir: Path,
        *,
        no_rollback: bool = False,
    ) -> int:
        captured_kwargs.append({"no_rollback": no_rollback})
        return 0  # success so envelope reports rollback_succeeded=True

    # rollback() does a LAZY import: `from .orchestrator import swap_profile`.
    # To intercept the lazy resolution, patch the symbol on the orchestrator
    # module (which is the source the `from .orchestrator import ...` reads).
    monkeypatch.setattr(orch, "swap_profile", _swap_spy)

    rc = rb_mod.rollback(
        failed_new=Path("failed/new"),
        prior_old=Path("prior/old"),
        port=8002,
        run_dir=tmp_path / "runs" / "swap",
    )

    assert rc == 6
    assert len(captured_kwargs) == 1
    assert captured_kwargs[0]["no_rollback"] is True, (
        "rollback MUST forward no_rollback=True to its recursive swap_profile "
        "call — violation would cause infinite rollback loops (T-04-02-02)"
    )
    # Envelope reports success.
    lines = [ln for ln in capsys.readouterr().out.strip().splitlines() if ln.strip()]
    envelope = json.loads(lines[-1])
    assert envelope == {"rolled_back": True, "rollback_succeeded": True}


# --- envelope reports failure when inner swap fails -------------------------


def test_rollback_envelope_failure(
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
    spy: _SubprocessSpy,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the inner swap_profile also fails, envelope.rollback_succeeded is False."""
    import emmy_serve.swap.orchestrator as orch

    def _failing_inner_swap(*a: Any, **kw: Any) -> int:
        # Inner swap also fails — e.g. prior profile too had a problem.
        return 6

    monkeypatch.setattr(orch, "swap_profile", _failing_inner_swap)

    rc = rb_mod.rollback(
        failed_new=Path("failed/new"),
        prior_old=Path("prior/old"),
        port=8002,
        run_dir=tmp_path / "runs" / "swap",
    )

    assert rc == 6
    lines = [ln for ln in capsys.readouterr().out.strip().splitlines() if ln.strip()]
    envelope = json.loads(lines[-1])
    assert envelope == {"rolled_back": True, "rollback_succeeded": False}
