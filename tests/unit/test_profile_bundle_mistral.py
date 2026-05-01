"""Plan 04.7-01 Task 2 — guard rail that the Mistral bundle round-trips through the loader.

Three contracts:

  1. ``serving.yaml`` loads with the Plan 04.7-01 schema extensions
     (``quantization="gguf"`` + ``tokenizer="mistralai/..."``) and carries the
     CONTEXT D-01..D-09 values verbatim.

  2. ``profile.yaml`` ships >=4 community_sources entries (D-16 citation
     discipline; minimum: bartowski GGUF, mistralai HF base card, vLLM GGUF
     docs, vLLM tool_calling docs).

  3. ``DEFAULT_VARIANT`` resolves to ``v1`` (single-version case per CONTEXT
     D-11; no sibling-of-siblings).

These tests intentionally do NOT call ``emmy profile validate`` — that is
expected to fail on the ``sha256:REPLACE_AT_FIRST_PULL`` digest sentinel until
Plan 04.7-02 captures the real digest at first ``docker pull``. Loader-level
assertions cover the non-digest schema work this plan ships.
"""
from __future__ import annotations
from pathlib import Path
import pytest

schema = pytest.importorskip("emmy_serve.profile.schema")
loader = pytest.importorskip("emmy_serve.profile.loader")

REPO_ROOT = Path(__file__).parent.parent.parent
BUNDLE = REPO_ROOT / "profiles" / "mistral-medium-3.5" / "v1"


@pytest.mark.skipif(not BUNDLE.exists(), reason="Mistral bundle not yet authored")
def test_serving_yaml_loads_with_gguf_quantization():
    """serving.yaml carries CONTEXT D-01..D-09 values verbatim.

    Constructs an EngineConfig directly from the on-disk YAML with the digest
    overridden to a shape-valid placeholder (the on-disk digest is the
    intentional ``REPLACE_AT_FIRST_PULL`` sentinel that ``_digest_shape``
    rejects until Plan 04.7-02 captures the real value at first ``docker pull``).
    Verifies every other schema-level field per the Plan 04.7-01 acceptance
    criteria.
    """
    import yaml
    raw = yaml.safe_load((BUNDLE / "serving.yaml").read_text())
    raw["engine"]["container_image_digest"] = (
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    )
    s = schema.ServingConfig(**raw)
    assert s.engine.quantization == "gguf"
    assert s.engine.tokenizer == "mistralai/Mistral-Medium-3.5-128B"
    assert s.engine.tool_call_parser == "mistral"
    assert s.engine.reasoning_parser == "mistral"
    assert s.engine.max_num_seqs == 1
    assert s.engine.max_model_len == 131072
    assert abs(s.engine.gpu_memory_utilization - 0.78) < 1e-9
    assert s.engine.kv_cache_dtype == "fp8"
    assert s.engine.load_format == "auto"
    assert s.engine.served_model_name == "mistral-medium-3.5"
    assert s.engine.model_hf_id == "mistralai/Mistral-Medium-3.5-128B"


@pytest.mark.skipif(not BUNDLE.exists(), reason="Mistral bundle not yet authored")
def test_profile_yaml_has_min_4_community_sources():
    """D-16 citation discipline — minimum 4 community sources, each with title/url/retrieved."""
    import yaml
    with (BUNDLE / "profile.yaml").open() as f:
        data = yaml.safe_load(f)
    assert len(data["profile"]["community_sources"]) >= 4
    for src in data["profile"]["community_sources"]:
        assert {"title", "url", "retrieved"}.issubset(src.keys()), src


@pytest.mark.skipif(not BUNDLE.exists(), reason="Mistral bundle not yet authored")
def test_default_variant_points_to_v1():
    """DEFAULT_VARIANT is exactly ``v1\\n`` (CONTEXT D-11 — single-version case)."""
    dv = (BUNDLE.parent / "DEFAULT_VARIANT").read_text()
    assert dv == "v1\n", f"DEFAULT_VARIANT must be exactly 'v1\\n', got {dv!r}"


@pytest.mark.skipif(not BUNDLE.exists(), reason="Mistral bundle not yet authored")
def test_profile_yaml_hash_is_real_sha256():
    """profile.yaml.profile.hash must be a sha256:<64hex> value (NOT the placeholder sentinel)."""
    import yaml
    with (BUNDLE / "profile.yaml").open() as f:
        data = yaml.safe_load(f)
    h = data["profile"]["hash"]
    assert h.startswith("sha256:")
    assert len(h) == 71  # "sha256:" (7) + 64 hex chars
    assert h != "sha256:" + "0" * 64, "hash is still the all-zeros placeholder"
