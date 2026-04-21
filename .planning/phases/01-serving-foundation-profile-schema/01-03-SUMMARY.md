---
phase: 01-serving-foundation-profile-schema
plan: 03
subsystem: infra
tags: [canary, boot, docker-run, start-emmy, smoke-test, d06-diagnostic-bundle, httpx, shellcheck]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: "Plan 01-01 test skeletons (test_canary.py, test_docker_run_build.py, test_start_script.py, test_container_digest.py) + Plan 01-02 emmy_serve.profile schema/loader/hasher/immutability + emmy_serve.diagnostics atomic writers + EmmyRunLayout + profiles/qwen3.6-35b-a3b/v1/ bundle with sha256:REPLACE_AT_FIRST_PULL placeholder digest"
provides:
  - "emmy_serve.canary — run_sp_ok (D-07), run_tool_call (D-08), run_generate (100-token decode smoke), run_replay (50-turn wire-format roundtrip), CanaryResult (8 required + 1 optional fields per RESEARCH.md §7.6), log_canary_event (atomic JSONL append), chat_completions helper"
  - "emmy_serve.canary.tool_schemas/read_file.json — Option A per §7.7: package-owned tool schema for tool_call canary"
  - "emmy_serve.boot.probe — wait_for_vllm(base_url, timeout_s=300, interval_s=0.5) with TimeoutError last-error message (RESEARCH.md §7.1 verbatim)"
  - "emmy_serve.boot.runner — render_docker_args (complete argv), render_image_ref, render_vllm_cli_args, render_docker_only_args + argparse CLI with 4 subcommands (render-docker-args, render-docker-only, render-vllm-cli, render-image-ref)"
  - "emmy_serve.diagnostics.bundle — write_boot_failure_bundle writes all 7 files per RESEARCH.md §7.5 (check.json, profile.json, prompt.txt, response.txt, env.json, docker-logs.txt, metrics-snapshot.txt)"
  - "scripts/smoke_test.py — orchestrates wait_for_vllm → SP_OK → tool_call → 100-token generate; on any failure writes D-06 bundle + exits 1; on success prints `smoke ok: tok/s=X tokens_out=N`"
  - "scripts/start_emmy.sh — REPRO-01 one-command contract with exit codes 0/1/2/3/4 per RESEARCH.md §14; reads container digest from serving.yaml only (no second hardcoded copy), pre-flight gate, profile validate, docker inspect digest check, docker run (detached), smoke test, ready banner with cold-start + tok/s"
affects:
  - "01-04 kv-budget-finder-thermal — find_kv_budget.py drives load through a running stack started by start_emmy.sh; loads emmy_serve.canary.chat_completions + emmy_serve.boot.probe.wait_for_vllm"
  - "01-05 airgap-ci-50-turn-replay — CI workflow invokes scripts/start_emmy.sh --airgap which renders `--network none` via render_docker_args; air_gap/session.jsonl replayed via emmy_serve.canary.run_replay"
  - "Phase 3 observability — boot-failure bundles + canary.jsonl rows are the Langfuse-ingestion shape for Phase 3 (every row carries ProfileRef fields)"
  - "Phase 5 eval — EVAL-07 library re-used: every eval row logs a CanaryResult + optionally calls run_sp_ok as a per-row canary"

# Tech tracking
tech-stack:
  added:
    - "httpx (already pinned in Plan 01) — used here for wait_for_vllm + all 3 canaries + replay (synchronous client calls are fine for boot-time and per-row eval; Phase 5 async mode reuses the same endpoint shape)"
  patterns:
    - "Complete-argv renderer: render_docker_args returns docker flags + image ref + vllm CLI in ONE list — start_emmy.sh does a single `eval docker run --name emmy-serve --detach $DOCKER_RUN_ARGS` with no piecewise composition. Each renderer sub-function (render_image_ref / render_vllm_cli_args / render_docker_only_args) remains independently callable for diagnostic inspection and for the digest pre-flight check that needs only the image ref."
    - "Fail-loud D-06 bundle: every boot-failure path writes a 7-file artifact directory via atomic writers + EmmyRunLayout(kind='boot-failure'). Phase 3's Langfuse ingestor treats one bundle as one trace; Phase 7 publication will apply redaction. runs/ is gitignored."
    - "Package-owned tool schemas: emmy_serve/canary/tool_schemas/read_file.json is loaded by load_default_tool_schema() — the canary stays self-contained across profiles (Option A per RESEARCH.md §7.7)."
    - "Schema-rejection-driven test fixture: test_docker_run_build.py seeds a tmp_path-local valid serving.yaml rather than depending on the on-disk profile (which carries the sha256:REPLACE_AT_FIRST_PULL sentinel the schema rejects at load time). Keeps the renderer tests fully green today, independently of the Task 4 operator digest capture."

