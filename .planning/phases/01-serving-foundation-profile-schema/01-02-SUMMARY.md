---
phase: 01-serving-foundation-profile-schema
plan: 02
subsystem: infra
tags: [pydantic, pyyaml, sha256, canonicalization, cli, argparse, profile, hasher, immutability]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: "Plan 01-01 pyproject.toml + conftest.py + RED test skeletons (tests/unit/test_schema.py, test_hasher.py, test_immutability.py, test_profile_layout.py, test_profile_notes.py, test_container_digest.py, test_serving_yaml.py) that this plan turns GREEN"
provides:
  - "emmy_serve.profile — pydantic v2 schema (ServingConfig, HarnessConfig, ProfileManifest, ProfileYaml) with ConfigDict(extra='forbid', frozen=True) and cross-field airgap policy on EnvVars"
  - "emmy_serve.profile.hasher — SHA256 content-hash canonicalization per RESEARCH.md §4 (UTF-8 NFC + LF + symlink reject + dotfile whitelist + profile.yaml exclusion)"
  - "emmy_serve.profile.loader — YAML → pydantic with dotted-path error messages + ProfileRef dataclass for observability event embedding"
  - "emmy_serve.profile.immutability — validator with 5-exit-code contract (0/1/2/3/4) and the 'create v2/' remediation text"
  - "emmy_serve.cli — `emmy profile validate` and `emmy profile hash` argparse-subcommand entry point"
  - "emmy_serve.diagnostics — atomic writers (write_bytes_atomic, write_text_atomic, write_json_atomic, append_jsonl_atomic) + EmmyRunLayout frozen dataclass"
  - "scripts/validate_profile.py, scripts/hash_profile.py — thin shims around emmy_serve.cli for CI/start_emmy.sh"
  - "profiles/qwen3.6-35b-a3b/v1/ — first profile bundle on disk with computed hash sha256:ad220bd324184c1d2142e1b61f4499ce4cefafbee20f9e06eaba479e4b1ebe9b"
affects:
  - "01-03 start-script-boot-smoke — start_emmy.sh reads serving.yaml via the same pydantic schema; needs emmy_serve.diagnostics.EmmyRunLayout + atomic writers for D-06 boot-failure bundle; operator replaces the container_image_digest placeholder which transitions test_container_digest + test_schema::test_serving_yaml_valid from XFAIL → PASS"
  - "01-04 kv-budget-finder-thermal — find_kv_budget.py rewrites serving.yaml.engine.gpu_memory_utilization via `emmy profile hash --write`; writes finder iterations via append_jsonl_atomic; uses EmmyRunLayout(kind='kv-finder'); test_kv_budget transitions from XFAIL → PASS"
  - "01-05 airgap-ci-50-turn-replay — CI workflow invokes `scripts/validate_profile.py profiles/**/v*/` for Layer 3 hash enforcement (the pre-commit hook + CI assertions around the Layer 1 validator shipped here)"

# Tech tracking
tech-stack:
  added:
    - "pydantic v2 with ConfigDict(extra='forbid', frozen=True) as the profile schema type (replaces prior-repo frozen-dataclass + manual _reject_unknown_keys helper per RESEARCH.md §6)"
    - "pyyaml 6.0 for YAML loading at the schema boundary + safe_dump for _rewrite_hash"
  patterns:
    - "Typed-YAML loader with dotted-path error messages — pydantic ValidationError.errors() loc tuples mapped to 'engine.gpu_memory_utilization' style via _dotted_path helper"
    - "Policy-before-schema gate ordering: raw YAML policy check runs independently of pydantic so a serving.yaml with missing required fields AND a policy violation reports exit 4 (actionable) instead of exit 1 (generic schema error)"
    - "Hash-chicken-and-egg resolution: profile.yaml is EXCLUDED from hash_bundle computation (confirmed by RESEARCH.md §4 example manifest lines 716-723 which omits profile.yaml)"
    - "ProfileRef frozen dataclass as the observability-event embedding shape (Shared Pattern 3) — id/version/hash/path, ready for Phase 3 Langfuse events"
    - "Atomic writers + EmmyRunLayout exported via emmy_serve.diagnostics namespace so every later phase module has one import path to reach both"

