"""Unit tests for emmy_serve.kv_finder.* (D-13, SERVE-08).

These tests are GREEN in Phase A (no hardware) and guard the three
KV-finder modules against regressions in the bisection math, Prometheus
metrics parsing, and load-driver-subset selection.

The full end-to-end finder (which drives a live vLLM server through
multiple iterations) runs only in Phase B on DGX Spark — see
`scripts/find_kv_budget.py --profile ...`.
"""
from __future__ import annotations

from pathlib import Path
from unittest import mock

import pytest

pytest.importorskip("emmy_serve.kv_finder")
pytest.importorskip("emmy_serve.kv_finder.metrics")


# ---------------------------------------------------------------------------
# metrics.parse_preemption_metrics — Prometheus text parser
# ---------------------------------------------------------------------------


def test_parse_preemption_metrics_extracts_counter():
    """`vllm:num_preemptions_total` counter is surfaced with its float value."""
    from emmy_serve.kv_finder.metrics import parse_preemption_metrics

    text = (
        "# HELP vllm:num_preemptions_total Preempt count\n"
        "# TYPE vllm:num_preemptions_total counter\n"
        'vllm:num_preemptions_total{engine="0",model_name="m"} 42.0\n'
    )
    out = parse_preemption_metrics(text)
    assert out.get("vllm:num_preemptions_total") == 42.0


def test_parse_preemption_metrics_ignores_unrelated():
    """Unrelated metrics must not pollute the returned dict."""
    from emmy_serve.kv_finder.metrics import parse_preemption_metrics

    text = (
        "# HELP python_gc_objects_collected_total GC collected\n"
        "# TYPE python_gc_objects_collected_total counter\n"
        'python_gc_objects_collected_total{generation="0"} 999.0\n'
        "# HELP vllm:num_preemptions_total Preempt count\n"
        "# TYPE vllm:num_preemptions_total counter\n"
        'vllm:num_preemptions_total{engine="0",model_name="m"} 7.0\n'
    )
    out = parse_preemption_metrics(text)
    assert out == {"vllm:num_preemptions_total": 7.0}


def test_parse_preemption_metrics_handles_kv_cache_and_waiting():
    """KV cache usage + num_requests_waiting are additionally extracted."""
    from emmy_serve.kv_finder.metrics import parse_preemption_metrics

    text = (
        "# TYPE vllm:kv_cache_usage_perc gauge\n"
        'vllm:kv_cache_usage_perc{engine="0",model_name="m"} 0.87\n'
        "# TYPE vllm:num_requests_waiting gauge\n"
        'vllm:num_requests_waiting{engine="0",model_name="m"} 3.0\n'
        "# TYPE vllm:num_requests_running gauge\n"
        'vllm:num_requests_running{engine="0",model_name="m"} 5.0\n'
    )
    out = parse_preemption_metrics(text)
    assert out["vllm:kv_cache_usage_perc"] == pytest.approx(0.87)
    assert out["vllm:num_requests_waiting"] == 3.0
    assert out["vllm:num_requests_running"] == 5.0


def test_parse_preemption_metrics_empty_text_returns_empty_dict():
    from emmy_serve.kv_finder.metrics import parse_preemption_metrics

    assert parse_preemption_metrics("") == {}


def test_scrape_metrics_uses_httpx_get(monkeypatch):
    """`scrape_metrics` calls `/metrics` and parses the body."""
    from emmy_serve.kv_finder import metrics as m

    class FakeResp:
        status_code = 200
        text = (
            "# TYPE vllm:num_preemptions_total counter\n"
            "vllm:num_preemptions_total 12.0\n"
        )

        def raise_for_status(self):
            pass

    captured = {}

    def fake_get(url, timeout=None):
        captured["url"] = url
        captured["timeout"] = timeout
        return FakeResp()

    monkeypatch.setattr(m.httpx, "get", fake_get)
    out = m.scrape_metrics("http://127.0.0.1:8002")
    assert captured["url"] == "http://127.0.0.1:8002/metrics"
    assert out["vllm:num_preemptions_total"] == 12.0


# ---------------------------------------------------------------------------
# bisect._check_dmesg_oom — subprocess wrapping
# ---------------------------------------------------------------------------


def test_check_dmesg_oom_matches_oom_line(monkeypatch):
    """OOM-keyword lines are returned from a dmesg transcript."""
    from emmy_serve.kv_finder import bisect

    def fake_check_output(*args, **kwargs):
        return (
            b"[Fri Apr 21 03:12:00 2026] ordinary line\n"
            b"[Fri Apr 21 03:12:05 2026] Out of memory: killed process 1234\n"
            b"[Fri Apr 21 03:12:06 2026] oom-killer invoked\n"
        )

    monkeypatch.setattr(bisect.subprocess, "check_output", fake_check_output)
    hits = bisect._check_dmesg_oom()
    assert len(hits) == 2
    assert any("oom" in h.lower() for h in hits)
    assert any("out of memory" in h.lower() for h in hits)


