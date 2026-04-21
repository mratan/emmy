---
phase: 1
slug: serving-foundation-profile-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `01-RESEARCH.md` §11 "Validation Architecture"; planner refines per-task IDs when plans are written.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest ≥ 7.0 + pytest-asyncio (for httpx) |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` + repo-root `conftest.py` — Wave 0 creates both |
| **Quick run command** | `uv run pytest tests/unit -x` (unit tests only, no Docker, no network) |
| **Full suite command** | `uv run pytest tests/ -x --run-integration --run-airgap` |
| **Estimated runtime** | Unit ~5–10s · Integration ~5–10 min · Air-gap CI job ~20 min · Thermal replay 2h (out-of-band) |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest tests/unit -x` (target: < 10s feedback latency)
- **After every plan wave:** Run `uv run pytest tests/ -x --run-integration` (container spin-up)
- **Per PR on `emmy-serve/**`, `profiles/**`, `scripts/start_emmy.sh`, `scripts/smoke_test.py`:** Air-gap workflow on self-hosted Spark runner (D-10)
- **Per profile creation:** `scripts/find_kv_budget.py` (~70–110 min) + `scripts/thermal_replay.py` (2h) — results committed to `PROFILE_NOTES.md` + `runs/<iso>-phase1-validation/`
- **Before `/gsd-verify-work`:** Full suite + air-gap CI + 2-hour thermal replay all green
- **Max feedback latency:** 10 seconds for unit tier

---

## Per-Task Verification Map

> Planner fills Task IDs when plans are written. Table below is the Req-ID → test mapping extracted from RESEARCH.md §11; every Phase 1 task must reference at least one row here via `<automated>` or declare a Wave 0 dependency.

| Req ID | Behavior to verify | Test Type | Automated Command | File Exists | Status |
|--------|---------------------|-----------|-------------------|-------------|--------|
| SERVE-01 | NGC image digest matches `serving.yaml` at boot | unit | `pytest tests/unit/test_container_digest.py` | ❌ W0 | ⬜ pending |
| SERVE-02 | `/v1/models` 200 with `qwen3.6-35b-a3b` after boot | integration | `pytest tests/integration/test_boot.py::test_models_endpoint` | ❌ W0 | ⬜ pending |
| SERVE-02 | 100-token generation at ≥60 tok/s floor on Spark | integration | `pytest tests/integration/test_boot.py::test_throughput_floor` | ❌ W0 | ⬜ pending |
| SERVE-04 | `/v1/chat/completions` accepts `extra_body` | integration | `pytest tests/integration/test_boot.py::test_extra_body_passthrough` | ❌ W0 | ⬜ pending |
| SERVE-07 | `enable_prefix_caching` + `enable_chunked_prefill` present in rendered CLI flags | unit | `pytest tests/unit/test_docker_run_build.py` | ❌ W0 | ⬜ pending |
| SERVE-07 | Prefix-order rule documented in `PROFILE_NOTES.md`, honored by serving.yaml | unit | `pytest tests/unit/test_profile_notes.py::test_prefix_order_documented` | ❌ W0 | ⬜ pending |
| SERVE-08 | `gpu_memory_utilization` is NOT the placeholder 0.75 (came from finder) | unit | `pytest tests/unit/test_serving_yaml.py::test_kv_budget_final` | ❌ W0 | ⬜ pending |
| SERVE-08 | 30-min sustained load → zero preemption events | integration (slow) | `pytest tests/integration/test_kv_budget.py::test_zero_preemption --slow` | ❌ W0 | ⬜ pending |
| SERVE-09 | `VLLM_NO_USAGE_STATS=1` + `HF_HUB_OFFLINE=1` in container env | integration | `pytest tests/integration/test_airgap.py::test_env_usage_stats` | ❌ W0 | ⬜ pending |
| SERVE-09 | Zero outbound non-loopback packets during 50-turn replay | airgap CI | GitHub Actions air-gap job on self-hosted runner | ❌ W0 | ⬜ pending |
| SERVE-10 | `VLLM_LOAD_FORMAT=fastsafetensors` + cold-start < 4 min | integration | `pytest tests/integration/test_boot.py::test_cold_start_time` | ❌ W0 | ⬜ pending |
| SERVE-11 | 2-hour thermal replay meets recorded per-profile floors | scheduled | `scripts/thermal_replay.py --profile profiles/qwen3.6-35b-a3b/v1 --assert-floors` | ❌ W0 | ⬜ pending |
| PROFILE-01 | `profiles/qwen3.6-35b-a3b/v1/` exists with documented layout | unit | `pytest tests/unit/test_profile_layout.py` | ❌ W0 | ⬜ pending |
| PROFILE-02 | All required sub-paths present (`serving.yaml`, `harness.yaml`, `prompts/`, `tool_schemas/`, `grammars/`, `PROFILE_NOTES.md`) | unit | `pytest tests/unit/test_profile_layout.py::test_subpaths_present` | ❌ W0 | ⬜ pending |
| PROFILE-03 | `serving.yaml` schema loads; all required fields present; `extra='forbid'` | unit | `pytest tests/unit/test_schema.py::test_serving_yaml_valid` | ❌ W0 | ⬜ pending |
| PROFILE-04 | `harness.yaml` stub schema loads with placeholder values | unit | `pytest tests/unit/test_schema.py::test_harness_yaml_stub_valid` | ❌ W0 | ⬜ pending |
| PROFILE-05 | `PROFILE_NOTES.md` cites ≥1 source per non-trivial default | unit | `pytest tests/unit/test_profile_notes.py::test_sources_cited` | ❌ W0 | ⬜ pending |
| PROFILE-06 | Editing any file under v1 without bumping hash → validator exit 2 | unit | `pytest tests/unit/test_immutability.py` | ❌ W0 | ⬜ pending |
| PROFILE-09 | Boot smoke test asserts SP_OK echo + tool_call parse + 100-token generation | integration | `pytest tests/integration/test_boot.py::test_smoke_all_three` | ❌ W0 | ⬜ pending |
| EVAL-07 | `emmy.canary` module importable; `run_sp_ok` returns `(bool, str)` | unit | `pytest tests/unit/test_canary.py` | ❌ W0 | ⬜ pending |
| EVAL-07 | `CanaryResult` dataclass has fields every later phase needs | unit | `pytest tests/unit/test_canary.py::test_result_schema` | ❌ W0 | ⬜ pending |
| REPRO-01 | `start_emmy.sh` references pinned digest matching `serving.yaml` | unit | `pytest tests/unit/test_start_script.py::test_digest_match` | ❌ W0 | ⬜ pending |
| REPRO-03 | `.github/workflows/airgap.yml` present; self-hosted runner label | unit | `pytest tests/unit/test_workflows.py::test_airgap_yml_present` | ❌ W0 | ⬜ pending |
| REPRO-03 | 50-turn `air_gap/session.jsonl` validates against schema; covers every tool type | unit | `pytest tests/unit/test_session_jsonl.py` | ❌ W0 | ⬜ pending |
| REPRO-04 | With `HF_HUB_OFFLINE=1`, cached Qwen3.6 loads without HTTP | integration | `pytest tests/integration/test_offline_hf.py` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · W0 = blocked on Wave 0*

