"""GREEN — POST /stop handler graceful drain (Phase 04.2 Plan 01 Task 3).

Covers D-01 LOCKED:
    - 30s grace period polling vllm:num_requests_running
    - SIGTERM at deadline; SIGKILL after another 5s if still alive
    - 'draining N requests' SSE event emitted with in_flight count
    - 409 if state != READY
    - Idempotency: /stop during DRAINING returns 409 with current state
      (per T-04.2-S8 mitigation — no second drain loop, no deadline reset)

The os.kill side-effect is intercepted by a spy + asyncio.sleep is patched to
0 so the 30s timeout test runs in <100ms.
"""
from __future__ import annotations

import asyncio
import json
import signal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from emmy_serve.swap import controller as _ctl
from emmy_serve.swap.state import SidecarState


# --- spy + autouse reset ----------------------------------------------------


class _KillSpy:
    """Record every os.kill call: (pid, signal)."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, int]] = []
        self.alive_after_sigterm: bool = True  # default: process clings to life

    def __call__(self, pid: int, sig: int) -> None:
        if sig == 0:
            # signal-0 = "is process alive?". After SIGTERM, vary based on flag.
            sigterm_calls = [c for c in self.calls if c[1] == signal.SIGTERM]
            if sigterm_calls and not self.alive_after_sigterm:
                raise ProcessLookupError("process exited (test fake)")
            return
        self.calls.append((pid, sig))


@pytest.fixture(autouse=True)
def _reset_runtime() -> None:
    _ctl._reset_runtime_for_tests()


@pytest.fixture
def kill_spy(monkeypatch: pytest.MonkeyPatch) -> _KillSpy:
    spy = _KillSpy()
    monkeypatch.setattr(_ctl.os, "kill", spy)
    return spy


@pytest.fixture
def fast_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch asyncio.sleep inside controller to a no-op so drain runs fast."""

    async def _no_sleep(seconds: float) -> None:
        return None

    monkeypatch.setattr(_ctl.asyncio, "sleep", _no_sleep)


@pytest.fixture
def client() -> TestClient:
    return TestClient(_ctl.app)


def _data_frames_from_text(text: str) -> list[dict]:
    """Parse 'data: {json}' SSE frames out of a buffered response body string.

    TestClient's `client.post` collects the full SSE stream into r.text once
    the server closes the connection (which our generator does after yielding
    the final frame). We use this instead of `client.stream` + iter_lines
    because the latter blocks waiting for sse-starlette's keepalive ping.
    """
    frames: list[dict] = []
    for line in text.splitlines():
        if line.startswith("data:"):
            payload = line[len("data:") :].strip()
            if payload:
                try:
                    frames.append(json.loads(payload))
                except json.JSONDecodeError:
                    continue
    return frames


async def _into_ready_with_pid() -> None:
    """Pre-position: STOPPED → READY with a tracked PID."""
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._vllm_pid = 12345
    _ctl._current_profile_id = "gemma-4-26b-a4b-it"
    _ctl._current_variant = "v2.1"


# --- D-01 happy drain -------------------------------------------------------


