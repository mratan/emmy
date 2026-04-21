"""RED skeleton — SERVE-01 / REPRO-01 container-image digest pinning.

Plan 02 writes `serving.yaml.engine.container_image_digest` as a real sha256 ref;
Plan 03's `start_emmy.sh` reads it via a python one-liner.
"""
from __future__ import annotations
import re
from pathlib import Path
import pytest

yaml = pytest.importorskip("yaml")


def _skip_if_no_serving(profile_path: Path) -> Path:
    serving = profile_path / "serving.yaml"
    if not serving.exists():
        pytest.skip(f"serving.yaml not yet created at {serving} (Plan 02)")
    return serving


def test_digest_format_valid(profile_path: Path):
    """SERVE-01: container_image_digest matches `sha256:<64-hex>`."""
    serving = _skip_if_no_serving(profile_path)
    cfg = yaml.safe_load(serving.read_text(encoding="utf-8"))
    digest = cfg.get("engine", {}).get("container_image_digest", "")
    assert isinstance(digest, str), f"digest not a string: {digest!r}"
    assert re.match(r"^sha256:[0-9a-f]{64}$", digest), (
        f"digest not in sha256:<64-hex> form: {digest!r}"
    )


def test_digest_not_placeholder(profile_path: Path):
    """REPRO-01: digest must be a real capture — not the placeholder string."""
    serving = _skip_if_no_serving(profile_path)
    cfg = yaml.safe_load(serving.read_text(encoding="utf-8"))
    digest = cfg.get("engine", {}).get("container_image_digest", "")
    assert digest != "sha256:REPLACE_AT_FIRST_PULL", (
        "container_image_digest is still the placeholder — see docs/ci-runner.md "
        "and 01-RESEARCH.md §12 for capture instructions"
    )