key-files:
  created:
    - "emmy_serve/profile/__init__.py — re-exports schema + loader + hasher public API"
    - "emmy_serve/profile/schema.py — pydantic models (EngineConfig, SamplingDefaults, GuidedDecoding, Quirks, EnvVars, ServingConfig, PromptsConfig, ContextConfig, ToolsConfig, AgentLoopConfig, HarnessConfig, CommunitySource, ProfileManifest, ProfileYaml, ProfileConfigError)"
    - "emmy_serve/profile/loader.py — load_serving / load_harness / load_profile_manifest / load_profile + ProfileRef"
    - "emmy_serve/profile/hasher.py — hash_bundle / compute_manifest / HasherError + constants (TEXT_EXTS, EXCLUDE_NAMES, EXCLUDE_SUFFIXES, EXCLUDE_ROOT_FILES, HASH_MANIFEST_VERSION)"
    - "emmy_serve/profile/immutability.py — validate_bundle() with 5 exit codes + raw-YAML policy check + `_rewrite_hash` dev helper + `python -m` entry point"
    - "emmy_serve/cli.py — build_parser() + main() with `emmy profile validate`/`emmy profile hash` subcommands"
    - "emmy_serve/diagnostics/__init__.py — namespace for atomic writers + EmmyRunLayout"
    - "emmy_serve/diagnostics/atomic.py — write_bytes_atomic, write_text_atomic, write_json_atomic, append_jsonl_atomic (shape-copied from prior repo dgx_stack/runs/write.py)"
    - "emmy_serve/diagnostics/layout.py — EmmyRunLayout frozen dataclass + new_run_id() (shape-copied from prior repo dgx_stack/runs/layout.py + ids.py)"
    - "scripts/validate_profile.py — shim (chmod +x) around `emmy profile validate`"
    - "scripts/hash_profile.py — shim (chmod +x) around `emmy profile hash`"
    - "profiles/qwen3.6-35b-a3b/v1/serving.yaml — full Phase-1 engine + sampling + env config per RESEARCH.md §2"
    - "profiles/qwen3.6-35b-a3b/v1/harness.yaml — minimal-valid Phase-2-placeholder stub per RESEARCH.md §3"
    - "profiles/qwen3.6-35b-a3b/v1/profile.yaml — manifest with computed hash sha256:ad220bd324184c1d2142e1b61f4499ce4cefafbee20f9e06eaba479e4b1ebe9b"
    - "profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md — frontmatter + provenance tables + SP_OK prefix-order policy + measured-values log stubs"
    - "profiles/qwen3.6-35b-a3b/v1/prompts/system.md — exact SP_OK canary prompt per RESEARCH.md §7.2"
    - "profiles/qwen3.6-35b-a3b/v1/tool_schemas/.gitkeep — zero-byte placeholder"
    - "profiles/qwen3.6-35b-a3b/v1/grammars/.gitkeep — zero-byte placeholder"
  modified:
    - "tests/unit/test_immutability.py — _seed_bundle_with_stored_hash rewritten to create a schema-valid bundle and compute+write the matching hash (the skeleton stub from Plan 01 was explicit: 'Plan 02 replaces this shim')"
    - "tests/unit/test_schema.py — added @pytest.mark.xfail(strict=False) to test_serving_yaml_valid (blocked on Plan 03's operator digest capture)"
    - "tests/unit/test_container_digest.py — added @pytest.mark.xfail(strict=False) to test_digest_format_valid + test_digest_not_placeholder (both blocked on Plan 03)"

