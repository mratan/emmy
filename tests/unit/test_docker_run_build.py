"""GREEN — SERVE-07 rendered docker-run CLI flags.

Plan 03 ships `emmy_serve.boot.runner.render_docker_args` which reads serving.yaml
and emits a list[str] of docker-run arguments (docker flags + image ref + vllm
serve flags). See 01-RESEARCH.md §14 start_emmy.sh contract for the full set.

Uses a tmp_path-seeded fixture bundle (rather than the on-disk profile that
carries the `sha256:REPLACE_AT_FIRST_PULL` sentinel) so the schema validator's
digest-sentinel rejection (see schema.py._digest_shape) does not block the
renderer tests. The operator-captured digest lives in the on-disk profile;
this test asserts the renderer shape.
"""
from __future__ import annotations
from pathlib import Path
import pytest

runner = pytest.importorskip("emmy_serve.boot.runner")


_VALID_SERVING_YAML = """\
engine:
  model: /models/gemma-4-26B-A4B-it
  model_hf_id: Qwen/gemma-4-26B-A4B-it
  served_model_name: gemma-4-26b-a4b-it
  container_image: emmy-serve/vllm:26.03.post1-fst
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


@pytest.fixture
def test_profile_path(tmp_path: Path) -> Path:
    """Write a schema-valid serving.yaml with a real (non-sentinel) digest.

    The on-disk profile carries `sha256:REPLACE_AT_FIRST_PULL` which the
    pydantic schema rejects; these renderer tests don't depend on the real
    captured digest, only the render shape — seed a local valid bundle.
    """
    bundle = tmp_path / "v1"
    bundle.mkdir()
    (bundle / "serving.yaml").write_text(_VALID_SERVING_YAML, encoding="utf-8")
    return bundle


@pytest.fixture
def rendered_args(test_profile_path: Path, tmp_runs_dir: Path) -> list[str]:
    return runner.render_docker_args(
        profile_path=test_profile_path,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=False,
    )


def test_render_includes_prefix_caching_flag(rendered_args):
    """SERVE-07: --enable-prefix-caching must appear in the rendered CLI."""
    assert "--enable-prefix-caching" in rendered_args


def test_render_includes_chunked_prefill_flag(rendered_args):
    """SERVE-07: --enable-chunked-prefill must appear."""
    assert "--enable-chunked-prefill" in rendered_args


def test_render_includes_fastsafetensors_load_format(rendered_args):
    """SERVE-10: --load-format fastsafetensors must appear."""
    # argv-shaped output: "--load-format" followed by "fastsafetensors"
    joined = " ".join(rendered_args)
    assert "--load-format fastsafetensors" in joined


def test_render_includes_pinned_digest_image(rendered_args):
    """SERVE-01/REPRO-01: image reference uses sha256 content-hash form, never a tag.

    Two acceptable shapes, both pinned by content hash:
      * ``<registry-repo>@sha256:<hex>`` — canonical pull-spec for registry images
      * ``sha256:<hex>`` — bare image ID for locally-built/derived images
        (Docker accepts either form in ``docker run``)
    A raw ``:tag`` form is NOT acceptable (SERVE-01 forbids tag drift).
    """
    import re
    pinned_pat = re.compile(r"(?:^|/)([^/:]+)@sha256:[0-9a-f]{64}$|^sha256:[0-9a-f]{64}$")
    image_refs = [a for a in rendered_args if pinned_pat.search(a)]
    assert image_refs, (
        f"no pinned-digest image ref (repo@sha256 or bare sha256) found in args: {rendered_args}"
    )


def test_render_local_image_emits_bare_sha256(tmp_path, tmp_runs_dir):
    """SERVE-01: a locally-built image (no registry host) renders as bare sha256.

    Locally-built images lack a RepoDigest until pushed — the pinned form is the
    image ID (``docker inspect --format '{{.Id}}'``), which ``docker run`` accepts
    directly. This path covers emmy's derived ``emmy-serve/vllm:...-fst`` image.
    """
    yaml_text = _VALID_SERVING_YAML  # already uses emmy-serve/vllm (no registry host)
    bundle = tmp_path / "v1"
    bundle.mkdir()
    (bundle / "serving.yaml").write_text(yaml_text, encoding="utf-8")
    args = runner.render_docker_args(
        profile_path=bundle, run_dir=tmp_runs_dir, port=8002, airgap=False
    )
    # The bare sha256 digest must appear as its own argv element.
    bare_digests = [a for a in args if a.startswith("sha256:") and "/" not in a and "@" not in a]
    assert bare_digests, f"no bare sha256 image ref found in args: {args}"


def test_render_registry_image_emits_repo_at_sha256(tmp_path, tmp_runs_dir):
    """SERVE-01: a registry-hosted image renders as ``<repo>@sha256:<hex>``.

    This path covers pristine NGC images (``nvcr.io/...``) if a future profile
    moves back to them. The renderer keeps both shapes working.
    """
    yaml_text = _VALID_SERVING_YAML.replace(
        "container_image: emmy-serve/vllm:26.03.post1-fst",
        "container_image: nvcr.io/nvidia/vllm:26.03.post1-py3",
    )
    bundle = tmp_path / "v1"
    bundle.mkdir()
    (bundle / "serving.yaml").write_text(yaml_text, encoding="utf-8")
    args = runner.render_docker_args(
        profile_path=bundle, run_dir=tmp_runs_dir, port=8002, airgap=False
    )
    refs = [a for a in args if a.startswith("nvcr.io/nvidia/vllm@sha256:")]
    assert refs, f"no pinned NGC image ref found in args: {args}"


def test_render_network_mode_none_when_airgap_true(test_profile_path: Path, tmp_runs_dir: Path):
    """D-09 / SERVE-09: airgap=True renders `--network none`."""
    args = runner.render_docker_args(
        profile_path=test_profile_path,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=True,
    )
    joined = " ".join(args)
    assert "--network none" in joined


# -----------------------------------------------------------------------------
# Plan 04.7-01 Task 1 — orphaned-flag fix coverage
# -----------------------------------------------------------------------------
#
# Three EngineConfig fields existed but were never emitted by render_vllm_cli_args:
#   - reasoning_parser (Optional[str], shipped Phase 4)
#   - max_num_seqs     (Optional[int], shipped Phase 4)
#   - tokenizer        (Optional[str], shipped 04.7-01 schema extension)
#
# Mistral GGUF profiles structurally require `--tokenizer` to be passed (vLLM
# GGUF docs: extracting the tokenizer from a bundled GGUF is "time-consuming
# and unstable"). Gemma profiles benefit from making the implicit explicit
# (vLLM auto-detects reasoning_parser from tokenizer_config.json today). See
# 04.7-RESEARCH.md §1.2 + 04.7-PATTERNS.md §"render_vllm_cli_args (MODIFIED)".


_VALID_SERVING_YAML_WITH_NEW_FLAGS = """\
engine:
  model: /models/Mistral-Medium-3.5-128B-Q4_K_M.gguf
  model_hf_id: mistralai/Mistral-Medium-3.5-128B
  served_model_name: mistral-medium-3.5
  container_image: vllm/vllm-openai:cu130-nightly-aarch64
  container_image_digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  tokenizer: mistralai/Mistral-Medium-3.5-128B
  max_model_len: 131072
  gpu_memory_utilization: 0.78
  kv_cache_dtype: fp8
  enable_prefix_caching: true
  enable_chunked_prefill: true
  max_num_batched_tokens: 8192
  max_num_seqs: 4
  load_format: auto
  quantization: gguf
  tool_call_parser: mistral
  reasoning_parser: gemma4
  enable_auto_tool_choice: true
  host: 0.0.0.0
  port: 8000