def test_check_dmesg_oom_empty_transcript(monkeypatch):
    from emmy_serve.kv_finder import bisect

    monkeypatch.setattr(
        bisect.subprocess, "check_output", lambda *a, **kw: b"line a\nline b\n"
    )
    assert bisect._check_dmesg_oom() == []


def test_check_dmesg_oom_graceful_on_error(monkeypatch):
    """Any exception (perm denied, binary missing) returns [] — never crashes."""
    from emmy_serve.kv_finder import bisect

    def boom(*a, **kw):
        raise PermissionError("CAP_SYSLOG required")

    monkeypatch.setattr(bisect.subprocess, "check_output", boom)
    assert bisect._check_dmesg_oom() == []


# ---------------------------------------------------------------------------
# bisect._rewrite_gpu_mem_util — atomic YAML round-trip
# ---------------------------------------------------------------------------


def test_rewrite_gpu_mem_util_updates_only_that_field(tmp_path: Path):
    """Rewriting gpu_memory_utilization preserves all other fields + round-trips."""
    import yaml

    from emmy_serve.kv_finder import bisect

    # Seed a minimal-but-valid serving.yaml (schema shape is not required here — the
    # rewriter operates on the raw dict structure only).
    p = tmp_path / "serving.yaml"
    p.write_text(
        "engine:\n"
        "  model: /models/test\n"
        "  gpu_memory_utilization: 0.75\n"
        "  enable_prefix_caching: true\n"
        "env:\n"
        '  HF_HUB_OFFLINE: "1"\n',
        encoding="utf-8",
    )
    bisect._rewrite_gpu_mem_util(p, 0.826)
    # Round-trip: read back, assert the new value + other fields intact.
    d = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert d["engine"]["gpu_memory_utilization"] == 0.826
    assert d["engine"]["model"] == "/models/test"
    assert d["engine"]["enable_prefix_caching"] is True
    assert d["env"]["HF_HUB_OFFLINE"] == "1"


def test_rewrite_gpu_mem_util_rounds_to_three_decimals(tmp_path: Path):
    import yaml

    from emmy_serve.kv_finder import bisect

    p = tmp_path / "serving.yaml"
    p.write_text("engine:\n  gpu_memory_utilization: 0.75\n", encoding="utf-8")
    bisect._rewrite_gpu_mem_util(p, 0.82678)
    d = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert d["engine"]["gpu_memory_utilization"] == 0.827


# ---------------------------------------------------------------------------
# load_driver._finder_subset — mixed-prefill subset composition
# ---------------------------------------------------------------------------


def test_finder_subset_has_mixed_prefill_sizes():
    """The finder subset exercises a mix of prefill sizes (small to 30K)."""
    from emmy_serve.kv_finder.load_driver import _finder_subset

    subset = _finder_subset()
    assert len(subset) >= 6
    prefills = [p.expected_prefill_tokens for p in subset]
    # Small prefills present (CODE_* prompts)
    assert any(p < 500 for p in prefills), "no small-prefill prompts in subset"
    # Large prefills present (agent_*)
    assert any(p >= 10000 for p in prefills), "no large-prefill prompts in subset"


def test_finder_subset_includes_the_three_agent_prompts():
    """RESEARCH.md §8 specifies mixed prefill — the three agent_*_Nk must be there."""
    from emmy_serve.kv_finder.load_driver import _finder_subset

    ids = {p.task_id for p in _finder_subset()}
    assert "agent_10k_refactor" in ids
    assert "agent_20k_multifile" in ids
    assert "agent_30k_history" in ids


# ---------------------------------------------------------------------------
# bisect.run_finder — high-level bisection math (hardware mocked out)
# ---------------------------------------------------------------------------


def _setup_finder_env(tmp_path: Path) -> Path:
    """Build a minimal profile bundle + serving.yaml shape the finder can rewrite."""
    prof = tmp_path / "v1"
    prof.mkdir()
    (prof / "serving.yaml").write_text(
        "engine:\n"
        "  model: /models/test\n"
        "  served_model_name: test-model\n"
        "  gpu_memory_utilization: 0.75\n",
        encoding="utf-8",
    )
    (prof / "profile.yaml").write_text(
        "profile:\n"
        "  id: test\n"
        "  version: v1\n"
        "  hash: sha256:0000000000000000000000000000000000000000000000000000000000000000\n",
        encoding="utf-8",
    )
    return prof