key-files:
  created:
    - "emmy_serve/canary/__init__.py — re-exports the full canary public API (12 symbols)"
    - "emmy_serve/canary/sp_ok.py — D-07 canary, SP_OK_SYSTEM_PROMPT + SP_OK_USER_MESSAGE + SP_OK_ASSERTION_SUBSTR constants, run_sp_ok (temperature=0.0, max_tokens=32)"
    - "emmy_serve/canary/tool_call.py — D-08 canary, TOOL_CALL_SYSTEM_PROMPT + TOOL_CALL_USER_MESSAGE, load_default_tool_schema, run_tool_call (asserts exactly one read_file tool call with parseable path arg)"
    - "emmy_serve/canary/generate.py — 100-token decode smoke, run_generate (finish_reason in length/stop AND len(content) > 50)"
    - "emmy_serve/canary/logging.py — CanaryResult frozen dataclass (8 required + 1 optional fields), log_canary_event wraps append_jsonl_atomic"
    - "emmy_serve/canary/replay.py — Plan 05 consumer: chat_completions + run_replay for 50-turn session wire-format roundtrip"
    - "emmy_serve/canary/tool_schemas/read_file.json — one-tool canary schema per RESEARCH.md §7.3 lines 1067-1085 verbatim"
    - "emmy_serve/boot/__init__.py — namespace + re-export wait_for_vllm"
    - "emmy_serve/boot/probe.py — wait_for_vllm per RESEARCH.md §7.1 verbatim (httpx.get /v1/models with 300s timeout + 0.5s poll interval)"
    - "emmy_serve/boot/runner.py — render_docker_args (complete argv) + render_image_ref + render_vllm_cli_args + render_docker_only_args + argparse CLI with 4 subcommands"
    - "emmy_serve/diagnostics/bundle.py — write_boot_failure_bundle writes 7 D-06 files via atomic writers + EmmyRunLayout"
    - "scripts/smoke_test.py — orchestrator (executable): wait_for_vllm → run_sp_ok → run_tool_call → run_generate, D-06 bundle on any failure, tok/s emit on success"
    - "scripts/start_emmy.sh — REPRO-01 one-command contract (executable): pre-flight → emmy profile validate → render-image-ref → docker inspect → docker run → smoke_test.py → ready banner; exit codes 0/1/2/3/4"
  modified:
    - "tests/unit/test_docker_run_build.py — replaced the `profile_path` session fixture usage with a tmp_path-seeded `test_profile_path` fixture (Rule 3 blocking fix; see Deviations)"

key-decisions:
  - "render_docker_args returns the COMPLETE argv (docker flags + image ref + vllm CLI) in a single list. The plan-text originally implied separate callables composed by start_emmy.sh, but the existing unit-test contract (test_render_includes_prefix_caching_flag + test_render_includes_pinned_digest_image both assert their target strings in the same `rendered_args` list) requires a single combined list. Kept `render_image_ref` + `render_vllm_cli_args` + `render_docker_only_args` as separate helpers for start_emmy.sh's digest-inspection pre-flight; start_emmy.sh only invokes `render-image-ref` separately (for digest inspect) and then `render-docker-args` for the single docker-run eval."
  - "Tests own the contract: when plan wording and test assertions disagreed (see above), the tests won — they were committed in Plan 01-01 and documented in 01-VALIDATION.md as the Phase 1 validation surface. The plan's render_docker_args prose would be at best a second contract; at worst, disagreeing with the tests would stall the plan. Rule 1 / Rule 3."
  - "Schema-rejection propagates into test seeds: the on-disk profile carries `sha256:REPLACE_AT_FIRST_PULL`, which the ServingConfig._digest_shape field_validator rejects. Any unit test that calls load_serving on the on-disk profile inherits that rejection. Plan 02 xfailed test_container_digest.py + test_schema.py::test_serving_yaml_valid; Plan 03 applies the analogous fix to test_docker_run_build.py by seeding a tmp_path-local valid bundle. Once the operator captures the NGC digest in Task 4, the on-disk profile loads and all three xfailed tests flip to PASS — test_docker_run_build.py stays green throughout (no xfails)."
  - "start_emmy.sh does NOT `docker pull` at boot. Pulling silently-resolves the tag to whatever digest the registry serves TODAY, which defeats REPRO-01. Instead, the script runs `docker inspect $IMAGE_REF` on the pre-pulled image; if absent, exits 3 with an explicit `docker pull` remediation message. Operator pulls once (Task 4 checkpoint) + commits the digest; every subsequent boot is offline-ready."
  - "Boot-time smoke test externalizes the NGC container (D-05). scripts/smoke_test.py runs on the host against http://127.0.0.1:${PORT}; the NGC image stays unmodified. Lets the smoke suite evolve independently of the NGC release cadence and keeps the pinned-digest claim honest."

