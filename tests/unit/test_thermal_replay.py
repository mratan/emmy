"""Unit tests for emmy_serve.thermal.replay helpers.

These tests are GREEN in Phase A without any live vLLM — they fixture
runs/<id>-thermal/ directory contents, assert compute_floors produces
the right §9.7 shape, and that assert_floors correctly distinguishes
recorded-match vs recorded-miss.

The actual 2-hour replay (``run_replay``) runs in Phase B on DGX Spark;
its success is measured via the recorded-floors write + the second-run
re-assertion.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

pytest.importorskip("emmy_serve.thermal.replay")

from emmy_serve.thermal import replay as replay_mod
from emmy_serve.thermal.replay import (
    DECODE_P1_TOLERANCE,
    DECODE_P50_TOLERANCE,
    CLOCK_P5_TOLERANCE,
    _load_jsonl,
    _percentile,
    assert_floors,
    compute_floors,
    record_floors_first_run,
)


# ---------------------------------------------------------------------------
# _percentile
# ---------------------------------------------------------------------------


def test_percentile_empty_returns_zero():
    assert _percentile([], 50) == 0.0


def test_percentile_p5_p50_p99_on_arange():
    vs = sorted(range(100))  # 0..99
    assert _percentile(vs, 5) == 5.0
    assert _percentile(vs, 50) == 50.0
    assert _percentile(vs, 99) == 99.0


def test_percentile_clamps_to_last_index():
    vs = [1.0, 2.0, 3.0]
    # p=200 → idx clamped to len-1
    assert _percentile(vs, 200) == 3.0


# ---------------------------------------------------------------------------
# _load_jsonl
# ---------------------------------------------------------------------------


def test_load_jsonl_empty_for_missing_file(tmp_path: Path):
    assert _load_jsonl(tmp_path / "missing.jsonl") == []


def test_load_jsonl_skips_blank_and_corrupt_lines(tmp_path: Path):
    p = tmp_path / "mixed.jsonl"
    p.write_text(
        '{"a": 1}\n\n{"b": 2}\nnot json\n{"c": 3}\n', encoding="utf-8"
    )
    rows = _load_jsonl(p)
    assert rows == [{"a": 1}, {"b": 2}, {"c": 3}]


# ---------------------------------------------------------------------------
# compute_floors
# ---------------------------------------------------------------------------


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8"
    )


def _seed_thermal_run(run_dir: Path) -> None:
    """Seed a complete hour-2-only fixture: all samples at t_elapsed >= 3600."""
    run_dir.mkdir(parents=True, exist_ok=True)
    # GPU samples: 100 rows at hour 2, clocks 2000..2099 MHz, temps 70..79 C
    gpu_rows = [
        {
            "ts": "2026-04-21T04:30:00",
            "gpu_util_pct": 95.0,
            "gpu_clock_mhz": 2000.0 + i,
            "gpu_temp_c": 70.0 + (i % 10),
            "memory_used_mb": 32000.0,
            "t_elapsed": 3600 + i * 5,
        }
        for i in range(100)
    ]
    _write_jsonl(run_dir / "gpu_samples.jsonl", gpu_rows)

    # Response rows: 50 at hour 2, throughputs 40..89 tok/s
    resp_rows = [
        {
            "task_id": f"t{i}",
            "t_start": 3600 + i * 60,
            "duration_s": 10.0,
            "tokens_out": 500,
            "prompt_tokens": 200,
            "tokens_per_second": 40.0 + i,
        }
        for i in range(50)
    ]
    _write_jsonl(run_dir / "responses.jsonl", resp_rows)

    # vLLM metric rows: hour 1 has 1 preempt, hour 2 has 0 preempts (delta=0).
    # First sample at 3600: preemptions_total=1. Last at 7200: preemptions_total=1.
    vllm_rows = [
        {
            "vllm:num_preemptions_total": 1.0 if t >= 1800 else 0.0,
            "t_elapsed": t,
        }
        for t in range(0, 7200, 60)
    ]
    _write_jsonl(run_dir / "vllm_metrics.jsonl", vllm_rows)

    # dmesg tail with no OOM lines
    (run_dir / "dmesg_tail.txt").write_text(
        "[Fri Apr 21 04:00:00 2026] normal kernel msg\n", encoding="utf-8"
    )


def test_compute_floors_returns_expected_shape(tmp_path: Path):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    floors = compute_floors(run_dir)
    expected_keys = {
        "gpu_clock_p5_hour2_mhz",
        "gpu_clock_p50_hour2_mhz",
        "gpu_temp_p95_hour2_c",
        "decode_throughput_p50_hour2_tokps",
        "decode_throughput_p1_hour2_tokps",
        "preemptions_hour2",
        "oom_events",
    }
    assert expected_keys == set(floors.keys())


def test_compute_floors_values_from_seeded_run(tmp_path: Path):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    floors = compute_floors(run_dir)
    # GPU clock p5 of arange 2000..2099 = 2005 (5th percentile)
    assert floors["gpu_clock_p5_hour2_mhz"] == 2005.0
    # p50 = 2050
    assert floors["gpu_clock_p50_hour2_mhz"] == 2050.0
    # No OOM events seeded
    assert floors["oom_events"] == 0
    # Preemption counter stays at 1 through hour 2 → delta = 0
    assert floors["preemptions_hour2"] == 0
    # Decode throughput p50 of arange 40..89 = 65
    assert floors["decode_throughput_p50_hour2_tokps"] == 65.0


def test_compute_floors_detects_hour2_preemption(tmp_path: Path):
    """Preemption counter rising during hour 2 surfaces as preemptions_hour2 > 0."""
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    # Overwrite vllm_metrics.jsonl: preempt jumps from 1 to 8 during hour 2
    rows = [
        {
            "vllm:num_preemptions_total": 1.0 if t < 3600 else 1.0 + (t - 3600) / 500,
            "t_elapsed": t,
        }
        for t in range(0, 7200, 60)
    ]
    _write_jsonl(run_dir / "vllm_metrics.jsonl", rows)
    floors = compute_floors(run_dir)
    assert floors["preemptions_hour2"] > 0


def test_compute_floors_detects_oom(tmp_path: Path):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    (run_dir / "dmesg_tail.txt").write_text(
        "[Fri Apr 21 04:00:00 2026] Out of memory: Killed process 9999\n"
        "[Fri Apr 21 04:00:01 2026] oom-killer invoked\n",
        encoding="utf-8",
    )
    floors = compute_floors(run_dir)
    assert floors["oom_events"] >= 1


def test_compute_floors_ignores_hour1_samples(tmp_path: Path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    # Hour 1 only — compute_floors must return zeros (no hour-2 data).
    gpu_rows = [
        {
            "gpu_clock_mhz": 2000.0,
            "gpu_temp_c": 70.0,
            "t_elapsed": i * 5,  # all < 3600
        }
        for i in range(200)
    ]
    _write_jsonl(run_dir / "gpu_samples.jsonl", gpu_rows)
    _write_jsonl(run_dir / "responses.jsonl", [])
    _write_jsonl(run_dir / "vllm_metrics.jsonl", [])
    floors = compute_floors(run_dir)
    assert floors["gpu_clock_p5_hour2_mhz"] == 0.0
    assert floors["decode_throughput_p50_hour2_tokps"] == 0.0


# ---------------------------------------------------------------------------
# assert_floors
# ---------------------------------------------------------------------------


_NOTES_TEMPLATE = """\
---
profile_id: test
profile_version: v1
created: 2026-04-21
measured_values:
  gpu_clock_p5_hour2_mhz: {p5}
  decode_throughput_p50_hour2_tokps: {p50}
  decode_throughput_p1_hour2_tokps: {p1}
