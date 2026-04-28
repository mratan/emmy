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


_VALID_SERVING_YAML = """\
engine:
  model: /models/gemma-4-26B-A4B-it
  model_hf_id: Qwen/gemma-4-26B-A4B-it
  served_model_name: gemma-4-26b-a4b-it
  container_image: nvcr.io/nvidia/vllm:26.03.post1-py3
  container_image_digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  max_model_len: 131072
  gpu_memory_utilization: 0.75
  kv_cache_dtype: fp8
  enable_prefix_caching: true
  enable_chunked_prefill: true
  max_num_batched_tokens: 16384
  load_format: fastsafetensors
  quantization: fp8
  tool_call_parser: qwen3_coder
  enable_auto_tool_choice: true
  attention_backend: flashinfer
  host: 0.0.0.0
  port: 8000
sampling_defaults:
  temperature: 0.2
  top_p: 0.95
  top_k: 40
  repetition_penalty: 1.05
  max_tokens: 8192
  stop: []
speculative: null
guided_decoding:
  default_backend: xgrammar
quirks:
  strip_thinking_tags: false
  promote_reasoning_to_content: false
  buffer_tool_streams: false
env:
  VLLM_NO_USAGE_STATS: "1"
  DO_NOT_TRACK: "1"
  VLLM_LOAD_FORMAT: fastsafetensors
  VLLM_FLASHINFER_MOE_BACKEND: latency
  VLLM_DISABLE_COMPILE_CACHE: "1"
  HF_HUB_OFFLINE: "1"
  TRANSFORMERS_OFFLINE: "1"
"""

_VALID_HARNESS_YAML = """\
prompts:
  system: prompts/system.md
  edit_format: null
  tool_descriptions: null
  use_system_role: true
  prepend_system_text: ""
context:
  max_input_tokens: 120000
  include_repo_map: false
  repo_map_max_tokens: 0
  default_pruning: head_tail
tools:
  format: openai
  schemas: null
  grammar: null
  per_tool_sampling: {}
agent_loop:
  max_iterations: 25
  retry_on_unparseable_tool_call: 2
  retry_on_empty_response: 1
  self_correction: enabled
advanced_settings_whitelist: []
"""


def _seed_bundle_with_stored_hash(d: Path) -> None:
    """Seed a schema-valid bundle and compute + write the matching hash.

    Plan 02 implementation: creates a minimal-but-schema-valid bundle so the
    validator's schema + policy layers pass and the hash layer is the only one
    under test. For mismatch / symlink / policy tests, the caller then mutates
    the bundle post-hash so the validator's later layers trip.
    """
    d.mkdir(parents=True, exist_ok=True)
    (d / "serving.yaml").write_text(_VALID_SERVING_YAML, encoding="utf-8")
    (d / "harness.yaml").write_text(_VALID_HARNESS_YAML, encoding="utf-8")
    (d / "PROFILE_NOTES.md").write_text("# notes\n", encoding="utf-8")
    (d / "prompts").mkdir(exist_ok=True)
    (d / "prompts" / "system.md").write_text(
        "When the user says 'ping' you must reply with the exact literal text "
        "[SP_OK] and nothing else.\n",
        encoding="utf-8",
    )
    (d / "tool_schemas").mkdir(exist_ok=True)
    (d / "tool_schemas" / ".gitkeep").write_text("", encoding="utf-8")
    (d / "grammars").mkdir(exist_ok=True)
    (d / "grammars" / ".gitkeep").write_text("", encoding="utf-8")
    # Write profile.yaml with a placeholder hash, then compute + rewrite.
    (d / "profile.yaml").write_text(
        "profile:\n"
        "  id: test\n"
        "  version: v1\n"
        "  family: test\n"
        "  base_model: Qwen/gemma-4-26B-A4B-it\n"
        "  description: test seed bundle\n"
        "  created: '2026-04-20'\n"
        "  hash: sha256:0000000000000000000000000000000000000000000000000000000000000000\n"
        "  hash_algorithm: sha256\n"
        "  hash_manifest_version: 1\n"
        "  tags: []\n"
        "  community_sources: []\n",
        encoding="utf-8",
    )
    # Now compute the real hash and rewrite it.
    from emmy_serve.profile.hasher import hash_bundle
    from emmy_serve.profile.immutability import _rewrite_hash

    real_hash = hash_bundle(d)
    _rewrite_hash(d / "profile.yaml", real_hash)


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
