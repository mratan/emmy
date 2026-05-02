"""Plan 04.7-01 Task 1 — schema-extension tests for GGUF backend support.

Three behavior contracts for the Phase 04.7 Mistral Medium 3.5 128B alternate:

  1. EngineConfig accepts ``quantization="gguf"`` (Literal extension) and the
     new ``tokenizer: Optional[str] = None`` field — covers vLLM's experimental
     GGUF backend per CONTEXT D-02 + 04.7-RESEARCH.md §1.2.

  2. EngineConfig REJECTS unknown quantization strings (e.g. ``"ggml"`` typo)
     — backstops the Literal extension scope; prevents silent acceptance of
     adjacent typos.

  3. EngineConfig.tokenizer is Optional and defaults to None — backward-compat
     guarantee for the 7+ shipped profiles that don't set the field.

Same fixture style as ``tests/unit/test_profile_schema_gemma4.py``: isolated
EngineConfig construction with all required fields populated, then assertions.
"""
from __future__ import annotations

import pytest

schema = pytest.importorskip("emmy_serve.profile.schema")
pydantic = pytest.importorskip("pydantic")


def _kwargs(**overrides):
    """Minimal-valid EngineConfig kwargs; callers override a subset.

    Mirrors the seed used by ``test_profile_schema_gemma4.test_engine_accepts_reasoning_parser_gemma4``
    but parameterised so the GGUF-specific tests can flip ``quantization`` /
    ``tokenizer`` / ``load_format`` without re-listing every required field.
    """
    base = dict(
        model="/models/Mistral-Medium-3.5-128B-Q4_K_M.gguf",
        model_hf_id="mistralai/Mistral-Medium-3.5-128B",
        served_model_name="mistral-medium-3.5",
        container_image="vllm/vllm-openai:cu130-nightly-aarch64",
        container_image_digest="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        max_model_len=131072,
        gpu_memory_utilization=0.78,
        kv_cache_dtype="fp8",
        enable_prefix_caching=True,
        enable_chunked_prefill=True,
        max_num_batched_tokens=8192,
        max_num_seqs=1,
        load_format="auto",
        quantization="gguf",
        tool_call_parser="mistral",
        reasoning_parser="mistral",
        enable_auto_tool_choice=True,
        host="0.0.0.0",
        port=8000,
    )
    base.update(overrides)
    return base


# -----------------------------------------------------------------------------
# Test 1 — EngineConfig accepts quantization="gguf" + tokenizer field
# -----------------------------------------------------------------------------


def test_engine_accepts_quantization_gguf():
    """04.7-01 Task 1 (GREEN gate): Literal grows ``"gguf"``, tokenizer field exists."""
    ec = schema.EngineConfig(
        **_kwargs(
            quantization="gguf",
            tokenizer="mistralai/Mistral-Medium-3.5-128B",
        )
    )
    assert ec.quantization == "gguf"
    assert ec.tokenizer == "mistralai/Mistral-Medium-3.5-128B"
    # Spot-check: GGUF profile carries the Mistral parser pair (CONTEXT D-09)
    assert ec.tool_call_parser == "mistral"
    assert ec.reasoning_parser == "mistral"


# -----------------------------------------------------------------------------
# Test 2 — Negative case: typo "ggml" must be rejected
# -----------------------------------------------------------------------------


def test_engine_rejects_unknown_quantization():
    """04.7-01 Task 1 — adjacent-typo guard: ``"ggml"`` is not in the Literal."""
    with pytest.raises(pydantic.ValidationError):
        schema.EngineConfig(**_kwargs(quantization="ggml"))


# -----------------------------------------------------------------------------
# Test 3 — Backward compat: tokenizer field defaults to None when omitted
# -----------------------------------------------------------------------------


def test_engine_tokenizer_optional_default_none():
    """04.7-01 Task 1 — every shipping non-GGUF profile validates with tokenizer=None.

    Construct an FP8-style EngineConfig (no tokenizer override), assert
    ``.tokenizer is None``. This is the byte-additive guarantee that lets the
    7+ shipping bundles continue to validate.
    """
    kwargs = _kwargs(
        model="/models/gemma-4-26B-A4B-it",
        model_hf_id="google/gemma-4-26B-A4B-it",
        served_model_name="gemma-4-26b-a4b-it",
        quantization="fp8",
        load_format="fastsafetensors",
        tool_call_parser="gemma4",
        reasoning_parser="gemma4",
    )
    # IMPORTANT: deliberately do NOT pass tokenizer kwarg here.
    kwargs.pop("tokenizer", None)
    ec = schema.EngineConfig(**kwargs)
    assert ec.tokenizer is None
    assert ec.quantization == "fp8"


# -----------------------------------------------------------------------------
# Test 4 — 04.7-02 Workaround A: hf_config_path field accepted + Optional default
# -----------------------------------------------------------------------------


def test_engine_accepts_hf_config_path():
    """04.7-02 Workaround A: ``hf_config_path`` field accepts a string path.

    When set, the value is the container-internal path to a directory
    containing ``config.json`` (and optionally tokenizer files). vLLM consumes
    it via the ``--hf-config-path`` CLI flag and uses it as the FIRST argument
    to ``get_config()`` instead of the model path — bypassing the GGUF
    parser's per-architecture allowlist for the config-resolution step.
    """
    ec = schema.EngineConfig(
        **_kwargs(
            quantization="gguf",
            tokenizer=None,  # Mistral profile uses GGUF-embedded tokenizer per Plan 04.7-02 attempt 2 fallback
            hf_config_path="/models/Mistral-Medium-3.5-128B-config",
        )
    )
    assert ec.hf_config_path == "/models/Mistral-Medium-3.5-128B-config"
    # Spot-check: the field coexists cleanly with the other GGUF knobs
    assert ec.quantization == "gguf"
    assert ec.tokenizer is None  # explicit None is the Mistral v1 fallback shape


def test_engine_hf_config_path_optional_default_none():
    """04.7-02 Workaround A — backward-compat: pre-04.7-02 profiles validate
    with hf_config_path=None.

    Mirrors the ``test_engine_tokenizer_optional_default_none`` invariant for
    the partner field. All 7+ shipped bundles (Gemma 4 v1/v2/v2.1, Gemma 31B
    v1/v1.1/v1.2, Qwen 27B v1/v1.1, etc.) MUST continue to validate without
    declaring this field.
    """
    kwargs = _kwargs(
        model="/models/gemma-4-26B-A4B-it",
        model_hf_id="google/gemma-4-26B-A4B-it",
        served_model_name="gemma-4-26b-a4b-it",
        quantization="fp8",
        load_format="fastsafetensors",
        tool_call_parser="gemma4",
        reasoning_parser="gemma4",
    )
    # Deliberately do NOT pass hf_config_path kwarg here.
    kwargs.pop("hf_config_path", None)
    ec = schema.EngineConfig(**kwargs)
    assert ec.hf_config_path is None