---

# Test profile notes
"""


def _seed_profile(tmp_path: Path, p5, p50, p1) -> Path:
    prof = tmp_path / "profile"
    prof.mkdir()
    (prof / "PROFILE_NOTES.md").write_text(
        _NOTES_TEMPLATE.format(p5=p5, p50=p50, p1=p1), encoding="utf-8"
    )
    return prof


def test_assert_floors_passes_when_computed_matches_recorded(tmp_path: Path):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    profile = _seed_profile(tmp_path, p5=2005, p50=65.0, p1=40.0)
    rc = assert_floors(run_dir, profile)
    assert rc == 0


def test_assert_floors_fails_when_preemption_occurred(tmp_path: Path):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    # Force preemption delta > 0 in hour 2: preempt counter rises from 10 to 20
    # across the hour-2 rows (delta = last - first = 10).
    rows = []
    for t in range(0, 7200, 60):
        if t < 3600:
            v = 0.0
        else:
            v = 10.0 + (t - 3600) / 360  # rises from 10 at t=3600 to 20 at t=7200
        rows.append({"vllm:num_preemptions_total": v, "t_elapsed": t})
    _write_jsonl(run_dir / "vllm_metrics.jsonl", rows)
    profile = _seed_profile(tmp_path, p5=2005, p50=65.0, p1=40.0)
    rc = assert_floors(run_dir, profile)
    assert rc == 1


def test_assert_floors_fails_when_clock_drops_beyond_tolerance(tmp_path: Path):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    # Recorded p5 = 3000; computed = 2005; 2005 / 3000 = 66% (far below 95%).
    profile = _seed_profile(tmp_path, p5=3000, p50=65.0, p1=40.0)
    rc = assert_floors(run_dir, profile)
    assert rc == 1


def test_assert_floors_passes_within_tolerance(tmp_path: Path):
    """Recorded p5 exactly at the 5% ceiling passes (95% tolerance)."""
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    # computed p5 = 2005; recorded = 2005 / 0.95 = 2110.5 → recorded 2100 passes.
    profile = _seed_profile(tmp_path, p5=2100, p50=65.0, p1=40.0)
    rc = assert_floors(run_dir, profile)
    assert rc == 0


def test_assert_floors_tolerates_null_recorded(tmp_path: Path):
    """When PROFILE_NOTES.md has ``null`` floors (Phase 1 template), assert is a no-op."""
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "PROFILE_NOTES.md").write_text(
        "---\n"
        "profile_id: test\n"
        "measured_values:\n"
        "  gpu_clock_p5_hour2_mhz: null\n"
        "  decode_throughput_p50_hour2_tokps: null\n"
        "  decode_throughput_p1_hour2_tokps: null\n"
        "---\n\n# Test\n",
        encoding="utf-8",
    )
    rc = assert_floors(run_dir, profile)
    assert rc == 0  # hard gates pass, no tolerance gate triggered


def test_assert_floors_fails_on_missing_frontmatter(tmp_path: Path):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "PROFILE_NOTES.md").write_text("# No frontmatter\n", encoding="utf-8")
    rc = assert_floors(run_dir, profile)
    assert rc == 1


# ---------------------------------------------------------------------------
# record_floors_first_run
# ---------------------------------------------------------------------------


def test_record_floors_first_run_writes_computed_values(tmp_path: Path, monkeypatch):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    profile = _seed_profile(tmp_path, p5="null", p50="null", p1="null")

    # Skip the hash-recompute subprocess call.
    import subprocess as _sp

    monkeypatch.setattr(replay_mod.subprocess, "run", lambda *a, **kw: None)

    record_floors_first_run(run_dir, profile)
    text = (profile / "PROFILE_NOTES.md").read_text(encoding="utf-8")
    assert "gpu_clock_p5_hour2_mhz: 2005" in text
    assert "decode_throughput_p50_hour2_tokps: 65" in text
    # Body preserved
    assert "# Test profile notes" in text


def test_record_floors_first_run_preserves_frontmatter_body(
    tmp_path: Path, monkeypatch
):
    run_dir = tmp_path / "run"
    _seed_thermal_run(run_dir)
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "PROFILE_NOTES.md").write_text(
        "---\n"
        "profile_id: test\n"
        "measured_values: {}\n"
        "---\n\n# Heading\n\nBody paragraph.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(replay_mod.subprocess, "run", lambda *a, **kw: None)
    record_floors_first_run(run_dir, profile)
    text = (profile / "PROFILE_NOTES.md").read_text(encoding="utf-8")
    # Parse frontmatter back to confirm structure
    assert text.startswith("---\n")
    end = text.find("\n---", 3)
    fm = yaml.safe_load(text[3:end])
    assert fm["measured_values"]["gpu_clock_p5_hour2_mhz"] == 2005
    assert "# Heading" in text
    assert "Body paragraph." in text


# ---------------------------------------------------------------------------
# Tolerance constants
# ---------------------------------------------------------------------------


def test_tolerance_constants_match_research_spec():
    """§9.7 specifies 5%/7%/10% tolerances on clock_p5 / decode_p50 / decode_p1."""
    assert CLOCK_P5_TOLERANCE == 0.95  # 5%
    assert DECODE_P50_TOLERANCE == 0.93  # 7%
    assert DECODE_P1_TOLERANCE == 0.90  # 10%


# ---------------------------------------------------------------------------
# Sampler plumbing (smoke — thread lifecycle)
# ---------------------------------------------------------------------------


def test_gpu_sampler_stops_cleanly(tmp_path: Path, monkeypatch):
    """Thread start → stop → join finishes in bounded time."""
    from emmy_serve.thermal.sampler import GpuSampler

    # Stub _sample so we don't shell out to nvidia-smi in the unit test.
    monkeypatch.setattr(
        GpuSampler,
        "_sample",
        staticmethod(
            lambda: {
                "ts": "t",
                "gpu_util_pct": 0.0,
                "gpu_clock_mhz": 0.0,
                "gpu_temp_c": 0.0,
                "memory_used_mb": 0.0,
            }
        ),
    )
    path = tmp_path / "gpu.jsonl"
    s = GpuSampler(path, interval_s=0.01)
    s.start()
    import time as _t

    _t.sleep(0.05)
    s.stop()
    s.join(timeout=2.0)
    assert not s.is_alive()
    assert path.exists()
    # At least one sample appended.
    assert path.read_text(encoding="utf-8").strip()


def test_vllm_metrics_sampler_survives_scrape_failure(tmp_path: Path, monkeypatch):
    """A failing scrape_metrics must not kill the thread."""
    from emmy_serve.thermal import sampler as sampler_mod

    def _boom(*a, **kw):
        raise ConnectionError("test")

    monkeypatch.setattr(sampler_mod, "scrape_metrics", _boom)
    path = tmp_path / "vllm.jsonl"
    s = sampler_mod.VllmMetricsSampler(
        path, "http://127.0.0.1:8002", interval_s=0.01
    )
    s.start()
    import time as _t

    _t.sleep(0.05)
    s.stop()
    s.join(timeout=2.0)
    assert not s.is_alive()
    # No rows (every scrape failed) → file either absent or empty.
    if path.exists():
        assert path.read_text(encoding="utf-8").strip() == ""