def test_run_finder_converges_when_no_preemption_and_bumps_at_ceiling(
    tmp_path: Path, monkeypatch
):
    """A finder run that never preempts steps up until near-ceiling, applies safety."""
    from emmy_serve.kv_finder import bisect

    profile_path = _setup_finder_env(tmp_path)

    # Stub subprocess (start_emmy.sh + hash --write + docker stop/rm)
    monkeypatch.setattr(bisect.subprocess, "run", lambda *a, **kw: mock.Mock(returncode=0))
    monkeypatch.setattr(bisect, "_check_dmesg_oom", lambda *a, **kw: [])

    # scrape_metrics returns zero preemptions every time (no preemption across run).
    monkeypatch.setattr(
        bisect, "scrape_metrics", lambda *a, **kw: {"vllm:num_preemptions_total": 0.0}
    )

    def fake_drive_load(base_url, served_model, duration_s):
        return {
            "n_requests": 1,
            "tokens_generated": 100,
            "p50_latency_ms": 100,
            "p99_latency_ms": 200,
            "duration_s": 1.0,
        }

    monkeypatch.setattr(bisect, "drive_load", fake_drive_load)

    # Use a very short drive duration + few max_iters so the test runs in ms.
    run_dir = bisect.run_finder(
        profile_path,
        initial=0.95,
        step_up_pct=2.0,
        min_step_pct=0.5,
        drive_minutes=0,  # zero-duration drive for the test path
        max_iters=3,
        base_runs_dir=tmp_path / "runs",
    )
    # Iteration log exists and each entry has failure='none'
    iterlog = (run_dir / "iterations.jsonl").read_text().splitlines()
    assert iterlog, "expected at least one iteration"
    import json as _json

    for line in iterlog:
        row = _json.loads(line)
        assert row["failure"] == "none"

    # Final serving.yaml has a value > 0.50 (the safety-margin floor) and != 0.75.
    import yaml as _yaml

    final = _yaml.safe_load((profile_path / "serving.yaml").read_text())
    final_val = final["engine"]["gpu_memory_utilization"]
    assert final_val != 0.75  # moved off the placeholder
    assert final_val >= 0.50


def test_run_finder_backs_off_5pct_after_preemption(tmp_path: Path, monkeypatch):
    """A finder run that hits preemption on iter 1 bisects back + applies safety."""
    from emmy_serve.kv_finder import bisect

    profile_path = _setup_finder_env(tmp_path)
    monkeypatch.setattr(bisect.subprocess, "run", lambda *a, **kw: mock.Mock(returncode=0))
    monkeypatch.setattr(bisect, "_check_dmesg_oom", lambda *a, **kw: [])

    # Sequence of scrape_metrics returns: 0,0 (no preempt iter 0 pre/post),
    # then 0,5 (preempt iter 1 post-drive), then 5,5,5,5 ... (no more preempts).
    counter = {"n": 0}
    schedule = [0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]

    def fake_scrape(*a, **kw):
        v = schedule[min(counter["n"], len(schedule) - 1)]
        counter["n"] += 1
        return {"vllm:num_preemptions_total": float(v)}

    monkeypatch.setattr(bisect, "scrape_metrics", fake_scrape)
    monkeypatch.setattr(
        bisect,
        "drive_load",
        lambda base_url, served_model, duration_s: {
            "n_requests": 10,
            "tokens_generated": 500,
            "p50_latency_ms": 200,
            "p99_latency_ms": 500,
            "duration_s": 1.0,
        },
    )

    run_dir = bisect.run_finder(
        profile_path,
        initial=0.75,
        step_up_pct=5.0,  # bigger step so iter 1 pushes above preemption threshold
        min_step_pct=0.5,
        drive_minutes=0,
        max_iters=3,
        base_runs_dir=tmp_path / "runs",
    )
    import json as _json

    rows = [_json.loads(l) for l in (run_dir / "iterations.jsonl").read_text().splitlines()]
    # At least one failure=preemption row must appear.
    assert any(r["failure"] == "preemption" for r in rows)

    # Summary.json contains both preempted_at and highest_clean_value fields.
    summary = _json.loads((run_dir / "summary.json").read_text())
    assert summary["first_preemption_at"] is not None
    assert summary["final_value"] <= summary["highest_clean_value"]


def test_run_finder_writes_summary_json(tmp_path: Path, monkeypatch):
    from emmy_serve.kv_finder import bisect

    profile_path = _setup_finder_env(tmp_path)
    monkeypatch.setattr(bisect.subprocess, "run", lambda *a, **kw: mock.Mock(returncode=0))
    monkeypatch.setattr(bisect, "_check_dmesg_oom", lambda *a, **kw: [])
    monkeypatch.setattr(
        bisect, "scrape_metrics", lambda *a, **kw: {"vllm:num_preemptions_total": 0.0}
    )
    monkeypatch.setattr(
        bisect,
        "drive_load",
        lambda *a, **kw: {
            "n_requests": 1,
            "tokens_generated": 1,
            "p50_latency_ms": 1,
            "p99_latency_ms": 1,
            "duration_s": 1.0,
        },
    )

    run_dir = bisect.run_finder(
        profile_path,
        drive_minutes=0,
        max_iters=1,
        base_runs_dir=tmp_path / "runs",
    )
    import json as _json

    summary = _json.loads((run_dir / "summary.json").read_text())
    expected_keys = {
        "profile_id",
        "profile_version",
        "hardware_id",
        "initial_value",
        "final_value",
        "safety_margin_pct",
        "iterations",
        "total_duration_s",
        "load_driver",
        "started",
        "finished",
    }
    assert expected_keys.issubset(summary.keys())
    assert summary["profile_id"] == "test"
    assert summary["profile_version"] == "v1"
