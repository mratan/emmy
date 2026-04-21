"""RED skeleton — PROFILE-05 / SERVE-07 PROFILE_NOTES.md format + provenance.

Plan 02 creates `PROFILE_NOTES.md` with YAML frontmatter and the prefix-order block.
"""
from __future__ import annotations
from pathlib import Path
import re
import pytest

yaml = pytest.importorskip("yaml")


def _skip_if_no_notes(profile_path: Path) -> Path:
    notes = profile_path / "PROFILE_NOTES.md"
    if not notes.exists():
        pytest.skip(f"PROFILE_NOTES.md not yet created at {notes} (Plan 02)")
    return notes


def _read_frontmatter(notes_path: Path) -> dict:
    text = notes_path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        return {}
    return yaml.safe_load(m.group(1)) or {}


def test_frontmatter_parses(profile_path: Path):
    """PROFILE-05: YAML frontmatter parses + contains required keys."""
    notes = _skip_if_no_notes(profile_path)
    fm = _read_frontmatter(notes)
    assert fm, "frontmatter missing or not parseable"
    for key in ("profile_id", "profile_version", "measured_values"):
        assert key in fm, f"frontmatter missing key: {key}"


def test_sources_cited(profile_path: Path):
    """PROFILE-05: every non-trivial sampling default cites a source.

    Weaker-but-stable assertion: the file contains a Source column / URL in a
    provenance table. Plan 02 populates citations per sampling default.
    """
    notes = _skip_if_no_notes(profile_path)
    text = notes.read_text(encoding="utf-8")
    # Expect at least one URL citation (http/https) AND the word "Source"
    assert re.search(r"https?://", text), "no URL citations in PROFILE_NOTES.md"
    assert "Source" in text, "no 'Source' column/label in PROFILE_NOTES.md"


def test_prefix_order_documented(profile_path: Path):
    """SERVE-07 / 01-RESEARCH.md §5: the 5-step prefix order block is present."""
    notes = _skip_if_no_notes(profile_path)
    text = notes.read_text(encoding="utf-8")
    # The block is documented as "Prefix order" or "Prefix-order"; require both
    # the heading and the numeric ordering keywords to appear.
    assert re.search(r"[Pp]refix[- ]order", text), "no prefix-order heading"
    # A 5-step list should contain the key sampling axes
    for keyword in ("system", "tool", "context"):
        assert keyword.lower() in text.lower(), (
            f"prefix-order block missing keyword: {keyword}"
        )
