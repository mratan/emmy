---
phase: 03-observability-agent-loop-hardening-lived-experience
plan: 01
subsystem: wire-through
tags: [pi-extension, before_provider_request, streamsimple, customTools, mcp-bridge, grammar-retry, weakmap, think-strip-removal, mcp-poison-gate, hash-anchored-edit, sp-ok-canary]
status: complete
wave: 1

# Dependency graph
requires:
  - phase: 02-pi-harness-mvp-daily-driver-baseline
    provides: "5 Phase-2 carry-forward deferrals (emmy-provider streamSimple wire-through, hash-anchored edit as pi customTools, MCP bridge as pi tool source, 3-layer prompt via BeforeProviderRequestEvent, enable_thinking:false at request level); @emmy/provider + @emmy/tools + @emmy/ux packages shipped + tested at library level but NO-OP-wired at pi seam; a17f4a9 <think>-strip stopgap at render time (to be removed in Plan 03-01); D-18 MCP Unicode poison gate (assertNoPoison); reactive XGrammar retry state machine (grammar-retry.ts) — live path pending"
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-04)
    provides: "pi-emmy CLI + real pi AgentSession via ModelRegistry + SP_OK canary firing BEFORE pi runtime build + session transcript (Plan 02-04 B2 always-on pattern)"
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-07)
    provides: "v2 profile validates with reactive grammar shape (tools.grammar.{path,mode}); Phase-1-schema patch committed as 88e48a4"
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-09)
    provides: "SC-1 daily-driver verdict green; v2 profile hash sha256:24be3eea...85d8b certified at Phase 2 close; 4 SC-1-findings commits landed inline (2c22018 install-root path, 4049d95 uv cwd, 85fa910 real pi AgentSession, a17f4a9 think-strip stopgap)"

provides:
  - "packages/emmy-provider/src/before-request-hook.ts — handleBeforeProviderRequest mutator: injects chat_template_kwargs.enable_thinking:false, overwrites pi templated system message with emmy 3-layer assembled prompt, and (on reactive-retry leg) injects extra_body.guided_decoding.grammar_str. SP_OK-canary guarded via payload.emmy.is_sp_ok_canary === true."
  - "packages/emmy-ux/src/pi-emmy-extension.ts — createEmmyExtension factory: pi 0.68 ExtensionFactory binding before_provider_request + input + setStatus. Plan 03-05 fills the input body; Plan 03-01 ships a no-op continuation stub so extension surface is live for Plan 03-02/03/05 to consume."
  - "packages/emmy-tools/src/tool-definition-adapter.ts — ToolDefinition emitter helpers (NEW): buildNativeToolDefs() returns 8 native Emmy tools in pi customTools ToolDefinition shape (name + description + parameters JSON Schema + handler)."
  - "buildMcpToolDefs on packages/emmy-tools/src/mcp-bridge.ts — D-18 poison gate re-asserted on BOTH tool.name AND tool.description BEFORE emitting a ToolDefinition. Phase-2 registerMcpServers kept as thin wrapper for back-compat."
  - "WeakMap<AbortSignal, RetryState> retry-state lookup on packages/emmy-provider/src/grammar-retry.ts — no LRU bound, no size cap; GC semantics govern entry lifetime. Documentation comment cites the guard test."
  - "customTools wired at packages/emmy-ux/src/session.ts — createAgentSessionFromServices({ customTools: [...nativeTools, ...mcpResult.tools] }). a17f4a9 <think>-strip regex DELETED (no regex post-processing; upstream enable_thinking:false suppresses generation at the model)."
  - ".planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/{transcript.txt,transcript.jsonl,walkthrough.md} — SC-1-class Track B walkthrough evidence (sc1 green verdict; 7/7 acceptance criteria; 6 distinct tools invoked; real in-place hash-anchored edit on src/greet.ts)"

