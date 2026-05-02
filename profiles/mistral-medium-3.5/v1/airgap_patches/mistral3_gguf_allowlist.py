"""Hot-patch transformers' GGUF architecture allowlist to register `mistral3`.

Background
==========
Plan 04.7-02 boot smoke (2026-05-02) hit T-01 in its strongest form: vLLM's
GGUF backend (transformers 5.6.0 inside the
`vllm/vllm-openai:cu130-nightly-aarch64` image, sha256:ffa30d66ff5c…) refuses
to parse Mistral Medium 3.5's bartowski Q4_K_M GGUF because the architecture
string `mistral3` is not on transformers' GGUF allowlist:

    File "transformers/modeling_gguf_pytorch_utils.py", line 78
        raise ValueError(f"GGUF model with architecture {architecture} is not supported yet.")
    ValueError: GGUF model with architecture mistral3 is not supported yet.

The allowlist lives in three module-level data structures:

    transformers.modeling_gguf_pytorch_utils.GGUF_SUPPORTED_ARCHITECTURES   # list[str]
    transformers.modeling_gguf_pytorch_utils.GGUF_CONFIG_MAPPING             # dict[str, dict[str, str]]
    transformers.modeling_gguf_pytorch_utils.GGUF_TO_TRANSFORMERS_MAPPING['config']  # IS GGUF_CONFIG_MAPPING (same object)

Empirical decision space (probed in Plan 04.7-02 follow-up wave, 2026-05-02)
---------------------------------------------------------------------------
- The bartowski GGUF declares `general.architecture = mistral3` and uses
  `mistral3.context_length`, `mistral3.attention.head_count`, etc. — i.e. the
  metadata key SUFFIXES are byte-identical to what `mistral` uses in
  `GGUF_CONFIG_MAPPING['mistral']`. The architecture rename is purely an
  upstream-naming churn between Mistral 2.x (mistral) and Mistral 3.x (mistral3).
- transformers 5.6.0 already ships `Mistral3Config` registered for
  `model_type='mistral3'` via `AutoConfig.for_model('mistral3')`. The GGUF
  allowlist gap is a separate, narrower lag — `Mistral3Config` exists, the
  GGUF metadata-to-HF-config bridge just needs the alias entry.
- vLLM 0.19.2rc1.dev134 ships `Mistral3ForConditionalGeneration` (multimodal)
  but NOT a `Mistral3ForCausalLM` text-only class. The bartowski GGUF is
  text-only (795 tensors, no vision_tower). Whether vLLM's GGUFModelLoader
  tolerates the multimodal-vs-text-only mismatch is the second-order question
  this patch does NOT answer; if a downstream ValueError fires post-allowlist,
  that's the empirically-discovered NEXT blocker (operator decision menu
  refines accordingly — see SUMMARY.md "Option 5 sitecustomize hot-patch
  iteration").

Patch strategy
==============
Add `mistral3` to the allowlist AND alias `GGUF_CONFIG_MAPPING['mistral3']` to
`GGUF_CONFIG_MAPPING['mistral']` (the suffixes are byte-identical, so the same
mapping rules work). `GGUF_TO_TRANSFORMERS_MAPPING['config']` IS the same dict
object as `GGUF_CONFIG_MAPPING` (verified at runtime), so adding the key
auto-propagates through the `_to_transformers` rename loop in
`load_gguf_checkpoint` (lines 95-119).

This mimics the existing in-tree `qwen2moe → qwen2_moe` / `gpt_oss → gpt-oss`
/ `minimax-m2 → minimax_m2` aliasing patterns at lines 57-64 of
`modeling_gguf_pytorch_utils.py` — the patch is shape-equivalent, just applied
externally instead of upstream.

Idempotent: re-import is safe (set membership is checked before append; dict
key existence is checked before assignment). Defensive: if the upstream
module structure changes, raises a clear AttributeError instead of silently
no-op'ing.

Removal criteria
================
Remove this file (and the airgap_patches block from serving.yaml) when
EITHER:
  - transformers ships native `mistral3` GGUF allowlist support upstream, OR
  - we cut a v2 of this profile that uses a different serving path (e.g.
    NVFP4, llama.cpp).

Until then, this patch is the v1 ship-state. The ABSENCE of this file in
the airgap_patches dir would silently re-block T-01 — the boot runner
relies on the bind-mount being populated.
"""
from __future__ import annotations

import sys


PATCH_VERSION = "1.0.0"
PATCH_NAME = "mistral3_gguf_allowlist"


def apply() -> None:
    """Register `mistral3` as a GGUF-supported architecture (alias of `mistral`).

    Idempotent. Logs a one-line confirmation to stderr so the vLLM container
    log carries the audit trail (no separate JSONL — the docker logs ARE the
    audit surface for boot-time patches).
    """
    try:
        import transformers.modeling_gguf_pytorch_utils as gguf_utils
    except Exception as exc:
        raise RuntimeError(
            f"[{PATCH_NAME}] cannot import transformers.modeling_gguf_pytorch_utils "
            f"({type(exc).__name__}: {exc}); patch can only run inside the vLLM "
            "container after transformers is installed"
        ) from exc

    # --- Sanity-check the upstream module shape -------------------------------
    for attr in ("GGUF_SUPPORTED_ARCHITECTURES", "GGUF_CONFIG_MAPPING"):
        if not hasattr(gguf_utils, attr):
            raise AttributeError(
                f"[{PATCH_NAME}] transformers.modeling_gguf_pytorch_utils.{attr} "
                "does not exist; upstream module shape changed — patch needs revision"
            )

    if "mistral" not in gguf_utils.GGUF_CONFIG_MAPPING:
        raise KeyError(
            f"[{PATCH_NAME}] GGUF_CONFIG_MAPPING['mistral'] does not exist; "
            "cannot alias mistral3 → mistral. Patch needs revision."
        )

    arch_list = gguf_utils.GGUF_SUPPORTED_ARCHITECTURES
    cfg_map = gguf_utils.GGUF_CONFIG_MAPPING

    if "mistral3" in arch_list and cfg_map.get("mistral3") is cfg_map.get("mistral"):
        # Idempotent: already applied
        print(
            f"[{PATCH_NAME}] already applied (mistral3 in allowlist + cfg_map alias); skipping",
            file=sys.stderr,
        )
        return

    # --- Apply allowlist registration -----------------------------------------
    if "mistral3" not in arch_list:
        arch_list.append("mistral3")

    # Alias the config mapping (same dict reference as GGUF_TO_TRANSFORMERS_MAPPING['config'])
    cfg_map["mistral3"] = cfg_map["mistral"]

    print(
        f"[{PATCH_NAME}] v{PATCH_VERSION} applied: "
        "mistral3 → GGUF allowlist + cfg_map alias of mistral. "
        "transformers.load_gguf_checkpoint should now parse Mistral 3.x GGUFs.",
        file=sys.stderr,
    )


__all__ = ["apply", "PATCH_VERSION", "PATCH_NAME"]
