"""Hot-patch vLLM's runai_streamer loader to remap Mistral3 multimodal
checkpoint names to text-only MistralForCausalLM params_dict shape.

Phase 04.7-02 followup E3 (2026-05-05): v2.4 boot with `--load-format
runai_streamer` failed at:
    File "/usr/local/lib/python3.12/dist-packages/vllm/model_executor/
         model_loader/runai_streamer_loader.py", line 101, in load_weights
        model.load_weights(...)
    File ".../vllm/model_executor/models/llama.py", line 487, in load_weights
        param = params_dict[name]
    KeyError: 'language_model.layers.55.self_attn.qkv_proj.input_global_scale'

Background
==========
This is the SAME class of name-shape mismatch that
`mistral3_safetensors_remap.py` fixes for `DefaultModelLoader.get_all_weights`.
But `RunaiModelStreamerLoader` extends `BaseModelLoader` directly — it does
NOT call through `DefaultModelLoader.get_all_weights`. Each load_format brings
its own weight-iterator implementation; vLLM does not have a global hook.

The runai_streamer's iterator is at:
    vllm.model_executor.model_loader.runai_streamer_loader
        .RunaiModelStreamerLoader._get_weights_iterator

Reference: https://github.com/vllm-project/vllm/blob/main/vllm/
model_executor/model_loader/runai_streamer_loader.py (lines 66 + 97)

Patch strategy
==============
Wrap `RunaiModelStreamerLoader._get_weights_iterator` with the same
prefix-stripping generator that mistral3_safetensors_remap uses on
DefaultModelLoader. Same `_remap_name` logic: strip
`(model.)?language_model.` prefix, skip `(model.)?vision_tower.` and
`(model.)?multi_modal_projector.` entries, pass everything else through.

Idempotent + defensive: same patterns as mistral3_safetensors_remap.

Removal criteria
================
Same as mistral3_safetensors_remap.py — remove when vLLM ships a Mistral3
text-only registry entry that handles the prefix natively, OR when we
pre-process the safetensors offline.
"""
from __future__ import annotations

import sys


PATCH_VERSION = "1.0.0"
PATCH_NAME = "mistral3_runai_streamer_remap"


def _remap_name(name: str) -> str | None:
    """Apply the multimodal-→-text-only rename. Returns None to SKIP the tensor.

    BYTE-IDENTICAL logic to mistral3_safetensors_remap._remap_name.
    Kept inline (not imported) so this patch is self-contained.
    """
    if name.startswith("model.vision_tower.") or name.startswith("vision_tower."):
        return None
    if name.startswith("model.multi_modal_projector.") or name.startswith("multi_modal_projector."):
        return None
    if name.startswith("model.language_model."):
        return "model." + name[len("model.language_model."):]
    if name.startswith("language_model."):
        return name[len("language_model."):]
    return name


def apply() -> None:
    """Wrap RunaiModelStreamerLoader._get_weights_iterator with the rename + skip filter."""
    try:
        from vllm.model_executor.model_loader import runai_streamer_loader
    except ImportError as exc:
        print(
            f"[{PATCH_NAME}] vLLM runai_streamer_loader not importable "
            f"({type(exc).__name__}: {exc}); runai-streamer remap NOT applied",
            file=sys.stderr,
        )
        return

    cls = getattr(runai_streamer_loader, "RunaiModelStreamerLoader", None)
    if cls is None:
        print(
            f"[{PATCH_NAME}] RunaiModelStreamerLoader class not found on "
            "runai_streamer_loader module; runai-streamer remap NOT applied",
            file=sys.stderr,
        )
        return

    if getattr(cls._get_weights_iterator, "__wrapped_by_emmy_runai_streamer__", False):
        print(
            f"[{PATCH_NAME}] runai-streamer remap already applied; skipping",
            file=sys.stderr,
        )
        return

    _orig_iter = cls._get_weights_iterator

    def patched_iter(self, model_or_path, revision):
        seen = 0
        renamed = 0
        skipped = 0

        for name, tensor in _orig_iter(self, model_or_path, revision):
            seen += 1
            new_name = _remap_name(name)
            if new_name is None:
                skipped += 1
                continue
            if new_name != name:
                renamed += 1
            yield new_name, tensor

        print(
            f"[{PATCH_NAME}] runai-streamer remap completed: "
            f"{seen} tensors yielded; {renamed} renamed; {skipped} vision/projector skipped",
            file=sys.stderr,
        )

    patched_iter.__wrapped_by_emmy_runai_streamer__ = True  # type: ignore[attr-defined]
    cls._get_weights_iterator = patched_iter  # type: ignore[method-assign]

    print(
        f"[{PATCH_NAME}] v{PATCH_VERSION} fix applied: "
        "RunaiModelStreamerLoader._get_weights_iterator WRAPPED to strip "
        "`language_model.` prefix and skip vision_tower/multi_modal_projector "
        "tensors. MistralForCausalLM params_dict will now find every loaded weight.",
        file=sys.stderr,
    )


__all__ = ["apply", "PATCH_VERSION", "PATCH_NAME"]
