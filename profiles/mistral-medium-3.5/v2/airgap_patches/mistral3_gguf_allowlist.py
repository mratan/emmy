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


PATCH_VERSION = "1.4.0"
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

    # Layer-6 follow-up: vLLM's gguf_loader has loose hasattr checks that
    # fire even when vision_config=None. Patch them too.
    apply_gguf_loader_text_only_check_fix()


def apply_gguf_loader_text_only_check_fix() -> None:
    """Patch vLLM's gguf_loader.py multimodal-detection inconsistency (layer 6+).

    Background — empirically established via container-side probes 2026-05-03
    ----------------------------------------------------------------------------
    vLLM's gguf_loader.py has THREE is_multimodal checks with INCONSISTENT logic
    AND there is no clean attribute-strip path on Mistral3Config:

      Line 119 (_get_gguf_weights_map):       hasattr AND is not None  → careful
      Line 352 (_get_gguf_weight_type):       hasattr only             → loose
      Line 383 (_get_weights_iterator):       hasattr only             → loose

    Mistral3Config declares `vision_config = None` at the CLASS level (verified:
    `'vision_config' in type(cfg).__dict__: True, type=NoneType`). Result:
      - object.__delattr__(cfg, 'vision_config') succeeds at the instance level
      - but hasattr(cfg, 'vision_config') still returns True (class-level fallback)
      - so the v1.1.x "strip + restore" pattern was a no-op for the loose checks

    Additionally, even if we could make hasattr return False at lines 352/383,
    we'd then break line 119: `auto_cls = AutoModelForCausalLM` would fire, but
    AutoModelForCausalLM REJECTS Mistral3Config as `Unrecognized configuration
    class for this kind of AutoModel: AutoModelForCausalLM` (Mistral3Config is
    only registered for Image-Text-To-Text). So is_multimodal=True at line 119
    is REQUIRED for the dummy-model param extraction to succeed.

    Strategy: keep line 119's behavior (it succeeds); REPLACE lines 352/383's
    method bodies with text-only versions that skip the multimodal mmproj
    branches entirely. This is the only path that satisfies the contradictory
    is_multimodal requirements at the three sites.

    The downstream concern — that the dummy `Mistral3ForConditionalGeneration`
    has vision_tower + multi_modal_projector params not in the bartowski GGUF —
    is gracefully handled by gguf_loader's name-translation logic at lines
    273-310: extra dummy params just yield unused entries in
    gguf_to_hf_name_map; the actual vLLM model loaded (MistralForCausalLM via
    the registry alias) only has text params; missing-key errors don't fire.
    Empirically verified by reading the gguf_loader source at lines 260-310.

    Idempotent: re-import is safe via __wrapped_by_emmy__ marker.
    """
    try:
        import vllm.model_executor.model_loader.gguf_loader as gl
    except Exception as exc:
        raise RuntimeError(
            f"[{PATCH_NAME}] cannot import vllm.model_executor.model_loader.gguf_loader "
            f"({type(exc).__name__}: {exc}); patch can only run inside the vLLM container"
        ) from exc

    if not hasattr(gl, "GGUFModelLoader"):
        raise AttributeError(
            f"[{PATCH_NAME}] vllm.model_executor.model_loader.gguf_loader.GGUFModelLoader "
            "does not exist; upstream module shape changed — patch needs revision"
        )

    # Ensure the helper symbols we copy from the original method bodies actually
    # live in the module — fail loudly if upstream restructures these names.
    for sym in ("get_gguf_weight_type_map", "gguf_quant_weights_iterator",
                "gguf_quant_weights_iterator_multi"):
        if not hasattr(gl, sym):
            raise AttributeError(
                f"[{PATCH_NAME}] vllm.model_executor.model_loader.gguf_loader.{sym} "
                "does not exist; upstream module shape changed — patch needs revision"
            )

    cls = gl.GGUFModelLoader
    if getattr(cls._get_gguf_weight_type, "__wrapped_by_emmy__", False):
        print(
            f"[{PATCH_NAME}] gguf_loader text-only override already applied; skipping",
            file=sys.stderr,
        )
        return

    # --- Replacement: text-only _get_gguf_weight_type ------------------------
    # Derived verbatim from gguf_loader.py:342-363 in vllm 0.19.2rc1.dev134,
    # with the multimodal mmproj branch ELIDED. Hard-codes is_multimodal=False
    # because (a) bartowski's mistral3 Q4_K_M GGUF is text-only, and (b) for
    # this profile the operator's intent is text-only eval (D-13).
    def _patched_weight_type(self, model_config, model_name_or_path, gguf_to_hf_name_map):
        gguf_files = self._get_all_gguf_files(model_name_or_path)
        weight_type_map = {}
        for f in gguf_files:
            weight_type_map.update(gl.get_gguf_weight_type_map(f, gguf_to_hf_name_map))
        # multimodal mmproj branch elided — text-only by intent
        return weight_type_map

    # --- Replacement: text-only _get_weights_iterator ------------------------
    # Derived verbatim from gguf_loader.py:365-403, with the multimodal mm_proj
    # branch ELIDED. Same rationale as above.
    def _patched_weights_iter(self, model_config, model_name_or_path, gguf_to_hf_name_map):
        # multimodal mm_proj branch elided — text-only by intent
        gguf_files = self._get_all_gguf_files(model_name_or_path)
        if len(gguf_files) > 1:
            yield from gl.gguf_quant_weights_iterator_multi(gguf_files, gguf_to_hf_name_map)
        else:
            yield from gl.gguf_quant_weights_iterator(model_name_or_path, gguf_to_hf_name_map)

    _patched_weight_type.__wrapped_by_emmy__ = True
    _patched_weights_iter.__wrapped_by_emmy__ = True

    cls._get_gguf_weight_type = _patched_weight_type
    cls._get_weights_iterator = _patched_weights_iter

    print(
        f"[{PATCH_NAME}] v{PATCH_VERSION} layer-6 fix applied: "
        "GGUFModelLoader._get_gguf_weight_type + _get_weights_iterator REPLACED "
        "with text-only versions (multimodal mmproj branches elided). "
        "vLLM's mistral3-as-text-only assumption now respected.",
        file=sys.stderr,
    )

    # Layer-8 follow-up: wrap _get_gguf_weights_map to remap multimodal-prefixed
    # values to text-only paths. Without this, the multimodal dummy model (used
    # for param enumeration when is_multimodal=True at line 119) yields HF param
    # names like 'model.language_model.embed_tokens.weight' which don't match
    # the actually-loaded MistralForCausalLM's 'model.embed_tokens.weight'.
    apply_gguf_loader_name_remap_fix()


