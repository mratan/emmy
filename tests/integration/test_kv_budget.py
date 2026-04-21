"""RED skeleton — SERVE-08 KV budget zero-preemption under sustained load.

Drives 30 minutes of representative load through the running vLLM container
then scrapes /metrics; asserts vllm:num_preemptions_total delta is zero.
"""
from __future__ import annotations
import pytest

httpx = pytest.importorskip("httpx")
load_driver = pytest.importorskip("emmy_serve.kv_finder.load_driver")
metrics = pytest.importorskip("emmy_serve.kv_finder.metrics")

pytestmark = [pytest.mark.integration, pytest.mark.slow]


def _preemption_count(base_url: str) -> int:
    r = httpx.get(f"{base_url}/metrics", timeout=10.0)
    r.raise_for_status()
    families = metrics.parse_preemption_metrics(r.text)
    return int(families.get("vllm:num_preemptions_total", 0))


def test_zero_preemption(base_url: str):
    """SERVE-08: 30-min load with the finder-selected KV budget → zero preemptions."""
    before = _preemption_count(base_url)
    load_driver.drive_load(base_url, duration_s=1800)
    after = _preemption_count(base_url)
    assert after - before == 0, f"preemption delta {after - before} (before={before}, after={after})"
