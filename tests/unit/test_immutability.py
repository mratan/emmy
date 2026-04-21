"""RED skeleton — PROFILE-06 + 01-RESEARCH.md §5 Layer 1 immutability validator.

Plan 02 ships `emmy_serve.profile.immutability` with exit-code contract:
    0 ok, 1 schema error, 2 hash mismatch, 3 canonicalization error,
    4 cross-field env-policy failure.
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path
import pytest

immutability = pytest.importorskip("emmy_serve.profile.immutability")


def _run_validator(profile_path: Path) -> subprocess.CompletedProcess:
    """Invoke the validator CLI and capture exit code + stderr."""
    return subprocess.run(
        [sys.executable, "-m", "emmy_serve.profile.immutability", str(profile_path)],
        capture_output=True,
        text=True,
    )


def _seed_bundle_with_stored_hash(d: Path) -> None:
    """Plan 02 replaces this shim — here we only need the tests to be collectible."""
    d.mkdir(parents=True, exist_ok=True)
    (d / "serving.yaml").write_text("engine: {}\n")
    (d / "harness.yaml").write_text("prompts: {}\n")
    (d / "PROFILE_NOTES.md").write_text("# notes\n")
    (d / "prompts").mkdir(exist_ok=True)
    (d / "prompts" / "system.md").write_text("hi\n")
    (d / "tool_schemas").mkdir(exist_ok=True)
    (d / "tool_schemas" / ".gitkeep").write_text("")
    (d / "grammars").mkdir(exist_ok=True)
    (d / "grammars" / ".gitkeep").write_text("")
    # profile.yaml carries the stored hash — Plan 02 computes & writes it
    (d / "profile.yaml").write_text("profile:\n  id: test\n  version: v1\n  hash: sha256:TBD\n")


def test_validator_exit_0_when_hash_matches(tmp_path: Path):
    """PROFILE-06: matching hash → exit 0."""
    bundle = tmp_path / "v1"
    _seed_bundle_with_stored_hash(bundle)
    # Plan 02 computes the correct hash + rewrites profile.yaml before invocation.
    result = _run_validator(bundle)
    assert result.returncode == 0


def test_validator_exit_2_on_hash_mismatch(tmp_path: Path):
    """PROFILE-06: mutate a file without updating profile.yaml.hash → exit 2."""
    bundle = tmp_path / "v1"
    _seed_bundle_with_stored_hash(bundle)
    # Mutate serving.yaml after the hash was computed
    (bundle / "serving.yaml").write_text("engine:\n  MUTATED: true\n")
    result = _run_validator(bundle)
    assert result.returncode == 2


def test_validator_exit_3_on_symlink(tmp_path: Path):
    """§4 point 1: symlink inside the bundle → canonicalization error → exit 3."""
    import os
    bundle = tmp_path / "v1"
    _seed_bundle_with_stored_hash(bundle)
    # Introduce a symlink — canonicalization rejects → exit 3
    os.symlink(bundle / "serving.yaml", bundle / "prompts" / "link.md")
    result = _run_validator(bundle)
    assert result.returncode == 3


def test_validator_exit_4_on_env_policy_violation(tmp_path: Path):
    """D-12 cross-field: serving.yaml.env.VLLM_NO_USAGE_STATS != "1" → exit 4."""
    bundle = tmp_path / "v1"
    _seed_bundle_with_stored_hash(bundle)
    (bundle / "serving.yaml").write_text(
        "engine: {}\nenv:\n  VLLM_NO_USAGE_STATS: \"0\"\n"
    )
    result = _run_validator(bundle)
    assert result.returncode == 4


def test_error_message_cites_both_hashes(tmp_path: Path):
    """§5 Layer 1: exit-2 stderr must name both stored and computed hashes,
    plus the literal "create profiles/.../v2/" remediation text."""
    bundle = tmp_path / "v1"
    _seed_bundle_with_stored_hash(bundle)
    (bundle / "serving.yaml").write_text("engine:\n  MUTATED: true\n")
    result = _run_validator(bundle)
    assert result.returncode == 2
    stderr = result.stderr
    assert "stored" in stderr.lower()
    assert "computed" in stderr.lower()
    assert "create profiles/" in stderr
    assert "/v2/" in stderr
