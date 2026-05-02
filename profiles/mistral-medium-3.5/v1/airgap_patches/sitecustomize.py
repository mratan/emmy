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


_maybe_apply_mistral3_patch()