---

## Wave 0 Requirements

Test files + infrastructure that must exist before any implementation wave can meaningfully assert pass/fail.

- [ ] `pyproject.toml` — `[tool.pytest.ini_options]` block + `uv` venv setup
- [ ] `conftest.py` at repo root — shared fixtures (profile path, `base_url`, tmpdirs, docker-available skipif marker)
- [ ] `tests/unit/test_schema.py` — pydantic v2 models instantiate, `extra='forbid'` rejects unknown keys
- [ ] `tests/unit/test_hasher.py` — canonicalization (UTF-8 NFC, LF only, symlink reject, exclude list)
- [ ] `tests/unit/test_immutability.py` — validator exit codes for on-disk-vs-computed hash mismatch
- [ ] `tests/unit/test_docker_run_build.py` — `serving.yaml` → `docker run` CLI flag translation
- [ ] `tests/unit/test_profile_layout.py` — required sub-paths and files present
- [ ] `tests/unit/test_profile_notes.py` — frontmatter parses + source-cited rule
- [ ] `tests/unit/test_container_digest.py` — digest string in `serving.yaml` matches `start_emmy.sh`
- [ ] `tests/unit/test_serving_yaml.py` — post-finder `gpu_memory_utilization` is not the 0.75 placeholder
- [ ] `tests/unit/test_canary.py` — `emmy.canary` imports; `CanaryResult` schema + `run_sp_ok` contract
- [ ] `tests/unit/test_start_script.py` — `shellcheck` passes on `start_emmy.sh`; digest string match
- [ ] `tests/unit/test_workflows.py` — `.github/workflows/airgap.yml` YAML-validates; references `runs-on: [self-hosted, dgx-spark]`
- [ ] `tests/unit/test_session_jsonl.py` — 50-turn `air_gap/session.jsonl` validates and exercises every tool type
- [ ] `tests/integration/test_boot.py` — container up, `/v1/models` 200, smoke checks, 100-token generation, cold-start < 4 min, extra_body pass-through
- [ ] `tests/integration/test_airgap.py` — env vars asserted in running container, network mode is `none` (or netns with loopback-only), DNS audit
- [ ] `tests/integration/test_offline_hf.py` — `HF_HUB_OFFLINE=1` path loads cached weights without HTTP
- [ ] `tests/integration/test_kv_budget.py` — 30-minute run, zero preemption events in steady state
- [ ] Framework install: `uv pip install pytest pytest-asyncio httpx pydantic pyyaml prometheus-client`
- [ ] Self-hosted GitHub Actions runner registered on DGX Spark with label `[self-hosted, dgx-spark]`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 2-hour thermal replay floors hold | SERVE-11 | Wall-clock test runs out-of-band on Spark; cannot block per-commit CI on 2h runtime | `scripts/thermal_replay.py --profile profiles/qwen3.6-35b-a3b/v1 --assert-floors` then commit `runs/<iso>-phase1-validation/` digest + update `PROFILE_NOTES.md` floors |
| Physical air-gap sanity check | REPRO-03 | CI uses `--network none`/netns (structural proof); one-time physical cable-pull is the human sanity gate | Pull the network cable on Spark; run `start_emmy.sh`; confirm smoke passes and `ss -tuln` shows only loopback |
| First-pull NGC digest capture | REPRO-01 | Requires NGC pull, which must run on a box with network before digest is pinned | `docker pull nvcr.io/nvidia/vllm:26.03.post1-py3 && docker inspect ... | jq -r '.[0].RepoDigests[0]'` → paste into `serving.yaml.engine.container_image_digest` + `start_emmy.sh` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify command or an explicit Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all rows marked `❌ W0` above
- [ ] No watch-mode flags in quick/full commands
- [ ] Feedback latency < 10s for unit tier
- [ ] `nyquist_compliant: true` set in frontmatter once planner completes mapping
- [ ] Manual-only verifications have recorded operator steps + artifacts

**Approval:** pending
