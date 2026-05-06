# profiles/mistral-medium-3.5/v1/airgap_patches/

Profile-scoped, ships-with-bundle Python hot-patches mounted into the vLLM
container at `/airgap_patches/` and prepended to `PYTHONPATH`. Loaded via
Python's `sitecustomize` mechanism (auto-imported at process start, before
any user code).

This directory exists ONLY because Plan 04.7-02 boot smoke (2026-05-02) hit
T-01 in its strongest form — vLLM's GGUF backend (transformers 5.6.0 inside
the `cu130-nightly-aarch64` container) does not allowlist Mistral Medium
3.5's `mistral3` architecture string. Operator chose Decision Option 5
("Hot-patch transformers `GGUF_SUPPORTED_ARCHITECTURES`") from the refined
6-path menu in PROFILE_NOTES.md "Workaround A empirical results".

## Files

- `sitecustomize.py` — auto-imported entry point. Defers to per-patch
  modules; each is gated by an env variable (default OFF) so the file is
  safe to ship in the source tree.
- `mistral3_gguf_allowlist.py` — the actual patch. Adds `mistral3` to
  `transformers.modeling_gguf_pytorch_utils.GGUF_SUPPORTED_ARCHITECTURES`
  AND aliases `GGUF_CONFIG_MAPPING['mistral3'] = GGUF_CONFIG_MAPPING['mistral']`
  (the GGUF metadata key suffixes are byte-identical between the two
  arches). Mimics the existing in-tree `qwen2moe→qwen2_moe` /
  `gpt-oss→gpt_oss` aliasing pattern at lines 57-64 of
  `transformers/modeling_gguf_pytorch_utils.py`.

## How the patch is wired

1. `serving.yaml` carries `engine.airgap_patch_dir: airgap_patches` (the
   path is profile-bundle-relative; the boot runner resolves it to the
   container-internal `/airgap_patches/` mount path).
2. `emmy_serve/profile/schema.py` exposes the field as
   `EngineConfig.airgap_patch_dir: Optional[str] = None` (strictly
   additive — every other profile validates with the field unset).
3. `emmy_serve/boot/runner.py:render_docker_only_args` (when the field is
   set) emits:
     - bind-mount: `-v <bundle>/<airgap_patch_dir>:/airgap_patches:ro`
     - env: `-e PYTHONPATH=/airgap_patches`
     - env: `-e EMMY_AIRGAP_PATCH_MISTRAL3=on` (per-patch opt-in flag,
       so other profiles that share PYTHONPATH for unrelated reasons
       don't accidentally enable this patch)
4. Container starts. Python imports `sitecustomize` from
   `/airgap_patches/sitecustomize.py`, sees the env opt-in, calls
   `mistral3_gguf_allowlist.apply()`, registers the alias.
5. vLLM proceeds with engine startup. transformers'
   `load_gguf_checkpoint` now accepts `general.architecture=mistral3`
   from the bartowski GGUF.

## Why this lives in the profile bundle, not in the source tree

The patch is a model-shaped workaround for a transient upstream gap. Per
CLAUDE.md "Anti-pattern: model-shaped logic in code (e.g. `if 'qwen' in
name: use_hermes_parser`). All such logic lives in the profile."

The schema/runner extension (`airgap_patch_dir` field + bind-mount
emission) IS in the source tree — that's the **mechanism**. The
**policy** of which patches to apply, which env opt-ins to set, and what
arch strings to alias lives in this directory, scoped to one profile
version.

## Removal criteria

Remove this directory + the `airgap_patch_dir` line from serving.yaml +
the `EMMY_AIRGAP_PATCH_MISTRAL3` env when EITHER:

- transformers ships native `mistral3` GGUF allowlist support upstream
  (track: filed as `<TBD upstream issue>` once the boot smoke verifies
  the patch is the load-bearing fix), OR
- v2 of this profile cuts to a different serving path (NVFP4, llama.cpp).

Either path is a v2 cut (behavioral change), not an in-place edit. v1
preserves the patch as the empirical evidence trail.

## Invariants

- Idempotent: re-applying the patch is a no-op (set membership + dict
  identity check).
- Defensive: if the upstream module shape changes (no
  `GGUF_SUPPORTED_ARCHITECTURES` attr, etc.), raises a clear AttributeError
  instead of silently no-op'ing.
- Opt-in by env: `EMMY_AIRGAP_PATCH_MISTRAL3` MUST be set (the boot
  runner sets it; manual Python sessions importing this dir for
  unrelated reasons will NOT trigger the patch).
- Air-gap preserved: the patch monkey-patches in-process; no network
  access, no file writes outside the container's ephemeral state.
- D-12 air-gap CI invariant: the runtime env still has `HF_HUB_OFFLINE=1`
  and `TRANSFORMERS_OFFLINE=1` set; the patch does NOT change egress
  posture.

## Provenance

Authored 2026-05-02 during Plan 04.7-02 follow-up wave 3 ("sitecustomize
hot-patch iteration") after the operator selected Decision Option 5 from
the refined 6-path menu. See PROFILE_NOTES.md "Option 5 sitecustomize
hot-patch iteration (2026-05-02)" for full provenance.
