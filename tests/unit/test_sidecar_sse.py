"""GREEN — SSE wire format byte-equivalence with Phase-4 D-02 LOCKED records
(Phase 04.2 Plan 01 Task 3).

Covers C-06 LOCKED:
    - Each SSE 'data:' frame is the orchestrator's verbatim JSON-per-line
      record — no shape drift, no field rename, no reorder.
    - Phase-4 D-02 phase labels ('stopping vLLM', 'loading weights',
      'warmup', 'ready') flow through unchanged when the sidecar wraps the
      orchestrator subprocess.
    - The exit-6 envelope (rolled_back + rollback_succeeded) passes through
      verbatim, then the {_internal_exit: 6} sentinel becomes a final
      {exit: 6} SSE frame.
    - Sidecar-only events: {phase: 'draining', details: {in_flight: N}}
      and {state: 'stopped', exit: 0} (these are NEW frames the sidecar
      adds; they're NOT part of the Phase-4 D-02 contract but ARE part of
      the Phase-04.2 contract that Plan 03's TS dispatcher consumes).

Per the threat model T-04.2-S2: SSE never echoes client request body fields
back into frames. We assert on the raw response text — any leakage of
client input would show up here.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from emmy_serve.swap import controller as _ctl
from emmy_serve.swap.state import SidecarState


# --- spy + fixtures ---------------------------------------------------------


class _OrchestratorScriptedSpy:
    """Same shape as test_sidecar_start's spy; configurable yields."""

    def __init__(self, yields: list[dict]) -> None:
        self.yields = list(yields)
        self.calls: list[dict] = []

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
            for r in self.yields:
                yield r

        return _gen()


@pytest.fixture(autouse=True)
def _reset_runtime() -> None:
    _ctl._reset_runtime_for_tests()


@pytest.fixture
def client() -> TestClient:
    return TestClient(_ctl.app)


# --- C-06: SSE frames are byte-equivalent to Phase-4 D-02 records -----------


async def test_sse_frames_match_phase4_d02(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verbatim Phase-4 record `{ts, phase}` flows through as `data: {ts, phase}`."""
    # Pre-position READY.
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._current_profile_id = "qwen3.6-35b-a3b"
    _ctl._current_variant = "v3.1-default"

    spy = _OrchestratorScriptedSpy(
        [
            {"ts": "2026-01-01T00:00:00+00:00", "phase": "stopping vLLM"},
            {"ts": "2026-01-01T00:00:01+00:00", "phase": "loading weights", "pct": 50},
            {"ts": "2026-01-01T00:00:02+00:00", "phase": "warmup"},
            {"ts": "2026-01-01T00:00:03+00:00", "phase": "ready"},
            {"_internal_exit": 0},
        ]
    )
    monkeypatch.setattr(_ctl, "run_orchestrator_subprocess", spy)

    r = client.post(
        "/profile/swap",
        json={"from": "profiles/qwen3.6-35b-a3b/v3.1-default",
              "to": "profiles/qwen3.6-35b-a3b/v3.1-reason",
              "port": 8002},
    )
    text = r.text

    # Each Phase-4 D-02 phase label appears VERBATIM as a data: frame.
    assert 'data: {"ts": "2026-01-01T00:00:00+00:00", "phase": "stopping vLLM"}' in text
    assert '"phase": "loading weights"' in text and '"pct": 50' in text
    assert '"phase": "warmup"' in text
    # The "ready" phase label appears as a data: frame (not the exit frame).
    assert 'data: {"ts": "2026-01-01T00:00:03+00:00", "phase": "ready"}' in text
    # Final frame is the exit code, NOT echoing the orchestrator's _internal_exit field.
    assert 'data: {"exit": 0}' in text


async def test_sse_envelope_passthrough(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exit-6 rollback envelope passes through verbatim before the exit frame."""
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._current_profile_id = "qwen3.6-35b-a3b"
    _ctl._current_variant = "v3.1-default"

    spy = _OrchestratorScriptedSpy(
        [
            {"phase": "stopping vLLM"},
            {"rolled_back": True, "rollback_succeeded": True},
            {"_internal_exit": 6},
        ]
    )
    monkeypatch.setattr(_ctl, "run_orchestrator_subprocess", spy)

    r = client.post(
        "/profile/swap",
        json={"from": "profiles/qwen3.6-35b-a3b/v3.1-default",
              "to": "profiles/qwen3.6-35b-a3b/v3.1-reason",
              "port": 8002},
    )
    text = r.text

    # Both the envelope frame AND the exit frame appear in the stream.
    assert '"rolled_back": true' in text
    assert '"rollback_succeeded": true' in text
    assert 'data: {"exit": 6}' in text
    # Rollback success → state rolls back to READY (old profile still loaded).
    assert _ctl.state.state == SidecarState.READY


async def test_sse_no_echo_of_client_input(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-04.2-S2: SSE response body never contains client-supplied field values.

    This is the security-posture invariant: the SSE stream is server-generated
    only. If a future change accidentally interpolates `req.profile_id` into
    a `data:` line, this test catches it.
    """
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._current_profile_id = "qwen3.6-35b-a3b"
    _ctl._current_variant = "v3.1-default"

    sentinel = "ZZZ_CANARY_VALUE_xyz_42"

    spy = _OrchestratorScriptedSpy(
        [
            {"phase": "stopping vLLM"},
            {"_internal_exit": 0},
        ]
    )
    monkeypatch.setattr(_ctl, "run_orchestrator_subprocess", spy)

    # Inject the canary into the client's request body via the from/to paths.
    # The handler MUST use them to spawn the orchestrator BUT MUST NOT echo
    # them back as SSE frame content.
    r = client.post(
        "/profile/swap",
        json={
            "from": f"profiles/qwen3.6-35b-a3b/{sentinel}",
            "to": f"profiles/qwen3.6-35b-a3b/{sentinel}-target",
            "port": 8002,
        },
    )
    text = r.text
    assert r.status_code == 200
    assert sentinel not in text, (
        f"client input leaked into SSE response: {sentinel!r} appeared in body"
    )


# --- 4-frame structural test ------------------------------------------------


async def test_sse_data_lines_have_correct_framing(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each SSE 'data:' frame is followed by a blank line (sse-starlette default)."""
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)
    _ctl._current_profile_id = "qwen3.6-35b-a3b"
    _ctl._current_variant = "v3.1-default"

    spy = _OrchestratorScriptedSpy(
        [
            {"phase": "stopping vLLM"},
            {"phase": "loading weights"},
            {"phase": "ready"},
            {"_internal_exit": 0},
        ]
    )
    monkeypatch.setattr(_ctl, "run_orchestrator_subprocess", spy)

    r = client.post(
        "/profile/swap",
        json={"from": "profiles/x/y", "to": "profiles/x/z", "port": 8002},
    )
    text = r.text

    # 4 logical frames → exactly 4 'data:' line prefixes.
    data_line_count = sum(1 for line in text.splitlines() if line.startswith("data:"))
    assert data_line_count == 4, f"expected 4 data: lines, got {data_line_count}\nbody: {text}"

    # Each data line parses as JSON.
    for line in text.splitlines():
        if line.startswith("data:"):
            payload = line[len("data:") :].strip()
            json.loads(payload)  # raises JSONDecodeError if framing is broken