sampling_defaults:
  temperature: 0.15
  top_p: 0.95
  top_k: 40
  repetition_penalty: 1.0
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
  VLLM_LOAD_FORMAT: auto
  VLLM_FLASHINFER_MOE_BACKEND: latency
  VLLM_DISABLE_COMPILE_CACHE: "1"
  HF_HUB_OFFLINE: "1"
  TRANSFORMERS_OFFLINE: "1"
"""


@pytest.fixture
def test_profile_path_with_new_flags(tmp_path: Path) -> Path:
    """Schema-valid serving.yaml that exercises reasoning_parser, max_num_seqs, tokenizer."""
    bundle = tmp_path / "v1"
    bundle.mkdir()
    (bundle / "serving.yaml").write_text(_VALID_SERVING_YAML_WITH_NEW_FLAGS, encoding="utf-8")
    return bundle


@pytest.fixture
def rendered_args_with_new_flags(test_profile_path_with_new_flags: Path) -> list[str]:
    return runner.render_vllm_cli_args(test_profile_path_with_new_flags)


def test_render_emits_reasoning_parser_when_set(rendered_args_with_new_flags):
    """04.7-01 Task 1: ``--reasoning-parser <value>`` appears as a contiguous pair."""
    args = rendered_args_with_new_flags
    assert "--reasoning-parser" in args, args
    idx = args.index("--reasoning-parser")
    assert args[idx + 1] == "gemma4", (idx, args)


def test_render_emits_max_num_seqs_when_set(rendered_args_with_new_flags):
    """04.7-01 Task 1: ``--max-num-seqs <int>`` appears as a contiguous pair."""
    args = rendered_args_with_new_flags
    assert "--max-num-seqs" in args, args
    idx = args.index("--max-num-seqs")
    assert args[idx + 1] == "4", (idx, args)


def test_render_emits_tokenizer_when_set(rendered_args_with_new_flags):
    """04.7-01 Task 1: ``--tokenizer <id>`` appears as a contiguous pair."""
    args = rendered_args_with_new_flags
    assert "--tokenizer" in args, args
    idx = args.index("--tokenizer")
    assert args[idx + 1] == "mistralai/Mistral-Medium-3.5-128B", (idx, args)


def test_render_omits_new_flags_when_unset(rendered_args):
    """04.7-01 Task 1: with the original fixture (no reasoning/seqs/tokenizer set), none emit.

    The original ``_VALID_SERVING_YAML`` does not declare ``reasoning_parser``,
    ``max_num_seqs``, or ``tokenizer`` — confirms conditional emission preserved
    so existing FP8 profiles render unchanged.
    """
    assert "--reasoning-parser" not in rendered_args, rendered_args
    assert "--max-num-seqs" not in rendered_args, rendered_args
    assert "--tokenizer" not in rendered_args, rendered_args
