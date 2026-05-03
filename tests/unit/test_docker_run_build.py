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


# -----------------------------------------------------------------------------
# Plan 04.7-02 Workaround A — --hf-config-path emission coverage
# -----------------------------------------------------------------------------
#
# Workaround A is the response to vLLM's GGUF backend not yet allowlisting
# the `mistral3` GGUF architecture (vLLM 0.19.2rc1.dev134). By pointing
# vLLM's get_config() at a directory-on-disk that already contains a
# config.json (the unquantized base model's config, copied locally), we
# bypass the GGUF parser for everything except the actual weight load.
# See profiles/mistral-medium-3.5/v1/PROFILE_NOTES.md "Workaround A wiring".


_VALID_SERVING_YAML_WITH_HF_CONFIG_PATH = """\
engine:
  model: /models/Mistral-Medium-3.5-128B-Q4_K_M.gguf
  model_hf_id: mistralai/Mistral-Medium-3.5-128B
  served_model_name: mistral-medium-3.5
  container_image: vllm/vllm-openai:cu130-nightly-aarch64
  container_image_digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  hf_config_path: /models/Mistral-Medium-3.5-128B-config
  max_model_len: 131072
  gpu_memory_utilization: 0.78
  kv_cache_dtype: fp8
  enable_prefix_caching: true
  enable_chunked_prefill: true
  max_num_batched_tokens: 8192
  max_num_seqs: 1
  load_format: auto
  quantization: gguf
  tool_call_parser: mistral
  reasoning_parser: mistral
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
def test_profile_path_with_hf_config_path(tmp_path: Path) -> Path:
    """Schema-valid serving.yaml that exercises the hf_config_path field."""
    bundle = tmp_path / "v1"
    bundle.mkdir()
    (bundle / "serving.yaml").write_text(
        _VALID_SERVING_YAML_WITH_HF_CONFIG_PATH, encoding="utf-8"
    )
    return bundle


def test_render_emits_hf_config_path_when_set(test_profile_path_with_hf_config_path: Path):
    """04.7-02 Workaround A: ``--hf-config-path <dir>`` appears as a contiguous pair."""
    args = runner.render_vllm_cli_args(test_profile_path_with_hf_config_path)
    assert "--hf-config-path" in args, args
    idx = args.index("--hf-config-path")
    assert args[idx + 1] == "/models/Mistral-Medium-3.5-128B-config", (idx, args)


def test_render_omits_hf_config_path_when_unset(rendered_args):
    """04.7-02 Workaround A: pre-04.7-02 fixture does NOT declare hf_config_path,
    so ``--hf-config-path`` MUST NOT appear (byte-additive guarantee).
    """
    assert "--hf-config-path" not in rendered_args, rendered_args


def test_render_omits_hf_config_path_when_unset_in_new_flags_fixture(
    rendered_args_with_new_flags,
):
    """04.7-02 Workaround A: the 04.7-01 fixture (which exercises tokenizer/
    reasoning_parser/max_num_seqs but NOT hf_config_path) MUST render without
    --hf-config-path. Confirms hf_config_path is independently optional.
    """
    assert "--hf-config-path" not in rendered_args_with_new_flags, rendered_args_with_new_flags


# -----------------------------------------------------------------------------
# Plan 04.7-02 Decision Option 5 — airgap_patch_dir bind-mount + PYTHONPATH env
# -----------------------------------------------------------------------------
#
# When `engine.airgap_patch_dir: <bundle-relative-dir>` is set, the boot
# runner MUST:
#   1. emit `-v <bundle>/<airgap_patch_dir>:/airgap_patches:ro` (bind-mount)
#   2. emit `-e PYTHONPATH=/airgap_patches`
#   3. emit `-e EMMY_AIRGAP_PATCH_MISTRAL3=on` (per-patch opt-in)
#
# When unset, NONE of the three MUST appear (byte-additive guarantee for the
# 7+ shipping bundles + Plan 04.7-02 v1 pre-Option-5 state).


_VALID_SERVING_YAML_WITH_AIRGAP_PATCH_DIR = """\
engine:
  model: /models/Mistral-Medium-3.5-128B-Q4_K_M.gguf
  model_hf_id: mistralai/Mistral-Medium-3.5-128B
  served_model_name: mistral-medium-3.5
  container_image: vllm/vllm-openai:cu130-nightly-aarch64
  container_image_digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  hf_config_path: /models/Mistral-Medium-3.5-128B-config
  airgap_patch_dir: airgap_patches
  max_model_len: 131072
  gpu_memory_utilization: 0.78
  kv_cache_dtype: fp8
  enable_prefix_caching: true
  enable_chunked_prefill: true
  max_num_batched_tokens: 8192
  max_num_seqs: 1
  load_format: auto
  quantization: gguf
  tool_call_parser: mistral
  reasoning_parser: mistral
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
def test_profile_path_with_airgap_patch_dir(tmp_path: Path) -> Path:
    """Bundle dir whose serving.yaml declares airgap_patch_dir + a stub patches dir."""
    bundle = tmp_path / "v1"
    bundle.mkdir()
    (bundle / "serving.yaml").write_text(
        _VALID_SERVING_YAML_WITH_AIRGAP_PATCH_DIR, encoding="utf-8"
    )
    # Stub the patches dir (sitecustomize.py + patch module) so the bind-mount
    # source resolves cleanly. Contents are not exercised by the renderer test;
    # the runtime patch test belongs in tests/integration/.
    patches = bundle / "airgap_patches"
    patches.mkdir()
    (patches / "sitecustomize.py").write_text("# stub for fixture\n", encoding="utf-8")
    return bundle


