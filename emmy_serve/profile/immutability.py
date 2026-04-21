"""Profile-bundle validator — 01-RESEARCH.md §5 Layer 1 enforcement.

Implements the recompute-vs-stored hash check + schema + canonicalization +
cross-field-policy gates. Exit-code contract:

    0  — schema OK, hash matches, all ok
    1  — schema validation error (missing field, wrong type, unknown key)
    2  — hash mismatch (body edited, hash not updated — D-03 / PROFILE-06 violation)
    3  — symlink, non-UTF-8, or other canonicalization rule violation
    4  — cross-field env-policy failure
           (env.VLLM_NO_USAGE_STATS != "1" or env.HF_HUB_OFFLINE != "1")

Layer 1 (this module) always runs. Layer 2 (git pre-commit) and Layer 3 (air-gap
CI) land in Plan 05. See 01-RESEARCH.md §5 for the layered defense rationale.

Gate ordering (tested in tests/unit/test_immutability.py):
    (a) profile.yaml schema load — stored hash must be extractable (else exit 1)
    (b) canonicalization via hash_bundle — symlink/non-UTF-8 → exit 3
    (c) serving.yaml policy check — cross-field airgap violation → exit 4
    (d) stored_hash == computed_hash — else exit 2
    (e) full schema load (serving + harness) — schema errors → exit 1

Rationale for (c) before (d): policy failures are a more actionable diagnostic
than "hash mismatch" when an operator has just edited env.HF_HUB_OFFLINE; they
need to fix the policy first, then recompute the hash.

Invokable three ways (all equivalent):
  - `emmy profile validate <path>` (via `[project.scripts].emmy` console script)
  - `uv run emmy profile validate <path>`
  - `python -m emmy_serve.profile.immutability <path>` (used by tests/unit/test_immutability.py)
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

from ..diagnostics.atomic import write_text_atomic
from .hasher import HasherError, hash_bundle
from .loader import load_harness, load_profile_manifest, load_serving
from .schema import ProfileConfigError

# Exit codes (01-RESEARCH.md §5 validator CLI behavior spec)
EXIT_OK = 0
EXIT_SCHEMA = 1
EXIT_HASH_MISMATCH = 2
EXIT_CANONICALIZATION = 3
EXIT_POLICY = 4

# Marker substring emitted by EnvVars._airgap_policy — distinguishes policy
# failures from generic schema failures (both land in ProfileConfigError).
_POLICY_MARKER = "must equal"


def _is_policy_error(msg: str) -> bool:
    """Return True if a ProfileConfigError message is actually a cross-field policy failure."""
    return _POLICY_MARKER in msg


# Direct-from-YAML policy enforcement — runs BEFORE pydantic so a serving.yaml
# with missing required fields (e.g. partial edit that also weakens env) still
# trips exit 4 instead of exit 1. The keys + required values map matches
# schema.EnvVars._airgap_policy exactly.
_AIRGAP_REQUIRED = {
    "VLLM_NO_USAGE_STATS": "1",
    "HF_HUB_OFFLINE": "1",
}


def _check_airgap_policy_raw(serving_yaml: Path) -> str | None:
    """Return a human-readable policy-violation message, or None if OK.

    Reads serving.yaml raw (no pydantic), inspects env.*, and returns the
    first policy violation it finds. If env is absent or serving.yaml is
    unparseable, return None and let the schema layer diagnose.
    """
    try:
        raw = yaml.safe_load(serving_yaml.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(raw, dict):
        return None
    env = raw.get("env")
    if not isinstance(env, dict):
        return None
    for key, required_val in _AIRGAP_REQUIRED.items():
        if key in env and env[key] != required_val:
            return (
                f'env.{key} must equal "{required_val}" '
                f"(SERVE-09 / REPRO-04 / D-12) — "
                f"got {env[key]!r}"
            )
    return None


def validate_bundle(
    bundle_dir: Path,
    *,
    fix_hash: bool = False,
    strict: bool = True,  # noqa: ARG001 — reserved for future warning-vs-error
) -> int:
    """Run Layer 1 validation; return exit code per §5 spec.

    Args:
        bundle_dir: path to profiles/<name>/v<N>/
        fix_hash: if True and the only remaining error is a hash mismatch,
            rewrite profile.yaml.hash to the computed value and return 0 (dev
            convenience; not enabled in CI).
        strict: reserved; currently always strict.
    """
    bundle_dir = Path(bundle_dir)

    # -- (a) Load profile.yaml for stored hash -------------------------------
    # Must succeed for any other layer to be able to diagnose anything useful.
    try:
        manifest = load_profile_manifest(bundle_dir / "profile.yaml")
    except ProfileConfigError as e:
        print(f"ERROR (schema): {e}", file=sys.stderr)
        return EXIT_SCHEMA

    # -- (b) Canonicalization / hash computation ------------------------------
    # Symlinks, non-UTF-8, and disallowed dotfiles raise HasherError here.
    try:
        computed = hash_bundle(bundle_dir)
    except HasherError as e:
        print(f"ERROR (canonicalization): {e}", file=sys.stderr)
        return EXIT_CANONICALIZATION

    # -- (c) Cross-field policy check -----------------------------------------
    # Direct-from-YAML so policy violations trip exit 4 even when serving.yaml
    # also has schema errors (missing required fields). Policy takes precedence
    # because it's actionable: the operator typed "0" where "1" is required.
    policy_msg = _check_airgap_policy_raw(bundle_dir / "serving.yaml")
    if policy_msg is not None:
        print(f"ERROR (policy): {policy_msg}", file=sys.stderr)
        return EXIT_POLICY

    # Attempt full pydantic schema load; defer any non-policy error until after
    # the hash gate so mutated-body-without-hash-bump reports exit 2 (the more
    # actionable D-03 violation).
    try:
        _ = load_serving(bundle_dir / "serving.yaml")
        serving_loaded = True
        serving_err: ProfileConfigError | None = None
    except ProfileConfigError as e:
        serving_loaded = False
        serving_err = e
        msg = str(e)
        if _is_policy_error(msg):
            # Belt-and-suspenders: the raw check above should have caught this.
            print(f"ERROR (policy): {msg}", file=sys.stderr)
            return EXIT_POLICY

    # -- (d) Hash match -------------------------------------------------------
    stored = manifest.profile.hash
    if computed != stored:
        if fix_hash:
            _rewrite_hash(bundle_dir / "profile.yaml", computed)
            print(f"hash rewritten: {stored} -> {computed}")
            return EXIT_OK

        # Construct the exact remediation text the tests (and users) rely on.
        # test_immutability::test_error_message_cites_both_hashes checks:
        #   - "stored" and "computed" substrings (case-insensitive)
        #   - "create profiles/" and "/v2/" literal substrings
        profile_id = manifest.profile.id
        print(
            f"ERROR: profile hash mismatch for {bundle_dir}/\n"
            f"  stored (profile.yaml):  {stored}\n"
            f"  computed (just now):    {computed}\n"
            f"Any edit to v1 after creation is disallowed (D-03, PROFILE-06).\n"
            f"To change this profile, create profiles/{profile_id}/v2/ with your edits.",
            file=sys.stderr,
        )
        return EXIT_HASH_MISMATCH

    # -- (e) Full schema load (serving + harness) ----------------------------
    # Hash matches, but a schema error would still mean the bundle is garbage.
    if not serving_loaded:
        assert serving_err is not None
        print(f"ERROR (schema): {serving_err}", file=sys.stderr)
        return EXIT_SCHEMA

    try:
        _ = load_harness(bundle_dir / "harness.yaml")
    except ProfileConfigError as e:
        msg = str(e)
        if _is_policy_error(msg):
            # harness.yaml has no airgap policy, but future-proof the check.
            print(f"ERROR (policy): {msg}", file=sys.stderr)
            return EXIT_POLICY
        print(f"ERROR (schema): {msg}", file=sys.stderr)
        return EXIT_SCHEMA

    return EXIT_OK


def _rewrite_hash(profile_yaml_path: Path, new_hash: str) -> None:
    """Rewrite profile.yaml.hash in place, preserving top-level ordering.

    pyyaml's safe_dump with sort_keys=False keeps key order within dicts. This
    is a dev tool (used by Task 3 to compute the initial hash + `--fix-hash`
    and `emmy profile hash --write`); production validation NEVER rewrites.
    """
    profile_yaml_path = Path(profile_yaml_path)
    raw = yaml.safe_load(profile_yaml_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or "profile" not in raw:
        raise ProfileConfigError(
            f"profile.yaml missing 'profile:' top-level key: {profile_yaml_path}"
        )
    raw["profile"]["hash"] = new_hash
    text = yaml.safe_dump(raw, sort_keys=False, default_flow_style=False)
    write_text_atomic(profile_yaml_path, text)


def main(argv: list[str] | None = None) -> int:
    """Entry point for `python -m emmy_serve.profile.immutability <path>`.

    Used by tests/unit/test_immutability.py — accepts a single positional path
    and supports `--fix-hash`. For the full `emmy profile validate ...` surface
    (strict / check / write flags) use `emmy_serve.cli:main`.
    """
    import argparse

    p = argparse.ArgumentParser(
        prog="python -m emmy_serve.profile.immutability",
        description="Validate a profile bundle (Layer 1 recompute-vs-stored hash).",
    )
    p.add_argument("path", help="path to profiles/<name>/v<N>/")
    p.add_argument(
        "--fix-hash",
        action="store_true",
        help="rewrite profile.yaml.hash to the computed value (dev convenience)",
    )
    args = p.parse_args(argv)
    return validate_bundle(Path(args.path), fix_hash=args.fix_hash)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
