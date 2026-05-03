# Plan 04.7-02 — Deferred items (out-of-scope discoveries)

## 2026-05-02 — pytest environment skips schema/runner tests in worktree

**Discovered during:** Plan 04.7-02 Task 1 verification.

**Symptom:** Running `uv run pytest tests/unit/test_profile_bundle_mistral.py
tests/unit/test_profile_schema_gguf.py tests/unit/test_docker_run_build.py`
inside the worktree results in `pytest.importorskip` skipping all three test
files because pytest imports the user-site `pydantic_core` (in
`/home/mratanap/.local/lib/python3.12/site-packages/`) which lacks
`validate_core_schema` (a name the venv's pydantic uses).

The same `emmy_serve.profile.schema` import works perfectly via `uv run emmy
profile validate` (exits 0; ServingConfig pydantic model loads cleanly). The
issue is purely pytest's import resolution order picking the user-site
pydantic_core ahead of the venv's.

**Why out of scope for this plan:**
- Pre-existing — Plan 04.7-01 SUMMARY claims "342 passed" so the test infra
  works in *some* environment (likely the original Spark non-worktree clone,
  pre-user-site pollution).
- Not caused by this plan's edits — the test files themselves are
  Plan 04.7-01 artifacts; no changes to them in 04.7-02.
- Functional equivalent verification path is intact: `uv run emmy profile
  validate profiles/mistral-medium-3.5/v1` exits 0 (the schema invariant the
  unit tests assert is verified end-to-end).

**Suggested fix (for a future cleanup plan):**
- Add `PYTHONNOUSERSITE=1` to the project's pytest invocation, OR
- Pin `pytest` + plugins inside `[dependency-groups.dev]` of pyproject.toml so
  `uv run pytest` always uses the venv's pytest (currently `which pytest`
  resolves to a system path).
- Alternatively, replace `pytest.importorskip("emmy_serve.profile.schema")`
  with a direct `import` so the failure is loud and points at the real cause.

## 2026-05-02 (Wave 2) — vLLM `get_model_path` doesn't recognize `repo:quant` model format under HF_HUB_OFFLINE=1

**Discovered during:** Plan 04.7-02 Wave 2 boot-smoke attempt 3
(run_id `20260502T231011Z-e07024`).

**Symptom:** When `engine.model` is set to vLLM's `<repo_id>:<quant_type>`
GGUF reference shape (e.g. `bartowski/mistralai_Mistral-Medium-3.5-128B-GGUF:Q4_K_M`)
AND `HF_HUB_OFFLINE=1` is set, vLLM crashes at engine arg parsing with:

```
HFValidationError: Repo id must use alphanumeric chars, '-', '_' or '.'.
The name cannot start or end with '-' or '.' and the maximum length is 96:
'bartowski/mistralai_Mistral-Medium-3.5-128B-GGUF:Q4_K_M'.
```

at `vllm/transformers_utils/repo_utils.py:220` inside `get_model_path` →
`huggingface_hub.snapshot_download(repo_id=model)`.

**Why this is a real upstream bug:** vLLM's `GGUFModelLoader._prepare_weights`
(model_loader/gguf_loader.py:60-67) handles the `repo:quant` format
correctly. But the offline-mode short-circuit in
`AsyncEngineArgs.__post_init__` (engine/arg_utils.py:687-694) calls
`get_model_path(self.model)` for ALL models when HF_HUB_OFFLINE=1, and
`get_model_path` doesn't strip the `:quant` suffix or skip the call for
GGUF references — it just naively passes the string to
`snapshot_download(repo_id=...)`.

**Why out of scope for Plan 04.7-02:**
- Not caused by emmy code; pure upstream vLLM bug in nightly
  `0.19.2rc1.dev134+gfe9c3d6c5`.
- Needs vLLM patch — either teach `get_model_path` to recognize `repo:quant`
  (early-return for `is_remote_gguf`-shaped strings), or skip the offline
  short-circuit for GGUF references.
