"""RED skeleton — EVAL-07 SP_OK canary module surface.

Plan 02 ships `emmy_serve.canary` with `run_sp_ok`, `run_tool_call`, `run_generate`,
and the `CanaryResult` dataclass (8 fields per 01-RESEARCH.md §7.6).
"""
from __future__ import annotations
import pytest

canary = pytest.importorskip("emmy_serve.canary")


def test_module_importable():
    """EVAL-07: top-level canary surface (the API Phase 5 imports)."""
    assert hasattr(canary, "run_sp_ok")
    assert hasattr(canary, "run_tool_call")
    assert hasattr(canary, "run_generate")
    assert hasattr(canary, "CanaryResult")
    assert hasattr(canary, "log_canary_event")


def test_result_schema():
    """EVAL-07: CanaryResult carries the 8 fields every later phase logs."""
    r = canary.CanaryResult(
        check="sp_ok",
        ok=True,
        elapsed_ms=42,
        profile_id="gemma-4-26b-a4b-it",
        profile_version="v1",
        profile_hash="sha256:abc",
        served_model_name="gemma-4-26b-a4b-it",
        ts="2026-04-20T00:00:00Z",
    )
    # All 8 fields per 01-RESEARCH.md §7.6
    for field in (
        "check",
        "ok",
        "elapsed_ms",
        "profile_id",
        "profile_version",
        "profile_hash",
        "served_model_name",
        "ts",
    ):
        assert hasattr(r, field)


def test_sp_ok_prompt_string_constant():
    """D-07: SP_OK canary uses the documented prompt template + assertion token."""
    assert "ping" in canary.SP_OK_SYSTEM_PROMPT
    assert "[SP_OK]" in canary.SP_OK_SYSTEM_PROMPT
    assert canary.SP_OK_ASSERTION_SUBSTR == "[SP_OK]"
