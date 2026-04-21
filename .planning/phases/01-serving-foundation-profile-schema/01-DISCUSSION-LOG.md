# Phase 1: Serving Foundation + Profile Schema - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 01-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 01-serving-foundation-profile-schema
**Areas discussed:** Profile bundle v1 scope, Boot + smoke-test wiring, Air-gap verification method, Thermal + KV budget methodology

---

## Profile bundle v1 scope

### Q1 — What does the Phase 1 v1 profile bundle physically contain?

| Option | Description | Selected |
|--------|-------------|----------|
| Full schema, stubbed harness.yaml | All six sub-paths exist in v1; harness.yaml is a minimal valid stub with placeholder values + TODO comments pointing to Phase 2. Proves the immutability + hash + validator machinery end-to-end. | ✓ |
| Minimal — serving + prompts only | serving.yaml + prompts/ + PROFILE_NOTES.md; harness.yaml appears in Phase 2 (bumping to v2). Less clutter, validator can't exercise the full shape. | |
| Full schema, fully-populated harness.yaml | Complete harness.yaml from STACK.md/ARCHITECTURE.md defaults in Phase 1. Tightest Phase-1→Phase-2 handoff; most work up-front. | |

**User's choice:** Full schema, stubbed harness.yaml
**Notes:** (recommended default; no additional rationale provided)

### Q2 — What does the profile content hash cover?

| Option | Description | Selected |
|--------|-------------|----------|
| Every file under the version dir, recursively | SHA256 over canonicalized manifest of (relative_path, file_sha256) tuples, sorted. Any edit bumps the hash. | ✓ |
| Only files consumed by the engine/harness | Hash covers serving.yaml + harness.yaml + files they reference. Lets PROFILE_NOTES.md be corrected without a version bump. | |
| YAML canonicalization, not file bytes | Parse YAMLs, canonicalize, then hash. Immune to whitespace/comment-only edits; more complex. | |

**User's choice:** Every file under the version dir, recursively
**Notes:** (recommended default)

### Q3 — How strict is the Phase 1 schema validator about Phase 2 fields?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict everywhere | Full schema required from v1. Missing required fields → hard fail. Stubbed values OK if they type-check. | ✓ |
| Tiered: serving strict, harness lenient | serving.yaml strictly validated; harness.yaml warning-level in Phase 1. Requires a phase/stage flag. | |
| Strict on presence, lenient on values | Structure enforced; values can be null/empty/TODO during Phase 1. Separate consumability check later. | |

**User's choice:** Strict everywhere
**Notes:** (recommended default)

### Q4 — What profile registry tooling ships in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Validator + hasher only | `emmy profile validate <path>` and `emmy profile hash <path>` — minimum to support CI-validated schema + content-hash requirements. | ✓ |
| Full CRUD CLI | `new`, `validate`, `hash`, `diff`, `list` all in Phase 1. Onboarding and Phase 4 trivial; risks over-design. | |
| Zero CLI — Makefile + scripts only | No `emmy` binary. `scripts/validate_profile.py` invoked by `make validate`. Thinnest slice. | |

**User's choice:** Validator + hasher only
**Notes:** (recommended default)

---

## Boot + smoke-test wiring

### Q1 — Where does the boot smoke test run, and who gates 'ready'?

| Option | Description | Selected |
|--------|-------------|----------|
| External — start_emmy.sh orchestrates | Container starts vLLM normally; start_emmy.sh polls healthcheck then runs external smoke test; on failure stops container. NGC image unmodified. | ✓ |
| In-container init hook | Entrypoint wrapper runs vLLM + smoke test inside the container; kills container on failure. Requires a custom image. | |
| Sidecar validator container | Separate emmy-validator container runs smoke test after vLLM. Cleanest separation; more moving parts. | |

**User's choice:** External — start_emmy.sh orchestrates
**Notes:** (recommended default)

