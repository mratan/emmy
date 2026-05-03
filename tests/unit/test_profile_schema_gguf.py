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


# -----------------------------------------------------------------------------
# Test 5 — 04.7-02 follow-up (Decision Option 5): airgap_patch_dir field
# -----------------------------------------------------------------------------


def test_engine_accepts_airgap_patch_dir():
    """04.7-02 Decision Option 5: ``airgap_patch_dir`` field accepts a relative
    bundle-internal path string.

    When set, the boot runner mounts ``<bundle>/<airgap_patch_dir>`` into the
    container at ``/airgap_patches`` and prepends that path to PYTHONPATH so
    Python's site machinery imports ``sitecustomize.py`` from the dir at
    process start (BEFORE vllm imports transformers). Used to monkey-patch
    transformers' GGUF allowlist for ``mistral3`` per Plan 04.7-02 follow-up.
    """
    ec = schema.EngineConfig(
        **_kwargs(
            quantization="gguf",
            tokenizer=None,
            hf_config_path="/models/Mistral-Medium-3.5-128B-config",
            airgap_patch_dir="airgap_patches",
        )
    )
    assert ec.airgap_patch_dir == "airgap_patches"
    # Spot-check: the field coexists cleanly with the other GGUF knobs
    assert ec.quantization == "gguf"
    assert ec.hf_config_path == "/models/Mistral-Medium-3.5-128B-config"


def test_engine_airgap_patch_dir_optional_default_none():
    """04.7-02 Decision Option 5 — backward-compat: pre-04.7-02-followup profiles
    validate with airgap_patch_dir=None.

    Mirrors the ``test_engine_hf_config_path_optional_default_none`` invariant
    for the partner field. All 7+ shipped bundles (Gemma 4 v1/v2/v2.1, Gemma
    31B v1/v1.1/v1.2, Qwen 27B v1/v1.1, etc.) MUST continue to validate
    without declaring this field. (And for non-Mistral GGUF profiles the
    sitecustomize hot-patch is irrelevant — leaving the field unset keeps
    them unaffected.)
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
    kwargs.pop("airgap_patch_dir", None)
    ec = schema.EngineConfig(**kwargs)
    assert ec.airgap_patch_dir is None


# -----------------------------------------------------------------------------
# Test 6 — 04.7-02 follow-up Decision Option 5 (sitecustomize wave): dtype field
# -----------------------------------------------------------------------------
#
# `EngineConfig.dtype: Optional[Literal["auto", "float16", "bfloat16",
# "float32"]] = None` was added in commit `35aee85` (Wave 3 / sitecustomize
# iteration) without a paired schema-test commit. These two tests close that
# coverage gap so the field's accept/Optional contract has a regression guard
# alongside its sibling additive fields (tokenizer / hf_config_path /
# airgap_patch_dir / tokenizer_mode).


def test_engine_accepts_dtype_float16():
    """04.7-02 sitecustomize wave: ``dtype`` field accepts ``"float16"``.

    Required for Mistral 3.x GGUF whose source config.json declares
    `dtype=bfloat16` but vLLM's GGUF backend allowlists only
    `[torch.float16, torch.float32]` (see schema docstring for the
    `vllm/engine/arg_utils.py:2094 create_engine_config` rejection trace).
    """
    ec = schema.EngineConfig(
        **_kwargs(
            quantization="gguf",
            tokenizer=None,
            hf_config_path="/models/Mistral-Medium-3.5-128B-config",
            airgap_patch_dir="airgap_patches",
            dtype="float16",
        )
    )
    assert ec.dtype == "float16"
    # Spot-check: dtype coexists with the other GGUF knobs
    assert ec.quantization == "gguf"
    assert ec.airgap_patch_dir == "airgap_patches"


def test_engine_dtype_optional_default_none():
    """04.7-02 sitecustomize wave — backward-compat: pre-04.7-02-followup
    profiles validate with dtype=None.

    Mirrors the airgap_patch_dir / hf_config_path / tokenizer Optional-default
    invariants. All 7+ shipped bundles (Gemma 4 v1/v2/v2.1, Gemma 31B
    v1/v1.1/v1.2, Qwen 27B v1/v1.1) MUST continue to validate without
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
    kwargs.pop("dtype", None)
    ec = schema.EngineConfig(**kwargs)
    assert ec.dtype is None


