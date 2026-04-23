"""Plan 04-01 Task 1 (RED scaffold) + Task 2 (GREEN) — Gemma 4 profile schema tests.

Covers five behavior contracts for the Phase-4 Gemma 4 26B A4B profile bundle:

  1. EngineConfig accepts reasoning_parser="gemma4" + tool_call_parser="gemma4"
     + enable_auto_tool_choice=True + quantization="fp8" + kv_cache_dtype="fp8"
     (schema extension in Task 1 added reasoning_parser as Optional[str]=None).

  2. Schema is backward-compatible with Qwen v3.1 serving.yaml, which does NOT
     ship reasoning_parser — loads cleanly with reasoning_parser attribute None.

  3. profiles/gemma-4-26b-a4b-it/v1/serving.yaml loads as EngineConfig with the
     exact Gemma 4 values from 04-RESEARCH.md §2 (populated by Task 2 bundle).

  4. profiles/gemma-4-26b-a4b-it/v1/profile.yaml has >=4 community_sources
     entries each with {title, url, retrieved} keys populated (SC-5 citation
     discipline; D-16 LOCKED).

  5. sampling_defaults matches Google Gemma 4 model card: temperature=1.0,
     top_p=0.95, top_k=64, max_tokens=8192, repetition_penalty=1.0.

Tests 1-2 go GREEN at Task 1 completion (schema extension + Qwen non-regression).
Tests 3-5 go GREEN at Task 2 completion (Gemma bundle files land).
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

schema = pytest.importorskip("emmy_serve.profile.schema")
loader = pytest.importorskip("emmy_serve.profile.loader")

REPO_ROOT = Path(__file__).parent.parent.parent
GEMMA_BUNDLE = REPO_ROOT / "profiles" / "gemma-4-26b-a4b-it" / "v1"
QWEN_V3_1_SERVING = REPO_ROOT / "profiles" / "qwen3.6-35b-a3b" / "v3.1" / "serving.yaml"


# -----------------------------------------------------------------------------
# Test 1 — EngineConfig accepts reasoning_parser + gemma4 knobs (schema-level)
# -----------------------------------------------------------------------------


def test_engine_accepts_reasoning_parser_gemma4():
    """Task 1 RED→GREEN: EngineConfig grows Optional reasoning_parser field."""
    ec = schema.EngineConfig(
        model="/models/gemma-4-26B-A4B-it",
        model_hf_id="google/gemma-4-26B-A4B-it",
        served_model_name="gemma-4-26b-a4b-it",
        container_image="emmy-serve/vllm:26.03.post1-fst",
        container_image_digest="sha256:77321e416cf49702ed6f04af9e5d39945726fea48970bb013617fddc659f9486",
        max_model_len=131072,
        gpu_memory_utilization=0.55,
        kv_cache_dtype="fp8",
        enable_prefix_caching=True,
        enable_chunked_prefill=True,
        max_num_batched_tokens=8192,
        load_format="fastsafetensors",
        quantization="fp8",
        tool_call_parser="gemma4",
        reasoning_parser="gemma4",
        enable_auto_tool_choice=True,
        attention_backend="flashinfer",
        host="0.0.0.0",
        port=8000,
    )
    assert ec.tool_call_parser == "gemma4"
    assert ec.reasoning_parser == "gemma4"
    assert ec.enable_auto_tool_choice is True
    assert ec.quantization == "fp8"
    assert ec.kv_cache_dtype == "fp8"


# -----------------------------------------------------------------------------
# Test 2 — backward-compat: Qwen v3.1 serving.yaml still validates
# -----------------------------------------------------------------------------


def test_engine_reasoning_parser_optional_qwen_v3_1_still_validates():
    """Task 1 contract: adding reasoning_parser MUST NOT break Qwen profiles.

    Qwen v3.1 serving.yaml does not ship reasoning_parser; the field must
    default to None and the whole bundle must still validate end-to-end.
    """
    assert QWEN_V3_1_SERVING.exists(), f"Qwen v3.1 serving.yaml missing at {QWEN_V3_1_SERVING}"
    cfg = loader.load_serving(QWEN_V3_1_SERVING)
    assert cfg.engine.tool_call_parser == "qwen3_coder"
    assert cfg.engine.reasoning_parser is None


# -----------------------------------------------------------------------------
# Test 3 — Task 2 GREEN: Gemma 4 serving.yaml loads with all expected values
# -----------------------------------------------------------------------------


def test_gemma4_serving_yaml_full_load():
    """Gemma 4 serving.yaml loads as EngineConfig with the values from RESEARCH §2."""
    serving_path = GEMMA_BUNDLE / "serving.yaml"
    if not serving_path.exists():
        pytest.skip(f"Gemma bundle not yet created at {serving_path} (Plan 04-01 Task 2)")
    cfg = loader.load_serving(serving_path)
    e = cfg.engine
    assert e.tool_call_parser == "gemma4"
    assert e.reasoning_parser == "gemma4"
    assert e.enable_auto_tool_choice is True
    assert e.quantization == "fp8"
    assert e.kv_cache_dtype == "fp8"
    assert e.max_model_len == 131072
    assert e.gpu_memory_utilization == 0.55
    assert e.max_num_seqs == 4
    assert e.max_num_batched_tokens == 8192
    assert e.load_format == "fastsafetensors"
    assert e.attention_backend == "flashinfer"


# -----------------------------------------------------------------------------
# Test 4 — Task 2 GREEN: community_sources citation discipline (SC-5 / D-16)
# -----------------------------------------------------------------------------


def test_gemma4_profile_yaml_has_community_sources():
    """SC-5: profile.yaml.community_sources has >=4 entries; every entry has the
    three required keys {title, url, retrieved}.
    """
    profile_path = GEMMA_BUNDLE / "profile.yaml"
    if not profile_path.exists():
        pytest.skip(f"Gemma bundle not yet created at {profile_path} (Plan 04-01 Task 2)")
    manifest = loader.load_profile_manifest(profile_path)
    sources = manifest.profile.community_sources
    assert len(sources) >= 4, f"expected >=4 community_sources, got {len(sources)}"
    for src in sources:
        assert src.title, f"title missing on community_source {src}"
        assert src.url, f"url missing on community_source {src}"
        assert src.retrieved, f"retrieved missing on community_source {src}"


# -----------------------------------------------------------------------------
# Test 5 — Task 2 GREEN: sampling_defaults match Google Gemma 4 model card
# -----------------------------------------------------------------------------


def test_gemma4_sampling_defaults():
    """Sampling defaults pinned to Google Gemma 4 model card values."""
    serving_path = GEMMA_BUNDLE / "serving.yaml"
    if not serving_path.exists():
        pytest.skip(f"Gemma bundle not yet created at {serving_path} (Plan 04-01 Task 2)")
    raw = yaml.safe_load(serving_path.read_text(encoding="utf-8"))
    sd = raw["sampling_defaults"]
    assert sd["temperature"] == 1.0
    assert sd["top_p"] == 0.95
    assert sd["top_k"] == 64
    assert sd["max_tokens"] == 8192
    assert sd["repetition_penalty"] == 1.0