key-decisions:
  - "pydantic v2 over jsonschema / dataclasses-json / attrs per RESEARCH.md §6 — ConfigDict(extra='forbid', frozen=True) gives typo safety + hashability + free JSON Schema export without manual _reject_unknown_keys helpers"
  - "profile.yaml EXCLUDED from hash_bundle — the manifest carries the computed hash back; including it causes a fixed-point chicken-and-egg problem. Confirmed by RESEARCH.md §4 example manifest (lines 716-723) which omits profile.yaml. Added EXCLUDE_ROOT_FILES constant to make this explicit."
  - "Validator gate ordering: (a) profile.yaml schema → (b) canonicalization via hash_bundle → (c) raw-YAML policy check → (d) hash match → (e) full serving + harness schema. Rationale in module docstring: policy violations are more actionable than hash mismatches; hash mismatches are more actionable than schema errors (the user just forgot to rerun hash --write)."
  - "Raw-YAML policy check (not pydantic) at gate (c) — pydantic's @model_validator(mode='after') only runs after all field-level validators pass. A serving.yaml with both missing fields AND env policy violation would report only the missing fields (exit 1). Reading env.* from the raw dict lets us surface the exit-4 policy error first, matching the tests' expectations."
  - "Exit code 2 diagnostic text includes the literal strings 'stored' / 'computed' (for greppable diagnostics), 'create profiles/<id>/v2/' and '(D-03, PROFILE-06)' (for the remediation path). The test_error_message_cites_both_hashes test is the contract."
  - "Kept the exact Phase-1 placeholder behavior from the plan: container_image_digest=sha256:REPLACE_AT_FIRST_PULL and gpu_memory_utilization=0.75 stay in serving.yaml. Schema's field_validator rejects the digest sentinel at load time (deliberate fail-loud), so `emmy profile validate` returns exit 1 on the bundle today. Plan 03 (digest capture) and Plan 04 (KV finder) replace both; the xfail marks are strict=False so they silently flip to PASS."

patterns-established:
  - "Typed-YAML schema boundary: pydantic v2 with ConfigDict(extra='forbid', frozen=True) on every BaseModel + cross-field @model_validator(mode='after') for airgap policy + field_validator for digest sentinel rejection. Every new profile-adjacent config in later plans inherits this shape."
  - "Hash canonicalization order: rglob all files -> skip editor/OS noise -> skip profile.yaml at root -> reject dot-files (except .gitkeep) -> reject symlinks -> normalize text (UTF-8 decode + NFC + LF) -> emit sha256:<hex>. Order is load-bearing; reordering risks false-negatives on symlink injection."
  - "Validator exit-code contract: 0 OK / 1 schema / 2 hash / 3 canonicalization / 4 policy. All four surfaces are tested. CI scripts map exit codes to failure modes; no stderr parsing needed."
  - "Shim pattern for CLI: `python scripts/validate_profile.py <path>` == `uv run emmy profile validate <path>` — the shim exists so CI/start_emmy.sh don't depend on console_scripts registration state."

requirements-completed:
  - PROFILE-01  # profiles/<name>/v<N>/ exists with documented layout (tests/unit/test_profile_layout.py::test_bundle_dir_exists GREEN)
  - PROFILE-02  # all required subpaths present (test_profile_layout.py::test_subpaths_present GREEN)
  - PROFILE-03  # serving.yaml schema loads; extra='forbid'; cross-field validators (test_schema.py::test_extra_forbid_rejects_unknown_key + test_cross_field_* GREEN; test_serving_yaml_valid XFAIL pending Plan 03 digest)
  - PROFILE-04  # harness.yaml stub schema loads (test_schema.py::test_harness_yaml_stub_valid GREEN)
  - PROFILE-05  # PROFILE_NOTES.md cites ≥1 source per non-trivial default (test_profile_notes.py::test_sources_cited GREEN)
  - PROFILE-06  # editing v1 without bumping hash → validator exit 2 (test_immutability.py all 5 tests GREEN)
  - PROFILE-09  # (partial — profile contract is on disk; smoke-all-three integration test lands in Plan 03)
  - REPRO-04    # schema enforces env.HF_HUB_OFFLINE == "1" (test_schema.py::test_cross_field_hf_hub_offline_required GREEN)
  # SERVE-01 / SERVE-07 / SERVE-10 / REPRO-01 remain pending on Plan 03 (digest capture + start_emmy.sh wiring)