def test_render_emits_airgap_patch_dir_bind_mount(
    test_profile_path_with_airgap_patch_dir: Path, tmp_runs_dir: Path
):
    """04.7-02 Decision Option 5: bind-mount appears with the resolved host path.

    Source path is the bundle-resolved absolute path (host-side); destination
    is fixed at /airgap_patches (container-side). :ro suffix is required —
    the patch should never be writable from inside the container.
    """
    args = runner.render_docker_only_args(
        profile_path=test_profile_path_with_airgap_patch_dir,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=False,
    )
    expected_src = (
        test_profile_path_with_airgap_patch_dir / "airgap_patches"
    ).resolve()
    expected_mount = f"{expected_src}:/airgap_patches:ro"
    assert expected_mount in args, (expected_mount, args)


def test_render_emits_airgap_patch_pythonpath_env(
    test_profile_path_with_airgap_patch_dir: Path, tmp_runs_dir: Path
):
    """04.7-02 Decision Option 5: PYTHONPATH=/airgap_patches env var emitted.

    The env var is what makes Python's site machinery import the
    /airgap_patches/sitecustomize.py at process start. Without it the
    bind-mount is operationally inert.
    """
    args = runner.render_docker_only_args(
        profile_path=test_profile_path_with_airgap_patch_dir,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=False,
    )
    assert "PYTHONPATH=/airgap_patches" in args, args


def test_render_emits_airgap_patch_mistral3_optin_env(
    test_profile_path_with_airgap_patch_dir: Path, tmp_runs_dir: Path
):
    """04.7-02 Decision Option 5: per-patch opt-in env emitted.

    The sitecustomize.py file checks EMMY_AIRGAP_PATCH_MISTRAL3 before
    actually applying the mistral3 allowlist patch — so other Python
    processes that happen to land on this PYTHONPATH (e.g. operator debug
    shells, test harnesses) do NOT trigger the patch by accident. The boot
    runner sets the opt-in alongside the PYTHONPATH so the deliberate
    operator gesture is the bundle declaration.
    """
    args = runner.render_docker_only_args(
        profile_path=test_profile_path_with_airgap_patch_dir,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=False,
    )
    assert "EMMY_AIRGAP_PATCH_MISTRAL3=on" in args, args


