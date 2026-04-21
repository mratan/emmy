"""Unit tests for airgap CI certification helpers (Plan 01-08).

Gates:
 - `emmy_serve.airgap.ci_verify.validate_airgap_report` correctly classifies
   green vs. red airgap-report artifacts against committed golden fixtures.
 - `emmy_serve.airgap.ci_verify.main` returns 0/1/2 exit codes on green/red/missing.
 - `scripts/trigger_airgap_ci.sh` exists, is executable, refuses main branch,
   touches air_gap/README.md (not session.jsonl).
 - `scripts/verify_airgap_ci.sh` exists, is executable, prefers `gh run download`,
   supports `--from-file` fallback.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent.parent
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures"
TRIGGER_SCRIPT = REPO_ROOT / "scripts" / "trigger_airgap_ci.sh"
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "verify_airgap_ci.sh"


# ---------------------------------------------------------------------------
# validate_airgap_report unit tests
# ---------------------------------------------------------------------------


def test_validate_airgap_report_green_passes():
    from emmy_serve.airgap.ci_verify import validate_airgap_report

    report = json.loads((FIXTURES_DIR / "airgap_green.json").read_text())
    ok, reasons = validate_airgap_report(report)
    assert ok is True, f"green fixture should pass, got reasons: {reasons}"
    assert reasons == []


def test_validate_airgap_report_red_layer_a_fails():
    from emmy_serve.airgap.ci_verify import validate_airgap_report

    report = json.loads((FIXTURES_DIR / "airgap_red_layer_a.json").read_text())
    ok, reasons = validate_airgap_report(report)
    assert ok is False
    # Reason must name layer (a) so operator knows where to look
    assert any("(a)" in r or "layer a" in r.lower() for r in reasons), reasons


def test_validate_airgap_report_missing_layer():
    from emmy_serve.airgap.ci_verify import validate_airgap_report

    report = {
        "ts": "2026-04-22T03:00:00Z",
        "container": "emmy-serve",
        "passes": True,
        "failures": [],
        "layers": [
            {"layer": "a", "name": "x", "passed": True, "detail": "", "commands_run": []},
            {"layer": "b", "name": "x", "passed": True, "detail": "", "commands_run": []},
            # c + d missing
        ],
    }
    ok, reasons = validate_airgap_report(report)
    assert ok is False
    joined = " ".join(reasons).lower()
    assert "c" in joined or "d" in joined


def test_validate_airgap_report_passes_true_but_layer_failed():
    """passes=True AND a layer with passed=False is a contradiction — must fail.

    Threat T-08-01: a tampered report that sets passes=true but leaves a layer
    failing must still be caught.
    """
    from emmy_serve.airgap.ci_verify import validate_airgap_report

    report = {
        "ts": "2026-04-22T03:00:00Z",
        "container": "emmy-serve",
        "passes": True,
        "failures": [],
        "layers": [
            {"layer": "a", "name": "x", "passed": False, "detail": "bogus", "commands_run": []},
            {"layer": "b", "name": "x", "passed": True, "detail": "", "commands_run": []},
            {"layer": "c", "name": "x", "passed": True, "detail": "", "commands_run": []},
            {"layer": "d", "name": "x", "passed": True, "detail": "", "commands_run": []},
        ],
    }
    ok, reasons = validate_airgap_report(report)
    assert ok is False


# ---------------------------------------------------------------------------
# main() CLI exit-code tests
# ---------------------------------------------------------------------------


def _run_ci_verify(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["uv", "run", "python3", "-m", "emmy_serve.airgap.ci_verify", *args],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )


def test_main_exits_0_on_green_fixture():
    r = _run_ci_verify("--from-file", str(FIXTURES_DIR / "airgap_green.json"))
    assert r.returncode == 0, (
        f"expected exit 0 on green fixture, got {r.returncode}. "
        f"stdout={r.stdout!r} stderr={r.stderr!r}"
    )


def test_main_exits_1_on_red_fixture():
    r = _run_ci_verify("--from-file", str(FIXTURES_DIR / "airgap_red_layer_a.json"))
    assert r.returncode == 1, (
        f"expected exit 1 on red fixture, got {r.returncode}. "
        f"stdout={r.stdout!r} stderr={r.stderr!r}"
    )


def test_main_exits_2_on_missing_file(tmp_path: Path):
    r = _run_ci_verify("--from-file", str(tmp_path / "does-not-exist.json"))
    assert r.returncode == 2, (
        f"expected exit 2 on missing file, got {r.returncode}. "
        f"stdout={r.stdout!r} stderr={r.stderr!r}"
    )


# ---------------------------------------------------------------------------
# Trigger script contract
# ---------------------------------------------------------------------------


def test_trigger_script_exists_and_is_executable():
    assert TRIGGER_SCRIPT.exists(), f"{TRIGGER_SCRIPT} not present"
    assert os.access(TRIGGER_SCRIPT, os.X_OK), f"{TRIGGER_SCRIPT} not executable"


def test_trigger_script_guards_main_branch():
    """Trigger script must refuse to run from main branch."""
    content = TRIGGER_SCRIPT.read_text(encoding="utf-8")
    assert "main" in content, "trigger script must reference 'main'"
    assert "branch" in content.lower(), "trigger script must reference 'branch'"
    # Specifically look for the guard message
    assert "refusing to trigger from main" in content, (
        "trigger script must print a refusal when current branch == main"
    )


def test_trigger_script_touches_workflow_path_filter():
    content = TRIGGER_SCRIPT.read_text(encoding="utf-8")
    # Must touch air_gap/README.md (in the workflow's path filters)
    assert "air_gap/README.md" in content
    # MUST NOT touch the immutable test fixture
    assert "session.jsonl" not in content, (
        "trigger must NOT touch air_gap/session.jsonl (immutable test fixture)"
    )


def test_trigger_script_checks_clean_working_tree():
    content = TRIGGER_SCRIPT.read_text(encoding="utf-8")
    # Pre-flight must check working tree is clean before committing
    assert "git status --porcelain" in content, (
        "trigger script must refuse on dirty working tree via `git status --porcelain`"
    )


# ---------------------------------------------------------------------------
# Verify script contract
# ---------------------------------------------------------------------------


def test_verify_script_exists_and_is_executable():
    assert VERIFY_SCRIPT.exists(), f"{VERIFY_SCRIPT} not present"
    assert os.access(VERIFY_SCRIPT, os.X_OK), f"{VERIFY_SCRIPT} not executable"


def test_verify_script_references_gh_cli_with_fallback():
    content = VERIFY_SCRIPT.read_text(encoding="utf-8")
    assert "gh run download" in content, "verify script must prefer gh CLI"
    assert "--from-file" in content, "verify script must support manual fallback"
    assert "airgap-report" in content, "verify script must reference the artifact name"