# Metrics
duration: 45min
completed: 2026-04-20
---

# Phase 1 Plan 02: Profile Bundle + Hasher + Schema Summary

**Keystone abstraction landed: pydantic v2 profile schema with content-hash immutability, 5-exit-code validator CLI (`emmy profile validate/hash`), and the first Qwen3.6-35B-A3B-FP8 v1 profile bundle on disk with sha256:ad220bd3...e9b computed over 6 files.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-20T20:28:00Z (approx)
- **Completed:** 2026-04-20T21:13:00Z
- **Tasks:** 3
- **Files modified:** 19 created + 3 modified

## Accomplishments

- Pydantic v2 schema with `ConfigDict(extra='forbid', frozen=True)` on 14 BaseModels covering serving.yaml (EngineConfig + SamplingDefaults + GuidedDecoding + Quirks + EnvVars + ServingConfig), harness.yaml (PromptsConfig + ContextConfig + ToolsConfig + AgentLoopConfig + HarnessConfig), and profile.yaml (CommunitySource + ProfileManifest + ProfileYaml).
- Cross-field airgap policy on `EnvVars` (`VLLM_NO_USAGE_STATS="1"` + `HF_HUB_OFFLINE="1"`) plus a field-level sentinel rejection on `container_image_digest: sha256:REPLACE_AT_FIRST_PULL`.
- Content-hash canonicalization per RESEARCH.md §4 — 10 rules, 8 pytest cases GREEN (editor swap exclusion, symlink rejection, non-UTF-8 rejection, CRLF→LF, NFC normalization, .gitkeep inclusion/other-dotfile rejection, `sha256:<64-hex>` format, cross-invocation determinism).
- Five-exit-code validator with the exact remediation text the immutability test contract requires — `emmy profile validate` stderr names both stored + computed hashes AND the "create profiles/<id>/v2/" remediation line.
- `emmy profile hash --write` round-trips: runs on the v1 bundle, computes a real sha256, rewrites profile.yaml.hash preserving yaml-key order via safe_dump; second invocation confirms match.
- First Phase 1 profile bundle populated: every field from RESEARCH.md §2 (serving.yaml) and §3 (harness.yaml) present; SP_OK canary prompt at prompts/system.md verbatim from RESEARCH.md §7.2; PROFILE_NOTES.md with frontmatter + 4 provenance tables + prefix-order policy + measured-values stubs.
- 24 / 24 passing + 4 expected xfails across the Plan-02 target test files (schema, hasher, immutability, profile_layout, profile_notes, container_digest, serving_yaml).

## Task Commits

Each task was committed atomically:

1. **Task 1: Pydantic schema + loader + hasher + atomic writers + run-layout** — `3a8a2a6` (feat)
2. **Task 2: `emmy profile validate/hash` CLI + immutability validator + shims** — `756f6c0` (feat)
3. **Task 3: Profile bundle on disk + compute hash + xfail placeholder tests** — `4ee071a` (feat)

_Note: Task 1 was TDD-style (tests drove the schema + hasher shape), but committed as a single `feat` because all tests were RED skeletons from Plan 01 — no separate test(...) commit needed this plan._

## Files Created/Modified

