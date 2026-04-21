# Phase 1: Serving Foundation + Profile Schema - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Get `Qwen/Qwen3.6-35B-A3B-FP8` loading on DGX Spark inside the pinned NGC vLLM container (`nvcr.io/nvidia/vllm:26.03.post1-py3`) and serving OpenAI-compatible `/v1/chat/completions` on loopback, backed by a versioned, content-hashed profile bundle under `profiles/qwen3.6-35b-a3b/v1/`. Boot is gated by an SP_OK canary + tool-call-parse + 100-token-generation smoke test. Air-gap (zero outbound packets), KV-budget zero-preemption, and a 2-hour thermal run must all pass before the phase closes.

**Out of Phase 1 (deferred):** the pi-mono harness, hash-anchored edit tooling, MCP, grammar-constrained tool calls at runtime (XGrammar is enabled but its parse-rate gate lives in Phase 2), observability/Langfuse, eval runner, second model (Gemma 4), speculative decoding benchmark gating.

</domain>

<decisions>
## Implementation Decisions

### Profile bundle v1 scope
- **D-01:** v1 bundle ships the **full schema** with every sub-path present: `serving.yaml` (fully populated), `harness.yaml` (minimal valid stub — required fields populated with Phase-2 placeholder values + TODO comments), `prompts/` (populated with the system prompt the smoke test needs), `tool_schemas/` (empty dir, kept in git via `.gitkeep`), `grammars/` (empty dir, `.gitkeep`), `PROFILE_NOTES.md`. Rationale: prove the immutability + hash + validator machinery end-to-end in Phase 1; Phase 2 only has to *fill* the stubs, not reshape the directory.
- **D-02:** Content hash covers **every file under `profiles/<name>/v<N>/` recursively**. Implementation: SHA256 over a canonicalized manifest of `(relative_path, file_sha256)` tuples, sorted by `relative_path`. Any file edit — prompt text, grammar bytes, yaml field, notes paragraph — bumps the hash. Matches the "any field change → new version directory" rule verbatim.
- **D-03:** Schema validator is **strict everywhere** from v1 onward. All required fields (serving + harness) must exist and type-check; stubbed *values* are allowed during Phase 1 as long as they pass the type check (e.g. `harness.yaml.context.max_input_tokens: 120000` is acceptable even though nothing consumes it yet). One validator, one source of truth, no phase-scoped flags.
- **D-04:** Profile tooling surface in Phase 1 is **validator + hasher only**: `emmy profile validate <path>` and `emmy profile hash <path>` (exact binary name TBD — could also be `python -m emmy.profile.validate` / `scripts/validate_profile.py` — planner can decide based on chosen emmy-serve language). v1 bundle is hand-written from a template checked into the repo. `new`, `diff`, `list` are deferred until Phase 4 (when a second profile exists and the ergonomics matter).

### Boot + smoke-test wiring
- **D-05:** Smoke test is **external** to the NGC container. `start_emmy.sh` orchestrates: (1) `docker run` the unmodified NGC image with the profile's `serving.yaml` as CLI args, (2) poll `GET /v1/models` until 200, (3) run `scripts/smoke_test.py` (or equivalent) from the host against loopback, (4) on success, print a ready banner + leave vLLM running; on failure, execute D-06. Rationale: container image stays unmodified so the "pinned NGC digest" claim in REPRO-01 is honest; smoke test evolves independently of the NGC cadence.
- **D-06:** "Boot rejected" is **fail loud + roll back**. On any smoke check failure: dump a diagnostic bundle to `runs/boot-failures/<iso-timestamp>/` containing (a) which check failed, (b) the assembled system prompt + user message, (c) the model's full response, (d) the active profile id/version/hash, (e) `docker logs` tail of the vLLM container. Then `docker stop` the vLLM container and `exit 1` from `start_emmy.sh`. No endpoint is ever exposed to the harness if boot is rejected.
- **D-07:** SP_OK canary uses the **literal `[SP_OK]` token** in a "respond exactly" instruction. System prompt template: `"When the user says 'ping' you must reply with the exact literal text [SP_OK] and nothing else."`. User message: `"ping"`. Assertion: response text contains `[SP_OK]`. Chosen for simplicity, cheapness (single-token echo), and direct mapping to the prior-repo Phase 3 incident's failure fingerprint. This canary infrastructure (prompt template + assertion helper + log format) is shipped by Phase 1 as a library used by every later phase's smoke test and every eval row (EVAL-07).
- **D-08:** The tool-call-parse smoke check exercises **one hard-coded `read_file` call**. Tool schema contains one tool: `read_file(path: string)`. System prompt instructs the model to call it. User message: `"call the tool read_file with path=/tmp/nothing.txt"`. Assertion: response has exactly one `tool_calls` entry, `name == "read_file"`, `arguments` JSON-parseable with `path` field. Minimal, deterministic, catches the Hermes-XML vs OpenAI-format mismatch without needing XGrammar (whose parse-rate gate is Phase 2).