- Mistigates the ability to use Workaround A's repo:quant variant (the
  cleaner of the two designed bypasses for T-01); leaves only the
  hf_config_path-only variant which doesn't bypass T-01 anyway.

**Suggested fix (upstream PR territory):**
- vLLM PR: in `repo_utils.get_model_path`, before the
  `snapshot_download(repo_id=...)` call, check `is_remote_gguf(model)`
  and if so split with `split_remote_gguf` and use only the `repo_id`
  part for the snapshot lookup (then re-attach the `:quant` suffix
  for downstream consumers if needed).
- Emmy-side workaround possibility: a sitecustomize.py that monkey-patches
  `get_model_path` at container start (operationally feasible but
  invasive; documented as Option 5 in the SUMMARY's refined operator
  decision menu).

## 2026-05-02 (Wave 2) — `hf_config_path` does not bypass `maybe_override_with_speculators` GGUF parsing for local-file model paths

**Discovered during:** Plan 04.7-02 Wave 2 boot-smoke attempt 4
(run_id `20260502T231409Z-8f35fc`).

**Symptom:** When `engine.model` is a local `.gguf` file path
(e.g. `/models/Mistral-Medium-3.5-128B-Q4_K_M.gguf`) and
`engine.hf_config_path` points at a directory containing config.json,
vLLM STILL crashes during `create_engine_config` at the speculators
check, BEFORE the `hf_config_path` field is consulted by `get_config()`:

```
File "vllm/engine/arg_utils.py", line 1590, in create_engine_config
    maybe_override_with_speculators(...)
File "vllm/transformers_utils/config.py", line 596, in maybe_override_with_speculators
    config_dict, _ = PretrainedConfig.get_config_dict(...)
File "transformers/configuration_utils.py", line 759, in _get_config_dict
    config_dict = load_gguf_checkpoint(resolved_config_file, return_tensors=False)["config"]
File "transformers/modeling_gguf_pytorch_utils.py", line 648
    raise ValueError("GGUF model with architecture mistral3 is not supported yet.")
```

**Why this is a vLLM API gap, not a bug:** the `hf_config_path` field is
documented to override `model:` for `get_config()` (config.py:497 +
config.py:1379) — and it does. But it does NOT propagate to
`maybe_override_with_speculators` (config.py:587-591), which calls
`PretrainedConfig.get_config_dict` directly with the original `model`
path. There's no existing way to tell the speculators check "this model
has an external config — don't try to parse the GGUF for the speculators
field check."

**Why out of scope for Plan 04.7-02:**
- Plan 04.7-02 Wave 2's job is to attempt Workaround A and document
  results; with both variants empirically blocked, the next step is
  operator decision (refined 6-path menu in SUMMARY.md), not further
  schema/runtime extensions.
- A schema-side fix would mean: add a `skip_speculators_check` field to
  EngineConfig + monkey-patch `maybe_override_with_speculators` to honor
  it. Operator-policy territory.

**Suggested fix (upstream PR territory):**
- vLLM PR: in `maybe_override_with_speculators`, accept an optional
  `hf_config_path` kwarg and use it (when set) to get config_dict
  instead of calling `PretrainedConfig.get_config_dict(model, gguf_file=...)`.
  This would make `hf_config_path` a complete bypass for local-file GGUF
  model paths whose architecture isn't in transformers'
  `GGUF_SUPPORTED_ARCHITECTURES`.

## 2026-05-02 (Wave 3 / Option 5 sitecustomize) — vLLM `mistral` parser path requires `MistralTokenizer` (not HF tokenizer)

**Discovered during:** Plan 04.7-02 Wave 3 boot-smoke attempt 7
(run_id `20260502T234222Z-e848d9`).

**Symptom:** After the sitecustomize hot-patch cleared T-01 AND the
tokenizer/dtype Rule 3 auto-fixes cleared two more downstream errors,
vLLM proceeded into deep engine-init code (kv_cache configured,
asynchronous scheduling enabled, IR op priority configured) and then
failed at the FINAL VllmConfig validation:

