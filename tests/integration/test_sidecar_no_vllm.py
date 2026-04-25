"""Phase 04.2 Plan 02 — End-to-end sidecar bring-up via FastAPI TestClient.

Boots the real FastAPI app (emmy_serve.swap.controller:app) via TestClient
but monkeypatches every external boundary: fetch_vllm_metrics_cached raises
httpx.ConnectError (no real vLLM); sample_gpu_temp_cached returns None
(no real nvidia-smi); run_orchestrator_subprocess yields canned dicts
(no real subprocess).

Integration-level in SHAPE (whole HTTP pipeline including Pydantic validation,
state-machine wiring, SSE re-framing) but ZERO real subprocess / docker / HTTP /
model traffic — every external boundary monkey-patched. Runs in unit-test time
(~0.5s).

Emmy's conftest.py auto-skips everything under tests/integration/ unless
``--run-integration`` is passed (see conftest.py:28).

Real-tailnet validation lives in the operator-gated SC-1/SC-2/SC-3 phase4.2
walkthroughs (D-08 LOCKED), NOT here.
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx
import pytest
from fastapi.testclient import TestClient


pytestmark = pytest.mark.integration


# --- Fixtures --------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_module_state():
    """Reset controller.py module-level singletons + caches between tests."""
    from emmy_serve.swap import controller as ctl
    from emmy_serve.swap import sidecar_metrics

    ctl._reset_runtime_for_tests()
    sidecar_metrics._reset_caches_for_tests()
    yield
    # Tear down after test too — safety belt for cross-test isolation.
    ctl._reset_runtime_for_tests()
    sidecar_metrics._reset_caches_for_tests()


@pytest.fixture
def client(monkeypatch):
    """TestClient with vLLM unreachable + nvidia-smi unavailable.

    Monkeypatches both the imported binding inside controller AND the source
    module so cache refreshes also see the patched value (controller.py imports
    ``from .sidecar_metrics import fetch_vllm_metrics_cached, ...`` which
    creates a separate name binding — patch both for safety).
    """
    from emmy_serve.swap import controller as ctl
    from emmy_serve.swap import sidecar_metrics

    async def _raise_connect_error(base_url: str = "") -> dict:
        raise httpx.ConnectError(f"vLLM unreachable at {base_url}")

    monkeypatch.setattr(sidecar_metrics, "fetch_vllm_metrics_cached", _raise_connect_error)
    monkeypatch.setattr(ctl, "fetch_vllm_metrics_cached", _raise_connect_error)
    monkeypatch.setattr(sidecar_metrics, "sample_gpu_temp_cached", lambda: None)
    monkeypatch.setattr(ctl, "sample_gpu_temp_cached", lambda: None)

    return TestClient(ctl.app)


# --- Helpers ---------------------------------------------------------------


def _data_frames_from_text(body: str) -> list[str]:
    """Extract ``data:`` payloads from an SSE response body (one per yielded record)."""
    return [line[len("data:") :].strip() for line in body.splitlines() if line.startswith("data:")]


# --- Tests -----------------------------------------------------------------


def test_healthz_returns_ok(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert isinstance(body.get("version"), str)
    assert body["version"]  # non-empty


def test_root_returns_endpoint_listing(client):
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "emmy-sidecar"
    assert "/healthz" in body["endpoints"]
    assert "/status" in body["endpoints"]
    assert "/start" in body["endpoints"]
    assert "/stop" in body["endpoints"]
    assert "/profile/swap" in body["endpoints"]


def test_status_when_no_vllm_running(client):
    r = client.get("/status")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "stopped"
    assert body["vllm_up"] is False
    assert body["kv_used_pct"] is None
    assert body["gpu_temp_c"] is None
    assert body["in_flight"] is None
    assert body["profile_id"] is None
    assert body["profile_variant"] is None
    assert body["profile_hash"] is None
    assert body["vllm_pid"] is None
    assert body["container_digest"] is None
    assert body["last_error"] is None


def test_stop_from_stopped_state_returns_409(client):
    r = client.post("/stop", json={})
    assert r.status_code == 409
    # 409 body should include current state for diagnostic.
    assert "stopped" in r.text.lower()


def test_start_with_orchestrator_failure_transitions_to_error(client, monkeypatch):
    """Cold-start path → orchestrator returns exit 4 (prereq) → state=ERROR.

    Validates the full STOPPED → STARTING → ERROR transition path including
    SSE final-frame exit code reporting and /status reflection of last_error.
    """
    from emmy_serve.swap import controller as ctl

    async def _yield_failure(*, from_path, to_path, port, cwd=None) -> AsyncIterator[dict]:
        # Mirror orchestrator's cold-start failure: subprocess exits non-zero
        # without emitting any phase records first (e.g. argparse rejection).
        yield {"_internal_exit": 4}

    monkeypatch.setattr(ctl, "run_orchestrator_subprocess", _yield_failure)

    # POST /start as a buffered request (sse-starlette's ping keepalive can hang
    # iter_lines; client.post with a finite generator returns body once closed).
    r = client.post(
        "/start",
        json={"profile_id": "nonexistent", "variant": "v1"},
    )
    assert r.status_code == 200, f"SSE stream should open OK; failure reported in stream. Got {r.status_code}"

    frames = _data_frames_from_text(r.text)
    assert frames, f"expected at least one data frame, got body={r.text!r}"

    # Final frame should carry the exit code as JSON.
    parsed = [json.loads(f) for f in frames]
    exit_frames = [p for p in parsed if "exit" in p]
    assert exit_frames, f"expected an exit frame in {parsed}"
    assert exit_frames[-1]["exit"] == 4

    # State should now be ERROR with last_error populated.
    r = client.get("/status")
    body = r.json()
    assert body["state"] == "error"
    assert body["last_error"] is not None
    assert "msg" in body["last_error"]


def test_path_traversal_in_profile_id_rejected(client):
    """T-04.2-S3 mitigation: profile_id with .. or / must 400."""
    r = client.post("/start", json={"profile_id": "../etc/passwd", "variant": "v1"})
    assert r.status_code == 400
    r2 = client.post("/start", json={"profile_id": "ok", "variant": "../../bad"})
    assert r2.status_code == 400
    r3 = client.post("/start", json={"profile_id": "with/slash", "variant": "v1"})
    assert r3.status_code == 400
    r4 = client.post("/start", json={"profile_id": "ok", "variant": "with/slash"})
    assert r4.status_code == 400
