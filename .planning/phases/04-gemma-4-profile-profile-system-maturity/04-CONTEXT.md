# Phase 4: Gemma 4 Profile + Profile System Maturity — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Source:** Consolidated from pre-existing project docs (no discuss-phase session).
User direction: "let the spirit of what we already have + research determine the remaining details."

<domain>
## Phase Boundary

Ship `google/gemma-4-26B-A4B-it` (MoE, FP8 runtime quant, native function-calling) as a second first-class profile, proving that all model-shaped logic lives in YAML and not in the harness/serve code. Ship a `/profile <name>` slash command that atomically swaps both the vLLM engine (via full container restart) and harness state, with a fixed four-phase visible progress sequence. Ship a `routes.yaml` enabling WITHIN-MODEL role routing (planner / editor / critic) via profile variants of one loaded base model. All three deliverables share one invariant — **no model-name conditional code paths exist anywhere** — enforced by audit and by the grammar/behavior of the new tests.

**In-scope requirements:** SERVE-03, PROFILE-07, PROFILE-08, HARNESS-08, UX-04.

**Explicitly out of scope for Phase 4:**
- Cross-model routing (two models co-loaded) — deferred to v2 per HARNESS-08 language ("unless dual-load proves feasible"); research may surface whether Spark's 128 GB UMA + both FP8 MoE footprints admit a dual-load experiment, but Phase 4 ships the single-loaded, within-model variant path.
- Speculative decoding for Gemma 4 (EAGLE-3) — Phase 6.
- Eval-suite comparison between Qwen3.6 and Gemma 4 — Phase 5.
- NVFP4 for Gemma 4 (ModelOpt 0.42.0 NaN bug in weight_scale tensors; CLAUDE.md Pitfall domain + STACK.md lines 121–122).

</domain>

<decisions>
## Implementation Decisions

All decisions below are **locked** by pre-existing project docs unless flagged otherwise. "Spirit" items — judgement calls that follow the pattern of prior phases without explicit doc backing — are marked SPIRIT. "Researcher/Planner discretion" items are flagged DISCRETION with a default the planner may refine.

### Swap mechanics (D-01 … D-07)

- **D-01 LOCKED:** `serving.yaml.engine.*` changes require a vLLM container restart; `harness.yaml` fields are hot-reloaded. Per ARCHITECTURE.md §4 "Hot-reload of profiles" and ARCHITECTURE.md §6 "swap the loaded model when the route changes, not load both at once." Spark's 128 GB UMA forbids dual-load by default.
- **D-02 LOCKED:** The four visible progress phases have **fixed verbatim labels**: `stopping vLLM` → `loading weights N%` → `warmup` → `ready`. Per the Phase 4 ROADMAP goal + FEATURES.md "Model swap UX" row. Any additional sub-phases are acceptable as long as these four appear and fire in this order.
- **D-03 LOCKED:** Cold-start substrate stays `VLLM_LOAD_FORMAT=fastsafetensors` (SERVE-10; ~3× speedup). `scripts/start_emmy.sh`'s existing stop-rm-run orchestration is the **foundation** the swap primitive extends, not replaces. Any new Python-side swap module is expected to share the image-ref / docker-args rendering already in `emmy_serve/boot/runner.py`.
- **D-04 LOCKED:** Failure contract — on swap failure the user must see a clear error message and **the prior model must still be loaded**. This is Phase 1 D-06 ("fail loud + roll back", diagnostic bundle to `runs/boot-failures/<iso-timestamp>/`) applied to a swap rather than a cold boot. No crash, no half-loaded engine.
- **D-05 DISCRETION (planner seeds; researcher may refine):** Default swap atomicity strategy is **validate-first-then-stop**: do everything that can fail *before* stopping the running engine — profile schema validate (`uv run emmy profile validate`), profile hash check, image digest exists locally (`docker inspect`), model weights exist on disk, render-docker-args succeeds, SP_OK canary against a dry-run smoke harness if cheap. Only after all such pre-flight checks pass does the current engine stop and the new one start. On the rare post-stop failure, auto-restart the prior profile's serving.yaml via the same primitive — rollback goes through the SAME path, not a special case. Rationale: UMA precludes keeping both engines live, and most real failure modes (typos, missing weights, broken image digest) surface in pre-flight.
- **D-06 SPIRIT (pattern from D-04 + pi TUI):** `/profile` invoked while a turn is in flight is **rejected with a short message** ("swap deferred — request in flight, finish or Ctrl+C first"). No queuing, no mid-generation tear-down. Matches pi-mono's existing posture for destructive actions + the "no crash" contract.
- **D-07 DISCRETION:** Swap orchestrator location — default split: the *vLLM-engine-side* orchestration (stop container → render args → start → poll `/v1/models` → run smoke test) lives on the **Python side** as a new `emmy_serve.swap` subcommand of the existing `emmy_serve.boot.runner` CLI, reusing `render-image-ref`, `render-docker-args`, `render-vllm-cli`, `probe.wait_for_vllm`, and `smoke_test.py`. The *harness-side* orchestration (progress UX, `/profile` slash-command registration, error surfacing, profile-loader cache invalidation) lives in **`@emmy/ux`** and shells out to the Python CLI. This mirrors the Phase 1/2 split (Python owns engine + content-hash + validator; TS owns harness + UX) and is the shortest path to "no new cross-language abstractions." Planner may choose pure-Python or pure-TS if a concrete reason shows up, but must justify it against this default.

