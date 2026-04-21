"""RED skeleton — REPRO-01 start_emmy.sh contract.

Plan 03 writes `scripts/start_emmy.sh` with: shebang + set -euo pipefail, digest
read from serving.yaml, airgap env support, exit-code contract (0/1/2/3/4).
"""
from __future__ import annotations
import re
import shutil
import subprocess
from pathlib import Path
import pytest

yaml = pytest.importorskip("yaml")

START_SCRIPT = Path(__file__).parent.parent.parent / "scripts" / "start_emmy.sh"


def _skip_if_no_script() -> Path:
    if not START_SCRIPT.exists():
        pytest.skip(f"{START_SCRIPT} not yet created (Plan 03)")
    return START_SCRIPT


def test_start_script_exists():
    """REPRO-01: scripts/start_emmy.sh is present and a regular file."""
    script = _skip_if_no_script()
    assert script.is_file()


def test_shellcheck_passes():
    """REPRO-01: shellcheck is clean on start_emmy.sh; skip if shellcheck absent."""
    script = _skip_if_no_script()
    if not shutil.which("shellcheck"):
        pytest.skip("shellcheck not installed")
    result = subprocess.run(
        ["shellcheck", str(script)], capture_output=True, text=True
    )
    assert result.returncode == 0, f"shellcheck failed:\n{result.stdout}\n{result.stderr}"


def test_digest_match(profile_path: Path):
    """REPRO-01: start_emmy.sh digest source matches serving.yaml.

    Contract (01-RESEARCH.md §12): start_emmy.sh reads the digest from
    serving.yaml via a `python3 -c` one-liner — it does NOT hardcode a
    second copy. Assert the file mentions `container_image_digest` (the
    field it reads) and does not contain its own sha256:<hex> literal.
    """
    script = _skip_if_no_script()
    serving = profile_path / "serving.yaml"
    if not serving.exists():
        pytest.skip("serving.yaml not yet created (Plan 02)")

    text = script.read_text(encoding="utf-8")
    assert "container_image_digest" in text, (
        "start_emmy.sh must read container_image_digest from serving.yaml, "
        "not hardcode a second copy"
    )
    # No hardcoded sha256:<64-hex> outside a comment
    non_comment_lines = [
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    ]
    body = "\n".join(non_comment_lines)
    # Permit `sha256:REPLACE_AT_FIRST_PULL` only as a template; flag real digests
    hardcoded = re.findall(r"sha256:[0-9a-f]{64}", body)
    assert not hardcoded, (
        f"start_emmy.sh contains a hardcoded digest literal: {hardcoded}"
    )


def test_exit_codes_documented():
    """01-RESEARCH.md §14: start_emmy.sh contract uses exit codes 0-4."""
    script = _skip_if_no_script()
    text = script.read_text(encoding="utf-8")
    for ec in ("exit 1", "exit 2", "exit 3", "exit 4"):
        assert ec in text, f"start_emmy.sh missing `{ec}` — see §14 contract"
