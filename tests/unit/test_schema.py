"""RED skeleton — PROFILE-03 / PROFILE-04 pydantic schema + cross-field validators.

Modules that satisfy these tests are created in Plan 02 (profile loader + schema).
Until those modules exist, `pytest.importorskip` turns the whole file into a skip
at collection time so `uv run pytest tests/unit` exits 0.

Phase 3 Plan 03-07 extends with CompactionConfig + WebFetchConfig regression
tests (D-11..D-17 + D-26..D-28). v1 and v2 must continue to validate without
the new blocks (backward-compat via Optional); v3 validates with them.

Phase 4 Plan 04-01 adds ``test_all_shipped_profiles_validate`` — a backward-compat
guard that walks every bundle under ``profiles/*/v*/`` and validates each via
``loader.load_profile``. Any new profile bundle added to the repo is auto-covered.
"""
from __future__ import annotations
from pathlib import Path
import pytest

schema = pytest.importorskip("emmy_serve.profile.schema")
loader = pytest.importorskip("emmy_serve.profile.loader")

REPO_ROOT = Path(__file__).parent.parent.parent


def _discover_shipped_bundles() -> list[Path]:
    """Walk profiles/*/v*/ returning every directory that looks like a bundle.

    A directory qualifies as a bundle when it contains all three required
    files: profile.yaml + serving.yaml + harness.yaml. routes.yaml (Plan 04-04)
    lives at profiles/routes.yaml (not a directory) and is skipped.
    """
    profiles_root = REPO_ROOT / "profiles"
    if not profiles_root.is_dir():
        return []
    out: list[Path] = []
    for family_dir in sorted(profiles_root.iterdir()):
        if not family_dir.is_dir():
            continue
        for version_dir in sorted(family_dir.iterdir()):
            if not version_dir.is_dir():
                continue
            if all(
                (version_dir / f).exists()
                for f in ("profile.yaml", "serving.yaml", "harness.yaml")
            ):
                out.append(version_dir)
    return out


def test_all_shipped_profiles_validate():
    """Phase 4 backward-compat guard: every shipped profile bundle validates.

    Asserts that every bundle under ``profiles/<family>/<version>/`` loads
    cleanly via ``loader.load_profile``. Adding a new profile auto-extends
    this test. If this test fails, a schema change broke a prior profile.
    """
    bundles = _discover_shipped_bundles()
    assert bundles, "no shipped profile bundles discovered under profiles/"
    failures: list[str] = []
    for b in bundles:
        try:
            loader.load_profile(b)
        except Exception as e:  # pragma: no cover — asserted below
            failures.append(f"{b.relative_to(REPO_ROOT)}: {e}")
    assert not failures, "shipped profiles failed to validate:\n  " + "\n  ".join(failures)


def test_serving_yaml_valid(profile_path: Path):
    """PROFILE-03: serving.yaml loads and all required engine fields are present."""
    cfg = loader.load_serving(profile_path / "serving.yaml")
    assert cfg.engine.served_model_name == "gemma-4-26b-a4b-it"
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


# -----------------------------------------------------------------------------
# Phase 3 Plan 03-07 — CompactionConfig + WebFetchConfig regression tests
# -----------------------------------------------------------------------------


_V3_HARNESS_MINIMAL = """\
prompts:
  system: prompts/system.md
  edit_format: prompts/edit_format.md
  tool_descriptions: prompts/tool_descriptions.md
  use_system_role: true
  prepend_system_text: ""

context:
  max_input_tokens: 114688
  include_repo_map: false
  repo_map_max_tokens: 0
  default_pruning: head_tail
  compaction:
    soft_threshold_pct: 0.75
    preserve_recent_turns: 5
    summarization_prompt_path: prompts/compact.md
    preserve_tool_results: error_only

tools:
  format: openai
  schemas: tool_schemas/
  grammar:
    path: grammars/tool_call.lark
    mode: reactive
  per_tool_sampling:
    edit: {temperature: 0.0}
  web_fetch:
    allowlist:
      - docs.python.org
      - docs.vllm.ai

agent_loop:
  max_iterations: 25
  retry_on_unparseable_tool_call: 2
  retry_on_empty_response: 1
  self_correction: enabled

advanced_settings_whitelist:
  - reasoning_effort
"""