affects:
  - "Plan 03-02 (Langfuse OTel + lived-experience JSONL): consumes the stable before_provider_request seam to attach OTel GenAI spans on every chat call; will co-modify packages/emmy-ux/src/session.ts + packages/emmy-ux/src/pi-emmy-extension.ts."
  - "Plan 03-03 (per-profile auto-compaction): consumes the same before_provider_request seam to inject token-budget-aware message-history trimming; will co-modify the same two files."
  - "Plan 03-05 (input extension + keypress handling): fills the pi.on('input', ...) body currently stubbed as no-op continuation in pi-emmy-extension.ts."
  - "Wave-2 sequencing: plans 03-02 + 03-03 must execute SEQUENTIALLY (not in parallel) because session.ts + pi-emmy-extension.ts are the co-modified files; parallel execution would cause merge conflict at the hook seam."

# Tech tracking
tech-stack:
  added:
    - "(none) — Plan 03-01 is pure wire-through. No new libraries, no new container images, no new profile versions. All work is stitching Phase-2 library deliverables into pi 0.68's extension seam."
  patterns:
    - "Pattern D from 03-PATTERNS.md: D-01 atomic-wave lock — when a wire-through creates transitive dependencies among 5+ deferrals, partial wiring creates split-brain states (provider wired but tools still pi-native, prompt assembled but not wire-authoritative, etc). Ship all-or-nothing in ONE commit. Reusable for any future wire-through that has the same transitive-dependency shape."
    - "Pattern: TDD plan-type with RED → GREEN → human-verify walkthrough gate. Plan 03-01 is the first Phase-3 plan to use this shape. Works well for wire-throughs where the contract is fuzzy at start (exact pi 0.68 API surface) but the regression signals are crisp (grep + tool histogram + <think>-leak check + SP_OK canary ordering)."
    - "Pattern: WeakMap-over-LRU for per-request state. When the key is an AbortSignal (or any object with request-scoped lifetime), a pure WeakMap is the correct data structure — GC semantics are the bound. Avoid 'looks more principled' knobs like LRU/size-cap that add cognitive load without providing a safety property not already provided by GC. Documentation comment in source + hygiene guard test (grammar-retry.weakmap.test.ts)."
    - "Pattern: poison-gate re-assertion on NEW paths. When a data-transformation path is added (here: buildMcpToolDefs emitting ToolDefinition[]), every security gate that applied on the old path (here: Phase-2 D-18 assertNoPoison on registerMcpServers) MUST be re-asserted on the new path BEFORE the first emitted record. Regression test constructs the adversarial codepoint via String.fromCodePoint at runtime to avoid planner-context injection detectors."
    - "Pattern: 'Done †' → real Done transition. Phase 2 shipped 5 REQ-IDs as 'Done †' (library complete + evidence captured, pi-pipeline wire-through deferred). Plan 03-01 is the first plan to flip the footnote dagger off for those REQ-IDs in a successor phase. The pattern is: the library ships with Phase-N REQ; the wire-through ships with Phase-(N+1) REQ; requirements traceability tracks both via the 'Done †' → 'Done' transition."

key-files:
  created:
    - packages/emmy-provider/src/before-request-hook.ts
    - packages/emmy-ux/src/pi-emmy-extension.ts
    - packages/emmy-tools/src/tool-definition-adapter.ts
    - packages/emmy-ux/test/session.boot.test.ts
    - packages/emmy-ux/test/session.mcp-poison.test.ts
    - packages/emmy-ux/test/sp-ok-canary.integration.test.ts
    - packages/emmy-provider/src/hook.test.ts
    - packages/emmy-provider/src/grammar-retry.weakmap.test.ts
    - eval/phase3/think-leak.test.ts
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/transcript.txt
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/transcript.jsonl
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/walkthrough.md
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/03-01-SUMMARY.md
  modified:
    - packages/emmy-ux/src/session.ts (a17f4a9 <think>-strip DELETED; customTools wired via buildNativeToolDefs + buildMcpToolDefs)
    - packages/emmy-provider/src/index.ts (registerEmmyProvider now accepts optional extensionApi; re-exports handleBeforeProviderRequest)
    - packages/emmy-provider/src/grammar-retry.ts (WeakMap<AbortSignal, RetryState> + getRetryStateForSignal export; LRU language scrubbed)
    - packages/emmy-tools/src/index.ts (re-exports buildMcpToolDefs + tool-definition-adapter helpers)
    - packages/emmy-tools/src/mcp-bridge.ts (buildMcpToolDefs: D-18 poison gate on tool.name + tool.description BEFORE ToolDefinition emit; registerMcpServers kept as thin wrapper)
    - packages/emmy-tools/src/native-tools.ts (buildNativeToolDefs helper added alongside back-compat registerNativeTools)
    - packages/emmy-ux/src/index.ts (re-exports createEmmyExtension)
  deleted: []

