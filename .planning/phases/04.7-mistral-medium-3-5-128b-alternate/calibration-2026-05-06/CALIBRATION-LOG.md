# Mistral Medium 3.5 128B — calibration log, 2026-05-06

## Context

This log records experiments E1-E6 from the 2026-05-06 session that diagnosed v2.1's boot-OOM, fixed it (v2.6 now ships), and explored unsuccessful RAM-saving paths. Three intermediate profiles (v2.7, v2.8, v2.9) were cut as falsifiable experiments and **deleted after the session** because they were either falsified or marginal-improvement-not-worth-shipping.

**Future profile cuts should skip directly to v2.10 or higher.** The version numbers v2.7, v2.8, v2.9 were burned by these experiments — re-using them would create audit confusion against this log + git history.

## Currently shipped

- **`profiles/mistral-medium-3.5/v2.6/`** — runai_streamer + memory_limit=4 GiB + enforce_eager + gmu=0.84 + fp8 KV. Hash `sha256:46c2781f…`. Boots reliably with peak ec_rss=5.5 GiB (88% reduction from v2.1's 43 GB). V-protocol 2026-05-06: V1 20/20 strict, 16/20 substantive, 0/20 SP_OK_ONLY (validates v2.1 SP_OK fix), 1/20 ctx_overflow (validates grep tool fix). Needle-in-haystack 9/9 at 16K/65K/122K × 0.10/0.50/0.90.

## Falsified / deleted experiments

### v2.7 — stripped checkpoint + turboquant_4bit_nc (int4 KV)

- **Hypothesis**: int4 KV saves ~11 GiB of GPU pool; combined with vision-strip would give meaningful host-RAM headroom
- **Result**: FALSIFIED. Engine OOM-killed at 65K context input. Specifically `torch.OutOfMemoryError` in `vllm/model_executor/layers/activation.py:146` allocating a 448 MiB activation tensor; process had 107.84 GiB in use, 914 MiB free
- **Root cause**: vllm-project/vllm#40420 — TurboQuant `_continuation_prefill` allocates an FP32-widened scratch tensor of `cached_len × Hk × D × 4 bytes` for the inverse-Hadamard rotation on K. Per-call scratch scales with seq_len at 4× the bytes-per-element of activations. KV pool is smaller in steady state but activation buffers exceed the freed budget at long context.
- **Needle**: 3/9 retrieved (16K passed; 65K and 122K crashed)
- **Hash at deletion**: `sha256:e27b7a0a…` (or near-equivalent post-pycache regeneration)

### v2.8 — stripped checkpoint + fp8 KV (intended ship candidate)

- **Hypothesis**: physical strip of vision_tower + multi_modal_projector tensors saves ~5 GB disk + ~1-3 GB CPU buffer transient at boot
- **Result**: MARGINALLY TRUE but operationally indistinguishable from v2.6. Boot peak ec_rss capped at 5.5 GiB regardless (loader buffer cap is set by `memory_limit=4 GiB`, NOT by strip). Steady-state RAM byte-identical to v2.6. Disk usage actually increases system-wide because the raw checkpoint stays for audit + the stripped overlay adds 25 GB. The strip introduces a derived-artifact maintenance burden (RecViking-update sync) for negligible operational benefit.
- **Hash at deletion**: `sha256:dd9d79d5…`
- **Verdict**: Not worth the complexity. v2.6 is upstream-pure with a runtime patch (`mistral3_runai_streamer_remap`) that already filters vision tensors at load — same outcome, simpler stack.

### v2.9 — stripped + turboquant_k8v4 (FP8 keys + int4 values) + gmu=0.78

- **Hypothesis**: k8v4 avoids the t4nc K-side inverse-Hadamard codepath that blew up v2.7; combined with lowered gmu=0.78 should free ~7 GiB host RAM while preserving 128K context
- **Result**: PARTIALLY CONFIRMED. RAM headroom DID drop to 9.5 GiB (vs v2.6's 2.3 GiB) — exactly the predicted ~7 GiB win. Quality at 16K and 65K context was perfect (6/6 retrieved). BUT: at 122K context, identical OOM signature to v2.7 — `448 MiB allocation request, 107.82 GiB in use, 817 MiB free`. k8v4 pushes the threshold higher than t4nc but still below 128K.
- **Conclusion**: int4 KV (any TurboQuant variant) is structurally not viable for our 128K target on this stack. fp8 is the only robust KV format on cu130-nightly + Mistral 128B + DGX Spark.
- **Side finding**: at ≤65K context, v2.9-style config (k8v4 + gmu=0.78) IS viable AND gives the predicted RAM savings. A future short-context-only profile (e.g., `v2.10` with max_model_len=65536) could ship if there's a use case.
- **Hash at deletion**: `sha256:24c73dc1…`

## Tools left in the tree (intentionally — reusable)

- `scripts/strip_mistral_vision.py` — re-pack any safetensors checkpoint to drop arbitrary tensor-name prefixes. Used by v2.8/v2.9 experiments.
- `scripts/needle_in_haystack.py` — generic 128K context retrieval test, deterministic, model-agnostic. Used to compare KV-quant variants. Re-runnable anytime.
- `scripts/boot-monitor.sh` — 5-second-sample memory monitor (anon-rss, swap, buff/cache, GPU pool, mem_avail). Used during E1-E3.
- `scripts/v-matrix-runner-parametric.sh` — already shipped; ran v-protocol on v2.6.
- `runs/needle/{v2.6-fp8,v2.7-int4,v2.9-k8v4}.jsonl` — preserved per-query data for future analysis.
- `runs/boot-experiments/{v2.3-e1,v2.5-e3,v2.6-e3b,v2.4-e2}/` — preserved boot-monitor TSVs.

## Schema additions (kept — strictly additive)

These were added to `emmy_serve/profile/schema.py` during the session and are kept because they're useful for future profile work:

- `EngineConfig.safetensors_load_strategy` — `Optional[Literal["lazy","eager","prefetch","torchao"]]`. v2.2 attempt (falsified). Not used by v2.6.
- `EngineConfig.enforce_eager` — `Optional[bool]`. Used by v2.6.
- `EngineConfig.model_loader_extra_config` — `Optional[str]`. Used by v2.6 (memory_limit JSON).
- `EngineConfig.load_format` Literal extended with `"runai_streamer"` + `"instanttensor"`. Used by v2.6.
- `EngineConfig.kv_cache_dtype` Literal extended with `fp8_e4m3`, `fp8_e5m2`, `nvfp4`, `turboquant_3bit_nc`, `turboquant_4bit_nc`, `turboquant_k3v4_nc`, `turboquant_k8v4`. Not used by v2.6 (still fp8) but available for future experiments.
- `EnvVars` extended with `PYTORCH_CUDA_ALLOC_CONF`, `MALLOC_ARENA_MAX`, `MALLOC_TRIM_THRESHOLD_`, `OMP_NUM_THREADS`. Used by v2.6.

## Airgap patches (kept — actively used by v2.6)

- `profiles/mistral-medium-3.5/v2.6/airgap_patches/mistral3_runai_streamer_remap.py` — wraps `RunaiModelStreamerLoader._get_weights_iterator` to strip the `language_model.` prefix and skip vision tensors. Without this v2.6 KeyError's at boot.
- `profiles/mistral-medium-3.5/v2.6/airgap_patches/mistral3_safetensors_remap.py` — same pattern for `DefaultModelLoader.get_all_weights`. Dormant when load_format=runai_streamer, but kept defensive.
- `profiles/mistral-medium-3.5/v2.6/airgap_patches/mistral3_gguf_allowlist.py` — v1 carryover. No-op for safetensors path. Kept for legacy.

## Known unfixed issues

1. **Sidecar smoke_test rolls back Mistral cold-start boots** — `scripts/smoke_test.py` uses `chat/completions` for SP_OK canaries; MistralTokenizer's `validate_request_params` raises `ValueError("chat_template is not supported for Mistral tokenizers.")`. Workaround: bring Mistral up via direct `docker run` instead of sidecar `/start`. Permanent fix: smoke_test.py should detect Mistral tokenizer and skip the chat-template canary path. Logged for Phase 5 calibration.

2. **`__pycache__` is included in profile bundle hash** — first boot generates `.pyc` files in `airgap_patches/__pycache__/`, changing the bundle bytes. Subsequent preflights mismatch. Workaround: clean pycache before recomputing hash. Permanent fix: add `__pycache__` to `EXCLUDE_NAMES` in `emmy_serve/profile/hasher.py`.

## Future seeds

- **v2.10 candidate**: stripped + k8v4 + gmu=0.78 + `max_model_len=65536`. Would deliberately give up 128K context for ~7 GiB host RAM headroom. Useful if you have a workload that doesn't need long context. Re-uses the strip + k8v4 from this session (still on disk at `/data/models/Mistral-Medium-3.5-128B-NVFP4-stripped/`).
- **vision-mode sibling**: `v2.6-vision` (or `v3.0`) cut against the upstream multimodal arch with vision tensors loaded. Not currently planned — Emmy is coding-only.
- **smoke_test.py Mistral fix**: file as Phase 5 calibration item.