def test_render_omits_airgap_patch_dir_when_unset(
    test_profile_path: Path, tmp_runs_dir: Path
):
    """04.7-02 Decision Option 5 — backward compat: pre-Option-5 fixtures (no
    airgap_patch_dir) MUST render WITHOUT the bind-mount or PYTHONPATH env.

    Confirms additive-only behavior: the 7+ shipped bundles + Plan 04.7-02
    pre-Option-5 v1 state continue to render byte-identically — no new
    docker volume, no new env vars.
    """
    args = runner.render_docker_only_args(
        profile_path=test_profile_path,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=False,
    )
    assert "/airgap_patches:ro" not in " ".join(args), args
    assert "PYTHONPATH=/airgap_patches" not in args, args
    assert "EMMY_AIRGAP_PATCH_MISTRAL3=on" not in args, args


def test_render_omits_airgap_patch_dir_when_unset_in_hf_config_fixture(
    test_profile_path_with_hf_config_path: Path, tmp_runs_dir: Path
):
    """04.7-02 Decision Option 5: a Workaround-A fixture that sets
    hf_config_path but NOT airgap_patch_dir MUST render without the
    bind-mount/env wiring. Confirms the two fields are independently optional.
    """
    args = runner.render_docker_only_args(
        profile_path=test_profile_path_with_hf_config_path,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=False,
    )
    assert "/airgap_patches:ro" not in " ".join(args), args
    assert "PYTHONPATH=/airgap_patches" not in args, args
    assert "EMMY_AIRGAP_PATCH_MISTRAL3=on" not in args, args


# -----------------------------------------------------------------------------
# Plan 04.7-02 follow-up Decision Option 5/7a — `--dtype` + `--tokenizer-mode`
# CLI emission coverage
# -----------------------------------------------------------------------------
#
# `--dtype` lands a missing-test gap from Wave 3 commit `35aee85` (the schema
# field was added, the CLI emission was added, but a renderer test wasn't).
# `--tokenizer-mode` is the new field added by this iteration to address the
# `MistralTokenizer` requirement surfaced by Wave 3 attempt 7. Both fields
# are conditional-emission so the absence assertions below guarantee
# byte-identical render for the 7+ shipped bundles.