def test_v2_harness_validates_without_compaction_block(tmp_path: Path):
    """Phase 3 backward-compat: v2/harness.yaml has NO compaction block; must still load."""
    # Minimal v2-shaped harness.yaml (no compaction, no web_fetch)
    p = tmp_path / "harness.yaml"
    p.write_text(
        "prompts:\n"
        "  system: prompts/system.md\n"
        "  use_system_role: true\n"
        "  prepend_system_text: \"\"\n"
        "context:\n"
        "  max_input_tokens: 114688\n"
        "  include_repo_map: false\n"
        "  repo_map_max_tokens: 0\n"
        "  default_pruning: head_tail\n"
        "tools:\n"
        "  format: openai\n"
        "  per_tool_sampling: {}\n"
        "agent_loop:\n"
        "  max_iterations: 25\n"
        "  retry_on_unparseable_tool_call: 2\n"
        "  retry_on_empty_response: 1\n"
        "  self_correction: enabled\n"
    )
    cfg = loader.load_harness(p)
    assert cfg.context.compaction is None
    assert cfg.tools.web_fetch is None


def test_v3_harness_validates_with_compaction_and_web_fetch(tmp_path: Path):
    """Phase 3 happy path: v3/harness.yaml has both new blocks; must load cleanly."""
    p = tmp_path / "harness.yaml"
    p.write_text(_V3_HARNESS_MINIMAL)
    cfg = loader.load_harness(p)
    # compaction block loaded correctly
    assert cfg.context.compaction is not None
    assert cfg.context.compaction.soft_threshold_pct == 0.75
    assert cfg.context.compaction.preserve_recent_turns == 5
    assert cfg.context.compaction.summarization_prompt_path == "prompts/compact.md"
    assert cfg.context.compaction.preserve_tool_results == "error_only"
    # web_fetch block loaded correctly
    assert cfg.tools.web_fetch is not None
    assert "docs.python.org" in cfg.tools.web_fetch.allowlist
    assert "docs.vllm.ai" in cfg.tools.web_fetch.allowlist


def test_compaction_soft_threshold_out_of_range_rejected(tmp_path: Path):
    """D-15: soft_threshold_pct > 1.0 must fail validation."""
    bad = _V3_HARNESS_MINIMAL.replace("soft_threshold_pct: 0.75", "soft_threshold_pct: 1.5")
    p = tmp_path / "harness.yaml"
    p.write_text(bad)
    with pytest.raises(Exception):
        loader.load_harness(p)


def test_compaction_preserve_tool_results_literal_rejected(tmp_path: Path):
    """D-15: preserve_tool_results must be one of {error_only, none, all}."""
    bad = _V3_HARNESS_MINIMAL.replace(
        "preserve_tool_results: error_only", "preserve_tool_results: bogus"
    )
    p = tmp_path / "harness.yaml"
    p.write_text(bad)
    with pytest.raises(Exception):
        loader.load_harness(p)


def test_compaction_preserve_recent_turns_negative_rejected(tmp_path: Path):
    """D-15: preserve_recent_turns must be non-negative integer."""
    bad = _V3_HARNESS_MINIMAL.replace("preserve_recent_turns: 5", "preserve_recent_turns: -1")
    p = tmp_path / "harness.yaml"
    p.write_text(bad)
    with pytest.raises(Exception):
        loader.load_harness(p)


def test_web_fetch_allowlist_empty_list_accepted(tmp_path: Path):
    """D-26: empty allowlist is valid (means default-deny all non-loopback)."""
    empty = _V3_HARNESS_MINIMAL.replace(
        "  web_fetch:\n      allowlist:\n        - docs.python.org\n        - docs.vllm.ai\n",
        "  web_fetch:\n      allowlist: []\n",
    )
    # The replace above is tolerant of indent — fall back to a structured write
    p = tmp_path / "harness.yaml"
    # Rewrite with an explicit empty allowlist on a clean scaffold:
    v3_empty = _V3_HARNESS_MINIMAL.split("web_fetch:")[0] + (
        "web_fetch:\n"
        "    allowlist: []\n"
        "\n"
        "agent_loop:\n"
        "  max_iterations: 25\n"
        "  retry_on_unparseable_tool_call: 2\n"
        "  retry_on_empty_response: 1\n"
        "  self_correction: enabled\n"
        "\n"
        "advanced_settings_whitelist:\n"
        "  - reasoning_effort\n"
    )
    p.write_text(v3_empty)
    cfg = loader.load_harness(p)
    assert cfg.tools.web_fetch is not None
    assert cfg.tools.web_fetch.allowlist == []


def test_compaction_config_extra_field_rejected(tmp_path: Path):
    """Phase 1 D-03 discipline: extra='forbid' on CompactionConfig — typos caught."""
    bad = _V3_HARNESS_MINIMAL.replace(
        "    preserve_tool_results: error_only",
        "    preserve_tool_results: error_only\n    preserv_recent_turns_typo: 7",
    )
    p = tmp_path / "harness.yaml"
    p.write_text(bad)
    with pytest.raises(Exception):
        loader.load_harness(p)