### Q2 — What does 'boot rejected' physically look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Fail loud + roll back | Full diagnostic to runs/boot-failures/, docker stop, exit non-zero. No endpoint exposed. | ✓ |
| Fail but leave vLLM running | Diagnostic port for debugging; primary port unbound until smoke passes. | |
| Retry once, then fail | Warn, wait 10s, re-run smoke; if still fails do loud-fail path. | |

**User's choice:** Fail loud + roll back
**Notes:** (recommended default)

### Q3 — What's the SP_OK canary content?

| Option | Description | Selected |
|--------|-------------|----------|
| Literal `[SP_OK]` token in a 'respond exactly' instruction | System prompt demands literal `[SP_OK]` echo on `ping`. Simplest, matches prior-repo Phase 3 incident fingerprint. | ✓ |
| Per-boot random nonce | UUID at boot as the echo token. Prevents coincidence; adds log-analysis friction. | |
| Structured JSON echo | System demands `{"sp_ok": true, "model": "<name>"}`. Also validates structured output; brittler; overlaps with tool-parse check. | |

**User's choice:** Literal `[SP_OK]` token
**Notes:** (recommended default)

### Q4 — What's the sample tool call exercised by the parse check?

| Option | Description | Selected |
|--------|-------------|----------|
| Single read_file call with hard-coded args | One tool, one call, JSON-parseable args. Minimal, deterministic, catches format mismatch. | ✓ |
| Two sequential tool calls | read_file then write_file. Catches multi-call serialization; introduces non-determinism. | |
| One call with nested/complex args | edit_file with nested edit array. Exercises grammar more; overlaps with Phase 2 XGrammar gate. | |

**User's choice:** Single read_file call with hard-coded args
**Notes:** (recommended default)

---

## Air-gap verification method

### Q1 — Primary mechanism for proving 'zero outbound packets'?

| Option | Description | Selected |
|--------|-------------|----------|
| Network namespace isolation | Structural guarantee ("there was no network to send packets on"). Fully reproducible, automatable. | ✓ |
| iptables DROP policy + audit counter | Default-drop OUTPUT, assert DROP counter == 0. Full stack live; bypassable if root. | |
| Physical cable-pull + tcpdump snapshot | Matches ROADMAP literally. Manual; not CI-automatable. | |

**User's choice:** Network namespace isolation
**Notes:** (recommended default)

### Q2 — Does the air-gap test live in CI or a manual ritual?

| Option | Description | Selected |
|--------|-------------|----------|
| Self-hosted CI runner on the Spark | Runner on the DGX Spark; air-gap job per PR touching emmy-serve or profiles. | ✓ |
| Two-tier: cloud CI for schema, Spark for integration | Cloud for lint/schema; Spark runs real integration on tagged releases only. | |
| Manual pre-release ritual with recorded artifact | Signed checklist + evidence file committed to repo. No runner needed. | |

**User's choice:** Self-hosted CI runner on the Spark
**Notes:** (recommended default)

### Q3 — 50-turn 'synthetic coding session' content?

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic scripted session — fixed prompts | air_gap/session.jsonl checked in; 50 prescribed turns. Tests network, not model. | ✓ |
| Replay prior repo's Phase 1 prompts | Continuity baseline; padded with smoke-test-style turns. | |
| Random-sampled from terminal-bench 2.0 | Closest to real workload; adds Phase-5 dependency to Phase 1. | |

**User's choice:** Deterministic scripted session
**Notes:** (recommended default)

### Q4 — Air-gap assertion scope beyond packet count?

| Option | Description | Selected |
|--------|-------------|----------|
| Packets + DNS + HTTP outbound + vLLM telemetry flags | Layered: zero packets + no DNS + VLLM_NO_USAGE_STATS + HF_HUB_OFFLINE. | ✓ |
| Packets only — keep it simple | Just zero non-loopback packets. Risks silent-but-local leaks. | |
| Packets + outbound-audit log | Zero packets + LOG rule keeping forensic trail. Overlaps with netns if chosen. | |

**User's choice:** Packets + DNS + HTTP outbound + vLLM telemetry flags
**Notes:** (recommended default)