patterns-established:
  - "Boot gate 1 (SP_OK canary): system-prompt delivery is verified on every boot via the literal [SP_OK] token from a low-ambiguity user message ('ping'). Catches the Pitfall #6 silent-SP-delivery failure mode (prior-repo Phase 3 incident) before any user-facing request hits the endpoint. D-07."
  - "Boot gate 2 (tool_call canary): wire format (OpenAI vs Hermes-XML, tool_call_parser settings) is exercised on every boot with a deterministic one-tool read_file schema. Catches parser-side silent failures without XGrammar (whose parse-rate SLA gate lives in Phase 2). D-08."
  - "Boot gate 3 (100-token decode): throughput floor (≥60 tok/s on DGX Spark) is measured and surfaced in the ready banner. Any regression is visible in the first human-readable line of stdout. SC-1."
  - "D-06 bundle-on-failure: 7 files per boot-failure, atomic-written under runs/boot-failures/<iso>-boot-failure/ — Phase 3 ingests one dir per trace, Phase 7 redacts for publication. Gitignored locally."

requirements-completed: []
# Note: Plan 01-03 delivers the implementation that satisfies SERVE-01, SERVE-02,
# SERVE-04, SERVE-10, PROFILE-09, EVAL-07, REPRO-01, but a subset of those flip to
# GREEN only after the operator checkpoint (Task 4) writes the captured NGC digest
# into serving.yaml. Explicit status after Task 4 completes on DGX Spark:
#   EVAL-07 → GREEN today (test_canary.py 3/3 PASSED)
#   SERVE-07 → GREEN today (test_docker_run_build.py 5/5 PASSED)
#   REPRO-01 → GREEN today in unit tier (test_start_script.py 3 PASS + 1 skip on shellcheck)
#   SERVE-01 / test_digest_not_placeholder → GREEN after operator digest capture (xfail flips)
#   SERVE-02 / SERVE-04 / PROFILE-09 (smoke-all-three) → GREEN after operator runs
#     `pytest tests/integration/test_boot.py --run-integration` on the real Spark
#   SERVE-10 (fastsafetensors cold-start < 4min) → GREEN after operator runs integration
#
# The orchestrator should mark these requirements complete post-checkpoint, not now.

# Metrics
duration: 25min
completed: 2026-04-21
---

# Phase 1 Plan 03: Start-Script + Boot + Smoke Summary

**Tasks 1–3 complete: emmy.canary package (EVAL-07) + boot probe + D-06 diagnostic bundle + docker-args renderer + smoke-test orchestrator + scripts/start_emmy.sh (REPRO-01 one-command contract). Task 4 (operator-gated: NGC digest capture + integration tests on DGX Spark) is pending the checkpoint handoff.**

## Performance

- **Duration:** ~25 min (Tasks 1–3; Task 4 is human-gated)
- **Started:** 2026-04-21T03:27:00Z
- **Completed (Tasks 1–3):** 2026-04-21T03:53:00Z
- **Tasks committed:** 3 (Task 4 awaits operator checkpoint)
- **Files created:** 13 (10 emmy_serve source files + 2 scripts + 1 test schema)
- **Files modified:** 1 (tests/unit/test_docker_run_build.py fixture)

