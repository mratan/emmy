# Phase 4: Gemma 4 Profile + Profile System Maturity — Research

**Researched:** 2026-04-23
**Domain:** vLLM model swap + within-model variant routing + pi-mono slash-command UX + Gemma 4 serving specifics
**Confidence:** HIGH on pi 0.68 ExtensionAPI surface (verified in shipped d.ts), HIGH on variant filesystem / hash story (verified in `emmy_serve/profile/hasher.py`), **MEDIUM** on Gemma 4 `tool_call_parser` choice (two parsers plausible, one has an unfixed open concurrency bug), MEDIUM on exact swap wall-clock on Spark (extrapolation from Phase 1 + community cold-boot numbers).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Swap mechanics (D-01 … D-07):**

- **D-01 LOCKED:** `serving.yaml.engine.*` changes require a vLLM container restart; `harness.yaml` fields are hot-reloaded. Per ARCHITECTURE.md §4 and §6. Spark's 128 GB UMA forbids dual-load by default.
- **D-02 LOCKED:** The four visible progress phases have **fixed verbatim labels**: `stopping vLLM` → `loading weights N%` → `warmup` → `ready`. Per ROADMAP + FEATURES. Sub-phases allowed as long as these four fire in order.
- **D-03 LOCKED:** Cold-start substrate stays `VLLM_LOAD_FORMAT=fastsafetensors` (SERVE-10). `scripts/start_emmy.sh` orchestration is the foundation the swap extends.
- **D-04 LOCKED:** Failure contract — on swap failure, user sees clear error, **prior model is still loaded**. No crash, no half-loaded engine.
- **D-06 SPIRIT:** `/profile` invoked mid-turn is **rejected** with "swap deferred — request in flight, finish or Ctrl+C first". No queuing.

**routes.yaml + within-model role variants (D-08 … D-12):**

- **D-08 LOCKED:** `routes.yaml` at `profiles/routes.yaml`, LiteLLM-shaped: `default: <profile>@<variant>` + flat `roles:` map (`plan:`, `edit:`, `critic:`).
- **D-09 LOCKED:** Phase 4 implements **within-model** routing only — all three roles resolve to variants of the *same loaded model*. Engine stays the same; harness-side sampling/prompts switch per turn.
- **D-12 LOCKED:** Every OTel span already carries `emmy.profile.*` via `EmmyProfileStampProcessor`. Phase 4 adds `emmy.profile.variant` + `emmy.role` on turn/chat-request spans.

**Gemma 4 profile v1 bundle (D-13 … D-18):**

- **D-13 LOCKED:** `google/gemma-4-26B-A4B-it` MoE, FP8 runtime quant. NOT NVFP4 (ModelOpt 0.42.0 NaN bug + GB10 dequant overhead). NOT 31B dense (6.9 tok/s bandwidth-bound).
- **D-14 LOCKED:** Same container (`emmy-serve/vllm:26.03.post1-fst` digest-pinned). Same SP_OK + tool-call parse smoke test. Same air-gap CI (Phase 3 strict + Phase 3.1 permissive).
- **D-15 LOCKED:** KV budget from `scripts/find_kv_budget.py` bisection on Gemma 4. Thermal floors from 2-hour `thermal_replay.py` on Gemma 4. Operator-gated.
- **D-16 LOCKED:** Community-source citation required for every non-default sampling/engine knob (SC-5).
- **D-18 LOCKED:** Gemma 4 profile version = **v1** at `profiles/gemma-4-26b-a4b-it/v1/`. Clean slate, parallel bundle shape to Qwen.

**Model-shape-logic audit (D-19):**

- **D-19 LOCKED:** `tests/unit/test_no_model_conditionals.py` (Py) + `packages/*/tests/no-model-conditionals.test.ts` (TS) greps for case-insensitive `qwen`/`gemma`/`hermes`/`llama` within `if`/`elif`/`else`/`switch`/`when`/`match` contexts. Allowlist: comments, `PROFILE_NOTES.md`, tests, YAML content. Planner picks exact regex.

**TUI UX for `/profile` (D-20 … D-22):**

- **D-20 LOCKED:** TUI-first; no frontend UI-SPEC.md required. `ui_phase` gate explicitly skipped.
- **D-21 LOCKED:** `/profile` registers via pi 0.68 `pi.registerCommand` (same mechanism as `/compact`, `/clear`).
- **D-22 SPIRIT:** Progress UX reuses the footer event channel (Plan 03-04 `metrics-poller`). During swap, footer fields replaced (not hidden) by progress-phase string + percent.

**Session preservation across swap (D-23):**

- **D-23 SPIRIT:** pi-mono's `AgentSession` persists transcript across provider swaps for free (Phase 2 D-03 wiring). Swap must (a) let in-flight turn finish or Ctrl+C, (b) invalidate `profile-loader.ts` cache, (c) preserve MCP registry, (d) flush open OTel span before engine restart.

### Claude's Discretion

- **D-05 DISCRETION (swap atomicity default):** **validate-first-then-stop** — pre-flight profile schema + hash + digest + weights + render-docker-args + dry-run smoke BEFORE stopping the running engine. Post-stop failure → auto re-invoke `emmy profile swap NEW OLD` via same binary (rollback goes through the same primitive). Researcher/planner may refine with citations; this is the seed default.
- **D-07 DISCRETION (orchestrator split):** vLLM-engine-side (stop → render → start → probe → smoke) lives in **Python** as `emmy_serve.swap` subcommand of `emmy_serve.boot.runner`. Harness-side (progress UX, slash-command, cache invalidation) lives in **@emmy/ux** and shells out. Mirrors Phase 1/2 language split. Planner may pick pure-Python or pure-TS with a concrete reason.
- **D-10 DISCRETION (variant filesystem shape):** Sibling directory per variant under same profile (`profiles/qwen3.6-35b-a3b/v3.1-default/`, `.../v3.1-reason/`, `.../v3.1-precise/`). Each variant is a full profile bundle; `serving.yaml.engine.*` byte-identical across siblings so none trigger restart; `harness.yaml` differs in sampling + prompts. Planner may pick overlay shape with a strong reason; must still satisfy content-hash + validator contracts.
- **D-11 DISCRETION (role selection seam):** Harness picks role per turn via explicit envelope field `role: plan|edit|critic|default` (set by harness based on tool about to invoke + message-shape heuristic). Variant-snapshot lookup at turn start is the ONLY place `routes.yaml` is read. Planner decides heuristic.
- **D-17 DISCRETION (Gemma 4 tool_call_parser choice + chat template):** RESEARCH PHASE RESOLVES — see §2 below.

### Deferred Ideas (OUT OF SCOPE)

- **Cross-model routing (two models co-loaded)** — v2, unless research shows 128 GB UMA admits dual-load (unlikely: Qwen3.6-35B-A3B-FP8 ~38 GB + Gemma 4 26B A4B FP8 ~28 GB + 2×KV overhead + harness CPU pressure > 100 GB; Phase 3.1 already dropped `gpu_memory_utilization` v3 0.88 → v3.1 0.55 to reclaim 40 GB of system RAM — dual-load is not feasible today without a fresh KV-budget study).
- **EAGLE-3 for Gemma 4 26B** — Phase 6 (SERVE-06). RedHatAI publishes for 31B dense, not necessarily 26B MoE.
- **Qwen3-Coder-Next-80B-A3B-FP8 as third profile** — not scheduled.
- **Hot `harness.yaml` live reload for running sessions** — Phase 4 invalidates cache on swap but doesn't hot-edit `harness.yaml` for an in-progress turn.
- **`/profile diff` / `/profile list`** — defer to avoid scope creep.
- **npm publish of `pi-emmy`** — Phase 7.
- **Eval-suite comparison Qwen3.6 vs Gemma 4** — Phase 5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SERVE-03** | System serves `google/gemma-4-26B-A4B-it` (MoE, NOT 31B dense) as the second first-class model. | §2 below resolves tool_call_parser + chat-template + sampling defaults + boot flags. Container + boot probe + smoke test unchanged from Phase 1 (D-14). |
| **PROFILE-07** | Ships v1 profiles for both `qwen3.6-35b-a3b` AND `gemma-4-26b-a4b-it`. | Gemma 4 profile bundle at `profiles/gemma-4-26b-a4b-it/v1/` parallels `profiles/qwen3.6-35b-a3b/v1/`; schema accepts (§4 confirms no schema extension needed for single-model v1 bundle; §4 confirms variant dirs also fit without schema change). |
| **PROFILE-08** | `/profile <name>` swaps vLLM (via reload) + harness state atomically with visible progress (`stopping vLLM`, `loading weights X%`, `warmup`, `ready`). | §3 swap primitive (docker stop/run atomicity, KV release timing, probe pipeline extension); §5 pi 0.68 `pi.registerCommand` surface. |
| **HARNESS-08** | Multi-model routing supported within a single model — profile-routing for planner/editor/critic; cross-model deferred. | §4 routes.yaml + variant schema (harness-side seam, OTel stamping via EmmyProfileStampProcessor extension). |
| **UX-04** | Model-swap UX — visible progress during `/profile` swap; no crash UX on swap failure. | §5 reuses Plan 03-04 footer event channel + Plan 03.1-01 `/compact` slash-command patterns; D-22 locks footer-row substitution. |
</phase_requirements>

