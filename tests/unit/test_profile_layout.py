"""RED skeleton — PROFILE-01 / PROFILE-02 bundle layout on disk.

Plan 02 creates `profiles/qwen3.6-35b-a3b/v1/` with the documented sub-paths.
Tests assert the file layout exists; they do NOT assert contents (content tests
live in test_schema.py / test_profile_notes.py / test_container_digest.py).
"""
from __future__ import annotations
from pathlib import Path
import pytest

# Defensive import-guard so the file is always collectible even before deps land.
# No emmy_serve module is imported — these tests only assert filesystem layout;
# pytest.importorskip on a stdlib-safe hook keeps the uniform "every unit test
# file uses importorskip" convention (see 01-01-PLAN.md acceptance criteria).
pytest.importorskip("pathlib")  # stdlib; always present — marker for the convention


def _skip_if_no_bundle(profile_path: Path) -> None:
    if not profile_path.exists():
        pytest.skip(f"profile bundle not yet created at {profile_path} (Plan 02)")


def test_bundle_dir_exists(profile_path: Path):
    """PROFILE-01: profiles/<name>/v<N>/ exists."""
    _skip_if_no_bundle(profile_path)
    assert profile_path.is_dir()


def test_subpaths_present(profile_path: Path):
    """PROFILE-02: every documented subpath exists."""
    _skip_if_no_bundle(profile_path)
    required = [
        "serving.yaml",
        "harness.yaml",
        "profile.yaml",
        "PROFILE_NOTES.md",
        "prompts/system.md",
        "tool_schemas/.gitkeep",
        "grammars/.gitkeep",
    ]
    missing = [p for p in required if not (profile_path / p).exists()]
    assert not missing, f"missing subpaths: {missing}"


def test_tool_schemas_empty_except_gitkeep(profile_path: Path):
    """D-01: tool_schemas/ is empty in Phase 1 (placeholder .gitkeep only)."""
    _skip_if_no_bundle(profile_path)
    entries = sorted((profile_path / "tool_schemas").iterdir())
    names = [e.name for e in entries]
    assert names == [".gitkeep"], f"tool_schemas contents: {names}"


def test_grammars_empty_except_gitkeep(profile_path: Path):
    """D-01: grammars/ is empty in Phase 1."""
    _skip_if_no_bundle(profile_path)
    entries = sorted((profile_path / "grammars").iterdir())
    names = [e.name for e in entries]
    assert names == [".gitkeep"], f"grammars contents: {names}"