## Accomplishments

- `emmy_serve.canary` package complete: 5 modules (sp_ok, tool_call, generate, logging, replay) + tool_schemas/read_file.json. All SP_OK/tool_call/100-token-decode payloads copied VERBATIM from RESEARCH.md §7.2/7.3/7.4. `test_canary.py` is 3/3 GREEN.
- `emmy_serve.boot.runner.render_docker_args` emits the complete `docker run` argv (docker flags + pinned image ref + vllm serve CLI) — one single call in start_emmy.sh. `test_docker_run_build.py` is 5/5 GREEN.
- `emmy_serve.boot.probe.wait_for_vllm` verbatim from RESEARCH.md §7.1 — 300s poll timeout, httpx.get /v1/models, TimeoutError with last-error message for D-06 bundle.
- `emmy_serve.diagnostics.bundle.write_boot_failure_bundle` writes all 7 D-06 files (check.json + profile.json + prompt.txt + response.txt + env.json + docker-logs.txt + metrics-snapshot.txt) via atomic writers + EmmyRunLayout.
- `scripts/smoke_test.py` orchestrates wait_for_vllm → SP_OK → tool_call → 100-token generate with D-06 rollback on any failure and tok/s surfacing on success.
- `scripts/start_emmy.sh` matches RESEARCH.md §14 contract verbatim: exit codes 0/1/2/3/4, pre-flight gate, validator, digest-inspect, detached docker run, smoke test, ready banner. `test_start_script.py` is 3/4 GREEN (shellcheck not installed on worktree host — auto-skip; the self-hosted DGX runner has shellcheck via Plan 05 setup).
- All 35 unit tests currently green or skipped (none failing); 4 xfails remain pending the Task 4 operator digest capture.

## Task Commits

Each task was committed atomically:

1. **Task 1: emmy.canary package + boot.probe + D-06 diagnostic bundle** — `91227a7` (feat)
2. **Task 2: boot.runner docker-args renderer + scripts/smoke_test.py** — `6bdf079` (feat)
3. **Task 3: scripts/start_emmy.sh one-command contract** — `4057a73` (feat)

**Task 4 (checkpoint): operator-gated — requires DGX Spark hardware and docker daemon.** Not yet run. Once the orchestrator relays the user's "boot green" signal (per plan resume-signal), a continuation agent will record the captured digest, measured cold-start time, throughput, D-06 bundle demonstration, and any cleared xfails into the summary's "Operator Verification (Post-Checkpoint)" section below.

## Files Created/Modified

### Task 1 (`91227a7`) — emmy.canary + boot.probe + D-06 bundle
- `emmy_serve/boot/__init__.py` + `emmy_serve/boot/probe.py` — wait_for_vllm per RESEARCH.md §7.1
- `emmy_serve/canary/__init__.py` — re-exports 12 public symbols
- `emmy_serve/canary/sp_ok.py` — D-07 canary + 3 constants, run_sp_ok (temperature=0.0, max_tokens=32)
- `emmy_serve/canary/tool_call.py` — D-08 canary + load_default_tool_schema, run_tool_call (asserts exactly one read_file call with parseable path)
- `emmy_serve/canary/generate.py` — 100-token decode, run_generate returns (ok, data, elapsed_s)
- `emmy_serve/canary/logging.py` — CanaryResult frozen dataclass + log_canary_event (atomic JSONL append)
- `emmy_serve/canary/replay.py` — chat_completions + run_replay for Plan 05's 50-turn airgap session
- `emmy_serve/canary/tool_schemas/read_file.json` — one-tool canary schema (Option A, package-owned)
- `emmy_serve/diagnostics/bundle.py` — write_boot_failure_bundle emits all 7 files per RESEARCH.md §7.5

### Task 2 (`6bdf079`) — boot.runner + smoke_test.py
- `emmy_serve/boot/runner.py` — render_docker_args (complete argv) + 3 helper accessors + 4 CLI subcommands
- `scripts/smoke_test.py` (executable, 6.1 KB) — boot-time smoke orchestrator
- (modified) `tests/unit/test_docker_run_build.py` — tmp_path-seeded fixture replaces direct on-disk profile_path (Rule 3 blocking fix)

