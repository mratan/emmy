"""Plan 03.1-02 Task 1 (RED) — WebSearchConfig + WebFetchConfig.search_bypass_ttl_ms.

Covers:
  - WebSearchConfig defaults instantiate cleanly (enabled=False, base_url=...).
  - WebSearchConfig with enabled=True + custom base_url/rate_limit validates.
  - WebFetchConfig now accepts search_bypass_ttl_ms; default is 300000; 0 disables.
  - ToolsConfig.web_search is Optional (None when absent — backward-compat for v1/v2).
  - v1 / v2 / v3 harness.yaml still validate through the updated schema (none of
    these ship tools.web_search; all validate with web_search=None).
  - v3.1 harness.yaml (with tools.web_search block) validates with fields set.

D-37 invariant: adding WebSearchConfig + search_bypass_ttl_ms MUST NOT break
v1/v2/v3 profile validation. Backward-compat contract.
"""
from __future__ import annotations

from pathlib import Path

import pytest

schema = pytest.importorskip("emmy_serve.profile.schema")
loader = pytest.importorskip("emmy_serve.profile.loader")

REPO_ROOT = Path(__file__).parent.parent.parent


# -----------------------------------------------------------------------------
# WebSearchConfig — direct class tests
# -----------------------------------------------------------------------------


def test_web_search_config_defaults_instantiate_cleanly():
    """WebSearchConfig() with no args: enabled=False, base_url loopback, sensible defaults."""
    cfg = schema.WebSearchConfig()
    assert cfg.enabled is False
    assert cfg.base_url == "http://127.0.0.1:8888"
    assert cfg.max_results_default == 10
    assert cfg.rate_limit_per_turn == 10
    assert cfg.timeout_ms == 10000


def test_web_search_config_enabled_with_custom_knobs():
    cfg = schema.WebSearchConfig(
        enabled=True,
        base_url="http://127.0.0.1:8888",
        max_results_default=20,
        rate_limit_per_turn=15,
        timeout_ms=20000,
    )
    assert cfg.enabled is True
    assert cfg.max_results_default == 20
    assert cfg.rate_limit_per_turn == 15


def test_web_search_config_rate_limit_range_enforced():
    """rate_limit_per_turn must be 1..100."""
    with pytest.raises(Exception):
        schema.WebSearchConfig(enabled=True, rate_limit_per_turn=0)
    with pytest.raises(Exception):
        schema.WebSearchConfig(enabled=True, rate_limit_per_turn=1000)


def test_web_search_config_timeout_ms_range_enforced():
    """timeout_ms must be 1000..60000."""
    with pytest.raises(Exception):
        schema.WebSearchConfig(enabled=True, timeout_ms=500)
    with pytest.raises(Exception):
        schema.WebSearchConfig(enabled=True, timeout_ms=600000)


def test_web_search_config_extra_forbid():
    """Plan 03.1-02 schema discipline: extra='forbid' — typos caught."""
    with pytest.raises(Exception):
        schema.WebSearchConfig(enabled=True, bogus_field=42)


# -----------------------------------------------------------------------------
# WebFetchConfig — search_bypass_ttl_ms backward-compat + extension
# -----------------------------------------------------------------------------


def test_web_fetch_config_search_bypass_ttl_default():
    cfg = schema.WebFetchConfig(allowlist=["docs.python.org"])
    assert cfg.search_bypass_ttl_ms == 300000


def test_web_fetch_config_search_bypass_ttl_custom():
    cfg = schema.WebFetchConfig(
        allowlist=["docs.python.org"],
        search_bypass_ttl_ms=600000,
    )
    assert cfg.search_bypass_ttl_ms == 600000


def test_web_fetch_config_search_bypass_ttl_zero_disables_bypass():
    """D-35: 0 ms TTL = bypass disabled; must still validate."""
    cfg = schema.WebFetchConfig(
        allowlist=[],
        search_bypass_ttl_ms=0,
    )
    assert cfg.search_bypass_ttl_ms == 0


def test_web_fetch_config_search_bypass_ttl_negative_rejected():
    with pytest.raises(Exception):
        schema.WebFetchConfig(allowlist=[], search_bypass_ttl_ms=-1)


# -----------------------------------------------------------------------------
# ToolsConfig — web_search is Optional (backward-compat)
# -----------------------------------------------------------------------------


def test_tools_config_web_search_optional_default_none():
    cfg = schema.ToolsConfig(format="openai")
    assert cfg.web_search is None


def test_tools_config_with_web_search_block():
    cfg = schema.ToolsConfig(
        format="openai",
        web_search=schema.WebSearchConfig(enabled=True),
    )
    assert cfg.web_search is not None
    assert cfg.web_search.enabled is True


# -----------------------------------------------------------------------------
# Profile bundles — v1 / v2 / v3 still validate; v3.1 validates with new blocks
# -----------------------------------------------------------------------------


def _load_harness(path: Path):
    return loader.load_harness(path)


def test_v1_harness_yaml_still_validates():
    """D-37 backward-compat invariant: v1 predates tools.web_fetch + tools.web_search."""
    p = REPO_ROOT / "profiles" / "qwen3.6-35b-a3b" / "v1" / "harness.yaml"
    cfg = _load_harness(p)
    assert cfg.tools.web_fetch is None
    assert cfg.tools.web_search is None


def test_v2_harness_yaml_still_validates():
    p = REPO_ROOT / "profiles" / "qwen3.6-35b-a3b" / "v2" / "harness.yaml"
    cfg = _load_harness(p)
    assert cfg.tools.web_fetch is None
    assert cfg.tools.web_search is None


def test_v3_harness_yaml_still_validates():
    p = REPO_ROOT / "profiles" / "qwen3.6-35b-a3b" / "v3" / "harness.yaml"
    cfg = _load_harness(p)
    # v3 has web_fetch but NOT web_search
    assert cfg.tools.web_fetch is not None
    assert "docs.python.org" in cfg.tools.web_fetch.allowlist
    # search_bypass_ttl_ms defaults to 300000 even though v3 didn't specify
    assert cfg.tools.web_fetch.search_bypass_ttl_ms == 300000
    assert cfg.tools.web_search is None


def test_v3_1_harness_yaml_validates_with_new_blocks():
    """Plan 03.1-02 GREEN target: v3.1 ships tools.web_search + search_bypass_ttl_ms."""
    p = REPO_ROOT / "profiles" / "qwen3.6-35b-a3b" / "v3.1" / "harness.yaml"
    cfg = _load_harness(p)
    # web_fetch allowlist retained from v3
    assert cfg.tools.web_fetch is not None
    assert "docs.python.org" in cfg.tools.web_fetch.allowlist
    # search_bypass_ttl_ms explicitly set
    assert cfg.tools.web_fetch.search_bypass_ttl_ms == 300000
    # web_search block present and enabled
    assert cfg.tools.web_search is not None
    assert cfg.tools.web_search.enabled is True
    assert cfg.tools.web_search.base_url == "http://127.0.0.1:8888"
    assert cfg.tools.web_search.max_results_default == 10
    assert cfg.tools.web_search.rate_limit_per_turn == 10
