---
phase: 01-serving-foundation-profile-schema
verified: 2026-04-21T12:00:00Z
status: gaps_found
score: 3/5
overrides_applied: 0
gaps:
  - truth: "start_emmy.sh boots with captured NGC digest, serves /v1/chat/completions with measured throughput >= 60 tok/s on DGX Spark (SC-1)"
    status: partial
    reason: >
      The boot contract (start_emmy.sh, derived image with fastsafetensors, smoke test, D-06 rollback)
      is fully implemented and demonstrated. The measured warm decode throughput is 49-50 tok/s
      (45.9 tok/s at live test time today; 48.1 tok/s p50 hour-2 under 2-hour sustained load).
      The 60 tok/s floor is unmet. PROFILE_NOTES.md documents the gap as architectural
      (Mamba+MoE+FP8 on vLLM 0.17.1+nvinternal on GB10), not a profile-knob problem.
      test_throughput_floor is a live documented FAIL.
    artifacts:
      - path: "scripts/start_emmy.sh"
        issue: "Boot contract implemented and passes; throughput floor 60 tok/s not met (45-50 tok/s measured)"
      - path: "profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md"
        issue: "SC-1 throughput gap section documents the gap as architectural, not profile-knob"
    missing:
      - "Close the 10-20 tok/s throughput gap: candidates are VLLM_USE_FLASHINFER_MOE_FP8=1 env knob, CUDA forward-compat overhead investigation, vLLM 0.17.1 FP8+Mamba experimental prefix-caching path, reasoning-parser integration. Document in a Phase 1.1 plan or Phase 2 scope."
  - truth: "50-turn synthetic coding session produces zero outbound network packets verified via ss/tcpdump snapshot in CI (SC-4)"
    status: failed
    reason: >
      The CI workflow is committed (.github/workflows/airgap.yml with the correct path filters,
      two-job structure, and self-hosted runner targeting). The 50-turn fixture (air_gap/session.jsonl)
      is committed and unit-test-verified (all 8 tool types, exactly 50 turns). The D-12 four-layer
      validator is implemented and unit-tested. However, the self-hosted DGX Spark GitHub Actions
      runner has NOT yet been registered (documented as an operator TODO in docs/ci-runner.md).
      The airgap-replay job has therefore never executed on real hardware; SC-4 cannot be declared
      verified until the workflow produces a green run on the self-hosted runner. This is an operator
      task, not a code task.
    artifacts:
      - path: ".github/workflows/airgap.yml"
        issue: "Workflow committed and correct, but has never executed (no self-hosted runner registered)"
      - path: "docs/ci-runner.md"
        issue: "Registration instructions present; operator step not yet completed"
    missing:
      - "Register the self-hosted GitHub Actions runner on the DGX Spark per docs/ci-runner.md (sudo useradd -m emmy-ci, docker group, runner install, dgx-spark label). Push any PR touching air_gap/** or emmy_serve/** to trigger the workflow."
      - "After runner registration, confirm the airgap-replay job produces a green run with the D-12 report artifact showing passes=true."
  - truth: "2-hour sustained-load test completes with zero vLLM preemption, GPU clock not throttled below documented threshold, no OOM (SC-5)"
    status: partial
    reason: >
      The 2-hour thermal replay ran with record-floors (run 20260421T092927Z_a1b62b-thermal):
      zero preemptions, zero OOM events, decode throughput p50=48.1 tok/s, p1=41.4 tok/s.
      The floor-reproducibility requirement (SC-5's implicit second run confirming the floors hold)
      was planned in Phase B Step 5 (two 2-hour thermal replays) but only one run (record-floors)
      is documented in PROFILE_NOTES.md validation_runs. The second --assert-floors run is not
      evidenced in git history or PROFILE_NOTES.md.
      Additionally, the GPU clock floor sampler returned 0 for both gpu_clock_p5_hour2_mhz
      and gpu_clock_p50_hour2_mhz (documented as a sampler bug in PROFILE_NOTES.md), so the
      "GPU clock not throttled below documented per-profile threshold" criterion in SC-5 cannot
      be asserted. PROFILE_NOTES.md explicitly notes this is non-blocking for the --assert-floors
      contract (which gates on decode throughput, not clock), but the SC-5 text requires it.
    artifacts:
      - path: "profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md"
        issue: "Only one thermal validation run documented (record-floors); second assert-floors run not evidenced. GPU clock values recorded as 0 (sampler bug)."
      - path: "emmy_serve/thermal/sampler.py"
        issue: "nvidia-smi subprocess sampler returns 0 for GPU clock fields; bug not yet fixed"
    missing:
      - "Run a second 2-hour thermal replay with --assert-floors and confirm exit 0. Commit the run artifact reference to PROFILE_NOTES.md validation_runs."
      - "Fix emmy_serve/thermal/sampler.py GPU clock parsing bug so the clock floor can be asserted in re-runs. Document the fix in a Phase 1.1 plan or as a pre-Phase-2 bugfix commit."
deferred: []
human_verification:
  - test: "Register the self-hosted GitHub Actions runner on the DGX Spark (docs/ci-runner.md) and push a branch to trigger the airgap.yml workflow."
    expected: "profile-hash-integrity job passes on ubuntu-latest in ~30s. airgap-replay job on [self-hosted, dgx-spark] boots emmy-serve with --network none, runs D-12 four-layer probe (passes=true), replays all 50 turns, confirms zero outbound packets."
    why_human: "Cannot be automated from this machine — requires physical DGX Spark network interface, docker daemon, and GitHub Actions runner registration. Code is verified; execution is an operator step."
  - test: "Run a second 2-hour thermal replay with --assert-floors after completing the first."
    expected: "scripts/thermal_replay.py --profile profiles/qwen3.6-35b-a3b/v1 --assert-floors exits 0 with 'All floors pass'. Both decode throughput floors (p50 >= 48.1 * 0.93, p1 >= 41.4 * 0.90) hold. Zero preemptions, zero OOM."
    why_human: "Requires 2 hours of sustained GPU time on the DGX Spark. Cannot run in CI or from this machine without monopolizing the serving stack."
---

# Phase 1: Serving Foundation + Profile Schema — Verification Report

**Phase Goal:** One profile (Qwen3.6-35B-A3B-FP8) loads on DGX Spark via the pinned NGC vLLM container and serves OpenAI-compatible chat completions with a versioned, content-hashed profile bundle on disk; the rig is provably air-gapped, KV-budgeted, thermally validated, and gated by a system-prompt-echo canary.

**Verified:** 2026-04-21
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| SC-1 | start_emmy.sh boots with captured NGC digest, serves /v1/chat/completions on loopback with measured throughput >= 60 tok/s | PARTIAL | Boot contract fully implemented; `test_models_endpoint`, `test_extra_body_passthrough`, `test_smoke_all_three` PASS. `test_throughput_floor` FAILS: 45.9 tok/s measured today, 48.1 tok/s p50 hour-2. 60 tok/s floor not met. |
| SC-2 | Schema validator + hasher enforce profile immutability (3-layer contract: Layer 1 validator, Layer 2 pre-commit hook, Layer 3 CI) | VERIFIED | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0. Hasher implements all 10 canonicalization rules. `test_immutability.py` 5/5 PASS. Layer 2 (`.githooks/pre-commit`) committed and dry-run verified. Layer 3 (`profile-hash-integrity` job on ubuntu-latest) committed. `docs/profile-immutability.md` documents all three layers. |
| SC-3 | Boot-time smoke test gates startup on SP_OK + tool_call + 100-token decode; fail-loud + D-06 diagnostic bundle rollback on any failure | VERIFIED | `test_smoke_all_three` PASS (live run confirms SP_OK=True, tool_call=True, generate=True). D-06 bundle writer implemented and exercised in-situ during Plan 03 boot failures. `scripts/start_emmy.sh` exit codes 0/1/2/3/4 implemented; `test_start_script.py` 3 PASS. |
| SC-4 | 50-turn synthetic coding session produces zero outbound network packets verified via ss/tcpdump snapshot in CI (self-hosted DGX runner) | FAILED | `air_gap/session.jsonl` 50 turns with 8 tool types committed and unit-verified. `.github/workflows/airgap.yml` with correct `[self-hosted, dgx-spark]` target committed. D-12 four-layer validator implemented. Self-hosted runner NOT yet registered; airgap-replay job has NEVER EXECUTED. SC-4 provable only after runner registration + first green CI run. |
| SC-5 | 2-hour sustained-load test completes with zero preemption, GPU clock not throttled below documented threshold, no OOM | PARTIAL | 2-hour thermal replay ran once (record-floors): zero preemptions, zero OOM, p50=48.1 tok/s, p1=41.4 tok/s. Second --assert-floors run not evidenced (only 1 entry in PROFILE_NOTES.md validation_runs). GPU clock sampler returned 0 (documented bug); "not throttled below documented threshold" cannot be asserted. |

**Score: 3/5 truths fully verified** (SC-2 and SC-3 VERIFIED; SC-1 PARTIAL on throughput floor; SC-4 FAILED on operator step; SC-5 PARTIAL on second run + clock sampler)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/start_emmy.sh` | One-command REPRO-01 contract | VERIFIED | Exists, executable, `set -euo pipefail`, exit codes 0/1/2/3/4; reads digest from serving.yaml only |
| `docker/Dockerfile` | Derived image with fastsafetensors | VERIFIED | Layers `fastsafetensors==0.1.14` on NGC 26.03.post1-py3; image `emmy-serve/vllm:26.03.post1-fst` present on host |
| `profiles/qwen3.6-35b-a3b/v1/serving.yaml` | Full engine config with real digest, non-placeholder KV util | VERIFIED | digest=`sha256:77321e41...`, `gpu_memory_utilization=0.88` (from KV-finder), all required fields |
| `profiles/qwen3.6-35b-a3b/v1/harness.yaml` | Valid stub with Phase-2 TODO values | VERIFIED | Schema-valid; `test_harness_yaml_stub_valid` PASS |
| `profiles/qwen3.6-35b-a3b/v1/profile.yaml` | Bundle manifest with computed hash | VERIFIED | `hash: sha256:5d33966b...`; `emmy profile validate` exits 0 |
| `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` | Provenance + measured values + prefix-order policy | VERIFIED | Frontmatter populated with real measurements; 4 provenance tables; prefix-order block present; SC-1 gap documented; sampler gap documented |
| `profiles/qwen3.6-35b-a3b/v1/prompts/system.md` | SP_OK canary prompt verbatim | VERIFIED | Contains `[SP_OK]` and "ping" instruction |
| `emmy_serve/profile/schema.py` | Pydantic v2 schema with `extra='forbid'` + cross-field validators | VERIFIED | 14 BaseModels, `ConfigDict(extra='forbid', frozen=True)`, `VLLM_NO_USAGE_STATS`, `HF_HUB_OFFLINE` validators |
| `emmy_serve/profile/hasher.py` | 10-rule canonicalization algorithm | VERIFIED | All 8 canonicalization unit tests PASS |
| `emmy_serve/profile/immutability.py` | 5-exit-code validator (0/1/2/3/4) | VERIFIED | Exit codes implemented; "create v2/" remediation text present |
| `emmy_serve/canary/sp_ok.py` | EVAL-07 SP_OK canary library | VERIFIED | `SP_OK_SYSTEM_PROMPT`, `SP_OK_ASSERTION_SUBSTR`, `run_sp_ok` all present; used by every later phase |
| `emmy_serve/canary/logging.py` | CanaryResult dataclass (8 fields) | VERIFIED | `CanaryResult` frozen dataclass; `log_canary_event`; 3/3 test_canary.py PASS |
| `emmy_serve/kv_finder/bisect.py` | Full §8 bisection algorithm | VERIFIED | `run_finder` present; 15/15 unit tests PASS; measured util=0.88 written to serving.yaml |
| `emmy_serve/thermal/replay.py` | 2-hour replay harness + floor assertion | VERIFIED | `run_replay`, `compute_floors`, `assert_floors`, `record_floors_first_run` all present; 21/21 unit tests PASS |
| `emmy_serve/thermal/sampler.py` | GPU + vLLM background samplers | PARTIAL | Implemented; VllmMetricsSampler (decode throughput) works; GpuSampler (nvidia-smi clock) returns 0 |
| `air_gap/session.jsonl` | 50-turn replay fixture, 8 tool types | VERIFIED | 50 turns; all 8 tool types confirmed: read/write/edit/bash/grep/find/ls/web_fetch |
| `emmy_serve/airgap/validator.py` | D-12 four-layer probe | VERIFIED | All 4 layer_* functions present; pre-boot exits 0 against committed profile |
| `.github/workflows/airgap.yml` | Self-hosted CI workflow | PARTIAL | Two-job workflow committed; correct runner label; path filters cover all required paths; concurrency configured — but job has NEVER EXECUTED (no runner registered) |
| `.githooks/pre-commit` | Layer-2 profile immutability hook | VERIFIED | Executable; calls `emmy profile validate`; dry-run confirmed functional |
| `emmy_serve/diagnostics/bundle.py` | D-06 boot-failure diagnostic bundle | VERIFIED | `write_boot_failure_bundle` present; exercised in-situ during Plan 03 failures |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/start_emmy.sh` | `emmy_serve.boot.runner:render_docker_args` | `python3 -m emmy_serve.boot.runner render-docker-args` | WIRED | grep confirms pattern in start_emmy.sh |
| `scripts/start_emmy.sh` | `scripts/smoke_test.py` | subprocess invocation post-/v1/models 200 | WIRED | grep confirms pattern |
| `scripts/smoke_test.py` | `emmy_serve.canary (run_sp_ok + run_tool_call + run_generate)` | library import | WIRED | `from emmy_serve.canary import` confirmed |
| `scripts/start_emmy.sh` | `runs/boot-failures/<iso>/` | D-06 bundle on smoke failure | WIRED | grep confirms; exercised during Plan 03 |
| `emmy_serve/profile/immutability.py` | `emmy_serve/profile/hasher.py` | `hash_bundle()` call | WIRED | grep confirms `hash_bundle(` in immutability.py |
| `emmy_serve/canary/sp_ok.py` | Phase 5+ eval | EVAL-07 library contract | WIRED | `run_sp_ok`, `SP_OK_SYSTEM_PROMPT`, `SP_OK_ASSERTION_SUBSTR` are public API; `emmy_serve.canary` namespace exports all |
| `.github/workflows/airgap.yml` | `scripts/start_emmy.sh --airgap` | workflow step | WIRED (code) / UNEXECUTED | Pattern confirmed; workflow never ran |
| `.github/workflows/airgap.yml` | `emmy_serve.canary.replay.run_replay` | docker exec | WIRED (code) / UNEXECUTED | Pattern confirmed |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `tests/integration/test_boot.py::test_throughput_floor` | `tok_per_s` | Live httpx call to `/v1/chat/completions` | Yes (real generation) | FLOWING but BELOW FLOOR |
| `emmy_serve/canary/sp_ok.py::run_sp_ok` | response text | Live `/v1/chat/completions` | Yes | FLOWING (SP_OK=True confirmed live) |
| `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md measured_values` | KV-finder + thermal replay output | `scripts/find_kv_budget.py` + `scripts/thermal_replay.py --record-floors` | Yes (real measured) | FLOWING (real values committed) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SP_OK canary passes against running server | `uv run python3 -c "from emmy_serve.canary import run_sp_ok; ok,_=run_sp_ok('http://127.0.0.1:8002','qwen3.6-35b-a3b'); print(ok)"` | `True` | PASS |
| tool_call canary passes against running server | `uv run python3 -c "from emmy_serve.canary import run_tool_call; from emmy_serve.canary.tool_call import load_default_tool_schema; ok,_=run_tool_call('http://127.0.0.1:8002','qwen3.6-35b-a3b',load_default_tool_schema()); print(ok)"` | `True` | PASS |
| 100-token generate canary passes | `uv run python3 -c "from emmy_serve.canary import run_generate; ok,_,_=run_generate('http://127.0.0.1:8002','qwen3.6-35b-a3b'); print(ok)"` | `True` | PASS |
| profile validates to exit 0 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` | exit 0 | PASS |
| throughput floor >= 60 tok/s | `uv run pytest tests/integration/test_boot.py::test_throughput_floor --run-integration -q` | 45.9 tok/s — FAIL | FAIL (documented gap) |
| unit test suite clean | `uv run pytest tests/unit -q` | 97 passed, 1 skipped (shellcheck), 0 failed | PASS |
| air_gap session fixture has 50 turns + 8 tool types | inspection via Python | 50 turns; {read,write,edit,bash,grep,find,ls,web_fetch} | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| SERVE-01 | 01-01, 01-02, 01-03 | NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3` | PARTIAL | Derived image built from NGC base; base digest captured (sha256:fe21f1b1…); serving.yaml uses derived image `emmy-serve/vllm:26.03.post1-fst`. Plan 03 documented why the base NGC image alone fails (missing fastsafetensors). The derived-image approach is accepted per CONTEXT.md Option C. |
| SERVE-02 | 01-01, 01-03 | Qwen3.6-35B-A3B-FP8 served, >= 60 tok/s | PARTIAL | Model served and responsive; throughput measured at 48-50 tok/s warm, failing the 60 tok/s floor |
| SERVE-04 | 01-01, 01-03 | OpenAI-compat /v1/chat/completions with extra_body | VERIFIED | `test_extra_body_passthrough` PASS |
| SERVE-07 | 01-01, 01-02, 01-04 | Prefix caching + chunked prefill + prefix-order documented | VERIFIED | `test_docker_run_build.py` 5/5 PASS; `test_prefix_order_documented` PASS; serving.yaml has `enable_prefix_caching: true`, `enable_chunked_prefill: true` |
| SERVE-08 | 01-01, 01-04 | KV budget calculated, gpu_memory_utilization=0.88, zero preemption | VERIFIED | `test_kv_budget_final` PASS (0.88 != 0.75); KV-finder 10 iterations documented; 30-min zero-preemption integration test passed in Phase B |
| SERVE-09 | 01-01, 01-05 | VLLM_NO_USAGE_STATS=1 + air-gap test passes | PARTIAL | Schema enforces VLLM_NO_USAGE_STATS="1" and HF_HUB_OFFLINE="1". D-12 validator committed. Air-gap CI workflow committed. Self-hosted runner NOT registered; CI job not executed. |
| SERVE-10 | 01-01, 01-03 | fastsafetensors boot | PARTIAL | Derived image layers fastsafetensors==0.1.14; cold-start 151-159s (< 240s ceiling). Integration test cold_start_time requires --run-slow (not run). Without fastsafetensors the NGC base takes ~3m08s. |
| SERVE-11 | 01-01, 01-04 | 2-hour sustained-load thermal validation | PARTIAL | One 2-hour replay run (record-floors): zero preemptions, zero OOM, p50=48.1 tok/s. Second --assert-floors run not evidenced. GPU clock sampler returns 0. |
| PROFILE-01 | 01-02 | Versioned, content-hashed bundle under profiles/<name>/v<N>/ | VERIFIED | `test_bundle_dir_exists` PASS; directory exists on disk |
| PROFILE-02 | 01-02 | {serving.yaml, harness.yaml, prompts/, tool_schemas/, grammars/, PROFILE_NOTES.md} | VERIFIED | `test_subpaths_present` PASS; all 7 paths present |
| PROFILE-03 | 01-02 | serving.yaml schema with engine+sampling+spec+quirks | VERIFIED | `test_serving_yaml_valid` PASS; pydantic v2 schema with all required fields |
| PROFILE-04 | 01-02 | harness.yaml hot-reloadable fields | VERIFIED | `test_harness_yaml_stub_valid` PASS; stub values load |
| PROFILE-05 | 01-02 | PROFILE_NOTES.md with citations | VERIFIED | `test_sources_cited` PASS; provenance tables with URLs |
| PROFILE-06 | 01-02, 01-05 | Profiles immutable; field change -> new version dir | VERIFIED | `test_immutability.py` 5/5 PASS; Layer 1 (validator), Layer 2 (pre-commit hook), Layer 3 (CI job) all in place |
| PROFILE-09 | 01-02, 01-03 | CI-validated schema + boot smoke test (SP_OK + tool_call + 100-token) | VERIFIED | `test_smoke_all_three` PASS; all three canaries confirmed live |
| EVAL-07 | 01-01, 01-03 | [SP_OK] canary infrastructure shipped for every later phase | VERIFIED | `emmy_serve.canary` package; `run_sp_ok`, `CanaryResult`, `log_canary_event` all present and exported; `test_canary.py` 3/3 PASS |
| REPRO-01 | 01-01, 01-03 | Pinned Docker image with digest + one-command start_emmy.sh | VERIFIED | `scripts/start_emmy.sh` exists and executable; digest pinned in serving.yaml; `test_start_script.py` 3 PASS |
| REPRO-03 | 01-01, 01-05 | Air-gap reproducibility CI test | PARTIAL | Workflow committed; code correct; self-hosted runner not registered; job not executed |
| REPRO-04 | 01-02, 01-05 | HF model downloads cached; runs offline once cached | PARTIAL | Schema enforces HF_HUB_OFFLINE="1"; serving.yaml has HF_HUB_OFFLINE=1. `test_offline_hf` integration test requires `--run-integration` on the Spark; not executed in this verification. |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `emmy_serve/thermal/sampler.py` | `GpuSampler.sample()` returns 0 for `clocks.current.graphics` — nvidia-smi subprocess parsing bug | Warning | GPU clock floor (SC-5 criterion) cannot be asserted; decode throughput floors (the functionally critical values) work correctly |
| `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` | `gpu_memory_utilization` column in provenance table still shows `0.75 (initial) → <FINAL> (post-finder)` placeholder text (line 44) | Info | Minor documentation gap; the frontmatter `measured_values.gpu_memory_utilization: 0.88` has the correct value; the table row was not updated when Plan 04 ran the finder |
| Multiple test files | 14 tests marked `pytest.mark.integration` without `--run-integration` flag automatically skip | Info | Normal behavior per conftest.py design; not a problem — test_zero_preemption, test_offline_hf, test_cold_start_time, test_airgap are gated on hardware |

---

### Human Verification Required

#### 1. Register Self-Hosted Runner + Trigger airgap.yml (SC-4 gate)

**Test:** On the DGX Spark: `sudo useradd -m -s /bin/bash emmy-ci && sudo usermod -aG docker emmy-ci`. Register the runner per `docs/ci-runner.md` with label `dgx-spark`. Push any branch touching `air_gap/**` to open a PR. Confirm the `profile-hash-integrity` job passes on ubuntu-latest and the `airgap-replay` job passes on the self-hosted runner, uploading a `runs/ci-airgap/airgap-report.json` artifact showing `passes: true`.

**Expected:** `airgap-replay` job completes with D-12 report: all four layers (a) no non-loopback interfaces, (b) DNS resolution of huggingface.co fails, (c) VLLM_NO_USAGE_STATS=1 + DO_NOT_TRACK=1, (d) HF_HUB_OFFLINE=1 + TRANSFORMERS_OFFLINE=1. 50-turn replay completes inside --network-none container. Zero outbound packets.

**Why human:** Physical DGX Spark + network interface + GitHub Actions runner registration cannot be automated from this executor.

#### 2. Second 2-hour Thermal Replay with --assert-floors (SC-5 floor reproducibility)

**Test:** Start emmy-serve, then run: `uv run ./scripts/thermal_replay.py --profile profiles/qwen3.6-35b-a3b/v1 --target-wall-time-s 7200 --assert-floors`. The run should exit 0 after 2 hours.

**Expected:** "All floors pass". `preemptions_hour2 == 0`, `oom_events == 0`, decode throughput p50 >= 44.7 tok/s (48.1 * 0.93), p1 >= 37.3 tok/s (41.4 * 0.90). Commit the run_id + hash to `PROFILE_NOTES.md validation_runs` as the second entry.

**Why human:** Requires 2 hours of sustained GPU time on DGX Spark. Cannot run programmatically without monopolizing the serving stack.

---

### Gaps Summary

**Three gaps block phase closure:**

1. **SC-1 throughput floor (60 tok/s)** — The most technically significant gap. Live measured throughput is 45-50 tok/s warm; the 60 tok/s SC-1 floor is not met and `test_throughput_floor` produces a documented FAIL. This has been carefully investigated across multiple experiments (MoE backend, prefix caching, attention backend) and determined to be architectural — Mamba+MoE+FP8 on vLLM 0.17.1+nvinternal on GB10, not a profile-knob issue. `PROFILE_NOTES.md` documents the gap and lists four resolution candidates (VLLM_USE_FLASHINFER_MOE_FP8 env knob, CUDA forward-compat overhead, FP8+Mamba experimental prefix-caching path, reasoning parser). This is a residual-gap finding, not missing work — all investigative steps were taken; the gap requires either a different vLLM build or a specific optimization flag not yet identified. A Phase 1.1 plan should address this before Phase 2 daily-driver use begins.

2. **SC-4 air-gap CI not executed** — All code is committed and correct. The gap is entirely an operator step: the self-hosted GitHub Actions runner on the DGX Spark has not been registered. The workflow, fixture, and validator are all tested in the unit tier; SC-4 requires hardware-level network isolation proof that can only come from the actual self-hosted run. This should be the first action when Phase 1 closes.

3. **SC-5 second thermal run + GPU clock sampler gap** — One 2-hour thermal replay ran and recorded floors (zero preemptions, zero OOM, decode throughput floors populated). The reproducibility confirmation (second --assert-floors run) was specified in the Phase B plan but is not evidenced in git. The GPU clock sampler bug is a secondary concern for SC-5 (the decode throughput floors are what --assert-floors actually asserts); the second run is the primary outstanding item.

**Root cause grouping:** Gap 2 (SC-4) and Gap 3's second thermal run are both operator-execution items requiring hardware access. Gap 1 (SC-1 throughput) requires a different technical approach. All three are documented honestly in PROFILE_NOTES.md with specifics.

**What IS fully delivered:** The profile schema and immutability system (SC-2) is complete and bulletproof — 24+ passing tests, 3-layer enforcement. The boot smoke test and canary infrastructure (SC-3, EVAL-07) are complete, live-verified, and reusable by every downstream phase. The KV-budget machinery and thermal replay harness code are complete with 47 passing tests and real measurements committed. The 50-turn air-gap fixture and D-12 validator are complete. The phase delivered everything that can be automated and verified in code; the three gaps are measurement/execution items.

---

_Verified: 2026-04-21_
_Verifier: Claude (gsd-verifier)_
