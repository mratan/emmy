"""Emmy CLI — `emmy profile validate / hash` (01-RESEARCH.md §5 Validator spec).

argparse-subcommand dispatch shape copied from /data/projects/setup_local_opencode/
dgx_stack/cli/app.py (01-PATTERNS.md Pattern E).

Registered as the `emmy` console script by pyproject.toml; also invoked via
`uv run emmy ...` and via the thin shims at scripts/validate_profile.py and
scripts/hash_profile.py (CI uses the file-path shims for a predictable target
that doesn't depend on console-script registration state).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Callable

from .profile.hasher import HasherError, hash_bundle
from .profile.immutability import _rewrite_hash, validate_bundle
from .profile.loader import load_profile_manifest
from .profile.schema import ProfileConfigError


HandlerFn = Callable[[argparse.Namespace], int]


# --- handlers -----------------------------------------------------------------


def _cmd_profile_validate(args: argparse.Namespace) -> int:
    """`emmy profile validate <path> [--fix-hash] [--strict]`

    Exit codes (01-RESEARCH.md §5):
      0 ok  /  1 schema  /  2 hash mismatch  /  3 canonicalization  /  4 policy
    """
    return validate_bundle(
        Path(args.path),
        fix_hash=args.fix_hash,
        strict=args.strict,
    )


def _cmd_profile_hash(args: argparse.Namespace) -> int:
    """`emmy profile hash <path> [--write] [--check]`

    Exit codes (01-RESEARCH.md §5):
      0 match  /  1 mismatch  /  2 canonicalization error
    """
    bundle_dir = Path(args.path)
    try:
        computed = hash_bundle(bundle_dir)
    except HasherError as e:
        print(f"ERROR (canonicalization): {e}", file=sys.stderr)
        return 2

    if args.write:
        _rewrite_hash(bundle_dir / "profile.yaml", computed)
        print(computed)
        return 0

    # --check (default): compare stored vs computed
    try:
        manifest = load_profile_manifest(bundle_dir / "profile.yaml")
    except ProfileConfigError as e:
        # profile.yaml has a placeholder hash (Task 3 first pass); report computed
        # and exit 1 so operator can retry with --write.
        print(
            f"NOTE: profile.yaml unreadable or missing valid hash ({e})\n"
            f"computed: {computed}",
            file=sys.stderr,
        )
        return 1

    stored = manifest.profile.hash
    if computed == stored:
        print(computed)
        return 0
    print(
        f"MISMATCH\n  stored:   {stored}\n  computed: {computed}",
        file=sys.stderr,
    )
    return 1


# --- parser -------------------------------------------------------------------


def _attach_handler(p: argparse.ArgumentParser, fn: HandlerFn) -> None:
    p.set_defaults(_handler=fn)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="emmy",
        description="Emmy serving-layer CLI (Phase 1: profile management).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # --- emmy profile ... ---
    profile = sub.add_parser("profile", help="profile bundle management")
    psub = profile.add_subparsers(dest="profile_cmd", required=True)

    # emmy profile validate <path> [--fix-hash] [--strict]
    v = psub.add_parser(
        "validate",
        help="run Layer-1 validation (schema + canonicalization + hash + policy)",
    )
    v.add_argument("path", help="path to profiles/<name>/v<N>/")
    v.add_argument(
        "--fix-hash",
        action="store_true",
        help="on hash mismatch, rewrite profile.yaml.hash to the computed value "
        "(dev convenience; NOT enabled in CI)",
    )
    v.add_argument(
        "--strict",
        action="store_true",
        default=True,
        help="strict mode (default): every warning becomes an error",
    )
    _attach_handler(v, _cmd_profile_validate)

    # emmy profile hash <path> [--write] [--check]
    h = psub.add_parser("hash", help="compute or check bundle content hash")
    h.add_argument("path", help="path to profiles/<name>/v<N>/")
    h.add_argument(
        "--write",
        action="store_true",
        help="rewrite profile.yaml.hash to the computed value "
        "(dev tool; used once on profile creation)",
    )
    h.add_argument(
        "--check",
        action="store_true",
        default=True,
        help="compare and report (default)",
    )
    _attach_handler(h, _cmd_profile_hash)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args._handler(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