```
pydantic_core.ValidationError: 1 validation error for VllmConfig
  Value error, The tokenizer must be an instance of MistralTokenizer.
```

**Why this is a real architectural requirement:** vLLM's `mistral`
tool_call_parser (CONTEXT D-09 LOCKED) routes through a chat-template
implementation that requires `mistral_common.MistralTokenizer` — the
Mistral-format tokenizer typically loaded from `tekken.json` via
`--tokenizer-mode mistral`. The operator-staged dir at
`/data/models/Mistral-Medium-3.5-128B-config/` (set up during Wave 2 for
Workaround A) contains only HF-format `tokenizer.json` +
`tokenizer_config.json`. No `tekken.json`. No `params.json` that
mistral-common could consume.

**Why out of scope for Plan 04.7-02 Wave 3:**
- Auto-fix would require:
  1. Operator re-staging — `huggingface-cli download
     mistralai/Mistral-Medium-3.5-128B --include "tekken.json"` (or
     equivalent) to add the file to the operator-staged dir, AND
  2. Schema extension — `EngineConfig.tokenizer_mode:
     Optional[Literal["auto", "mistral", ...]] = None`, AND
  3. Runner extension — emit `--tokenizer-mode <value>` when set, AND
  4. Profile bundle update — add `tokenizer_mode: mistral`
- Each step is small but the FIRST step is operator-staging territory
  (needs HF auth + gated-repo T&C acceptance + verification that the
  file exists in the gated repo), so it's not unilateral executor work.
- Even after auto-fix, the loaded model is still
  `Mistral3ForConditionalGeneration` (multimodal); the bartowski GGUF
  is text-only (795 tensors, no vision_tower); a fourth error class
  around missing vision_tower weights MAY surface next. Pre-validation
  would need another container exec.

**Suggested fix:** documented as "Decision Option 7" (NEW) in the
refined 7-path operator decision menu — see SUMMARY.md "Option 5
sitecustomize hot-patch iteration (2026-05-02)" + PROFILE_NOTES.md
"Option 5 sitecustomize hot-patch iteration (2026-05-02)" §"Refined
operator decision menu (now 7 paths, was 6)".

## 2026-05-02 (Wave 3 / Option 5 sitecustomize) — vLLM GGUF backend rejects bfloat16 (now auto-fixed; tracking for upstream awareness)

**Discovered during:** Plan 04.7-02 Wave 3 boot-smoke attempt 6
(run_id `20260502T234040Z-5af3fe`). **Status: AUTO-FIXED in commit
`35aee85` via new `EngineConfig.dtype` schema field + `--dtype float16`
in profile bundle.** Tracking here as deferred upstream-awareness item.

**Symptom:**
```
pydantic_core.ValidationError: 1 validation error for VllmConfig
  Value error, torch.bfloat16 is not supported for quantization method gguf.
  Supported dtypes: [torch.float16, torch.float32]
```

Plus warning at `vllm/model_executor/layers/quantization/gguf.py:69`:
```
GGUF has precision issues with bfloat16 on Blackwell.
```