def apply_gguf_loader_name_remap_fix() -> None:
    """Patch _get_gguf_weights_map to remap multimodal hf_name VALUES to text-only paths (layer 8).

    Background — empirically traced 2026-05-03 attempt #4
    -------------------------------------------------------
    The bartowski mistral3 GGUF, when loaded under the v1.2.0 patch (mmproj
    branches elided in _get_gguf_weight_type + _get_weights_iterator), reaches
    actual weight loading at gguf_loader.py:445 → mistral.py:284 → llama.py:499
    and immediately fires:

        KeyError: 'language_model.embed_tokens.qweight_type'

    Root cause: gguf_loader.py:318 stores the ORIGINAL hf_name (from the
    multimodal dummy model's state_dict, NOT the locally-transformed value):

        gguf_to_hf_name_map[gguf_name_with_suffix] = hf_name  # ORIGINAL

    The dummy model is `Mistral3ForConditionalGeneration` (from
    AutoModelForImageTextToText.from_config — picked because is_multimodal=True
    at line 119 since vision_config is a non-None PixtralVisionConfig). Its
    state_dict keys per `transformers/models/mistral3/modeling_mistral3.py`:

        Mistral3ForConditionalGeneration:
          self.model = Mistral3Model(config)        # → 'model.X'
          self.lm_head = nn.Linear(...)             # → 'lm_head.weight'
        Mistral3Model:
          self.vision_tower      = AutoModel(...)   # → 'model.vision_tower.X'
          self.multi_modal_projector = ...           # → 'model.multi_modal_projector.X'
          self.language_model    = AutoModel(...)   # → 'model.language_model.X'

    So map values look like 'model.language_model.embed_tokens.weight'. When
    AutoWeightsLoader._groupby_prefix recursively peels prefixes, it strips
    'model.' first → recurses into MistralForCausalLM's `model` child (which IS
    a MistralModel) → looks for 'language_model.embed_tokens.qweight_type' in
    MistralModel.named_parameters() → MistralModel doesn't have a
    `language_model.` prefix (text-only!) → KeyError.

    Patch strategy
    --------------
    Wrap _get_gguf_weights_map to post-process map VALUES:
      - 'model.language_model.X'      → 'model.X'   (most params)
      - 'lm_head.X'                   → 'lm_head.X' (kept as-is — sits at top level)
      - 'model.vision_tower.X'        → DROP        (text-only model has no vision)
      - 'model.multi_modal_projector.X' → DROP

    This is the canonical text-only-mistral-from-multimodal-config remap. Same
    rationale as the v1.2.0 fix (we lie about is_multimodal at line 119 to
    keep AutoModelForImageTextToText working for dummy-param extraction;
    everywhere downstream we want text-only behavior).

    Idempotent via __wrapped_by_emmy__ marker.
    """
    try:
        import vllm.model_executor.model_loader.gguf_loader as gl
    except Exception as exc:
        raise RuntimeError(
            f"[{PATCH_NAME}] cannot import vllm.model_executor.model_loader.gguf_loader "
            f"({type(exc).__name__}: {exc}); patch can only run inside the vLLM container"
        ) from exc

    if not hasattr(gl, "GGUFModelLoader"):
        raise AttributeError(
            f"[{PATCH_NAME}] GGUFModelLoader missing — upstream module shape changed"
        )

    cls = gl.GGUFModelLoader
    if getattr(cls._get_gguf_weights_map, "__wrapped_by_emmy__", False):
        print(
            f"[{PATCH_NAME}] gguf_loader name-remap fix already applied; skipping",
            file=sys.stderr,
        )
        return

    _orig_get_weights_map = cls._get_gguf_weights_map

    def _remap_text_only(hf_name: str) -> str | None:
        """Remap a multimodal-prefixed hf_name to its text-only equivalent.

        Returns None if the param should be DROPPED (vision/multimodal-projector).
        """
        # Drop vision-side params entirely
        if (
            hf_name.startswith("model.vision_tower.")
            or hf_name.startswith("model.multi_modal_projector.")
            or hf_name.startswith("vision_tower.")
            or hf_name.startswith("multi_modal_projector.")
        ):
            return None
        # Strip language_model. prefix in either nesting
        if hf_name.startswith("model.language_model."):
            return "model." + hf_name[len("model.language_model."):]
        if hf_name.startswith("language_model."):
            return "model." + hf_name[len("language_model."):]
        # Anything else (lm_head, embed_tokens, etc.) — pass through
        return hf_name

    def _patched_get_weights_map(self, model_config):
        original_map = _orig_get_weights_map(self, model_config)
        remapped = {}
        dropped_count = 0
        for gguf_name, hf_name in original_map.items():
            new_hf = _remap_text_only(hf_name)
            if new_hf is None:
                dropped_count += 1
                continue
            remapped[gguf_name] = new_hf
        # Helpful debug breadcrumb in container stderr
        print(
            f"[{PATCH_NAME}] name-remap: {len(original_map)} → {len(remapped)} "
            f"entries (dropped {dropped_count} vision/projector entries; "
            f"language_model. prefix stripped)",
            file=sys.stderr,
        )
        return remapped

    _patched_get_weights_map.__wrapped_by_emmy__ = True
    cls._get_gguf_weights_map = _patched_get_weights_map

    print(
        f"[{PATCH_NAME}] v{PATCH_VERSION} layer-8 fix applied: "
        "GGUFModelLoader._get_gguf_weights_map WRAPPED to remap multimodal "
        "hf_name values (model.language_model.X → model.X; vision dropped). "
        "Text-only MistralForCausalLM params_dict will now find every loaded weight.",
        file=sys.stderr,
    )

    # Layer-9 follow-up: vLLM's gguf-py mmap holds the full GGUF in Linux page
    # cache while vLLM ALSO copies weights to its allocated pool (double-alloc).
    # On 128 GB UMA this forces OOM for any 70+ GB GGUF.
    apply_gguf_loader_page_cache_drop_fix()