### Air-gap verification method
- **D-09:** Primary mechanism is **network namespace isolation**. `start_emmy.sh` (or a wrapper invoked in the air-gap CI job) creates a netns with loopback-only routing and runs the vLLM container + smoke test inside it (`docker run --network none` + a loopback veth pair for harness↔serve, or `ip netns exec` around the compose). The guarantee is structural ("there was no network to send packets on"), not statistical ("we counted zero"). Falls back gracefully: outside CI, operator can still run the stack on a live network for normal dev.
- **D-10:** Air-gap test is a **self-hosted CI runner on the Spark**. The DGX Spark hosts a GitHub Actions runner (or equivalent); the air-gap workflow runs on every PR touching `emmy-serve/**`, `profiles/**`, or `scripts/start_emmy.sh` / `scripts/smoke_test.py`. One box of truth; no "only runs on dev laptop" gate. Cloud CI still runs schema/lint/unit tests on any runner.
- **D-11:** The 50-turn air-gap session is a **deterministic scripted replay** checked into the repo at `air_gap/session.jsonl`. 50 prescribed turns mixing read/write/edit/bash/grep tool-call patterns; replayed verbatim so the test measures the network, not the model. Exact content TBD by planner — must cover every tool type the Phase 2 harness will expose (even though the harness itself is deferred — the vLLM endpoint sees tool-call round-trips that represent the shape of a real session).
- **D-12:** Air-gap assertion is **layered**: (a) zero non-loopback packets observed/possible (netns structural), (b) no DNS queries attempted (audit resolver behavior), (c) `VLLM_NO_USAGE_STATS=1` set in container env, (d) `HF_HUB_OFFLINE=1` set so no silent HF sync can happen. All four must pass; a failure on any one is a fail-loud boot reject with the layer identified in the diagnostic.

### Thermal + KV budget methodology
- **D-13:** Final per-profile KV budget is determined by an **automated bisection finder script** shipped in Phase 1 (`scripts/find_kv_budget.py`). Algorithm: start `gpu_memory_utilization=0.75`, drive representative load for N minutes, watch vLLM preemption metric + `dmesg` OOM events, bisect upward until first preemption, back off 5% for safety margin. Output: the final value written into `serving.yaml.engine.gpu_memory_utilization` + a decision log in `PROFILE_NOTES.md` (start/end values, iterations, decisive metric, date, hardware id). Reproducible: same script on the same box yields the same number.
- **D-14:** 2-hour thermal load is **a replay of `setup_local_opencode` Phase 1 prompts in a loop**, **with a planner-level audit** to confirm the prompts are representative of sustained-load thermal stress (mix of short/long turns, tool-call density, context size distribution). Those prompts were built for *functional* eval, not production thermal stress — if the audit finds them too bursty / low-context / low-tool-density to exercise the thermal envelope, the plan must augment them with synthetic filler or a larger replay batch to hit a realistic duty cycle. The audit happens during `/gsd-plan-phase 1`; the plan's task breakdown must include it.
- **D-15:** Thermal pass criteria are **per-profile documented floors, measured and then asserted on re-runs**. Phase 1 measures: (a) steady-state GPU clock floor across the second hour (e.g. "≥ 2.2 GHz p5"), (b) decode-throughput floor (e.g. "≥ 55 tok/s p50 across hour 2, ≥ 45 tok/s p1"). These numbers are discovered empirically in the first run and then recorded into `PROFILE_NOTES.md`. CI re-runs assert the *recorded* floors are still met. Any floor drop triggers investigation before the run is marked passing. Never a theoretical absolute number — always the profile's own history.
- **D-16:** Validated numbers live in **two places**: (a) the active values (e.g. `gpu_memory_utilization: 0.82`, thermal floors) are baked into `serving.yaml` and `PROFILE_NOTES.md` — the profile is self-contained. (b) Full raw logs (finder iterations, 2-hr thermal timeseries, dmesg tails, throttle plots) are written under `runs/<iso-timestamp>-phase1-validation/` and referenced from `PROFILE_NOTES.md` by path + content hash. `runs/` content-retention policy TBD in plan-phase (probably gitignored with LFS-or-external-archival; the HF-dataset publication story in Phase 7 is where those logs land permanently).