_VALID_SERVING_YAML_WITH_DTYPE_AND_TOKENIZER_MODE = """\
engine:
  model: /models/Mistral-Medium-3.5-128B-Q4_K_M.gguf
  model_hf_id: mistralai/Mistral-Medium-3.5-128B
  served_model_name: mistral-medium-3.5
  container_image: vllm/vllm-openai:cu130-nightly-aarch64
  container_image_digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  tokenizer: /models/Mistral-Medium-3.5-128B-config
  hf_config_path: /models/Mistral-Medium-3.5-128B-config
  airgap_patch_dir: airgap_patches
  dtype: float16
  tokenizer_mode: mistral
  max_model_len: 131072
  gpu_memory_utilization: 0.78
  kv_cache_dtype: fp8
  enable_prefix_caching: true
  enable_chunked_prefill: true
  max_num_batched_tokens: 8192
  max_num_seqs: 1
  load_format: auto
  quantization: gguf
  tool_call_parser: mistral
  reasoning_parser: mistral
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
def test_profile_path_with_dtype_and_tokenizer_mode(tmp_path: Path) -> Path:
    """Bundle dir whose serving.yaml declares dtype + tokenizer_mode + the
    full Wave-3/7a stack (airgap_patches + hf_config_path + tokenizer).
    """
    bundle = tmp_path / "v1"
    bundle.mkdir()
    (bundle / "serving.yaml").write_text(
        _VALID_SERVING_YAML_WITH_DTYPE_AND_TOKENIZER_MODE, encoding="utf-8"
    )
    # Stub the airgap_patches dir so the docker-only renderer's bind-mount
    # source resolves cleanly (same pattern as the Option-5 fixture above).
    patches = bundle / "airgap_patches"
    patches.mkdir()
    (patches / "sitecustomize.py").write_text("# stub for fixture\n", encoding="utf-8")
    return bundle


def test_render_emits_dtype_when_set(
    test_profile_path_with_dtype_and_tokenizer_mode: Path,
):
    """04.7-02 sitecustomize wave: ``--dtype <value>`` appears as a contiguous
    pair when ``engine.dtype`` is set.

    Closes the test-coverage gap for the Wave-3 ``EngineConfig.dtype`` field
    (commit 35aee85 added the field + CLI emission but no renderer test).
    """
    args = runner.render_vllm_cli_args(test_profile_path_with_dtype_and_tokenizer_mode)
    assert "--dtype" in args, args
    idx = args.index("--dtype")
    assert args[idx + 1] == "float16", (idx, args)


def test_render_emits_tokenizer_mode_when_set(
    test_profile_path_with_dtype_and_tokenizer_mode: Path,
):
    """04.7-02 Option 7a: ``--tokenizer-mode <value>`` appears as a contiguous
    pair when ``engine.tokenizer_mode`` is set. The Wave-3 attempt-7 trace
    pinned this as the load-bearing CLI flag for the MistralTokenizer
    architectural blocker — without it vLLM defaults to "auto" and rejects
    the loaded HF tokenizer at the FINAL VllmConfig validation step.
    """
    args = runner.render_vllm_cli_args(test_profile_path_with_dtype_and_tokenizer_mode)
    assert "--tokenizer-mode" in args, args
    idx = args.index("--tokenizer-mode")
    assert args[idx + 1] == "mistral", (idx, args)


def test_render_omits_dtype_when_unset(rendered_args):
    """04.7-02 sitecustomize wave: pre-04.7-02-followup fixture (no
    ``dtype`` field) MUST render without ``--dtype`` (byte-additive).
    """
    assert "--dtype" not in rendered_args, rendered_args


def test_render_omits_tokenizer_mode_when_unset(rendered_args):
    """04.7-02 Option 7a: pre-04.7-02-followup fixture (no ``tokenizer_mode``)
    MUST render without ``--tokenizer-mode`` (byte-additive).
    """
    assert "--tokenizer-mode" not in rendered_args, rendered_args


def test_render_omits_dtype_when_unset_in_new_flags_fixture(
    rendered_args_with_new_flags,
):
    """04.7-02: the 04.7-01 fixture (which exercises tokenizer/
    reasoning_parser/max_num_seqs but NOT dtype) MUST render without
    --dtype. Confirms dtype is independently optional.
    """
    assert "--dtype" not in rendered_args_with_new_flags, rendered_args_with_new_flags


def test_render_omits_tokenizer_mode_when_unset_in_new_flags_fixture(
    rendered_args_with_new_flags,
):
    """04.7-02 Option 7a: same independence guarantee for tokenizer_mode."""
    assert (
        "--tokenizer-mode" not in rendered_args_with_new_flags
    ), rendered_args_with_new_flags


def test_render_omits_dtype_when_unset_in_hf_config_fixture(
    test_profile_path_with_hf_config_path: Path,
):
    """04.7-02: the Workaround-A fixture (hf_config_path set, dtype unset)
    MUST render without --dtype. Confirms dtype is independent of
    hf_config_path.
    """
    args = runner.render_vllm_cli_args(test_profile_path_with_hf_config_path)
    assert "--dtype" not in args, args


def test_render_omits_tokenizer_mode_when_unset_in_airgap_fixture(
    test_profile_path_with_airgap_patch_dir: Path,
):
    """04.7-02 Option 7a: the Wave-3 sitecustomize-only fixture (airgap_patch_dir
    set, tokenizer_mode unset) MUST render without --tokenizer-mode.
    Confirms tokenizer_mode is independent of airgap_patch_dir — the new
    7a wiring sits on TOP of Option 5, not coupled to it.
    """
    args = runner.render_vllm_cli_args(test_profile_path_with_airgap_patch_dir)
    assert "--tokenizer-mode" not in args, args
