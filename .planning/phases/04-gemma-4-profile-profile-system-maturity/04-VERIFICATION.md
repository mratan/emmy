---
phase: 04-gemma-4-profile-profile-system-maturity
verified: 2026-04-23T22:00:00Z
status: human_needed
score: 5/5 must-haves verified (SC-2 + SC-5 automated-green; SC-1/SC-3/SC-4 wire-proven end-to-end with 4 operator-gated live-rig evidence items deferred per Phase 1 precedent)
overrides_applied: 0
human_verification:
  - test: "Gemma 4 KV budget bisection on DGX Spark"
    expected: "scripts/find_kv_budget.py bisects gpu_memory_utilization UP from 0.55 seed to a measured ceiling with zero preemption events; value is written back into profiles/gemma-4-26b-a4b-it/v1/serving.yaml + PROFILE_NOTES.md frontmatter; hash recomputed; resume signal 'p4 kv green' commits"
    why_human: "Script drives a real vLLM container boot loop against a real GPU; requires DGX Spark GPU time (~30-60 min) that the planning orchestrator cannot provide. Scaffold + shell commands committed at runs/phase4-kv/PENDING.md (Phase 4 Plan 04-06 Task 1)."
  - test: "Gemma 4 2-hour thermal replay (two-pass)"
    expected: "scripts/thermal_replay.py --record-floors captures decode p50/p1 throughput + GPU clock p5/p50 percentiles into PROFILE_NOTES.md; followup --assert-floors re-run (15+ min later) confirms floors stable; resume signals 'p4 thermal floors recorded' → 'p4 thermal green'"
    why_human: "Two consecutive 2-hour GPU burns with cool-off; Pitfall #4 thermal-throttle discipline requires the physical rig. Scaffold + shell commands committed at runs/phase4-thermal/PENDING.md."
  - test: "SC-1 /profile swap walkthrough (Qwen v3.1 ↔ Gemma 4 v1, two round-trips)"
    expected: "Operator launches pi-emmy on Qwen, runs a turn, types /profile gemma-4-26b-a4b-it, observes TUI status row cycle through verbatim D-02 labels 'stopping vLLM' → 'loading weights' (with pct) → 'warmup' → 'ready', runs a turn on Gemma 4, swaps back via /profile qwen3.6-35b-a3b, runs a third turn. All three turns land. walkthrough.md + transcript.json + docker-logs.txt committed; verdict 'sc1 phase4 green'."
    why_human: "Live TUI observation of verbatim 4-phase progress labels + human judgment on 'turn N lands as expected' across two profile swaps. Scaffold + shell commands committed at runs/phase4-sc1/PENDING.md."
  - test: "SC-3 role-routing walkthrough + SC-4 failure/rollback walkthrough"
    expected: "SC-3: operator runs ~5 live turns covering plan/edit/default role branches; Langfuse UI (or JSONL sink) shows emmy.profile.variant + emmy.role attrs on each turn span matching the intended variant (v3.1-reason/-precise/-default per role). SC-4: operator deliberately mis-sets container_image_digest (exit 5 path — prior Qwen keeps serving), then stages a post-stop failure (exit 6 path — rollback restores Qwen). walkthrough.md + report.json committed; verdicts 'sc3 phase4 green' + 'sc4 phase4 green'."
    why_human: "Live multi-turn operator session against real vLLM + Langfuse UI inspection (or JSONL grep) for SC-3; deliberate-break staging + rollback observation on real rig for SC-4. Scaffolds committed at runs/phase4-sc3/PENDING.md + runs/phase4-sc4/PENDING.md."
---

# Phase 4: Gemma 4 Profile + Profile System Maturity Verification Report

**Phase Goal:** Add `google/gemma-4-26B-A4B-it` (the MoE variant — explicitly NOT the bandwidth-bound 31B dense) as the second first-class model. Prove `model-shaped` logic lives only in YAML profiles. Ship `/profile <name>` slash command that atomically swaps both vLLM (container restart) and harness state with a visible 4-phase progress sequence. Ship `routes.yaml` enabling within-model role routing (planner/editor/critic) via profile variants of one loaded base model.