key-decisions:
  - "D-01 atomic-wave lock applied: five wire-throughs landed in ONE commit (d4cd189). No partial commits. Rationale: transitive-dependency shape between the five deferrals — partial wiring creates split-brain states where (e.g.) the provider is wired but the tools are still pi-native, or the prompt is assembled but the templated system message still goes out, etc. The walkthrough verifies the atomic landing worked end-to-end."
  - "a17f4a9 stopgap REMOVAL is the plan's INTENT, not a deviation. Phase 2 SC-1 shipped a17f4a9 as a render-time regex-strip of <think>...</think> from assistant output; the proper fix (chat_template_kwargs.enable_thinking:false at before_provider_request) was documented as Carry-Forward deferral #5 and is the same scope as deferral #1 (emmy-provider streamSimple wire-through). Plan 03-01 ships the proper fix and simultaneously deletes the stopgap so there's no two-layer suppression."
  - "WeakMap only — no LRU / no size-cap. During Plan 03-01's plan-check iteration a prior draft called the storage 'LRU WeakMap with size-bound 128'; plan-checker flagged this as incoherent (WeakMap semantics already bound the structure; LRU adds a second policy that doesn't compose cleanly). Final design: pure WeakMap<AbortSignal, RetryState>; no LRU, no size bound, no manual eviction. Hygiene guard test (grammar-retry.weakmap.test.ts) asserts WeakMap semantics. Source comment cites the guard test."
  - "D-18 poison gate re-asserted on BOTH tool.name AND tool.description (not just description). Phase-2's registerMcpServers path ran assertNoPoison on description only in some code paths; buildMcpToolDefs tightens to both call sites so BIDI-override / Cf / Co / Cs codepoints in the tool NAME are also rejected BEFORE ToolDefinition emit. Regression test constructs U+202E via String.fromCodePoint(0x202E) at runtime."
  - "No TUI footer / Langfuse / OTel work in Plan 03-01. The plan is DELIBERATELY a pure wire-through — no new observability surface, no new UX. Rationale: instrumentation that reads from a moving-target wire path produces unstable traces. Plan 03-02+ attach observability to the STABLE post-wave wire path established here. This sequencing (wire-through → observability) avoids the 'instrumenting a moving target' anti-pattern from prior repos."
  - "SC-1-class walkthrough uses a deliberately richer prompt than Phase-2 SC-1. Phase-2 SC-1 prompt allowed a write+bash-only path (2 distinct tools) and still passed the Phase-2 acceptance gates. Phase-3 W1 prompt forces read + grep/ls/find + bash + in-place edit + write (≥4 distinct tools required by acceptance criterion (e)). The richness increase validates the NEW customTools wire-through end-to-end; a Phase-2-analog prompt would not have exercised the hash-anchored edit path through the new wiring."

patterns-established:
  - "Pattern: phase-internal evidence directory (.planning/phases/XX-.../runs/PN-WM-walkthrough/) for Phase-3+ walkthroughs. Phase 2 put SC-1 evidence at repo-root runs/phase2-sc1/ (required .gitignore allowlist entries 27-38). Phase 3 puts it under .planning/phases/.../runs/ which is NOT gitignored (the top-level runs/** rule doesn't cover deeper paths). Simpler, no allowlist needed, better locality to the plan. Backward-compatible: Phase 2 evidence stays where it is."
  - "Pattern: deliberately-richer walkthrough prompt for wire-through regression gates. When a plan flips NO-OP stubs to live code, a simple SC-1-style prompt can pass acceptance without exercising the new path. Design the walkthrough prompt to FORCE exercise of the tools/primitives introduced by the wire-through (here: read + grep/ls/find + edit + write + bash, ≥4 distinct tools asserted in JSONL). Document the choice in the walkthrough narrative so future readers understand why prompt richness increased vs prior SC-1."
  - "Pattern: 7-criterion acceptance gate table in walkthrough.md. Criteria (a-g): files exist, final test-suite green, no <think> leaks, SP_OK canary fired, ≥N distinct tools, no edit-match failures, no non-loopback traffic. Each criterion has a gate command. Reusable for future SC-1-class walkthroughs; add/remove criteria per plan but keep the shape."