**Root cause:** Mistral 3.x's source `config.json` declares `"dtype":
"bfloat16"`. vLLM auto-detects this from the config and propagates to
VllmConfig validation. The GGUF backend's allowlist of supported
dtypes is `{torch.float16, torch.float32}` only — bfloat16 is rejected
hard.

**Auto-fix applied (Plan 04.7-02 commit 35aee85):**
- Added `EngineConfig.dtype: Optional[Literal["auto", "float16",
  "bfloat16", "float32"]] = None` schema field (strictly additive).
- `render_vllm_cli_args` emits `--dtype <value>` when set.
- `engine.dtype: float16` in `profiles/mistral-medium-3.5/v1/serving.yaml`.

**Why still listed here:** this is upstream awareness — vLLM's GGUF
backend's bf16 rejection is a known kernel limitation; the upstream
warning at gguf.py:69 ("GGUF has precision issues with bfloat16 on
Blackwell") suggests this is a Blackwell-specific GPU constraint, not
an arbitrary check. If a future vLLM release fixes the Blackwell GGUF
bf16 path, the `dtype: float16` override could be dropped and the
profile would auto-detect bf16 from config (matching the "stand on
shoulders" principle from CLAUDE.md). Track via the gguf.py:69 warning
location.

## 2026-05-03 (Wave 4 / Option 7a tokenizer_mode) — vLLM Mistral3ForConditionalGeneration multimodal-init blocks text-only GGUF (now auto-fixed via stripped config; tracking for upstream awareness)

**Discovered during:** Plan 04.7-02 Wave 4 boot-smoke attempt 8
(run_id `20260503T000823Z-a92397`). **Status: AUTO-FIXED in commit
`2205adb` via stripped text-only config dir + `Ministral3ForCausalLM`
arch.** Tracking here as deferred upstream-awareness item.

**Symptom:** After Wave 3's MistralTokenizer barrier was cleared by
Wave 4's `tokenizer_mode: mistral` + tekken.json staging, vLLM
proceeded into MultiModalBudget construction and failed:

```
File "vllm/v1/engine/input_processor.py", line 61, in __init__
    mm_budget = MultiModalBudget(vllm_config, mm_registry)
File "vllm/multimodal/encoder_budget.py", line 32, in get_mm_max_toks_per_item
    mm_inputs = mm_registry.get_dummy_mm_inputs(...)
File "vllm/model_executor/models/mistral3.py", line 181, in get_hf_processor
    return self.ctx.get_hf_processor(PixtralProcessor, **kwargs)
File "transformers/models/auto/image_processing_auto.py", line 569, in from_pretrained
    raise initial_exception
File "transformers/image_processing_base.py", line 334, in get_image_processor_dict
    raise OSError(...)
OSError: Can't load image processor for '/models/Mistral-Medium-3.5-128B-config'.
... preprocessor_config.json file
```

**Root cause:** vLLM resolves architecture from the HF config's
`architectures + model_type` fields. The operator-staged
`/data/models/Mistral-Medium-3.5-128B-config/config.json` (copied
verbatim from the gated `mistralai/Mistral-Medium-3.5-128B` HF repo)
declares `architectures: ["Mistral3ForConditionalGeneration"] +
model_type: mistral3` — i.e. the multimodal architecture. vLLM then
constructs `MultiModalBudget` for this arch, which probes
`PixtralProcessor.from_pretrained(<tokenizer-dir>)`, which probes
`image_processing_auto.from_pretrained(<dir>)`, which fails because
there's no `preprocessor_config.json` (the bartowski text-only Q4_K_M
GGUF has 795 tensors, no vision_tower, and ships no preprocessor config).

**Auto-fix applied (Plan 04.7-02 commit 2205adb):**
- Created sibling dir `/data/models/Mistral-Medium-3.5-128B-text-only-config/`
- Wrote stripped `config.json` with top-level `architectures:
  ["Ministral3ForCausalLM"] + model_type: ministral3 + text_config
  fields hoisted + multimodal fields dropped`
- Symlinked tokenizer files from the original config dir
- Flipped `engine.hf_config_path` in serving.yaml to point at the new
  dir; `engine.tokenizer:` left at the original dir
- vLLM registry maps `Ministral3ForCausalLM → ("mistral",
  "MistralForCausalLM")` at `vllm/model_executor/models/registry.py:164`,
  so the text-only architecture loads cleanly without ever entering
  the Mistral3 multimodal init code path

**Why still listed here:** this is upstream awareness — there are TWO
upstream paths that would let us remove the text-only-config-strip
operator-staging step:

1. **vLLM PR:** add a `Mistral3ForCausalLM` text-only registry entry
   (alongside the existing `Mistral3ForConditionalGeneration` multimodal
   entry) so a model with the upstream multimodal architecture string
   can degrade gracefully when no vision weights are present. This
   would let the bartowski GGUF load with the original (unstripped)
   config dir.
2. **bartowski-side:** ship a separate GGUF repo with text-only-mode
   metadata (`general.architecture: ministral3` + a paired
   `Ministral3ForCausalLM` HF config). This is the "right" upstream
   fix but depends on the GGUF maintainer.

If either lands, the text-only-config strip can be removed and the
profile reverts to the simpler single-config-dir setup. Track via the
mistral3 entry in vLLM's `ModelRegistry` and the bartowski GGUF
repository for any text-only variant.

## 2026-05-03 (Wave 4 / Option 7a tokenizer_mode) — Spark coexistence at gmu=0.78 (T-06 fired; OPERATOR DECISION required, not deferrable)

**Discovered during:** Plan 04.7-02 Wave 4 boot-smoke attempt 9
(run_id `20260503T001143Z-2ff544`).

**Symptom:** After Wave 4's multimodal-init blocker was cleared via
the stripped text-only config (architecture resolved as
`Ministral3ForCausalLM`, MultiModalBudget bypassed entirely), vLLM
spawned the engine core and reached `init_device` (the FIRST
CUDA-touching code in the boot sequence):

```
File "vllm/v1/worker/gpu_worker.py", line 282, in init_device
    self.free_memory, self.total_memory = current_platform.mem_get_info(device)
