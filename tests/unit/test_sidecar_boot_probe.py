"""Phase 04.2-followup — sidecar boot-probe (adopt external vLLM into READY).

Closes the gap surfaced when the sidecar restarts (systemd auto-restart, manual
restart, OOM, or the open quirk where the sidecar Python dies during a profile
swap while vLLM stays up). Without boot-probe, the sidecar always boots at
state=STOPPED — even when a vLLM is alive on :8002 — so the next /profile or
/stop 409s with no obvious recovery path.

These tests use TestClient as a context manager (`with TestClient(app) as c`)
so Starlette's lifespan hook fires. Tests that DO NOT use the context manager
form skip the probe entirely (the existing default in tests/unit/test_sidecar_*).
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

import emmy_serve.swap.controller as _ctl
from emmy_serve.swap.state import SidecarState


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int, body: dict | str) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> object:
        if isinstance(self._body, str):
            # Simulate malformed JSON
            raise ValueError("malformed JSON")
        return self._body


class _FakeAsyncClient:
    """Minimal httpx.AsyncClient stand-in that returns a canned /v1/models payload."""

    def __init__(self, response: _FakeResponse | Exception) -> None:
        self._response = response

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *_a: object) -> None:
        return None

    async def get(self, url: str) -> _FakeResponse:
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def _patch_async_client(monkeypatch: pytest.MonkeyPatch, response: _FakeResponse | Exception) -> None:
    """Replace httpx.AsyncClient inside the controller module with a fake."""
    def factory(*_args: object, **_kwargs: object) -> _FakeAsyncClient:
        return _FakeAsyncClient(response)
    monkeypatch.setattr(_ctl.httpx, "AsyncClient", factory)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate_runtime() -> None:
    """Reset module-level state before AND after each test so probe-driven
    mutations don't leak across cases.
    """
    _ctl._reset_runtime_for_tests()
    yield
    _ctl._reset_runtime_for_tests()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_probe_adopts_alive_vllm_into_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    """vLLM up + valid /v1/models payload → state=READY, profile_id adopted."""
    _patch_async_client(
        monkeypatch,
        _FakeResponse(200, {"object": "list", "data": [{"id": "gemma-4-26b-a4b-it"}]}),
    )

    with TestClient(_ctl.app):
        # Lifespan startup has fired; probe ran inside it.
        assert _ctl.state.state == SidecarState.READY
        assert _ctl._current_profile_id == "gemma-4-26b-a4b-it"
        # Variant is not recoverable from /v1/models — must stay None.
        assert _ctl._current_variant is None


def test_probe_leaves_stopped_when_vllm_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Connection-refused (vLLM down) → state stays STOPPED, no exception."""
    _patch_async_client(monkeypatch, httpx.ConnectError("connection refused"))

    with TestClient(_ctl.app):
        assert _ctl.state.state == SidecarState.STOPPED
        assert _ctl._current_profile_id is None


def test_probe_leaves_stopped_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """Probe timeout → state stays STOPPED."""
    _patch_async_client(monkeypatch, httpx.ReadTimeout("probe timeout"))

    with TestClient(_ctl.app):
        assert _ctl.state.state == SidecarState.STOPPED
        assert _ctl._current_profile_id is None


def test_probe_leaves_stopped_on_non_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """vLLM returns 503 (still booting) → state stays STOPPED."""
    _patch_async_client(monkeypatch, _FakeResponse(503, {}))

    with TestClient(_ctl.app):
        assert _ctl.state.state == SidecarState.STOPPED
        assert _ctl._current_profile_id is None


def test_probe_leaves_stopped_on_empty_models_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """vLLM is up but reports no models — defensive: don't adopt without an ID."""
    _patch_async_client(monkeypatch, _FakeResponse(200, {"object": "list", "data": []}))

    with TestClient(_ctl.app):
        assert _ctl.state.state == SidecarState.STOPPED
        assert _ctl._current_profile_id is None


def test_probe_leaves_stopped_on_malformed_json(monkeypatch: pytest.MonkeyPatch) -> None:
    """Malformed JSON body → state stays STOPPED (caught by the try/except)."""
    _patch_async_client(monkeypatch, _FakeResponse(200, "not json"))

    with TestClient(_ctl.app):
        assert _ctl.state.state == SidecarState.STOPPED
        assert _ctl._current_profile_id is None


def test_probe_leaves_stopped_on_missing_id_field(monkeypatch: pytest.MonkeyPatch) -> None:
    """Model entry without an `id` field → state stays STOPPED."""
    _patch_async_client(
        monkeypatch,
        _FakeResponse(200, {"object": "list", "data": [{"object": "model"}]}),
    )

    with TestClient(_ctl.app):
        assert _ctl.state.state == SidecarState.STOPPED
        assert _ctl._current_profile_id is None


def test_probe_skipped_when_state_already_moved(monkeypatch: pytest.MonkeyPatch) -> None:
    """If state is already non-STOPPED at probe time, leave it alone.

    This protects against a test fixture (or some future runtime path) that
    pre-sets state — the boot probe is for cold start only, not runtime
    reconciliation.
    """
    # Pre-set state to READY (as if a test fixture moved us first).
    _ctl.state._state = SidecarState.READY  # type: ignore[attr-defined]
    _ctl._current_profile_id = "preset-by-test"

    # Probe would adopt a different model_id IF it ran; assert it didn't.
    _patch_async_client(
        monkeypatch,
        _FakeResponse(200, {"object": "list", "data": [{"id": "would-have-been-adopted"}]}),
    )

    with TestClient(_ctl.app):
        assert _ctl.state.state == SidecarState.READY
        # profile_id NOT overwritten by the probe.
        assert _ctl._current_profile_id == "preset-by-test"


# ---------------------------------------------------------------------------
# 409 recovery-hint tests — operator-facing UX (shipped together with the probe)
# ---------------------------------------------------------------------------


def test_409_hint_on_stopped_points_at_start(monkeypatch: pytest.MonkeyPatch) -> None:
    """When sidecar boot-probe couldn't adopt and state stays STOPPED, the
    /profile/swap 409 must include an actionable recovery hint pointing at
    /start. This is the operator-UX leg of the fix.
    """
    # Force probe to fail so state stays STOPPED.
    _patch_async_client(monkeypatch, httpx.ConnectError("vllm down"))

    with TestClient(_ctl.app) as client:
        assert _ctl.state.state == SidecarState.STOPPED
        resp = client.post(
            "/profile/swap",
            json={"from": "gemma-4-26b-a4b-it", "to": "gemma-4-31b-it", "port": 8002},
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        # Original message preserved (regression guard for slash-commands.ts client parsers).
        assert "swap requires state=ready, currently=stopped" in detail
        # Hint must be present and point at /start.
        assert "/start" in detail
        assert "vllm" in detail.lower() or "docker stop" in detail.lower()


def test_409_hint_present_on_stop_when_stopped(monkeypatch: pytest.MonkeyPatch) -> None:
    """/stop on state=stopped also gets the recovery hint."""
    _patch_async_client(monkeypatch, httpx.ConnectError("vllm down"))

    with TestClient(_ctl.app) as client:
        assert _ctl.state.state == SidecarState.STOPPED
        resp = client.post("/stop", json={})
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert "stop requires state=ready, currently=stopped" in detail
        assert "/start" in detail