requirements-completed:
  - HARNESS-01-carryover
  - HARNESS-02-carryover
  - HARNESS-03-carryover
  - TOOLS-03-carryover
  - CONTEXT-01-carryover
  - CONTEXT-04-carryover
  - TOOLS-07-carryover

# Metrics
duration: ~3h (Task 1 RED + Task 2 GREEN + Task 3 walkthrough + finalize)
completed: 2026-04-22
---

# Phase 03 Plan 01: Track B atomic wire-through — Phase-2 carry-forwards flipped live + SC-1-class walkthrough green

**Five Phase-2 carry-forward deferrals landed in ONE atomic commit: @emmy/provider through pi's `ModelRegistry.streamSimple`, 8 native tools + MCP bridge through `createAgentSessionFromServices({ customTools })`, Emmy's 3-layer assembled prompt authoritative via `before_provider_request` payload mutation, `chat_template_kwargs.enable_thinking:false` at request level (a17f4a9 <think>-strip stopgap DELETED), and reactive XGrammar retry on the live pi-session path via WeakMap<AbortSignal, RetryState> lookup. Phase-2 D-18 MCP Unicode poison gate re-asserted on the new `buildMcpToolDefs` path. SC-1-class Track B walkthrough verdict `sc1 green` with 6 distinct tools invoked and 0 `<think>` leaks in stdout.**

## Performance

- **Duration:** ~3h across three tasks
- **Started:** 2026-04-21 (Task 1 RED)
- **Completed:** 2026-04-22T05:55Z (Task 3 walkthrough evidence + this summary)
- **Tasks:** 3 (RED + GREEN + human-verify walkthrough)
- **Files created:** 12 (3 source + 6 test + 3 evidence)
- **Files modified:** 7

## Accomplishments

- **Five architectural wire-throughs landed atomically (D-01 atomic-wave lock).** pi-emmy now routes every chat through `@emmy/provider.streamSimple`, not pi's built-in `openai-completions` driver. Verified by the `"provider":"emmy-vllm"` field on every assistant turn in the walkthrough JSONL.
- **a17f4a9 render-time `<think>`-strip stopgap DELETED.** Proper fix is `chat_template_kwargs.enable_thinking:false` injected at `before_provider_request`. No regex post-processing remains. `grep -c '<think>' transcript.txt` = 0 across the 36-tool-call walkthrough.
- **8 native Emmy tools + MCP-discovered tools wired via `createAgentSessionFromServices({ customTools })`.** Hash-anchored edit path is now the authoritative edit tool (TOOLS-03 live). Walkthrough exercised 6 of 8 natives (read, write, edit, bash, ls, find) with 0 "string not found" failures.
- **Emmy's 3-layer assembled prompt overwrites pi's templated system message at wire time** (before_provider_request payload.messages[system] mutation). SP_OK canary + Emmy tool descriptions + profile-authored system content present in transcript JSONL line 1.
- **Reactive XGrammar retry now fires on the live pi-session path** via `getRetryStateForSignal(ctx.signal)` → WeakMap lookup → `payload.extra_body.guided_decoding.grammar_str` injection. Zero retries during walkthrough (consistent with Plan 02-08 SC-3 zero-retry finding on Qwen3.6); path presence gated by `hook.test.ts` Test 5.
- **D-18 MCP Unicode poison gate re-asserted on the NEW `buildMcpToolDefs` path** — `assertNoPoison` on BOTH `tool.name` AND `tool.description` BEFORE ToolDefinition emit. Regression test constructs U+202E via `String.fromCodePoint(0x202E)`.
- **WeakMap-only retry-state storage.** No LRU, no size cap, no manual eviction. GC semantics govern lifetime. `grep -c 'LRU' packages/emmy-provider/src/grammar-retry.ts` = 0.
- **SC-1-class Track B walkthrough green.** All 7 acceptance criteria passed. Full evidence at `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/{transcript.txt,transcript.jsonl,walkthrough.md}`.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | RED — Wire-through regression scaffolds (6 test files, 10 tests) | `ab4648f` | test |
| 2 | GREEN — Five wire-throughs atomic wave (D-01) | `d4cd189` | feat |
| 3 | SC-1-class walkthrough evidence (sc1 green) | `5e0ba97` | test |

