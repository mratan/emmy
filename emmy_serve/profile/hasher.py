"""Content-hash canonicalization for profile bundles (01-RESEARCH.md §4).

Walks `profiles/<name>/v<N>/` recursively, normalises text files (UTF-8 NFC + LF
line endings), rejects symlinks and disallowed dotfiles, excludes editor/OS noise,
and emits `sha256:<64-hex>` over the canonical manifest text.

Any edit to any file under the bundle changes the hash — a.k.a. "any field change
-> new version directory" (D-02, PROFILE-06).

Reference implementation copied VERBATIM in shape from 01-RESEARCH.md §4 lines
755-800, then adjusted to raise `HasherError` (a `ValueError` subclass) with the
offending path in the message so validator callers can map to exit code 3.
"""
from __future__ import annotations

import hashlib
import unicodedata
from pathlib import Path

# --- module constants (see 01-RESEARCH.md §4 points 1-5) ----------------------

TEXT_EXTS = {".md", ".yaml", ".yml", ".json", ".lark", ".txt", ".py"}
EXCLUDE_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
EXCLUDE_SUFFIXES = (".swp", ".swo", "~")

# bumped if canonicalization rules change (e.g. add .toml to TEXT_EXTS)
HASH_MANIFEST_VERSION = 1


class HasherError(ValueError):
    """Raised on canonicalization-rule violations (maps to validator exit 3)."""


# --- helpers -------------------------------------------------------------------


def _should_exclude(p: Path) -> bool:
    """Return True if `p` is editor/OS noise (excluded from the hash)."""
    name = p.name
    if name in EXCLUDE_NAMES:
        return True
    if any(name.endswith(s) for s in EXCLUDE_SUFFIXES):
        return True
    return False


def _is_allowed_dotfile(p: Path) -> bool:
    """Return True iff `p` is a dot-file that the bundle explicitly allows.

    D-01 requires `.gitkeep` under empty dirs. Any other dot-file is an error —
    raise with a clear message so the operator knows what was found.
    """
    return p.name == ".gitkeep"


def _normalize_text(raw: bytes, *, path: Path) -> bytes:
    """UTF-8 check + NFC + CRLF/CR -> LF. Raises `HasherError` on non-UTF-8."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise HasherError(f"non-UTF-8 text in {path}: {e}") from e
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.encode("utf-8")


def _hash_file(p: Path) -> str:
    """SHA256 of a single file, applying text normalization when appropriate."""
    if p.is_symlink():
        raise HasherError(f"symlink not allowed in profile: {p}")
    raw = p.read_bytes()
    if p.suffix in TEXT_EXTS:
        raw = _normalize_text(raw, path=p)
    return hashlib.sha256(raw).hexdigest()


# --- public API ----------------------------------------------------------------


def compute_manifest(bundle_dir: Path) -> list[tuple[str, str]]:
    """Return the canonical manifest as `[(relative_path, file_sha256), ...]`.

    Sorted lexicographically by POSIX relative path. Exposed so debug tooling
    / diff tooling can show per-file contributions to the bundle hash.
    """
    bundle_dir = Path(bundle_dir)
    if not bundle_dir.is_dir():
        raise HasherError(f"bundle dir does not exist: {bundle_dir}")

    items: list[tuple[str, str]] = []
    # rglob('*') yields files and dirs; sort for determinism.
    for p in sorted(bundle_dir.rglob("*")):
        # symlinks may point at dirs or files; catch them here regardless
        if p.is_symlink():
            raise HasherError(f"symlink not allowed in profile: {p}")
        if not p.is_file():
            continue
        if _should_exclude(p):
            continue
        # Dot-hidden files: allow only .gitkeep; reject anything else explicitly.
        if p.name.startswith(".") and not _is_allowed_dotfile(p):
            raise HasherError(
                f"disallowed dot-file in profile: {p} "
                f"(only '.gitkeep' is permitted under bundle root)"
            )
        rel = p.relative_to(bundle_dir).as_posix()
        items.append((rel, _hash_file(p)))

    items.sort(key=lambda t: t[0])
    return items


def hash_bundle(bundle_dir: Path) -> str:
    """Return `sha256:<64-hex>` content hash of the profile bundle.

    Per 01-RESEARCH.md §4 point 7-10:
      - canonical manifest text = one line per file, "\\t"-separated, "\\n"-terminated
      - profile hash = sha256(manifest_text, utf-8) prefixed with "sha256:"
    """
    items = compute_manifest(Path(bundle_dir))
    manifest_text = "".join(f"{rel}\t{sha}\n" for rel, sha in items)
    digest = hashlib.sha256(manifest_text.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


__all__ = [
    "HASH_MANIFEST_VERSION",
    "TEXT_EXTS",
    "EXCLUDE_NAMES",
    "EXCLUDE_SUFFIXES",
    "HasherError",
    "hash_bundle",
    "compute_manifest",
]
