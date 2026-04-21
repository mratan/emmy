"""Unit tests for emmy_serve.boot.throughput (Plan 01-06, SC-1 sweep).

RED phase: this file imports ``emmy_serve.boot.throughput`` which does not yet
exist in the GREEN commit — ``pytest.importorskip`` keeps the failure shape
clean (tests skip at collection time, then flip to full PASS after the GREEN
commit lands the module).

Tests NEVER touch hardware: httpx + canaries are mocked via monkeypatch
targeting the throughput module's imported symbols. The actual sweep on the
DGX Spark runs in Task 2 (checkpoint).
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

pytest.importorskip("emmy_serve.boot.throughput")


# ---------------------------------------------------------------------------
# SWEEP_CANDIDATES schema (T-06-01 / T-06-02 guard)
# ---------------------------------------------------------------------------


def test_sweep_candidates_has_five_entries():
    """K0 baseline + K1..K4 == 5 (matches PROFILE_NOTES.md §'SC-1 throughput gap')."""
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    assert len(SWEEP_CANDIDATES) == 5


def test_sweep_candidates_have_all_four_profile_notes_ids():
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    ids = [c.id for c in SWEEP_CANDIDATES]
    assert ids[0] == "k0-baseline"
    assert {
        "k1-flashinfer-moe",
        "k2-cuda-native",
        "k3-fp8-mamba-prefix",
        "k4-reasoning-parser",
    }.issubset(ids)


def test_k0_baseline_has_no_overrides():
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    k0 = next(c for c in SWEEP_CANDIDATES if c.id == "k0-baseline")
    assert k0.env_overrides == {}
    assert k0.serving_yaml_patch is None


def test_k1_is_env_override_only():
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    k1 = next(c for c in SWEEP_CANDIDATES if c.id == "k1-flashinfer-moe")
    assert k1.env_overrides == {"VLLM_USE_FLASHINFER_MOE_FP8": "1"}
    assert k1.serving_yaml_patch is None


def test_k2_is_cuda_env_override():
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    k2 = next(c for c in SWEEP_CANDIDATES if c.id == "k2-cuda-native")
    assert k2.env_overrides == {"CUDA_FORWARD_COMPATIBLE": "0"}
    assert k2.serving_yaml_patch is None


def test_k3_is_mamba_env_override():
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    k3 = next(c for c in SWEEP_CANDIDATES if c.id == "k3-fp8-mamba-prefix")
    assert k3.env_overrides == {"VLLM_FP8_MAMBA_PREFIX_CACHING": "1"}
    assert k3.serving_yaml_patch is None


def test_k4_is_serving_yaml_patch_not_env():
    """K4 rewrites serving.yaml (bumps profile hash) — NOT an env override."""
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    k4 = next(c for c in SWEEP_CANDIDATES if c.id == "k4-reasoning-parser")
    assert k4.serving_yaml_patch == {"engine": {"reasoning_parser": "qwen3"}}
    assert k4.env_overrides == {}


def test_candidates_all_have_notes():
    """Every candidate cites PROFILE_NOTES.md in its notes field (provenance)."""
    from emmy_serve.boot.throughput import SWEEP_CANDIDATES

    for c in SWEEP_CANDIDATES:
        assert isinstance(c.notes, str) and c.notes.strip()


# ---------------------------------------------------------------------------
# measure_warm_throughput happy path (T-06-02 canary-recording guard)
# ---------------------------------------------------------------------------


def test_measure_warm_throughput_records_all_three_canaries(monkeypatch):
    """Every measurement MUST include the full canary suite result (pitfall #5 discipline)."""
    import emmy_serve.boot.throughput as mod

    fake = MagicMock()
    fake.json.return_value = {"usage": {"completion_tokens": 500}}
    fake.raise_for_status.return_value = None
    monkeypatch.setattr(mod.httpx, "post", MagicMock(return_value=fake))

    monkeypatch.setattr(mod, "run_sp_ok", lambda b, m: (True, "ok"))
    monkeypatch.setattr(mod, "run_tool_call", lambda b, m, t: (True, {"ok": 1}))
    monkeypatch.setattr(mod, "run_generate", lambda b, m: (True, {}, 0.1))
    monkeypatch.setattr(
        mod,
        "load_default_tool_schema",
        lambda: {"type": "function", "function": {"name": "x"}},
    )

    out = mod.measure_warm_throughput(
        "http://localhost:8002",
        "qwen3.6-35b-a3b",
        candidate_id="k1-flashinfer-moe",
        n_samples=3,
        warmup_discard=0,
    )
    assert out.error is None
    assert out.candidate_id == "k1-flashinfer-moe"
    assert len(out.samples_tokps) == 3
    assert out.canary_sp_ok is True
    assert out.canary_tool_call is True
    assert out.canary_generate is True
    assert out.mean > 0
    assert out.std >= 0
    assert out.hardware_id  # populated (hostname or 'unknown')
    assert out.ts  # ISO-shaped string


def test_measure_warm_throughput_runs_warmup_discard(monkeypatch):
    """warmup_discard=1 means there are n_samples+1 httpx.post calls."""
    import emmy_serve.boot.throughput as mod

    call_count = {"n": 0}

    def _fake_post(url, json, timeout):
        call_count["n"] += 1
        m = MagicMock()
        m.json.return_value = {"usage": {"completion_tokens": 500}}
        m.raise_for_status.return_value = None
        return m

    monkeypatch.setattr(mod.httpx, "post", _fake_post)
    monkeypatch.setattr(mod, "run_sp_ok", lambda b, m: (True, ""))
    monkeypatch.setattr(mod, "run_tool_call", lambda b, m, t: (True, ""))
    monkeypatch.setattr(mod, "run_generate", lambda b, m: (True, {}, 0.0))
    monkeypatch.setattr(mod, "load_default_tool_schema", lambda: {})

    mod.measure_warm_throughput(
        "http://localhost:8002",
        "qwen3.6-35b-a3b",
        n_samples=3,
        warmup_discard=1,
    )
    # 1 warmup + 3 measurement calls == 4 httpx.post invocations
    assert call_count["n"] == 4


# ---------------------------------------------------------------------------
# measure_warm_throughput error paths
# ---------------------------------------------------------------------------


def test_measure_warm_throughput_captures_httpx_exception(monkeypatch):
    """httpx failures yield an error-populated measurement, not an exception."""
    import emmy_serve.boot.throughput as mod

    monkeypatch.setattr(
        mod.httpx, "post", MagicMock(side_effect=RuntimeError("boom"))
    )
    # Canaries are never reached if the measurement loop raises
    monkeypatch.setattr(mod, "run_sp_ok", lambda b, m: (True, ""))
    monkeypatch.setattr(mod, "run_tool_call", lambda b, m, t: (True, ""))
    monkeypatch.setattr(mod, "run_generate", lambda b, m: (True, {}, 0.0))
    monkeypatch.setattr(mod, "load_default_tool_schema", lambda: {})

    out = mod.measure_warm_throughput(
        "http://localhost:8002",
        "qwen3.6-35b-a3b",
        candidate_id="k2-cuda-native",
        n_samples=1,
        warmup_discard=0,
    )
    assert out.error is not None
    assert "boom" in out.error
    assert out.samples_tokps == []
    assert out.canary_sp_ok is False
    assert out.canary_tool_call is False
    assert out.canary_generate is False
    assert out.candidate_id == "k2-cuda-native"


def test_measure_warm_throughput_rejects_zero_completion_tokens(monkeypatch):
    """completion_tokens==0 is unusable (would divide by wall time and be 0) — raise+capture."""
    import emmy_serve.boot.throughput as mod

    fake = MagicMock()
    fake.json.return_value = {"usage": {"completion_tokens": 0}}
    fake.raise_for_status.return_value = None
    monkeypatch.setattr(mod.httpx, "post", MagicMock(return_value=fake))
    monkeypatch.setattr(mod, "run_sp_ok", lambda b, m: (True, ""))
    monkeypatch.setattr(mod, "run_tool_call", lambda b, m, t: (True, ""))
    monkeypatch.setattr(mod, "run_generate", lambda b, m: (True, {}, 0.0))
    monkeypatch.setattr(mod, "load_default_tool_schema", lambda: {})

    out = mod.measure_warm_throughput(
        "http://localhost:8002",
        "qwen3.6-35b-a3b",
        n_samples=1,
        warmup_discard=0,
    )
    assert out.error is not None
    assert "completion_tokens" in out.error


def test_measure_warm_throughput_sends_phase_c_payload_shape(monkeypatch):
    """Payload MUST match Phase C warm-500 shape verbatim (pitfall-#5 discipline)."""
    import emmy_serve.boot.throughput as mod

    captured: dict = {}

    def _fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        m = MagicMock()
        m.json.return_value = {"usage": {"completion_tokens": 500}}
        m.raise_for_status.return_value = None
        return m

    monkeypatch.setattr(mod.httpx, "post", _fake_post)
    monkeypatch.setattr(mod, "run_sp_ok", lambda b, m: (True, ""))
    monkeypatch.setattr(mod, "run_tool_call", lambda b, m, t: (True, ""))
    monkeypatch.setattr(mod, "run_generate", lambda b, m: (True, {}, 0.0))
    monkeypatch.setattr(mod, "load_default_tool_schema", lambda: {})

    mod.measure_warm_throughput(
        "http://localhost:8002/",
        "qwen3.6-35b-a3b",
        n_samples=1,
        warmup_discard=0,
    )
    # Endpoint hits /v1/chat/completions (not legacy /v1/completions)
    assert captured["url"].endswith("/v1/chat/completions")
    body = captured["json"]
    # Max tokens == 500 (Phase C warm-500, not 100-token smoke floor)
    assert body["max_tokens"] == 500
    # Temperature 0.0 — deterministic
    assert body["temperature"] == 0.0
    # enable_thinking=false (matches canary + test_throughput_floor — Plan 03/04 decision)
    assert body.get("chat_template_kwargs") == {"enable_thinking": False}
    # "Count to 100." is the Phase C prompt re-used verbatim
    assert body["messages"][-1]["content"] == "Count to 100."


# ---------------------------------------------------------------------------
# decide_winner logic (T-06-02 canary-regression gate)
# ---------------------------------------------------------------------------


def _mk(cid, mean, sp=True, tc=True, gen=True, err=None):
    """Helper to build a ThroughputMeasurement for decide_winner tests."""
    from emmy_serve.boot.throughput import ThroughputMeasurement

    return ThroughputMeasurement(
        candidate_id=cid,
        samples_tokps=[mean],
        mean=mean,
        std=0.0,
        p50=mean,
        canary_sp_ok=sp,
        canary_tool_call=tc,
        canary_generate=gen,
        error=err,
        hardware_id="hw",
        ts="ts",
    )


def test_decide_winner_picks_first_clean_candidate_above_floor():
    from emmy_serve.boot.throughput import decide_winner

    measurements = [
        _mk("k0-baseline", 50.0),
        _mk("k1-flashinfer-moe", 65.0),  # first winner
        _mk("k3-fp8-mamba-prefix", 70.0),
    ]
    assert decide_winner(measurements, floor_tokps=60.0) == "k1-flashinfer-moe"


def test_decide_winner_skips_baseline_even_if_above_floor():
    """k0-baseline is the control — never a 'winner' even if it clears the floor."""
    from emmy_serve.boot.throughput import decide_winner

    measurements = [_mk("k0-baseline", 70.0)]
    assert decide_winner(measurements, floor_tokps=60.0) is None


def test_decide_winner_rejects_canary_failure():
    """Throughput above floor + ANY canary regression => NOT a winner (pitfall #5)."""
    from emmy_serve.boot.throughput import decide_winner

    measurements = [
        _mk("k0-baseline", 50.0),
        _mk("k3-fp8-mamba-prefix", 71.0, sp=False),  # canary regression
        _mk("k1-flashinfer-moe", 66.0, tc=False),  # canary regression
        _mk("k2-cuda-native", 62.0, gen=False),  # canary regression
    ]
    assert decide_winner(measurements, floor_tokps=60.0) is None


def test_decide_winner_rejects_errored_candidate():
    """Errored measurement (boot failure etc.) is never a winner."""
    from emmy_serve.boot.throughput import decide_winner

    measurements = [
        _mk("k0-baseline", 50.0),
        _mk("k1-flashinfer-moe", 75.0, err="boot timeout"),
    ]
    assert decide_winner(measurements, floor_tokps=60.0) is None


def test_decide_winner_none_when_all_below_floor():
    from emmy_serve.boot.throughput import decide_winner

    measurements = [
        _mk("k0-baseline", 49.0),
        _mk("k1-flashinfer-moe", 51.0),
        _mk("k4-reasoning-parser", 55.0),
    ]
    assert decide_winner(measurements, floor_tokps=60.0) is None


# ---------------------------------------------------------------------------
# Public API sanity
# ---------------------------------------------------------------------------


def test_public_api_exports():
    """boot.throughput re-exports via __all__ match the interface block in 01-06-PLAN.md."""
    import emmy_serve.boot.throughput as mod

    for name in (
        "CandidateKnob",
        "ThroughputMeasurement",
        "SWEEP_CANDIDATES",
        "measure_warm_throughput",
        "decide_winner",
    ):
        assert hasattr(mod, name), f"missing public symbol: {name}"


def test_boot_package_reexports_throughput():
    """emmy_serve.boot re-exports throughput symbols alongside runner + probe."""
    import emmy_serve.boot as boot_pkg

    for name in (
        "CandidateKnob",
        "ThroughputMeasurement",
        "SWEEP_CANDIDATES",
        "measure_warm_throughput",
    ):
        assert hasattr(boot_pkg, name), f"emmy_serve.boot missing: {name}"