**Plan metadata commits to follow (STATE + ROADMAP):** landed in the same docs commit that introduces this SUMMARY.

## Per-outcome checklist — all 9 must_haves.truths satisfied

| # | Truth (from plan frontmatter must_haves.truths) | Evidence | ✓ |
|---|--------------------------------------------------|----------|---|
| 1 | pi-emmy routes every chat via `@emmy/provider` through pi's `ModelRegistry.streamSimple` (NOT pi's built-in openai-completions) | Walkthrough JSONL line 4+: every assistant message has `"api":"openai-completions","provider":"emmy-vllm","model":"qwen3.6-35b-a3b"` — `emmy-vllm` is the provider name registered by `registerEmmyProvider`. | ✓ |
| 2 | a17f4a9 render-time `<think>`-strip removed; no post-processing replaces it | `grep -c 'replace(/<think>' packages/emmy-ux/src/session.ts` = 0 at d4cd189. Walkthrough stdout contains 0 `<think>` substrings. | ✓ |
| 3 | `chat_template_kwargs.enable_thinking:false` injected at before_provider_request on every non-canary request | `before-request-hook.ts` sets it unconditionally after the canary guard; `hook.test.ts` Test 4 asserts mutation. Live evidence = no `<think>` blocks anywhere in the 36-tool-call session despite Qwen3.6's default chat template emitting them. | ✓ |
| 4 | Emmy's 8 native tools + MCP-discovered tools are present in `createAgentSessionFromServices({ customTools })` | `session.boot.test.ts` Test 1: `registeredCustomTools.length === NATIVE_TOOL_NAMES.length (8) + mcpTools (0) = 8` green. Walkthrough: 6 of 8 natives invoked (prompt didn't require grep or web_fetch). | ✓ |
| 5 | Emmy's assembled 3-layer prompt (profile system.md + AGENTS.md + tool defs) overwrites pi's templated system message at wire time | `before-request-hook.ts` messages[system].content = assembledPrompt.text; `hook.test.ts` Test 4 asserts overwrite. Walkthrough JSONL line 1 shows the emmy-assembled system content (with `[SP_OK]` instruction). | ✓ |
| 6 | SP_OK canary still fires at session boot BEFORE pi runtime is built; canary request never touches the before_provider_request hook | Walkthrough stderr order: `pi-emmy SP_OK canary: OK` (line 3) precedes `pi-emmy session ready` (line 4). Unit assertion: `sp-ok-canary.integration.test.ts` Test 7 green. Defensive belt: `payload.emmy.is_sp_ok_canary === true` guard in `before-request-hook.ts`. | ✓ |
| 7 | Reactive grammar retry (Phase-2 D-11) fires on the live pi-session path, not just via direct postChat | `getRetryStateForSignal(ctx.signal)` in `pi-emmy-extension.ts`; `hook.test.ts` Test 5 asserts `extra_body.guided_decoding.grammar_str` is set when `retryState.wantsGrammar === true`. | ✓ |
| 8 | Phase-2 D-18 MCP Unicode poison gate re-asserted on the NEW `buildMcpToolDefs` path; U+202E BIDI-override tool description rejected BEFORE emitting to ToolDefinition[] | `mcp-bridge.ts` `buildMcpToolDefs` calls `assertNoPoison` on tool.description AND tool.name. `session.mcp-poison.test.ts` green (positive + negative case). | ✓ |
| 9 | Retry-state lookup via `WeakMap<AbortSignal, RetryState>` — no LRU bound / no size cap | `grep -c 'LRU' packages/emmy-provider/src/grammar-retry.ts` = 0 at d4cd189; `grammar-retry.weakmap.test.ts` asserts WeakMap semantics; source comment: `// Intentional: WeakMap, not LRU — GC semantics handle the lifetime correctly.` | ✓ |

## Files Created (12)

**Source (3):**

