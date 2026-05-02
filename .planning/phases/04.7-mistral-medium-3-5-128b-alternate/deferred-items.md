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
