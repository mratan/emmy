# Phase 1: Serving Foundation + Profile Schema - Research

**Researched:** 2026-04-20
**Domain:** vLLM serving container bring-up on DGX Spark + versioned model-profile schema
**Confidence:** HIGH (stack pre-researched in `.planning/research/STACK.md`; this document synthesizes existing research into phase-scoped prescriptive guidance and fills Claude's-Discretion gaps left by the 16 locked decisions)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

These 16 decisions (D-01..D-16) were locked during `/gsd-discuss-phase`. Research below builds *on top of* them. Do not re-litigate.

### Locked Decisions

#### Profile bundle v1 scope

- **D-01 (full-schema v1 with stubs):** v1 ships the full directory schema — `serving.yaml` fully populated, `harness.yaml` minimal-valid stub (required fields with Phase-2 placeholders + TODO comments), `prompts/` (smoke-test system prompt), `tool_schemas/` empty with `.gitkeep`, `grammars/` empty with `.gitkeep`, `PROFILE_NOTES.md`. Phase 2 fills stubs; does not reshape the directory.
- **D-02 (recursive content-hash):** SHA256 over a canonicalized manifest of `(relative_path, file_sha256)` tuples sorted by path, covering every file under `profiles/<name>/v<N>/`. Any file edit bumps the hash.
- **D-03 (strict validator from v1):** One validator, no phase-scoped flags. Required fields on both `serving.yaml` and `harness.yaml` must exist and type-check from v1 onward. Stubbed *values* are allowed as long as they pass the type check.
- **D-04 (validator + hasher only):** Phase 1 profile tooling is `emmy profile validate <path>` and `emmy profile hash <path>` (or equivalent). `new` / `diff` / `list` deferred to Phase 4.

#### Boot + smoke-test wiring

- **D-05 (external smoke test):** `start_emmy.sh` orchestrates `docker run` (unmodified NGC image) → poll `GET /v1/models` → run `scripts/smoke_test.py` (or equivalent) from the host against loopback. Success: ready banner + vLLM running. Failure: execute D-06.
- **D-06 (fail loud + roll back):** On any smoke check failure, dump a diagnostic bundle to `runs/boot-failures/<iso-timestamp>/` with: (a) which check failed, (b) assembled system prompt + user message, (c) full model response, (d) profile id/version/hash, (e) `docker logs` tail. Then `docker stop` and `exit 1`. Endpoint is never exposed to a harness if boot is rejected.
- **D-07 (literal `[SP_OK]` canary):** System template: `"When the user says 'ping' you must reply with the exact literal text [SP_OK] and nothing else."`. User: `"ping"`. Assertion: response contains `[SP_OK]`. Shipped as a library used by every later phase + every eval row (EVAL-07).
- **D-08 (hard-coded `read_file` tool-call):** Tool schema with one tool `read_file(path: string)`. User: `"call the tool read_file with path=/tmp/nothing.txt"`. Assertion: one `tool_calls` entry, `name == "read_file"`, `arguments` parses JSON with a `path` field.

#### Air-gap verification method

- **D-09 (network namespace isolation):** Primary mechanism — `docker run --network none` + loopback veth for harness↔serve, or `ip netns exec` around compose. Structural guarantee ("no network to send packets on"), not statistical. Falls back to live-network for normal dev.
- **D-10 (self-hosted CI on the Spark):** DGX Spark hosts the GitHub Actions runner that runs the air-gap workflow on every PR touching `emmy-serve/**`, `profiles/**`, or `scripts/start_emmy.sh`/`scripts/smoke_test.py`. Cloud CI runs schema/lint/unit only.
- **D-11 (50-turn scripted replay):** `air_gap/session.jsonl` — 50 deterministic prescribed turns mixing read/write/edit/bash/grep tool-call patterns. Replayed verbatim so the test measures the network, not the model. Must cover every tool type Phase 2 will expose.
- **D-12 (layered air-gap assertion):** (a) zero non-loopback packets (netns structural), (b) no DNS queries attempted, (c) `VLLM_NO_USAGE_STATS=1` in container env, (d) `HF_HUB_OFFLINE=1` in container env. All four must pass; any failure is a fail-loud boot reject with the layer identified.

#### Thermal + KV budget methodology

- **D-13 (automated KV-bisection finder):** `scripts/find_kv_budget.py`. Start `gpu_memory_utilization=0.75`; drive representative load for N minutes; watch vLLM preemption metric + `dmesg` OOM; bisect upward until first preemption; back off 5% for safety. Output: final value → `serving.yaml.engine.gpu_memory_utilization` + decision log in `PROFILE_NOTES.md`.
- **D-14 (prior-repo prompts + audit):** 2-hour thermal load = replay of `setup_local_opencode` Phase 1 prompts in a loop, with a planner-level audit (during plan-phase) to confirm representativeness of sustained thermal stress. If not representative → augment with synthetic filler or larger replay batch.
- **D-15 (per-profile measured floors):** Thermal pass criteria discovered empirically on first run, recorded in `PROFILE_NOTES.md`, then asserted on re-runs. Floors: (a) GPU clock p5 across hour 2, (b) decode throughput p50 + p1 across hour 2. Never a theoretical absolute; always the profile's own history.
- **D-16 (two locations for validated numbers):** Active values → `serving.yaml` + `PROFILE_NOTES.md` (profile self-contained). Raw logs (finder iterations, 2-hr timeseries, dmesg, throttle plots) → `runs/<iso>-phase1-validation/` referenced by path + content hash from `PROFILE_NOTES.md`. Retention policy TBD in plan-phase.

### Claude's Discretion (addressed below by section)

- Exact script names + directory layout inside `emmy-serve/` → §14
- Choice of language for `emmy-serve` and scripts (default Python per ARCHITECTURE.md §4) → §5, §14
- Whether `start_emmy.sh` uses raw `docker run` or docker compose → §1
- netns implementation details (custom `ip netns` vs `docker run --network none` + fake loopback vs podman) → §10
- Concrete 50-turn `air_gap/session.jsonl` content → §10
- KV-finder's specific load-driving mechanism during bisection → §8
- Exact form of `PROFILE_NOTES.md` (YAML frontmatter + markdown, or pure markdown) → §5

### Deferred Ideas (OUT OF SCOPE — ignore during planning)

- Full profile CLI (`emmy profile new / diff / list`) — Phase 4
- Grammar (XGrammar) parse-rate gate (SERVE-05) — Phase 2 (XGrammar is still on by default in Phase 1; only the SLA gate is deferred)
- Second profile (Gemma 4) — Phase 4
- Observability bus / Langfuse / OTel spans — Phase 3
- Tuning `max_num_batched_tokens` etc. for workload-specific latency — Phase 2 or 6
- Speculative decoding (Qwen3-MTP) — Phase 6; `serving.yaml` leaves `speculative: null` with a `PROFILE_NOTES.md` entry
- Reasoning content / thinking-tag handling — Phase 2
- `PROFILE_NOTES.md` linter — Phase 4 or Phase 7
- Content-retention policy for `runs/<iso>-phase1-validation/` — Phase 7

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SERVE-01 | NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3` on DGX Spark | §1 docker run template; §12 digest pinning |
| SERVE-02 | Qwen3.6-35B-A3B-FP8 served, ≥60 tok/s target | §1, §2 serving.yaml; §13 HF cache |
| SERVE-04 | OpenAI-compat `/v1/chat/completions` with `extra_body` | §7 tool-call smoke via `extra_body`; §2 reasoning_parser policy |
| SERVE-07 | Prefix caching + chunked prefill + documented prefix order | §2 `enable_prefix_caching: true`, `enable_chunked_prefill: true`; §5 prefix-order note in PROFILE_NOTES.md |
| SERVE-08 | KV-cache budget calculation, start at 0.75, zero-preemption gate | §8 KV-finder algorithm |
| SERVE-09 | `VLLM_NO_USAGE_STATS=1` + air-gap test passes | §1 env; §10 air-gap design |
| SERVE-10 | `VLLM_LOAD_FORMAT=fastsafetensors` | §1 env; §13 weight-load flow |
| SERVE-11 | 2-hour sustained-load thermal validation per profile | §9 thermal audit + replay harness |
| PROFILE-01 | Versioned, content-hashed bundle under `profiles/<name>/v<N>/` | §4 manifest format |
| PROFILE-02 | `{serving.yaml, harness.yaml, prompts/, tool_schemas/, grammars/, PROFILE_NOTES.md}` schema | §2, §3 schemas |
| PROFILE-03 | `serving.yaml` fields; engine changes require restart | §2 full field list |
| PROFILE-04 | `harness.yaml` hot-reloadable | §3 minimal stub fields |
| PROFILE-05 | `PROFILE_NOTES.md` provenance with citations | §5 format + content rules |
| PROFILE-06 | Immutable; field change → new version dir | §5 enforcement mechanism |
| PROFILE-09 | CI-validated schema + per-boot validation smoke test | §6 validator; §7 smoke test |
| EVAL-07 | `[SP_OK]` canary shipped here, used by every later phase | §7 `emmy.canary` module shape |
| REPRO-01 | Pinned Docker image digest + one-command `start_emmy.sh` | §12 digest pinning; §14 script layout |
| REPRO-03 | Air-gap reproducibility CI test | §10 full air-gap design |
| REPRO-04 | HF downloads cached; runs offline once cached | §13 HF cache story |

</phase_requirements>

---

## Summary

Phase 1 is the spine's root: one NGC container, one model, one profile bundle, one smoke test, one air-gap guarantee, one KV number, one thermal replay — plus the validator + hasher that enforce profile immutability. The stack is pre-researched in `.planning/research/STACK.md`; this document translates that research into phase-scoped prescriptive guidance and resolves the Claude's-Discretion items listed in CONTEXT.md with concrete recommendations.

**Primary recommendation:** Implement `emmy-serve` in Python (ARCHITECTURE.md §4 default; aligns with the prior `dgx_stack` loader pattern we inherit). Use **pydantic v2 with `ConfigDict(extra='forbid')`** for the profile schema validator (strict-from-v1 per D-03). Use **raw `docker run`** in `start_emmy.sh` (one less dependency than compose; docker compose adds no value for a single-container unmodified image). Pin the NGC container by **sha256 digest in `serving.yaml.engine.container_image_digest`** plus embed the same digest in `start_emmy.sh`'s `IMAGE_DIGEST` variable — validator asserts they match. Use **`docker run --network none` + `ip netns exec` wrapping** for the air-gap CI job (structural guarantee per D-09). Drive the KV-bisection finder (D-13) with a lightweight subset of the thermal replay to keep iterations under ~15 minutes each. Pre-populate the HF cache once online, then mount read-only into the container for all CI / production runs (REPRO-04).

---

## Architectural Responsibility Map

Phase 1 is all **serving-tier + build-tier** — the harness tier is explicitly Phase 2. This map is trivial for Phase 1 but included for consistency.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Model weight loading + inference | Serving (vLLM in Docker) | — | vLLM engine is the only thing that touches weights |
| OpenAI-compatible `/v1/chat/completions` | Serving (vLLM) | — | vLLM native; no proxy in Phase 1 |
| Profile schema validation + hashing | Build / CLI tool (host Python) | — | Runs pre-boot and in CI; not in the inference path |
| Smoke test (SP_OK + tool-call + 100-token) | Host harness (Python script) | — | Per D-05: external to container so NGC image stays unmodified |
| KV-budget finder (D-13) | Host harness (Python) | Serving (vLLM metrics endpoint) | Host drives load, reads `/metrics` |
| 2-hour thermal replay (D-14/D-15) | Host harness (Python) | Serving + `nvidia-smi` | Host drives load and samples GPU clocks |
| Air-gap enforcement (D-12) | Container env + OS (netns) | — | Structural; not code in the inference path |
| Profile immutability (D-03, PROFILE-06) | CI (pre-commit hook + validator) | File system | Enforcement is upstream of runtime |
| Diagnostic bundle (D-06) | Host harness (Python) | File system (`runs/boot-failures/`) | Host writes JSON + copies logs |

---

## Standard Stack

### Core (from STACK.md — already locked)

| Technology | Version | Purpose | Locked By |
|------------|---------|---------|-----------|
| NGC vLLM container | `nvcr.io/nvidia/vllm:26.03.post1-py3` | Serving runtime | STACK.md + SERVE-01 |
| Qwen3.6-35B-A3B-FP8 | HF repo `Qwen/Qwen3.6-35B-A3B-FP8` | Primary model | STACK.md + SERVE-02 |
| fastsafetensors | bundled (auto-install if missing) | Parallel weight loader | STACK.md + SERVE-10 |
| XGrammar | bundled with vLLM 0.19 (default backend) | Structured output (Phase-2 gate) | STACK.md |

### Phase 1 additions (host side — this is what the planner decides)

| Library | Purpose | Why Standard | Verification |
|---------|---------|--------------|--------------|
| **Python 3.11+** (host) | `emmy-serve` wrapper, validator, hasher, smoke test, KV-finder, thermal replay | ARCHITECTURE.md §4 default; prior `dgx_stack` in Python; pydantic v2 requires 3.8+ but 3.11 gives better exception groups for diagnostic bundles [VERIFIED: ARCHITECTURE.md §4] | `python3 --version` on DGX Spark |
| **pydantic v2** (≥ 2.5) | Profile schema validator (D-03 strict, extra='forbid') | Prior repo uses v2 with strict mode; faster than v1; `model_config = ConfigDict(extra='forbid')` is the idiomatic typo-safety pattern [VERIFIED: prior `dgx_stack/providers/config.py` per ARCHITECTURE.md §2] | `python3 -c "import pydantic; print(pydantic.VERSION)"` |
| **PyYAML** (≥ 6.0) | Parse `serving.yaml` / `harness.yaml` / `profile.yaml` | Standard; pydantic v2 integrates via `yaml.safe_load` → `ModelClass.model_validate(...)` | `python3 -c "import yaml; print(yaml.__version__)"` |
| **requests** or **httpx** | Smoke test HTTP client against `/v1/models`, `/v1/chat/completions` | httpx has better timeout/backoff ergonomics; either is fine for a single-user tool | [CITED: standard Python ecosystem] |
| **prometheus-client** (optional — only for metric *parsing*) | Parse vLLM `/metrics` Prometheus scrape for preemption counters (D-13) | vLLM exposes Prometheus-format metrics at `/metrics`; `prometheus_client.parser.text_string_to_metric_families` converts text to typed records | [CITED: prometheus_client docs] |
| **docker** (host CLI, not the SDK) | Shell out from `start_emmy.sh` / Python via `subprocess` | One-less-dependency principle; `docker run`, `docker logs`, `docker stop` are stable CLIs [ASSUMED — verify that planner agrees: the Python docker SDK is an option but adds a dependency] | `docker --version` |

### Alternatives Considered (and rejected for Phase 1)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| Python for `emmy-serve` | TypeScript/Node | The harness (Phase 2) is TS because pi-mono is TS. `emmy-serve` is a separate process on the host; mixing TS and Python here forces the validator and the harness to share a schema via JSON Schema export (workable but extra moving parts). ARCHITECTURE.md §4 already defaults to Python for the wrapper. Keep the harness TS / serve Python split. [CITED: ARCHITECTURE.md §4] |
| pydantic v2 for validator | `jsonschema` (draft 2020-12) | jsonschema is more "standard" but loses type narrowing in Python; worse error messages; no Python dataclass-like ergonomics. pydantic v2 with `extra='forbid'` gives us typo-safety and clean error strings for the diagnostic bundle. [CITED: pydantic v2 docs] |
| pydantic v2 for validator | `dataclasses-json` | No schema evolution story; no `extra='forbid'` equivalent; slower for nested validation. |
| Docker compose | Raw `docker run` | Single-container, unmodified NGC image, no network aliases, no multi-service composition. Compose adds a file + a dependency for zero benefit on a one-container deploy. `start_emmy.sh` stays shorter with raw `docker run`. [ASSUMED — planner can override if it has a compose-specific reason] |
| `docker run --network none` alone | `ip netns exec` wrapping the whole `docker run` command | `--network none` already removes all networking from the container; wrapping with `ip netns exec` adds a second layer (the container's namespace is already net-isolated inside the netns). For CI simplicity, **`--network none` is sufficient** when paired with a loopback-only veth between the two processes; `ip netns exec` only needed if the harness (Phase 2+) must share a netns with the serve container. Phase 1 tests the smoke-test tool itself against the loopback endpoint inside the container's network-less mode via `docker exec` — planner verifies this at plan time. |
| prometheus-client parsing | `grep`-based metric extraction | vLLM's Prometheus output is stable; grep works for one metric but prometheus-client gives named-metric lookup + labels. The KV-finder already uses Python; adding 1 dep is cheap. |

### Installation (host, one-time)

```bash
# Host Python deps for emmy-serve tooling (pyproject.toml or uv-managed venv)
uv venv .venv && source .venv/bin/activate
uv pip install 'pydantic>=2.5' 'pyyaml>=6' 'httpx>=0.27' 'prometheus-client>=0.20'

# Verify NGC image availability (one-time pull; D-12 requires this before CI can go offline)
docker pull nvcr.io/nvidia/vllm:26.03.post1-py3
docker inspect --format='{{index .RepoDigests 0}}' nvcr.io/nvidia/vllm:26.03.post1-py3
# → record this digest in serving.yaml.engine.container_image_digest (§12)
```

### Version verification

Before the planner locks versions in a lockfile, verify each package is current on the target DGX Spark:

```bash
python3 -c "import pydantic; print('pydantic', pydantic.VERSION)"
python3 -c "import yaml; print('pyyaml', yaml.__version__)"
python3 -c "import httpx; print('httpx', httpx.__version__)"
python3 -c "import prometheus_client; print('prometheus-client', prometheus_client.__version__)"
docker --version
```

Versions are HIGH confidence (standard Python ecosystem), but the DGX Spark's available Python may differ — the planner should read the actual installed version into `pyproject.toml`.

---

## Architecture Patterns

### System Architecture Diagram (Phase 1 only)

```
 ┌───────────────── DGX Spark (bare metal) ─────────────────────────────┐
 │                                                                       │
 │   ┌──────────────── Host process: emmy-serve tooling (Python) ────┐   │
 │   │  start_emmy.sh                                                │   │
 │   │    │                                                          │   │
 │   │    ├──► emmy.profile.validate  (D-04)                         │   │
 │   │    │      reads profiles/qwen3.6-35b-a3b/v1/{*.yaml, *.md}    │   │
 │   │    │      → pydantic schema → pass/fail                       │   │
 │   │    │                                                          │   │
 │   │    ├──► emmy.profile.hash      (D-02, D-04)                   │   │
 │   │    │      recursively hash every file under v1/               │   │
 │   │    │      → compare against profile.yaml.hash                 │   │
 │   │    │                                                          │   │
 │   │    ├──► docker run (unmodified NGC image)                     │   │
 │   │    │      mounts: profiles/ ro, /data/models ro,              │   │
 │   │    │              $HF_HOME ro, tmpfs /tmp                     │   │
 │   │    │      env:    VLLM_NO_USAGE_STATS=1,                      │   │
 │   │    │              VLLM_LOAD_FORMAT=fastsafetensors,            │   │
 │   │    │              HF_HUB_OFFLINE=1,                           │   │
 │   │    │              VLLM_FLASHINFER_MOE_BACKEND=latency          │   │
 │   │    │      args:   serving.yaml → vLLM CLI flags               │   │
 │   │    │      port:   loopback 127.0.0.1:8002:8000                │   │
 │   │    │                                                          │   │
 │   │    │           ┌───────── vLLM container ─────────┐           │   │
 │   │    │           │  vllm serve <model> <flags>      │           │   │
 │   │    │           │    /v1/models    /v1/chat/…      │           │   │
 │   │    │           │    /metrics (Prometheus)         │           │   │
 │   │    │           └────────────────┬─────────────────┘           │   │
 │   │    │                            │ HTTP loopback               │   │
 │   │    ├──► poll GET /v1/models (500ms interval, 300s timeout)    │   │
 │   │    │                            │                              │   │
 │   │    ├──► emmy.canary.ping   [SP_OK] smoke (D-07)  ─────────────┤   │
 │   │    ├──► emmy.canary.tool   read_file smoke (D-08)  ───────────┤   │
 │   │    ├──► emmy.canary.generate  100-token smoke  ───────────────┤   │
 │   │    │                                                          │   │
 │   │    │   on failure → diagnostic bundle (D-06):                 │   │
 │   │    │     runs/boot-failures/<iso>/                            │   │
 │   │    │       check.jsonl  prompt.txt  response.txt              │   │
 │   │    │       profile.json  docker-logs.txt                      │   │
 │   │    │   docker stop → exit 1                                   │   │
 │   │    │                                                          │   │
 │   │    └──► on success: print ready banner, leave vLLM running    │   │
 │   └────────────────────────────────────────────────────────────────┘  │
 │                                                                       │
 │   ┌─ filesystem ─────────────────────────────────────────────────┐    │
 │   │  profiles/qwen3.6-35b-a3b/v1/   (immutable; chattr +i in CI) │    │
 │   │  runs/boot-failures/<iso>/      (diagnostic bundles)         │    │
 │   │  runs/<iso>-kv-finder/          (KV bisection log, D-13)     │    │
 │   │  runs/<iso>-thermal/            (2-hour replay log, D-14/15)  │    │
 │   │  runs/<iso>-airgap/             (air-gap test artifact)      │    │
 │   │  $HF_HOME (HuggingFace cache)   (pre-populated, ro in CI)    │    │
 │   └──────────────────────────────────────────────────────────────┘    │
 │                                                                       │
 └───────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
emmy/
├── start_emmy.sh                      # D-05 orchestrator (bash)
├── pyproject.toml                     # host Python deps for emmy-serve tooling
├── emmy_serve/                        # D-04; Python package installable as `emmy`
│   ├── __init__.py
│   ├── cli.py                         # `emmy profile validate`, `emmy profile hash`
│   ├── profile/
│   │   ├── __init__.py
│   │   ├── schema.py                  # pydantic v2 models for serving/harness/profile/routes
│   │   ├── loader.py                  # YAML → pydantic; reject_unknown_keys pattern
│   │   ├── hasher.py                  # D-02 canonical manifest hasher
│   │   └── immutability.py            # D-03, PROFILE-06 enforcement helpers
│   ├── boot/
│   │   ├── runner.py                  # docker run builder + launch
│   │   └── probe.py                   # GET /v1/models polling, timeouts
│   ├── canary/                        # EVAL-07 — shipped here, imported by every later phase
│   │   ├── __init__.py                # exports: SPCanary, ToolCanary, GenCanary, assert_ok
│   │   ├── sp_ok.py                   # D-07 prompt template + assertion
│   │   ├── tool_call.py               # D-08 prompt template + tool_schemas/read_file.json
│   │   ├── generate.py                # 100-token smoke
│   │   └── logging.py                 # shared log format for Phase 2+ eval rows
│   ├── diagnostics/
│   │   └── bundle.py                  # D-06 diagnostic writer
│   ├── kv_finder/                     # D-13
│   │   ├── __init__.py
│   │   ├── bisect.py                  # start 0.75, bisect, 5% margin
│   │   ├── load_driver.py             # lightweight replay of prior Phase 1 prompts
│   │   └── metrics.py                 # vLLM /metrics + dmesg OOM scan
│   └── thermal/                       # D-14/D-15
│       ├── __init__.py
│       ├── replay.py                  # 2-hour loop harness
│       ├── sampler.py                 # GPU clock + throughput + preemption sampling
│       └── audit.py                   # D-14 representativeness characterization
├── scripts/
│   ├── find_kv_budget.py              # thin wrapper over emmy_serve.kv_finder (D-13)
│   ├── thermal_replay.py              # thin wrapper over emmy_serve.thermal (D-14)
│   ├── smoke_test.py                  # thin wrapper over emmy_serve.canary (D-05 invocation)
│   └── airgap_probe.py                # D-12 layered assertion probe
├── profiles/
│   └── qwen3.6-35b-a3b/
│       └── v1/
│           ├── profile.yaml           # D-01 manifest + computed hash
│           ├── serving.yaml           # D-01 fully populated (§2)
│           ├── harness.yaml           # D-01 minimal valid stub (§3)
│           ├── prompts/
│           │   └── system.md          # SP_OK canary system prompt
│           ├── tool_schemas/
│           │   ├── .gitkeep           # D-01 empty but present
│           │   └── read_file.json     # D-08 smoke-test tool schema (planner to decide if in v1 or in emmy_serve/canary/)
│           ├── grammars/
│           │   └── .gitkeep           # D-01 empty but present
│           └── PROFILE_NOTES.md       # D-01 provenance + measured-values log
├── air_gap/
│   └── session.jsonl                  # D-11 — 50 scripted turns
├── runs/                              # gitignored (D-16 retention TBD)
│   └── .gitignore                     # keep dir but ignore contents
└── .github/
    └── workflows/
        └── airgap.yml                 # D-10 self-hosted runner workflow
```

### Pattern 1: Strict typed-YAML loader with precedence chain (inherited)

**What:** Frozen dataclasses (or pydantic v2 models with `frozen=True`), strict schema with `extra='forbid'`, optional env/CLI overlay in precedence order `defaults < repo < user < env < CLI`.

**When to use:** Every YAML file read by Phase 1 — `serving.yaml`, `harness.yaml`, `profile.yaml`.

**Source:** ARCHITECTURE.md §2 "Established Patterns" — the prior dgx_stack `config/stack.yaml`, `dgx_stack/providers/config.py` loader. Adopt the shape; clean rewrite in pydantic v2.

```python
# emmy_serve/profile/schema.py — sketch
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal, Optional

class EngineConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    model: str
    served_model_name: str
    max_model_len: int = Field(gt=0)
    gpu_memory_utilization: float = Field(gt=0.0, le=1.0)
    enable_prefix_caching: bool = True
    enable_chunked_prefill: bool = True
    max_num_batched_tokens: int = Field(gt=0)
    kv_cache_dtype: Literal['auto', 'fp8', 'fp16', 'bf16'] = 'fp8'
    load_format: Literal['auto', 'fastsafetensors', 'safetensors'] = 'fastsafetensors'
    tool_call_parser: Optional[str] = None
    reasoning_parser: Optional[str] = None
    quantization: Optional[str] = None
    container_image: str
    container_image_digest: str  # §12 digest pinning

class SamplingDefaults(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    temperature: float = Field(ge=0.0, le=2.0)
    top_p: float = Field(gt=0.0, le=1.0)
    top_k: int = Field(ge=-1)
    repetition_penalty: float = Field(gt=0.0)
    max_tokens: int = Field(gt=0)
    stop: list[str] = Field(default_factory=list)

class ServingConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    engine: EngineConfig
    sampling_defaults: SamplingDefaults
    speculative: Optional[dict] = None  # Phase 6 territory; Phase 1 leaves None
    guided_decoding: dict = Field(default_factory=lambda: {'default_backend': 'xgrammar'})
    quirks: dict = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)  # container env overrides
```

### Pattern 2: Atomic JSON append for event streams (inherited)

**What:** Write to `<path>.tmp`, fsync, rename over target. Use for diagnostic bundles, KV-finder iteration log, thermal sampler log.

**Source:** prior `dgx_stack/runs/write.py` per ARCHITECTURE.md §2 "Established Patterns."

```python
# emmy_serve/diagnostics/atomic.py — sketch
import json, os, tempfile
from pathlib import Path

def write_json_atomic(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as tmp:
        json.dump(obj, tmp, sort_keys=True, indent=2)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = tmp.name
    os.replace(tmp_path, path)

def append_jsonl_atomic(path: Path, obj: dict) -> None:
    """For KV-finder iterations + thermal sampler."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True) + '\n'
    with open(path, 'a', buffering=1) as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())
```

### Anti-Patterns to Avoid

- **Bake sampling params / vLLM flags into `start_emmy.sh` instead of `serving.yaml`.** Kills the profile abstraction (ARCHITECTURE.md §6 anti-pattern 1, PITFALLS #14). The script reads YAML, period.
- **Mutate a v1 profile in place.** PROFILE-06 says no; §5 enforces this via chattr + pre-commit hook. Any "small tweak" is a new version.
- **Skip `HF_HUB_OFFLINE=1` and rely on "we already downloaded the model."** HF libraries still make HEAD requests to check for updates even on cached models [CITED: HF docs — see §13]. `HF_HUB_OFFLINE=1` makes it structural.
- **Call vLLM directly in the smoke test instead of through an OpenAI-compatible client.** SERVE-04 says the boundary is OpenAI-compat with `extra_body`. Smoke test must use the same path the Phase 2 harness will use.
- **Use a theoretical `gpu_memory_utilization` or copy one from another Spark user.** PITFALLS #1, D-13. Run the finder.

---

## 1. NGC Container Boot Shape — Canonical `docker run`

### Authoritative invocation

Based on STACK.md §"Installation" + all Phase 1 constraints (D-05, D-06, D-09, D-12; SERVE-01/02/04/07/09/10):

```bash
# $PROFILE_DIR = /data/projects/emmy/profiles/qwen3.6-35b-a3b/v1
# $MODELS_DIR  = /data/models                          (host weights, read-only in container)
# $HF_HOME     = /data/hf-cache                        (host HF cache, read-only in container)
# $RUN_ID      = 2026-04-21T14:23:11Z                  (iso timestamp for this boot)

docker run \
    --rm \
    --name emmy-serve \
    --gpus all \
    --shm-size=8g \
    --tmpfs /tmp:rw,size=8g \
    --network host \
    # ^^ host network is the NORMAL dev path. For air-gap (D-09) CI:
    #    --network none  (plus loopback veth between serve and harness, or
    #                     run smoke test via `docker exec` inside the container)
    -p 127.0.0.1:8002:8000 \
    # ^^ loopback-only bind; external clients cannot hit the endpoint
    # (omit when --network none; use `docker exec` for smoke tests)
    -e VLLM_NO_USAGE_STATS=1 \
    -e DO_NOT_TRACK=1 \
    -e VLLM_LOAD_FORMAT=fastsafetensors \
    -e VLLM_FLASHINFER_MOE_BACKEND=latency \
    -e VLLM_DISABLE_COMPILE_CACHE=1 \
    -e HF_HUB_OFFLINE=1 \
    -e HF_HOME=/hf-cache \
    -e TRANSFORMERS_OFFLINE=1 \
    -v "$MODELS_DIR:/models:ro" \
    -v "$HF_HOME:/hf-cache:ro" \
    -v "$PROFILE_DIR:/profile:ro" \
    -v "$(pwd)/runs/$RUN_ID:/runs:rw" \
    # Pin by digest for repro (§12). The planner can choose to resolve from
    # serving.yaml.engine.container_image_digest and bake it here.
    nvcr.io/nvidia/vllm@sha256:<DIGEST_FROM_serving.yaml> \
    vllm serve /models/Qwen3.6-35B-A3B-FP8 \
        --served-model-name qwen3.6-35b-a3b \
        --max-model-len 131072 \
        --gpu-memory-utilization "$KV_BUDGET" \
        --kv-cache-dtype fp8 \
        --enable-prefix-caching \
        --enable-chunked-prefill \
        --max-num-batched-tokens 16384 \
        --tool-call-parser qwen3_coder \
        --enable-auto-tool-choice \
        --load-format fastsafetensors \
        --host 0.0.0.0 \
        --port 8000
```

**Notes on each flag / env:**

| Flag / Env | Source | Rationale |
|------------|--------|-----------|
| `--rm` | best practice | Don't leak stopped containers; `start_emmy.sh` always wants a fresh container [ASSUMED] |
| `--name emmy-serve` | D-06 | `docker logs emmy-serve` tail + `docker stop emmy-serve` for roll-back [CITED: D-06] |
| `--gpus all` | STACK.md | DGX Spark has one GPU; `all` is fine [VERIFIED: STACK.md §"Installation"] |
| `--shm-size=8g` | STACK.md | NGC image default is small; vLLM workers need shm for worker IPC [VERIFIED: STACK.md] |
| `--tmpfs /tmp:rw,size=8g` | Safety + air-gap | Keeps vLLM's runtime scratch in RAM, avoids disk writes that could leak state across CI runs [ASSUMED — verify at boot] |
| `--network host` (dev) vs `--network none` (CI) | D-09 | Structural air-gap. See §10. |
| `-p 127.0.0.1:8002:8000` | SERVE-09 "loopback only" | External hosts cannot hit the endpoint; CONTEXT.md domain paragraph says "loopback" explicitly [CITED: CONTEXT.md domain] |
| `-e VLLM_NO_USAGE_STATS=1` | SERVE-09, D-12 | Disables vLLM's anonymous telemetry [VERIFIED: vLLM Usage Stats docs per PITFALLS.md sources] |
| `-e DO_NOT_TRACK=1` | belt-and-suspenders | vLLM honors both; setting both future-proofs against a rename [VERIFIED: vLLM Usage Stats docs] |
| `-e VLLM_LOAD_FORMAT=fastsafetensors` | SERVE-10 | 3.25× startup speedup (10m → 3m proven in prior repo) [VERIFIED: prior repo README.md "Fast model loading"] |
| `-e VLLM_FLASHINFER_MOE_BACKEND=latency` | STACK.md confidence MEDIUM | Throughput backend has SM121 kernel issues on GB10; verify still needed on `26.03.post1-py3` at boot [CITED: vLLM Forums NVIDIA DGX Spark thread per STACK.md]. If `latency` backend is fixed upstream, document in PROFILE_NOTES.md and drop. |
| `-e VLLM_DISABLE_COMPILE_CACHE=1` | STACK.md | Stable behavior across boots on DGX Spark; avoids stale compile cache bugs [CITED: STACK.md §"Installation"] |
| `-e HF_HUB_OFFLINE=1` | D-12, REPRO-04 | Hard-disables HF Hub HTTP calls; weights must already be cached. See §13. [VERIFIED: HF docs — "prevents HTTP calls to the Hub when loading a model"] |
| `-e HF_HOME=/hf-cache` | REPRO-04 | Explicit cache location; points to the mounted host path [CITED: HF docs] |
| `-e TRANSFORMERS_OFFLINE=1` | belt-and-suspenders | Older transformers code paths may ignore `HF_HUB_OFFLINE` on first-pass resolution; both env vars give structural coverage [CITED: HF Transformers installation docs] |
| `-v $MODELS_DIR:/models:ro` | REPRO-04 | Read-only mount of weight directory; container cannot mutate weights |
| `-v $HF_HOME:/hf-cache:ro` | REPRO-04 | Read-only HF cache for config.json / tokenizer files not duplicated under `/models` |
| `-v $PROFILE_DIR:/profile:ro` | PROFILE-01 | Read-only profile bundle mount (container has no authority to bump version) |
| `-v runs/$RUN_ID:/runs:rw` | D-06, D-16 | Writable for diagnostic output; scoped to a single run |
| `@sha256:<DIGEST>` | REPRO-01 | Immutable image reference. See §12. |

**Smoke-test wiring with `--network none`:** When running air-gap CI, the container has no network interface. Options:
1. **`docker exec`-based smoke:** Run `scripts/smoke_test.py` inside the container via `docker exec emmy-serve python3 /profile/../smoke.py` — inherits the loopback-only namespace naturally.
2. **Shared netns:** `docker run --network container:emmy-serve` for the smoke-test runner container, or `ip netns exec` both into the same namespace. More complex; only needed if the smoke test is itself a container.

Recommendation: **start with `docker exec`** (Phase 1 smoke test is a short Python script; running it inside the same container is simplest and still structural). Revisit if the smoke test grows a heavy dependency set that conflicts with NGC image contents.

### Docker run vs docker compose decision

Recommendation: **raw `docker run` in `start_emmy.sh`.** One less tool, one less config file, no composition value since we have a single service. If the planner wants compose later (e.g. to stand up Langfuse alongside in Phase 3), that's a Phase-3 upgrade — Phase 1 does not need it. [ASSUMED based on single-service-no-composition reasoning]

---

## 2. `serving.yaml` Schema — Concrete Field List

Built from ARCHITECTURE.md §2 (proposed schema), STACK.md installation flags, and Phase 1 deferrals (speculative=null per CONTEXT.md deferred list). Every field that maps to a vLLM CLI flag is documented with source.

```yaml
# profiles/qwen3.6-35b-a3b/v1/serving.yaml
# Consumed by emmy-serve at boot. Engine fields require vLLM restart (PROFILE-03).
# Every field has provenance in PROFILE_NOTES.md.

engine:
  # --- immutable identity ---
  model: /models/Qwen3.6-35B-A3B-FP8            # container-internal path (matches -v mount)
  model_hf_id: Qwen/Qwen3.6-35B-A3B-FP8         # for documentation + HF cache lookup
  served_model_name: qwen3.6-35b-a3b             # name vLLM exposes on /v1/models
  container_image: nvcr.io/nvidia/vllm:26.03.post1-py3
  container_image_digest: sha256:REPLACE_AT_FIRST_PULL  # §12; validator fails if "REPLACE_AT_FIRST_PULL"

  # --- context + memory ---
  max_model_len: 131072                          # 128K; well under 262K native, honest per CONTEXT-05
  gpu_memory_utilization: 0.75                   # STARTING VALUE for D-13; final value written by find_kv_budget.py
  kv_cache_dtype: fp8                            # STACK.md Qwen3.6 recipe
  enable_prefix_caching: true                    # SERVE-07
  enable_chunked_prefill: true                   # SERVE-07
  max_num_batched_tokens: 16384                  # STACK.md §"If latency is bottleneck" — interactive feel
  # Note: per SUMMARY.md "Gaps to Address", optimal max_num_batched_tokens for real coding prefills
  # (10-40K) is a measurement gap; 16384 is a reasonable starting value per STACK.md.

  # --- loader ---
  load_format: fastsafetensors                   # SERVE-10

  # --- quantization ---
  quantization: fp8                              # already quantized by Qwen; this flag is a vLLM hint

  # --- tool-call parser ---
  tool_call_parser: qwen3_coder                  # STACK.md line 94; VERIFIED for Qwen3.6 coder variant
  # Note: Qwen3.6 is the instruct/coder variant; STACK.md commands both `qwen3_coder` and
  # `qwen3` (reasoning parser). Alternative `hermes` works for Qwen3 non-coder variants;
  # the recipe explicitly recommends qwen3_coder for this model. [VERIFIED: STACK.md §"Installation"]
  enable_auto_tool_choice: true                  # required alongside tool_call_parser
  # Reasoning parser intentionally UNSET in Phase 1 — the CONTEXT.md deferred list puts
  # reasoning_content handling in Phase 2. Leaving reasoning_parser null = no extraction;
  # whatever the model emits lands in `content`. Phase 2 decides whether to set `qwen3`.

  # --- attention + backends ---
  attention_backend: flashinfer                  # STACK.md line 88 + GB10 requirement

  # --- network / runtime ---
  host: 0.0.0.0                                  # container-internal bind; docker -p does loopback
  port: 8000                                     # container-internal; host maps to 8002

  # --- what is NOT here (deferred) ---
  # speculative: null       — Phase 6 per CONTEXT.md deferred list; document in PROFILE_NOTES.md.
  # enable_lora: false      — no LoRA in v1
  # enable_thinking: false  — Phase 2 territory

sampling_defaults:
  # Primary source: Qwen3.6 model card on HuggingFace (STACK.md line 217-218).
  # These are PRIORS; harness per-tool sampling overrides them. Changing them = new profile version.
  temperature: 0.2                               # coding default; cites Qwen team blog 2026-04-16
  top_p: 0.95
  top_k: 40
  repetition_penalty: 1.05
  max_tokens: 8192
  stop: []                                        # let tool_call_parser handle stop tokens
  # Note: STACK.md shows `["</tool_call>", "<|im_end|>"]` as an example but for qwen3_coder's
  # <tools> XML format the parser handles delimiters itself. Planner verifies against Qwen3.6
  # chat template at plan time; adjust here if the parser needs explicit stops.

speculative: null                                # Phase 6 per CONTEXT.md deferred; PROFILE_NOTES.md must document the null

guided_decoding:
  default_backend: xgrammar                      # vLLM 0.19 default; STACK.md
  # Phase 1 enables XGrammar backend but does NOT gate on parse-rate SLA (Phase 2, SERVE-05).

quirks:
  strip_thinking_tags: false                     # Phase 1 leaves model output unaltered
  promote_reasoning_to_content: false            # Phase 2 may enable for qwen3 reasoning parser
  buffer_tool_streams: false                     # Phase 1: qwen3_coder parser streams natively
  # Note: the prior repo used `buffer_tool_streams: true` for Qwen via the compat_proxy,
  # but that was a workaround for Hermes XML streaming on vLLM 0.13. vLLM 0.19 + qwen3_coder
  # parser stream tool_calls as proper SSE deltas. If Phase 2 harness hits tool-stream issues,
  # re-enable and bump version. [ASSUMED — verify with a tool-call-in-streaming test at plan time]

env:
  # These reinforce the docker run env; validator warns if they contradict.
  VLLM_NO_USAGE_STATS: "1"
  DO_NOT_TRACK: "1"
  VLLM_LOAD_FORMAT: fastsafetensors
  VLLM_FLASHINFER_MOE_BACKEND: latency
  VLLM_DISABLE_COMPILE_CACHE: "1"
  HF_HUB_OFFLINE: "1"
  TRANSFORMERS_OFFLINE: "1"
```

### Deviations from ARCHITECTURE.md §2 (all deliberate)

| Field in ARCHITECTURE.md §2 | Phase 1 decision | Reason |
|-----------------------------|------------------|--------|
| `container_image_digest` | **Added** (not in §2) | REPRO-01 requires digest pinning; §12 of this research. |
| `model_hf_id` | **Added** | Humans read profile.yaml more than they read container internals; aids HF cache lookup. |
| `attention_backend: flashinfer` | **Added** | GB10-specific; STACK.md. |
| `speculative` | **Kept as null field** | CONTEXT.md deferred list. ARCHITECTURE.md §2 shows an example; Phase 1 leaves it null per D-16 and deferred list. |
| `reasoning_parser` | **Unset** | Phase 2 decides; §2 had it as a set field, but CONTEXT.md puts reasoning handling in Phase 2. |
| `enable_lora: false` | **Omitted** | Default is false; pydantic schema can elide if spec allows `extra='forbid'` but has optional fields. Keeps v1 minimal. |

### Fields the validator enforces (D-03 strict)

- All keys under `engine`, `sampling_defaults`, `guided_decoding`, `quirks`, `env` are known (pydantic `extra='forbid'`).
- `engine.container_image_digest` must match `^sha256:[0-9a-f]{64}$` — not the placeholder string.
- `engine.gpu_memory_utilization` ∈ (0.0, 1.0].
- `engine.max_model_len` > 0.
- `engine.load_format` ∈ {`auto`, `fastsafetensors`, `safetensors`}.
- `engine.kv_cache_dtype` ∈ {`auto`, `fp8`, `fp16`, `bf16`}.
- `sampling_defaults.temperature` ∈ [0.0, 2.0].
- `sampling_defaults.top_p` ∈ (0.0, 1.0].
- Cross-field: if `env.VLLM_NO_USAGE_STATS` is set, it must equal `"1"` (loud fail if `"0"` or `"true"`).
- Cross-field: `env.HF_HUB_OFFLINE` must equal `"1"` (REPRO-04 + D-12).

---

## 3. `harness.yaml` Minimal Stub (D-01)

Consumed by nothing in Phase 1 — but must type-check against the same pydantic schema as a filled harness.yaml (D-03). Each field gets a Phase-2 placeholder + TODO comment.

```yaml
# profiles/qwen3.6-35b-a3b/v1/harness.yaml
# Phase 1: minimal valid stub. Phase 2 fills real values. Every field present for type-check.

prompts:
  system: prompts/system.md                    # exists in Phase 1 (SP_OK canary uses it)
  edit_format: null                             # TODO(Phase-2): prompts/edit_format.md for Hashline
  tool_descriptions: null                       # TODO(Phase-2): prompts/tool_descriptions.md
  use_system_role: true                         # Qwen honors system role; see Pitfall #6 / D-07
  prepend_system_text: ""                       # TODO(Phase-2): global + project AGENTS.md layering

context:
  max_input_tokens: 120000                       # TODO(Phase-2): honest max per CONTEXT-05; this is a
                                                 #   placeholder less than max_model_len=131072
  include_repo_map: false                        # TODO(Phase-2): Aider-style ranked symbol map
  repo_map_max_tokens: 0                         # TODO(Phase-2): 4096 once repo-map ships
  default_pruning: head_tail                     # TODO(Phase-2): choose per compaction policy

tools:
  format: openai                                 # TODO(Phase-2): verify qwen3_coder over the wire
                                                 #   is OpenAI tool_calls after parsing (it is)
  schemas: null                                  # TODO(Phase-2): tool_schemas/default.json
  grammar: null                                  # TODO(Phase-2): grammars/tool_call.lark if SERVE-05
                                                 #   parse-rate benchmark shows need
  per_tool_sampling: {}                          # TODO(Phase-2): {edit: {temperature: 0.0}, ...}

agent_loop:
  max_iterations: 25                             # TODO(Phase-2): tune on daily-driver sessions
  retry_on_unparseable_tool_call: 2              # TODO(Phase-2): paired with SERVE-05 parse rate
  retry_on_empty_response: 1                     # TODO(Phase-2): Pitfall #6 — detect SP delivery fail
  self_correction: enabled                       # TODO(Phase-2): ReAct self-correction policy

advanced_settings_whitelist: []                  # TODO(Phase-2): Aider pattern; per model family
```

### Minimum required fields for type-check pass

The pydantic schema forces these present (cannot be missing; values may be placeholders):

- `prompts.system` — required string; Phase 1 uses `prompts/system.md` (which must exist for SP_OK canary)
- `prompts.use_system_role` — required bool
- `prompts.prepend_system_text` — required string (empty allowed)
- `context.max_input_tokens` — required int > 0
- `context.include_repo_map` — required bool
- `context.repo_map_max_tokens` — required int ≥ 0
- `context.default_pruning` — required enum (`head_tail` | `recency_window` | ... )
- `tools.format` — required enum (`openai` | `hermes` | ... )
- `tools.per_tool_sampling` — required dict (empty ok)
- `agent_loop.max_iterations` — required int > 0
- `agent_loop.retry_on_unparseable_tool_call` — required int ≥ 0
- `agent_loop.retry_on_empty_response` — required int ≥ 0
- `agent_loop.self_correction` — required enum (`enabled` | `disabled`)
- `advanced_settings_whitelist` — required list (empty ok)

Optional (nullable) fields where Phase 2 will fill:

- `prompts.edit_format` — Optional[str]
- `prompts.tool_descriptions` — Optional[str]
- `tools.schemas` — Optional[str]
- `tools.grammar` — Optional[str]

**No phase-scoped flags.** D-03 is strict from v1. The only leniency is that `Optional[...]` fields accept `null`. That is NOT a Phase-2 escape hatch — the schema is permanent. Phase 2 fills the nullable fields by bumping v1 → v2.

---

## 4. `profile.yaml` Content-Hash Manifest Format (D-02)

### Canonicalization rules — specific

1. **File discovery:** Walk `profiles/<name>/v<N>/` recursively. Include every regular file. Resolve order: alphabetical by POSIX-style forward-slash relative path, descent depth-first. Exclusions:
   - `.DS_Store`, `Thumbs.db`, `desktop.ini`, `*.swp`, `*.swo`, `*~`, `.*.swp` — editor/OS noise; project `.gitignore` must also exclude them.
   - Symbolic links → **reject with error**. Profile bundles have no legitimate use for symlinks; they break hash determinism. Validator fails hard.
   - Dot-hidden files under the bundle root — **include** `.gitkeep` (D-01 requires it). Reject any other dot-file with an explicit error message.

2. **Relative paths:** POSIX forward-slash (`/`), no leading `./`. Example: `prompts/system.md`, not `./prompts/system.md` or `prompts\system.md` on Windows.

3. **Text-file normalization (applies to `.md`, `.yaml`, `.yml`, `.json`, `.lark`, `.txt`):**
   - UTF-8 encoding required; non-UTF-8 → validator error.
   - Unicode NFC normalization applied before hashing.
   - Line endings normalized to LF (`\n`). CRLF and CR → LF.
   - **No trailing whitespace stripping; no final newline enforcement.** These are the *author's* choices; validator will warn but hash the file as-is. Rationale: we don't want to silently mutate the author's bytes.

4. **Binary files:** hashed byte-for-byte, no normalization.

5. **File-identification for text vs binary:** by extension allowlist (`.md`, `.yaml`, `.yml`, `.json`, `.lark`, `.txt`, `.py`). Anything else is treated as binary. Planner documents the list in `PROFILE_NOTES.md` to make it explicit.

6. **Per-file hash:** SHA256 of the bytes *after* the normalization above.

7. **Manifest:** A list of `(relative_path: str, file_sha256: str)` tuples, sorted lexicographically by `relative_path`.

8. **Canonical manifest text:** one tuple per line, format `{relative_path}\t{file_sha256}\n`. Tab-separated. Exact final newline after last line.

9. **Profile hash:** SHA256 of the canonical manifest text (UTF-8).

10. **`profile.yaml.hash`:** string `sha256:<64-hex>`.

### Example

```
# Canonical manifest (what gets hashed to produce profile.yaml.hash):
PROFILE_NOTES.md	4a7b3c9d8e5f1a2b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b
grammars/.gitkeep	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
harness.yaml	a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
prompts/system.md	deadbeefcafef00d...
serving.yaml	cafef00ddeadbeef...
tool_schemas/.gitkeep	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

# sha256(manifest_text) → profile hash
profile.yaml.hash: sha256:<64-hex-of-above>
```

### `profile.yaml` structure

```yaml
# profiles/qwen3.6-35b-a3b/v1/profile.yaml
profile:
  id: qwen3.6-35b-a3b
  version: v1
  family: qwen3.6
  base_model: Qwen/Qwen3.6-35B-A3B-FP8
  description: "Qwen3.6-35B-A3B-FP8 primary coding profile, Phase 1 baseline"
  created: "2026-04-20"
  hash: sha256:<computed-by-emmy-profile-hash>
  hash_algorithm: sha256
  hash_manifest_version: 1            # bump if canonicalization rules change
  tags: [coding, dgx-spark, fp8, qwen3.6]
  community_sources:
    # populated per PROFILE-05; see §5
    - title: "Qwen3.6 release blog"
      url: "https://qwen.ai/blog?id=qwen3.6"
      retrieved: "2026-04-18"
    - title: "vLLM Qwen3.5/3.6 recipes"
      url: "https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html"
      retrieved: "2026-04-18"
```

### Reference implementation sketch

```python
# emmy_serve/profile/hasher.py
import hashlib, unicodedata
from pathlib import Path

TEXT_EXTS = {'.md', '.yaml', '.yml', '.json', '.lark', '.txt', '.py'}
EXCLUDE_NAMES = {'.DS_Store', 'Thumbs.db', 'desktop.ini'}
EXCLUDE_SUFFIXES = ('.swp', '.swo', '~')

def _should_exclude(p: Path) -> bool:
    name = p.name
    if name in EXCLUDE_NAMES:
        return True
    if any(name.endswith(s) for s in EXCLUDE_SUFFIXES):
        return True
    # Allow only .gitkeep among dot-files
    if name.startswith('.') and name != '.gitkeep':
        return True
    return False

def _normalize_text(raw: bytes) -> bytes:
    text = raw.decode('utf-8')              # raises on non-UTF-8
    text = unicodedata.normalize('NFC', text)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    return text.encode('utf-8')

def _hash_file(p: Path) -> str:
    if p.is_symlink():
        raise ValueError(f'symlink not allowed in profile: {p}')
    raw = p.read_bytes()
    if p.suffix in TEXT_EXTS:
        raw = _normalize_text(raw)
    return hashlib.sha256(raw).hexdigest()

def hash_bundle(bundle_dir: Path) -> str:
    items: list[tuple[str, str]] = []
    for p in sorted(bundle_dir.rglob('*')):
        if not p.is_file():
            continue
        if _should_exclude(p):
            continue
        rel = p.relative_to(bundle_dir).as_posix()
        items.append((rel, _hash_file(p)))
    items.sort(key=lambda t: t[0])
    manifest = ''.join(f'{rel}\t{sha}\n' for rel, sha in items)
    return 'sha256:' + hashlib.sha256(manifest.encode('utf-8')).hexdigest()
```

### Pitfalls to prevent

- **Editor swap files.** `.gitignore` must list `*.swp`, `*~`, `.DS_Store`, `Thumbs.db`. The hasher exclusion list is a defense-in-depth layer.
- **Line-ending churn.** `.gitattributes` at repo root should declare `* text=auto eol=lf` for the `profiles/` tree so Git stores LF consistently regardless of OS.
- **`hash_manifest_version` bump.** If the canonicalization rules change (e.g. add `.toml` to text exts), bump this field and document in `PROFILE_NOTES.md`. Old profiles keep computing under their `hash_manifest_version`.

---

## 5. `PROFILE_NOTES.md` Format + Profile Immutability Enforcement

### `PROFILE_NOTES.md` format

Recommendation: **pure markdown with a YAML frontmatter block for measured values.** The frontmatter is machine-readable for tooling (future `emmy profile diff`); the markdown is human-readable provenance.

```markdown
---
profile_id: qwen3.6-35b-a3b
profile_version: v1
created: 2026-04-20
hardware_id: dgx-spark-01                      # filled at first measurement
measured_values:
  gpu_memory_utilization: null                  # D-13 fills this
  gpu_clock_p5_hour2_mhz: null                   # D-15 fills this
  decode_throughput_p50_hour2_tokps: null        # D-15 fills this
  decode_throughput_p1_hour2_tokps: null         # D-15 fills this
  cold_start_seconds: null                       # measured at first boot
  warm_throughput_tokps: null                    # smoke-test 100-token generation
validation_runs:
  - run_id: null                                 # runs/<iso>-phase1-validation/ reference
    hash: null                                   # content hash of the run directory
---

# Qwen3.6-35B-A3B-FP8 — v1 Profile Notes

Phase 1 baseline profile. Qwen3.6-35B-A3B-FP8 (Qwen MoE, 3B active) served in
`nvcr.io/nvidia/vllm:26.03.post1-py3` on a DGX Spark.

## Provenance of defaults (PROFILE-05)

Every non-trivial default in `serving.yaml` and `harness.yaml` is sourced below.

### Engine

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `container_image` | `nvcr.io/nvidia/vllm:26.03.post1-py3` | [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm) | 2026-04-18 |
| `container_image_digest` | sha256:<DIGEST> | `docker inspect` after first pull | 2026-04-20 |
| `load_format: fastsafetensors` | Set | STACK.md + [prior repo README.md "Fast model loading"](/data/projects/setup_local_opencode/README.md) | 2026-04-20 |
| `kv_cache_dtype: fp8` | Set | [vLLM Qwen3.5/3.6 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) | 2026-04-18 |
| `tool_call_parser: qwen3_coder` | Set | [vLLM Qwen3 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) — Qwen3-Coder XML format | 2026-04-18 |
| `attention_backend: flashinfer` | Set | [NVIDIA DGX Spark vLLM thread](https://discuss.vllm.ai/t/nvidia-dgx-spark-compatibility/1756) | 2026-04-18 |
| `enable_prefix_caching: true` | Set | SERVE-07 project requirement + vLLM 0.19 default behavior | — |
| `enable_chunked_prefill: true` | Set | SERVE-07 + vLLM 0.19 V1 default | — |
| `gpu_memory_utilization` | 0.75 (initial) → <FINAL> (post-finder) | D-13 automated finder; see [runs/<iso>-kv-finder](#) | 2026-04-?? |

### Sampling

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `temperature: 0.2` | Set | [Qwen3.6 HF model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) sampling defaults | 2026-04-18 |
| `top_p: 0.95` | Set | Qwen3.6 HF model card | 2026-04-18 |
| `top_k: 40` | Set | Qwen3.6 HF model card | 2026-04-18 |
| `repetition_penalty: 1.05` | Set | Qwen3.6 HF model card | 2026-04-18 |

### Why `speculative: null`

Speculative decoding (Qwen3-MTP) deferred to Phase 6 per ROADMAP.md + PITFALLS.md #4.
Paired spec-on/spec-off benchmark is the gate; we don't have the eval harness until
Phase 5, so measuring correctly isn't possible yet. No-spec baseline is recorded
here as the Phase 1 measured throughput.

## Prefix-order policy (SERVE-07)

Prompts are assembled in this order, never reordered, for maximum KV-cache reuse:

1. System prompt (static across a session)
2. AGENTS.md / project context (static across a session)   ← Phase 2 fills
3. Tool definitions (static across a session)              ← Phase 2 fills
4. Conversation history (grows turn-by-turn)
5. Latest user message

Reordering any of 1-3 busts prefix cache. This rule is a profile contract.

## Measured-values log (D-15, D-16)

| Measurement | Value | Method | Run artifact |
|-------------|-------|--------|--------------|
| `gpu_memory_utilization` (final) | <filled by D-13> | `scripts/find_kv_budget.py` | [`runs/<iso>-kv-finder/`](#) |
| GPU clock floor p5 hour 2 | <filled> MHz | `scripts/thermal_replay.py` | [`runs/<iso>-thermal/`](#) |
| Decode throughput p50 hour 2 | <filled> tok/s | `scripts/thermal_replay.py` | [`runs/<iso>-thermal/`](#) |
| Decode throughput p1 hour 2 | <filled> tok/s | `scripts/thermal_replay.py` | [`runs/<iso>-thermal/`](#) |
| Cold-start (fastsafetensors) | <filled> s | `start_emmy.sh` timing | [`runs/<iso>-thermal/`](#) |

## Validation runs (D-16)

| Run ID | Date | Purpose | Hash |
|--------|------|---------|------|
| <filled> | <date> | Initial Phase 1 validation | <sha256> |

## Deferred / future

- Spec decode (Phase 6); when enabled, bump to v2 with `speculative:` block and paired benchmark recorded here.
- `reasoning_parser` (Phase 2 will decide); if set, bump version.
- Per-tool sampling overrides (Phase 2 fills `harness.yaml.tools.per_tool_sampling`).
```

### Profile immutability enforcement (D-03, PROFILE-06)

Three layers of defense, in order of reliability:

#### Layer 1: validator-enforced recompute-vs-stored hash (always on)

Every time `emmy profile validate <path>` or `emmy profile hash <path>` runs, it:
1. Recomputes the bundle hash per §4.
2. Loads `profile.yaml.hash`.
3. If they mismatch → **exit 1** with a clear error:
   ```
   ERROR: profile hash mismatch for profiles/qwen3.6-35b-a3b/v1/
     stored (profile.yaml):  sha256:a1b2c3...
     computed (just now):    sha256:d4e5f6...
   Any edit to v1 after creation is disallowed (D-03, PROFILE-06).
   To change this profile, create profiles/qwen3.6-35b-a3b/v2/ with your edits.
   ```

This is the reliable layer — it works for everyone who runs the validator.

#### Layer 2: git pre-commit hook (catches at commit time)

A `.githooks/pre-commit` script that fails the commit if any staged change under `profiles/*/v*/` is accompanied by a mismatched `profile.yaml.hash`. Hook code runs `emmy profile validate` for every changed bundle. If the hash isn't recomputed and committed alongside the edit, the commit is rejected.

Install via `git config core.hooksPath .githooks` — the planner documents this in the `README.md` and the `start_emmy.sh` on first run warns if `core.hooksPath` is unset.

Weakness: hooks can be bypassed with `--no-verify`. That's why we have layer 3.

#### Layer 3: CI assertion (enforces server-side)

The air-gap workflow (D-10, self-hosted runner) includes a "profile hash integrity" job that runs `emmy profile validate profiles/**/v*/` on every PR. Any mismatch fails CI. This is the real enforcement — `--no-verify` on the developer's box doesn't escape it.

**Recommendation against `chattr +i` (filesystem immutable bit):** it's tempting but impractical — requires root, breaks developer workflows (moving the checkout, running git gc), and doesn't protect against `rm -rf` + recreate. The 3-layer validator chain is enough for a single-user tool + a research artifact reviewed via git.

#### Validator CLI behavior spec

```
emmy profile validate <path>
  --fix-hash          # rewrite profile.yaml.hash to the computed value (dev convenience; not in CI)
  --strict            # default; any warning becomes error

Exit codes:
  0 — schema OK, hash matches, all ok
  1 — schema validation error (missing field, wrong type, unknown key, etc.)
  2 — hash mismatch (body edited, hash not updated — D-03 violation)
  3 — symlink found, non-UTF-8 text file, or other canonicalization-rule violation
  4 — cross-field policy failure (e.g. env.VLLM_NO_USAGE_STATS != "1")

emmy profile hash <path>
  --write             # write the computed hash into profile.yaml (dev tool; used once on profile creation)
  --check             # default; compare and report

Exit codes:
  0 — hash matches
  1 — mismatch (detail in stderr)
  2 — canonicalization error (symlink, non-UTF-8, etc.)
```

Planner decides whether `--fix-hash` and `--write` exist or are blocked behind an env flag so they can't accidentally run in CI.

---

## 6. Schema Validator Strategy

Recommendation: **pydantic v2 with `ConfigDict(extra='forbid', frozen=True)` on every model.** Confidence HIGH.

### Rationale

- **Prior repo uses it successfully.** ARCHITECTURE.md §2 "Established Patterns" calls out the `_reject_unknown_keys` pattern from `dgx_stack/providers/config.py` + frozen dataclasses. pydantic v2 is the modern equivalent with better error messages and JSON Schema export.
- **`extra='forbid'`** gives typo safety — `guided_decodnig:` in YAML becomes a loud validation error instead of a silent nothing.
- **`frozen=True`** makes instances hashable and prevents accidental mutation in Python code — a nice defense-in-depth for the immutability story.
- **JSON Schema export** (`ModelClass.model_json_schema()`) is free — useful for eventually exposing the schema to IDEs / docs / a future TypeScript validator in the Phase 2 harness.
- **Error messages** are human-readable; fits neatly into the D-06 diagnostic bundle.

### Alternatives considered

| Option | Why not |
|--------|---------|
| `jsonschema` (draft 2020-12) | No type narrowing in Python; worse DX for the CLI; no free Python-typed models. |
| `dataclasses-json` | No strict unknown-key rejection; slower on nested; less ergonomic error reporting. |
| `attrs` + manual validation | More manual work than pydantic v2 for zero benefit. |

### Required-but-stubbed fields without a phase flag (D-03)

The schema does *not* have a "phase 1 mode." All `harness.yaml` fields that Phase 2 fills are modeled as either:
- **Required with a sensible default that type-checks** (e.g. `context.max_input_tokens: int = Field(gt=0)` — Phase 1 v1 sets 120000 as placeholder), or
- **`Optional[T] = None`** (e.g. `prompts.edit_format: Optional[str] = None`) — the schema permanently allows null for fields that conceptually *can* be absent (no edit format → no edit format).

No `skip_validation_if_phase == 1` flag. If Phase 3 adds a new required field, that's a schema evolution → bump v1 → v2 in every existing profile and migrate (which for Phase 1 we don't have other v1's of).

---

## 7. Boot Smoke-Test Wiring — Concrete Design

### 7.1 Poll `GET /v1/models`

```python
# emmy_serve/boot/probe.py
import httpx, time
from pathlib import Path

def wait_for_vllm(base_url: str, timeout_s: int = 300, interval_s: float = 0.5) -> dict:
    """Poll /v1/models until 200 OK or timeout. Returns parsed JSON."""
    deadline = time.monotonic() + timeout_s
    last_err = None
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f'{base_url}/v1/models', timeout=5.0)
            if r.status_code == 200:
                return r.json()
            last_err = f'HTTP {r.status_code}: {r.text[:200]}'
        except httpx.HTTPError as e:
            last_err = str(e)
        time.sleep(interval_s)
    raise TimeoutError(f'/v1/models did not respond in {timeout_s}s; last error: {last_err}')
```

Parameters:
- **timeout:** 300 seconds (5 minutes) — covers fastsafetensors cold start (~3 min per prior repo) + CUDA graph capture.
- **interval:** 500 ms — tight enough to be responsive; loose enough to not hammer the boot-time vLLM.
- **Backoff:** none; constant interval is fine for a 300s window.
- **Start delay:** planner may add 10s wait after `docker run` before first poll to avoid polling while Docker is still printing container-start noise.

### 7.2 SP_OK canary (D-07) — exact payload

```python
# emmy_serve/canary/sp_ok.py
SP_OK_SYSTEM_PROMPT = (
    "When the user says 'ping' you must reply with the exact literal text "
    "[SP_OK] and nothing else."
)
SP_OK_USER_MESSAGE = "ping"
SP_OK_ASSERTION_SUBSTR = "[SP_OK]"   # case-sensitive; `in` check on response text

def run_sp_ok(base_url: str, served_model_name: str) -> tuple[bool, str]:
    """Returns (ok, full_response_text)."""
    payload = {
        "model": served_model_name,
        "messages": [
            {"role": "system", "content": SP_OK_SYSTEM_PROMPT},
            {"role": "user", "content": SP_OK_USER_MESSAGE},
        ],
        "temperature": 0.0,                # deterministic
        "max_tokens": 32,
        "stream": False,
    }
    r = httpx.post(f'{base_url}/v1/chat/completions', json=payload, timeout=60.0)
    r.raise_for_status()
    text = r.json()['choices'][0]['message']['content'] or ''
    return (SP_OK_ASSERTION_SUBSTR in text), text
```

### 7.3 Tool-call smoke (D-08) — exact tool schema + request

The tool schema is a single-tool array in OpenAI format (which is what `qwen3_coder` parser normalizes to on output, even though the model emits `<tools>` XML on the wire):

```json
// emmy_serve/canary/tool_schemas/read_file.json  (or profiles/<id>/v1/tool_schemas/read_file.json)
{
  "type": "function",
  "function": {
    "name": "read_file",
    "description": "Read the contents of a file at the given absolute path.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Absolute filesystem path of the file to read."
        }
      },
      "required": ["path"],
      "additionalProperties": false
    }
  }
}
```

```python
# emmy_serve/canary/tool_call.py
import json, httpx
from pathlib import Path

TOOL_CALL_SYSTEM_PROMPT = (
    "You have one tool available: read_file(path: string). "
    "When the user asks you to call a tool, call it. Do not explain."
)
TOOL_CALL_USER_MESSAGE = "call the tool read_file with path=/tmp/nothing.txt"

def run_tool_call(base_url: str, served_model_name: str, tool_schema: dict) -> tuple[bool, dict]:
    payload = {
        "model": served_model_name,
        "messages": [
            {"role": "system", "content": TOOL_CALL_SYSTEM_PROMPT},
            {"role": "user", "content": TOOL_CALL_USER_MESSAGE},
        ],
        "tools": [tool_schema],
        "tool_choice": "auto",
        "temperature": 0.0,
        "max_tokens": 128,
        "stream": False,
    }
    r = httpx.post(f'{base_url}/v1/chat/completions', json=payload, timeout=60.0)
    r.raise_for_status()
    msg = r.json()['choices'][0]['message']
    tcs = msg.get('tool_calls') or []
    if len(tcs) != 1:
        return False, msg
    tc = tcs[0]
    if tc.get('function', {}).get('name') != 'read_file':
        return False, msg
    try:
        args = json.loads(tc['function']['arguments'])
    except (json.JSONDecodeError, KeyError, TypeError):
        return False, msg
    if 'path' not in args:
        return False, msg
    return True, msg
```

**On vLLM 0.19.x + qwen3_coder parser:** the model emits `<tools>{"name":"read_file","arguments":{"path":"/tmp/nothing.txt"}}</tools>` on the wire; vLLM's `qwen3_coder` tool-call parser extracts and reshapes it into OpenAI `tool_calls` format in the response. This is the path SERVE-04 uses. [VERIFIED: vLLM tool calling docs + qwen3_coder parser issue (#32926) — confirms `<tools>` XML → OpenAI `tool_calls` translation]

### 7.4 100-token generation smoke

```python
# emmy_serve/canary/generate.py
def run_generate(base_url: str, served_model_name: str) -> tuple[bool, dict, float]:
    """Verify the engine can actually decode 100 tokens in reasonable time."""
    payload = {
        "model": served_model_name,
        "messages": [{"role": "user", "content": "Count from 1 to 100, one number per line."}],
        "temperature": 0.0,
        "max_tokens": 100,
        "stream": False,
    }
    t0 = time.monotonic()
    r = httpx.post(f'{base_url}/v1/chat/completions', json=payload, timeout=120.0)
    elapsed = time.monotonic() - t0
    r.raise_for_status()
    data = r.json()
    out = data['choices'][0]['message']['content'] or ''
    # Basic sanity: ~100 tokens generated, non-empty content
    finish = data['choices'][0].get('finish_reason')
    ok = bool(out) and finish in ('length', 'stop') and len(out) > 50
    return ok, data, elapsed
```

### 7.5 Diagnostic bundle (D-06) — directory + contents

When any of the above returns `ok == False`, write:

```
runs/boot-failures/2026-04-21T14-23-11Z/
├── check.json                  # {"check": "sp_ok"|"tool_call"|"generate", "reason": "<msg>"}
├── profile.json                # {"id": "qwen3.6-35b-a3b", "version": "v1", "hash": "sha256:..."}
├── prompt.txt                  # assembled system + user + tools the smoke test sent
├── response.txt                # full model response text (content + tool_calls JSON)
├── response.json               # full vLLM JSON response for deeper inspection
├── docker-logs.txt             # last 5000 lines of `docker logs emmy-serve`
├── env.json                    # serving env vars + container_image_digest
└── metrics-snapshot.txt        # curl http://localhost:8002/metrics at failure time
```

Writer code uses the `write_json_atomic` pattern from §Architecture Pattern 2. After writing:

```bash
docker stop emmy-serve
exit 1
```

with a clear stderr message pointing to `runs/boot-failures/<iso>/`.

### 7.6 `emmy.canary` package shape (EVAL-07)

Exported API for every later phase:

```python
# emmy_serve/canary/__init__.py
from .sp_ok import run_sp_ok, SP_OK_SYSTEM_PROMPT, SP_OK_ASSERTION_SUBSTR
from .tool_call import run_tool_call, TOOL_CALL_SYSTEM_PROMPT
from .generate import run_generate
from .logging import CanaryResult, log_canary_event

__all__ = [
    'run_sp_ok', 'run_tool_call', 'run_generate',
    'SP_OK_SYSTEM_PROMPT', 'SP_OK_ASSERTION_SUBSTR', 'TOOL_CALL_SYSTEM_PROMPT',
    'CanaryResult', 'log_canary_event',
]
```

`CanaryResult` is a small dataclass:

```python
@dataclass(frozen=True)
class CanaryResult:
    check: str                   # "sp_ok" | "tool_call" | "generate"
    ok: bool
    elapsed_ms: int
    profile_id: str
    profile_version: str
    profile_hash: str
    served_model_name: str
    ts: str                      # ISO-8601
    response_excerpt: str = ''   # truncated for logging; full goes in diagnostic bundle
```

`log_canary_event` appends a JSONL line to a caller-provided path. Phase 5 eval imports this and adds one row per task run. Phase 1 uses it for `runs/boot-failures/` + smoke-test logs.

### 7.7 Tool schema location — planner decision

Option A: ship the smoke-test tool schema inside `emmy_serve/canary/tool_schemas/read_file.json` (ships with code; profile bundle's `tool_schemas/` stays empty with `.gitkeep` per D-01).

Option B: ship it under `profiles/qwen3.6-35b-a3b/v1/tool_schemas/smoke_read_file.json` (profile-local; bundle's `tool_schemas/` isn't truly empty on v1).

**Recommendation: Option A.** D-01 says `tool_schemas/` is empty with `.gitkeep` in Phase 1. Phase 2 fills it with the real tool registry. The smoke-test schema is code-shipped because it's the validator's contract, not the profile's contract — it must exist for every profile (generic smoke).

---

## 8. KV-Finder Algorithm (D-13) — `scripts/find_kv_budget.py`

### Algorithm

```
INPUT:
  profile_path = profiles/qwen3.6-35b-a3b/v1/
  load_driver  = ./emmy_serve.kv_finder.load_driver (lightweight replay)
  initial      = 0.75
  safety_margin_pct = 5      # back off 5% from first-preemption value
  step_up_pct  = 2            # bisection initially increments by 2%; halved each direction-change
  min_step_pct = 0.5
  drive_minutes_per_iter = 10
  max_iters    = 12           # ~2 hours total budget

STATE:
  current_value = initial
  preempted_at  = None        # lowest value at which preemption was seen
  ok_value      = initial     # highest value that ran clean

PROCEDURE:
  bump = step_up_pct
  while iters < max_iters:
    write current_value into serving.yaml.engine.gpu_memory_utilization
    start vllm container with that value
    wait_for_vllm(base_url)
    drive load for drive_minutes_per_iter minutes
    failure = check_failure()        # returns one of: 'none', 'preemption', 'oom', 'timeout'
    stop vllm container

    append_jsonl_atomic(runs/<iso>-kv-finder/iterations.jsonl, {
      'iter': iters, 'value': current_value, 'failure': failure,
      'metrics': {...}, 'duration_s': ..., 'ts': now()
    })

    if failure == 'none':
      ok_value = max(ok_value, current_value)
      if preempted_at is not None:
        # bisect between ok_value and preempted_at
        next_val = (ok_value + preempted_at) / 2
        bump = bump / 2
      else:
        # haven't seen a failure yet; step up
        next_val = current_value + bump
    else:
      preempted_at = min(preempted_at or 1.0, current_value)
      # bisect downward
      next_val = (ok_value + preempted_at) / 2
      bump = bump / 2

    if abs(next_val - current_value) < min_step_pct / 100:
      break     # converged
    if next_val >= 1.0:
      break     # at ceiling
    current_value = round(next_val, 3)
    iters += 1

  # Apply safety margin
  final = max(0.50, ok_value - safety_margin_pct / 100)
  write final into serving.yaml.engine.gpu_memory_utilization
  append block to PROFILE_NOTES.md under "Measured-values log"
```

### Failure detection

Three independent signals — if any trips, the iteration is a failure:

1. **vLLM preemption (primary signal).** Parse `GET /metrics` Prometheus text output; look for:
   - `vllm:num_preemptions_total` — any non-zero delta over the iteration.
   - `vllm:num_requests_swapped` (if present) — any non-zero in steady state.
   - [ASSUMED exact metric names — planner verifies at plan time by running `curl http://localhost:8002/metrics | grep preempt` on a live Spark. vLLM 0.19 exposes Prometheus metrics at `/metrics` per STACK.md references.]

2. **Kernel OOM (secondary signal).** After each iteration, `dmesg --since '10 minutes ago' | grep -i 'oom\|out of memory\|killed process'` — any match ends the iteration as `oom`.

3. **Optional latency p99 threshold (tertiary).** If the load driver tracks per-request latency, a p99 > (baseline × 2) for the iteration counts as failure. This is a soft gate; disable if noisy. Planner decides.

### Load driver during bisection

**Recommendation: lightweight subset of the thermal replay**, not the full 2-hour replay. Rationale: each iteration takes ~10 minutes (fast iteration → ~12 iterations in 2 hours total); full thermal replay would make the finder take days. The subset must still exercise KV-cache stress:

- **Subset composition:** ~20 prompts from the prior-repo Phase 1 set (§9.1) chosen for mixed prefill sizes (3K, 10K, 20K, 30K tokens) + moderate tool-call density.
- **Concurrency:** 1 request at a time (single-user matches real daily-driver usage; KV pressure comes from history accumulation, not concurrent batching).
- **Loop:** run subset N times until iteration time reaches `drive_minutes_per_iter`.
- **Measurement:** sample `/metrics` every 5 seconds during load.

Planner may decide to use synthetic prompts of known token count instead — either is acceptable. Prior-repo prompts give continuity.

### Iteration log format

`runs/<iso>-kv-finder/iterations.jsonl` — one JSON object per line, appended atomically:

```json
{
  "iter": 0,
  "ts": "2026-04-21T14:23:11Z",
  "value": 0.75,
  "failure": "none",
  "duration_s": 605,
  "metrics": {
    "preemptions_total": 0,
    "requests_swapped_total": 0,
    "p50_latency_ms": 1240,
    "p99_latency_ms": 3890,
    "tokens_generated": 18234,
    "throughput_tokps": 30.2
  },
  "dmesg_matches": []
}
```

Plus a `summary.json` written at the end:

```json
{
  "profile_id": "qwen3.6-35b-a3b",
  "profile_version": "v1",
  "hardware_id": "dgx-spark-01",
  "initial_value": 0.75,
  "final_value": 0.82,
  "safety_margin_pct": 5,
  "first_preemption_at": 0.88,
  "highest_clean_value": 0.87,
  "iterations": 7,
  "total_duration_s": 4350,
  "load_driver": "kv_finder_subset_v1",
  "started": "2026-04-21T14:23:11Z",
  "finished": "2026-04-21T15:35:41Z"
}
```

### Output + profile update

After convergence, `find_kv_budget.py` writes back to `serving.yaml`:

1. Reads `serving.yaml`.
2. Updates `engine.gpu_memory_utilization` to the final value.
3. Writes back atomically.
4. Recomputes `profile.yaml.hash` (via `emmy profile hash --write`).
5. Appends a block to `PROFILE_NOTES.md` "Measured-values log" with: final value, first-preemption value, safety margin applied, iteration count, date, hardware id, link to `runs/<iso>-kv-finder/`.

(Note: writing to a v1 profile after its initial commit is the *one exception* to D-03 / PROFILE-06 for Phase 1 — the finder is how v1's measured values get baked in. Planner decides whether to treat this as "finder creates v1" workflow, i.e. the commit that lands v1 on git is the post-finder commit. See §14 for the sequencing.)

### Wall-clock budget estimate

- Cold start per iteration: ~3 minutes (fastsafetensors).
- Load driving: 10 minutes.
- Tear-down: ~30 seconds.
- Total per iteration: ~13.5 minutes.
- Expected iterations: 5–8 (bisection converges fast).
- **Total wall-clock: 70–110 minutes.**

This fits comfortably in a single session; schedule it to run once during profile creation, then commit the result.

---

## 9. Thermal Workload Audit (D-14) — Load-Bearing

### 9.1 What the prior-repo Phase 1 prompts actually are

Found in two locations (both exist):
- `/data/projects/setup_local_opencode/validation/eval_tasks.py` — 8 `EvalTask` dataclasses (CODE_01..CODE_05, LIT_01..LIT_03).
- `/data/projects/setup_local_opencode/validation/PHASE1_TEST_PROMPTS.md` — human-readable version of a subset.

The 5 coding tasks used in Phase 1 are:
1. **CODE_01** "CSV CLI tool" — easy, max_tokens 2048
2. **CODE_02** "Fibonacci optimization" — easy, max_tokens 2048
3. **CODE_03** "Pytest for email validator" — easy, max_tokens 3072
4. **CODE_04** "Debug binary search with 2 bugs" — medium, max_tokens 4096
5. **CODE_05** "LRU cache from scratch" — hard, max_tokens 4096

The 3 literature tasks are CLI-mode (invoke Claude Code with MCP tools), so they're not relevant to pure vLLM thermal stress — they involve long tool-call chains and are out-of-scope for "serve vLLM under load." Use only the coding tasks.

### 9.2 Characterization along thermal-relevant axes

| Axis | Prior Phase 1 prompts (coding, N=5) |
|------|-------------------------------------|
| Prompt length (system + user) | ~800–1500 tokens (5× small prompts — mostly instructions + tiny code snippets) |
| Expected output length | `max_tokens` 2048–4096; actual outputs historically 500–3500 chars per prior EXECUTIVE_SUMMARY.md (avg ~37s per task at ~38 tok/s → ~1400 tokens/task) |
| Context-size distribution | All small; no prompts exercise 10K+ context (no codebase-aware tasks, no repo-map, no long-history) |
| Tool-call density | **Zero** — coding tasks are direct-API mode; no tool calls |
| Decode:prefill ratio | Decode-heavy. Prefills are ~1K tokens each; decodes are 500–3500 tokens. Ratio ~2:1 in favor of decode. |
| Duty cycle if looped | Single-shot one-after-another — no inter-prompt compute gap; next prefill starts as previous decode ends. |

### 9.3 Verdict: not representative of sustained thermal stress

The prior prompts exercise:
- **Short contexts** (~1K prefill) — thermal stress from prefill is low because FLOPs are small.
- **Medium decodes** (1–3K output) — the main thermal signal comes from sustained decode, which DOES thermally stress the chip.
- **Single-stream** — matches daily-driver usage shape.
- **No tool calls** — misses the agent-loop shape (prefill-decode-prefill-decode alternation from tool round-trips).

**Problems for thermal validation:**
- **Under-exercises prefill** — a daily-driver session re-prefixes (after context compaction, per SERVE-07 SERVE-07) larger prompts; prior prompts never stress this.
- **Short duration per prompt** — a full 5-prompt loop is ~3 minutes; to fill 2 hours we'd loop ~40 times, meaning the same 5 prompts get cached in prefix-cache and cold-path prefill stops exercising.
- **No tool-call shape** — Phase 2+ daily-driver will have agentic tool round-trips that alternate prefill and decode; prior Phase 1 does not match this.

### 9.4 Recommended augmentation

Build a **representative thermal replay corpus** for Phase 1:

1. **Keep the 5 prior-repo coding prompts** as-is (continuity baseline).
2. **Synthesize 5 "agent-shape" prompts** that simulate mid-session state:
   - 10K-token user-message with a pasted code file + "refactor this X" task.
   - 20K-token user-message with a multi-file context + "add feature Y" task.
   - 30K-token user-message with long conversation history + "fix the bug in foo.py" task.
   - One prompt that forces a 4K output (long reasoning / planning).
   - One prompt that forces a 100-token output (short tool-call-shape response).
3. **Add a synthetic tool-call round-trip sequence** that posts a series of prompts emulating Phase 2's agent loop: user → assistant-with-tool_calls → tool-result → assistant-final. The replay posts each turn as a separate `/v1/chat/completions` call so vLLM sees the alternation of prefill (history) / decode (response) that real agentic usage produces.
4. **Loop the combined 10-prompt corpus + synthetic tool-call sequence** for 2 hours with a ~5-second inter-request gap (matches human-like request cadence; not back-to-back).

### 9.5 Representativeness thresholds

A corpus is "representative enough" for thermal validation if, over a 2-hour loop:
- Prefill tokens:decode tokens ratio is **≥ 1:2 and ≤ 2:1** (no extreme skew).
- At least **30% of prompts** have prefill ≥ 10K tokens (matches real coding-session shape).
- At least **20% of prompts** include tool-call shapes (agent-loop alternation).
- Duty cycle (GPU busy-time / wall-time) is **≥ 80%** — the loop actually keeps the GPU hot.
- No single prompt dominates more than 15% of total wall-time.

The planner's audit task for Phase 1 verifies the corpus against these thresholds before the 2-hour run.

### 9.6 2-hour replay harness design (D-14, D-15)

```
INPUT:
  corpus = emmy/thermal_corpus_v1/   # the augmented set from 9.4
  target_wall_time_s = 7200          # 2 hours
  inter_request_gap_s = 5
  sample_interval_s = 5              # nvidia-smi + /metrics sample cadence
  profile_path

STATE:
  runs/<iso>-thermal/
    prompts_used.jsonl        # which prompt at which wall-time
    responses.jsonl           # response length, latency, throughput per request
    gpu_samples.jsonl         # ts, gpu_util, gpu_clock_mhz, gpu_temp_c, memory_used_gb
    vllm_metrics.jsonl        # ts, preemptions_total, swapped_total, kv_usage
    dmesg_tail.txt
    summary.json              # final-hour floors per D-15

PROCEDURE:
  start_vllm(profile_path)
  wait_for_vllm()
  run_smoke_canary()          # gate: canary must pass before replay
  t_start = monotonic()
  corpus_iter = itertools.cycle(corpus)
  start background thread: sample_gpu_every(sample_interval_s)
  start background thread: sample_vllm_metrics_every(sample_interval_s)
  while monotonic() - t_start < target_wall_time_s:
    prompt = next(corpus_iter)
    req_start = monotonic()
    response = post_chat_completions(prompt)
    req_end = monotonic()
    append_jsonl_atomic(runs/<iso>-thermal/responses.jsonl, {...})
    sleep(inter_request_gap_s)
  stop background threads
  append dmesg tail
  compute summary (per 9.7)
  stop_vllm()
```

**Logging cadence:**
- GPU samples every 5s → 1440 samples over 2 hours.
- vLLM metrics every 5s → 1440 samples.
- Per-request log: one entry per request (≈ 200–400 requests depending on throughput).

**Running this inside the container vs. on host:**
- `nvidia-smi` samples must run on the host (container may not have access).
- vLLM `/metrics` samples run from anywhere that can reach loopback 8002.
- Planner decides: run the whole thermal driver on host (simpler), or run request-side on host and sampling as sidecar. Either works.

### 9.7 Pass/fail computation (D-15)

```python
def compute_floors(runs_dir: Path) -> dict:
    # Filter to hour-2 samples (t >= 3600s from start)
    gpu = [s for s in load_jsonl(runs_dir/'gpu_samples.jsonl') if s['t_elapsed'] >= 3600]
    reqs = [r for r in load_jsonl(runs_dir/'responses.jsonl') if r['t_start'] >= 3600]
    metrics = [m for m in load_jsonl(runs_dir/'vllm_metrics.jsonl') if m['t_elapsed'] >= 3600]

    gpu_clocks = sorted(s['gpu_clock_mhz'] for s in gpu)
    gpu_temps  = sorted(s['gpu_temp_c'] for s in gpu)
    throughputs = sorted(r['tokens_per_second'] for r in reqs)

    return {
        'gpu_clock_p5_hour2_mhz': percentile(gpu_clocks, 5),
        'gpu_clock_p50_hour2_mhz': percentile(gpu_clocks, 50),
        'gpu_temp_p95_hour2_c': percentile(gpu_temps, 95),
        'decode_throughput_p50_hour2_tokps': percentile(throughputs, 50),
        'decode_throughput_p1_hour2_tokps': percentile(throughputs, 1),
        'preemptions_hour2': sum_delta(metrics, 'preemptions_total'),
        'oom_events': count_dmesg_oom(runs_dir/'dmesg_tail.txt'),
    }
```

**First-run: discover floors, write to `PROFILE_NOTES.md`.** No pass/fail — just record.

**Re-runs: assert recorded floors are still met (within tolerance).** Specifically:
- `preemptions_hour2 == 0` (hard gate — any preemption fails)
- `oom_events == 0` (hard gate)
- `gpu_clock_p5_hour2_mhz >= recorded_p5 * 0.95` (5% tolerance)
- `decode_throughput_p50_hour2_tokps >= recorded_p50 * 0.93` (7% tolerance for environmental variation)
- `decode_throughput_p1_hour2_tokps >= recorded_p1 * 0.90`

Any violation → investigate before the run is recorded as passing. This matches D-15's "Any floor drop triggers investigation" rule.

---

## 10. Air-Gap Test Design (D-09 to D-12)

### 10.1 Network namespace approach — recommendation

**Recommendation: `docker run --network none` with smoke test via `docker exec` inside the same container.** Rationale:
- Structural guarantee per D-09: the container has *no network devices* except loopback; there's no IP to send packets on.
- Simpler than `ip netns exec` wrapping, which requires root and adds a layer of indirection.
- The Phase 1 smoke test is a small Python script — running it inside the NGC image via `docker exec` is trivial; NGC image has Python 3 + pip and we can `pip install httpx pydantic pyyaml` inline at test time (or mount them).
- When Phase 2+ harness wants to talk to serve over loopback in air-gap CI, use `--network container:emmy-serve` for the harness container to share the serve's (empty) namespace — they see each other on `lo`, nothing else.

```bash
# Air-gap CI job (pseudocode for .github/workflows/airgap.yml)
# Self-hosted runner on DGX Spark (D-10).

# 1. Make sure network is explicitly airgapped for the whole workflow step
#    (defense in depth — even though container is --network none, we unplug
#    the test runner from routing too).

# 2. Probe pre-boot:
python3 scripts/airgap_probe.py pre-boot
# asserts: VLLM_NO_USAGE_STATS=1 set, HF_HUB_OFFLINE=1 set in profile env

# 3. Start vLLM with --network none:
docker run --rm --name emmy-serve --gpus all --shm-size=8g \
    --network none \
    ... (all other flags from §1) \
    nvcr.io/nvidia/vllm@sha256:<DIGEST> vllm serve /models/... &

# 4. Wait for /v1/models via docker exec:
docker exec emmy-serve python3 -c "
import urllib.request, time
for _ in range(600):
    try: r = urllib.request.urlopen('http://127.0.0.1:8000/v1/models', timeout=2); print('ok'); break
    except: time.sleep(0.5)
"

# 5. Run smoke tests via docker exec (SP_OK + tool_call + 100-token):
docker exec emmy-serve python3 /profile/../smoke.py

# 6. Replay the 50-turn session (D-11):
docker exec emmy-serve python3 /profile/../replay_session.py /airgap/session.jsonl

# 7. Observe network activity from host (D-12 layer a):
python3 scripts/airgap_probe.py post-boot
# asserts: zero non-loopback packets observed from emmy-serve's NetworkSettings
#          (since --network none, there should be no eth0, no external IP)

# 8. Shut down:
docker stop emmy-serve
```

### 10.2 Self-hosted GitHub Actions runner on Spark (D-10)

**Setup sketch:**

1. Register a runner scoped to the repo. Use a dedicated OS user (`emmy-ci`) with:
   - Membership in `docker` group.
   - Read access to `/data/models/**` and `$HF_HOME`.
   - No access to sudo (no need; the runner doesn't manage networking).
2. Runner work directory: `/data/ci-runner/_work/emmy/emmy/`.
3. Secret handling: HF tokens (if any) live in `~/.cache/huggingface/token` on the host, read-only mounted into the container. **GitHub Actions secrets are NOT used** for HF auth — they don't need to be, since models are already cached. This also avoids exposing secrets to the workflow environment.
4. Workflow triggers: `on.pull_request.paths` = `[emmy-serve/**, profiles/**, scripts/start_emmy.sh, scripts/smoke_test.py, air_gap/**]`.
5. Concurrency group: `airgap-{github.ref}` with `cancel-in-progress: true` so only one air-gap run per PR head.
6. Cloud CI still runs (on GitHub-hosted runner):
   - schema validation (`emmy profile validate`)
   - hash integrity (`emmy profile hash`)
   - lint / unit tests
   - any Python test that doesn't need GPU or model weights.

### 10.3 `air_gap/session.jsonl` — 50-turn scripted replay (D-11)

**JSONL schema (one line per turn):**

```json
{
  "turn": 1,
  "role": "user",
  "content": "Please list the files in /tmp.",
  "_expected_tool_call": {"name": "ls", "args": {"path": "/tmp"}}
}
{"turn": 2, "role": "assistant", "content": null, "tool_calls": [{"name": "ls", "arguments": {"path": "/tmp"}}]}
{"turn": 3, "role": "tool", "tool_call_id": "call_ls_1", "content": "file1.txt\nfile2.py"}
{"turn": 4, "role": "assistant", "content": "Two files: file1.txt and file2.py."}
...
```

**Pattern mix (exercises every Phase-2 tool type):**

| Pattern | Turns | Notes |
|---------|-------|-------|
| `read` (file read with line range) | 2–5 | Tool-call → tool-result round trip |
| `write` (overwrite file) | 6–9 | With content payload |
| `edit` (hash-anchored shape) | 10–15 | Phase 2 format; Phase 1 just uses the tool name + args shape |
| `bash` (shell command) | 16–21 | Short command + stdout result |
| `grep` | 22–25 | Pattern + path |
| `find` | 26–29 | Glob + path |
| `ls` | 30–33 | Path |
| `web_fetch` | 34–36 | **Mock mode only** — the tool-result is pre-recorded markdown; no actual network. Pure shape-exercise. |
| Multi-tool sequential | 37–42 | read → edit → bash in one session turn |
| Context-growing | 43–50 | Long turns that build up conversation history (exercises prefix caching) |

**Replay mechanism:**

```python
# emmy_serve/canary/replay.py
def run_replay(base_url: str, served_model_name: str, session_path: Path) -> None:
    """Replay a session.jsonl: send each 'user' turn to vLLM, check assistant output shape."""
    history = []
    turns = [json.loads(l) for l in session_path.read_text().splitlines() if l.strip()]
    i = 0
    while i < len(turns):
        turn = turns[i]
        if turn['role'] == 'user':
            history.append({'role': 'user', 'content': turn['content']})
            resp = chat_completions(base_url, served_model_name, history, tools=TOOL_REGISTRY)
            msg = resp['choices'][0]['message']
            history.append(msg)
            # Check against _expected_tool_call if present (fuzzy; we measure wire not model)
            if turn.get('_expected_tool_call') is not None:
                assert msg.get('tool_calls'), f"Turn {turn['turn']}: expected tool_call, got {msg}"
            i += 1
        elif turn['role'] == 'tool':
            history.append({
                'role': 'tool',
                'tool_call_id': turn['tool_call_id'],
                'content': turn['content'],
            })
            i += 1
        else:
            i += 1  # skip scripted assistant lines (they're documentation)
```

**Key property:** the test measures whether vLLM handles the wire format round-trips, not whether the model gives correct answers. The model may say anything as long as it doesn't make outbound network requests (which it can't, because `--network none`).

### 10.4 Layered air-gap assertion (D-12) — command-by-command

| Layer | What | How to assert |
|-------|------|---------------|
| (a) Zero non-loopback packets | netns structural | `docker inspect emmy-serve --format '{{json .NetworkSettings.Networks}}'` → must show only `{"none": {...}}` or empty. Additionally: `docker exec emmy-serve ip addr` must show only `lo`. |
| (b) No DNS queries attempted | resolver audit | `docker exec emmy-serve cat /etc/resolv.conf` → expect empty or only `nameserver 127.0.0.53` (systemd-resolved local) or `# no DNS configured`. Also: `docker exec emmy-serve getent hosts huggingface.co` → expect **failure** (no resolution, no outbound). |
| (c) `VLLM_NO_USAGE_STATS=1` | container env | `docker exec emmy-serve printenv VLLM_NO_USAGE_STATS` → `1`. Also assert `DO_NOT_TRACK=1`. |
| (d) `HF_HUB_OFFLINE=1` | container env | `docker exec emmy-serve printenv HF_HUB_OFFLINE` → `1`. Also assert `TRANSFORMERS_OFFLINE=1`. |

**Additional belt-and-suspenders** (recommended, not strictly in D-12):
- `tcpdump -i any -n not host 127.0.0.1` on the host for the full airgap run window → expect zero packets from the container's mount or any process launched by the workflow. This is the statistical layer on top of the structural one. If it sees packets, something escaped.
- After the replay completes, check the container's network namespace statistics: `docker exec emmy-serve cat /proc/net/dev` → expect only `lo` with minimal traffic.

**Failure handling:** `scripts/airgap_probe.py` implements each layer as a separate check and emits a JSON report. Any failure identifies the specific layer in the error message (per D-12) — e.g. `"airgap layer (c) FAILED: VLLM_NO_USAGE_STATS is not set in container env"`. The workflow fails the job immediately on any layer failure.

---

## 11. Validation Architecture (Nyquist Dimension 8)

> `workflow.nyquist_validation` is `true` in `.planning/config.json`. This section is included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **pytest** (≥ 7.0) + **pytest-asyncio** for httpx calls |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` block + `conftest.py` at repo root (Wave 0 creates) |
| Quick run command | `uv run pytest tests/unit -x` (unit tests, no Docker, no network, < 10s) |
| Full suite command | `uv run pytest tests/ -x --run-integration --run-airgap` |
| Phase gate | Full suite green + air-gap CI job green + 2-hour thermal run green before `/gsd-verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior to verify | Test Type | Automated Command | File Exists? |
|--------|---------------------|-----------|-------------------|---------------|
| SERVE-01 | NGC image digest matches `serving.yaml` at boot | unit | `pytest tests/unit/test_container_digest.py` | ❌ Wave 0 |
| SERVE-02 | After boot, `/v1/models` responds 200 with `qwen3.6-35b-a3b` present | integration | `pytest tests/integration/test_boot.py::test_models_endpoint` | ❌ Wave 0 |
| SERVE-02 | 100-token generation latency within ≥60 tok/s on Spark | integration | `pytest tests/integration/test_boot.py::test_throughput_floor` | ❌ Wave 0 |
| SERVE-04 | `/v1/chat/completions` with `extra_body` accepted | integration | `pytest tests/integration/test_boot.py::test_extra_body_passthrough` | ❌ Wave 0 |
| SERVE-07 | `enable_prefix_caching` + `enable_chunked_prefill` set in rendered CLI flags | unit | `pytest tests/unit/test_docker_run_build.py` | ❌ Wave 0 |
| SERVE-07 | Prefix-order rule documented in `PROFILE_NOTES.md` and not violated by serving.yaml | unit | `pytest tests/unit/test_profile_notes.py::test_prefix_order_documented` | ❌ Wave 0 |
| SERVE-08 | `gpu_memory_utilization` came from `find_kv_budget.py` (not the placeholder 0.75) | unit | `pytest tests/unit/test_serving_yaml.py::test_kv_budget_final` | ❌ Wave 0 |
| SERVE-08 | 30-minute sustained load → zero preemption events | integration (slow) | `pytest tests/integration/test_kv_budget.py::test_zero_preemption --slow` | ❌ Wave 0 |
| SERVE-09 | `VLLM_NO_USAGE_STATS=1` in container env | integration | `pytest tests/integration/test_airgap.py::test_env_usage_stats` | ❌ Wave 0 |
| SERVE-09 | Zero outbound network packets during replay | airgap CI only | Run in GitHub Actions air-gap job on self-hosted runner | ❌ Wave 0 |
| SERVE-10 | `VLLM_LOAD_FORMAT=fastsafetensors` in container env + cold-start < 4 min | integration | `pytest tests/integration/test_boot.py::test_cold_start_time` | ❌ Wave 0 |
| SERVE-11 | 2-hour thermal replay hits recorded floors | manual / scheduled | `scripts/thermal_replay.py --profile profiles/qwen3.6-35b-a3b/v1 --assert-floors` | ❌ Wave 0 |
| PROFILE-01 | `profiles/qwen3.6-35b-a3b/v1/` exists with expected layout | unit | `pytest tests/unit/test_profile_layout.py` | ❌ Wave 0 |
| PROFILE-02 | All required subpaths exist (`serving.yaml`, `harness.yaml`, `prompts/`, `tool_schemas/`, `grammars/`, `PROFILE_NOTES.md`) | unit | `pytest tests/unit/test_profile_layout.py::test_subpaths_present` | ❌ Wave 0 |
| PROFILE-03 | `serving.yaml` schema loads, all required fields present | unit | `pytest tests/unit/test_schema.py::test_serving_yaml_valid` | ❌ Wave 0 |
| PROFILE-04 | `harness.yaml` stub schema loads | unit | `pytest tests/unit/test_schema.py::test_harness_yaml_stub_valid` | ❌ Wave 0 |
| PROFILE-05 | `PROFILE_NOTES.md` cites ≥1 source per non-trivial default | unit | `pytest tests/unit/test_profile_notes.py::test_sources_cited` | ❌ Wave 0 |
| PROFILE-06 | Editing v1 file without bumping hash → validator exit 2 | unit | `pytest tests/unit/test_immutability.py` | ❌ Wave 0 |
| PROFILE-09 | Boot smoke test runs and asserts SP_OK + tool_call + generate | integration | `pytest tests/integration/test_boot.py::test_smoke_all_three` | ❌ Wave 0 |
| EVAL-07 | `emmy.canary` module importable; `run_sp_ok` returns `(bool, str)` | unit | `pytest tests/unit/test_canary.py` | ❌ Wave 0 |
| EVAL-07 | `CanaryResult` dataclass has all fields Phase 5 will need | unit | `pytest tests/unit/test_canary.py::test_result_schema` | ❌ Wave 0 |
| REPRO-01 | `start_emmy.sh` references pinned digest matching `serving.yaml` | unit | `pytest tests/unit/test_start_script.py::test_digest_match` | ❌ Wave 0 |
| REPRO-03 | Air-gap workflow exists and references self-hosted runner label | unit | `pytest tests/unit/test_workflows.py::test_airgap_yml_present` | ❌ Wave 0 |
| REPRO-03 | 50-turn `air_gap/session.jsonl` validates as schema | unit | `pytest tests/unit/test_session_jsonl.py` | ❌ Wave 0 |
| REPRO-04 | With `HF_HUB_OFFLINE=1`, cached model loads (no HTTP) | integration | `pytest tests/integration/test_offline_hf.py` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit (local dev):** `uv run pytest tests/unit -x` — fast (~5s); runs on every push/commit.
- **Per wave merge (PR):** `uv run pytest tests/ -x` (includes integration tests that spin up the container) — ~5–10 minutes.
- **Per PR + self-hosted runner:** air-gap workflow runs via GitHub Actions on the Spark (D-10).
- **Per profile creation:** `scripts/find_kv_budget.py` + `scripts/thermal_replay.py` — 1-time, outputs commit to profile.
- **Per release / phase gate:** full suite green + 2-hour thermal replay green + air-gap workflow green.

### Wave 0 Gaps

All test files below must be created in Wave 0 before implementation waves can meaningfully assert pass/fail:

- [ ] `pyproject.toml` + `uv` venv setup (if not already present)
- [ ] `conftest.py` at repo root — shared fixtures (profile path, base_url, temporary dirs)
- [ ] `tests/unit/test_schema.py` — pydantic model instantiation + `extra='forbid'` tests
- [ ] `tests/unit/test_hasher.py` — canonicalization rules tests (UTF-8, LF, symlink rejection, exclude list)
- [ ] `tests/unit/test_immutability.py` — validator exit codes for hash mismatch
- [ ] `tests/unit/test_docker_run_build.py` — serving.yaml → docker CLI args translation
- [ ] `tests/unit/test_profile_layout.py` — required subpaths + file presence
- [ ] `tests/unit/test_profile_notes.py` — frontmatter parsing + source-cited rule
- [ ] `tests/unit/test_canary.py` — `emmy.canary` imports + result schema
- [ ] `tests/unit/test_start_script.py` — shellcheck on `start_emmy.sh` + digest string match
- [ ] `tests/unit/test_workflows.py` — `.github/workflows/airgap.yml` YAML-validates and references `runs-on: [self-hosted, dgx-spark]`
- [ ] `tests/unit/test_session_jsonl.py` — 50 turns, covers all tool types
- [ ] `tests/integration/test_boot.py` — container up, smoke passes, 100-token generation
- [ ] `tests/integration/test_airgap.py` — env vars, docker network mode, dns audit
- [ ] `tests/integration/test_offline_hf.py` — `HF_HUB_OFFLINE=1` path works
- [ ] `tests/integration/test_kv_budget.py` — 30-min run with zero preemption
- [ ] Framework install: `uv pip install pytest pytest-asyncio httpx pydantic pyyaml prometheus-client`
- [ ] Self-hosted runner registered + labeled `[self-hosted, dgx-spark]`

---

## 12. Container Digest Pinning (REPRO-01)

### Capture on first pull

```bash
docker pull nvcr.io/nvidia/vllm:26.03.post1-py3
docker inspect --format='{{index .RepoDigests 0}}' nvcr.io/nvidia/vllm:26.03.post1-py3
# → nvcr.io/nvidia/vllm@sha256:abc123... (64-hex)
```

### Where to store

Recommendation: **embed the full sha256 digest in `serving.yaml.engine.container_image_digest`** and reference *that* from `start_emmy.sh`.

```bash
# In start_emmy.sh — read digest from serving.yaml and assert consistency
IMAGE_DIGEST=$(python3 -c "
import yaml
with open('$PROFILE_DIR/serving.yaml') as f:
    d = yaml.safe_load(f)
print(d['engine']['container_image_digest'])
")

docker run ... "nvcr.io/nvidia/vllm@$IMAGE_DIGEST" vllm serve ...
```

**Why one location, not two:**
- `serving.yaml` already travels with the profile bundle (gets hashed per D-02, versioned per PROFILE-06).
- Encoding in `start_emmy.sh` (bash variable or constant) duplicates the value and creates drift risk.
- Rule: **one source of truth per fact.** The profile owns the digest.

Validator enforces: `engine.container_image_digest` must match `^sha256:[0-9a-f]{64}$` and must NOT equal `sha256:REPLACE_AT_FIRST_PULL` (the initial-template sentinel). CI asserts that the `start_emmy.sh` runtime-read digest matches what's in `serving.yaml` for the active profile.

**Digest rotation:** when NVIDIA ships a new `26.03.post1` patch (or we consciously upgrade), bump the profile version (v1 → v2) with the new digest. Phase 1 never has v2 so this is theoretical — but the mechanism is defined.

### Reference from `PROFILE_NOTES.md`

The "Engine" provenance table in `PROFILE_NOTES.md` (§5) cites the NGC catalog URL + the `docker inspect` command + the date the digest was captured. Reviewers verify by re-pulling and comparing.

---

## 13. HF Cache Story (REPRO-04)

### Flow

```
  First pull (once, online, before air-gap CI ever runs):
    $ HF_HOME=/data/hf-cache huggingface-cli download Qwen/Qwen3.6-35B-A3B-FP8 \
          --local-dir /data/models/Qwen3.6-35B-A3B-FP8 \
          --local-dir-use-symlinks False    # CRITICAL: no symlinks, copies weights
    # --local-dir-use-symlinks False ensures the weights are real files in
    # /data/models/Qwen3.6-35B-A3B-FP8; the HF cache under /data/hf-cache holds
    # the tokenizer/config metadata.
    # After this: the model directory is usable with HF_HUB_OFFLINE=1.

  Air-gap + normal runs:
    docker run ... \
      -v /data/models:/models:ro \
      -v /data/hf-cache:/hf-cache:ro \
      -e HF_HOME=/hf-cache \
      -e HF_HUB_OFFLINE=1 \
      -e TRANSFORMERS_OFFLINE=1 \
      ... vllm serve /models/Qwen3.6-35B-A3B-FP8 ...
```

### Why both mounts

- `/models/Qwen3.6-35B-A3B-FP8` — the actual weight `.safetensors` files that vLLM memory-maps.
- `/hf-cache` — the `HF_HOME` cache containing:
  - `Qwen/Qwen3.6-35B-A3B-FP8` refs (tokenizer, config.json, chat_template.jinja).
  - Used by vLLM when resolving `tokenizer_config` even with a local-path model.

Both must be read-only (`:ro`) to prevent any container-side mutation (defense against accidental writes during air-gap runs).

### Weights in LFS vs fetched-and-cached

**Recommendation: fetched-once-then-cached, NOT committed to LFS.**
- **Why not LFS:** the model is ~35 GB FP8; HF LFS inflates repo clones; git gc is slow on big blobs; no benefit over HF hosting.
- **Why the download-once model works:** REPRO-04 explicitly says "gated-model auth tokens are documented but the system runs offline once cached." The README documents:
  1. Run `huggingface-cli download ...` once with the user's HF token.
  2. After that, everything runs offline with `HF_HUB_OFFLINE=1`.
- **Gated-model auth:** Qwen3.6-35B-A3B-FP8 is Apache 2.0 (per STACK.md), not gated. No HF token required in practice. But the README should include the generic "if model is gated, do this first" paragraph.

### `HF_HUB_OFFLINE=1` semantics (verified)

From HF docs and issue #2590: setting `HF_HUB_OFFLINE=1`:
- Prevents any HTTP call to the Hub, even cache-freshness HEAD checks.
- Disables HF usage telemetry.
- Causes `HfApi` methods to raise `OfflineModeIsEnabled`.
- Works with `snapshot_download`, `hf_hub_download`, and indirectly with any library that uses `huggingface_hub` internally (transformers, datasets, vllm when reading HF files).

Use `TRANSFORMERS_OFFLINE=1` alongside — older transformers code paths may ignore `HF_HUB_OFFLINE` on first-pass resolution, so both flags give structural coverage. [VERIFIED: HF documentation + HF transformers installation docs]

### Pitfall: gated-model placeholders

Per PITFALLS.md #12 / Pitfall 12: "HuggingFace gated-model auth (`HF_TOKEN`) required even to *load* a cached model offline — the `from_XXX()` method must be run online once to create empty placeholder files."

Phase 1 uses Qwen3.6-35B-A3B-FP8 which is Apache 2.0 (non-gated), so this is NOT a concern for Phase 1. But:
- The README must document the flow anyway (REPRO-04 says "documented").
- Phase 4 (Gemma 4) may hit gated-model territory — the pattern laid down here must handle it.

---

## 14. Script Layout + Language Choices (Claude's Discretion items from CONTEXT.md)

### Recommended inventory

```
start_emmy.sh                                     # bash; one-liner contract per REPRO-01
scripts/
├── smoke_test.py                                 # D-05 — thin wrapper over emmy_serve.canary
├── find_kv_budget.py                             # D-13 — thin wrapper over emmy_serve.kv_finder
├── thermal_replay.py                             # D-14/D-15 — thin wrapper over emmy_serve.thermal
├── airgap_probe.py                               # D-12 layered assertions
├── validate_profile.py                           # emmy profile validate entrypoint (shim for CI)
└── hash_profile.py                               # emmy profile hash entrypoint (shim for CI)
emmy_serve/                                       # the Python package
├── cli.py                                        # `python -m emmy.serve ...` or console_script entry
├── profile/ ...                                  # schema, loader, hasher, immutability
├── boot/ ...                                     # runner, probe
├── canary/ ...                                   # EVAL-07 shipped library
├── diagnostics/ ...                              # D-06 bundle writer
├── kv_finder/ ...                                # D-13
└── thermal/ ...                                  # D-14/D-15
```

### `start_emmy.sh` contract

```bash
#!/usr/bin/env bash
# start_emmy.sh — Phase 1 one-command contract (REPRO-01)
#
# Usage:
#   ./start_emmy.sh [--profile profiles/qwen3.6-35b-a3b/v1] [--port 8002]
#
# Exit codes:
#   0 — vLLM is up, smoke test passed, ready for harness
#   1 — boot rejected (diagnostic bundle in runs/boot-failures/)
#   2 — profile schema invalid
#   3 — container digest mismatch
#   4 — prerequisite missing (docker, nvidia-smi, python3, model dir, HF cache)

set -euo pipefail

PROFILE=${PROFILE:-profiles/qwen3.6-35b-a3b/v1}
RUN_ID=$(date -u +'%Y-%m-%dT%H-%M-%SZ')
RUN_DIR="runs/${RUN_ID}-boot"
mkdir -p "$RUN_DIR"

# 1. Pre-flight
python3 scripts/validate_profile.py "$PROFILE" || exit 2
python3 scripts/hash_profile.py "$PROFILE" --check || exit 2
# ... check docker + nvidia-smi + model dir + hf cache presence

# 2. Resolve digest from serving.yaml
IMAGE_DIGEST=$(python3 -c "import yaml, sys; \
  d=yaml.safe_load(open('$PROFILE/serving.yaml')); \
  print(d['engine']['container_image_digest'])")

# 3. Build docker run from serving.yaml
DOCKER_ARGS=$(python3 -m emmy_serve.boot.runner render-docker-args \
  --profile "$PROFILE" --run-dir "$RUN_DIR" --port "${PORT:-8002}")

# 4. docker run (in background)
docker run --name emmy-serve --detach $DOCKER_ARGS \
  "nvcr.io/nvidia/vllm@$IMAGE_DIGEST" vllm serve ... \
  > "$RUN_DIR/docker-run.log" 2>&1

# 5. Wait + smoke test
if ! python3 scripts/smoke_test.py \
     --base-url "http://127.0.0.1:${PORT:-8002}" \
     --profile "$PROFILE" \
     --run-dir "$RUN_DIR"; then
  # D-06 diagnostic bundle
  mkdir -p "runs/boot-failures/${RUN_ID}"
  docker logs emmy-serve > "runs/boot-failures/${RUN_ID}/docker-logs.txt" 2>&1 || true
  cp -r "$RUN_DIR" "runs/boot-failures/${RUN_ID}/"
  docker stop emmy-serve > /dev/null 2>&1 || true
  echo "BOOT REJECTED — see runs/boot-failures/${RUN_ID}/" >&2
  exit 1
fi

# 6. Ready banner
echo "✅ emmy-serve ready — profile ${PROFILE} on http://127.0.0.1:${PORT:-8002}"
```

### Language decision: Python end-to-end for Phase 1

All scripts are Python (invoked from `start_emmy.sh`). Rationale:
- Only bash is `start_emmy.sh` itself (one file, contract interface).
- Everything else inherits the `dgx_stack` loader pattern and the prior-repo conventions.
- Phase 2 harness is TypeScript (pi-mono); it talks to emmy-serve via HTTP. The TS/Python split is orthogonal to each process.

---

## 15. Runtime State Inventory

> Phase 1 is greenfield — there is no existing deployment to rename, refactor, or migrate. This section is N/A. Included for completeness / template-compliance.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified by repo being empty of any datastores | — |
| Live service config | None — verified by repo being pre-deploy | — |
| OS-registered state | None — verified; no scheduled tasks, no systemd units | — |
| Secrets / env vars | New: `HF_TOKEN` (optional, only needed if a future model is gated). Documented in README. | Document, don't migrate. |
| Build artifacts | None — verified by greenfield status | — |

---

## Common Pitfalls

### Pitfall 1: Committing a hand-picked `gpu_memory_utilization`

**What goes wrong:** Author runs a 5-minute smoke test at `0.85`, concludes "fine," commits. First real daily-driver session under heavy agent context: KV preemption, latency spikes, session feels broken.
**Why it happens:** Short tests don't build KV pressure; UMA contention is invisible at short timescales.
**How to avoid:** `find_kv_budget.py` is the ONLY way. The validator checks `gpu_memory_utilization != 0.75` (the template placeholder value) — a PR that lands v1 with `0.75` still in `serving.yaml` fails CI because the profile hasn't been through the finder. [MITIGATES: PITFALLS.md #1, CONTEXT.md specifics]
**Warning signs:** commit diff includes `serving.yaml` change but no `runs/<iso>-kv-finder/` reference in `PROFILE_NOTES.md`.

### Pitfall 2: SP_OK canary "passes" because the model happens to say `[SP_OK]` anyway

**What goes wrong:** Smoke test asserts `"[SP_OK]" in response`. Model, untrained, emits `"Sure, [SP_OK]."` — passes. Silent system-prompt-delivery failure looks like success.
**Why it happens:** The substring assertion is cheap but permissive. If the chat template eats the system message, the model still might pattern-match and echo.
**How to avoid:** D-07 chose the simple substring test deliberately for EVAL-07 downstream use. But the system prompt itself uses an unusual trigger word ("ping" → `[SP_OK]`) that is unlikely to collide with the model's default behavior. Planner should additionally verify: at profile bring-up, run the canary 3 times with different trigger-words (e.g. `pong`, `marco`) and assert matching response tokens. If any mismatch shows, the system prompt is being applied — else add a secondary canary. [MITIGATES: PITFALLS.md #6, CLAUDE.md pitfall #2]
**Warning signs:** canary passes but response is longer than the single token; model "explains" the ping-pong interaction.

### Pitfall 3: Thermal replay too short per prompt → prefix-cache keeps everything warm → no real thermal stress

**What goes wrong:** Loop of 5 short prompts produces ~3-minute iterations; prefix cache stays hot; effective prefill compute drops to near-zero after iteration 2; the "stress test" doesn't stress the prefill side.
**Why it happens:** SERVE-07's prefix caching is on; naive replay loops don't rotate prompt prefixes.
**How to avoid:** Corpus per §9.4 includes large distinct prompts (different code bodies) so prefix cache diversity forces real prefill work. Thresholds in §9.5 make this explicit (prefill:decode ratio between 1:2 and 2:1). [MITIGATES: PITFALLS.md #7, CONTEXT.md D-14 specifics]
**Warning signs:** thermal run shows near-constant GPU temp (thermal-soak not reached); prefill throughput dominates decode throughput (means real decode stress is diluted).

### Pitfall 4: Profile hash computed from a tree that includes gitignored noise

**What goes wrong:** Developer opens `serving.yaml` in an editor that creates `.swp`; runs `emmy profile hash --check`; hash mismatch because `.swp` is in the tree. Developer forces through with `--fix-hash`; now the committed hash is different across platforms.
**Why it happens:** Canonicalization rules weren't followed; exclusion list incomplete.
**How to avoid:** Hasher has an explicit exclusion list (§4, point 1); `.gitignore` also excludes these. CI runs hasher on a fresh checkout (no editor artifacts). [MITIGATES: CONTEXT.md D-02 specifics]
**Warning signs:** hash mismatch reports a file like `.swp` or `~` in the delta.

### Pitfall 5: `HF_HUB_OFFLINE=1` set but the model needs an online tokenizer fetch

**What goes wrong:** First run of a new profile has HF_HUB_OFFLINE=1; tokenizer.json or chat_template.jinja isn't in the local cache; vLLM fails at model load. Developer thinks the env var is broken; sets it to 0; "works"; now air-gap CI catches a real leak.
**Why it happens:** Pre-population wasn't complete. Tokenizer/config files live in HF cache, not always copied to the model dir.
**How to avoid:** §13 flow specifies both mounts. Add a test (`tests/integration/test_offline_hf.py`) that runs a pre-boot simulation: `HF_HUB_OFFLINE=1 HF_HOME=/data/hf-cache python3 -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('/data/models/Qwen3.6-35B-A3B-FP8')"` — must succeed. Runs in CI before any container is started. [MITIGATES: PITFALLS.md #12]
**Warning signs:** first-boot logs show "Downloading tokenizer_config.json" even though offline is supposedly on.

### Pitfall 6: `docker exec`-ing into the container for smoke tests breaks when NGC image changes Python version

**What goes wrong:** NGC container's Python is 3.10; smoke test assumes 3.11 features. Air-gap test breaks silently on a container update.
**Why it happens:** Container and host Python versions drift.
**How to avoid:** Lock smoke-test to features in Python ≥ 3.10 (conservative); or mount the host Python via volume and exec via absolute path. Planner decides. Alternative: ship the smoke test's deps as a `requirements.txt` installed once into the container via a one-time `docker exec pip install --no-index` from a pre-built wheel cache. [ASSUMED — verify NGC image Python at plan time via `docker run --rm nvcr.io/nvidia/vllm@<digest> python3 --version`]
**Warning signs:** smoke test fails with `SyntaxError` or `ImportError` in CI that doesn't reproduce on dev.

### Pitfall 7: `--network none` blocks loopback between two containers during air-gap test

**What goes wrong:** Planner puts the harness in a second container and tries `--network none` on both; they can't see each other.
**Why it happens:** `--network none` gives no network devices except `lo`; `lo` is per-namespace, so two `--network none` containers each have their own independent `lo`.
**How to avoid:** If a second container is truly needed, use `--network container:emmy-serve` on the smoke-test container — it joins the serve's namespace and sees its `lo`. Or (simpler for Phase 1) just `docker exec` into the serve container. §10.1 recommends the exec path. [MITIGATES: CONTEXT.md D-09 specifics]
**Warning signs:** smoke test can't reach `http://127.0.0.1:8000` from a sidecar container.

---

## Code Examples

Verified patterns from sources.

### Polling `/v1/models` with timeout

```python
# source: standard httpx pattern; any OpenAI-compatible endpoint on vLLM 0.19.x
import httpx, time

def wait_for_vllm(base_url: str, timeout_s: int = 300, interval_s: float = 0.5) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f'{base_url}/v1/models', timeout=5.0)
            if r.status_code == 200:
                return r.json()
        except httpx.HTTPError:
            pass
        time.sleep(interval_s)
    raise TimeoutError(f'/v1/models not ready in {timeout_s}s')
```

### Reading vLLM Prometheus `/metrics`

```python
# source: prometheus_client docs + vLLM /metrics endpoint
import httpx
from prometheus_client.parser import text_string_to_metric_families

def read_preemptions(base_url: str) -> int:
    r = httpx.get(f'{base_url}/metrics', timeout=5.0)
    r.raise_for_status()
    for family in text_string_to_metric_families(r.text):
        if family.name == 'vllm:num_preemptions':
            return int(sum(s.value for s in family.samples))
    return 0
```

### Atomic JSONL append

```python
# source: prior dgx_stack runs/write.py pattern (ARCHITECTURE.md §2)
import json, os
from pathlib import Path

def append_jsonl_atomic(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True, separators=(',', ':')) + '\n'
    with open(path, 'a', buffering=1) as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())
```

---

## State of the Art

| Old Approach | Current Approach (2026 / this project) | When Changed | Impact |
|--------------|----------------------------------------|--------------|--------|
| Outlines for structured output | XGrammar (vLLM 0.19 default) | vLLM 0.19 release (April 2026) | 3.5–100× faster on complex schemas; higher compliance rate |
| NGC `vllm:26.01-py3` (prior repo) | NGC `vllm:26.03.post1-py3` | STACK.md lock | GB10 FlashInfer patches + Gemma 4 support |
| Qwen3-Next-80B (prior repo winner) | Qwen3.6-35B-A3B-FP8 (Phase 1) | STACK.md lock; 2026-04-16 Qwen release | ~75 tok/s (vs 38), smaller footprint, successor model |
| Hermes XML tool parser for all Qwen | `qwen3_coder` for Qwen3-Coder / Qwen3.6-Coder; Hermes for non-coder Qwen3 | vLLM Qwen3 recipes | Dedicated parser handles `<tools>` XML → OpenAI format cleanly |
| `VLLM_LOAD_FORMAT=auto` | `VLLM_LOAD_FORMAT=fastsafetensors` | Prior repo proven | 3.25× cold-start speedup |

**Deprecated / outdated:**
- Upstream `pip install vllm` on DGX Spark — SM121 kernel issues; never again on Spark.
- `--quantization fp8` with a pre-quantized Gemma 4 31B — buggy per `vllm-project/vllm#39407`. FP8 runtime quant of BF16 works; FP8 pre-quant doesn't.
- NVFP4 broadly on DGX Spark — slower than FP8 per NVIDIA forum #353069.

---

## Environment Availability

Phase 1 depends on:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | `start_emmy.sh`, container runtime | [verify at plan time] | [read at plan time] | None — block execution; planner must install |
| NVIDIA GPU drivers + `nvidia-container-toolkit` | `--gpus all` | [verify] | [read] | None — block |
| NGC vLLM image `nvcr.io/nvidia/vllm:26.03.post1-py3` | Serving | [pull at plan time] | `26.03.post1-py3` | None — block |
| Qwen3.6-35B-A3B-FP8 weights | Model loading | [download at plan time] | 2026-04-16 release | None — block |
| Python 3.11+ on host | `emmy_serve` tooling | [verify] | [read] | 3.10 acceptable with minor code adjustments |
| uv (or pip + venv) | Python dep management | [verify] | — | pip + venv |
| `nvidia-smi` CLI | Thermal replay GPU sampling | [verify; part of drivers] | — | None — block |
| `dmesg` accessible | KV-finder OOM scan | `dmesg` is standard; may need `CAP_SYS_ADMIN` or specific user group | — | Run as dedicated `emmy-ci` user with `adm` group |
| `tcpdump` (air-gap defense-in-depth) | §10.4 belt-and-suspenders | [verify] | — | Drop the statistical layer; rely on structural only |
| GitHub Actions self-hosted runner | D-10 air-gap CI | [register at plan time] | — | Manual trigger of air-gap workflow locally |

**Missing dependencies with no fallback:**
- Docker + nvidia-container-toolkit (block)
- NGC image (block)
- Qwen3.6 weights (block)

**Plan-phase action items:** Phase 1 plans must start with an "environment bring-up" task that verifies all of the above and logs versions to `PROFILE_NOTES.md`. If any block-level dep is missing, the first task is to install it.

---

## Risk Register

Top Phase-1-scoped risks from PITFALLS.md + CLAUDE.md, mapped to D-XX mitigations.

| # | Risk | Severity | Addressed By | Watchpoint |
|---|------|----------|--------------|-----------|
| R1 | SP-delivery silently broken | Critical | D-07 + EVAL-07 canary shipped in `emmy.canary`; every eval + boot gates on it | Canary *passes* but response is verbose → model ignoring SP but still echoing [SP_OK] by coincidence. §Pitfall 2 adds a rotation check. |
| R2 | NGC container drift | High | §12 digest pinned in `serving.yaml`; validator asserts digest format + CI re-pulls and compares | NVIDIA may silently re-tag `26.03.post1-py3` with a new digest. Version bump detects it. |
| R3 | KV budget theory trap | Critical | D-13 automated finder; §Pitfall 1 validator check that `gpu_memory_utilization != 0.75` placeholder | First PR that tries to land a profile with the default placeholder. |
| R4 | Thermal under-spec (prior prompts too short) | High | §9 audit + corpus augmentation; D-15 per-profile floors measured, not theoretical | If planner skips the audit and uses prior prompts as-is, 2-hour run looks "clean" but doesn't represent real load. |
| R5 | Hidden cloud dep via HF | Critical | D-12 air-gap test with `HF_HUB_OFFLINE=1` + `TRANSFORMERS_OFFLINE=1` + netns | Tokenizer fetch at first load of a new model. §Pitfall 5 mitigates. |
| R6 | Profile mutability (developer forced-pushes edits) | High | §5 three-layer enforcement; CI is the enforceable layer | Dev bypasses pre-commit hook with `--no-verify`; CI still catches. If CI is also bypassed, the reputation hit from a broken reproducer is the organic deterrent. |
| R7 | Smoke-test fails on vLLM 0.19 tool-call format quirk | Medium | §7.3 + verified `qwen3_coder` parser produces OpenAI `tool_calls`; planner checks at plan time against live endpoint | Parser returns tool_call in a format slightly different from OpenAI (e.g. different `type` field); assertion too tight. Keep assertion minimal: "exactly one `tool_calls` entry with `name == 'read_file'` and JSON-parseable args". |
| R8 | 2-hour thermal run fails to reach hour 2 due to pre-existing env issue | Medium | Boot smoke passes first; thermal replay only runs after smoke OK | If the replay crashes mid-run, diagnostic bundle (D-06 shape) captures state; retry after fix. D-16 says raw logs live under `runs/<iso>-phase1-validation/` — diff against prior partial runs. |

---

## Assumptions Log

Claims tagged `[ASSUMED]` in this research. These need verification during plan-phase or early execution before they become locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Docker CLI via subprocess is sufficient; no Python docker SDK needed | Standard Stack | Low — swap to SDK if subprocess ergonomics get painful |
| A2 | Raw `docker run` is preferable to docker compose for the single-container Phase 1 | Standard Stack, §1 | Low — compose can be added without changing the profile contract |
| A3 | NGC image's internal Python is usable for `docker exec`-based smoke tests | §10.1, Pitfall 6 | Medium — if Python is missing or locked down, fall back to host-side smoke with shared netns |
| A4 | `--rm` + `--name emmy-serve` composition is the right container lifecycle | §1 | Low — standard docker practice |
| A5 | `--tmpfs /tmp:rw,size=8g` is beneficial for boot speed + air-gap hygiene | §1 | Low — unverified; may be unnecessary, but harmless |
| A6 | `quirks.buffer_tool_streams: false` is correct for vLLM 0.19 + qwen3_coder parser | §2 | Medium — if Phase 2 harness hits XML streaming issues, re-enable; bump profile version |
| A7 | Prior-repo Phase 1 prompts alone are *not* thermally representative | §9 | Low — the audit is the planned task that verifies this claim; if audit disagrees, §9.4 augmentation is skipped |
| A8 | `vllm:num_preemptions_total` is the exact metric name for preemption counting | §8 | Medium — planner verifies at plan time by running `curl http://localhost:8002/metrics | grep -i preempt` on a live Spark. If name differs, update `kv_finder.metrics.py`. |
| A9 | `--network none` + `docker exec` is sufficient; no need for `ip netns` | §10.1 | Low — structural guarantee is still netns-level; the only thing that can escape is if the NGC image has a pre-configured socket listening, which is not the case for vLLM |
| A10 | `kv_finder` bisection with 0.5% min step converges in ≤ 12 iters | §8 | Low — if more iters needed, the `max_iters` ceiling is generous |

---

## Open Questions

1. **Exact vLLM preemption metric name in `26.03.post1-py3`.**
   - What we know: vLLM exposes Prometheus-format metrics at `/metrics`; preemption is tracked.
   - What's unclear: exact family name (candidates: `vllm:num_preemptions`, `vllm:num_preemptions_total`, `vllm_requests_swapped`).
   - Recommendation: first task of the KV-finder plan runs `curl http://127.0.0.1:8002/metrics | grep -i -E 'preempt|swap'` against a running container and records the exact names in `PROFILE_NOTES.md`; `kv_finder.metrics.py` uses those names.

2. **Whether `VLLM_FLASHINFER_MOE_BACKEND=latency` is still required on `26.03.post1-py3`.**
   - What we know: STACK.md MEDIUM-confidence says it was needed on earlier containers due to SM120 kernel issues.
   - What's unclear: whether post1 patch fixed it.
   - Recommendation: plan-phase ad-hoc — run the container once without the env, measure throughput, compare with env set. Document decision in `PROFILE_NOTES.md`.

3. **Does qwen3_coder tool-call parser emit streaming deltas or final-block on vLLM 0.19.x?**
   - What we know: vLLM 0.19 supports SSE streaming of tool_calls. qwen3_coder parser extracts JSON from `<tools>` tags.
   - What's unclear: whether the parser buffers the full tool-call until end-of-turn or streams deltas.
   - Recommendation: minimal harm in Phase 1 (smoke test is non-streaming); document behavior once Phase 2 plans start, adjust `quirks.buffer_tool_streams` if needed.

4. **Retention of `runs/<iso>-phase1-validation/` logs.**
   - What we know: D-16 defers the retention policy to plan-phase.
   - What's unclear: whether to gitignore entirely, or store compressed in LFS, or just reference-by-hash from `PROFILE_NOTES.md`.
   - Recommendation: Phase 1 gitignores everything under `runs/`; `PROFILE_NOTES.md` references by path + content hash. Phase 7 (publication) promotes archival runs to HF dataset.

---

## Sources

### Primary (HIGH confidence — verified via multiple canonical sources or read directly)

- `.planning/research/STACK.md` — already-deeply-researched stack; ARCHITECTURE, model choices, flags, digest rationale
- `.planning/research/ARCHITECTURE.md` §2, §4, §7 — profile schema shape, deployment topology, event schema
- `.planning/research/PITFALLS.md` pitfalls #1, #2, #6, #7, #8, #12, #14 — all directly relevant to Phase 1
- `.planning/research/SUMMARY.md` — "Research Flags" (Phase 1 skips new research); synthesized priorities
- CLAUDE.md — pinned stack, 8 critical pitfalls, keystone profile abstraction
- CONTEXT.md — 16 decisions D-01..D-16 (locked)
- [vLLM Qwen3.5/3.6 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) — `qwen3_coder` parser, sampling defaults
- [vLLM Tool Calling docs](https://docs.vllm.ai/en/stable/features/tool_calling/) — tool_call_parser semantics, XML → OpenAI `tool_calls`
- [vLLM Structured Outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/) — XGrammar default
- [HuggingFace Environment Variables](https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables) — `HF_HUB_OFFLINE` semantics
- [HF Transformers Installation docs](https://huggingface.co/docs/transformers/en/installation) — `TRANSFORMERS_OFFLINE`
- [Qwen3.6 HF model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) — sampling defaults, vLLM commands
- [NVIDIA NGC Catalog: vLLM container](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm)
- `/data/projects/setup_local_opencode/README.md` — prior repo measured numbers, port map, fastsafetensors timing
- `/data/projects/setup_local_opencode/validation/EXECUTIVE_SUMMARY.md` — Qwen3-Next baseline, Phase 3 SP-delivery incident
- `/data/projects/setup_local_opencode/validation/eval_tasks.py` — the 5 coding prompts + 3 literature prompts referenced by D-14
- `/data/projects/setup_local_opencode/validation/PHASE1_TEST_PROMPTS.md` — human-readable prompt spec

### Secondary (MEDIUM confidence — verified via one credible source)

- [NVIDIA Developer Forum: Qwen3.6-35B-A3B + FP8 on DGX Spark](https://forums.developer.nvidia.com/t/qwen-qwen3-6-35b-a3b-and-fp8-has-landed/366822) — throughput numbers, flags
- [NVIDIA Developer Forum: DGX Spark thermal thread](https://forums.developer.nvidia.com/t/qwen3-5-tool-calling-finally-fixed-possibly/366451) — Qwen3.5/3.6 tool-calling
- [vLLM Forums: NVIDIA DGX Spark compatibility](https://discuss.vllm.ai/t/nvidia-dgx-spark-compatibility/1756) — `VLLM_FLASHINFER_MOE_BACKEND=latency` note
- [pydantic v2 docs](https://docs.pydantic.dev/latest/) — `ConfigDict(extra='forbid', frozen=True)` pattern

### Tertiary (LOW confidence — training-data-based, flagged in Assumptions Log)

- Exact metric names in `/metrics` — A8
- Whether NGC `26.03.post1-py3` still needs `VLLM_FLASHINFER_MOE_BACKEND=latency` — Open Q #2
- Streaming behavior of qwen3_coder tool_call parser — Open Q #3

---

## Metadata

**Confidence breakdown:**
- Standard stack — **HIGH** (all locked in STACK.md; verified across multiple sources)
- Architecture — **HIGH** (ARCHITECTURE.md §2, §4 already locked; this research adds Phase-1-scoped concrete schemas)
- Pitfalls — **HIGH** (all primary pitfalls are prior-repo-verified incidents + 8 critical pitfalls in CLAUDE.md)
- Air-gap design — **MEDIUM-HIGH** (netns-level approach is structural; `docker exec` vs `ip netns` choice is validated at plan time)
- KV-finder metric names — **MEDIUM** (A8: exact name verified at plan time)
- Thermal audit — **HIGH** (prior-repo prompts read directly, characterization has explicit numbers)

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — stack is stable but vLLM ships ~biweekly, so ~monthly revalidation is right)

---

*Research for Phase 1: Serving Foundation + Profile Schema*
*Researcher: GSD phase researcher*
*Synthesized from `.planning/research/{STACK,ARCHITECTURE,PITFALLS,SUMMARY}.md` + CONTEXT.md D-01..D-16 + prior-repo artifacts*