### routes.yaml + within-model role variants (D-08 … D-12)

- **D-08 LOCKED:** `routes.yaml` lives at `profiles/routes.yaml`, LiteLLM-shaped: `default: <profile>@<variant>` + a flat `roles:` map (`plan:`, `edit:`, `critic:` at minimum). Per ARCHITECTURE.md §2 "Profile layout on disk" + Phase 4 SC-3 verbatim.
- **D-09 LOCKED:** Phase 4 implements **within-model** routing only — all three roles (plan/edit/critic) resolve to variants of the *same loaded model*. Cross-model routing is deferred per HARNESS-08. The engine stays the same; what switches per turn is harness-side state (sampling, prompts, grammar knobs).
- **D-10 DISCRETION:** Variant filesystem shape — default: **sibling directory per variant** under the same profile, content-hashed immutably, e.g. `profiles/qwen3.6-35b-a3b/v3.1-default/`, `.../v3.1-reason/`, `.../v3.1-precise/`. Each variant dir is a full profile bundle (same schema as v1/v2/v3/v3.1), but:
  - Its `serving.yaml.engine.*` section is **byte-identical** to the base variant (so none of the three trigger a restart when swapped); a CI test asserts this.
  - Its `harness.yaml` differs in `tools.per_tool_sampling`, `sampling_defaults`, `prompts.*` only.
  - Its `PROFILE_NOTES.md` cites the community source for why the sampling differs (parity with Phase 2's citation discipline).
  Rationale: preserves the content-hash and immutability invariants (Phase 1 D-01/D-02) without inventing a new "overlay" concept. Planner may pick an overlay shape (one base + tiny deltas) if research surfaces a strong reason, but must still satisfy the content-hash / validator contracts.
- **D-11 DISCRETION:** Role selection seam — default: **the harness picks the role per turn** based on an explicit tool call or message-shape heuristic, not a learned classifier. Concrete seed: a `role: plan|edit|critic|default` field on the turn envelope (set by the harness based on which tool is about to be invoked — `write`/`edit` → edit role, a `plan`-shaped user prompt → plan role, everything else → default). Planner decides the exact heuristic. The variant-snapshot lookup at turn start is the only place `routes.yaml` is read.
- **D-12 LOCKED:** Every OTel span / Langfuse event already carries `emmy.profile.*` attributes via `EmmyProfileStampProcessor` (Phase 3 HARNESS-09). Phase 4 adds a `emmy.profile.variant` field and a `emmy.role` field on the turn / chat-request spans, so SC-3's "each turn's trace records which role/profile was active" is a structured-attribute assertion, not a free-text log search. Backwards-compatible: old spans just lack the new fields.

### Gemma 4 profile v1 bundle (D-13 … D-18)

- **D-13 LOCKED:** Gemma 4 26B A4B MoE, `google/gemma-4-26B-A4B-it`, FP8 runtime quantization (NOT NVFP4). Per STACK.md lines 23, 121, 122. NVFP4 is slower than FP16 on GB10 UMA *and* has the ModelOpt 0.42.0 NaN bug — dual disqualified. **Not the 31B dense** (bandwidth-bound at 6.9 tok/s per STACK.md line 139).
- **D-14 LOCKED:** Same container (`nvcr.io/nvidia/vllm:26.03.post1-py3` via the derived `emmy-serve/vllm:26.03.post1-fst` digest-pinned image). Same boot smoke test (Phase 1 D-07 SP_OK canary + D-08 tool-call parse). Same air-gap CI (`ci_verify_phase3` strict + `ci_verify_research_egress` permissive — extended in Phase 3.1). These are shared infrastructure, not rebuilt.
- **D-15 LOCKED:** KV cache budget comes from `scripts/find_kv_budget.py` bisection on Gemma 4 (Phase 1 D-13 pattern). Thermal floors come from a 2-hour `thermal_replay.py` loop against Gemma 4 (Phase 1 D-14/D-15 pattern). First run **measures**, then the floor is baked into `PROFILE_NOTES.md`. These are operator-gated (DGX Spark GPU time); the plan may split into "run the finder / replay" tasks that resume via signal, same pattern as Phase 1 SC-1 / SC-5 deferrals.
- **D-16 LOCKED:** Community-source citation required for every non-default sampling / engine knob — parity with `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md`. SC-5 is literally this.
- **D-17 DISCRETION:** Gemma 4 `tool_call_parser` choice + chat-template handling — **RESEARCH PHASE MUST RESOLVE**. STATE.md "Open Questions for Plan-Phase: Phase 4" + SUMMARY.md "Research Flags" explicitly flag this. vLLM 0.19.x is the first release with full Gemma 4 support (STACK.md line 19). The researcher surveys vLLM tool-call parsers available for Gemma 4 (candidates: `pythonic`, `gemma_function_call`, `hermes` fallback, or a custom parser), verifies against the Gemma 4 model card's declared function-calling format, and writes the chosen parser + rationale into `PROFILE_NOTES.md` with the community source link. No Hermes fallback without a benchmarked reason (native function-calling is the docs-declared path).
- **D-18 LOCKED:** Gemma 4 profile version = **v1** (clean slate under a new profile directory `profiles/gemma-4-26b-a4b-it/v1/`). Not a version of Qwen. Parallel bundle shape to `profiles/qwen3.6-35b-a3b/v1/` per Phase 1 D-01 (the schema is identical; the values differ).

### Model-shape-logic audit (D-19)

- **D-19 LOCKED:** A grep-verifiable **"no model-name conditionals" test** lands in this phase. Concrete shape: a `tests/unit/test_no_model_conditionals.py` (Python side) and `packages/*/tests/no-model-conditionals.test.ts` (TS side) that greps source files for case-insensitive `qwen`, `gemma`, `hermes`, `llama` within `if`/`elif`/`else`/`switch`/`when`/`match` contexts and fails if any are found. Exceptions: comments, `PROFILE_NOTES.md`, tests themselves, and the lexicon of strings INSIDE profile YAML (those are data, not code). SC-2 verbatim: "neither profile contains model-name-conditional code paths in the harness or serve layers — all model-shaped behavior is in YAML." Planner decides exact allowlist + regex; the test is mandatory, not optional.

### TUI UX for `/profile` (D-20 … D-22)

- **D-20 LOCKED:** **TUI-first, no frontend UI-SPEC.md required for Phase 4.** Per CLAUDE.md "Not an IDE plugin. TUI-first" and the precedent of Phase 2/3 (neither produced UI-SPEC.md). The `ui_phase` gate in `gsd-plan-phase` is being **explicitly skipped** for this phase because the "UI hint: yes" in the roadmap refers to TUI UX surface (progress indicator), not a web/frontend deliverable.
- **D-21 LOCKED:** `/profile` slash command registration follows pi-mono's built-in slash-command extension point (same mechanism pi uses for `/model`, `/compact`, `/tree`, `/fork`). Phase 3.1 already removed the now-conflicting `/compact` emmy registration in favor of pi 0.68's built-in; Phase 4 adds `/profile` via the same `ExtensionFactory` surface in `@emmy/ux/src/pi-emmy-extension.ts`.
- **D-22 SPIRIT:** Progress UX extends the existing footer (`packages/emmy-ux/src/footer.ts`, Phase 3 UX-02), reusing the metrics-poller event loop. During a swap the footer's model-name / tok-s / KV fields are replaced (not hidden) by the progress phase string + percent. Rationale: single source of truth for "what's happening now", no new full-screen modal.

### Session preservation across swap (D-23)

- **D-23 SPIRIT:** pi-mono's `AgentSession` / `SessionManager.inMemory(cwd)` persists the user-facing transcript across provider swaps for free (Phase 2 D-03 wiring). The swap must (a) allow any in-flight streaming response to complete OR be Ctrl+C'd before initiating (D-06), (b) invalidate the harness-side profile cache (`@emmy/ux/src/profile-loader.ts`) so the next turn re-reads the new profile, (c) let the MCP tool registry survive unchanged (MCP servers are subprocess-attached at session start, not per-profile), (d) flush any open OTel span cleanly before the engine restarts so Langfuse doesn't orphan it. Specific implementation details — planner's call.

### Claude's Discretion (planner chooses, bounded by above)

- Exact task structure for the "operator-gated DGX Spark runs" (find-kv-budget + 2-hr thermal): the Phase 1 pattern is to split into a RED/GREEN-style pair with a resume signal on the operator side. Planner may copy verbatim or simplify.
- Whether `routes.yaml` ships in Phase 4 with Qwen-only variants (Phase 4 SC-3 is satisfied) + an un-selected Gemma variant line commented in, OR with both models wired up to all three roles. SC-3 verbatim lands the Qwen variants only; going further is not required.
- Whether variant filesystem layout prefers `v3.1-default/` sibling dirs (D-10 default) or a `variants/<name>/` subtree — either is acceptable if the validator and hasher don't need model changes.
- The exact allowlist shape of the grep-based "no model-name conditionals" test.
- Whether to publish a new Qwen profile version (v4?) solely to introduce the three role variants, or to graft the variants onto the existing v3.1 directory as siblings. D-10 default prefers siblings; immutability allows both.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and constraints

- `.planning/PROJECT.md` — what Emmy is, constraints, key decisions
- `CLAUDE.md` — pinned tech stack, keystone profile abstraction, 8 critical pitfalls, TUI-first posture
- `.planning/ROADMAP.md` §"Phase 4: Gemma 4 Profile + Profile System Maturity" — the authoritative goal + 5 success criteria + requirement list
- `.planning/REQUIREMENTS.md` — SERVE-03, PROFILE-07, PROFILE-08, HARNESS-08, UX-04 entries; all currently "Pending" in the traceability table

### Research (already synthesized — do not re-research)

- `.planning/research/ARCHITECTURE.md` §1 (boundary discipline — HTTP loopback + profile registry), §2 (profile layout on disk — `routes.yaml` shape, per-profile serving.yaml + harness.yaml), §4 (deployment topology — swap semantics, "Hot-reload of profiles" paragraph), §6 (eval + multi-model routing posture), §8 (extension seams)
- `.planning/research/STACK.md` lines 19–23 (vLLM 0.19.x Gemma 4 support + container digest), line 121 (FP8 vs NVFP4 on Spark), line 139 (dense-vs-MoE bandwidth wall), line 146 (reasoning-effort + chat_template_kwargs)
- `.planning/research/FEATURES.md` "Model swap UX" row (fixed progress phases + pi extension posture) and "Multi-model selection at runtime" row (one model at a time on Spark)
- `.planning/research/PITFALLS.md` #1 (KV budget from theory — reuse bisection finder), #3 (grammar fighting the model — Gemma 4 grammar decision must be reactive per Phase 2 D-11), #4 (thermal throttle — reuse 2-hr replay), #6 (SP delivery silently broken — SP_OK canary applies to Gemma 4 at boot), #8 (hidden cloud deps — air-gap CI applies to Gemma 4)
- `.planning/research/SUMMARY.md` §"Phase 4: Gemma 4 Profile + Profile System Maturity" + §"Research Flags" (explicit Phase 4 research items)

### Phase 1/2/3 artifacts Phase 4 builds on

- `.planning/phases/01-serving-foundation-profile-schema/01-CONTEXT.md` D-01..D-18 — profile bundle schema, content hash, SP_OK canary, air-gap mechanism, KV bisection, thermal methodology (this is the pattern Gemma 4 repeats)
- `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md` — Phase 1 disposition; the 3 deferrals are operator-gated, same pattern applies to Gemma 4's KV + thermal
- `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-CONTEXT.md` D-01, D-11, D-14, D-15..D-18 — workspace topology (four TS packages), reactive grammar discipline, no-grammar baseline, MCP bridge posture
- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-CLOSEOUT.md` — Phase 3 disposition; every turn span now carries `emmy.profile.*` via `EmmyProfileStampProcessor`, which Phase 4 extends with `emmy.profile.variant` + `emmy.role`
- `profiles/qwen3.6-35b-a3b/v1/` — the prototype Phase 4 copies. Every file under it has an analog in Gemma 4's new bundle.
- `profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md` — current citation discipline Phase 4 parrots for Gemma 4

### Code already in place that Phase 4 extends (do NOT rewrite)

- `emmy_serve/cli.py` — `emmy profile validate` + `emmy profile hash` entry points; Phase 4 adds `emmy profile swap` (or an equivalent in `emmy_serve.boot.runner`) that shares this argparse skeleton
- `emmy_serve/boot/runner.py` — `render-image-ref`, `render-docker-args`, `render-vllm-cli` subcommands; the swap primitive reuses these verbatim
- `emmy_serve/boot/probe.py` — `wait_for_vllm()`; reused as the "loading weights N% → warmup → ready" watcher
- `emmy_serve/profile/{schema,loader,hasher,immutability}.py` — profile bundle Python source of truth; Phase 4 extends the schema ONLY if variants need a new field (they shouldn't if D-10 default holds)
- `scripts/start_emmy.sh` — cold-boot orchestration; the swap primitive is the hot-swap counterpart and should share argument parsing style
- `scripts/smoke_test.py` — SP_OK + tool-call parse; reused unchanged for Gemma 4 boot
- `scripts/find_kv_budget.py` + `scripts/thermal_replay.py` — operator-gated validation tools; reused on Gemma 4
- `packages/emmy-ux/src/pi-emmy-extension.ts` — ExtensionFactory where `/profile` slash command registers
- `packages/emmy-ux/src/profile-loader.ts` — TS profile reader; needs variant-aware invalidation
- `packages/emmy-ux/src/footer.ts` + `metrics-poller.ts` — existing TUI footer; progress UX reuses its event loop
- `packages/emmy-telemetry/src/profile-stamp-processor.ts` — OTel attribute stamper; extend with `emmy.profile.variant` + `emmy.role`
- `air_gap/` + `emmy_serve/airgap/ci_verify.py` — strict / permissive air-gap validators; both must pass on Gemma 4 profile

### External (read-only — researcher consults only if Phase 4 research flag demands)

- `https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4` — Gemma 4 function-calling format (D-17 research item anchor)
- `https://huggingface.co/google/gemma-4-26B-A4B-it` — model card; sampling default citation source for D-16
- `https://docs.vllm.ai/` + tool-call parser registry — the set of `tool_call_parser` values vLLM 0.19.x recognizes for Gemma 4 (D-17 anchor)
- `https://docs.litellm.ai/docs/proxy/configs` — `routes.yaml` shape cross-check (D-08 anchor; ARCHITECTURE.md §2 already cites)

</canonical_refs>

<specifics>
## Specific Ideas

- **`emmy profile swap <old_profile> <new_profile>` is the single primitive** — both the TS `/profile` command and any CI script invoke this. Arguments mirror `start_emmy.sh`'s `--profile` / `--port` / `--airgap`, plus a `--run-dir` for the diagnostic bundle. Exit codes match `start_emmy.sh`'s scheme (0 ok, 1 boot rejected, 2 schema invalid, 3 digest issue, 4 prereq missing) plus a new code `5` for "swap pre-flight failed, prior engine still running".
- **Rollback path uses the same primitive.** If `emmy profile swap OLD NEW` fails post-stop, the same binary retries `emmy profile swap INVALID OLD` to revive the previous engine. The caller (`/profile` handler in TS) sees a single failure envelope with `{rolled_back: true|false, rollback_succeeded: true|false}`.
- **`routes.yaml` is a top-level file**, not per-profile. One file at `profiles/routes.yaml` selects a `default:` profile ID + variant, plus an optional `roles:` map. Absence = default-only mode (Phase 4 ships this; within-model variants are an opt-in path).
- **Variant content-hash discipline** parallels v-version hash discipline: each variant dir has its own `profile.yaml:profile.hash`, validator passes on each independently, the variant hash goes in the OTel span alongside the parent profile ID. No "delta" field in the schema.
- **The no-model-conditionals audit is a committed test**, not a lint rule. `bun test` and `uv run pytest` both include it. It runs on every CI pass. Planner chooses the exact allowlist; a minimum must include: comments, markdown files, YAML content, tests themselves, PROFILE_NOTES.md, and the profile-loader's YAML-key access paths (where "qwen3.6" appears as a dict key, not a conditional).
- **Variant selection via explicit envelope field**, not heuristics the model has to discover. Harness sets `turn.role` before the provider request fires; the `before_provider_request` hook (already in Phase 3's pi-emmy extension) picks the variant's `harness.yaml.sampling_defaults` + `per_tool_sampling` + `prompts` from the right variant bundle.
- **Progress UX uses the footer's existing event channel** — no new TUI widget library. The four phase strings are registered as metrics; the footer renderer gets a third "swap_state" row during swap and reverts to the standard row after `ready` fires.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-model routing (two models co-loaded)** — v2, unless Phase 4 research shows 128 GB UMA admits dual-load for Qwen3.6 35B A3B FP8 + Gemma 4 26B A4B FP8 simultaneously with a working KV budget. Research may produce a one-page feasibility note, but shipping dual-load is v2 territory.
- **EAGLE-3 for Gemma 4 26B** — Phase 6 (SERVE-06). RedHatAI publishes for 31B but not necessarily 26B; speculator availability is a Phase 6 research flag.
- **Qwen3-Coder-Next-80B-A3B-FP8 as a third profile** — not scheduled; revisit after daily-driver feel on Qwen3.6 + Gemma 4 is evaluated.
- **Hot `harness.yaml` reload without restart for running sessions** — Phase 4 invalidates the profile cache on swap, but does not live-edit `harness.yaml` for an in-progress session. A future phase may ship file-watch + live reconfigure if a concrete need surfaces.
- **`/profile diff` / `/profile list` slash commands** — Phase 1 D-04 deferred these pending "a second profile exists and the ergonomics matter." Phase 4 now satisfies that trigger, but we still defer them to avoid scope creep; land them opportunistically if a task unlocks.
- **npm publish of `pi-emmy`** — Phase 7.

</deferred>

---

*Phase: 04-gemma-4-profile-profile-system-maturity*
*Context consolidated 2026-04-23 from existing project docs; no discuss-phase session run (per user direction "let the spirit of what we already have + research determine the remaining details")*