---

## Thermal + KV budget methodology

### Q1 — How is the final per-profile KV budget determined?

| Option | Description | Selected |
|--------|-------------|----------|
| Automated bisection finder script | scripts/find_kv_budget.py starts at 0.75, drives load, watches preemption, bisects + backs off 5%. | ✓ |
| Manual tuning with recorded journal | Operator tries values under thermal load; picks safe max; writes rationale. | |
| Calculated from model dims + max_model_len | Formula-based. Pitfall #1 explicitly warns this fails in practice. | |

**User's choice:** Automated bisection finder script
**Notes:** (recommended default)

### Q2 — What drives the 2-hour sustained thermal load?

| Option | Description | Selected |
|--------|-------------|----------|
| Replay prior repo's Phase 1 prompts in a loop | 5 real coding prompts, looped for 2 hrs; continuity with prior eval. | ✓ |
| Synthetic deterministic load — max-context stress | Worst-case power draw; overstates typical coding load. | |
| Hybrid: 80% replay + 20% synthetic stress | Average + worst-case; more orchestration. | |

**User's choice:** Replay prior repo's Phase 1 prompts in a loop
**Notes (user):** "Use #1, but check that they make sense first, since those tests in Phase 1 weren't meant for production." — Phase 1 plan must audit the prior-repo prompts for thermal representativeness (turn length mix, tool-call density, context size, duty cycle) and augment with synthetic filler if the thermal envelope is underfit. Captured as specifics item in CONTEXT.md.

### Q3 — Concrete throttle-detection threshold?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-profile documented floor, measured + asserted | Record clock floor + decode-throughput floor empirically; assert on re-runs. | ✓ |
| Hard absolute floor — GPU clock ≥ 2.0 GHz | Simple universal rule; misses throughput regressions. | |
| No throughput regression vs hour-1 baseline | Relative check; catches throttling; tight coupling to test order. | |

**User's choice:** Per-profile documented floor, measured + asserted
**Notes:** (recommended default)

### Q4 — Where do the validated numbers live?

| Option | Description | Selected |
|--------|-------------|----------|
| Baked into profile YAML + provenance in PROFILE_NOTES.md | serving.yaml carries chosen numbers; PROFILE_NOTES.md records how they were found. Profile is self-contained. | ✓ |
| Separate validation/ artifact committed alongside | Profile YAML + profiles/.../v1/validation/ directory with logs. Bulkier repo; cleaner separation. | |
| External runs/ directory, referenced from profile by hash | Profile YAML + runs/<ts>-phase1-validation/ (maybe LFS). Lean repo; discipline-dependent. | |

**User's choice:** Baked into profile YAML + provenance in PROFILE_NOTES.md
**Notes:** (recommended default) — with full raw logs also written under `runs/<iso>-phase1-validation/` for later archival (see CONTEXT.md D-16).

---

## Claude's Discretion

Captured under the `### Claude's Discretion` subsection in 01-CONTEXT.md. Summary:

- Exact directory layout inside `emmy-serve/`.
- Choice of language for `emmy-serve` (Python default, planner can justify otherwise).
- `docker run` vs single-service docker compose in `start_emmy.sh`.
- netns implementation details as long as the air-gap assertion holds.
- Concrete 50-turn `air_gap/session.jsonl` content, subject to covering every tool type.
- KV-finder's specific load mechanism during bisection.
- Exact form of `PROFILE_NOTES.md` (YAML-frontmatter vs pure markdown).

## Deferred Ideas

Captured under `<deferred>` in 01-CONTEXT.md. Summary: full profile CLI (Phase 4), XGrammar parse-rate gate (Phase 2), Gemma 4 profile (Phase 4), observability bus / Langfuse (Phase 3), chunked-prefill tuning (Phase 2/6), speculative decoding (Phase 6), reasoning-content handling (Phase 2), PROFILE_NOTES.md linter (Phase 4/7), retention policy for validation runs (Phase 7).
