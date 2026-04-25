"""GREEN — Sidecar /status endpoint + sidecar_metrics caching
(Phase 04.2 Plan 01 Tasks 2 + 3).

Plan 01 Task 2 lays the test scaffold (the 1s-cache + nvidia-smi sentinel
tests can run as soon as sidecar_metrics.py exists). Plan 01 Task 3 turns
on the FastAPI TestClient suite (D-03 GET-only + D-07 schema), which needs
controller.py to exist.

The fixture ``_reset_caches_for_tests`` (autouse, module-scoped) is
mandatory: without it module-level _metrics_cache / _temp_cache survive
across tests in a single pytest session and produce stale-cache flake.

Covered:
    D-03: /status is GET-only JSON, never SSE (Task 3 GREEN — needs controller)
    D-07: payload schema (state + 10 optional fields nullable when stopped)
          (Task 3 GREEN — needs controller)
    D-07: 1-second TTL cache for vLLM /metrics (Task 2 GREEN — sidecar_metrics)
    D-07: 1-second TTL cache for nvidia-smi temp (Task 2 GREEN — sidecar_metrics)
    Sentinel handling: nvidia-smi [N/A] → None (Task 2 GREEN — sidecar_metrics)
"""
from __future__ import annotations

import time
from typing import Any

import pytest

from emmy_serve.swap import sidecar_metrics


# --- autouse fixture: reset module-level caches before each test ------------


@pytest.fixture(autouse=True)
def _reset_metric_caches() -> None:
    """Clear the 1s TTL caches before every test in this file.

    Module-level _metrics_cache / _temp_cache survive across tests in a
    pytest session — a previous test's cached value would otherwise leak
    into the next test's monkeypatched call.
    """
    sidecar_metrics._reset_caches_for_tests()


# ============================================================================
# Task 2 GREEN — sidecar_metrics.py tests (do not need controller.py)
# ============================================================================


# --- nvidia-smi sentinel handling -------------------------------------------


def test_sample_gpu_temp_handles_na_sentinel(monkeypatch: pytest.MonkeyPatch) -> None:
    """nvidia-smi returning ``[N/A]`` → sample_gpu_temp() returns None.

    DGX Spark UMA can degrade individual nvidia-smi fields to [N/A] under
    load; the sidecar must surface "value unknown" not crash.
    """
    import subprocess

    class _FakeCompleted:
        returncode = 0
        stdout = "[N/A]\n"

    def _fake_run(*args: Any, **kwargs: Any) -> _FakeCompleted:
        return _FakeCompleted()  # type: ignore[return-value]

    monkeypatch.setattr(sidecar_metrics.subprocess, "run", _fake_run)
    assert sidecar_metrics.sample_gpu_temp() is None


def test_sample_gpu_temp_returns_float_when_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    """Happy path: nvidia-smi returns ``64.2\\n`` → sample_gpu_temp() == 64.2."""

    class _FakeCompleted:
        returncode = 0
        stdout = "64.2\n"

    monkeypatch.setattr(sidecar_metrics.subprocess, "run", lambda *a, **kw: _FakeCompleted())  # type: ignore[arg-type,return-value]
    assert sidecar_metrics.sample_gpu_temp() == 64.2


def test_sample_gpu_temp_returns_none_on_subprocess_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """nvidia-smi missing / OSError → None, never raises."""

    def _raise(*a: Any, **kw: Any) -> None:
        raise FileNotFoundError("nvidia-smi not found")

    monkeypatch.setattr(sidecar_metrics.subprocess, "run", _raise)
    assert sidecar_metrics.sample_gpu_temp() is None


# --- 1-second TTL cache for nvidia-smi temp ---------------------------------