async def test_drain_then_sigterm(
    client: TestClient,
    kill_spy: _KillSpy,
    fast_sleep: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """First poll: in_flight=2 → second poll: in_flight=0 → SIGTERM, no SIGKILL."""
    await _into_ready_with_pid()
    kill_spy.alive_after_sigterm = False  # process exits cleanly on SIGTERM

    poll_count = {"n": 0}

    async def _fake_metrics(base_url: str = "http://127.0.0.1:8002") -> dict[str, float]:
        poll_count["n"] += 1
        return {"vllm:num_requests_running": 2.0 if poll_count["n"] == 1 else 0.0}

    monkeypatch.setattr(_ctl, "fetch_vllm_metrics_cached", _fake_metrics)

    r = client.post("/stop", json={})
    assert r.status_code == 200
    _data_frames_from_text(r.text)

    # SIGTERM exactly once, no SIGKILL.
    sigterms = [c for c in kill_spy.calls if c[1] == signal.SIGTERM]
    sigkills = [c for c in kill_spy.calls if c[1] == signal.SIGKILL]
    assert len(sigterms) == 1, f"expected 1 SIGTERM, got {sigterms}"
    assert sigkills == [], f"expected NO SIGKILL when process exits cleanly, got {sigkills}"

    # State STOPPED, _vllm_pid cleared.
    assert _ctl.state.state == SidecarState.STOPPED
    assert _ctl._vllm_pid is None


async def test_drain_event_emitted(
    client: TestClient,
    kill_spy: _KillSpy,
    fast_sleep: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """At least one SSE frame contains phase='draining' and in_flight=2."""
    await _into_ready_with_pid()
    kill_spy.alive_after_sigterm = False

    async def _fake_metrics(base_url: str = "http://127.0.0.1:8002") -> dict[str, float]:
        return {"vllm:num_requests_running": 2.0}

    monkeypatch.setattr(_ctl, "fetch_vllm_metrics_cached", _fake_metrics)
    # Shorten drain window so a never-draining vLLM exits quickly.
    monkeypatch.setattr(_ctl, "_DRAIN_GRACE_S", 0)
    monkeypatch.setattr(_ctl, "_SIGKILL_WAIT_S", 0)

    r = client.post("/stop", json={})
    frames = _data_frames_from_text(r.text)

    draining_frames = [f for f in frames if f.get("phase") == "draining"]
    assert draining_frames, f"expected at least one draining frame in {frames}"
    assert draining_frames[0]["details"]["in_flight"] == 2


async def test_sigkill_when_drain_exceeds_30s(
    client: TestClient,
    kill_spy: _KillSpy,
    fast_sleep: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """vLLM never drains AND never exits on SIGTERM → SIGTERM, then SIGKILL.

    Uses the module-level _DRAIN_GRACE_S / _SIGKILL_WAIT_S overrides instead
    of patching time.monotonic globally (which corrupts asyncio's loop time
    tracking — see commit history for the deferred-bug avoidance).
    """
    await _into_ready_with_pid()
    kill_spy.alive_after_sigterm = True  # vLLM ignores SIGTERM

    async def _fake_metrics(base_url: str = "http://127.0.0.1:8002") -> dict[str, float]:
        return {"vllm:num_requests_running": 2.0}

    monkeypatch.setattr(_ctl, "fetch_vllm_metrics_cached", _fake_metrics)
    # Shorten both timeouts so the loops trip immediately.
    monkeypatch.setattr(_ctl, "_DRAIN_GRACE_S", 0)
    monkeypatch.setattr(_ctl, "_SIGKILL_WAIT_S", 0)

    r = client.post("/stop", json={})
    _data_frames_from_text(r.text)

    sigterms = [c for c in kill_spy.calls if c[1] == signal.SIGTERM]
    sigkills = [c for c in kill_spy.calls if c[1] == signal.SIGKILL]
    assert len(sigterms) == 1, f"expected 1 SIGTERM, got {sigterms}"
    assert len(sigkills) == 1, f"expected 1 SIGKILL when vLLM doesn't exit, got {sigkills}"
    assert sigterms[0][0] == 12345
    assert sigkills[0][0] == 12345


# --- 409 guards -------------------------------------------------------------


async def test_409_when_not_ready(client: TestClient, kill_spy: _KillSpy) -> None:
    """STOPPED → /stop returns 409."""
    # Leave state at STOPPED (default after _reset_runtime_for_tests).
    r = client.post("/stop", json={})
    assert r.status_code == 409
    assert "stop requires state=ready" in r.text
    assert kill_spy.calls == []


async def test_idempotent_stop_during_draining(client: TestClient, kill_spy: _KillSpy) -> None:
    """T-04.2-S8 mitigation: /stop during DRAINING returns 409 (no deadline reset)."""
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    await _ctl.state.transition_to(SidecarState.DRAINING)

    r = client.post("/stop", json={})
    assert r.status_code == 409
    assert "draining" in r.text
    assert kill_spy.calls == []


async def test_stop_with_no_pid_still_transitions_to_stopped(
    client: TestClient,
    kill_spy: _KillSpy,
    fast_sleep: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """vllm_pid == None → drain loop exits, no SIGTERM, state → STOPPED."""
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._vllm_pid = None  # explicit: no PID tracked

    async def _fake_metrics(base_url: str = "http://127.0.0.1:8002") -> dict[str, float]:
        return {"vllm:num_requests_running": 0.0}

    monkeypatch.setattr(_ctl, "fetch_vllm_metrics_cached", _fake_metrics)

    r = client.post("/stop", json={})
    _data_frames_from_text(r.text)

    assert kill_spy.calls == []
    assert _ctl.state.state == SidecarState.STOPPED
