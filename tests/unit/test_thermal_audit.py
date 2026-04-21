"""Unit tests for the D-14 thermal workload audit (emmy_serve/thermal/audit.py).

These tests are GREEN in Phase A (no hardware needed) and guard the committed
corpus against accidental drift that would silently invalidate thermal-floor
claims. Every mutation to corpus.py must keep these tests green.
"""
from __future__ import annotations

import pytest

pytest.importorskip("emmy_serve.thermal.audit")

from emmy_serve.thermal import audit as audit_mod
from emmy_serve.thermal.audit import AuditReport, audit_corpus
from emmy_serve.thermal.corpus import ALL_THERMAL_PROMPTS, ThermalPrompt


def test_committed_corpus_passes_thresholds():
    """§9.5 thresholds (1), (2), (3), (5) all pass on the committed corpus."""
    report = audit_corpus()
    assert report.passes, f"committed corpus fails §9.5: {report.failures}"


def test_committed_corpus_has_enough_prompts():
    """The audit only makes sense with a non-trivial corpus size."""
    assert len(ALL_THERMAL_PROMPTS) >= 10, len(ALL_THERMAL_PROMPTS)


def test_audit_report_fields_match_committed_corpus():
    """Sanity: the AuditReport values match an independent recomputation."""
    report = audit_corpus()
    n = len(ALL_THERMAL_PROMPTS)
    total_pf = sum(p.expected_prefill_tokens for p in ALL_THERMAL_PROMPTS)
    total_dc = sum(p.expected_decode_tokens for p in ALL_THERMAL_PROMPTS)
    assert report.total_prompts == n
    assert report.total_prefill_tokens == total_pf
    assert report.total_decode_tokens == total_dc
    # Ratio rounded to 4 decimals in the report.
    assert abs(report.prefill_to_decode_ratio - total_pf / total_dc) < 0.0005


def test_audit_threshold_ratio_out_of_band_detected():
    """Synthesize a prefill-heavy corpus; audit must fail threshold (1)."""
    # All prefill, no decode → ratio = inf → FAIL ratio + FAIL 10K + FAIL tool
    prompts = [
        ThermalPrompt(
            task_id=f"p{i}",
            category="coding",
            difficulty="easy",
            title=f"p{i}",
            prompt="x",
            expected_prefill_tokens=1000,
            expected_decode_tokens=1,
        )
        for i in range(10)
    ]
    report = audit_corpus(prompts)
    assert not report.passes
    assert any("ratio" in f for f in report.failures)


def test_audit_threshold_tool_call_pct_detected():
    """Corpus with 0% tool-call must flag the tool-call threshold failure."""
    prompts = [
        ThermalPrompt(
            task_id=f"p{i}",
            category="coding",
            difficulty="easy",
            title=f"p{i}",
            prompt="x",
            expected_prefill_tokens=10000 if i < 5 else 100,
            expected_decode_tokens=5000,
            includes_tool_call=False,
        )
        for i in range(10)
    ]
    report = audit_corpus(prompts)
    # Whatever else fails, the 0% tool-call must surface as a failure.
    assert not report.passes
    assert any("tool-call" in f for f in report.failures)


def test_audit_max_share_threshold_detected():
    """A corpus where one prompt is ≥50% of token mass must flag threshold (5)."""
    # Ratio needs to still be in [0.5, 2.0] so this test isolates threshold (5).
    dominant_prompt = ThermalPrompt(
        task_id="huge",
        category="coding",
        difficulty="hard",
        title="dominant prompt",
        prompt="x",
        expected_prefill_tokens=50000,
        expected_decode_tokens=50000,
    )
    small_prompts = [
        ThermalPrompt(
            task_id=f"small_{i}",
            category="tool_sequence",
            difficulty="easy",
            title=f"small_{i}",
            prompt="x",
            expected_prefill_tokens=1000,
            expected_decode_tokens=1000,
            includes_tool_call=(i < 3),
        )
        for i in range(10)
    ]
    prompts = [dominant_prompt, *small_prompts]
    report = audit_corpus(prompts)
    assert any("share" in f.lower() for f in report.failures), report.failures


def test_audit_empty_corpus_returns_fail():
    report = audit_corpus([])
    assert not report.passes
    assert report.total_prompts == 0
    assert report.failures


def test_audit_main_exits_zero_on_committed_corpus(capsys):
    """`python -m emmy_serve.thermal.audit` exits 0 on the committed corpus."""
    rc = audit_mod.main([])
    assert rc == 0
    out = capsys.readouterr().out
    assert "PASSES: True" in out


def test_audit_main_json_output_is_valid_json(capsys):
    """`--format json` produces parseable JSON with the expected keys."""
    import json as _json

    rc = audit_mod.main(["--format", "json"])
    assert rc == 0
    payload = _json.loads(capsys.readouterr().out)
    expected_keys = {
        "total_prompts",
        "total_prefill_tokens",
        "total_decode_tokens",
        "prefill_to_decode_ratio",
        "pct_prefill_gte_10k",
        "pct_includes_tool_call",
        "max_single_prompt_share",
        "max_share_task_id",
        "passes",
        "failures",
    }
    assert expected_keys.issubset(payload.keys())
    assert payload["passes"] is True


def test_thermal_prompts_are_frozen():
    """ThermalPrompt is frozen — no silent field mutation slips past review."""
    p = ALL_THERMAL_PROMPTS[0]
    with pytest.raises((AttributeError, TypeError)):
        p.expected_prefill_tokens = 99999  # type: ignore[misc]


def test_all_task_ids_are_unique():
    """Duplicate task_ids in the corpus would confuse replay bookkeeping."""
    ids = [p.task_id for p in ALL_THERMAL_PROMPTS]
    assert len(ids) == len(set(ids)), f"duplicate ids: {ids}"
