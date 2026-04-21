"""RED skeleton — SERVE-07 rendered docker-run CLI flags.

Plan 03 ships `emmy_serve.boot.runner.render_docker_args` which reads serving.yaml
and emits a list[str] of docker-run arguments. See 01-RESEARCH.md §14 start_emmy.sh
contract for the full flag set.
"""
from __future__ import annotations
from pathlib import Path
import pytest

runner = pytest.importorskip("emmy_serve.boot.runner")


@pytest.fixture
def rendered_args(profile_path: Path, tmp_runs_dir: Path) -> list[str]:
    return runner.render_docker_args(
        profile_path=profile_path,
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
    """SERVE-01/REPRO-01: image reference uses sha256 digest form, never a tag."""
    # Find the image argument (it won't have a leading --flag prefix)
    image_refs = [a for a in rendered_args if a.startswith("nvcr.io/nvidia/vllm@")]
    assert image_refs, f"no pinned-digest image found in args: {rendered_args}"
    assert image_refs[0].startswith("nvcr.io/nvidia/vllm@sha256:")


def test_render_network_mode_none_when_airgap_true(profile_path: Path, tmp_runs_dir: Path):
    """D-09 / SERVE-09: airgap=True renders `--network none`."""
    args = runner.render_docker_args(
        profile_path=profile_path,
        run_dir=tmp_runs_dir,
        port=8002,
        airgap=True,
    )
    joined = " ".join(args)
    assert "--network none" in joined
