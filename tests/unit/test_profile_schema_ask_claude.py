"""Phase 04.6-03 Task 1 — AskClaudeConfig pydantic schema tests (RED).

Mirrors the patterns from `tests/unit/test_profile_schema_memory.py`
(MemoryConfig precedent) and `tests/unit/test_schema.py` (CompactionConfig +
WebFetchConfig backward-compat). The block under test is `tools.ask_claude:`
on harness.yaml — STRICTLY ADDITIVE per Phase 04.6 D-04 (CONTEXT.md):

  - When the block is absent in a profile bundle, ToolsConfig validates with
    `ask_claude=None` (backward-compat with all 7 currently shipping bundles).
  - When the block is present, AskClaudeConfig validates with documented
    defaults (D-13 — opt-in; default enabled=False even when block present).
  - The bundle hash is computed from FILE BYTES on disk (see hasher.py
    EXCLUDE_ROOT_FILES), so adding a new optional pydantic field does NOT
    change any shipping profile's hash.

Tests cover:
  - Defaults validate (T-01..T-03)
  - Backward-compat: ToolsConfig without ask_claude block validates (T-04)
  - ToolsConfig with full ask_claude block surfaces typed AskClaudeConfig (T-05)
  - Disabled-by-default-when-block-present semantics (T-06)
  - rate_limit positive-int constraints (T-07..T-10)
  - extra fields rejected (extra="forbid") (T-11)
  - Hash invariance for all 7 shipping bundles when block is absent (T-12)
"""
from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from emmy_serve.profile import hasher
from emmy_serve.profile.schema import (
    AskClaudeConfig,
    ToolsConfig,
)

REPO_ROOT = Path(__file__).parent.parent.parent


# ----- defaults -----------------------------------------------------------


def test_defaults_validate():
    """All-defaults AskClaudeConfig: opt-in (enabled=False) per D-13.

    Even when the block is present in harness.yaml, the model-side tool is
    NOT registered until the operator flips enabled=True. This is the
    "opt-in per profile" semantics from D-13."""
    cfg = AskClaudeConfig()
    assert cfg.enabled is False
    assert cfg.rate_limit_per_turn == 5
    assert cfg.rate_limit_per_hour == 30


def test_enabled_true_valid():
    """Operator opt-in path: enabled=True with default rate-limits."""
    cfg = AskClaudeConfig(enabled=True)
    assert cfg.enabled is True
    assert cfg.rate_limit_per_turn == 5
    assert cfg.rate_limit_per_hour == 30


def test_full_block_validates():
    """Full populated block honors operator-overridden rate-limits."""
    cfg = AskClaudeConfig(
        enabled=True,
        rate_limit_per_turn=3,
        rate_limit_per_hour=20,
    )
    assert cfg.enabled is True
    assert cfg.rate_limit_per_turn == 3
    assert cfg.rate_limit_per_hour == 20


# ----- backward-compat: ToolsConfig without ask_claude --------------------


def test_tools_config_ask_claude_absent_validates_as_none():
    """D-04 — absent block parses cleanly with ask_claude=None.

    This is the load-bearing additive invariant: every currently-shipping
    profile bundle (7 of them, none of which carry tools.ask_claude) MUST
    continue to validate with this exact shape. If this test fails, the
    schema change is no longer strictly additive and we have a CLAUDE.md
    profile-immutability violation requiring 7 sibling-version bumps."""
    cfg = ToolsConfig.model_validate({"format": "openai"})
    assert cfg.ask_claude is None


def test_tools_config_ask_claude_minimal_block():
    """tools.ask_claude.enabled: false (the default) validates."""
    cfg = ToolsConfig.model_validate(
        {"format": "openai", "ask_claude": {"enabled": False}}
    )
    assert cfg.ask_claude is not None
    assert cfg.ask_claude.enabled is False
    assert cfg.ask_claude.rate_limit_per_turn == 5
    assert cfg.ask_claude.rate_limit_per_hour == 30


def test_tools_config_ask_claude_full_block():
    """Full populated block surfaces typed AskClaudeConfig with overrides."""
    cfg = ToolsConfig.model_validate(
        {
            "format": "openai",
            "ask_claude": {
                "enabled": True,
                "rate_limit_per_turn": 3,
                "rate_limit_per_hour": 20,
            },
        }
    )
    assert cfg.ask_claude is not None
    assert cfg.ask_claude.enabled is True
    assert cfg.ask_claude.rate_limit_per_turn == 3
    assert cfg.ask_claude.rate_limit_per_hour == 20