### Task 1 (`3a8a2a6`) — schema + loader + hasher + diagnostics
- `emmy_serve/profile/__init__.py` — package namespace; re-exports 24 public symbols
- `emmy_serve/profile/schema.py` — 14 pydantic BaseModels + ProfileConfigError
- `emmy_serve/profile/loader.py` — _load_yaml + _format_validation_error (dotted-path) + load_serving/harness/profile_manifest/profile + ProfileRef
- `emmy_serve/profile/hasher.py` — TEXT_EXTS/EXCLUDE_NAMES/EXCLUDE_SUFFIXES/EXCLUDE_ROOT_FILES + HasherError + _should_exclude/_is_allowed_dotfile/_normalize_text/_hash_file + compute_manifest + hash_bundle
- `emmy_serve/diagnostics/__init__.py` — re-exports atomic writers + EmmyRunLayout
- `emmy_serve/diagnostics/atomic.py` — write_bytes_atomic (47-line shape-copy from prior repo) + write_text_atomic + write_json_atomic + append_jsonl_atomic
- `emmy_serve/diagnostics/layout.py` — new_run_id() + EmmyRunLayout frozen dataclass with 14 property-based paths for 5 run kinds

### Task 2 (`756f6c0`) — validator CLI + shims
- `emmy_serve/profile/immutability.py` — validate_bundle() with gate ordering (a→e) + _check_airgap_policy_raw() + _rewrite_hash() + main() for `python -m` entry
- `emmy_serve/cli.py` — build_parser() + _cmd_profile_validate + _cmd_profile_hash + main()
- `scripts/validate_profile.py` — 8-line shim (chmod +x)
- `scripts/hash_profile.py` — 8-line shim (chmod +x)
- (modified) `emmy_serve/profile/hasher.py` — added EXCLUDE_ROOT_FILES + profile.yaml root-exclusion logic
- (modified) `tests/unit/test_immutability.py` — rewrote `_seed_bundle_with_stored_hash` to create a full schema-valid bundle (Plan 01's skeleton stub said "Plan 02 replaces this shim")

### Task 3 (`4ee071a`) — bundle on disk + hash + xfails
- `profiles/qwen3.6-35b-a3b/v1/serving.yaml` (91 lines; 6 top-level sections)
- `profiles/qwen3.6-35b-a3b/v1/harness.yaml` (32 lines; 5 top-level sections with Phase-2 TODOs)
- `profiles/qwen3.6-35b-a3b/v1/profile.yaml` (22 lines; `hash: sha256:ad220bd3...e9b`)
- `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` (80 lines; frontmatter + 4 provenance tables + prefix-order + measured-values)
- `profiles/qwen3.6-35b-a3b/v1/prompts/system.md` (1 line; verbatim SP_OK prompt)
- `profiles/qwen3.6-35b-a3b/v1/tool_schemas/.gitkeep` + `grammars/.gitkeep` (zero bytes each)
- (modified) `tests/unit/test_schema.py` — xfail on test_serving_yaml_valid
- (modified) `tests/unit/test_container_digest.py` — xfail on both tests

## Decisions Made

- **Pydantic v2 with ConfigDict(extra='forbid', frozen=True) as the schema floor.** Matches RESEARCH.md §6 Confidence-HIGH recommendation. Gives typo safety, hashable instances, and free JSON Schema export without the manual `_reject_unknown_keys` helper functions the prior repo carried.
- **Exclude profile.yaml from hash_bundle.** The manifest contains the hash; including it in the hash computation creates a fixed-point problem (updating the hash mutates the manifest, which mutates the hash). Confirmed by RESEARCH.md §4 example manifest (lines 716-723) which lists 6 files and conspicuously omits profile.yaml. Documented via `EXCLUDE_ROOT_FILES` constant + comment.
- **Validator gate ordering policy-before-hash.** A serving.yaml with both a policy violation (e.g. `HF_HUB_OFFLINE="0"`) AND missing required fields AND a stale hash will exit 4 (policy), not 1 (schema) or 2 (hash). Rationale: policy is the most actionable diagnostic ("fix this env var"); hash mismatch is second ("run `--write`"); schema is last ("you broke the YAML structure"). Tests in tests/unit/test_immutability.py encode this ordering — keeping the tests as the contract.
- **Raw-YAML policy check supplementing the pydantic model_validator.** Pydantic runs field-level validators before @model_validator(mode='after'). A YAML with `env: {VLLM_NO_USAGE_STATS: "0"}` and no other env fields hits "Field required" errors first; the policy `model_validator` never runs. `_check_airgap_policy_raw` in immutability.py reads the raw dict and short-circuits with exit 4 before we ever try pydantic.
- **Preserve Phase-1 placeholder behavior.** `container_image_digest: sha256:REPLACE_AT_FIRST_PULL` stays in the committed serving.yaml. The schema field_validator rejects it at load time — a deliberate fail-loud per the plan. Plan 03's operator task captures the real digest and `test_container_digest.py` + `test_schema.py::test_serving_yaml_valid` flip from XFAIL to PASS. Same for `gpu_memory_utilization: 0.75` → Plan 04 finder.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rewrote _seed_bundle_with_stored_hash in tests/unit/test_immutability.py**
- **Found during:** Task 2 (immutability validator)
- **Issue:** Plan 01's test skeleton shipped a shim seed helper explicitly labelled "Plan 02 replaces this shim — here we only need the tests to be collectible." The shim wrote `engine: {}` + `hash: sha256:TBD` and would never pass schema / hash validation.
- **Fix:** Replaced with a full schema-valid seed (module-level `_VALID_SERVING_YAML` + `_VALID_HARNESS_YAML` constants that satisfy every required field), then computes `hash_bundle()` and rewrites profile.yaml.hash via `_rewrite_hash()`. This is the contract Plan 01 documented in the helper docstring.
- **Files modified:** tests/unit/test_immutability.py
- **Verification:** All 5 test cases in test_immutability.py now PASS (exit-code 0/2/3/4 + stderr remediation-text assertion).
- **Committed in:** `756f6c0` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Excluded profile.yaml from hash_bundle**
- **Found during:** Task 2 (running test_validator_exit_0_when_hash_matches)
- **Issue:** RESEARCH.md §4 point 1 says "Walk `profiles/<name>/v<N>/` recursively. Include every regular file." — but if profile.yaml is hashed, rewriting its hash field changes the bundle bytes, which changes the hash. The seed helper computed hash1 → rewrote profile.yaml → hash_bundle recomputes hash2 ≠ hash1 → validator reports mismatch → test fails. RESEARCH.md's own example manifest at lines 716-723 conspicuously omits profile.yaml, confirming this is the intended canonicalization.
- **Fix:** Added `EXCLUDE_ROOT_FILES = {"profile.yaml"}` constant to hasher.py; skip any bundle-root-relative path matching an entry in this set before hashing. Bundle-root scoping (via `rel` from `relative_to`) means a hypothetical `subdir/profile.yaml` is still hashed.
- **Files modified:** emmy_serve/profile/hasher.py
- **Verification:** Seed helper now round-trips: compute hash → write hash → re-compute hash → matches. test_validator_exit_0 passes.
- **Committed in:** `756f6c0` (Task 2 commit)

**3. [Rule 3 - Blocking] Added xfail to test_schema.py::test_serving_yaml_valid**
- **Found during:** Task 3 verification (running the full Plan-02 test list)
- **Issue:** Plan 02 commits `container_image_digest: sha256:REPLACE_AT_FIRST_PULL` per RESEARCH.md §2. The schema's `field_validator` on `container_image_digest` explicitly rejects this sentinel (a behavior the plan wanted). Result: loading the committed v1 bundle raises ProfileConfigError, which blocks `test_serving_yaml_valid` from passing in Plan 02. The plan listed `test_digest_not_placeholder` and `test_kv_budget_final` as xfail targets but missed `test_serving_yaml_valid` + `test_digest_format_valid`.
- **Fix:** Added `@pytest.mark.xfail(strict=False, reason="...Plan 03...")` to the two additional tests. All four xfails carry `strict=False` so they silently flip to PASS when the operator captures the NGC digest (Plan 03) or the KV finder writes the real utilization (Plan 04).
- **Files modified:** tests/unit/test_schema.py, tests/unit/test_container_digest.py
- **Verification:** `uv run pytest tests/unit/test_schema.py tests/unit/test_hasher.py tests/unit/test_immutability.py tests/unit/test_profile_layout.py tests/unit/test_profile_notes.py tests/unit/test_container_digest.py tests/unit/test_serving_yaml.py` → 24 passed, 4 xfailed, 0 failed.
- **Committed in:** `4ee071a` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing-critical, 1 blocking)
**Impact on plan:** All three fixes are plan-consistent — the Plan 01 shim helper explicitly invited rewriting (Rule 1); the profile.yaml exclusion is forced by the chicken-and-egg hash problem and confirmed by the RESEARCH.md example (Rule 2); the additional xfails are a missed inventory item in the plan's xfail list (Rule 3). No scope creep; no new features; no architectural changes.