def apply_gguf_loader_page_cache_drop_fix() -> None:
    """Patch gguf_quant_weights_iterator{,_multi} to drop page cache periodically (layer 9).

    Background — empirically observed 2026-05-03 attempt #5
    -------------------------------------------------------
    With layers 1-8 cleared, the load reached 62 GiB of GGUF weight load before
    Linux OOM killer fired (`docker inspect ... .State.OOMKilled = true`).

    Memory math on the 128 GB UMA Spark:
      - vLLM pool allocation: 99.8 GiB (gmu=0.78 × 128 nominal)
      - Linux page cache for the 74 GB mmap'd GGUF: up to 74 GiB
      - System overhead (sidecar, OS, container): ~10 GiB
      - Total memory pressure: ~180+ GiB ≫ 119 GiB system → OOM

    Lowering gmu doesn't help: vLLM requires pool ≥ weights (74 GiB → gmu ≥ 0.58),
    AND KV cache at 128K (22 GiB) needs pool space too (gmu ≥ 0.75). Both
    constraints conflict with "pool + page_cache + system < 119 GiB" which forces
    gmu < 0.27. No gmu value satisfies all three.

    The ONLY exit path that preserves the 128K context: prevent the page cache
    from holding the GGUF simultaneously with vLLM's pool copy. After each
    tensor is read+copied via `torch.tensor(weight)` (which copies from
    mmap'd numpy view to a torch tensor in the pool), the source pages in
    page cache are no longer needed. `posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED)`
    hints the kernel to drop them.

    Patch strategy
    --------------
    Wrap `gguf_quant_weights_iterator` and `gguf_quant_weights_iterator_multi`
    in vllm.model_executor.model_loader.weight_utils to:
      1. Detect mistral GGUFs by filename (defense in depth — even if this
         patch artifact ends up loaded by another profile somehow, it only
         affects mistral-named files).
      2. For mistral GGUFs only: call posix_fadvise(POSIX_FADV_DONTNEED)
         every N=50 yielded tensors during load, plus a final drop after
         the iterator exhausts.
      3. Patch BOTH `weight_utils.X` (the source module) AND `gguf_loader.X`
         (the symbol vLLM imported into its namespace at module load time)
         so the v1.2.0 _patched_weights_iter's call to
         `gl.gguf_quant_weights_iterator` picks up the wrapper.

    Risk: posix_fadvise is advisory — kernel may ignore for short-lived files
    or under memory pressure. Best-effort fix; if it fails, container OOMs the
    same way and we know the hardware ceiling is real.

    Idempotent via __wrapped_by_emmy__ marker.
    """
    import os
    try:
        import vllm.model_executor.model_loader.weight_utils as wu
        import vllm.model_executor.model_loader.gguf_loader as gl
    except Exception as exc:
        raise RuntimeError(
            f"[{PATCH_NAME}] cannot import vllm.model_executor.model_loader weight_utils + gguf_loader "
            f"({type(exc).__name__}: {exc})"
        ) from exc

    for sym in ("gguf_quant_weights_iterator", "gguf_quant_weights_iterator_multi"):
        if not hasattr(wu, sym):
            raise AttributeError(
                f"[{PATCH_NAME}] weight_utils.{sym} missing — upstream module shape changed"
            )

    if getattr(wu.gguf_quant_weights_iterator, "__wrapped_by_emmy__", False):
        print(
            f"[{PATCH_NAME}] page-cache drop fix already applied; skipping",
            file=sys.stderr,
        )
        return

    _orig_iter = wu.gguf_quant_weights_iterator
    _orig_iter_multi = wu.gguf_quant_weights_iterator_multi

    DROP_EVERY_N_TENSORS = 50

    def _is_mistral_gguf(file_path):
        """Mistral-only safety scope. Defense in depth even though
        EMMY_AIRGAP_PATCH_MISTRAL3 should already gate this whole module."""
        basename = os.path.basename(str(file_path)).lower()
        return ("mistral" in basename) or ("ministral" in basename)

    def _drop_page_cache(file_path):
        """Best-effort posix_fadvise(POSIX_FADV_DONTNEED) on the file."""
        try:
            fd = os.open(str(file_path), os.O_RDONLY)
            try:
                # POSIX_FADV_DONTNEED = 4 on Linux. os.posix_fadvise exists on
                # Python 3.3+ on POSIX systems; container is python 3.12 Linux.
                os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            finally:
                os.close(fd)
        except Exception:
            # Best-effort: never let a page-cache-drop failure mask the load
            pass

    def _patched_iter(gguf_file, gguf_to_hf_name_map):
        # Mistral-only scoping: pass-through for any other GGUF
        if not _is_mistral_gguf(gguf_file):
            yield from _orig_iter(gguf_file, gguf_to_hf_name_map)
            return

        count = 0
        for name, tensor in _orig_iter(gguf_file, gguf_to_hf_name_map):
            yield name, tensor
            count += 1
            if count % DROP_EVERY_N_TENSORS == 0:
                _drop_page_cache(gguf_file)
        # Final drop after exhausting iterator
        _drop_page_cache(gguf_file)
        print(
            f"[{PATCH_NAME}] page-cache drop completed for {os.path.basename(str(gguf_file))} "
            f"({count} tensors yielded; {count // DROP_EVERY_N_TENSORS + 1} fadvise calls)",
            file=sys.stderr,
        )

    def _patched_iter_multi(gguf_files, gguf_to_hf_name_map):
        if not any(_is_mistral_gguf(f) for f in gguf_files):
            yield from _orig_iter_multi(gguf_files, gguf_to_hf_name_map)
            return

        count = 0
        for name, tensor in _orig_iter_multi(gguf_files, gguf_to_hf_name_map):
            yield name, tensor
            count += 1
            if count % DROP_EVERY_N_TENSORS == 0:
                for f in gguf_files:
                    _drop_page_cache(f)
        for f in gguf_files:
            _drop_page_cache(f)
        print(
            f"[{PATCH_NAME}] page-cache drop completed for multi-shard mistral GGUF "
            f"({count} tensors yielded; {count // DROP_EVERY_N_TENSORS + 1} fadvise rounds)",
            file=sys.stderr,
        )

    _patched_iter.__wrapped_by_emmy__ = True
    _patched_iter_multi.__wrapped_by_emmy__ = True

    # Patch the source module
    wu.gguf_quant_weights_iterator = _patched_iter
    wu.gguf_quant_weights_iterator_multi = _patched_iter_multi
    # AND patch the gguf_loader's namespace, since it imported the symbols
    # by name at module load time (Python imports bind at module-load).
    gl.gguf_quant_weights_iterator = _patched_iter
    gl.gguf_quant_weights_iterator_multi = _patched_iter_multi

    print(
        f"[{PATCH_NAME}] v{PATCH_VERSION} layer-9 fix applied: "
        "gguf_quant_weights_iterator{{,_multi}} WRAPPED to call "
        "posix_fadvise(POSIX_FADV_DONTNEED) every {N} tensors during load (mistral-only). "
        "Should prevent page-cache + pool double-allocation OOM on 128 GB UMA.".format(
            N=DROP_EVERY_N_TENSORS
        ),
        file=sys.stderr,
    )


__all__ = [
    "apply",
    "apply_gguf_loader_text_only_check_fix",
    "apply_gguf_loader_name_remap_fix",
    "apply_gguf_loader_page_cache_drop_fix",
    "PATCH_VERSION",
    "PATCH_NAME",
]