def test_sample_gpu_temp_cache_ttl_1s(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two calls within 1s → underlying sample_gpu_temp() invoked exactly once."""
    call_count = {"n": 0}

    def _fake_sample() -> float | None:
        call_count["n"] += 1
        return 70.0

    monkeypatch.setattr(sidecar_metrics, "sample_gpu_temp", _fake_sample)

    a = sidecar_metrics.sample_gpu_temp_cached()
    b = sidecar_metrics.sample_gpu_temp_cached()
    assert a == 70.0
    assert b == 70.0
    assert call_count["n"] == 1, f"expected 1 underlying call, got {call_count['n']}"


def test_sample_gpu_temp_cache_refreshes_after_1s(monkeypatch: pytest.MonkeyPatch) -> None:
    """After the cache TTL elapses, a new call refetches."""
    call_count = {"n": 0}

    def _fake_sample() -> float | None:
        call_count["n"] += 1
        return 50.0 + call_count["n"]  # 51, 52, 53, ...

    monkeypatch.setattr(sidecar_metrics, "sample_gpu_temp", _fake_sample)

    base = time.monotonic()
    times = [base, base + 0.5, base + 1.5]
    idx = {"i": 0}

    def _fake_monotonic() -> float:
        i = idx["i"]
        if i < len(times):
            idx["i"] = i + 1
            return times[i]
        # Beyond the planned sequence, return a far-future value so any
        # late teardown / autouse-reset call doesn't blow up.
        return times[-1] + 100.0

    monkeypatch.setattr(sidecar_metrics.time, "monotonic", _fake_monotonic)

    a = sidecar_metrics.sample_gpu_temp_cached()  # fresh fetch (call 1)
    b = sidecar_metrics.sample_gpu_temp_cached()  # cached (still call 1)
    c = sidecar_metrics.sample_gpu_temp_cached()  # past TTL → refetch (call 2)
    assert a == 51.0
    assert b == 51.0
    assert c == 52.0


# --- 1-second TTL cache for vLLM /metrics -----------------------------------


async def test_status_cache_ttl_1s(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two calls within 1s → underlying fetch_vllm_metrics invoked exactly once.

    This is the D-07 cache invariant for the HTTP-fetch side. Without the
    cache, every Mac footer poll (2s cadence) would fire a real /metrics
    request through the sidecar — fine on its own, but unbounded if more
    pollers join.
    """
    call_count = {"n": 0}

    async def _fake_fetch(base_url: str = "http://127.0.0.1:8002", timeout_s: float = 2.0) -> dict[str, float]:
        call_count["n"] += 1
        return {"vllm:gpu_cache_usage_perc": 0.34, "vllm:num_requests_running": 2.0}

    monkeypatch.setattr(sidecar_metrics, "fetch_vllm_metrics", _fake_fetch)

    a = await sidecar_metrics.fetch_vllm_metrics_cached()
    b = await sidecar_metrics.fetch_vllm_metrics_cached()
    assert a == b
    assert a["vllm:gpu_cache_usage_perc"] == 0.34
    assert call_count["n"] == 1, f"expected 1 underlying call, got {call_count['n']}"


async def test_status_cache_refreshes_after_1s(monkeypatch: pytest.MonkeyPatch) -> None:
    """vLLM /metrics cache refreshes once 1s elapses."""
    call_count = {"n": 0}

    async def _fake_fetch(base_url: str = "http://127.0.0.1:8002", timeout_s: float = 2.0) -> dict[str, float]:
        call_count["n"] += 1
        return {"x": float(call_count["n"])}

    monkeypatch.setattr(sidecar_metrics, "fetch_vllm_metrics", _fake_fetch)

    base = time.monotonic()
    times = [base, base + 0.3, base + 1.5]
    idx = {"i": 0}

    def _fake_monotonic() -> float:
        i = idx["i"]
        if i < len(times):
            idx["i"] = i + 1
            return times[i]
        return times[-1] + 100.0

    monkeypatch.setattr(sidecar_metrics.time, "monotonic", _fake_monotonic)

    a = await sidecar_metrics.fetch_vllm_metrics_cached()  # call 1
    b = await sidecar_metrics.fetch_vllm_metrics_cached()  # cached
    c = await sidecar_metrics.fetch_vllm_metrics_cached()  # past TTL → call 2
    assert a == {"x": 1.0}
    assert b == {"x": 1.0}
    assert c == {"x": 2.0}


# --- _parse_float_or_none directly ------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("64.2", 64.2),
        ("  64.2  ", 64.2),
        ("[N/A]", None),
        ("[n/a]", None),
        ("N/A", None),
        ("n/a", None),
        ("", None),
        ("nan", None),
        ("not a number", None),
    ],
)
def test_parse_float_or_none(raw: str, expected: float | None) -> None:
    """Cell parser tolerates every observed nvidia-smi sentinel + invalid."""
    assert sidecar_metrics._parse_float_or_none(raw) == expected