## Issues Encountered

None besides the three deviations above. `uv run pytest` required a `uv sync --all-extras` at the start of Task 1 because pytest wasn't installed in the worktree's venv (Plan 01-01 committed uv.lock with pytest but the worktree rebuild picked up a fresh venv without sync'd dev extras). After one `uv sync`, everything ran on the venv Python + venv pydantic 2.13.3 + pydantic_core 2.46.3.

## Operator TODO

Inherited from Plan 01-01; repeated here for continuity:

1. **Capture the NGC container digest** (blocks Plan 03's `start_emmy.sh` + clears 3 xfails):
   ```
   docker pull nvcr.io/nvidia/vllm:26.03.post1-py3
   docker inspect nvcr.io/nvidia/vllm:26.03.post1-py3 | jq -r '.[0].RepoDigests[0]'
   ```
   Paste the resulting `sha256:<64-hex>` into `profiles/qwen3.6-35b-a3b/v1/serving.yaml.engine.container_image_digest`, then run `uv run emmy profile hash profiles/qwen3.6-35b-a3b/v1/ --write` to refresh the manifest hash, then commit both files.

2. **Register the self-hosted GitHub Actions runner on the DGX Spark** (blocks Plan 05 CI execution; already documented in Plan 01-01's `docs/ci-runner.md`).

## Next Phase Readiness

- **Plan 01-03 (start-script-boot-smoke) ready to start:** `emmy_serve.profile` is importable; `emmy_serve.diagnostics.EmmyRunLayout` and atomic writers are available for D-06 boot-failure bundle writes; serving.yaml is valid YAML that Plan 03's docker-run builder can consume (schema-level validity pending Plan 03's digest capture).
- **Plan 01-04 (kv-budget-finder-thermal) ready to start:** `scripts/find_kv_budget.py` can use `emmy profile hash --write` to round-trip finder output into serving.yaml; `EmmyRunLayout(kind='kv-finder')` + `append_jsonl_atomic` give it a complete run-artifact substrate.
- **Plan 01-05 (airgap-ci-50-turn-replay) ready to start:** `scripts/validate_profile.py` is the CI Layer-3 enforcer's entry point; the exit-code contract (0/1/2/3/4) gives CI deterministic failure-mode mapping.

**No blockers** for Plans 03 / 04 / 05 to execute in parallel with the operator's digest-capture task; they only need the schema + bundle shape, which Plan 02 ships.

## Self-Check: PASSED

Verified against plan acceptance criteria (all 22 `test -f`, `grep -q`, and `uv run` assertions):

- `test -f /data/projects/emmy/emmy_serve/profile/schema.py && grep -q "ConfigDict(extra='forbid', frozen=True)" .../schema.py` → FOUND (14 occurrences)
- `grep -q "class ServingConfig" .../schema.py` → FOUND
- `grep -q "class HarnessConfig" .../schema.py` → FOUND
- `grep -q "class ProfileManifest" .../schema.py` → FOUND
- `grep -q "VLLM_NO_USAGE_STATS must equal" .../schema.py` → FOUND
- `grep -q "HF_HUB_OFFLINE must equal" .../schema.py` → FOUND
- `grep -q "REPLACE_AT_FIRST_PULL" .../schema.py` → FOUND
- `test -f .../hasher.py && grep -q "def hash_bundle" .../hasher.py` → FOUND
- `grep -q "EXCLUDE_NAMES = {'.DS_Store', 'Thumbs.db', 'desktop.ini'}" .../hasher.py` → FOUND
- `grep -q "TEXT_EXTS" .../hasher.py` → FOUND
- `grep -q "symlink not allowed" .../hasher.py` → FOUND
- `test -f .../diagnostics/atomic.py && grep -q "def write_bytes_atomic|write_json_atomic|append_jsonl_atomic" .../atomic.py` → all three FOUND
- `test -f .../diagnostics/layout.py && grep -q "class EmmyRunLayout" .../layout.py` → FOUND
- `test -f .../emmy_serve/profile/immutability.py && grep -q "EXIT_HASH_MISMATCH = 2 ... EXIT_CANONICALIZATION = 3 ... EXIT_POLICY = 4 ... create profiles" .../immutability.py` → all FOUND
- `test -f .../emmy_serve/cli.py && grep -q "def build_parser" .../cli.py` → FOUND
- `grep -q "set_defaults(_handler=" .../cli.py` → FOUND (via `_attach_handler`)
- `test -x scripts/validate_profile.py && test -x scripts/hash_profile.py` → both EXECUTABLE
- `uv run emmy profile --help 2>&1 | grep -q validate` → FOUND
- `uv run emmy profile validate --help 2>&1 | grep -q fix-hash` → FOUND
- `test -f profiles/qwen3.6-35b-a3b/v1/{serving,harness,profile}.yaml, PROFILE_NOTES.md, prompts/system.md, tool_schemas/.gitkeep, grammars/.gitkeep` → all 7 FOUND
- `test ! -s profiles/qwen3.6-35b-a3b/v1/tool_schemas/.gitkeep` → zero bytes
- All serving.yaml grep assertions (qwen3.6-35b-a3b, nvcr.io/nvidia/vllm:26.03.post1-py3, load_format: fastsafetensors, tool_call_parser: qwen3_coder, attention_backend: flashinfer, VLLM_NO_USAGE_STATS: "1", HF_HUB_OFFLINE: "1", speculative: null) → all FOUND
- `grep -q "When the user says 'ping'" prompts/system.md && grep -q '[SP_OK]' prompts/system.md` → FOUND
- `grep -q "hash_manifest_version: 1" profile.yaml` → FOUND
- `uv run emmy profile hash profiles/qwen3.6-35b-a3b/v1/ --check` output begins with `sha256:` and is NOT the placeholder zeros → `sha256:ad220bd324184c1d2142e1b61f4499ce4cefafbee20f9e06eaba479e4b1ebe9b`
- `uv run pytest tests/unit/test_schema.py tests/unit/test_hasher.py tests/unit/test_immutability.py tests/unit/test_profile_layout.py tests/unit/test_profile_notes.py -x` → exits 0 (all pass)
- `grep -q "## Provenance of defaults|Prefix-order policy|measured_values:" PROFILE_NOTES.md` → all 3 FOUND

Commits verified in git log:
- `3a8a2a6` Task 1 → FOUND
- `756f6c0` Task 2 → FOUND
- `4ee071a` Task 3 → FOUND

---
*Phase: 01-serving-foundation-profile-schema*
*Completed: 2026-04-20*
