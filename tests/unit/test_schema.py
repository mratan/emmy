"""RED skeleton — PROFILE-03 / PROFILE-04 pydantic schema + cross-field validators.

Modules that satisfy these tests are created in Plan 02 (profile loader + schema).
Until those modules exist, `pytest.importorskip` turns the whole file into a skip
at collection time so `uv run pytest tests/unit` exits 0.
"""
from __future__ import annotations
from pathlib import Path
import pytest

schema = pytest.importorskip("emmy_serve.profile.schema")
loader = pytest.importorskip("emmy_serve.profile.loader")


def test_serving_yaml_valid(profile_path: Path):
    """PROFILE-03: serving.yaml loads and all required engine fields are present."""
    cfg = loader.load_serving(profile_path / "serving.yaml")
    assert cfg.engine.served_model_name == "qwen3.6-35b-a3b"
    assert cfg.engine.load_format == "fastsafetensors"
    assert cfg.engine.kv_cache_dtype == "fp8"
    assert cfg.engine.enable_prefix_caching is True
    assert cfg.engine.enable_chunked_prefill is True


def test_harness_yaml_stub_valid(profile_path: Path):
    """PROFILE-04: harness.yaml stub (Phase-2 placeholder values) loads cleanly."""
    cfg = loader.load_harness(profile_path / "harness.yaml")
    assert cfg.prompts.system == "prompts/system.md"
    assert cfg.prompts.use_system_role is True
    assert cfg.context.max_input_tokens > 0


def test_extra_forbid_rejects_unknown_key(tmp_path: Path):
    """PROFILE-03: pydantic `extra='forbid'` rejects typos / unknown keys."""
    bad = tmp_path / "serving.yaml"
    bad.write_text("engine:\n  model: x\n  bogus_field_XYZ: 1\n")
    with pytest.raises(Exception):  # pydantic ValidationError subclass
        loader.load_serving(bad)


def test_cross_field_vllm_no_usage_stats_required(tmp_path: Path):
    """D-12 layer (c) / SERVE-09: env.VLLM_NO_USAGE_STATS must equal "1".

    Loading a serving.yaml with env.VLLM_NO_USAGE_STATS="0" must fail validation.
    """
    bad = tmp_path / "serving.yaml"
    bad.write_text("""engine:\n  model: x\nenv:\n  VLLM_NO_USAGE_STATS: "0"\n""")
    with pytest.raises(Exception):
        loader.load_serving(bad)


def test_cross_field_hf_hub_offline_required(tmp_path: Path):
    """REPRO-04 / D-12 layer (d): env.HF_HUB_OFFLINE must equal "1"."""
    bad = tmp_path / "serving.yaml"
    bad.write_text("""engine:\n  model: x\nenv:\n  HF_HUB_OFFLINE: "0"\n""")
    with pytest.raises(Exception):
        loader.load_serving(bad)