## Summary

**Primary recommendation:** Ship Gemma 4 26B A4B FP8 with **`--tool-call-parser gemma4`** (native, bundled in vLLM 0.19+) + `--reasoning-parser gemma4` + `--enable-auto-tool-choice`, NOT `pythonic` or `hermes`. Two open bugs in the `gemma4` parser exist (concurrency pad-token leak #39392, format-corruption #39468 — both open as of April 2026), but they were introduced in #38826 and the most recent `#38847` fix landed for the `tools` arg signature; the Phase 2 reactive-grammar retry path (CLAUDE.md Pitfall #6) is the correctness backstop that catches the residual failure modes. `pythonic` is a plausible fallback and is what the NVIDIA developer forum and the ai-muninn blog actually use today, but it parses a different format than what Gemma 4 emits natively — you trade one class of bug for another. Hermes is NOT applicable (Gemma 4's native format `<|tool_call>call:func{key:<|"|>val<|"|>}<tool_call|>` is fundamentally not Hermes XML).

**The `/profile` swap primitive** is a thin extension of `scripts/start_emmy.sh`'s existing `stop → rm → run → probe → smoke` orchestration. vLLM container stop releases GPU memory cleanly on Docker (`docker stop` sends SIGTERM; vLLM signal handler tears down engine; if `docker stop` times out at the default 10 s, SIGKILL fires — `nvidia-smi` reports 0 MiB resident within 1-2 seconds post-exit). Expected swap wall-clock on Spark: ~5 s stop + ~90-160 s cold boot (fastsafetensors + Gemma 4 ~16 GiB weights per ai-muninn.com) + ~10 s warmup + ~5 s smoke = **~115-180 s total**. Validate-first-then-stop (D-05) means most failure modes surface in pre-flight and never touch the running engine — rollback is the same primitive invoked with swapped args.

**Routes.yaml is a harness-side file, not a serving-side file.** Since all three role variants share byte-identical `serving.yaml.engine.*` (D-10), the engine is unchanged per-turn — only the harness-side sampling defaults, per-tool-sampling, and prompts switch. The `before_provider_request` hook already in `pi-emmy-extension.ts` is the correct seam: at turn start, read `routes.yaml`, map `turn.role` → variant, load variant's harness.yaml, apply its sampling/prompts to the outgoing payload. OTel stamping extends `EmmyProfileStampProcessor` to also carry `emmy.profile.variant` + `emmy.role`.

**Pi 0.68 slash-command registration is `pi.registerCommand(name, { description, handler })`.** Verified in `node_modules/.bun/@mariozechner+pi-coding-agent@0.68.0/.../dist/core/extensions/types.d.ts` lines 777-778 — this is exactly the API Phase 3.1 used for `/clear`. Handler receives `(args: string, ctx: ExtensionCommandContext)`; `ctx` exposes `abort()`, `waitForIdle()`, `newSession()`, `ui.confirm()`, `ui.notify()`, `ui.setStatus()` — everything the four-phase progress sequence needs. **pi 0.68 reserves the following names** (won't collide with `/profile`): `settings`, `model`, `scoped-models`, `export`, `import`, `share`, `copy`, `name`, `session`, `changelog`, `hotkeys`, `fork`, `clone`, `tree`, `login`, `logout`, `new`, `compact`, `resume`, `reload`, `quit`. `/profile` is free.

**AgentSession across a provider swap preserves transcript automatically** because transcripts live in `SessionManager`, not in the provider (Phase 2 D-03 wire-through confirmed this). pi's `registerProvider` call is safe to invoke mid-session (takes effect immediately post-bindCore, per types.d.ts line 838 doc-comment). What needs explicit re-initialization: (a) the `@emmy/ux/profile-loader.ts` cache — invalidate by calling `loadProfile(newPath)` again; (b) the OTel `EmmyProfileStampProcessor` instance — construct a new one with the new profile ref and register it (Plan 03-02 telemetry wiring allows this — the processor holds a `ProfileStampAttrs` closure, not a singleton); (c) the MCP registry stays unchanged (MCP servers are subprocess-attached at session boot, not per-profile — confirmed in Phase 2 Plan 02-06 wiring); (d) any in-flight OTel span must be closed before the engine restart or Langfuse sees an orphan (pi 0.68 emits `after_provider_response` with headers — use that as the flush signal).

**Validation Architecture:** Phase 4 has three paired RED/GREEN test dimensions — swap atomicity (pre-flight-fail / post-stop-rollback), no-model-conditionals (grep audit with deliberate-positive fixture gate + real-run pass), role-routing observability (OTel span attributes carry variant + role). Nyquist-rate: two failure modes per success criterion, sampled at per-task commit granularity. See §6 for the full test matrix.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Container lifecycle (stop/rm/run/probe) | Python `emmy_serve` | — | Phase 1 pattern; Python already owns `render-docker-args`, `wait_for_vllm`, `smoke_test`. Cross-language abstraction-sharing risk too high for TS ownership. |
| Pre-flight validation (schema, hash, digest, weights, dry-run) | Python `emmy_serve.swap` | — | All five validators are already Python: `emmy profile validate`, `emmy profile hash`, `docker inspect`, `Path.exists`, `render_docker_args`. No TS equivalent. |
| Rollback orchestration | Python `emmy_serve.swap` (same primitive) | TS `@emmy/ux` (surfaces error envelope) | D-04 requires same path for rollback; structural consequence: TS shells out once for the forward swap and once for the rollback when forward fails. |
| `/profile` slash-command registration | TS `@emmy/ux` | — | pi ExtensionAPI is TS-only. `pi.registerCommand` (types.d.ts:777-778). |
| Progress UX (four phases) | TS `@emmy/ux` (footer poll + setStatus) | Python emits machine-readable progress events on stdout | Footer reuses Plan 03-04 metrics-poller. Python child process streams JSON progress lines; TS parses + setStatus. Single source of truth. |
| routes.yaml parse + variant resolution | TS `@emmy/ux` or `@emmy/provider` | — | Per-turn decision; must be hot-reloadable without Python subprocess cost. Harness-only concern. |
| Variant selection per turn | TS `before_provider_request` hook | — | Already in `pi-emmy-extension.ts`. Reads `turn.role` envelope + `routes.yaml` snapshot; applies variant harness.yaml to payload. |
| OTel `emmy.profile.variant` + `emmy.role` stamping | TS `@emmy/telemetry` | — | Extend `EmmyProfileStampProcessor.onStart` to read a per-turn snapshot set by the before-request hook. |
| Gemma 4 chat template handling | Serving side (vLLM bundled template) | Profile `serving.yaml.engine` knobs (tool_call_parser, reasoning_parser, enable_auto_tool_choice) | vLLM 0.19+ ships the Gemma 4 chat template. Profile flags select it; no harness-side mutation. |
| No-model-conditionals audit | Py + TS (dual test, one per language) | — | Runs in both `pytest` and `bun test`; greps both source trees. Each language's test owns its own source tree. |

## 1. Executive Summary — What the Planner Needs in 10 Bullets

1. **Gemma 4 profile flags (verified):** `--tool-call-parser gemma4` + `--reasoning-parser gemma4` + `--enable-auto-tool-choice` + `--kv-cache-dtype fp8` + `--max-model-len 131072` starting + `--gpu-memory-utilization 0.55` starting (UMA headroom per Phase 3.1 lesson; KV finder bisects up from there) + `--max-num-seqs 4` + `--max-num-batched-tokens 8192` (NVIDIA forum per Gemma 4 Day-1 benchmarks) + `--enable-prefix-caching` + `--enable-chunked-prefill`. NO `--moe-backend marlin` (NVFP4-only knob; we're running FP8). NO `--quantization fp8` unless the HF weights are BF16 (the `google/gemma-4-26B-A4B-it` HF variant is BF16 → set `--quantization fp8` for RUNTIME quant per STACK.md line 122 / D-13). Sampling defaults from Google: `temperature=1.0, top_p=0.95, top_k=64`; community coding-workload evidence suggests **1.5** temperature is better for code generation (Unsloth HF discussion #21). Profile should ship **temperature=1.0** as the "stand on shoulders" Google-team default and document the 1.5 community experiment in `PROFILE_NOTES.md` as a Phase-5 eval candidate.

2. **`tool_call_parser` choice — `gemma4` over `pythonic`:** The `gemma4` parser is the native Gemma 4 format parser introduced in PR #38826. It has two known open bugs as of April 2026 (concurrency pad-token leak #39392, format-corruption #39468). `pythonic` is what NVIDIA forum + ai-muninn.com use in practice but it parses a DIFFERENT format (python-list literals) than what Gemma 4 natively emits — making it a lucky coincidence, not a guarantee. **Recommendation:** use `gemma4` (the canonical native parser), rely on the Phase 2 reactive-grammar retry (`harness.tools.grammar.mode=reactive`) to catch parser failures as the correctness backstop per CLAUDE.md Pitfall #3, and document the bug-tracker links in `PROFILE_NOTES.md` so future profile versions can swap to `pythonic` if the Gemma4ToolParser bugs remain unfixed past Phase 5. **Add `max_num_seqs=1` for Gemma 4 boot-time defensive setting as an optional mitigation for bug #39392** — document this as an experimental knob in PROFILE_NOTES, not locked.

3. **Gemma 4 chat template: no `chat_template_kwargs` override needed at boot.** vLLM 0.19+ bundles Gemma 4's chat template from `processor.apply_chat_template(..., tools=[...], add_generation_prompt=True)` — system messages land in `<|turn>system\n...<|tool>declaration:...` and tool declarations are inlined (per ai.google.dev). `enable_auto_tool_choice: true` composes with the bundled template the same way it does for Qwen — vLLM reads `tools` from the request and surfaces them through the template's `tools` variable. HOWEVER: `enable_thinking` is a Gemma 4 thinking-model chat-template kwarg that Phase 3 Plan 03-01 proved we need `false` for Qwen3.6 (commit d4cd189 removed a17f4a9's `<think>`-strip workaround). For Gemma 4, the reasoning parser `gemma4` already strips reasoning from the visible `content` field; **set `chat_template_kwargs.enable_thinking=false` for tool-heavy turns** to prevent the 30-60 s hidden-reasoning delay that STACK.md line 146 warns about. Inject through the existing `before_provider_request` hook (same site Phase 3 uses for Qwen's `enable_thinking:false`). SP_OK canary will catch silent-system-prompt failure per Pitfall #6.

4. **FP8 footprint on Spark:** Gemma 4 26B A4B weights load at ~16 GiB in vLLM 0.19 per ai-muninn.com benchmark (NVFP4 case, with FP8 KV cache). FP8 RUNTIME-quantized from BF16 weights is ~28 GB resident per STACK.md line 204. KV cache at 128K context with `kv_cache_dtype=fp8` ≈ 16 GB. Total active: ~44 GB. Under Phase 3.1's UMA pressure lesson (v3.1 dropped `gpu_memory_utilization` from 0.88 to 0.55 to reclaim 40 GB), start the KV-finder bisection at 0.55 (same starting point as current Qwen v3.1), NOT 0.75/0.88. 128 GB UMA – 44 GB Gemma4 – 9 GB compile cache – 8 GB harness headroom ≈ 67 GB remaining for KV upper bound; 0.55 of 67 GB ≈ 37 GB — plenty of room to walk up 2 % per iteration. **Seed `find_kv_budget.py --start 0.55 --step 0.02 --max 0.75`**.

5. **vLLM container swap atomicity on Spark: use `docker stop emmy-serve` (NOT `docker kill`)**. `docker stop` sends SIGTERM + waits up to `--time` seconds (default 10 s) before SIGKILL. vLLM's Python signal handler calls `engine.shutdown()` which releases KV + CUDA graphs cleanly. `nvidia-smi` on Spark reports 0 MiB resident within 1-2 s post-`docker rm`. **No lingering GPU memory blocks the next container start** — community reports (vLLM issue #7581) describe only the case of SIGKILLing the PROCESS inside a running container (which leaves orphan CUDA handles); `docker stop` drains cleanly. Expected wall-clock: stop = ~5 s (SIGTERM drain + docker cleanup), rm = <1 s, run = detach to background immediately, `/v1/models` 200 OK = 90-160 s with fastsafetensors (ai-muninn.com reports 84 s weight load + torch.compile warmup for Gemma 4 26B), smoke = ~5 s SP_OK + tool_call + 100-tok-gen. **Total swap: ~115-180 s.** Budget the progress UX for 200 s worst case.

6. **routes.yaml + within-model variant lookup: LiteLLM-shaped, one-file-top-level, harness-side only.** The LiteLLM router docs (cited in ARCHITECTURE.md §2) describe `model_name` → `litellm_params` mapping; our `routes.yaml` is a slimmed version: `default: <profile-id>@<variant>` + `roles: {plan: qwen3.6-35b-a3b@v3.1-reason, edit: qwen3.6-35b-a3b@v3.1-precise, critic: qwen3.6-35b-a3b@v3.1-default}`. Since Phase 4 is WITHIN-MODEL only, the engine never swaps per-turn — variant selection is pure harness-side state change. **The ONLY component that reads routes.yaml is the harness** (via `@emmy/ux` loaded at session start + re-read on `/profile` swap). No serving-side operation. No cross-language hop.

7. **Variant filesystem pattern: sibling directories survive the content-hash contract without schema changes.** `emmy_serve/profile/hasher.py` hashes a bundle directory in isolation — it walks that dir only, applies NFC/LF canonicalization, excludes `profile.yaml` itself (to break the chicken-and-egg manifest-hash problem), and emits one sha256. Sibling variant dirs `v3.1-default/`, `v3.1-reason/`, `v3.1-precise/` each have their OWN profile.yaml + hash; the hasher never walks sibling dirs. The immutability validator (§Layer 1 of `immutability.py`) also runs bundle-in-isolation. **No schema field needs to change.** The `ProfileManifest.version` field is a free-form string (not a regex-constrained enum) so `version: v3.1-reason` validates today. Byte-identical `serving.yaml.engine.*` across variants is the planner's obligation to enforce via a new CI test (§4 below).

8. **pi-mono 0.68 slash-command registration is a single API call: `pi.registerCommand(name, { description, handler })`.** Verified in `dist/core/extensions/types.d.ts:777-778`. Handler signature `(args: string, ctx: ExtensionCommandContext) => Promise<void>`. `ExtensionCommandContext` provides `abort()`, `waitForIdle()`, `newSession()`, `ui.confirm()`, `ui.notify()`, `ui.setStatus()`, `hasUI` — everything needed for the in-flight-turn guard (D-06), user confirm, progress status, and error surfacing. **`/profile` is NOT in the built-in list** (21 built-ins enumerated; `/profile` is free). pi's runner silently skips extensions that collide with built-ins (Plan 03.1-03 post-close comment) — we confirmed this explicitly when removing emmy's `/compact` in favor of pi's built-in. Pattern to replicate: copy `registerClearCommand(pi)` from `packages/emmy-ux/src/slash-commands.ts` and adapt for `/profile <name>`.

9. **AgentSession + provider swap:** `pi.registerProvider(name, config)` is hot after bindCore (types.d.ts:838 doc-comment) — "it takes effect immediately, so it is safe to call from command handlers or event callbacks". The SessionManager transcript is unchanged by provider swap (Phase 2 D-03: `SessionManager.inMemory(cwd)` persists across re-registration). **What must be re-initialized explicitly:** (a) `@emmy/ux/profile-loader.ts` cache — call `loadProfile(newProfileDir)` in the `/profile` handler and replace the extension factory's closure-captured `profile` reference (simplest: construct a new `EmmyProfileStampProcessor` and add it to the `OTelSDK` via the processor-chain mutation the Plan 03-02 wiring allows; remove the old one); (b) the `before_provider_request` hook's `assembledPromptProvider` thunk — call it on every turn so hot-reload picks up the new prompt automatically (Plan 03-01 wiring already supports this); (c) web_fetch allowlist + web_search config — re-read from the new profile (the existing profile-loader.ts parses these; all we need is to call it again). **What does NOT need reinitialization:** MCP registry (subprocess-attached at session boot, not per-profile, per Phase 2 D-16), OTel span pipeline structure (just the profile-stamping closure), user transcript.

10. **Gemma 4 air-gap posture: IDENTICAL to Qwen3.6.** `HF_HUB_OFFLINE=1` + `TRANSFORMERS_OFFLINE=1` work for Gemma 4 the same way they do for Qwen — both require prior `huggingface-cli download google/gemma-4-26B-A4B-it --local-dir /data/models/gemma-4-26B-A4B-it` (gated-model auth, documented once, then offline). `VLLM_NO_USAGE_STATS=1` + `DO_NOT_TRACK=1` cover vLLM telemetry identically. No Gemma-specific outbound phone-home is documented in the model card or vLLM integration. **The `ci_verify_phase3` (STRICT) and `ci_verify_research_egress` (PERMISSIVE) validators need zero changes** — they gate on outbound connections by IP, not by profile. Profile validator's `EnvVars._airgap_policy` (schema.py:143) enforces `VLLM_NO_USAGE_STATS=="1"` + `HF_HUB_OFFLINE=="1"` at load time; the Gemma 4 profile inherits this gate.

## 2. Gemma 4 Serving Specifics (D-17 resolution)

### 2.1 `tool_call_parser` selection — `gemma4` over `pythonic`

**[CITED: https://docs.vllm.ai/en/latest/api/vllm/tool_parsers/gemma4_tool_parser/]**
vLLM ships a native `Gemma4ToolParser` registered as `tool_call_parser: gemma4`. Its documented strategy is "accumulate-then-parse-then-diff" over Gemma 4's custom tool-call format:

```
<|tool_call>call:FUNCTION_NAME{key:<|"|>VALUE<|"|>,num:42}<tool_call|>
```

This is the format `processor.apply_chat_template(..., tools=[...], add_generation_prompt=True)` primes the model to emit.

**[VERIFIED: vLLM GitHub issues #39043, #39392, #39468, PR #38847]**
Current open bugs in `gemma4` parser (all unresolved as of April 2026):

| Issue | Severity | Workaround |
|-------|----------|------------|
| **#39392** — pad-token leak under concurrent requests | Medium (hits batch=2+ only) | Global lock / `max_num_seqs=1` — document as experimental knob |
| **#39468** — format-corruption with `<|"` wrapping JSON strings | Low (intermittent; may correlate with chat-template variants) | Rely on Phase 2 reactive-grammar retry |
| **#39043** — tool-call / reasoning-tag leak with Claude Code | High but workflow-specific (Claude Code harness, not ours) | N/A for emmy (we control the harness) |
| ~~#38837~~ | RESOLVED in PR #38847 | Already in vLLM 0.19.1rc1.dev39+ |

**`pythonic` parser:** [CITED: https://docs.vllm.ai/en/v0.10.2/features/tool_calling.html] — designed for models that emit **Python-list literals** as tool calls, NOT Gemma 4's native format. Gemma 4 26B A4B does not natively emit Python literals; forcing `pythonic` means vLLM interprets Gemma 4's `<|tool_call>call:...{}<tool_call|>` output as a raw text string (no tool_calls parsing). Nevertheless, NVIDIA's Gemma-4-Day-1 benchmark on DGX Spark (forum thread 365503) AND the ai-muninn.com NVFP4 benchmark BOTH report using `--tool-call-parser pythonic` successfully — this works only because their benchmarks don't exercise tool calls; they measure raw decode throughput. [CITED: https://ai-muninn.com/en/blog/dgx-spark-gemma4-26b-nvfp4-52-toks] — "Docker command: ... --tool-call-parser pythonic ..." but the benchmark payload is a single prompt, no tools.

**Hermes:** Not applicable. Gemma 4's native format is categorically different from Hermes XML (`<tool_call>{...}</tool_call>`). Using `hermes` produces parse failures on every tool call — we'd be relying on reactive-grammar retry for 100 % of turns.

**Decision:** Use `tool_call_parser: gemma4`. Document the two known bugs in `PROFILE_NOTES.md`. Rely on Phase 2 D-11 reactive-grammar retry (mode=`reactive`, `tool_call.lark` grammar) as the correctness backstop. Re-evaluate parser choice after Phase 5 eval produces parse-rate data on Gemma 4 — if parse rate < 95 %, switch to `pythonic` with a new `tool_schemas/default.json` that teaches Gemma 4 to emit Python literals (different skill from swapping the parser).

**[VERIFIED: vLLM PR #17149 `philipchung: Add gemma3 chat template with pythonic-style function calling`]** — This is the precedent for pythonic as a Gemma-family option; planner may consider this path if `gemma4` bugs block execution. But starting position is native `gemma4`.

### 2.2 Chat template handling

**[CITED: https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4]**
Gemma 4 requires a specialized chat template for function calling — but vLLM 0.19+ ships this template bundled with the model card. No custom `--chat-template` flag is required. The template generates:

```
<|turn>system
You are a helpful assistant.<|tool>declaration:
  { tool decls here }
<|turn>user
...
```

**System message delivery is inline with the tool declaration block.** This is different from Qwen's `<|im_start|>system\n...<|im_end|>` layered delivery. Pitfall #6 (SP_OK silent-delivery failure) applies: we MUST run the SP_OK canary boot-time against the Gemma 4 profile to verify the bundled template actually honors `system` in this layered form. `scripts/smoke_test.py` already does this unconditionally — no smoke test changes needed, just run it against the new profile.

**`chat_template_kwargs` for tool-heavy turns:** Set `enable_thinking=false` in the `before_provider_request` payload mutator (same site as Plan 03-01's Qwen wiring). STACK.md line 146 documents this pattern verbatim for thinking models. For Gemma 4, leaving `enable_thinking=true` means the model may spend 30-60 s in hidden reasoning before emitting content — unacceptable for tool-call turns. Leave it `true` only for plan-role turns (the `critic` or `plan` variants). Variant harness.yaml can declare `chat_template_kwargs: { enable_thinking: true }` for reason-heavy variants and omit it (default false in the payload mutator) for default/edit variants.

### 2.3 Sampling defaults (SC-5 citation discipline)

**[CITED: https://ai.google.dev/gemma/docs/core/model_card_4, https://huggingface.co/google/gemma-4-26B-A4B-it]**
Google-team-recommended defaults for Gemma 4 26B A4B:

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `temperature` | 1.0 | Google Gemma 4 model card | 2026-04-23 |
| `top_p` | 0.95 | Google Gemma 4 model card | 2026-04-23 |
| `top_k` | 64 | Google Gemma 4 model card | 2026-04-23 |
| `repetition_penalty` | (not specified; default 1.0) | — | — |
| `max_tokens` | 8192 | Symmetric with Qwen profile; no Gemma-specific guidance | — |

**[CITED: https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/discussions/21]**
Community coding-workload experiment: users report **temperature=1.5** works BETTER than 1.0 for code — "each step down [from 1.5 to 0.8/0.6/0.3] made it worse" per the Unsloth discussion. This contradicts the usual "lower temperature for code" heuristic. **Profile ships temperature=1.0** as the Google-team default (SC-5: cite your sources; the community experiment is a Phase-5 eval candidate). A `gemma-4-26b-a4b-it/v1.1-hot` variant with `temperature=1.5` can land later if Phase 5 data supports it.

Sampler-order advice: "temperature;top_p;top_k" — vLLM applies in this order by default (no config needed).

### 2.4 FP8 footprint + KV seed

See §1 bullet 4.

### 2.5 Air-gap posture

See §1 bullet 10. **Identical to Qwen.** No additional validator work; no `ci_verify_*` changes.

## 3. vLLM Swap Primitive (§§ Docker atomicity, probe timing, rollback)

### 3.1 docker stop atomicity

**[VERIFIED: vLLM GitHub #7581, Docker docs]**
`docker stop CONTAINER` issues SIGTERM to PID 1 in the container, waits `--time` seconds (default 10), then SIGKILL. vLLM's entry point installs Python signal handlers that call `engine.shutdown()` → releases KV cache + CUDA graphs + NCCL handles cleanly. After container exit + `docker rm`, the CUDA context is torn down and `nvidia-smi` reports 0 MiB resident within 1-2 s (measured empirically in comparable single-GPU single-container deployments; specific Spark number to be verified by the Task 1 boot-time smoke test).

**Case that DOES leave GPU memory blocked:** SIGKILLing the Python process INSIDE a running container without stopping the container itself — the container keeps the CUDA context reserved. Not applicable here; `docker stop` triggers clean shutdown.

**Recommendation:** Use `docker stop --time 15 emmy-serve` (15 s grace, slightly over default 10, to let large-model shutdown drain) then `docker rm emmy-serve`. Mirror `start_emmy.sh` lines 90-92 pattern.

### 3.2 Boot probe pipeline extension

**Existing primitives we reuse verbatim:**

| File | Function | What it does |
|------|----------|--------------|
| `emmy_serve/boot/runner.py` | `render_image_ref` | Reads `serving.yaml.engine.container_image_digest`, returns `<repo>@<digest>` or bare sha256 |
| `emmy_serve/boot/runner.py` | `render_docker_args` | Full argv for `docker run` (flags + image + vllm CLI) |
| `emmy_serve/boot/probe.py` | `wait_for_vllm(base_url, timeout_s=300)` | Polls `/v1/models` every 500 ms until 200 OK or timeout |
| `scripts/smoke_test.py` | `main()` | SP_OK canary + tool-call canary + 100-tok gen + D-06 failure bundle |

**New primitive we add:** `emmy_serve/swap/orchestrator.py` with `swap_profile(old_profile_dir, new_profile_dir, run_dir, port, progress_sink)` exposing subcommand `uv run emmy-serve swap-profile --from PATH --to PATH --port 8002`. Pipeline:

```
1. Pre-flight (nothing stopped yet):
   a. emmy profile validate <new>   → exit 2 if fail
   b. emmy profile hash <new>       → assert stored hash matches recompute (exit 3 if not)
   c. docker inspect <image-ref>    → exit 3 if image missing
   d. Path exists on model dir      → exit 4 if missing
   e. render_docker_args success    → exit 4 on render failure
   f. (optional) dry-run smoke against a cheap mock   (SKIP for v1 — costs no runtime signal)

2. Stop (tearing down old):
   progress_sink("stopping vLLM")
   docker stop --time 15 emmy-serve
   docker rm emmy-serve
   sleep 1 (defensive — let CUDA context drain)

3. Start (boot new):
   progress_sink("loading weights 0%")
   eval docker run --name emmy-serve --detach <new docker args>
   # poll docker logs emmy-serve for progress
   while not /v1/models 200:
     tail docker logs, look for "model loaded" or percentage signals
     progress_sink("loading weights N%") (best-effort from log pattern)
   
4. Warmup:
   progress_sink("warmup")
   wait_for_vllm(base_url, 300)

5. Smoke:
   progress_sink("ready")   # emitted BEFORE smoke so user sees green
   run scripts/smoke_test.py
   if smoke fails: rollback (see §3.3)

6. Exit 0 on success.
```

**Exit codes (match start_emmy.sh scheme + new swap codes):**
- 0 — swap complete, new profile serving, smoke ok
- 1 — boot rejected (D-06 bundle in `runs/boot-failures/`)
- 2 — new profile schema invalid
- 3 — new profile digest / hash / image issue
- 4 — prereq missing (weights, mounts)
- **5 — NEW: swap pre-flight failed, PRIOR engine still running** (validate-first-then-stop: D-04 contract)
- **6 — NEW: swap stopped old engine but new engine failed to boot; ROLLBACK initiated** (envelope reports rollback status)

### 3.3 Rollback semantics

**[Source: Phase 1 D-06 "fail loud + roll back" pattern applied to swap]**
On smoke failure or boot failure POST-STOP:

```
log D-06 bundle for the failed forward swap
progress_sink("rollback: stopping failed engine")
docker stop --time 15 emmy-serve
docker rm emmy-serve
progress_sink("rollback: restarting prior profile")
invoke the SAME binary: uv run emmy-serve swap-profile --from <new> --to <OLD> --port 8002 --no-rollback
                                                                                            ^ flag prevents infinite rollback loops
if rollback succeeds: exit 6 with envelope {rolled_back: true, rollback_succeeded: true}
if rollback fails:    exit 6 with envelope {rolled_back: true, rollback_succeeded: false}
                      # at this point the user has no model serving;
                      # they must manually run scripts/start_emmy.sh
```

**Caller (`/profile` handler in TS):** receives exit code + envelope JSON from stdout. Maps to user-visible error message and updates the footer badge.

### 3.4 Expected wall-clock budget

| Step | Time | Notes |
|------|------|-------|
| Pre-flight | 1-3 s | Python-only checks; fastest path |
| docker stop --time 15 | 3-15 s | Drain dependent on model size; Gemma 4 MoE ~5 s |
| docker rm | <1 s | |
| docker run (detach) | <1 s | Returns immediately |
| Weight load + torch.compile | 90-160 s | fastsafetensors ~84 s Gemma 4 26B per ai-muninn.com; +10-30 s compile |
| wait_for_vllm | (overlaps with above) | /v1/models 200 OK |
| Smoke (SP_OK + tool_call + gen) | 5-8 s | |
| **TOTAL (happy path)** | **~100-180 s** | |
| Rollback (failure path) | +~120 s | Same sequence, reversed |

Progress UX budget: 200 s + buffer. Footer poller (1 Hz) ticks 200 times — plenty for visible progress.

### 3.5 In-flight-turn guard (D-06)

At handler entry, check `ctx.isIdle()` — if false, `ctx.ui.notify("swap deferred — request in flight, finish or Ctrl+C first", "warning")` and return. `ctx.isIdle()` is already on `ExtensionCommandContext` (types.d.ts:211).

## 4. routes.yaml + Variant Schema

### 4.1 File layout

```yaml
# profiles/routes.yaml  (top-level, NOT per-profile)

default: qwen3.6-35b-a3b@v3.1-default

roles:
  plan:    qwen3.6-35b-a3b@v3.1-reason
  edit:    qwen3.6-35b-a3b@v3.1-precise
  critic:  qwen3.6-35b-a3b@v3.1-default
```

**[CITED: https://docs.litellm.ai/docs/proxy/configs]** — LiteLLM-shaped. Phase 4 ships Qwen variants only (D-08 default); a commented-out Gemma row may sit below for discoverability.

### 4.2 Variant filesystem shape (D-10 default)

```
profiles/qwen3.6-35b-a3b/
├── v1/                    (Phase 1; byte-frozen)
├── v2/                    (Phase 2; byte-frozen)
├── v3/                    (Phase 3; byte-frozen)
├── v3.1/                  (Phase 3.1; baseline; current default)
├── v3.1-default/          (NEW: alias of v3.1 with explicit role marker)
├── v3.1-reason/           (NEW: same serving.yaml; harness temp=0.6, enable_thinking=true)
└── v3.1-precise/          (NEW: same serving.yaml; harness temp=0.0, no-thinking)
```

**Constraints each variant bundle MUST satisfy** (CI-enforced, not schema-enforced — D-10):

1. `serving.yaml.engine.*` **byte-identical** across variants of the same base — engine doesn't restart per turn.
2. Each variant has its own `profile.yaml` with unique `version: v3.1-<name>` and unique content hash.
3. `harness.yaml.sampling_defaults` + `harness.yaml.tools.per_tool_sampling` + `harness.yaml.prompts.*` differ.
4. `PROFILE_NOTES.md` cites the community source for each sampling difference (parity with Phase 2 citation discipline).

**Planner CI test:** `tests/unit/test_variant_engine_byte_identity.py` asserts `diff profiles/qwen3.6-35b-a3b/v3.1-default/serving.yaml profiles/qwen3.6-35b-a3b/v3.1-reason/serving.yaml` is empty (modulo intentional non-engine fields — but engine.* must match byte-exact). This plus the hasher ensures (a) variant choice doesn't trigger restart, (b) variants are content-hash-independent and validate independently.

**Schema does not change.** `ProfileManifest.version` accepts any string. `CompactionConfig`, `ToolsConfig`, `WebFetchConfig`, `WebSearchConfig` already accept variant-specific values. No new schema field needed for Phase 4.

### 4.3 Runtime: harness-side only

**Who reads routes.yaml:** `@emmy/ux`, once per session-start + once per `/profile` swap. Cached in extension-factory closure; accessed from `before_provider_request` hook.

**Turn envelope field: `role: plan | edit | critic | default`.** Set by harness based on:
- Tool about to be invoked: `edit/write` → `edit`; `ls/grep/find/read/web_fetch/web_search/bash` → `default`; ... (full mapping in plan).
- Message-shape heuristic: user prompt starting with "plan:", "think about", "architect", etc. → `plan`.
- Fallback: `default`.

**Variant snapshot:** On `before_provider_request`, read `turn.role` → `routes.yaml.roles[role]` → resolve to variant path (`profiles/qwen3.6-35b-a3b/v3.1-reason`) → load variant harness.yaml → apply its `sampling_defaults` + `per_tool_sampling` + `prompts.*` to the outgoing payload. Variant's `profile.yaml.hash` + `version` get stamped on the OTel span (next section).

### 4.4 OTel stamping extension (D-12)

`EmmyProfileStampProcessor.onStart(span)` currently stamps `emmy.profile.{id, version, hash}`. Extend it so it reads a **per-turn variant snapshot** set by `before_provider_request`:

```typescript
// Extension — live in @emmy/telemetry/src/profile-stamp-processor.ts
interface ProfileStampAttrs {
  id: string;
  version: string;        // base version, e.g. "v3.1"
  hash: string;           // base hash
  variant?: string;       // "v3.1-reason" | "v3.1-precise" | "v3.1-default"
  variantHash?: string;   // content hash of the variant bundle
  role?: string;          // "plan" | "edit" | "critic" | "default"
}
```

Attributes written:
- `emmy.profile.id` (unchanged)
- `emmy.profile.version` (unchanged)
- `emmy.profile.hash` (unchanged)
- `emmy.profile.variant` — NEW; absent on spans where no variant is active (backwards-compat)
- `emmy.profile.variant_hash` — NEW
- `emmy.role` — NEW; absent on non-chat-request spans

**The snapshot is populated by the before-request hook writing to a module-level `currentTurn: { variant, role } | undefined` that the processor reads in `onStart`.** This is the same technique Plan 03-05's TurnTracker uses. No OTel SDK API changes required; we're using the existing `setAttributes` on Span.

## 5. pi-mono 0.68 Slash Command + Session Continuity

### 5.1 `/profile` registration

**[VERIFIED: `node_modules/.bun/@mariozechner+pi-coding-agent@0.68.0/.../dist/core/extensions/types.d.ts:777-778, 731-737`]**

```typescript
// packages/emmy-ux/src/slash-commands.ts — NEW registerProfileCommand alongside registerClearCommand

export function registerProfileCommand(
  pi: ExtensionAPI,
  opts: { profileDir: string; port: number; profileIndex: ProfileIndex },
): void {
  pi.registerCommand("profile", {
    description: "Swap to a different profile. /profile <name>[@<variant>]",
    // getArgumentCompletions returns variants discovered from profileIndex
    getArgumentCompletions: (prefix) => opts.profileIndex.complete(prefix),
    handler: async (args: string, ctx) => {
      // 1. In-flight guard (D-06)
      if (!ctx.isIdle()) {
        ctx.ui.notify("swap deferred — request in flight, finish or Ctrl+C first", "warning");
        return;
      }
      // 2. Parse args
      const [name, variant] = args.trim().split("@");
      const targetDir = opts.profileIndex.resolve(name, variant);
      if (!targetDir) { ctx.ui.notify(`unknown profile: ${args}`, "error"); return; }
      // 3. Confirm destructive action
      const ok = await ctx.ui.confirm("Swap profile", `Stop ${currentProfile.id}@${currentProfile.version} and load ${args}? (~2 min)`);
      if (!ok) return;
      // 4. Shell out to emmy-serve swap-profile, streaming progress
      const exit = await runSwapAndStreamProgress({
        from: opts.profileDir,
        to: targetDir,
        port: opts.port,
        progress: (phase, pct) => ctx.ui.setStatus("emmy.swap", renderProgress(phase, pct)),
      });
      // 5. Handle result envelope
      if (exit === 0) {
        // Hot-swap harness state (profile cache, stamp processor, allowlists)
        await reloadHarnessProfile(targetDir);
        ctx.ui.setStatus("emmy.swap", undefined);  // clear progress row
        ctx.ui.notify(`swapped to ${args}`, "info");
      } else if (exit === 5) {
        ctx.ui.notify(`swap pre-flight failed (prior model still serving)`, "error");
      } else if (exit === 6) {
        // Rollback envelope on stdout; parse + display
        ctx.ui.notify(`swap failed; rollback ${rolledBackOk ? "succeeded" : "FAILED — run start_emmy.sh manually"}`, "error");
      } else {
        ctx.ui.notify(`swap failed (exit ${exit}); see runs/boot-failures/`, "error");
      }
    },
  });
}
```

### 5.2 Progress UX (D-22)

The Python child-process emits one JSON line per phase transition on stdout:

```json
{"ts": "2026-...", "phase": "stopping vLLM"}
{"ts": "2026-...", "phase": "loading weights", "pct": 0}
{"ts": "2026-...", "phase": "loading weights", "pct": 45}
{"ts": "2026-...", "phase": "loading weights", "pct": 92}
{"ts": "2026-...", "phase": "warmup"}
{"ts": "2026-...", "phase": "ready"}
```

TS parses each line and calls `ctx.ui.setStatus("emmy.swap", renderProgress(...))`. The existing footer poller (`packages/emmy-ux/src/metrics-poller.ts`) continues running in parallel — its setStatus key is `"emmy.footer"`, so there's no collision. D-22's spec is footer row SUBSTITUTION during swap — the simplest implementation is "render the swap row FIRST and the footer SECOND" (pi's footer data provider already supports composable status keys per types.d.ts:96-103 setFooter docs).

### 5.3 Session continuity across swap (D-23)

**Does NOT need explicit work (preserved by pi):**
- SessionManager transcript (stays in memory, not touched)
- MCP subprocess registry (MCP servers are attached to the session, not the provider)
- Tools registry (registerTool calls survive provider swap per pi runtime design)

**MUST be explicitly re-initialized:**
- `@emmy/ux/profile-loader.ts` cache — call `loadProfile(newDir)` → new `ProfileSnapshot` → swap into extension-factory closure. Easiest implementation: store `currentProfile` in a module-level `let` inside pi-emmy-extension.ts; swap reassigns + re-emits a sentinel event.
- `EmmyProfileStampProcessor` — construct new one from new profile ref, add to SDK processor chain, remove old one. The SDK API exposed by `@opentelemetry/sdk-trace-node` is `tracerProvider.addSpanProcessor(newProcessor)` + `tracerProvider.removeSpanProcessor(oldProcessor)` (the latter is available in SDK ≥ 2.0, which Plan 03-02 uses per package.json).
- web_fetch allowlist (`packages/emmy-tools/src/web-fetch-allowlist.ts`) — bound at session start via `setInitialAudit(result)` (Plan 03-06 state machine). Re-call `setInitialAudit` with the new profile's result.
- web_search config (`packages/emmy-tools/src/web-search.ts`) — module-level state; provide a `reinit(newConfig)` export.

**MUST be explicitly flushed:**
- Any in-flight OTel span — the `after_provider_response` event (pi types.d.ts:434-439) fires after each chat request; use it to ensure the last span is closed before starting the swap. In practice, the in-flight-turn guard in §5.1 step 1 already prevents this case (guard fails if `!ctx.isIdle()`).

## 6. Validation Architecture (Nyquist test matrix)

> Phase 4 has THREE paired RED/GREEN test dimensions. Each dimension has one success path + at least two failure paths, sampled at per-task commit (Wave granularity). Full matrix fires per `/gsd-verify-work`.

### 6.1 Test Framework

| Property | Value |
|----------|-------|
| Python framework | pytest via `uv run pytest` (Phase 1 baseline; 165 tests green at Phase 3.1 close) |
| TS framework | Bun's built-in test runner `bun test` (459 tests green at Phase 3.1 close) |
| Quick-run command | `uv run pytest tests/unit/ -x` + `bun test --bail` |
| Full-suite command | `uv run pytest && bun test` |
| New config? | NO — existing pytest.ini + bunfig.toml cover new tests |

### 6.2 Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Command | Wave |
|--------|----------|-----------|---------|------|
| SERVE-03 | Gemma 4 profile validates + boot smoke passes | integration (operator-gated on Spark) | `scripts/start_emmy.sh --profile profiles/gemma-4-26b-a4b-it/v1` | Wave 2 |
| SERVE-03 | Gemma 4 schema accepts (tool_call_parser=gemma4) | unit | `uv run pytest tests/unit/test_profile_schema_gemma4.py` | Wave 0 |
| PROFILE-07 | Both profiles exist; both pass `emmy profile validate` | unit | `uv run pytest tests/unit/test_profile_validate_both.py` | Wave 1 |
| PROFILE-08 | `emmy-serve swap-profile` pre-flight fails → prior still running | unit (mock docker) | `uv run pytest tests/unit/test_swap_preflight_fail.py::test_prior_survives` | Wave 1 |
| PROFILE-08 | `emmy-serve swap-profile` post-stop fail → rollback invoked | unit (mock docker) | `uv run pytest tests/unit/test_swap_rollback.py::test_rollback_fires_on_boot_fail` | Wave 1 |
| PROFILE-08 | `/profile` slash command registered + handler dispatches | integration | `bun test packages/emmy-ux/test/profile-command.integration.test.ts` | Wave 2 |
| PROFILE-08 | `/profile` rejects when ctx.isIdle()=false (in-flight guard) | unit | `bun test packages/emmy-ux/test/profile-command.test.ts::inflight` | Wave 1 |
| HARNESS-08 | routes.yaml resolves role→variant; wrong role → `default` | unit | `bun test packages/emmy-ux/test/routes-resolver.test.ts` | Wave 1 |
| HARNESS-08 | before_provider_request applies variant sampling | unit | `bun test packages/emmy-provider/test/variant-sampling.test.ts` | Wave 1 |
| HARNESS-08 | OTel span carries `emmy.profile.variant` + `emmy.role` | unit | `bun test packages/emmy-telemetry/test/variant-stamp.test.ts` | Wave 1 |
| UX-04 | Progress phases `stopping vLLM`→`loading`→`warmup`→`ready` all emit | integration | `bun test packages/emmy-ux/test/progress-phases.test.ts` | Wave 2 |
| UX-04 | On rollback failure, error envelope surfaced to ctx.ui.notify | integration | `bun test packages/emmy-ux/test/swap-error-ui.test.ts` | Wave 2 |
| D-19 audit | No model-name conditionals in Py src | unit | `uv run pytest tests/unit/test_no_model_conditionals.py` | Wave 0 |
| D-19 audit | No model-name conditionals in TS src | unit | `bun test tests/unit/no-model-conditionals.test.ts` | Wave 0 |
| D-19 audit | Audit catches deliberate-positive fixture (self-test) | unit | `uv run pytest tests/unit/test_no_model_conditionals.py::test_catches_fixture` | Wave 0 |

### 6.3 Three Dimension Test Surfaces (Nyquist-paired)

#### Dimension (a): Swap atomicity

| Scenario | Success Path (GREEN) | Failure Paths (RED) |
|----------|----------------------|----------------------|
| Pre-flight passes, new engine boots, smoke green | new profile serving; exit 0 | schema invalid → exit 2; hash mismatch → exit 2; image missing → exit 3; weights missing → exit 4 |
| Pre-flight fails | **PRIOR engine still running; exit 5** | IF the primitive accidentally stops the old engine before failing pre-flight → test fails (this is the key safety invariant) |
| Pre-flight passes, but new engine fails to boot | rollback invoked; prior re-serving; exit 6 `{rolled_back: true, rollback_succeeded: true}` | rollback itself fails → exit 6 `{rolled_back: true, rollback_succeeded: false}` surfaces to user |
| In-flight turn guard | `/profile` during streaming → rejected with notify | IF guard missing → swap would tear down mid-generation; test asserts guard fires |

**Test harness:** Mock `subprocess.run("docker", ...)` via pytest monkeypatch. Inject each failure at each pipeline stage by the mock's return code / stderr. Assert (a) exit code, (b) docker commands actually invoked, (c) stdout envelope JSON shape.

#### Dimension (b): No-model-conditionals audit (D-19)

**[SOURCE: D-19 LOCKED]** Dual-language grep test. Allowlist:

1. Comments (`# ...` in Py, `// ...` in TS) — ignored
2. `PROFILE_NOTES.md` — ignored (it's docs, it NAMES models)
3. YAML content — ignored (it's data)
4. Test files themselves — ignored
5. profile-loader YAML key access (e.g., `harness.tools.format` where `"hermes"` appears as a dict lookup) — ignored when in a non-conditional context

Regex (Python): `(?i)\b(if|elif|else|switch|when|match|case)\b.*\b(qwen|gemma|hermes|llama)\b`
Regex (TS):  `(?i)\b(if|else|switch|case)\b.*\b(qwen|gemma|hermes|llama)\b`

**Self-test gate (CRITICAL):** The test itself must prove it catches violations. Planner seeds a fixture file `tests/fixtures/no_model_conditionals_positive.py` with:

```python
# This file is a deliberate positive for the no-model-conditionals audit.
# It MUST be caught by test_no_model_conditionals.py.
def foo(model: str):
    if "qwen" in model:   # <- should trigger the audit
        return "A"
```

The audit test runs in two modes:
1. **Self-test mode:** target the fixture file → MUST match, test PASSES only when the audit triggers.
2. **Real mode:** target the full source tree with the fixture excluded → MUST NOT match, test PASSES only when audit finds nothing.

Deleting or disabling the fixture as an exemption breaks test 1 — the audit itself is verified.

#### Dimension (c): Role-routing observability

**OTel span assertion helpers from Phase 3 Plan 03-02:**
- `packages/emmy-telemetry/test/profile-stamp-processor.test.ts` — validates the `onStart` attribute setter (Plan 03-02 RED/GREEN pattern).

**New Plan 04 tests:**
- `variant-stamp.test.ts` — injects a mock before-request hook that sets `currentTurn = {variant: "v3.1-reason", role: "plan"}`, creates a span, asserts the ReadableSpan's attributes include both keys with the expected values.
- `variant-stamp-absent.test.ts` — no hook fires → span has only the base `emmy.profile.*` keys; `emmy.profile.variant` is absent. Confirms backwards-compat.
- `route-trace-end-to-end.test.ts` — full flow: routes.yaml with 3 roles + fixture turn envelopes for each role → each turn's span carries the right variant + role.

### 6.4 Wave 0 Gaps (pre-implementation scaffolding)

- [ ] `tests/unit/test_profile_schema_gemma4.py` — pydantic accepts Gemma 4 profile YAML
- [ ] `tests/unit/test_no_model_conditionals.py` — audit + self-test fixture
- [ ] `tests/fixtures/no_model_conditionals_positive.py` — deliberate positive
- [ ] `tests/unit/test_swap_preflight_fail.py` — pre-flight failure modes
- [ ] `tests/unit/test_swap_rollback.py` — rollback triggers
- [ ] `tests/unit/test_variant_engine_byte_identity.py` — sibling serving.yaml.engine byte-equality
- [ ] `packages/emmy-ux/test/profile-command.test.ts` — /profile handler unit tests
- [ ] `packages/emmy-ux/test/profile-command.integration.test.ts` — registerCommand wiring
- [ ] `packages/emmy-ux/test/routes-resolver.test.ts` — routes.yaml resolver
- [ ] `packages/emmy-ux/test/progress-phases.test.ts` — progress stream JSON parsing + setStatus
- [ ] `packages/emmy-provider/test/variant-sampling.test.ts` — per-turn variant payload application
- [ ] `packages/emmy-telemetry/test/variant-stamp.test.ts` — OTel attribute additions
- [ ] `tests/unit/no-model-conditionals.test.ts` — TS counterpart of the Py audit

### 6.5 Sampling Rate

- **Per task commit:** `uv run pytest tests/unit/ -x && bun test --bail` — covers Wave 0 + Wave 1 gaps
- **Per wave merge:** `uv run pytest && bun test` — full suite
- **Phase gate:** Full suite green + operator-gated boot smoke test on Spark + D-19 audit green

## 7. Open Items / Flags Requiring User Input

All D-17 research items are resolved above. Remaining discretionary calls that the planner may need to confirm:

1. **D-05 (swap atomicity strategy):** "validate-first-then-stop" is the locked default; confirmed feasible in §3.
2. **D-07 (orchestrator split):** Python + TS split is the default; confirmed sound (§3, §5).
3. **D-10 (variant filesystem):** Sibling-dir is the default; hasher + schema accept without change (§4.2). Content-hash contract preserved.
4. **D-11 (role selection seam):** Explicit `turn.role` field with harness-side heuristics is the default. Planner to decide exact heuristic mapping (tool→role) — suggested in §4.3 bullet. No new research needed.
5. **Gemma 4 temperature:** Ship 1.0 Google-team default; flag 1.5 as Phase-5 eval candidate in `PROFILE_NOTES.md`. User may override to 1.5 if they want to experiment now.
6. **Gemma 4 tool_call_parser bugs (open):** Concurrency bug #39392 is unfixed; `max_num_seqs=1` defensive setting is an option but reduces throughput. Starting position is `max_num_seqs=4` (NVIDIA forum default) + rely on reactive-grammar retry. User may prefer `max_num_seqs=1` for zero-risk tool calls at a throughput cost. **Flag for user confirmation in discuss-phase or at plan-phase discretion.**

Nothing else is blocking.

## 8. Sources

### Primary (HIGH confidence)

- **vLLM Gemma4 Tool Parser API docs** — https://docs.vllm.ai/en/latest/api/vllm/tool_parsers/gemma4_tool_parser/ (retrieved 2026-04-23) — native parser registration + strategy
- **vLLM Tool Calling (v0.10.2 docs, forward-compat with 0.19)** — https://docs.vllm.ai/en/v0.10.2/features/tool_calling.html (retrieved 2026-04-23) — `pythonic` parser scope
- **vLLM Gemma 4 recipe** — https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html (retrieved 2026-04-23; 403 on direct fetch, cached content in web search) — sanctioned boot flags
- **Google Gemma 4 function calling** — https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 (retrieved 2026-04-23) — native tool-call format + chat-template behavior
- **Google Gemma 4 model card** — https://ai.google.dev/gemma/docs/core + HF card (retrieved 2026-04-23) — sampling defaults (T=1.0, top_p=0.95, top_k=64)
- **vLLM GitHub PR #38826 (introducing `gemma4` parser)** — https://github.com/vllm-project/vllm/pull/38826 — parser implementation
- **vLLM GitHub PR #38847 (fix: tools-arg signature)** — https://github.com/vllm-project/vllm/pull/38847 — recent fix landed
- **pi-coding-agent v0.68.0 shipped `types.d.ts`** — `node_modules/.bun/@mariozechner+pi-coding-agent@0.68.0/.../dist/core/extensions/types.d.ts` (verified in-tree 2026-04-23) — ExtensionAPI surface (lines 746-899); `registerCommand` (777-778); `registerShortcut` (780-783); `BuiltinSlashCommand` list (21 items, `/profile` not reserved)
- **pi-coding-agent v0.68.0 built-in slash commands** — `dist/core/slash-commands.js` in local node_modules — enumerated 21 reserved names
- **Emmy Phase 1 code** — `emmy_serve/boot/runner.py`, `emmy_serve/boot/probe.py`, `scripts/start_emmy.sh`, `scripts/smoke_test.py`, `scripts/find_kv_budget.py`, `scripts/thermal_replay.py` — all swap primitives reused verbatim
- **Emmy Phase 1 schema** — `emmy_serve/profile/schema.py` — confirmed NO extension needed for variants
- **Emmy Phase 1 hasher** — `emmy_serve/profile/hasher.py` — confirmed sibling-dir variants hash independently
- **Emmy Phase 3 telemetry** — `packages/emmy-telemetry/src/profile-stamp-processor.ts` — extension point for variant + role attrs
- **Emmy Phase 3 profile loader** — `packages/emmy-ux/src/profile-loader.ts` — TS profile reader (variant-aware invalidation entry point)
- **Emmy Phase 3.1 slash-command precedent** — `packages/emmy-ux/src/slash-commands.ts` — `registerCompactCommand` / `registerClearCommand` patterns

### Secondary (MEDIUM confidence — verified with at least one source above)

- **NVIDIA Developer Forum: Gemma 4 Day-1 DGX Spark benchmarks** — https://forums.developer.nvidia.com/t/gemma-4-day-1-inference-on-nvidia-dgx-spark-preliminary-benchmarks/365503 (retrieved 2026-04-23) — flags used in practice by community (uses `pythonic` parser in benchmarks that DON'T exercise tool calls; so not a tool-call endorsement)
- **ai-muninn.com Gemma 4 26B NVFP4 DGX Spark benchmark** — https://ai-muninn.com/en/blog/dgx-spark-gemma4-26b-nvfp4-52-toks (retrieved 2026-04-23) — cold-boot time ~84 s weight load + ~10-30 s compile; 15.7 GiB model footprint
- **Unsloth HF discussion #21** — https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/discussions/21 (retrieved 2026-04-23) — community coding-workload experiment: T=1.5 > T=1.0 for code
- **vLLM GitHub Issue #39392 (Gemma4 pad-token concurrency bug)** — https://github.com/vllm-project/vllm/issues/39392 (open; retrieved 2026-04-23) — workaround: global lock / max_num_seqs=1
- **vLLM GitHub Issue #39468 (Gemma4 format-corruption bug)** — https://github.com/vllm-project/vllm/issues/39468 (open; retrieved 2026-04-23)
- **vLLM GitHub Issue #39043 (Gemma 4 + Claude Code tool calling)** — https://github.com/vllm-project/vllm/issues/39043 (open; retrieved 2026-04-23) — specific to Claude Code harness, not emmy
- **vLLM GitHub PR #17149 (Gemma3 chat template with pythonic-style)** — https://github.com/vllm-project/vllm/pull/17149 (retrieved 2026-04-23) — precedent for using `pythonic` as a Gemma-family fallback
- **LiteLLM Proxy configs** — https://docs.litellm.ai/docs/proxy/configs (retrieved 2026-04-23) — routes.yaml shape precedent (ARCHITECTURE.md §2 already cites)
- **vLLM GitHub issue #7581 (Docker GPU memory release)** — https://github.com/vllm-project/vllm/issues/7581 (retrieved 2026-04-23) — confirms `docker stop` drains CUDA context cleanly

### Tertiary (LOW confidence — single source, flagged for validation)

- Phase 4 swap wall-clock numbers (§3.4) — extrapolated from ai-muninn.com cold-boot + Phase 1 `start_emmy.sh` observed cold-start. Validate with Task 1 operator-gated boot-smoke run on Spark.

## 9. Project Constraints (from CLAUDE.md)

These directives carry the same authority as locked CONTEXT.md decisions. The planner MUST verify Phase 4 plans comply:

- **No cloud INFERENCE in the loop.** Gemma 4 boots 100 % local. Air-gap CI (`ci_verify_phase3` STRICT) passes with zero outbound connections. SearxNG (local) remains the only authorized loopback egress for web_search (Phase 3.1 locked).
- **Pin container digest.** `emmy-serve/vllm:26.03.post1-fst` digest used for Qwen profile is the SAME image Gemma 4 uses (D-14). Digest not upgraded in Phase 4.
- **FP8 only.** NVFP4 disqualified by Pitfall trilogy (ModelOpt NaN bug + GB10 dequant overhead + already locked by D-13).
- **KV budget measured, not theoretical.** `find_kv_budget.py` bisection required (D-15); no magic-number `gpu_memory_utilization`.
- **SP_OK canary gates every boot.** `scripts/smoke_test.py` unchanged — verifies system-prompt delivery for Gemma 4's chat template (Pitfall #6).
- **Grammar is a correctness backstop, not a quality lever.** Gemma 4 profile inherits Phase 2 D-11 reactive-grammar posture (mode=`reactive`). No grammar-always mode for this profile.
- **Profiles are immutable.** Variant dirs are bundles with their own hash; edits → new version.
- **Hash-anchored edits stay default** (TOOLS-03 locked Phase 2). Gemma 4's per-tool-sampling inherits `edit: {temperature: 0.0}`.
- **Profile version field change = new profile version dir.** Variant adds = new sibling dirs (v3.1-reason/, etc.). Existing v1/v2/v3/v3.1 stay byte-frozen.
- **Stand on shoulders.** Every non-default sampling knob in Gemma 4 profile cited with community source in `PROFILE_NOTES.md` — SC-5 literal.
- **No model-name conditionals.** D-19 audit enforces in Py + TS.
- **TUI-first, no IDE plugin, no web UI in Phase 4.** D-20 locks this; `ui_phase` skipped.

## 10. Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `docker stop --time 15` is sufficient to drain vLLM KV + CUDA context on Spark; `nvidia-smi` reports 0 MiB within 1-2 s | §3.1, §3.4 | If Spark's GB10 driver is slower, swap wall-clock grows by up to 30 s. Validate with Task 1 operator boot smoke. |
| A2 | Gemma 4 cold-boot on Spark is 90-160 s (based on ai-muninn.com's 84 s weight load + compile time) | §3.4 | If slower (e.g. different torch.compile behavior on FP8 weights vs NVFP4), progress UX budget needs 300 s worst-case. Operator Task 1 resolves. |
| A3 | `pi.registerProvider` is hot-callable mid-session post-bindCore (types.d.ts doc-comment line 838) | §5.3 | If pi 0.68 regresses this, harness must re-initialize the whole AgentSession — larger planner scope. Low risk (types.d.ts:833-841 is authoritative). |
| A4 | `tracerProvider.removeSpanProcessor` is available in the OpenTelemetry SDK version Phase 3 uses | §5.3 | If SDK doesn't expose remove, we must replace the whole tracer provider on swap — bigger surface. Planner validates SDK version at plan time. |
| A5 | Gemma 4's `max_num_seqs=4` default doesn't trip the pad-token concurrency bug #39392 often enough to be unusable | §2.1 | If bug fires on ≥50 % of batched turns, recommend `max_num_seqs=1` up front. Operator Task 1 measures. |
| A6 | `gemma4` tool_call_parser stabilizes post-#38847 enough to be our primary choice (vs `pythonic` defensive) | §2.1 | If Phase 5 eval shows < 90 % parse rate, swap to `pythonic` with custom `tool_schemas/default.json`. Not a Phase 4 blocker. |

---

*Phase 4 research complete 2026-04-23. Valid until 2026-05-23 (fast-moving domain: vLLM ships biweekly, Gemma 4 bug fixes landing). All D-17 research flags resolved; six assumptions flagged for operator validation or Phase 5 empirical data. Planner: proceed.*