# ============================================================================
# Task 3 GREEN — controller.py /status tests (need controller.py to exist)
#
# These tests use ``pytest.importorskip`` so the file COLLECTS in Task 2
# even before controller.py lands; once Task 3 completes, they go GREEN.
# ============================================================================


def _client_with_no_vllm(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    """Construct a TestClient(app); patch fetch_vllm_metrics_cached to raise.

    Mirrors the runtime invariant the controller depends on: if vLLM is not
    running, fetch_vllm_metrics_cached raises an httpx error, which the
    /status handler catches and reports as ``vllm_up=False`` with all metric
    fields null. The default test environment may have an unrelated service
    on 8002 (e.g. another emmy worktree), so we MUST patch.
    """
    pytest.importorskip("emmy_serve.swap.controller")
    from fastapi.testclient import TestClient

    from emmy_serve.swap import controller as _ctl

    _ctl._reset_runtime_for_tests()

    async def _refuse(base_url: str = "http://127.0.0.1:8002") -> dict:
        raise ConnectionRefusedError("vLLM not running (test isolation)")

    monkeypatch.setattr(_ctl, "fetch_vllm_metrics_cached", _refuse)
    monkeypatch.setattr(_ctl, "sample_gpu_temp_cached", lambda: None)
    return TestClient(_ctl.app)


def test_status_returns_json_not_sse(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-03 LOCKED: GET /status returns application/json, NEVER text/event-stream.

    Mac footer poller depends on this — switching to SSE here would silently
    block the poller's 2s cadence, which is the wrong tradeoff per D-03.
    """
    client = _client_with_no_vllm(monkeypatch)
    r = client.get("/status")
    assert r.status_code == 200
    ct = r.headers.get("content-type", "")
    assert ct.startswith("application/json"), f"got content-type={ct!r}"
    assert "text/event-stream" not in ct


def test_status_payload_schema_when_stopped(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-07 LOCKED: optional fields are null when state=stopped (no vLLM)."""
    client = _client_with_no_vllm(monkeypatch)
    r = client.get("/status")
    body = r.json()
    assert body["state"] == "stopped"
    assert body["vllm_up"] is False
    # Optional fields all null when vllm_up=false:
    for field in (
        "profile_id",
        "profile_variant",
        "profile_hash",
        "vllm_pid",
        "container_digest",
        "kv_used_pct",
        "gpu_temp_c",
        "in_flight",
        "last_error",
    ):
        assert body[field] is None, f"expected {field} to be null when stopped, got {body[field]!r}"


def test_status_state_field_value_is_lowercase_string(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-07 wire shape: state field is one of 6 lowercase tokens."""
    client = _client_with_no_vllm(monkeypatch)
    r = client.get("/status")
    state = r.json()["state"]
    assert state in {"stopped", "starting", "ready", "swapping", "draining", "error"}


async def test_status_payload_when_ready_includes_kv_pct(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-07: when vllm_up=true, kv_used_pct = vllm:gpu_cache_usage_perc (fraction)."""
    pytest.importorskip("emmy_serve.swap.controller")

    from fastapi.testclient import TestClient

    from emmy_serve.swap import controller as _ctl
    from emmy_serve.swap.state import SidecarState

    # Pre-position state machine to READY so /status surfaces metric fields.
    _ctl._reset_runtime_for_tests()
    await _ctl.state.transition_to(SidecarState.STARTING)
    await _ctl.state.transition_to(SidecarState.READY)

    # Patch the cached metric fetcher to return a synthetic payload.
    async def _fake_metrics(base_url: str = "http://127.0.0.1:8002") -> dict[str, float]:
        return {"vllm:gpu_cache_usage_perc": 0.34, "vllm:num_requests_running": 2.0}

    monkeypatch.setattr(_ctl, "fetch_vllm_metrics_cached", _fake_metrics)
    monkeypatch.setattr(_ctl, "sample_gpu_temp_cached", lambda: 64.2)

    client = TestClient(_ctl.app)
    r = client.get("/status")
    body = r.json()
    assert body["state"] == "ready"
    assert body["vllm_up"] is True
    assert body["kv_used_pct"] == 0.34
    assert body["in_flight"] == 2
    assert body["gpu_temp_c"] == 64.2