### Claude's Discretion
- Exact script names + directory layout inside `emmy-serve/` (planner decides).
- Choice of language for `emmy-serve` and the scripts (defaults to Python per ARCHITECTURE.md §4, but planner can justify otherwise).
- Whether `start_emmy.sh` uses `docker run` directly or docker compose (single-service compose gives nicer env/mount handling; raw `docker run` is one fewer dependency).
- netns implementation details (custom `ip netns` scripting vs wrapping `docker run --network none` + fakevloopback vs podman pod netns — all acceptable if assertion D-12 holds).
- The concrete 50-turn `air_gap/session.jsonl` content, subject to covering every tool type.
- KV-finder's specific load-driving mechanism during bisection (can be a subset of the thermal replay to keep iterations fast).
- Exact form of the `PROFILE_NOTES.md` — YAML-frontmatter-plus-markdown or pure markdown; both acceptable as long as sources are cited per PROFILE-05.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and constraints
- `.planning/PROJECT.md` — vision, constraints, eight pi.dev pain points, "stand on shoulders" principle
- `.planning/REQUIREMENTS.md` — 66 v1 REQ-IDs; Phase 1 specifically covers SERVE-01/02/04/07/08/09/10/11, PROFILE-01/02/03/04/05/06/09, EVAL-07, REPRO-01/03/04
- `.planning/ROADMAP.md` §"Phase 1: Serving Foundation + Profile Schema" — goal, requirements, success criteria 1–5 (MUST satisfy to advance)
- `.planning/STATE.md` — current focus + Phase 1 starting context pointer
- `CLAUDE.md` — pinned tech stack, 8 critical pitfalls, keystone abstraction, design principles

### Stack / architecture / pitfalls (already researched — do not re-research)
- `.planning/research/STACK.md` — NGC container digest rationale, Qwen3.6 flags, FP8/NVFP4 decision, `VLLM_LOAD_FORMAT=fastsafetensors`, `VLLM_FLASHINFER_MOE_BACKEND=latency`, exact `docker run` command template, hardware-fit envelope table
- `.planning/research/ARCHITECTURE.md` §2 (profile-system design — concrete schema for `serving.yaml` / `harness.yaml` / `profile.yaml` / `routes.yaml`), §4 (deployment topology: Docker for vLLM, host for harness, HTTP loopback, hot-reload rules), §7 (observability event schema shape — informs where SP_OK boot events fit later)
- `.planning/research/PITFALLS.md` — pitfalls #1 (KV theory vs practice, addressed here via D-13/D-14), #2 (vLLM API churn, addressed via pinned container digest), #6 (SP delivery silently broken, addressed via D-07 shipped in Phase 1), #7 (thermal throttle, addressed via D-14/D-15), #8 (hidden cloud deps, addressed via D-09/D-10/D-11/D-12)
- `.planning/research/SUMMARY.md` §"Research Flags" and §"Phase 1 skip research" — research synthesis explicitly says Phase 1 plan starts from STACK.md directly; no additional research phase needed

### Prior-repo continuity (read before writing the thermal replay)
- `/data/projects/setup_local_opencode/README.md` — prior measured numbers (cold-start time, throughput, port map, fastsafetensors effect)
- `/data/projects/setup_local_opencode/validation/EXECUTIVE_SUMMARY.md` — Qwen3-Next-80B 8.5/10 winner; baseline for "what a real Phase 1 workload looks like"
- `/data/projects/setup_local_opencode/validation/COMPREHENSIVE_FINAL_ANALYSIS.md` — SP-delivery incident writeup; shape of the failure D-07 prevents
- `/data/projects/setup_local_opencode/` Phase 1 prompt set (exact path TBD during plan-phase audit for D-14) — candidate source for the 2-hour thermal replay; audit for thermal representativeness before use

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None in-repo.** Emmy is greenfield. `profiles/`, `emmy-serve/`, `scripts/`, `air_gap/` do not yet exist.
- **Reference implementations in `../setup_local_opencode/`:** the typed-YAML loader pattern (`dgx_stack/config.py`, `dgx_stack/providers/config.py`) and the run-layout pattern (`runs/layout.py`, `runs/write.py`) are explicitly called out in ARCHITECTURE.md §2 as patterns to reuse. Copy the *shape*, not the code — emmy is a clean rebuild per PROJECT.md.