### Task 3 (`4057a73`) — start_emmy.sh
- `scripts/start_emmy.sh` (executable, 4.6 KB) — REPRO-01 one-command contract, exit codes 0/1/2/3/4

## Decisions Made

- **render_docker_args returns the COMPLETE argv (docker flags + image + vllm CLI) in one list.** The plan's prose originally described separate callables composed by start_emmy.sh, but the unit-test contract (two tests asserting disjoint string sets in the same `rendered_args` list — docker-flag `--network none` AND vllm-flag `--enable-prefix-caching` AND image ref `nvcr.io/nvidia/vllm@sha256:...`) forced a combined return. Kept three single-purpose helpers (render_image_ref / render_vllm_cli_args / render_docker_only_args) so start_emmy.sh's digest-inspect pre-flight can read only the image ref. Tests won.
- **scripts/start_emmy.sh does NOT `docker pull` at boot.** Instead it runs `docker inspect $IMAGE_REF` on the pre-pulled image; on miss → exit 3 with explicit remediation. Preserves the REPRO-01 pinned-digest claim (pulling silently-resolves the tag to today's registry serve — defeats the point). The operator's Task 4 step pulls once and commits the digest.
- **Boot-time smoke test externalized (D-05).** scripts/smoke_test.py runs on the host against http://127.0.0.1:${PORT}; the NGC container image stays unmodified. Lets smoke evolve independently of NGC cadence.
- **Package-owned tool schema (Option A per §7.7).** read_file.json lives under emmy_serve/canary/tool_schemas/ so canary runs work across profiles without depending on profile-scoped schemas (profile-scoped schemas arrive in Phase 2 with the harness).
- **tmp_path fixture for render tests.** The on-disk profile's sha256:REPLACE_AT_FIRST_PULL sentinel blocks load_serving via the schema's _digest_shape validator. test_docker_run_build.py tests render shape, not digest capture, so seeding a tmp_path-local valid serving.yaml (same pattern as test_immutability.py's _VALID_SERVING_YAML constant) is the cleanest fix. All 5 tests GREEN today — no xfail needed for renderer correctness.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] test_docker_run_build.py fixture seeded from tmp_path instead of on-disk profile_path**
- **Found during:** Task 2 initial run of `uv run pytest tests/unit/test_docker_run_build.py`
- **Issue:** The Plan 01-01 skeleton's `rendered_args` fixture called `runner.render_docker_args(profile_path=profile_path, ...)` where `profile_path` is the repo's on-disk profile. `render_docker_args` invokes `load_serving` which runs the ServingConfig schema validator, which includes `_digest_shape` on `container_image_digest`. The on-disk profile carries `sha256:REPLACE_AT_FIRST_PULL` (committed in Plan 02 by design, cleared in Task 4 checkpoint). Result: `load_serving` raises `ProfileConfigError` → all 5 tests would ERROR, blocking Plan 03 completion. Plan 02 xfailed 3 tests (test_container_digest × 2 + test_schema::test_serving_yaml_valid) but missed test_docker_run_build (5 tests).
- **Fix:** Added module-level `_VALID_SERVING_YAML` constant (same shape as test_immutability's constant) and a `test_profile_path` fixture that seeds `tmp_path/v1/serving.yaml` with a valid (non-sentinel) digest. The `rendered_args` fixture and the airgap-specific test consume `test_profile_path` instead. Rendering behavior is fully tested; the real on-disk digest capture is orthogonal (tested by test_container_digest).
- **Files modified:** `tests/unit/test_docker_run_build.py`
- **Verification:** `uv run pytest tests/unit/test_docker_run_build.py -v` → 5/5 PASSED.
- **Committed in:** `6bdf079` (Task 2 commit)

**2. [Rule 1 - Bug] render_docker_args returns the complete argv (docker flags + image + vllm CLI)**
- **Found during:** Task 2 planning — comparing plan prose to test assertions
- **Issue:** Plan text described `render_docker_args` as returning only docker-level flags (separate from `render_vllm_cli_args` and `render_image_ref`), but the unit-test contract (test_render_includes_prefix_caching_flag AND test_render_includes_pinned_digest_image AND test_render_network_mode_none_when_airgap_true) asserts three disjoint string classes — a vllm CLI flag, an image reference, AND a docker-network flag — all in the SAME `rendered_args` list. Implementing the plan prose would require updating 2-3 tests committed in Plan 01-01 as the Wave-0 contract; implementing the tests' contract preserves Wave-0 integrity and delivers one-call convenience to start_emmy.sh.
- **Fix:** `render_docker_args` now returns `docker_args + [image_ref] + vllm_cli` combined. Kept `render_image_ref`, `render_vllm_cli_args`, and `render_docker_only_args` as separately-callable helpers so the start_emmy.sh digest-inspect pre-flight (which only needs the image ref) and future diagnostic scripts have surgical access. Plan's composition model in start_emmy.sh collapses from `eval docker run ... $DOCKER $IMAGE $CLI` to `eval docker run ... $DOCKER_RUN_ARGS` — one eval, one quoted string.
- **Files modified:** `emmy_serve/boot/runner.py`, `scripts/start_emmy.sh`
- **Verification:** All 5 `test_docker_run_build.py` tests PASS. `uv run python -m emmy_serve.boot.runner render-docker-args --profile .../v1 ... | tr ' ' '\n' | head` emits the complete argv with `nvcr.io/nvidia/vllm@sha256:…` followed by vllm serve flags. Tests own the contract; the plan text is adjusted to match.
- **Committed in:** `6bdf079` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking + 1 bug)
**Impact on plan:** Both fixes preserve Plan 01-01's Wave-0 test contract and avoid cascading changes to committed files. Neither introduces a new feature; neither changes the module surface described in the interfaces block. Plan 02's xfail pattern is extended locally (via tmp_path seed) rather than globally (via new xfail markers) because test_docker_run_build's contract is renderer-shape, not digest-capture.

## Issues Encountered

- **uv sync was already complete** on the worktree (inherited from Plan 02 test runs); no re-install needed.
- **shellcheck not installed on the worktree host** — `test_shellcheck_passes` auto-skips per its `shutil.which("shellcheck")` guard. The self-hosted DGX Spark runner (docs/ci-runner.md Step 7) has shellcheck; Plan 05's CI workflow invokes it.
- **Task 4 is genuinely blocked on DGX Spark hardware + network access to NGC.** Not skippable from this worktree. See Checkpoint section below.

## Operator Verification (Post-Checkpoint — Task 4)

This section is intentionally left blank until the orchestrator relays the user's "boot green" signal and spawns a continuation agent. Expected fields:

- Captured NGC digest value (one line; full `sha256:<64-hex>`)
- `docker pull` + `docker inspect` command used to capture it
- Measured cold-start time from `./scripts/start_emmy.sh` ready banner
- Measured 100-token throughput (tok/s) — must be ≥ 60 for SC-1
- Integration test results (`pytest tests/integration/test_boot.py --run-integration`):
  - test_models_endpoint
  - test_throughput_floor
  - test_extra_body_passthrough
  - test_cold_start_time
  - test_smoke_all_three
- D-06 bundle demonstration (failure-path): listing of the 7 files under `runs/boot-failures/<iso>-boot-failure/`
- xfail status after digest capture: test_container_digest.test_digest_format_valid + test_digest_not_placeholder + test_schema.test_serving_yaml_valid — all 3 expected to transition from XFAIL → PASS (strict=False so no failure if they XPASS)
- Operator's commit hash for `feat(01-03): capture NGC digest + clear digest xfail`

## Next Phase Readiness

**Pre-checkpoint (where we are right now):**
- **Plan 01-04 (kv-budget-finder-thermal)** can begin its design + tests-first phase; the schema + renderer + probe modules it depends on are all available. Plan 01-04's load driver will `import emmy_serve.canary.chat_completions` + `emmy_serve.boot.probe.wait_for_vllm`. HOWEVER, Plan 01-04's finder cannot actually RUN until the operator has captured the NGC digest and has a running stack (Task 4 step 5: `./scripts/start_emmy.sh`).
- **Plan 01-05 (airgap-ci-50-turn-replay)** can begin: `emmy_serve.canary.run_replay` is shipped; `scripts/start_emmy.sh --airgap` wires `--network none` via `render_docker_args`; the `docs/ci-runner.md` self-hosted setup is already in place from Plan 01-01.

**Post-checkpoint (after Task 4):**
- All 4 xfails in Plan 01's unit tier transition to PASS (3 from digest capture, 1 from Plan 04's KV-finder).
- DGX Spark has a running stack; Plan 04 can invoke `scripts/find_kv_budget.py` + `scripts/thermal_replay.py` against the loopback endpoint.
- Phase 1 SC-1 (≥60 tok/s cold boot) and SC-3 (three-check smoke with fail-loud + rollback) are demonstrably satisfied.

## Self-Check: PASSED (Tasks 1–3 only; Task 4 pending)

Verified against plan acceptance criteria (unit-tier subset; integration criteria require DGX Spark hardware):

**Task 1:**
- `test -f /data/projects/emmy/emmy_serve/canary/sp_ok.py` → FOUND
- `grep -q "When the user says .ping." .../sp_ok.py` → FOUND
- `grep -q 'SP_OK_ASSERTION_SUBSTR = "\[SP_OK\]"' .../sp_ok.py` → FOUND
- `grep -q '"temperature": 0.0' .../sp_ok.py` → FOUND
- `grep -q 'def run_tool_call' .../tool_call.py` → FOUND
- `grep -q 'def load_default_tool_schema' .../tool_call.py` → FOUND
- `grep -q 'def run_generate' .../generate.py` → FOUND
- `grep -q 'finish in ' .../generate.py` → FOUND (via `finish in ("length", "stop")`)
- `grep -q 'class CanaryResult' .../logging.py` → FOUND
- `grep -q 'def log_canary_event' .../logging.py` → FOUND
- `test -f .../canary/tool_schemas/read_file.json && python3 -c "import json; ...; assert d['function']['name'] == 'read_file'"` → PASSED
- `test -f .../boot/probe.py && grep -q 'def wait_for_vllm' .../probe.py && grep -q 'timeout_s: int = 300' .../probe.py` → FOUND
- `test -f .../diagnostics/bundle.py && grep -q 'def write_boot_failure_bundle' .../bundle.py` → FOUND
- `uv run pytest tests/unit/test_canary.py -x` → 3 PASSED, 0 failed

**Task 2:**
- `grep -q "def render_docker_args|def render_vllm_cli_args|def render_image_ref" .../runner.py` → all 3 FOUND
- `grep -q "\-\-network.*none" .../runner.py` → FOUND
- `grep -q "fastsafetensors" .../runner.py` → FOUND (docstring)
- `grep -q "enable-prefix-caching|enable-chunked-prefill|tool-call-parser" .../runner.py` → all 3 FOUND
- `test -x scripts/smoke_test.py && grep -q "wait_for_vllm|run_sp_ok|run_tool_call|run_generate|write_boot_failure_bundle" scripts/smoke_test.py` → all 5 FOUND
- `uv run pytest tests/unit/test_docker_run_build.py -x` → 5 PASSED, 0 failed

**Task 3:**
- `test -x scripts/start_emmy.sh && grep -q "set -euo pipefail" scripts/start_emmy.sh` → FOUND
- `grep -q "exit 1|exit 2|exit 3|exit 4" scripts/start_emmy.sh` → all 4 FOUND
- `grep -q "render-docker-args|render-image-ref|smoke_test.py|emmy profile validate|runs/boot-failures" scripts/start_emmy.sh` → all 5 FOUND
- `bash -n scripts/start_emmy.sh` → exit 0 (syntax valid)
- `./scripts/start_emmy.sh --help` → prints usage, exit 0
- `uv run pytest tests/unit/test_start_script.py` → 3 PASSED, 1 SKIPPED (shellcheck absent)

**Full suite:**
- `uv run pytest tests/unit` → 35 passed, 10 skipped, 4 xfailed, 0 failed/errored

Commits verified in `git log`:
- `91227a7` Task 1 → FOUND
- `6bdf079` Task 2 → FOUND
- `4057a73` Task 3 → FOUND

**Task 4 verification is DGX-Spark-hardware-gated and cannot be self-checked from this worktree.** The continuation agent will append `## Self-Check (Task 4): PASSED|FAILED` with the captured digest + integration results.

---
*Phase: 01-serving-foundation-profile-schema*
*Tasks 1–3 completed: 2026-04-21*
*Task 4 (checkpoint): awaiting operator*
