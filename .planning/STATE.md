---
gsd_state_version: 1.0
milestone: v0.68.0
milestone_name: milestone
status: unknown
last_updated: "2026-04-21T23:46:27.513Z"
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 17
  completed_plans: 16
  percent: 94
---

# State: Emmy

**Last updated:** 2026-04-20
**Updated by:** roadmapper (initial creation)

---

## Project Reference

**Project:** Emmy — fully-local coding agent on NVIDIA DGX Spark
**Core Value:** A local coding agent good enough to be the author's daily driver, structured rigorously enough to be a public research artifact others can reproduce — with no cloud dependency anywhere in the loop.
**Current Focus:** Phase 02 — pi-harness-mvp-daily-driver-baseline

**Authoritative documents:**

- `.planning/PROJECT.md` — what Emmy is, constraints, key decisions
- `.planning/ROADMAP.md` — 7-phase plan with success criteria
- `.planning/REQUIREMENTS.md` — 66 v1 requirements with phase mappings
- `.planning/research/SUMMARY.md` — research synthesis
- `.planning/research/STACK.md` — recommended stack (NGC vLLM 0.19.x, Qwen3.6, Gemma 4 26B MoE, pi-mono v0.68.0, XGrammar, Langfuse v3, terminal-bench 2.0)
- `.planning/research/FEATURES.md` — MVP definition split v1/v1.x/v2 with P1/P2/P3 priority
- `.planning/research/ARCHITECTURE.md` — 4-component MVP spine, two-process topology
- `.planning/research/PITFALLS.md` — 20 pitfalls; 8 critical, mapped to phases

---

## Current Position

Phase: 02 (pi-harness-mvp-daily-driver-baseline) — EXECUTING
Plan: 9 of 9 (02-08 landed 2026-04-21; 02-01 + 02-02 + 02-03 + 02-04 + 02-06 + 02-07 + 02-08 complete; next = 02-09 SC-1 walkthrough + CLOSEOUT)
**Phase:** 1 — Serving Foundation + Profile Schema — closed with 3 documented deferrals; see `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md`
**Next:** `/gsd-plan-phase 2` (pi-mono harness — daily-driver bar)
**Phase Progress:** 100% (8/8 plans landed; 3 plans carry deferrals owned by Phase 5 or Phase 7)

```
Phases: [✓][▢][▢][▢][▢][▢][▢]   1/7 phases complete
Current: Phase 2 (planning pending — daily-driver bar)
```