### Established Patterns
- **Strict typed-YAML loader with precedence chain** (from prior dgx_stack): `defaults < repo < user < env < CLI`, `_reject_unknown_keys` for typo safety, frozen dataclasses. Planner should adopt this shape for `emmy.profile.loader`.
- **Atomic JSON append for event streams** (from prior dgx_stack `runs/write.py`): use the same `write_json_atomic` pattern for the diagnostic bundle (D-06) and the KV-finder log (D-13).

### Integration Points
- None yet — Phase 1 is the spine's root. Phase 2 plugs in on the HTTP loopback boundary; the profile registry is read by both layers via filesystem. These integration points are defined structurally by D-01..D-04 and ARCHITECTURE.md §1 "Boundary discipline."

</code_context>

<specifics>
## Specific Ideas

- **Thermal workload audit is load-bearing (from user):** "Use the prior repo's Phase 1 prompts for the 2-hour thermal replay, but check that they make sense first — those tests were built for functional eval, not production-scale thermal stress." The plan for Phase 1 must include a concrete task that (a) opens `../setup_local_opencode/` Phase 1 prompts, (b) characterizes them along the axes that matter for thermal load (average turn length, context size distribution, tool-call density, decode-to-prefill ratio, duty cycle if looped), (c) decides whether they're representative or need synthetic augmentation. Don't blindly loop them.
- **`start_emmy.sh` is a single-command contract (REPRO-01):** the entire Phase 1 success experience — container up, profile loaded, smoke test passed, ready for harness — must be reachable by running one script. The "fail loud + roll back" behavior (D-06) is part of the contract; a failed boot must be obvious from the exit status and stderr output alone.
- **The SP_OK canary shipped in Phase 1 is used everywhere downstream.** Per EVAL-07 and the prior-repo Phase 3 incident. Don't bury it inside the smoke test script — extract a small `emmy.canary` module (or equivalent shape) that later phases import.
- **Pitfall #1 discipline:** Never commit a KV budget derived from a formula or from "it didn't crash during a 30-second test." The automated finder (D-13) is the only path to a committed number. The first time someone pushes a profile with a hand-picked `gpu_memory_utilization`, Phase 1's reputation collapses.

</specifics>

<deferred>
## Deferred Ideas

- **Full profile CLI** (`emmy profile new / diff / list`) — deferred to Phase 4 where the second profile arrives and ergonomics start to matter.
- **Grammar (XGrammar) parse-rate gate** — SERVE-05 lives in Phase 2 per the ROADMAP. XGrammar is enabled by vLLM 0.19 default in Phase 1, but the 98%-parse-rate SLA and the no-grammar baseline live in Phase 2.
- **Second profile (Gemma 4)** — Phase 4 explicitly. Do not prematurely design for plurality at the directory/schema level beyond what the schema already anticipates (multiple top-level dirs under `profiles/`).
- **Observability bus / Langfuse / OTel spans** — Phase 3. Phase 1 diagnostics write to files (`runs/boot-failures/`, `runs/<iso>-phase1-validation/`) in a shape that Phase 3's observability can later ingest.
- **Chunked-prefill / prefix-caching fine-tuning** — Phase 1 turns these on per SERVE-07 (documented prefix order in `PROFILE_NOTES.md`, `enable_prefix_caching: true`, `enable_chunked_prefill: true`) but tuning `max_num_batched_tokens` etc. for workload-specific latency lives wherever a concrete need surfaces (probably Phase 2 or 6).
- **Speculative decoding (Qwen3-MTP)** — Phase 6. Phase 1 leaves `speculative: null` in `serving.yaml` or doesn't include the block; PROFILE_NOTES.md documents why spec decode is deferred behind the Phase 5 eval gate (pitfall #4).
- **Reasoning content / thinking-tag handling** — Phase 2 lesson territory (HARNESS layer concern). Phase 1 can leave `reasoning_parser` unset or default; compat-shim work lives in Phase 2 when the harness starts hitting the endpoint.
- **PROFILE_NOTES.md linter** — nice-to-have to enforce that every sampling default has a citation. Not Phase 1 scope; can be added in Phase 4 or Phase 7 (publication polish).
- **Content-retention policy for `runs/<iso>-phase1-validation/`** — Phase 7 (publication). For Phase 1, gitignore the bulky logs and reference by hash; preservation happens during artifact publication.

</deferred>

---

*Phase: 01-serving-foundation-profile-schema*
*Context gathered: 2026-04-20*
