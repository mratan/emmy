# tests/unit/test_variant_engine_byte_identity.py
#
# Phase 4 HARNESS-08 (D-10) — sibling variant bundles under the same profile
# MUST share a byte-identical serving.yaml so switching between them does NOT
# restart the vLLM engine. Only harness-side state (sampling, chat_template_kwargs,
# prompts) mutates per turn.
#
# "Sibling variants" = subdirectories of profiles/<profile-id>/ whose name
# matches `^v\d+(\.\d+)*(-[a-zA-Z0-9_]+)?$`. They are grouped by the
# pre-dash version prefix — e.g. {v3.1, v3.1-default, v3.1-reason, v3.1-precise}
# form one group; {v3} forms another (singleton groups are ignored).
#
# Invariants enforced:
#   1. Within each group with >= 2 members, every serving.yaml file is
#      byte-identical to the group leader (the first member by sort order).
#   2. Each variant validates independently via `uv run emmy profile validate`.
#   3. Each variant in a group has a UNIQUE content hash (no two siblings
#      share the same profile.yaml.profile.hash).
#
# If any invariant fails, the audit emits a precise diff / list of collisions
# so the operator can see exactly which bundle regressed.

from __future__ import annotations

import difflib
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
PROFILES_ROOT = REPO_ROOT / "profiles"

VARIANT_NAME_RE = re.compile(r"^v\d+(?:\.\d+)*(?:-[A-Za-z0-9_]+)?$")


def _group_by_base_version(variant_dirs: list[Path]) -> dict[str, list[Path]]:
    """Group variant directories by their pre-dash version prefix.

    v3, v3-foo → group "v3".
    v3.1, v3.1-default, v3.1-reason → group "v3.1".
    v1 → group "v1" (singleton).
    """
    groups: dict[str, list[Path]] = {}
    for d in variant_dirs:
        name = d.name
        base = name.split("-", 1)[0]  # before first dash (or whole name)
        groups.setdefault(base, []).append(d)
    return groups


def _discover_variant_groups() -> list[tuple[str, str, list[Path]]]:
    """Walk profiles/* and yield (profile_id, base_version, [variant_dirs])
    tuples for every group containing >= 2 members.
    """
    results: list[tuple[str, str, list[Path]]] = []
    if not PROFILES_ROOT.is_dir():
        return results
    for profile_dir in sorted(PROFILES_ROOT.iterdir()):
        if not profile_dir.is_dir():
            continue
        variant_dirs = sorted(
            d for d in profile_dir.iterdir()
            if d.is_dir() and VARIANT_NAME_RE.match(d.name)
        )
        groups = _group_by_base_version(variant_dirs)
        for base_version, members in groups.items():
            if len(members) >= 2:
                results.append((profile_dir.name, base_version, sorted(members)))
    return results


def test_variant_engine_byte_identity():
    """D-10 invariant: serving.yaml is byte-identical across sibling variants."""
    groups = _discover_variant_groups()
    if not groups:
        pytest.skip(
            "no sibling variant groups found under profiles/* "
            "(a group requires >= 2 directories matching ^v\\d+(\\.\\d+)*(-\\w+)?$ "
            "with the same pre-dash prefix)"
        )

    failures: list[str] = []
    for profile_id, base_version, members in groups:
        leader = members[0]
        leader_serving = leader / "serving.yaml"
        if not leader_serving.is_file():
            failures.append(
                f"{profile_id}/{leader.name}: serving.yaml missing — cannot "
                f"establish byte-identity leader"
            )
            continue
        leader_bytes = leader_serving.read_bytes()
        for sibling in members[1:]:
            sibling_serving = sibling / "serving.yaml"
            if not sibling_serving.is_file():
                failures.append(
                    f"{profile_id}/{sibling.name}: serving.yaml missing "
                    f"(leader {leader.name} exists)"
                )
                continue
            sibling_bytes = sibling_serving.read_bytes()
            if sibling_bytes != leader_bytes:
                diff = "\n".join(
                    difflib.unified_diff(
                        leader_bytes.decode("utf-8", errors="replace").splitlines(),
                        sibling_bytes.decode("utf-8", errors="replace").splitlines(),
                        fromfile=str(leader_serving.relative_to(REPO_ROOT)),
                        tofile=str(sibling_serving.relative_to(REPO_ROOT)),
                        lineterm="",
                    )
                )
                failures.append(
                    f"{profile_id}[{base_version}]: engine byte-identity "
                    f"broken between {leader.name}/serving.yaml and "
                    f"{sibling.name}/serving.yaml:\n{diff}"
                )
    if failures:
        pytest.fail("\n\n".join(failures))


def test_variant_bundles_validate():
    """Each sibling variant must pass `emmy profile validate` independently."""
    groups = _discover_variant_groups()
    if not groups:
        pytest.skip("no sibling variant groups found")
    failures: list[str] = []
    for profile_id, base_version, members in groups:
        for v in members:
            # Skip the non-suffixed base version (e.g. v3.1) if it's the group
            # leader — it was validated as a normal bundle in pre-Phase-4 CI.
            # The new suffixed variants are what this plan ships.
            if "-" not in v.name:
                continue
            proc = subprocess.run(
                ["uv", "run", "emmy", "profile", "validate", str(v)],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                failures.append(
                    f"{profile_id}/{v.name}: emmy profile validate exited "
                    f"{proc.returncode}\nSTDOUT:\n{proc.stdout}\n"
                    f"STDERR:\n{proc.stderr}"
                )
    if failures:
        pytest.fail("\n\n".join(failures))


def test_variant_hashes_unique():
    """No two sibling variants in the same group may share a content hash."""
    groups = _discover_variant_groups()
    if not groups:
        pytest.skip("no sibling variant groups found")
    failures: list[str] = []
    for profile_id, base_version, members in groups:
        seen: dict[str, str] = {}  # hash -> variant name that produced it
        for v in members:
            profile_yaml = v / "profile.yaml"
            if not profile_yaml.is_file():
                continue
            raw = yaml.safe_load(profile_yaml.read_text())
            h = raw.get("profile", {}).get("hash")
            if not isinstance(h, str) or not h.startswith("sha256:"):
                continue
            if h in seen:
                failures.append(
                    f"{profile_id}[{base_version}]: hash collision — "
                    f"{v.name} and {seen[h]} both claim {h}"
                )
            else:
                seen[h] = v.name
    if failures:
        pytest.fail("\n\n".join(failures))


if __name__ == "__main__":
    # Ad-hoc run: `uv run python tests/unit/test_variant_engine_byte_identity.py`
    sys.exit(pytest.main([__file__, "-x", "-v"]))
