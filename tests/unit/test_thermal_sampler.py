"""RED→GREEN regression test for GpuSampler._sample DGX Spark UMA `[N/A]` handling.

Context (Plan 01-07, closes SC-5 reproducibility gap):
    The DGX Spark GB10 SoC shares host UMA memory between CPU and GPU; there
    is no dedicated VRAM bank for nvidia-smi to report `memory.used` against.
    Concretely, on this box today:

        $ nvidia-smi --query-gpu=timestamp,utilization.gpu,\
            clocks.current.graphics,temperature.gpu,memory.used \
            --format=csv,noheader,nounits
        2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]

    The sampler that shipped in Plan 01-04 called ``float("[N/A]")`` on the
    last field, raised ``ValueError``, and dropped the entire row (including
    the valid 2405 MHz clock reading). That is why PROFILE_NOTES.md recorded
    ``gpu_clock_p5_hour2_mhz: 0`` after the first 2-hour replay: no rows
    ever landed in ``gpu_samples.jsonl``.

    The fix makes parsing tolerant per-field: `[N/A]` / `N/A` / `""` / `nan`
    cause ONE key to be omitted from the returned dict, while the other
    numeric fields are preserved. ``compute_floors`` already filters via
    ``if "gpu_clock_mhz" in s``, so omitting the key is the safest contract.
"""
from __future__ import annotations

from unittest.mock import patch


def _sample_via_mock(stdout_text: str) -> dict | None:
    """Invoke GpuSampler._sample with nvidia-smi's stdout mocked."""
    from emmy_serve.thermal.sampler import GpuSampler

    with patch(
        "emmy_serve.thermal.sampler.subprocess.check_output",
        return_value=stdout_text,
    ):
        return GpuSampler._sample()


def test_parses_dedicated_gpu_row_all_numeric():
    """Dedicated-GPU case: all 5 fields numeric — every key present."""
    out = _sample_via_mock("2026/04/20 10:00:00.000, 75, 2800, 65, 12000\n")
    assert out is not None
    assert out["gpu_util_pct"] == 75.0
    assert out["gpu_clock_mhz"] == 2800.0
    assert out["gpu_temp_c"] == 65.0
    assert out["memory_used_mb"] == 12000.0


def test_parses_dgx_spark_uma_row_with_n_a_memory():
    """DGX Spark UMA: memory.used returns `[N/A]` — row MUST keep gpu_clock_mhz.

    This is the exact observed DGX Spark row from 2026-04-21. Before the fix
    the whole sample was dropped; after the fix the clock reading survives.
    """
    out = _sample_via_mock(
        "2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]\n"
    )
    assert out is not None, "Row dropped — this is the bug Plan 01-07 fixes"
    assert out["gpu_clock_mhz"] == 2405.0
    assert out["gpu_util_pct"] == 0.0
    assert out["gpu_temp_c"] == 48.0
    assert (
        "memory_used_mb" not in out
    ), "missing field must be OMITTED (compute_floors uses `in s`)"


def test_parses_bare_n_a_without_brackets():
    """Some driver versions emit `N/A` instead of `[N/A]`."""
    out = _sample_via_mock(
        "2026/04/21 09:03:14.839, 0, 2405, 48, N/A\n"
    )
    assert out is not None
    assert out["gpu_clock_mhz"] == 2405.0
    assert "memory_used_mb" not in out


def test_drops_structurally_malformed_row():
    """Fewer than 5 CSV fields → None (nothing usable)."""
    out = _sample_via_mock("2026/04/21 09:03:14.839, 0\n")
    assert out is None


def test_drops_empty_output():
    """nvidia-smi silent/empty → None (subprocess-level failure proxy)."""
    out = _sample_via_mock("")
    assert out is None


def test_handles_multiple_n_a_fields_keeps_timestamp():
    """If ALL numeric fields are `[N/A]`, the sample still carries the timestamp."""
    out = _sample_via_mock(
        "2026/04/21 09:03:14.839, [N/A], [N/A], [N/A], [N/A]\n"
    )
    assert out is not None
    assert out["ts"] == "2026/04/21 09:03:14.839"
    for k in ("gpu_util_pct", "gpu_clock_mhz", "gpu_temp_c", "memory_used_mb"):
        assert k not in out


def test_only_clock_numeric_matches_dgx_spark_expectation():
    """Real-world post-fix shape: clock present, memory absent — compute_floors contract."""
    out = _sample_via_mock(
        "2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]\n"
    )
    # This is what compute_floors will see; confirm the key it filters on
    # (gpu_clock_mhz) is present and non-zero.
    assert out is not None
    assert "gpu_clock_mhz" in out
    assert out["gpu_clock_mhz"] > 0
