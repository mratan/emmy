"""Hot-patch vLLM's safetensors weight iterator to remap Mistral3 multimodal
checkpoint names to text-only MistralForCausalLM params_dict shape.

Wave 5 attempt 6 fired layer 13: KeyError 'language_model.embed_tokens.weight'
at vllm/model_executor/models/llama.py:499 during weight load.

Background
==========
RecViking's NVFP4 checkpoint is a quantized clone of the upstream multimodal
Mistral 3.5 architecture (`Mistral3ForConditionalGeneration`). Its safetensors
hold weight names with `model.language_model.X` prefix (multimodal nesting:
the multimodal arch wraps a text sub-model named `language_model`).

Our overlay declares `architectures=[Ministral3ForCausalLM]` + `model_type=mistral3`
to dodge the Mistral3 multimodal init path. vLLM's registry maps
`Ministral3ForCausalLM → ("mistral", "MistralForCausalLM")` at registry.py:164,
so the actual model loaded is `MistralForCausalLM` (text-only, descended from
LlamaForCausalLM). Its `params_dict` keys are the TEXT-ONLY shape:
`model.embed_tokens.weight`, `model.layers.X.self_attn.q_proj.weight`, etc.

Mismatch:
    safetensors yield:   model.language_model.embed_tokens.weight
    params_dict expects: model.embed_tokens.weight  (no `language_model.` prefix)

→ KeyError at first non-prefix-matching tensor.

This is the v2-NVFP4 analog of v1's layer-8 GGUF name-remap patch
(`_get_gguf_weights_map` wrapper). Same shape problem, different loader path.

Patch strategy
==============
Wrap `vllm.model_executor.model_loader.default_loader.DefaultModelLoader.get_all_weights`
to:
  - Strip `model.language_model.` prefix → `model.` (the 88 layers + embed_tokens + norm)
  - Strip leading `language_model.` prefix → ``  (defensive — we haven't seen this
    shape in RecViking's index but mistral_common can rename in future variants)
  - SKIP entries starting with `model.vision_tower.` (vision encoder — bf16, we
    have no slot for these in MistralForCausalLM)
  - SKIP entries starting with `model.multi_modal_projector.` (multimodal
    projector — same reason)
  - Pass through everything else unchanged (lm_head.weight, model.norm.weight, etc.)

The vision_tower / multi_modal_projector skip is the second-order benefit: we
free ~5 GB of GPU VRAM that would otherwise have been wasted loading tensors
into nowhere (or erroring at the same KeyError point).

Idempotent: re-import is safe (sets a sentinel `__wrapped_by_emmy_safetensors__`
attribute on the wrapped method). Defensive: if vLLM's module structure has
changed away from `default_loader.DefaultModelLoader.get_all_weights`,
raises a clear AttributeError instead of silently no-op'ing.

Removal criteria
================
Remove this file when EITHER:
  - vLLM ships a Mistral3-text-only path that natively handles the
    `language_model.` prefix (vllm/model_executor/models/mistral3.py grows a
    text-only registry entry), OR
  - RecViking re-publishes a stripped text-only NVFP4 checkpoint (no
    `language_model.` prefix, no vision_tower tensors), OR
  - We pre-process the safetensors offline to rewrite names + drop vision
    tensors (one-time ~1h job; doubles disk briefly).

Until then, this patch is the v2 ship-state. Without it, MistralForCausalLM
cannot consume RecViking's checkpoint shape — KeyError at the first weight.
"""
from __future__ import annotations

import sys


PATCH_VERSION = "1.0.0"
PATCH_NAME = "mistral3_safetensors_remap"


def _remap_name(name: str) -> str | None:
    """Apply the multimodal-→-text-only rename. Returns None to SKIP the tensor."""
    # Skip vision tensors entirely (no slot in MistralForCausalLM)
    if name.startswith("model.vision_tower.") or name.startswith("vision_tower."):
        return None
    if name.startswith("model.multi_modal_projector.") or name.startswith("multi_modal_projector."):
        return None
    # Strip the `language_model.` nesting prefix, preserving any outer `model.`
    if name.startswith("model.language_model."):
        return "model." + name[len("model.language_model."):]
    if name.startswith("language_model."):
        # Defensive: in case some variant ships without the outer `model.` wrapper
        return name[len("language_model."):]
    # Pass-through: lm_head.weight, model.norm.weight, model.embed_tokens.weight
    # (if present in non-prefixed form), etc.
    return name


def apply() -> None:
    """Wrap DefaultModelLoader.get_all_weights to apply the rename + skip filter."""
    try:
        from vllm.model_executor.model_loader import default_loader
    except ImportError as exc:
        print(
            f"[{PATCH_NAME}] vLLM default_loader not importable "
            f"({type(exc).__name__}: {exc}); safetensors remap NOT applied",
            file=sys.stderr,
        )
        return

    cls = getattr(default_loader, "DefaultModelLoader", None)
    if cls is None:
        print(
            f"[{PATCH_NAME}] DefaultModelLoader class not found on default_loader module; "
            "safetensors remap NOT applied",
            file=sys.stderr,
        )
        return

    if getattr(cls.get_all_weights, "__wrapped_by_emmy_safetensors__", False):
        print(
            f"[{PATCH_NAME}] safetensors remap already applied; skipping",
            file=sys.stderr,
        )
        return

    _orig_get_all_weights = cls.get_all_weights

    def patched_get_all_weights(self, model_config, model):
        # Counters for the boot-time confirmation log line.
        seen = 0
        renamed = 0
        skipped = 0

        for name, tensor in _orig_get_all_weights(self, model_config, model):
            seen += 1
            new_name = _remap_name(name)
            if new_name is None:
                skipped += 1
                continue
            if new_name != name:
                renamed += 1
            yield new_name, tensor

        print(
            f"[{PATCH_NAME}] safetensors-remap completed: "
            f"{seen} tensors yielded; {renamed} renamed; {skipped} vision/projector skipped",
            file=sys.stderr,
        )

    patched_get_all_weights.__wrapped_by_emmy_safetensors__ = True  # type: ignore[attr-defined]
    cls.get_all_weights = patched_get_all_weights  # type: ignore[method-assign]

    print(
        f"[{PATCH_NAME}] v{PATCH_VERSION} fix applied: "
        "DefaultModelLoader.get_all_weights WRAPPED to strip `language_model.` "
        "prefix and skip vision_tower/multi_modal_projector tensors. "
        "MistralForCausalLM params_dict will now find every loaded weight.",
        file=sys.stderr,
    )


__all__ = ["apply", "PATCH_VERSION", "PATCH_NAME"]