# ----- positive bounds on rate-limits -------------------------------------


def test_rate_limit_per_turn_zero_invalid():
    with pytest.raises(ValidationError):
        AskClaudeConfig(rate_limit_per_turn=0)


def test_rate_limit_per_turn_negative_invalid():
    with pytest.raises(ValidationError):
        AskClaudeConfig(rate_limit_per_turn=-1)


def test_rate_limit_per_turn_above_cap_invalid():
    """Schema upper-cap (le=100) prevents accidental rate-limit footgun."""
    with pytest.raises(ValidationError):
        AskClaudeConfig(rate_limit_per_turn=101)


def test_rate_limit_per_hour_zero_invalid():
    with pytest.raises(ValidationError):
        AskClaudeConfig(rate_limit_per_hour=0)


def test_rate_limit_per_hour_negative_invalid():
    with pytest.raises(ValidationError):
        AskClaudeConfig(rate_limit_per_hour=-5)


def test_rate_limit_per_hour_above_cap_invalid():
    """Schema upper-cap (le=1000) prevents accidental rate-limit footgun."""
    with pytest.raises(ValidationError):
        AskClaudeConfig(rate_limit_per_hour=1001)


# ----- nested invalid via ToolsConfig (rejection path callers see) --------


def test_tools_config_ask_claude_invalid_rate_limit_rejects():
    """Surfacing through ToolsConfig: nested validation error."""
    with pytest.raises(ValidationError):
        ToolsConfig.model_validate(
            {
                "format": "openai",
                "ask_claude": {"enabled": True, "rate_limit_per_turn": -1},
            }
        )


# ----- extra="forbid" -----------------------------------------------------


def test_extra_fields_rejected():
    """Per AskClaudeConfig.model_config = ConfigDict(extra='forbid'),
    typo'd or unknown keys must surface as ValidationError instead of
    being silently dropped."""
    with pytest.raises(ValidationError):
        AskClaudeConfig.model_validate(
            {"enabled": True, "ratelimit_per_turn": 3}  # typo: missing "_"
        )


# ----- D-04 hash invariance over all 7 shipping bundles -------------------


SHIPPING_BUNDLES = [
    "profiles/gemma-4-26b-a4b-it/v2",
    "profiles/gemma-4-26b-a4b-it/v2.1",
    "profiles/qwen3.6-27b/v1",
    "profiles/qwen3.6-27b/v1.1",
    "profiles/gemma-4-31b-it/v1",
    "profiles/gemma-4-31b-it/v1.1",
    "profiles/gemma-4-31b-it/v1.2",
]


@pytest.mark.parametrize("bundle_path", SHIPPING_BUNDLES)
def test_shipping_bundle_hash_unchanged_after_additive_schema(bundle_path: str):
    """D-04 byte-identity invariant: every shipping bundle's content-hash
    is unaffected by adding the optional `tools.ask_claude` field to the
    pydantic schema.

    This is structurally guaranteed because hasher.hash_bundle() walks
    FILE BYTES on disk (see emmy_serve/profile/hasher.py compute_manifest);
    the pydantic schema is module code, not bundle content. This test
    asserts that property by re-hashing each bundle and comparing to the
    `hash:` line stored in profile.yaml.

    If this fails after the schema change, then either:
      (a) the hash IS sensitive to schema changes (would be a bug), or
      (b) someone modified bundle bytes in this plan (deviation from D-04).
    Both are halt-and-investigate conditions per CLAUDE.md."""
    bundle = REPO_ROOT / bundle_path
    assert bundle.is_dir(), f"bundle missing: {bundle}"

    # Read the stored hash from profile.yaml.
    profile_yaml = bundle / "profile.yaml"
    stored_hash = None
    for line in profile_yaml.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("hash: sha256:"):
            stored_hash = s.split("hash: ", 1)[1].strip()
            break
    assert stored_hash is not None, (
        f"no `hash:` line in {profile_yaml}"
    )

    computed = hasher.hash_bundle(bundle)
    assert computed == stored_hash, (
        f"D-04 byte-identity invariant violated for {bundle_path}: "
        f"stored={stored_hash}, computed={computed}. The plan claims "
        f"strict-additive schema change but the bundle hash drifted — "
        f"either bundle bytes were edited (forbidden in 04.6-03) or the "
        f"pydantic schema serializes defaults into the manifest (would be "
        f"a bug since hasher.py reads file bytes, not schema output)."
    )