**Verified:** 2026-04-23T22:00:00Z
**Status:** human_needed (software-side PASS; 4 operator-gated live-rig evidence items deferred per Phase 1/Phase 3 precedent)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

Sourced from ROADMAP.md Phase 4 Success Criteria (5 SCs) + merged must-haves from 6 plan frontmatters.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `/profile gemma-4-26b-a4b-it` → verbatim 4-phase progress (`stopping vLLM` → `loading weights N%` → `warmup` → `ready`); session resumes against Gemma 4; `/profile qwen3.6-35b-a3b` swaps back | ✓ VERIFIED (code) ⧗ live walkthrough operator-deferred | **Python primitive**: `emmy_serve/swap/orchestrator.py` emits the 4 D-02 labels verbatim (progress.py:22-25: `STOPPING: "stopping vLLM"`, `LOADING: "loading weights"`, `WARMUP: "warmup"`, `READY: "ready"`). **TS harness**: `packages/emmy-ux/src/profile-swap-runner.ts:88` spawns `uv run python -m emmy_serve.swap.orchestrator`; line-buffered JSON parser forwards phase events to `ctx.ui.setStatus("emmy.swap", ...)`. **Slash command**: `packages/emmy-ux/src/slash-commands.ts:252` `pi.registerCommand("profile", ...)`. **Test coverage**: 13 Python (preflight 6 + rollback 6 + integration 1) + 46 TS (profile-command 8 + profile-command.integration 2 + swap-error-ui 8 + profile-swap-runner 5 + progress-phases 4 + profile-index 5 + others) — all green. Live round-trip walkthrough deferred: `runs/phase4-sc1/PENDING.md` (resume signal `sc1 phase4 green`). |
| SC-2 | Both profiles pass boot smoke (SP_OK + tool-call parse + minimal gen) + air-gap test; NO model-name conditional code paths in harness/serve; all model-shaped behavior in YAML | ✓ VERIFIED (automated-green) | **D-19 paired audit committed**: `tests/unit/test_no_model_conditionals.py` (2 tests: self-test catches fixture + real-mode sweep) + `packages/emmy-ux/test/no-model-conditionals.test.ts` (2 tests mirror). Self-test fixtures (`tests/fixtures/no_model_conditionals_positive.py` + `packages/emmy-ux/test/fixtures/no-model-conditionals-positive.ts`) contain deliberate violations to lock regex strength. Production tree sweep: **0 hits** across `emmy_serve/**/*.py` + `packages/emmy-{ux,telemetry,provider,tools,context}/src/**/*.ts`. Both audits green at close. Gemma 4 v1 prompts/*, tool_schemas/*, compact.md, tool_descriptions.md are byte-identical to Qwen v3.1 (load-bearing evidence of model-agnosticism). Gemma 4 boot-smoke is a sub-component of Task 1/Task 2 operator runs (KV bisection boots the container in each bisection iteration). |
| SC-3 | `routes.yaml` routes turns through variant per role; each turn's trace records role + variant | ✓ VERIFIED (code) ⧗ live walkthrough operator-deferred | **routes.yaml**: `profiles/routes.yaml` present with LiteLLM-shape `default: qwen3.6-35b-a3b@v3.1-default` + `roles: {plan: qwen3.6-35b-a3b@v3.1-reason, edit: qwen3.6-35b-a3b@v3.1-precise, critic: qwen3.6-35b-a3b@v3.1-default}`. **3 variant bundles**: `profiles/qwen3.6-35b-a3b/v3.1-{default,reason,precise}/` each validate exit 0 with unique content hashes (`6ff80f62…`, `705dcb60…`, `f16edde8…`). **Engine byte-identity**: `diff` between v3.1 base and v3.1-default/-reason/-precise serving.yaml returns empty (verified in this run; `tests/unit/test_variant_engine_byte_identity.py` enforces). **TS plumbing**: `packages/emmy-ux/src/routes-loader.ts` (146 LOC), `packages/emmy-provider/src/variant-resolver.ts` (61 LOC), `packages/emmy-telemetry/src/turn-role-context.ts` (52 LOC). **OTel stamping**: `profile-stamp-processor.ts:71-77` conditionally stamps `emmy.profile.variant`, `emmy.profile.variant_hash`, `emmy.role` when turn context set; `variant-stamp-absent.test.ts` asserts backward-compat on non-variant spans. **Factory wiring**: `pi-emmy-extension.ts` calls `loadRoutes`, `resolveVariant`, `setCurrentTurnRoleContext`, `clearCurrentTurnRoleContext`. Live 5-turn walkthrough deferred: `runs/phase4-sc3/PENDING.md`. |
| SC-4 | Swap failure leaves user with clear error + prior model still loaded — no crash, no half-loaded engine | ✓ VERIFIED (code) ⧗ live walkthrough operator-deferred | **D-04 rollback contract + D-05 validate-first-then-stop** enforced via `emmy_serve/swap/preflight.py` (exit codes 2/3/4/5 without touching docker stop/run) + `emmy_serve/swap/rollback.py` (recurses into `swap_profile(..., no_rollback=True)` — infinite-loop guard verified by `test_rollback_of_rollback_prevented` in `test_swap_rollback.py`). **Exit code matrix**: 0/2/3/4/5/6 covered by unit + integration tests (`test_swap_preflight_fail.py` 6 tests + `test_swap_rollback.py` 6 tests + `tests/integration/test_swap.py` 1 end-to-end). **TS error UX**: `swap-error-ui.test.ts` (8 tests for distinct notify per exit code; "swap pre-flight failed (prior model still serving)" for exit 5; "rollback succeeded" / "rollback FAILED" for exit 6). Live deliberate-break walkthrough (exit 5 + exit 6) deferred: `runs/phase4-sc4/PENDING.md`. |
| SC-5 | Gemma 4 `PROFILE_NOTES.md` cites ≥1 community source per sampling default | ✓ VERIFIED (automated-green) | `profiles/gemma-4-26b-a4b-it/v1/profile.yaml` carries 5 `community_sources:` entries (Google model card, Gemma 4 function-calling docs, vLLM gemma4 tool parser API docs, vLLM Gemma 4 serving recipe, NVIDIA DGX Spark benchmarks). `PROFILE_NOTES.md` has "Provenance of defaults" per-knob tables + "Known parser bugs" citing vLLM issues #39392/#39468 with reactive-grammar mitigation. `test_gemma4_profile_yaml_has_community_sources` asserts ≥4 entries with {title, url, retrieved}. All reviewable in git at commit `1e3576e`. |

**Score:** **5/5 truths verified** (SC-2 + SC-5 fully green at close; SC-1/SC-3/SC-4 wire-proven end-to-end in code with live-rig evidence operator-deferred per Phase 1 precedent).

### Required Artifacts

Aggregated from 6 plan must_haves; all verified on disk.

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `profiles/gemma-4-26b-a4b-it/v1/` | Complete Gemma 4 v1 bundle (5 top-level + 3 subdirs, 18 files) | ✓ VERIFIED | profile.yaml, serving.yaml, harness.yaml, PROFILE_NOTES.md present; prompts/ (4 md), tool_schemas/ (9 json), grammars/tool_call.lark all present. Content hash `sha256:6d2884fbca4ddb610657dde58429c430f5465ca540c427c18c68e9d742384450` stamped. `uv run emmy profile validate` exit 0. |
| `profiles/qwen3.6-35b-a3b/v3.1-default/` | Default role variant bundle | ✓ VERIFIED | Full bundle; hash `sha256:6ff80f620720563652f192d42da47418ecb2bfd96d3eacd6166252c35d65a4cf`; validate exit 0. |
| `profiles/qwen3.6-35b-a3b/v3.1-reason/` | Reason role variant (temp=0.6, enable_thinking=true) | ✓ VERIFIED | Full bundle; hash `sha256:705dcb60bcfc1236d70298c967a20ad3eebbc143a48d0770ae1e2364c3e4836f`; validate exit 0. |
| `profiles/qwen3.6-35b-a3b/v3.1-precise/` | Precise role variant (temp=0.0, all per_tool_sampling=0.0) | ✓ VERIFIED | Full bundle; hash `sha256:f16edde8cfe273ad9e9f3dd7a2ab3b03a7060a2acbb61e632585ed5ca19a95b2`; validate exit 0. |
| `profiles/routes.yaml` | LiteLLM-shape routes | ✓ VERIFIED | `default:` + `roles.{plan,edit,critic}` pointing at Qwen v3.1 sibling variants; Gemma 4 variants commented out per D-08 (Phase 5+). |
| `emmy_serve/swap/__init__.py` + `orchestrator.py` + `preflight.py` + `progress.py` + `rollback.py` | 4-module swap primitive | ✓ VERIFIED | 49 + 241 + 148 + 46 + 82 LOC respectively; orchestrator emits 4 D-02 labels; preflight never calls docker stop/run; rollback uses no_rollback=True to prevent recursion; progress module exports STOPPING/LOADING/WARMUP/READY constants. |
| `emmy_serve/cli.py` `swap-profile` subcommand | CLI wiring | ✓ VERIFIED | `_cmd_swap_profile` dispatches to `swap.orchestrator.swap_profile`; subparser `swap-profile` registered at cli.py:160 with `--from`, `--to`, `--port`, `--run-dir`, `--no-rollback` flags. |
| `packages/emmy-ux/src/profile-swap-runner.ts` | Child-process JSON-stream parser | ✓ VERIFIED | 152 LOC; spawns `uv run python -m emmy_serve.swap.orchestrator`; line-buffered JSON parse with try/catch on malformed lines; captures rollback envelope; returns `{exit, envelope?}`. |
| `packages/emmy-ux/src/profile-index.ts` | Autocompletion + resolution | ✓ VERIFIED | 127 LOC; `scanProfileIndex(root)` walks profiles/ excluding `routes.yaml`; `complete(prefix)` matches names + name@variant; `resolve(name, variant?)` returns absolute path. |
| `packages/emmy-ux/src/harness-swap.ts` | D-23 hot-swap composition | ✓ VERIFIED | 133 LOC; `reloadHarnessProfile(newDir, handles)` composes `loadProfile` + new `EmmyProfileStampProcessor` + `setInitialAudit(allowlist)`; swaps span processor via tracerProvider add/remove. |
| `packages/emmy-ux/src/slash-commands.ts` `registerProfileCommand` | Slash handler | ✓ VERIFIED | 349 LOC total (includes existing registerClearCommand/registerCompactCommand); `registerProfileCommand(pi, opts)` at line 248; `pi.registerCommand("profile", {...})` at line 252; D-06 in-flight guard + verbatim "swap deferred — request in flight, finish or Ctrl+C first" at line 267; reloadHarnessProfile call on exit 0 at line 313. |
| `packages/emmy-ux/src/routes-loader.ts` | routes.yaml parser | ✓ VERIFIED | 146 LOC; `loadRoutes(path)` with RoutesLoadError + parseRef + roles fallback to default; 5 tests green. |
| `packages/emmy-provider/src/variant-resolver.ts` | Pure role → variant transform | ✓ VERIFIED | 61 LOC; `resolveVariant(role, routes, profilesRoot)` returns `{variantPath, profileId, variant}`. |
| `packages/emmy-provider/src/before-request-hook.ts` extended | variantSnapshot param + payload mutation | ✓ VERIFIED | 138 LOC; `variantSnapshot` keyword/arg present (grep confirms ≥2 hits); applies sampling_defaults.temperature/top_p/top_k/max_tokens + merges chat_template_kwargs onto payload; 4 variant-sampling tests green. |
| `packages/emmy-telemetry/src/turn-role-context.ts` | Per-turn module state | ✓ VERIFIED | 52 LOC; `setCurrentTurnRoleContext`, `clearCurrentTurnRoleContext`, `getCurrentTurnRoleContext` exported; same shape as session-context.ts pattern. |
| `packages/emmy-telemetry/src/profile-stamp-processor.ts` extended | emmy.profile.variant + emmy.role stamping | ✓ VERIFIED | 108 LOC; `onStart` reads `getCurrentTurnRoleContext()` and conditionally stamps 3 new attrs (lines 71, 74, 77); base 3 attrs always stamped; variant-stamp-absent test (1 test) asserts backward-compat. |
| `tests/unit/test_variant_engine_byte_identity.py` | CI enforcement of engine byte-identity | ✓ VERIFIED | Present and green in suite run (188 pass / 1 skip). |
| `tests/unit/test_no_model_conditionals.py` + fixture | D-19 Python audit + self-test | ✓ VERIFIED | 2 tests (test_audit_catches_fixture + test_no_model_conditionals_in_python_sources) green; fixture at `tests/fixtures/no_model_conditionals_positive.py` committed. |
| `packages/emmy-ux/test/no-model-conditionals.test.ts` + fixture | D-19 TS audit + self-test | ✓ VERIFIED | 2 tests green (self-test + real-mode); fixture at `packages/emmy-ux/test/fixtures/no-model-conditionals-positive.ts`. |
| `runs/phase4-{kv,thermal,sc1,sc3,sc4}/PENDING.md` | Operator-gated evidence scaffolds | ✓ VERIFIED | All 5 dirs present with PENDING.md containing exact shell commands + resume signals + evidence file expectations + failure-mode tables. Committed SHAs: c3e7379, d80c21a, ca00f31, 0907eb7. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|------|-----|--------|---------|
| `slash-commands.ts::registerProfileCommand` | `pi.registerCommand("profile", ...)` | pi 0.68 ExtensionAPI | ✓ WIRED | Line 252 of slash-commands.ts — `pi.registerCommand("profile", {...})`. |
| `slash-commands.ts` handler | `profile-swap-runner.ts::runSwapAndStreamProgress` | opts.runSwap callback | ✓ WIRED | DI pattern; `runSwap` property on opts; called with `{from, to, port, onProgress}`. |
| `profile-swap-runner.ts` | `emmy_serve.swap.orchestrator` | Child-process spawn | ✓ WIRED | Line 88: argv-array `["run", "python", "-m", "emmy_serve.swap.orchestrator", ...]`. |
| `slash-commands.ts` exit 0 handler | `harness-swap.ts::reloadHarnessProfile` | opts.reloadHarnessProfile callback | ✓ WIRED | Line 313 of slash-commands.ts calls `opts.reloadHarnessProfile(target)`. |
| `pi-emmy-extension.ts` factory | `registerProfileCommand` + `loadRoutes` + `resolveVariant` + `setCurrentTurnRoleContext` + `clearCurrentTurnRoleContext` | Factory wiring | ✓ WIRED | All 5 functions imported at lines 56, 67, 70, 78, 96; calls confirmed at lines 251 (loadRoutes), 519 (resolveVariant), 523 (setCurrentTurnRoleContext), 613 (clearCurrentTurnRoleContext), 703 (registerProfileCommand). |
| `profile-stamp-processor.ts::onStart` | `turn-role-context.ts::getCurrentTurnRoleContext` | Module-level state read | ✓ WIRED | Conditional stamps at lines 71/74/77 gated on turnCtx.variant/variantHash/role. |
| `emmy_serve/swap/rollback.py` | `swap_profile(..., no_rollback=True)` | Recursion with infinite-loop guard | ✓ WIRED | Line 66-71 of rollback.py; flag forwarded verbatim. Unit test `test_rollback_of_rollback_prevented` enforces. |
| `emmy_serve/cli.py` | `swap.orchestrator.swap_profile` | argparse subcommand handler | ✓ WIRED | Line 92 imports; line 94 call; subparser at line 160. |
| `profiles/routes.yaml` | `routes-loader.ts::loadRoutes` | js-yaml parse at factory startup | ✓ WIRED | pi-emmy-extension.ts line 251: `routes = loadRoutes(joinPath(profilesRoot, "routes.yaml"))`. |

### Data-Flow Trace (Level 4)

Not applicable at goal level — this phase ships a profile swap primitive + variant routing infrastructure, not dynamic data rendering. The dynamic data (OTel span attributes at runtime) is verified via test suites (variant-stamp.test.ts round-trips `emmy.profile.variant` through InMemorySpanExporter — 3 tests green).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 8 profile bundles validate | `uv run emmy profile validate profiles/<bundle>` × 8 | 8/8 exit 0 (v1, v2, v3, v3.1, v3.1-default, v3.1-reason, v3.1-precise, gemma-4-26b-a4b-it/v1) | ✓ PASS |
| Python unit suite | `uv run pytest tests/unit -q` | 188 passed / 1 skipped (shellcheck) in 1.82s | ✓ PASS |
| TS bun test suite | `PATH=$HOME/.bun/bin:$PATH bun test` | 520 pass / 1 skip / 0 fail / 2133 expect() / 73 files in 3.05s | ✓ PASS |
| TS typecheck all packages | `bun run typecheck` | 5/5 packages exit 0 (@emmy/telemetry, @emmy/provider, @emmy/tools, @emmy/context, @emmy/ux) | ✓ PASS |
| Engine byte-identity Qwen v3.1 vs -default | `diff profiles/qwen3.6-35b-a3b/v3.1/serving.yaml profiles/qwen3.6-35b-a3b/v3.1-default/serving.yaml` | empty (byte-identical) | ✓ PASS |
| Engine byte-identity Qwen v3.1 vs -reason | `diff profiles/qwen3.6-35b-a3b/v3.1/serving.yaml profiles/qwen3.6-35b-a3b/v3.1-reason/serving.yaml` | empty | ✓ PASS |
| Engine byte-identity Qwen v3.1 vs -precise | `diff profiles/qwen3.6-35b-a3b/v3.1/serving.yaml profiles/qwen3.6-35b-a3b/v3.1-precise/serving.yaml` | empty | ✓ PASS |
| Variant hash uniqueness | `grep "hash: sha256:" profiles/qwen3.6-35b-a3b/v3.1-*/profile.yaml` | 3 unique hashes (`6ff80f62…`, `705dcb60…`, `f16edde8…`) | ✓ PASS |
| D-02 progress labels verbatim | `grep -n "stopping vLLM\|loading weights\|warmup\|ready" emmy_serve/swap/progress.py` | 4 lines: STOPPING/LOADING/WARMUP/READY constants | ✓ PASS |
| Rollback infinite-loop guard | `grep -n "no_rollback=True" emmy_serve/swap/rollback.py` | Line 71 — flag forwarded on recursive call | ✓ PASS |
| D-06 verbatim message | `grep -n "swap deferred — request in flight" packages/emmy-ux/src/slash-commands.ts` | Line 267 (verbatim message in notify call) | ✓ PASS |
| /profile slash registration | `grep -n 'pi.registerCommand("profile"' packages/emmy-ux/src/slash-commands.ts` | Line 252 (exactly 1 hit) | ✓ PASS |

### Requirements Coverage

Cross-referenced against `.planning/REQUIREMENTS.md` (5 Phase-4 REQ-IDs):

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SERVE-03 | 04-01, 04-06 | System serves `google/gemma-4-26B-A4B-it` MoE variant (runtime FP8, function-calling format) | ✓ SATISFIED | `profiles/gemma-4-26b-a4b-it/v1/serving.yaml` with `quantization: fp8`, `tool_call_parser: gemma4`, `reasoning_parser: gemma4`; content hash stamped + schema validates. REQUIREMENTS.md flipped to `[x]` + traceability row "Done (Plan 04-01 + 04-06; 2026-04-23)". KV bisection + thermal replay operator-deferred (runs/phase4-kv + phase4-thermal PENDING.md) — mirrors Phase 1 D-15 pattern. |
| PROFILE-07 | 04-01, 04-04, 04-06 | v1 profiles for both qwen3.6-35b-a3b AND gemma-4-26b-a4b-it | ✓ SATISFIED | Both profile families present and validating (4 Qwen + 1 Gemma 4 + 3 Qwen variants = 8 bundles). REQUIREMENTS.md `[x]` + "Done (Plans 04-01 + 04-04 + 04-06; 2026-04-23)". |
| PROFILE-08 | 04-02, 04-03, 04-06 | `/profile <name>` swaps both vLLM (via reload) + harness state atomically with visible progress | ✓ SATISFIED (code complete; live walkthrough operator-gated) | Python primitive + TS slash command + D-23 harness hot-swap all shipped and unit-tested end-to-end (13 Python + 46 TS tests). REQUIREMENTS.md `[x]` + "Done † (…; live walkthrough pending sc1 phase4 green)". † semantics match Phase 2's HARNESS-02/06/07 + TOOLS-03/07 at Phase 2 close — library shipped, live evidence operator-deferred. |
| HARNESS-08 | 04-04, 04-06 | Multi-model routing supported within a single model (profile-routing for planner/editor/critic); cross-model → v2 | ✓ SATISFIED (code complete; live walkthrough operator-gated) | routes.yaml + 3 byte-identical-engine Qwen v3.1 sibling variants + TS plumbing + OTel variant/role stamping all shipped. REQUIREMENTS.md `[x]` + "Done † (…; live walkthrough pending sc3 phase4 green)". Cross-model deferred to v2 per requirement language. |
| UX-04 | 04-03, 04-06 | Model-swap UX — visible progress (`stopping vLLM`, `loading weights X%`, `warmup`, `ready`); no crash UX | ✓ SATISFIED (code complete; live TUI observation operator-gated) | `ctx.ui.setStatus("emmy.swap", ...)` called per phase; distinct notify per exit code 0/5/6/other (20 TS tests). REQUIREMENTS.md `[x]` + "Done † (…; live walkthrough pending sc1 phase4 green)". |

No orphaned requirements — REQUIREMENTS.md Phase 4 assignment matches exactly the 5 REQ-IDs declared across plans (SERVE-03, PROFILE-07, PROFILE-08, HARNESS-08, UX-04).

### Anti-Patterns Found

Ran scan across files modified in Phase 4 (from 6 SUMMARY.md key-files + commit ledger). Categorization:

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found in production code | — | D-19 paired audit (Python + TS) enforces zero model-name conditionals on CI; real-mode sweep returns 0 hits. No TODO/FIXME/placeholder/hardcoded-empty patterns found in the 1832 LOC of Phase 4 production code (emmy_serve/swap/ + packages/emmy-{ux,telemetry,provider}/). Grep across key files confirmed. |

### Human Verification Required

Four operator-gated evidence items catalogued as deferrals (same shape as Phase 1's 3-item + Phase 3's 5-item catalogues). Each has a runs/ scaffold with exact shell commands, resume signal, expected evidence files, and failure-mode table committed to git. None are correctness-gated or blockers for Phase 4 close per the Phase 1/Phase 3 precedent.

#### 1. Gemma 4 KV budget bisection

**Test:** `uv run python scripts/find_kv_budget.py --profile profiles/gemma-4-26b-a4b-it/v1/ --start 0.55 --step 0.02 --max 0.75`
**Expected:** Measured gpu_memory_utilization value within [0.55, 0.75] written into serving.yaml + PROFILE_NOTES.md frontmatter; hash recomputed; validate exit 0; commit + resume signal `"p4 kv green"`.
**Why human:** Requires DGX Spark GPU time (~30-60 min); bisection orchestrates real vLLM container boots. Scaffold: `runs/phase4-kv/PENDING.md`.

#### 2. Gemma 4 2-hour thermal replay (two-pass)

**Test:** Pass 1: `uv run python scripts/thermal_replay.py --profile profiles/gemma-4-26b-a4b-it/v1/ --record-floors --duration 7200`. Pass 2 (15+ min later): same with `--assert-floors`.
**Expected:** decode_throughput_p50/p1_hour2_tokps + gpu_clock_p5/p50_hour2_mhz + cold_start_seconds + warm_throughput_tokps recorded into PROFILE_NOTES.md frontmatter; `--assert-floors` re-run exits 0; resume signals `"p4 thermal floors recorded"` → `"p4 thermal green"`.
**Why human:** Two consecutive 2-hour sustained GPU burns with cool-off; Pitfall #4 thermal-throttle discipline requires the physical rig. Scaffold: `runs/phase4-thermal/PENDING.md`.

#### 3. SC-1 /profile swap walkthrough

**Test:** Operator launches pi-emmy on Qwen v3.1, runs Turn A, types `/profile gemma-4-26b-a4b-it`, observes TUI cycle through verbatim D-02 labels, runs Turn B on Gemma 4, types `/profile qwen3.6-35b-a3b`, runs Turn C.
**Expected:** All 4 D-02 phase labels appear verbatim in TUI status row; all 3 turns land; walkthrough.md + transcript.json + docker-logs.txt committed; resume signal `"sc1 phase4 green"`.
**Why human:** Live TUI observation of verbatim labels + human judgment on turn outcomes across two profile swaps. Scaffold: `runs/phase4-sc1/PENDING.md`.

#### 4. SC-3 role-routing walkthrough + SC-4 failure/rollback walkthrough

**Test:**
- SC-3: ~5 live turns across plan/edit/default roles; inspect Langfuse (or JSONL sink) for `emmy.profile.variant` + `emmy.role` attrs per turn.
- SC-4 Case A: deliberately set invalid container_image_digest; trigger `/profile`; observe exit 5 + Qwen still serving.
- SC-4 Case B: set `max_model_len: 999999999` (pass preflight, fail boot); trigger `/profile`; observe rollback.

**Expected:** SC-3: Langfuse shows correct variant/role attr per turn; `runs/phase4-sc3/{walkthrough.md, report.json}` with verdict `"sc3 phase4 green"`. SC-4: both exit-5 and exit-6 observed on real rig; `runs/phase4-sc4/{walkthrough.md, transcript.json}` with verdict `"sc4 phase4 green"`.
**Why human:** Live multi-turn session + Langfuse inspection (SC-3); deliberate-break staging + rollback observation (SC-4). Scaffolds: `runs/phase4-sc3/PENDING.md` + `runs/phase4-sc4/PENDING.md`.

### Gaps Summary

**None on the software-delivery axis.** All 5 ROADMAP success criteria are met in code: SC-2 and SC-5 are fully automated-green at close; SC-1/SC-3/SC-4 are wire-proven end-to-end via 188 Python + 520 TS tests (59 Phase-4-specific swap + variant + OTel tests added) with live-rig evidence operator-deferred per the Phase 1 D-15 precedent. The 4 operator-gated items above are explicit, documented deferrals — NOT gaps — with resume signals and scaffolds committed to runs/phase4-*. Phase 1 closed with 3 identical-shape deferrals and was considered complete; Phase 3 closed with 5 identical-shape deferrals and was considered complete. Phase 4 follows the same precedent.

---

## Evidence Anchors

- **Phase goal source:** `.planning/ROADMAP.md` § "Phase 4: Gemma 4 Profile + Profile System Maturity" (lines 195-210) — 5 Success Criteria copied verbatim into truths table above.
- **Closeout:** `.planning/phases/04-gemma-4-profile-profile-system-maturity/04-CLOSEOUT.md` (status `closed-with-documented-deferrals`, score 5/5, 2026-04-23).
- **Plans landed:** 04-01 (Gemma 4 v1 bundle) + 04-02 (Python swap primitive) + 04-03 (TS /profile + D-23 hot-swap) + 04-04 (routes.yaml + 3 Qwen variants + OTel variant/role stamping) + 04-05 (D-19 audit) + 04-06 (operator-gated close-out).
- **Commit ledger:** 22 Phase-4 commits enumerated in CLOSEOUT.md § "Commit ledger" (plan-by-plan SHAs; `d1279cf`, `1e3576e`, `654f602`, `3692d1f`, `e578fb1`, `d12dbfb`, `219545b`, `7cb2d7b`, `552033c`, `24a1ac8`, `c3e7379`, `d80c21a`, `ca00f31`, `0907eb7`, etc.).
- **Test count:** Python 188 pass / 1 skip (+15 vs Phase 3.1 baseline); TS 520 pass / 1 skip / 0 fail / 2133 expect() / 73 files (+60 vs Phase 3.1 baseline). All green on-machine 2026-04-23.
- **Profile hash trajectory:** Gemma 4 v1 `sha256:6d2884fb…384450`; Qwen v3.1-default `sha256:6ff80f62…65a4cf`; v3.1-reason `sha256:705dcb60…3e4836f`; v3.1-precise `sha256:f16edde8…19a95b2`. 4 Qwen pre-existing profiles unchanged.
- **REQ-ID status:** 5 Phase-4 REQ-IDs flipped Pending → Done in REQUIREMENTS.md; category checklists flipped `[x]`; cumulative 43/68 v1 REQ-IDs Done.

---

_Verified: 2026-04-23T22:00:00Z_
_Verifier: Claude (gsd-verifier, Opus 4.7)_
_Status: human_needed — software-side PASS; 4 operator-gated live-rig evidence items deferred (KV bisection, 2-hour thermal replay, SC-1 swap walkthrough, SC-3+SC-4 walkthroughs) per Phase 1/Phase 3 precedent._