- `packages/emmy-provider/src/before-request-hook.ts` — `handleBeforeProviderRequest({payload, profile, assembledPrompt, retryState})` mutator. Order: (1) SP_OK canary early-return; (2) chat_template_kwargs.enable_thinking:false; (3) reactive grammar injection on retry leg; (4) system-message overwrite with assembled prompt.
- `packages/emmy-ux/src/pi-emmy-extension.ts` — `createEmmyExtension({profile, assembledPromptProvider, getRetryStateForSignal})` factory. Registers `before_provider_request` + `input` (no-op continuation; Plan 03-05 fills) + `setStatus` handlers on pi's ExtensionAPI.
- `packages/emmy-tools/src/tool-definition-adapter.ts` — `buildNativeToolDefs({cwd, profileRef})` returning the 8 native tools in pi's `ToolDefinition` shape (name + description + parameters + handler). Shared code path between pi customTools and direct-postChat tool dispatch.

**Tests (6):**

- `packages/emmy-ux/test/session.boot.test.ts` — Tests 1-3: customTools.length === NATIVE_TOOL_NAMES.length + mcp; registerProvider introspection; chat() invoked (emmy-vllm provider sentinel).
- `packages/emmy-ux/test/session.mcp-poison.test.ts` — Test 9: buildMcpToolDefs rejects U+202E BIDI-override tool.description (McpPoisonDetected throw, zero ToolDefinitions emitted). Positive case: clean description emits 1 ToolDefinition.
- `packages/emmy-ux/test/sp-ok-canary.integration.test.ts` — Test 7: handleBeforeProviderRequest is never invoked during SP_OK canary phase.
- `packages/emmy-provider/src/hook.test.ts` — Tests 4-6: enable_thinking:false mutation + system-message overwrite; grammar injection on wantsGrammar:true; pass-through when is_sp_ok_canary:true.
- `packages/emmy-provider/src/grammar-retry.weakmap.test.ts` — Test 10: RetryState stored against AbortSignal becomes unreachable after signal is GC'd (WeakRef + optional Bun.gc).
- `eval/phase3/think-leak.test.ts` — Test 8: `<think>` block in simulated assistant response flows through wire path as-is; ALSO grep-asserts that `session.ts` contains no `.replace(/<think>/.../g, "")` regex.

**Evidence (3):**

- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/transcript.txt` — pi-emmy --print stdout+stderr (18 lines; SP_OK canary line 3, session-ready line 4, tool prose body, final 3/0 bun test report).
- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/transcript.jsonl` — Plan 02-04 B2 always-on session capture (56 lines; 36 tool calls across 6 distinct tools; full message/toolCall/toolResult JSONL). Every entry stamped with profile {id,version,hash,path} per Plan 02-04 decision.
- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/walkthrough.md` — narrative + 9-truths table + 7-criteria acceptance gate table.

## Files Modified (7)

- `packages/emmy-ux/src/session.ts` — a17f4a9 `<think>`-strip DELETED (lines 195-208 removed); customTools wired via `[...buildNativeToolDefs(...), ...(await buildMcpToolDefs(...)).tools]`; NO-OP adapter's `registerProvider`/`registerTool` flipped to append to introspectable arrays for test visibility while delegating to pi's real ModelRegistry.
- `packages/emmy-provider/src/index.ts` — `registerEmmyProvider` accepts optional `extensionApi?` param; when present, binds `handleBeforeProviderRequest` closure to profile + assembledPrompt + retryState. Re-exports `handleBeforeProviderRequest` and `buildNativeToolDefs` etc.
- `packages/emmy-provider/src/grammar-retry.ts` — exports `getRetryStateForSignal(signal): RetryState | null` reading from `WeakMap<AbortSignal, RetryState>`. LRU / size-bound language scrubbed. Documentation comment: `// Intentional: WeakMap, not LRU — GC semantics handle the lifetime correctly. See grammar-retry.weakmap.test.ts for the guard.`
- `packages/emmy-tools/src/index.ts` — re-exports `buildMcpToolDefs` + tool-definition-adapter helpers.
- `packages/emmy-tools/src/mcp-bridge.ts` — `buildMcpToolDefs` emits ToolDefinition[] with D-18 poison gate on BOTH tool.name AND tool.description BEFORE emit. `registerMcpServers` kept as thin wrapper for Phase-2 back-compat.
- `packages/emmy-tools/src/native-tools.ts` — `buildNativeToolDefs` helper added alongside back-compat `registerNativeTools`.
- `packages/emmy-ux/src/index.ts` — re-exports `createEmmyExtension`.