File "torch/cuda/memory.py", line 842, in mem_get_info
    return torch.cuda.cudart().cudaMemGetInfo(device)
torch.AcceleratorError: CUDA error: out of memory
```

**Root cause:** **T-06 (Spark coexistence at gmu=0.78)** firing as
predicted by CONTEXT D-06. Daily-driver Gemma 4 26B-A4B v2.1 holds
~68.7 GB on the same GB10 UMA box (verified via
`nvidia-smi --query-compute-apps=process_name,used_memory
--format=csv`). Mistral's `gpu_memory_utilization=0.78 → 99.8 GB` pool
target doesn't fit alongside (99.8+68.7=168.5 > 128 GB total).

**Why this is NOT deferred (operator decision required):**
- This is a resource gate, NOT an architectural blocker. The
  configuration is well-formed; vLLM just can't allocate the requested
  pool because the daily-driver is using ~half the UMA box.
- Per CONTEXT D-13 the Mistral profile is eval-only opt-in by design.
  The typical workflow is `/profile mistral-medium-3.5` swap, which
  evicts the daily-driver and boots Mistral solo at gmu=0.78. The
  `/profile` slash command in pi-emmy already handles this via the
  sidecar's container-swap controller.
- Stopping the daily-driver mid-execution is the operator's choice
  (the executor doesn't unilaterally evict the operator's primary
  serving endpoint).

**No upstream fix available:** this is a fundamental constraint of the
GB10 UMA / 128 GB box + the 73 GB Q4_K_M weights + the daily-driver's
~68.7 GB footprint. The math doesn't work for coexistence. The
"resolution" is operator workflow, not code.

**Operator action to close G-1 (when ready):**
```bash
docker stop emmy-serve              # frees ~68.7 GB
RUN_ID="$(date -u +'%Y%m%dT%H%M%SZ')-$(head -c 6 /dev/urandom | xxd -p | head -c 6)"
RUN_DIR="runs/${RUN_ID}-boot-mistral"
mkdir -p "$RUN_DIR"
DOCKER_RUN_ARGS="$(uv run python -m emmy_serve.boot.runner render-docker-args \
  --profile profiles/mistral-medium-3.5/v1 --run-dir "$RUN_DIR" --port 8005)"
eval docker run --name emmy-serve-mistral --detach "$DOCKER_RUN_ARGS"
# wait 5-10 min for cold start; then curl http://127.0.0.1:8005/v1/models
```

OR via the `/profile mistral-medium-3.5` slash command in pi-emmy.
After Mistral run, restore daily-driver:
```bash
docker stop emmy-serve-mistral
bash scripts/start_emmy.sh   # restores Gemma daily-driver
```