**Daily-driver bar:** end of Phase 2
**Research-artifact bar:** end of Phase 5
**Public artifact bar:** end of Phase 7

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 1 / 7 |
| v1 requirements complete | ongoing (Phase 2 in flight) |
| Critical pitfalls addressed | 1 / 8 (Pitfall #8 reproducibility via uv.lock + bun.lock discipline) |
| Daily-driver readiness | Not yet (blocked on Phase 2 plans 02-09) |
| Research-artifact readiness | Not yet (blocked on Phase 5) |

### Per-plan execution log

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02 P01 | 12min | 2 tasks | 20 files |
| Phase 02 P04 | 19min | 2 tasks | 20 files |
| Phase 02 P07 | 8min  | 1 task + 1 Phase-1-schema patch | 21 files (12 created, 7 modified, 2 deleted) |
| Phase 02 P08 | 135min | 2 tasks | 30 files (25 created, 5 modified) |

---

## Accumulated Context

### Decisions Made During Roadmapping

- **Phase 1 carries the SP_OK canary infrastructure** (EVAL-07), not just Phase 5. Rationale: PITFALLS.md ranks system-prompt-delivery failure as Critical and the prior repo's Phase 3 incident wasted 5/5 task scores at 0/5 success. The canary is shipped as boot-time smoke-test infrastructure used by every later phase.
- **Hash-anchored edits ship in Phase 2 as the default edit format** (TOOLS-03), not as later polish. Rationale: documented 6.7 → 68.3% improvement on 180 tasks for weak models; it is the highest-leverage single change for daily-driver feel. Plain string-replace falls back only when hashes can't be computed.
- **MCP client and web_fetch ship in Phase 2**, not later. Rationale: 2026 inflection point — MCP is now infrastructural (LF governance Dec 2025, 10k+ servers), and web_fetch is documentation reading (allowed under "no cloud inference" constraint). Daily-driver bar requires both.
- **Eval harness is sequenced as Phase 5** (parallelizable with P3/P4 after P2 stable). Rationale: it depends only on the Phase 2 SDK entry point per ARCHITECTURE.md, and isolating it means P3 and P4 don't gate on eval methodology decisions.
- **Speculative decoding is Phase 6, not earlier.** Rationale: PITFALLS.md #4 — spec decode requires working profiles + eval to measure correctly via paired benchmark; sequencing earlier would measure it against an unstable baseline.
- **Two first-class models proven at Phase 4, not Phase 1.** Rationale: adding the second model is what proves the profile abstraction is truly model-agnostic. Phase 1 ships one profile end-to-end; Phase 4 forces the abstraction by adding Gemma 4 with its own tool format and quirks.
- **Granularity calibration:** the natural phase count came out to 7, which sits at the upper edge of Standard granularity (5–8). All 7 phases are real coherent capabilities — none are padding.

### Decisions Made During Execution

- **Bun 1.3 text-lockfile (`bun.lock`) committed in place of legacy `bun.lockb`** (Plan 02-01). Bun ≥1.2 defaults to text lockfiles; the binary format is deprecated. Text lockfile preserves Pitfall #8 reproducibility while adding audit-diffability. Neither `bun.lock` nor `bun.lockb` is gitignored.
- **Profile v2 built as sibling of Phase 1-locked v1** (Plan 02-01). Preserves Phase 1 certification hash `sha256:b91e747...`; v2 harness.yaml TODO fills + hash recomputation owned by Plan 02-07.
- **pi-coding-agent 0.68.0 pinned EXACTLY (no `^`/`~`) in all four @emmy/* packages** (Plan 02-01). TS-side analog of Phase 1's `uv.lock` discipline per T-02-01-04 threat register.
- **Plan 02-04 chose pi's `createAgentSession` (SDK path) + `SessionManager.inMemory(cwd)` over the full `createAgentSessionRuntime` machinery.** Rationale: Phase 2 needs a real AgentSession + turn subscription for transcript capture, not session-replacement / fork / import flows. Plan 02-09's SC-1 walkthrough can upgrade to `AgentSessionRuntime` if interactive-TUI bindings require it; for now the adapter exposes `.session` for callers who need to drive pi directly.
- **Narrow `PiRuntime` adapter pattern** (Plan 02-04). Presents `{registerProvider, registerTool, on, session}` because @emmy/provider and @emmy/tools already target this shape. Pi's real `ExtensionAPI` is richer; adapter's `registerProvider/registerTool` are no-ops in Phase 2 (calls are ordered + observed) because Phase 2 does not plumb @emmy tools through pi's tool pipeline — that's a Phase 3 extension-runner binding.
- **CLI test hybrid execution model** (Plan 02-04 Rule 3 deviation). The execution sandbox does not route subprocess→parent localhost traffic; static CLI behaviors (--help, --print-environment, missing profile) use real `spawnSync`, network-touching paths (SP_OK canary, vLLM probe, profile validate) import and call `main()` in-process. Both exercise the same CLI orchestration logic. Pattern applies to future @emmy/* CLIs under the same sandbox.
- **`EMMY_PROFILE_VALIDATE_BIN` + `EMMY_SKIP_PROFILE_VALIDATE` env vars as CLI test hooks** (Plan 02-04). Production always shells `uv run emmy profile validate`; tests override via `EMMY_PROFILE_VALIDATE_BIN=/bin/false` to simulate failure or short-circuit via `EMMY_SKIP_PROFILE_VALIDATE=1` for failure-mode tests that don't exercise this gate.
- **`runs/phase2-sc3-capture/` transcript capture is ALWAYS ON** (Plan 02-04 / B2). No opt-in flag; every pi-emmy session writes JSONL turns so Plan 02-08's SC-3 real-replay corpus builds up passively during daily-driver use. Replay runs themselves guard against feedback by convention, not a flag.
- **Phase-1 schema patch was needed (B3/C3 discovery)** (Plan 02-07). `emmy_serve/profile/schema.py` `ToolsConfig.grammar: Optional[str]` → `Optional[GrammarConfig]`. Nested `{path, mode}` shape locked by CONTEXT D-11. v1 still validates (backward-compatible with `None` default). Committed as dated discrete commit `88e48a4` per Plan 02-07 Step 0 so Plan 02-09 CLOSEOUT can cite the SHA in its addendum. Phase 1 tests: 137 pass / 1 skip unchanged.
- **v2 `context.max_input_tokens = 114688`** (Plan 02-07). Derived honestly from `serving.yaml.engine.max_model_len` (131072) − `output_reserve_tokens` (16384) per CONTEXT-05 / SC-5. Computed via `scripts/compute_max_input_tokens.ts` (js-yaml + `@emmy/ux` at repo root). Plan-04 `TODO(plan-07)` max-model-len regression un-skipped: loads serving + harness + PROFILE_NOTES frontmatter, asserts `harness.yaml == computed`. Any future drift surfaces as a failed test.
- **v2 profile hash recomputed** via `uv run emmy profile hash --write` (Plan 02-07): `sha256:b91e747…21913` (stale v1 clone) → `sha256:0025799f…53fa41` (v2 honest). The `KNOWN-STALE` warning comment is auto-stripped by `--write` (rewrites profile.yaml in canonical YAML form). v1 unchanged (byte-identical to Phase 1 closeout). Both profiles `uv run emmy profile validate` exit 0.
- **Grammar is reactive, not always-on, and over-accepting** (Plan 02-07 landing D-11). `tools.grammar.mode: reactive` in v2/harness.yaml; `disabled` reserved for Plan 02-08's SC-3 no-grammar baseline (D-14). The XGrammar Lark (`grammars/tool_call.lark`) is deliberately over-accepting on the `arguments` object — per-tool shape validation lives in `tool_schemas/*.schema.json`. CLAUDE.md Pitfall #6 backstop-not-shape-enforcer discipline.
- **SC-3 zero-retry observation confirms D-11 thesis** (Plan 02-08). Qwen3.6-35B-A3B-FP8 emits parseable tool-call arguments on 300/300 first-try attempts across all three variants (reactive, disabled, no_per_tool_sampling) on the 100-call corpus. The reactive grammar retry path fired ZERO times. Grammar is a genuine zero-cost correctness backstop for this model; future profiles (Gemma 4 in Phase 4, harder adversarial corpora) may flip this.
- **SC-3 W3/Pitfall-#5 per_tool_sampling finding — unobservable at single-turn level** (Plan 02-08). Removing `tools.per_tool_sampling` from harness.yaml produced IDENTICAL parse-rate (1.0 aggregate) on the same 100-call corpus. This is NOT evidence the knobs are useless; it's evidence their effect is unobservable at single-turn wire-shape level — their impact manifests during multi-turn tool-selection agent loops. Phase 5 eval will revisit on terminal-bench multi-turn corpora. Plan 02-09 CLOSEOUT cites this as the boundary of Phase 2's measurement.
- **v2 profile hash re-recompute at Phase 2 close** (Plan 02-08). `sha256:0025799f3bbbb802ebed207791e5e0b39624fa93f0ad6b315d7c488e3153fa41` → `sha256:24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b` (PROFILE_NOTES.md validation_runs extended with 6 Phase-2 SC entries; content hash changed accordingly). This is Phase 2's certified-at-close v2 hash; Plan 02-09 CLOSEOUT cites it in the addendum.
- **SC-4 in-process MCP server instead of external @modelcontextprotocol/server-filesystem** (Plan 02-08). `eval/phase2/sc4/test_mcp_fs_server.ts` is a 60-line file using MCP SDK's Server + StdioServerTransport directly. Avoids an additional external npm dependency while exercising identical bridge wiring. Pattern reusable for any future SC-4-class MCP bridge test.
- **Corpus backfill-first disclosure discipline** (Plan 02-08 / D-13). `runs/phase2-sc3-capture/` was empty at plan-execute time (no daily-driver sessions captured); `corpus_fill.ts` backfilled via 50 single-turn postChat calls. Each entry's `source:` field records natural-capture vs backfill-postChat; the README.md declares the 0/50 ratio explicitly. Pattern applies to any future parse-rate corpus.

### Key Constraints Carried Forward

- **Hardware:** DGX Spark (GB10, 128 GB unified memory). Single model loaded at a time (~75 tok/s Qwen3.6, ~38–52 tok/s Gemma 4 MoE).
- **Container:** must use NGC `nvcr.io/nvidia/vllm:26.03.post1-py3`; never upstream PyPI vLLM (SM121 kernel failures).
- **Quantization:** FP8 only on DGX Spark; NVFP4 is slower than FP16 on GB10 UMA (-23.6% at 32K context) and ModelOpt 0.42.0 has a NaN bug.
- **No Gemma-4-31B Dense:** bandwidth-bound at 6.9 tok/s; only the 26B MoE variant is practical.
- **Air-gap thesis:** the entire stack must run with the network cable pulled; verified in CI.

### TODOs / Blockers

- None at this time. Awaiting `/gsd-plan-phase 1` to begin execution.

### Open Questions for Plan-Phase

Per research/SUMMARY.md "Research Flags" — questions that may need deeper research during plan-phase:

- **Phase 2:** Harness language choice (TypeScript directly on pi-mono SDK, or Python calling pi as subprocess) — affects observability bus implementation. Default lean per research: TypeScript.
- **Phase 4:** EAGLE-3 speculator availability for Gemma-4-26B-A4B specifically (RedHatAI publishes for 31B); Gemma 4 chat template handling for tool calls.
- **Phase 5:** SWE-bench Verified + mini-swe-agent API compatibility with vLLM 0.19.x; which SWE-bench-Lite subset is reproducible offline on Spark in a single eval run.
- **Phase 6:** Qwen3.6 MTP acceptance rates on coding workloads; whether two profiles can co-load on 128 GB UMA without container swaps.

Phases with standard patterns (skip research-phase per SUMMARY.md):

- **Phase 1:** stack already deeply researched; planning starts from STACK.md directly.
- **Phase 7:** publication is process work, not technical research.

---

## Session Continuity

**Current position:** Phase 1 — two gap-closure plans in flight (both blocked on DGX Spark operator):

- **Plan 01-06 (SC-1 throughput):** Task 1 COMPLETE on-machine; Task 2 PENDING (DGX Spark sweep, ~60-90 min GPU)
- **Plan 01-07 (SC-5 sampler + reproducibility):** Task 1 COMPLETE on-machine (GpuSampler `[N/A]` per-field fix, 7 tests GREEN, commits `4214b71` + `b510d1b`); Tasks 2 + 3 PENDING (two 2-hour thermal replays on DGX Spark)

**Plan 01-06 Task 2 resume signal (from 01-06-PLAN.md):** Type `"sc1 resolved"` once the operator has (a) executed the sweep producing `runs/*-phase1-sc1-throughput-sweep/results.json` with 5 candidate entries + decision field, (b) rewritten PROFILE_NOTES.md §"SC-1 throughput gap" per Template A (winner) or Template B (accept-architectural), (c) if winner, applied the knob to serving.yaml, (d) recomputed profile.yaml.hash + confirmed `emmy profile validate` exits 0, (e) committed, and (f) `uv run pytest tests/unit -q` is all-green. See `.planning/phases/01-serving-foundation-profile-schema/01-06-SUMMARY.md` for the full runbook.

**Plan 01-07 Task 2 resume signal (from 01-07-PLAN.md):** Type `"sc5 floors recorded"` once the operator has (a) confirmed `uv run pytest tests/unit/test_thermal_sampler.py -x -q` is 7/7 GREEN on the DGX Spark, (b) completed the second 2-hour `--record-floors` replay with exit 0, (c) confirmed `PROFILE_NOTES.md measured_values.gpu_clock_p5/p50_hour2_mhz` are both non-zero and within 500-5000 MHz, (d) extended `validation_runs` to ≥2 entries, (e) confirmed `uv run emmy profile validate` exits 0, (f) committed the feat. See `.planning/phases/01-serving-foundation-profile-schema/01-07-SUMMARY.md` for the full runbook.

**Plan 01-07 Task 3 resume signal (depends on Task 2 being complete first):** Type `"sc5 reproducibility green"` once the third 2-hour `--assert-floors` replay exits 0 with "All floors pass", `validation_runs` has ≥3 entries, `emmy profile validate` exits 0, and the feat commit lands.

**Plan 01-08 Task 3 resume signal:** Type `"sc4 certified"` once the operator has (a) registered the self-hosted DGX Spark runner with label `dgx-spark` per `docs/ci-runner.md` §1-§7, (b) run `./scripts/trigger_airgap_ci.sh` from a feature branch (not main) and observed the PR create, (c) both `profile-hash-integrity` AND `airgap-replay` jobs on the PR completed GREEN, (d) `./scripts/verify_airgap_ci.sh` exited 0 with the "airgap-report OK: passes=True, 4 layers green, failures=[]" summary, (e) the airgap-report.json artifact has been committed under `.planning/phases/01-serving-foundation-profile-schema/evidence/airgap-report-sc4-certification.json`, and (f) `uv run pytest tests/unit -q` is all-green. See `.planning/phases/01-serving-foundation-profile-schema/01-08-SUMMARY.md` and `docs/airgap-green-run.md` for the full runbook.

**Next action (operator):** `/gsd-execute-phase 1` with whichever of the four resume signals arrives first. Three of the DGX Spark tasks can be serialised in any order (01-06 Task 2, 01-07 Task 2, 01-08 Task 3 are independent); 01-07 Task 3 must follow 01-07 Task 2. 01-08 Task 3 is the lowest-GPU-cost of the four (~5-10 min CI time vs. 2-hour thermal replays) and is a reasonable first action after runner registration.

**Resume signal:** STATE.md current focus + ROADMAP.md Phase 1 success criteria together fully specify what "Phase 1 done" means. Plans must satisfy success criteria 1–5 of Phase 1 to advance. SC-1 closure gates Plan 01-06; SC-5 closure (sampler + reproducibility) gates Plan 01-07.

---

*State initialized: 2026-04-20 by roadmapper*

**Planned Phase:** 2 (Pi-Harness MVP — Daily-Driver Baseline) — 8 plans — 2026-04-21T20:45:37.014Z

**Plan 01-06 Task 1 completed:** 2026-04-21 — commits `feea40c` (RED) + `742fd9b` (GREEN); SUMMARY.md written; awaiting DGX Spark operator for Task 2.

**Plan 01-07 Task 1 completed:** 2026-04-21T16:40:09Z — commits `4214b71` (RED) + `b510d1b` (GREEN); SUMMARY.md written at `.planning/phases/01-serving-foundation-profile-schema/01-07-SUMMARY.md`; GpuSampler now tolerates nvidia-smi `[N/A]` per-field (DGX Spark UMA case). 7/7 sampler tests GREEN, 124/124 unit suite GREEN (1 skip for missing shellcheck), `uv run emmy profile validate` exits 0. Awaiting DGX Spark operator for Task 2 (second 2-hour `--record-floors` replay) and Task 3 (third 2-hour `--assert-floors` replay).

**Plan 01-08 Tasks 1 + 2 completed:** 2026-04-21 — commits `93fab55` (test-RED) + `78ff0be` (feat-GREEN) + `3889724` (docs); SUMMARY.md written at `.planning/phases/01-serving-foundation-profile-schema/01-08-SUMMARY.md`. SC-4 certification machinery shipped: `emmy_serve/airgap/ci_verify.py` validator + `scripts/trigger_airgap_ci.sh` + `scripts/verify_airgap_ci.sh` + 2 golden fixtures + 13 unit tests + `docs/airgap-green-run.md` runbook + `docs/ci-runner.md` §8. 137/137 unit suite GREEN (1 skip for missing shellcheck), `uv run emmy profile validate` exits 0. Awaiting DGX Spark operator for Task 3 (register runner + trigger CI + verify + commit evidence; ~5-10 min of CI time).

**Plan 02-01 completed:** 2026-04-21T21:41Z — commits `4fa82ac` (Task 1 feat: workspace + four package shells + pi-emmy shim) + `ae97e04` (Task 2 feat: v1→v2 profile clone + docs templates). SUMMARY.md at `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-01-SUMMARY.md`. Bun 1.3.13 installed during pre-flight (Rule 3 deviation: host prereq), `bun-types 1.1.42` added to workspace devDeps (Rule 3: missing types dep blocked typecheck), `bun.lock` (text, Bun 1.3 default) committed in place of legacy `bun.lockb` (Rule 3: tool format drift — reproducibility spirit preserved). All four `@emmy/*` typecheck GREEN, `pi-emmy` shim on PATH prints wave-0 message + exits 0, `profiles/qwen3.6-35b-a3b/v2/` byte-for-byte clone of v1 (9-line diff in profile.yaml only). Phase 1 guardrails held: `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0, `uv run pytest tests/unit -q` → 137 passed / 1 skipped. **Next (Wave 1):** Plans 02-02 + 02-03 + 02-06 can run in parallel.

**Plan 02-04 completed:** 2026-04-21T22:39Z — commits `44c9267` (Task 1 RED: session primitives + transcript tests) + `9e4ac4d` (Task 1 GREEN: profile-loader + prompt-assembly + sp-ok-canary + max-model-len + session-transcript with B3 + W4 + W1 fixes) + `5f85527` (Task 2 RED: session + cli + integration tests) + `e1ea63a` (Task 2 GREEN: real pi runtime adapter + profile-validate pre-flight + pi-emmy CLI with W2 + W5 + B2 fixes). SUMMARY.md at `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-04-SUMMARY.md`. 53 new @emmy/ux tests across 8 files (37 Task 1 + 16 Task 2), 1 skipped Plan-07 regression with `TODO(plan-07)` marker. `pi-emmy --help` works after `bun link`. Rule 3 deviation: CLI tests refactored to hybrid subprocess/in-process model because the sandbox does not route subprocess→parent localhost traffic to Bun.serve mocks. Full Bun suite: 191 pass / 1 skip / 0 fail across 21 files. Phase 1 regression holds: 137/137 unit tests. **Next (Wave 3):** Plan 02-07 (profile v2 fill + hash lock + un-skip regression) unblocks 02-08 (SC-2/3/4/5 evidence runners) and 02-09 (SC-1 daily-driver walkthrough CLOSEOUT).

**Plan 02-07 completed:** 2026-04-21T22:56Z — commits `88e48a4` (Phase-1-schema patch: `ToolsConfig.grammar: Optional[str]` → `Optional[GrammarConfig]`; v1 still validates) + `979a8d0` (feat: fill v2 harness.yaml with nested grammar shape + ship 8 tool schemas + XGrammar Lark + 2 prompt files + PROFILE_NOTES provenance appendix + recompute v2 hash + un-skip Plan-04 regression). SUMMARY.md at `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-07-SUMMARY.md`. Every `TODO(Phase-2)` in v2/harness.yaml filled with a real value; `context.max_input_tokens = 114688` (honest SC-5 derivation); `tools.grammar.{path: grammars/tool_call.lark, mode: reactive}` (NESTED shape per D-11). v2 hash recomputed: `sha256:b91e747…` → `sha256:0025799f…`; KNOWN-STALE comment auto-stripped. `bun test` → 192 pass / 0 fail (was 191 pass + 1 skip; +1 un-skipped SC-5 regression). `bun run typecheck` all 4 packages exit 0. `uv run pytest tests/unit -q` → 137 pass / 1 skip unchanged from Phase 1 baseline. `uv run emmy profile validate` → v1 AND v2 both exit 0. Rule 3 deviation (auto-fixed): js-yaml + @types/js-yaml + @emmy/ux added to root `package.json` devDeps so `scripts/compute_max_input_tokens.ts` resolves from repo root; Rule 1 deviation (auto-fixed): PROFILE_NOTES.md false-positive TODO narrative reworded from "TODO(Phase-2)" to "Phase-2-deferred". **Next (Wave 3):** Plan 02-08 (SC-2/3/4/5 evidence runners) targeting the now-validated v2 bundle; Plan 02-09 (SC-1 walkthrough + CLOSEOUT) referencing schema patch SHA `88e48a4` in the addendum.

**Plan 02-08 completed:** 2026-04-21 — commits `dfb8627` (test: SC-2 fixtures + runner + report (verdict=pass) + SC-3 corpora + corpus_fill) + `507623f` (feat: SC-3/4/5 evidence captured + PROFILE_NOTES validation_runs + v2 hash re-locked). SUMMARY.md at `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-08-SUMMARY.md`. Four automated SC drivers shipped and executed against live emmy-serve (127.0.0.1:8002, Qwen3.6-35B-A3B-FP8). All four pass verdicts locked: SC-2 (hash-anchored 0-failures vs baseline 1-failure; Hashline disambiguation win on sc2_05); SC-3 reactive (syn/real/agg = 1.0/1.0/1.0 over 100 calls, verdict=pass per D-12 graduated SLA) + SC-3 disabled baseline (D-14; informational, same 1.0) + SC-3 no_per_tool_sampling (W3/Pitfall-#5; informational, same 1.0); SC-4 (4/4 poison categories rejected, 2/2 in-process MCP fs-server tools dispatched flat); SC-5 (3/3 sha256 stable, AGENTS.md verbatim, max_input_tokens committed=computed=114688). Harness.yaml mutation-restore discipline (tmp backup + try/finally + post-run `uv run emmy profile validate` gate) held across all three SC-3 variants. v2 profile hash re-recomputed at Phase 2 close: `sha256:0025799f...53fa41` → `sha256:24be3eea...85d8b` (PROFILE_NOTES.md content changed; validation_runs extended with 6 Phase-2 SC entries). `bun test` → 192 pass / 0 fail; `uv run pytest tests/unit -q` → 137 pass / 1 skip (unchanged). `packages/*/src/` untouched per plan invariant (plan 08 is pure evidence-capture). 6 Rule-based auto-fix deviations all folded into the two task commits. **Next (Wave 5):** Plan 02-09 (SC-1 daily-driver walkthrough + Phase 2 CLOSEOUT) references the Phase-1-schema-patch SHA `88e48a4` + Phase-2-close v2 hash `sha256:24be3eea...85d8b`.