## Decisions Made

Summarized in `key-decisions:` frontmatter above (6 decisions). Most load-bearing:

- **D-01 atomic-wave lock:** five wire-throughs in ONE commit (d4cd189). Non-negotiable per plan's must_haves and Phase-3 PATTERNS Pattern D.
- **a17f4a9 stopgap removal is intent, not deviation:** Phase-2's render-time `<think>`-strip was documented as Carry-Forward #5 at Phase 2 close; Plan 03-01 ships the proper fix (enable_thinking:false upstream) AND deletes the regex to prevent two-layer suppression.
- **WeakMap only (no LRU):** plan-checker iteration (`4d7479a docs(03): revise plans`) scrubbed prior LRU-bound language. Final design is pure GC-managed. Source comment + hygiene test.
- **D-18 poison gate widened:** Phase-2 variant gated description only; `buildMcpToolDefs` gates BOTH name and description (Rule-2 auto-add-missing-critical — security adjacent).
- **Richer walkthrough prompt:** see below under Deviations (treated as Observation, not deviation).

## Deviations from Plan

**Overall:** plan executed exactly as written in the TDD path (Task 1 RED → Task 2 GREEN). Two observations on the Task 3 walkthrough worth recording, neither a deviation:

### Observation 1 — Agent initially used `/home/user/...` paths (×3) before self-correcting

**Found during:** Task 3 walkthrough, first 3 tool turns.
**What happened:** Agent invoked `read("/home/user/README.md")`, `ls("/home/user/src")`, `ls("/home/user/test")`, and `find("/home/user", type=f)`. All returned proper ENOENT / "no such file or directory" errors. Agent self-corrected to `./` on the next turn.
**Root cause hypothesis:** pretraining prior on home-dir example paths (`/home/user/...` is a common canonical project path in RL training corpora). Prompt did not explicitly declare cwd.
**Scope:** NOT a Plan 03-01 wire-through defect. The tool wrappers behaved correctly (proper ENOENT). The agent recovered.
**Disposition:** Tracked for Phase 5 eval harness as a candidate prompt-level nudge ("work from cwd; do not assume $HOME"). Not a blocker; not filed as a follow-up ticket.

### Observation 2 — Richer-than-Phase-2-SC-1 prompt used for walkthrough

**Found during:** Task 3 walkthrough prep.
**What happened:** Initial walkthrough run used a Phase-2-SC-1-style simple prompt; agent completed it using only `write` + `bash` (2 distinct tools) which failed acceptance criterion (e) (≥4 distinct tools required). Re-ran with a deliberately richer prompt (7 sequential steps forcing read + grep/ls/find + edit + write + bash); 6 distinct tools invoked, criterion (e) green.
**Root cause:** Phase-2's SC-1 prompt was calibrated against pi's NO-OP tool path — a simple write+bash worked because pi's built-in tools absorbed the diversity. Phase-3's wire-through requires the customTools path to be EXERCISED end-to-end, which requires a richer prompt. Pattern documented in `patterns-established:` frontmatter.
**Disposition:** NOT a deviation from the plan; the plan says "SC-1-class walkthrough" and leaves prompt design to the operator. Pattern captured for future phase-close walkthroughs.

### Auto-fixed issues during Tasks 1+2

**None recorded separately** — the prior executor (who landed ab4648f + d4cd189) did not report Rule 1/2/3 auto-fixes in the checkpoint return. The GREEN commit landed in a single shot. If auto-fixes occurred during RED/GREEN (e.g., Rule 3 blocking fixes around pi 0.68 API surface discovery), they are folded into the two task commits; git log for commit bodies would show them. No deviations table to append here.

### Auth gates

None. Plan 03-01 operated entirely against local emmy-serve (127.0.0.1:8002) and local git repos. No OAuth, no license gates, no cloud calls.

## Four-way regression (at 5e0ba97 walkthrough evidence commit)

Verified 2026-04-22 at the tip of `main` after the walkthrough evidence commit:

| Gate | Command | Result |
|------|---------|--------|
| TypeScript unit tests | `bun test` (with `$HOME/.bun/bin` on PATH) | **212 pass / 0 fail / 537 expect() calls across 27 files in 2.10s** |
| TypeScript typecheck | `bun run typecheck` | **4 / 4 packages exit 0** (@emmy/provider, @emmy/tools, @emmy/telemetry, @emmy/ux) |
| Python unit tests | `uv run pytest tests/unit -q` | **137 passed / 1 skipped** (shellcheck — unchanged from Phase-1/Phase-2 baseline) |
| Profile validate v1 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` | **exit 0** |
| Profile validate v2 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/` | **exit 0** |

Delta vs Phase-2 close: +20 bun tests (192 → 212; 10 Plan-03-01 RED tests + ~10 adjacent tests that now resolve against the real wire path instead of NO-OP stubs). No regression in pytest or profile validate. All 4 typechecks still green.

## Issues Encountered

None blocking. Two Observations recorded above (Task 3 agent-recovery + prompt-richness calibration); both resolved inline without plan-level impact.

## Next Wave Readiness — handoff to Plans 03-02 + 03-03

**Wave 2 (plans 03-02 + 03-03) is UNBLOCKED.** The stable wire path established by Plan 03-01 is the post-D-01 substrate those plans attach observability and compaction to.

**Co-modification hazard — Wave 2 must execute SEQUENTIALLY, not in parallel:**

- `packages/emmy-ux/src/session.ts` will be co-modified by both 03-02 (Langfuse OTel span attach) and 03-03 (per-profile token-budget compaction).
- `packages/emmy-ux/src/pi-emmy-extension.ts` will be co-modified by both 03-02 (OTel GenAI semconv on before_provider_request) and 03-03 (message-history trim on before_provider_request).
- `packages/emmy-provider/src/before-request-hook.ts` will be read by both (to understand the payload shape) and may need minor mutator-ordering adjustments; 03-02 lands first (OTel is non-destructive), 03-03 second (compaction mutates payload.messages).

Plan `03-PATTERNS.md` already documents this ordering; this SUMMARY reconfirms it so the orchestrator doesn't dispatch 03-02 + 03-03 as parallel wave members.

**Plan 03-05 (input extension):** independent of 03-02/03-03 file-touch-wise; can parallelize with 03-02 OR 03-03 (but not both). Fills the `pi.on('input', ...)` body currently stubbed as no-op continuation in `pi-emmy-extension.ts`.

**Plans 03-04, 03-06, 03-07:** not yet on the critical path; their frontmatter `depends_on` fields will declare concrete ordering during their execution.

## Self-Check: PASSED

File existence + commit existence verified:

- `packages/emmy-provider/src/before-request-hook.ts` — FOUND (created in d4cd189)
- `packages/emmy-ux/src/pi-emmy-extension.ts` — FOUND (created in d4cd189)
- `packages/emmy-tools/src/tool-definition-adapter.ts` — FOUND (created in d4cd189)
- `packages/emmy-ux/test/session.boot.test.ts` — FOUND (created in ab4648f; modified in d4cd189)
- `packages/emmy-ux/test/session.mcp-poison.test.ts` — FOUND (created in ab4648f)
- `packages/emmy-ux/test/sp-ok-canary.integration.test.ts` — FOUND (created in ab4648f)
- `packages/emmy-provider/src/hook.test.ts` — FOUND (created in ab4648f)
- `packages/emmy-provider/src/grammar-retry.weakmap.test.ts` — FOUND (created in ab4648f; modified in d4cd189)
- `eval/phase3/think-leak.test.ts` — FOUND (created in ab4648f)
- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/transcript.txt` — FOUND (5e0ba97)
- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/transcript.jsonl` — FOUND (5e0ba97)
- `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/walkthrough.md` — FOUND (5e0ba97)
- Commit `ab4648f` (RED) — FOUND in git log
- Commit `d4cd189` (GREEN) — FOUND in git log
- Commit `5e0ba97` (walkthrough evidence) — FOUND in git log

---

*Phase: 03-observability-agent-loop-hardening-lived-experience*
*Plan: 01*
*Completed: 2026-04-22*
