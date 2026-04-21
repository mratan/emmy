"""RED skeleton — canonicalization rules for the profile-bundle content hasher.

Implements 01-RESEARCH.md §4 canonicalization points 1-10. Plan 02 turns these
GREEN by shipping `emmy_serve.profile.hasher.hash_bundle`.
"""
from __future__ import annotations
import os
import re
from pathlib import Path
import pytest

hasher = pytest.importorskip("emmy_serve.profile.hasher")


def _seed_minimal_bundle(d: Path) -> None:
    """Write a minimum bundle that hashes cleanly."""
    (d / "prompts").mkdir(parents=True, exist_ok=True)
    (d / "tool_schemas").mkdir(parents=True, exist_ok=True)
    (d / "grammars").mkdir(parents=True, exist_ok=True)
    (d / "serving.yaml").write_text("engine: {}\n")
    (d / "harness.yaml").write_text("prompts: {}\n")
    (d / "PROFILE_NOTES.md").write_text("# notes\n")
    (d / "prompts" / "system.md").write_text("hello\n")
    (d / "tool_schemas" / ".gitkeep").write_text("")
    (d / "grammars" / ".gitkeep").write_text("")


def test_excludes_editor_swapfiles(tmp_path: Path):
    """§4 point 1: .swp / .DS_Store / *~ must NOT affect the hash."""
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    _seed_minimal_bundle(bundle)
    h1 = hasher.hash_bundle(bundle)

    # Now seed editor noise — hash must stay the same
    (bundle / "serving.yaml.swp").write_bytes(b"vim swap junk")
    (bundle / ".DS_Store").write_bytes(b"mac noise")
    (bundle / "prompts" / "system.md~").write_bytes(b"emacs backup")
    h2 = hasher.hash_bundle(bundle)
    assert h1 == h2


def test_symlink_rejected(tmp_path: Path):
    """§4 point 1: symlinks must raise — no legitimate use, break determinism."""
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    _seed_minimal_bundle(bundle)
    target = bundle / "serving.yaml"
    link = bundle / "prompts" / "linked.md"
    os.symlink(target, link)
    with pytest.raises(ValueError, match="symlink"):
        hasher.hash_bundle(bundle)


def test_non_utf8_text_rejected(tmp_path: Path):
    """§4 point 3: .md files must be UTF-8; Latin-1 raises."""
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    _seed_minimal_bundle(bundle)
    # Latin-1 bytes that aren't valid UTF-8
    (bundle / "prompts" / "bad.md").write_bytes(b"caf\xe9\n")
    with pytest.raises(Exception):
        hasher.hash_bundle(bundle)


def test_crlf_normalized_to_lf(tmp_path: Path):
    """§4 point 3: CRLF and LF versions of the same bundle must hash identically."""
    b1 = tmp_path / "lf"
    b2 = tmp_path / "crlf"
    b1.mkdir()
    b2.mkdir()
    _seed_minimal_bundle(b1)
    _seed_minimal_bundle(b2)

    # Rewrite serving.yaml in b2 with CRLF line endings
    (b2 / "serving.yaml").write_bytes(b"engine: {}\r\n")
    (b1 / "serving.yaml").write_bytes(b"engine: {}\n")

    assert hasher.hash_bundle(b1) == hasher.hash_bundle(b2)


def test_nfc_normalization_applied(tmp_path: Path):
    """§4 point 3: Unicode NFC normalization — NFD and NFC forms hash the same."""
    b1 = tmp_path / "nfc"
    b2 = tmp_path / "nfd"
    b1.mkdir()
    b2.mkdir()
    _seed_minimal_bundle(b1)
    _seed_minimal_bundle(b2)

    # "é" in NFC (single codepoint) vs NFD (e + combining acute)
    nfc = "café\n"
    nfd = "café\n"
    (b1 / "prompts" / "system.md").write_text(nfc, encoding="utf-8")
    (b2 / "prompts" / "system.md").write_text(nfd, encoding="utf-8")

    assert hasher.hash_bundle(b1) == hasher.hash_bundle(b2)


def test_gitkeep_included_other_dotfiles_rejected(tmp_path: Path):
    """§4 point 1: .gitkeep included; other dot-files raise."""
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    _seed_minimal_bundle(bundle)
    h1 = hasher.hash_bundle(bundle)

    # Removing .gitkeep changes the hash (it is *included*)
    (bundle / "tool_schemas" / ".gitkeep").unlink()
    h2 = hasher.hash_bundle(bundle)
    assert h1 != h2

    # Adding a non-whitelisted dot-file raises
    (bundle / "tool_schemas" / ".gitkeep").write_text("")
    (bundle / "prompts" / ".foo").write_text("hidden\n")
    with pytest.raises(Exception):
        hasher.hash_bundle(bundle)


def test_manifest_hash_prefixed_with_sha256(tmp_path: Path):
    """§4 point 10: hash must be 'sha256:<64-hex>'."""
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    _seed_minimal_bundle(bundle)
    h = hasher.hash_bundle(bundle)
    assert re.match(r"^sha256:[0-9a-f]{64}$", h)


def test_deterministic_across_invocations(tmp_path: Path):
    """§4: calling hash_bundle twice on the same dir yields the same hash."""
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    _seed_minimal_bundle(bundle)
    h1 = hasher.hash_bundle(bundle)
    h2 = hasher.hash_bundle(bundle)
    assert h1 == h2