def test_engine_rejects_unknown_dtype():
    """04.7-02 sitecustomize wave — adjacent-typo guard: only the
    Literal["auto","float16","bfloat16","float32"] values pass.
    A typo like ``"fp16"`` (the kv_cache_dtype name, not torch's) must
    be rejected so the schema catches profile-author confusion early.
    """
    with pytest.raises(pydantic.ValidationError):
        schema.EngineConfig(**_kwargs(quantization="gguf", dtype="fp16"))


# -----------------------------------------------------------------------------
# Test 7 — 04.7-02 follow-up Decision Option 7a: tokenizer_mode field
# -----------------------------------------------------------------------------
#
# Plan 04.7-02 Wave 3 attempt 7 (run_id `20260502T234222Z-e848d9`) reached the
# deepest engine-init code yet then failed with `pydantic_core.ValidationError:
# The tokenizer must be an instance of MistralTokenizer.` because vLLM's
# `tool_call_parser: mistral` path requires `mistral_common.MistralTokenizer`,
# which `tokenizer_mode=auto` (vLLM default) does NOT load. Decision Option 7a
# is `tokenizer_mode: mistral` + sibling `tekken.json` in the
# `tokenizer:`-pointed dir.


def test_engine_accepts_tokenizer_mode_mistral():
    """04.7-02 Option 7a: ``tokenizer_mode="mistral"`` accepted.

    The Literal must include "mistral" because vLLM's `mistral` tool-call
    parser path is gated on the tokenizer being a `MistralTokenizer`
    instance, which only loads when `--tokenizer-mode mistral` is set.
    """
    ec = schema.EngineConfig(
        **_kwargs(
            quantization="gguf",
            tokenizer="/models/Mistral-Medium-3.5-128B-config",
            hf_config_path="/models/Mistral-Medium-3.5-128B-config",
            airgap_patch_dir="airgap_patches",
            dtype="float16",
            tokenizer_mode="mistral",
        )
    )
    assert ec.tokenizer_mode == "mistral"
    # Spot-check: tokenizer_mode coexists with the rest of the Mistral GGUF
    # knob stack (sitecustomize + dtype + workaround-A hf_config_path)
    assert ec.tool_call_parser == "mistral"
    assert ec.reasoning_parser == "mistral"


def test_engine_accepts_tokenizer_mode_other_values():
    """04.7-02 Option 7a — Literal contains the byte-identical set vLLM 0.19
    exposes at vllm/config/model.py:85 (`Literal["auto","hf","slow",
    "mistral","deepseek_v32"]`). The four non-mistral values are sanity-
    checked here so a future vLLM-side rename surfaces as a test failure
    rather than a silent profile-validation diff.
    """
    for value in ("auto", "hf", "slow", "deepseek_v32"):
        ec = schema.EngineConfig(**_kwargs(tokenizer_mode=value))
        assert ec.tokenizer_mode == value


def test_engine_rejects_unknown_tokenizer_mode():
    """04.7-02 Option 7a — adjacent-typo guard: invented values rejected.

    "tekken" is the format name; vLLM does NOT have it as a `tokenizer_mode`
    Literal (the right value is `mistral`, which then loads tekken.json
    via mistral-common). A profile author who confuses the file format with
    the mode name must be caught at validation time.
    """
    with pytest.raises(pydantic.ValidationError):
        schema.EngineConfig(**_kwargs(tokenizer_mode="tekken"))


def test_engine_tokenizer_mode_optional_default_none():
    """04.7-02 Option 7a — backward-compat: pre-04.7-02-followup profiles
    validate with tokenizer_mode=None.

    Mirrors the dtype / airgap_patch_dir / hf_config_path / tokenizer
    Optional-default invariants. All 7+ shipped non-Mistral bundles MUST
    continue to validate without declaring this field.
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
    kwargs.pop("tokenizer_mode", None)
    ec = schema.EngineConfig(**kwargs)
    assert ec.tokenizer_mode is None
