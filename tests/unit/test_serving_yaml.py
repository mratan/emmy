"""RED skeleton — SERVE-08 "KV budget came from find_kv_budget.py, not a guess".

Per Pitfall 1 discipline: committing gpu_memory_utilization=0.75 (the Phase-1
placeholder) is the anti-pattern. Plan 02 writes the placeholder; Plan 04 runs
the finder and overwrites it. This test flips from xfail to pass when Plan 04
lands the measured value.
"""
from __future__ import annotations
from pathlib import Path
import pytest

yaml = pytest.importorskip("yaml")


def _skip_if_no_serving(profile_path: Path) -> Path:
    serving = profile_path / "serving.yaml"
    if not serving.exists():
        pytest.skip(f"serving.yaml not yet created at {serving} (Plan 02)")
    return serving


@pytest.mark.xfail(
    reason="Plan 02 commits the placeholder 0.75; Plan 04's KV-finder overwrites it",
    strict=False,
)
def test_kv_budget_final(profile_path: Path):
    """SERVE-08: gpu_memory_utilization must NOT be the placeholder 0.75."""
    serving = _skip_if_no_serving(profile_path)
    cfg = yaml.safe_load(serving.read_text(encoding="utf-8"))
    util = cfg.get("engine", {}).get("gpu_memory_utilization")
    assert util is not None, "gpu_memory_utilization missing"
    assert util != 0.75, (
        "gpu_memory_utilization is the Phase-1 placeholder 0.75 — "
        "run scripts/find_kv_budget.py and commit the measured value"
    )
