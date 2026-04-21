"""RED skeleton — REPRO-04 offline HF tokenizer load.

With HF_HUB_OFFLINE=1 and TRANSFORMERS_OFFLINE=1, the tokenizer must load from
the on-disk model dir without making any HTTP calls.
"""
from __future__ import annotations
import os
from pathlib import Path
import pytest

pytestmark = pytest.mark.integration

transformers = pytest.importorskip("transformers")

MODEL_PATH = Path(os.environ.get("EMMY_MODEL_PATH", "/data/models/Qwen3.6-35B-A3B-FP8"))


def test_tokenizer_loads_offline(monkeypatch):
    """REPRO-04: AutoTokenizer.from_pretrained(MODEL_PATH) succeeds with no HTTP.

    We set TRANSFORMERS_OFFLINE/HF_HUB_OFFLINE and additionally monkeypatch
    `requests.get` to raise if anything sneaks out.
    """
    if not MODEL_PATH.exists():
        pytest.skip(f"model path {MODEL_PATH} not present; skipping offline load test")

    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "1")
    monkeypatch.setenv("HF_HOME", os.environ.get("HF_HOME", "/data/hf-cache"))

    # Guard: any accidental HTTP blows up immediately
    try:
        import requests  # noqa: WPS433 — runtime guard
    except ImportError:
        pytest.skip("requests not installed; HTTP guard unavailable")

    def _blocked(*args, **kwargs):
        raise RuntimeError("HTTP call attempted while offline")

    monkeypatch.setattr(requests, "get", _blocked)
    monkeypatch.setattr(requests, "post", _blocked)

    tok = transformers.AutoTokenizer.from_pretrained(str(MODEL_PATH))
    assert tok is not None
