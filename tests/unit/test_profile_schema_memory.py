"""Phase 04.4-03 Task 1 — MemoryConfig pydantic schema tests.

Mirrors the pattern from `tests/unit/test_schema.py` (compaction/web_fetch
backward-compat tests). MemoryConfig is shipped on all 4 v3.1/v1.1/v2/v1.1
profiles per Phase 04.4-03; ContextConfig.memory remains Optional so older
profile bundles still validate.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from emmy_serve.profile.schema import (
    ContextConfig,
    MemoryConfig,
)


# ----- defaults -----------------------------------------------------------


def test_defaults_validate():
    """All-defaults MemoryConfig matches MEMORY-TOOL-SPEC.md §3.2."""
    cfg = MemoryConfig()
    assert cfg.enabled is True
    assert cfg.project_root == ".emmy/notes"
    assert cfg.global_root == "~/.emmy/memory"
    assert cfg.read_at_session_start is True
    assert cfg.max_file_bytes == 65536
    assert cfg.max_total_bytes == 10_485_760
    assert cfg.blocked_extensions == [".env", ".key", ".pem"]


def test_disabled_master_switch():
    """enabled=False is valid."""
    cfg = MemoryConfig(enabled=False)
    assert cfg.enabled is False


def test_project_root_none_disables_scope():
    cfg = MemoryConfig(project_root=None)
    assert cfg.project_root is None


def test_global_root_none_disables_scope():
    cfg = MemoryConfig(global_root=None)
    assert cfg.global_root is None


# ----- positive bounds ---------------------------------------------------


def test_max_file_bytes_zero_invalid():
    with pytest.raises(ValidationError):
        MemoryConfig(max_file_bytes=0)


def test_max_file_bytes_negative_invalid():
    with pytest.raises(ValidationError):
        MemoryConfig(max_file_bytes=-1)


def test_max_file_bytes_large_valid():
    """No upper cap in schema (runtime caps at scope level)."""
    cfg = MemoryConfig(max_file_bytes=10**9, max_total_bytes=10**12)
    assert cfg.max_file_bytes == 10**9


def test_max_total_bytes_zero_invalid():
    with pytest.raises(ValidationError):
        MemoryConfig(max_total_bytes=0)


# ----- cross-field validator --------------------------------------------


def test_max_total_bytes_below_max_file_bytes_rejected():
    """Cross-field validator: scope cap must be >= per-file cap."""
    with pytest.raises(ValidationError) as ei:
        MemoryConfig(max_file_bytes=65536, max_total_bytes=1024)
    msg = str(ei.value)
    assert "max_total_bytes" in msg
    assert "max_file_bytes" in msg


def test_max_total_bytes_equal_max_file_bytes_ok():
    """Boundary case — equal is fine (a single max-size file fits)."""
    cfg = MemoryConfig(max_file_bytes=65536, max_total_bytes=65536)
    assert cfg.max_total_bytes == 65536


# ----- blocked_extensions ------------------------------------------------


def test_blocked_extensions_empty_list_valid():
    cfg = MemoryConfig(blocked_extensions=[])
    assert cfg.blocked_extensions == []


def test_blocked_extensions_non_string_rejected():
    with pytest.raises(ValidationError):
        MemoryConfig(blocked_extensions=[".env", 42])  # type: ignore[list-item]


# ----- ContextConfig integration ---------------------------------------


def test_context_config_memory_none_validates():
    """Backward-compat: profiles without memory: block validate."""
    cfg = ContextConfig(
        max_input_tokens=114688,
        include_repo_map=False,
        repo_map_max_tokens=0,
        default_pruning="head_tail",
    )
    assert cfg.memory is None


def test_context_config_with_memory_validates():
    """Profiles WITH memory: block validate and surface a typed MemoryConfig."""
    cfg = ContextConfig(
        max_input_tokens=114688,
        include_repo_map=False,
        repo_map_max_tokens=0,
        default_pruning="head_tail",
        memory=MemoryConfig(),
    )
    assert cfg.memory is not None
    assert cfg.memory.enabled is True
    assert cfg.memory.project_root == ".emmy/notes"


# ----- extra-field strictness ------------------------------------------


def test_extra_fields_under_memory_rejected():
    """extra='forbid' catches typos like `read_at_session_strat`."""
    with pytest.raises(ValidationError):
        MemoryConfig(read_at_session_strat=True)  # type: ignore[call-arg]
