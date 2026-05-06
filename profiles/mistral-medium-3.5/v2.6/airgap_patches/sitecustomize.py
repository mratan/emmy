"""Auto-imported Python startup hook (Operator Decision Option 5, 2026-05-02).

Python's site machinery imports `sitecustomize` (if found on `sys.path`) at
process start, BEFORE any user code. This file is mounted into the vLLM
container at `/airgap_patches/sitecustomize.py` and `/airgap_patches` is
prepended to `PYTHONPATH` by `emmy_serve.boot.runner.render_docker_only_args`
when `engine.airgap_patch_dir` is set in serving.yaml.

It defers all real work to `mistral3_gguf_allowlist.apply()` so the patch
logic is testable in isolation (without relying on Python's site machinery).
"""
from __future__ import annotations

import os
import sys


def _maybe_apply_mistral3_patch() -> None:
    """Apply the mistral3 GGUF allowlist hot-patch if the env opt-in is set.

    Default: opt-in via `EMMY_AIRGAP_PATCH_MISTRAL3=on` (set by the boot
    runner alongside the bind-mount) so the patch ONLY fires when the
    operator explicitly wires it via the profile bundle. This keeps the
    sitecustomize.py file safe to ship in the source tree without affecting
    any other Python process that happens to land on this PYTHONPATH.
    """
    if os.environ.get("EMMY_AIRGAP_PATCH_MISTRAL3", "").lower() not in ("on", "1", "true"):
        return
    try:
        from mistral3_gguf_allowlist import apply
    except Exception as exc:  # pragma: no cover - defensive: log + continue
        print(
            f"[airgap_patches/sitecustomize] WARN: cannot import "
            f"mistral3_gguf_allowlist ({type(exc).__name__}: {exc}); "
            "patch NOT applied",
            file=sys.stderr,
        )
        return
    try:
        apply()
    except Exception as exc:  # pragma: no cover - defensive: log + continue
        print(
            f"[airgap_patches/sitecustomize] WARN: mistral3 patch raised "
            f"({type(exc).__name__}: {exc}); patch NOT applied",
            file=sys.stderr,
        )


def _maybe_apply_mistral3_safetensors_remap() -> None:
    """Apply the v2 NVFP4 safetensors name-remap patch (Wave 5 attempt 7+).

    Same env gate as the GGUF patch (`EMMY_AIRGAP_PATCH_MISTRAL3=on`) — both
    are Mistral3-on-vLLM compat patches that ride together. The GGUF patch
    is a no-op for safetensors load paths and vice-versa, so they don't
    interfere; gating both with the same env var keeps wiring simple.
    """
    if os.environ.get("EMMY_AIRGAP_PATCH_MISTRAL3", "").lower() not in ("on", "1", "true"):
        return
    try:
        from mistral3_safetensors_remap import apply as apply_safetensors
    except Exception as exc:  # pragma: no cover - defensive: log + continue
        print(
            f"[airgap_patches/sitecustomize] WARN: cannot import "
            f"mistral3_safetensors_remap ({type(exc).__name__}: {exc}); "
            "safetensors remap NOT applied",
            file=sys.stderr,
        )
        return
    try:
        apply_safetensors()
    except Exception as exc:  # pragma: no cover - defensive: log + continue
        print(
            f"[airgap_patches/sitecustomize] WARN: mistral3 safetensors remap raised "
            f"({type(exc).__name__}: {exc}); patch NOT applied",
            file=sys.stderr,
        )


def _maybe_apply_mistral3_runai_streamer_remap() -> None:
    """Apply the v2.5 NVFP4 runai_streamer name-remap patch (E3, 2026-05-05).

    Same env gate as the GGUF + safetensors patches. Distinct from the
    safetensors remap because RunaiModelStreamerLoader has its own
    `_get_weights_iterator` that bypasses DefaultModelLoader.get_all_weights.
    No-op when --load-format is NOT runai_streamer (the patched method is
    dormant unless that loader class is actually instantiated).
    """
    if os.environ.get("EMMY_AIRGAP_PATCH_MISTRAL3", "").lower() not in ("on", "1", "true"):
        return
    try:
        from mistral3_runai_streamer_remap import apply as apply_runai
    except Exception as exc:  # pragma: no cover - defensive: log + continue
        print(
            f"[airgap_patches/sitecustomize] WARN: cannot import "
            f"mistral3_runai_streamer_remap ({type(exc).__name__}: {exc}); "
            "runai-streamer remap NOT applied",
            file=sys.stderr,
        )
        return
    try:
        apply_runai()
    except Exception as exc:  # pragma: no cover - defensive: log + continue
        print(
            f"[airgap_patches/sitecustomize] WARN: mistral3 runai-streamer remap raised "
            f"({type(exc).__name__}: {exc}); patch NOT applied",
            file=sys.stderr,
        )


_maybe_apply_mistral3_patch()
_maybe_apply_mistral3_safetensors_remap()
_maybe_apply_mistral3_runai_streamer_remap()
