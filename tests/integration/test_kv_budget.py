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
    """SERVE-08: 30-min load with the finder-selected KV budget → zero preemptions.

    Looks up the served model name from /v1/models rather than hardcoding
    "qwen3.6-35b-a3b" — the same test is meant to run across profiles.
    """
    models = httpx.get(f"{base_url}/v1/models", timeout=10.0).json()
    served_model_name = models["data"][0]["id"]
    before = _preemption_count(base_url)
    load_driver.drive_load(base_url, served_model_name=served_model_name, duration_s=1800)
    after = _preemption_count(base_url)
    assert after - before == 0, f"preemption delta {after - before} (before={before}, after={after})"
