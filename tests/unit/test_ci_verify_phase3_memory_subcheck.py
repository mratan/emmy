"""Phase 04.4 plan 04 Task 3 — ci_verify_phase3 memory subcheck tests."""
from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

from emmy_serve.airgap import ci_verify_phase3


def test_dry_run_passes_when_script_exists_and_is_executable():
    """Default --include-memory + --dry-run should pass when script present."""
    rc = ci_verify_phase3.verify_memory_airgap(dry_run=True)
    assert rc == 0


def test_dry_run_fails_when_script_missing(tmp_path: Path, monkeypatch):
    """script-missing path returns non-zero."""
    monkeypatch.setattr(
        ci_verify_phase3, "MEMORY_AIRGAP_SCRIPT", tmp_path / "missing.sh"
    )
    rc = ci_verify_phase3.verify_memory_airgap(dry_run=True)
    assert rc == 1


def test_dry_run_fails_when_script_not_executable(tmp_path: Path, monkeypatch):
    """non-executable script returns non-zero."""
    fake = tmp_path / "fake.sh"
    fake.write_text("#!/bin/sh\necho ok\n")
    fake.chmod(0o644)  # NOT executable
    monkeypatch.setattr(ci_verify_phase3, "MEMORY_AIRGAP_SCRIPT", fake)
    rc = ci_verify_phase3.verify_memory_airgap(dry_run=True)
    assert rc == 1


def test_skip_memory_subcheck_arg_disables_subcheck(monkeypatch):
    """--skip-memory-subcheck path doesn't even invoke the subcheck."""
    # Force _dry_run to return 0 so the only thing left would be the memory subcheck.
    monkeypatch.setattr(ci_verify_phase3, "_dry_run", lambda profile: 0)
    monkeypatch.setattr(
        ci_verify_phase3, "MEMORY_AIRGAP_SCRIPT", Path("/nonexistent")
    )
    # With --skip-memory-subcheck the missing script should NOT cause exit 1.
    rc = ci_verify_phase3.main(
        ["--dry-run", "--skip-memory-subcheck"]
    )
    assert rc == 0


def test_full_main_calls_subcheck_when_include_memory_default(monkeypatch):
    """Default `--include-memory` path runs the subcheck after _dry_run."""
    called = {"subcheck": False}

    def fake_subcheck(dry_run: bool = False) -> int:
        called["subcheck"] = True
        return 0

    monkeypatch.setattr(ci_verify_phase3, "_dry_run", lambda profile: 0)
    monkeypatch.setattr(ci_verify_phase3, "verify_memory_airgap", fake_subcheck)
    rc = ci_verify_phase3.main(["--dry-run"])
    assert rc == 0
    assert called["subcheck"] is True
