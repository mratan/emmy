"""GREEN — POST /start handler (Phase 04.2 Plan 01 Task 3).

Covers D-02 LOCKED:
    - same-variant short-circuit returns single SSE 'ready' frame
    - cold-start argv has NO --from arg
    - cross-variant runs swap orchestrator + emits 4 D-02 phases over SSE
    - 409 if state ∉ {STOPPED, READY}
    - 400 if variant missing/empty (WARNING #10 fix — no silent 'v1' fallback)
    - error state on orchestrator non-zero exit

The orchestrator subprocess is monkeypatched out (NEVER spawn a real subprocess
in unit tests — too slow + side-effect-laden). The spy records (from_path,
to_path, port) tuples for invariant assertions.
"""
from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from emmy_serve.swap import controller as _ctl
from emmy_serve.swap.state import SidecarState


# --- spy + autouse reset ----------------------------------------------------


class _OrchestratorSpy:
    """Record every run_orchestrator_subprocess invocation; yield canned dicts.

    `set_yields(records)` configures what the next call yields. `calls` records
    one tuple per invocation: (from_path, to_path, port).
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._yields: list[dict] = [{"_internal_exit": 0}]

    def set_yields(self, records: list[dict]) -> None:
        self._yields = list(records)

    def __call__(
        self,
        *,
        from_path: str | None,
        to_path: str,
        port: int = 8002,
        cwd: str | None = None,
    ):
        self.calls.append({"from_path": from_path, "to_path": to_path, "port": port})

        async def _gen():
            for r in self._yields:
                yield r

        return _gen()


@pytest.fixture(autouse=True)
def _reset_runtime() -> None:
    """Module-level singletons in controller.py persist; clear before each test."""
    _ctl._reset_runtime_for_tests()


@pytest.fixture
def spy(monkeypatch: pytest.MonkeyPatch) -> _OrchestratorSpy:
    """Replace run_orchestrator_subprocess with a recording spy."""
    s = _OrchestratorSpy()
    monkeypatch.setattr(_ctl, "run_orchestrator_subprocess", s)
    return s


@pytest.fixture
def client() -> TestClient:
    return TestClient(_ctl.app)


def _consume_sse(response) -> list[str]:  # type: ignore[no-untyped-def]
    """Collect raw text lines from a TestClient streaming response."""
    out: list[str] = []
    for line in response.iter_lines():
        if line:
            out.append(line)
    return out


def _data_frames(lines: list[str]) -> list[dict]:
    """Parse 'data: {json}' SSE frames into dicts. Drops other lines."""
    frames: list[dict] = []
    for line in lines:
        if line.startswith("data:"):
            payload = line[len("data:") :].strip()
            if payload:
                try:
                    frames.append(json.loads(payload))
                except json.JSONDecodeError:
                    continue
    return frames


# --- D-02 idempotent same-variant short-circuit -----------------------------


async def test_idempotent_same_variant(client: TestClient, spy: _OrchestratorSpy) -> None:
    """READY + same profile + same variant → single SSE ready frame, no orch spawn."""
    # Pre-position: READY, profile=qwen3.6-35b-a3b, variant=v3.1-default.
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._current_profile_id = "qwen3.6-35b-a3b"
    _ctl._current_variant = "v3.1-default"

    with client.stream(
        "POST",
        "/start",
        json={"profile_id": "qwen3.6-35b-a3b", "variant": "v3.1-default"},
    ) as r:
        assert r.status_code == 200
        lines = _consume_sse(r)
    frames = _data_frames(lines)

    # Single 'ready' frame, no orchestrator invocation.
    assert len(frames) == 1, f"expected 1 frame, got {frames}"
    assert frames[0] == {"state": "ready", "phase": "ready"}
    assert spy.calls == [], f"expected no orchestrator calls, got {spy.calls}"


# --- D-02 cold start --------------------------------------------------------


async def test_cold_start_argv(client: TestClient, spy: _OrchestratorSpy) -> None:
    """STOPPED → STARTING → READY: orchestrator gets from_path=None (cold start)."""
    spy.set_yields(
        [
            {"ts": "2026-04-25T00:00:00Z", "phase": "loading weights", "pct": 0},
            {"ts": "2026-04-25T00:00:01Z", "phase": "warmup"},
            {"ts": "2026-04-25T00:00:02Z", "phase": "ready"},
            {"_internal_exit": 0},
        ]
    )

    with client.stream(
        "POST",
        "/start",
        json={"profile_id": "qwen3.6-35b-a3b", "variant": "v3.1-default"},
    ) as r:
        assert r.status_code == 200
        lines = _consume_sse(r)
    frames = _data_frames(lines)

    # Orchestrator was called exactly once with from_path=None (cold start).
    assert len(spy.calls) == 1
    assert spy.calls[0]["from_path"] is None
    assert spy.calls[0]["to_path"] == "profiles/qwen3.6-35b-a3b/v3.1-default"
    assert spy.calls[0]["port"] == 8002

    # 4 frames: 3 phases + exit.
    assert len(frames) == 4
    assert frames[-1] == {"exit": 0}

    # Final state: READY with current_profile/variant updated.
    assert _ctl.state.state == SidecarState.READY
    assert _ctl._current_profile_id == "qwen3.6-35b-a3b"
    assert _ctl._current_variant == "v3.1-default"


# --- WARNING #10 fix: variant required --------------------------------------


async def test_start_without_variant_returns_400(client: TestClient, spy: _OrchestratorSpy) -> None:
    """variant missing OR empty → 400; orchestrator NEVER invoked."""
    # Body 1: variant omitted entirely (Pydantic default = None).
    r1 = client.post("/start", json={"profile_id": "qwen3.6-35b-a3b"})
    assert r1.status_code == 400, r1.text
    assert "variant is required" in r1.text

    # Body 2: variant explicitly empty string.
    r2 = client.post("/start", json={"profile_id": "qwen3.6-35b-a3b", "variant": ""})
    assert r2.status_code == 400, r2.text
    assert "variant is required" in r2.text

    # Spy never invoked → orchestrator was never spawned.
    assert spy.calls == [], f"expected no orchestrator calls, got {spy.calls}"


async def test_start_path_traversal_rejected(client: TestClient, spy: _OrchestratorSpy) -> None:
    """T-04.2-S3 mitigation: '/' or '..' in profile_id/variant → 400."""
    bad_inputs = [
        {"profile_id": "../etc", "variant": "v1"},
        {"profile_id": "foo/bar", "variant": "v1"},
        {"profile_id": "qwen", "variant": "../etc"},
        {"profile_id": "qwen", "variant": "v3.1/default"},
    ]
    for body in bad_inputs:
        r = client.post("/start", json=body)
        assert r.status_code == 400, f"input {body!r} should be rejected: {r.text}"
        assert "invalid" in r.text
    assert spy.calls == [], f"path traversal must NEVER reach orchestrator: {spy.calls}"


# --- D-02 cross-variant swap ------------------------------------------------


async def test_swap_emits_d02_phases(client: TestClient, spy: _OrchestratorSpy) -> None:
    """READY + different variant → SWAPPING; orchestrator gets --from + --to.

    Verifies the 4 D-02 LOCKED phases ('stopping vLLM', 'loading weights',
    'warmup', 'ready') flow through unchanged.
    """
    # Pre-position: READY on the OLD variant.
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._current_profile_id = "qwen3.6-35b-a3b"
    _ctl._current_variant = "v3.1-default"

    spy.set_yields(
        [
            {"ts": "t0", "phase": "stopping vLLM"},
            {"ts": "t1", "phase": "loading weights", "pct": 50},
            {"ts": "t2", "phase": "warmup"},
            {"ts": "t3", "phase": "ready"},
            {"_internal_exit": 0},
        ]
    )

    with client.stream(
        "POST",
        "/start",
        json={"profile_id": "qwen3.6-35b-a3b", "variant": "v3.1-reason"},
    ) as r:
        assert r.status_code == 200
        lines = _consume_sse(r)
    frames = _data_frames(lines)

    # Cross-variant: orchestrator got --from path.
    assert len(spy.calls) == 1
    assert spy.calls[0]["from_path"] == "profiles/qwen3.6-35b-a3b/v3.1-default"
    assert spy.calls[0]["to_path"] == "profiles/qwen3.6-35b-a3b/v3.1-reason"

    # 5 SSE frames: 4 phases + exit.
    assert len(frames) == 5
    phase_labels = [f.get("phase") for f in frames if "phase" in f]
    assert phase_labels == ["stopping vLLM", "loading weights", "warmup", "ready"]

    # Final state: READY with updated tracking.
    assert _ctl.state.state == SidecarState.READY
    assert _ctl._current_variant == "v3.1-reason"


# --- 409 / error state ------------------------------------------------------


async def test_409_when_state_invalid(client: TestClient, spy: _OrchestratorSpy) -> None:
    """SWAPPING → /start returns 409 with state value in body."""
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    await _ctl.state.transition_to(SidecarState.SWAPPING)

    r = client.post("/start", json={"profile_id": "qwen3.6-35b-a3b", "variant": "v3.1-default"})
    assert r.status_code == 409
    assert "swapping" in r.text
    assert spy.calls == []


async def test_error_state_on_orchestrator_exit_5(client: TestClient, spy: _OrchestratorSpy) -> None:
    """Orchestrator exit != 0 → state→ERROR, _last_error populated, exit frame surfaces."""
    spy.set_yields(
        [
            {"ts": "t0", "phase": "loading weights", "pct": 0},
            {"_internal_exit": 5},
        ]
    )

    with client.stream(
        "POST",
        "/start",
        json={"profile_id": "qwen3.6-35b-a3b", "variant": "v3.1-default"},
    ) as r:
        lines = _consume_sse(r)
    frames = _data_frames(lines)

    # Final SSE frame includes exit:5.
    assert any(f == {"exit": 5} for f in frames), f"expected exit:5 frame, got {frames}"

    # State ended in ERROR; last_error populated.
    assert _ctl.state.state == SidecarState.ERROR
    assert _ctl._last_error is not None
    assert "5" in _ctl._last_error["msg"]
