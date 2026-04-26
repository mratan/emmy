# SPIKE — Pi-mono internals for observable sub-agent dispatch

**Status:** proposed (pre-phase, not yet committed to roadmap)
**Owner:** TBD
**Time-box:** 1 day (8 working hours, hard cap; if it spills past 1.5 days the answer is "fork pi")
**Phase that depends on this:** 04.5 (sub-agent dispatch v1)
**Decision this spike informs:** integration shape (in-process vs subprocess, services sharing, resource-loader scope, OTel propagation pattern). Output is a 1–2 page integration sketch the eventual `/gsd-plan-phase 4.5` ingests.

---

## 1 — Updated baseline (correcting prior research)

The previous Explore-agent survey claimed pi-mono does not export `AgentSession` and that a sub-agent extension would require a fork. **That is wrong.** Direct read of the installed v0.68.0 surface shows:

- `AgentSession` (class), `AgentSessionConfig`, `PromptOptions`, `SessionStats`, `compact()`, `subscribe()`, `dispose()` — all exported from `pi-coding-agent` `dist/index.d.ts:2` and `dist/core/agent-session.d.ts:147–590`.
- `createAgentSession`, `createAgentSessionFromServices`, `createAgentSessionServices`, `createAgentSessionRuntime`, `AgentSessionRuntime`, `AgentSessionServices` — all exported (`dist/index.d.ts:15`, `dist/core/sdk.d.ts:11–98`).
- Tool factories: `createBashTool`, `createCodingTools`, `createReadOnlyTools`, `createReadTool`, `createEditTool`, `createWriteTool`, `createGrepTool`, `createFindTool`, `createLsTool`, `withFileMutationQueue` (`dist/core/sdk.d.ts:62`).
- `SessionManager` with `.inMemory(cwd)` factory (`dist/index.d.ts:16`; usage example in Emmy at `packages/emmy-ux/src/session.ts:255`).

Emmy already exercises the SDK shape we need (`packages/emmy-ux/src/session.ts:243–264`):
```ts
const services = await createAgentSessionServices({ cwd, authStorage, modelRegistry, resourceLoaderOptions: { extensionFactories: [emmyExtension] } });
const sessionManager = SessionManager.inMemory(cwd);
const { session } = await createAgentSessionFromServices({ services, sessionManager, model: emmyModel, customTools });
session.subscribe(event => { /* dispatch */ });
session.prompt(text);
```

There's already a `runPrint(prompt, {mode})` helper at `session.ts:284–327` that resolves with the last assistant message — effectively a private headless mode hidden inside the adapter. The headless-mode work in the parallel spike is partly "expose this on a CLI flag," not "build from scratch."

**Implication for this spike:** the core question pivots from "is it possible without a fork" (answered: yes) to *"what are the integration details and where do hidden incompatibilities live."*

---

## 2 — Spike scope: 8 hypotheses with pass/fail

Each test runs as a small TypeScript script under `scripts/spikes/04.5-subagents/`. Each gets a strict time-box; if it busts, write down the failure mode and move on — *do not* fix in spike time.

### H1 — Service sharing across two sessions (60 min)
**Question:** Can a parent and child `AgentSession` share one `AgentSessionServices`, or do we need separate services per session?
**Method:** Build two sessions from one `services`, drive `prompt()` on parent, then on child while parent idle, then on both concurrently.
**Pass:** Both sessions produce coherent output; no shared mutable state corruption (extension runner, model registry).
**Fail:** Hangs / extension factory invoked twice incorrectly / shared `_extensionRunnerRef` collision.
**Implication if fail:** Each child needs its own `services` (~50ms extra setup; otherwise mostly fine).

### H2 — Per-session customTools scope (45 min)
**Question:** When child is built with `customTools: [readTool]` (scoped subset), does the child *only* see read, or does it inherit parent's full tool set?
**Method:** Parent session with `customTools: [bashTool, readTool, writeTool]`, child with `customTools: [readTool]`. Probe `child.getActiveToolNames()` and `child.getAllTools()`. Try issuing an `edit` tool call from the child's prompt and confirm it's rejected.
**Pass:** Child sees only `[read]` plus pi's defaults if not suppressed.
**Fail:** Child inherits parent's customTools (would mean a fork or shared-services-with-tool-rewrite is required).
**Implication if fail:** Sub-agent scoping demands separate `services` per child (couples to H1 outcome).

### H3 — Cross-model child via different `model` arg (45 min)
**Question:** `createAgentSessionFromServices({services, model})` — can `model` differ between parent and child built from the same services?
**Method:** Parent on a stub `qwen` model, child on a stub `gemma` model, both pointing at different mock HTTP endpoints. Verify each session POSTs to its own endpoint.
**Pass:** Each session uses its `model.baseUrl` correctly.
**Fail:** Both POST to the parent's endpoint (model selection is sticky inside services, not per-session).
**Implication if fail:** Cross-model sub-agents require separate services per child *and* a model-swap dance — Phase 4.6 gets harder; the sleep-mode spike's findings become load-bearing.

### H4 — Per-session resource loader / system prompt (60 min)
**Question:** Can child have a different system prompt and different sub-agent-specific resources without affecting parent? `resourceLoaderOptions` is wired at *services* creation (`session.ts:247`), not per-session — so this is the structural unknown.
**Method:** Try (a) building per-child services with its own resourceLoader, (b) using the `customTools` route to inject a sub-agent-specific system prompt via tool description prefix. See which produces a clean separation.
**Pass:** Child observably runs with a different system prompt (verify by reading `child.systemPrompt`).
**Fail:** Resource loader is structurally bound to services; per-child system prompts require per-child services (couples to H1 fail).
**Implication if fail:** Per-child services becomes the canonical pattern. Higher per-spawn cost but cleaner isolation.

### H5 — OTel parent-child propagation through `subscribe()` (60 min)
**Question:** When child's vLLM HTTP request fires inside a parent tool handler, does the W3C `traceparent` of the parent's tool span propagate to the child's request, or does pi reset OTel context?
**Method:** Parent fires the candidate `Agent` tool; in tool handler, capture `trace.getActiveSpan()`, call `context.with(parentCtx, () => child.prompt(...))`, instrument the OTel HTTP exporter to capture outbound `traceparent` headers, verify trace_id matches parent's.
**Pass:** Child's outbound request carries parent's trace_id.
**Fail:** trace_id resets at child boundary — we'd need to manually inject `traceparent` via a vLLM-provider hook.
**Implication if fail:** Add explicit trace_id capture+inject in the SubAgentTool handler. ~1 day of incremental work in Phase 4.5; not a blocker.

### H6 — Per-child SessionManager and JSONL location (30 min)
**Question:** Can child write its JSONL to `.pi/sessions/subagent-<parent>-<n>.jsonl` (separate file from parent), or is `SessionManager` cwd-bound and only one file per process?
**Method:** Read `SessionManager` API; try `SessionManager.create(cwd, {sessionDir: alternateDir})` if it exists. If only `.inMemory()` is documented for non-default flows, check JS source.
**Pass:** Per-child file works; parent's file unaffected.
**Fail:** Only one writer per cwd; child must be in-memory or share parent's file.
**Implication if fail:** Child uses `SessionManager.inMemory()`, transcript persistence handled by Emmy telemetry sidecar JSONL keyed by trace_id (acceptable; Emmy's repro story already lives in telemetry, not pi's JSONL).

### H7 — Child compaction independence (45 min)
**Question:** If child fills its own context and auto-compacts, does it touch parent's compaction state? `AgentSession._compactionAbortController` is private (line 161) but per-instance.
**Method:** Trigger child compaction via `child.compact()` while parent is mid-stream. Verify parent's `isStreaming`, `isCompacting` unchanged; confirm parent's session JSONL has no compaction entry.
**Pass:** Total isolation.
**Fail:** Some shared state in services bleeds (extension runner mid-compaction, settingsManager mutation).
**Implication if fail:** Disable auto-compaction on child sessions; parent/dispatcher decides when to compact a child. Easier safety story anyway.

### H8 — `dispose()` lifecycle and resource leakage (30 min)
**Question:** After 50 child spawn+dispose cycles, are sockets/timers/subscribers cleaned up?
**Method:** Loop, snapshot active handle count via Bun's `Bun.gc(true)` + a heap snapshot, or fall back to `process._getActiveHandles?.()` if exposed under Bun's Node compat. Verify no monotonic growth.
**Pass:** Stable handle count.
**Fail:** Leak — file an issue upstream and add a workaround in Emmy's SubAgentTool wrapper (force-close extension runner).
**Implication if fail:** Extra cleanup code in the wrapper. Cosmetic, not blocker.

### H9 — Real-deal E2E with live Qwen 3.6 35B-A3B (60 min, runs last)
**Question:** Does the integration sketch from H1–H8 actually work against a live vLLM serving Qwen 3.6 35B-A3B-FP8 v3.1?
**Method:**
1. Pre-flight: `start_emmy.sh` already up with profile `qwen3.6-35b-a3b@v3.1` (operator brings this up; not part of spike clock — measured separately).
2. Build a minimal `SubAgentTool` (≤80 lines) embodying the H1–H8-recommended pattern.
3. Parent session loaded via Emmy's existing `createAgentSessionFromServices` path (`session.ts:243–264`), with `SubAgentTool` added to `customTools`.
4. Single parent prompt: *"Use the Agent tool to grep this repo for occurrences of `customTools` and summarize what you find."*
5. Verify in order:
   - (a) Parent fires `Agent(...)`, child instantiated, child runs 1–3 turns of grep+read, returns a text summary.
   - (b) Parent ingests the summary as a `tool_result`, completes its own turn coherently.
   - (c) vLLM `/metrics` `vllm:prefix_cache_hits_total` increments between parent's last turn and child's first turn (system prompt overlap → prefix cache hit, the free-money case).
   - (d) OTel trace tree shows `parent_session → Agent_tool_span → child_session_invoke_agent → child_chat_completion`, all under one `trace_id`.
   - (e) `dispose()` called on child after parent completes; no orphaned `.pi/sessions/*.jsonl` for the child (in-memory child) or one explicitly-named child JSONL if H6 passes.
**Pass:** All 5 checks succeed; total wall-clock from parent prompt to parent's final assistant message ≤90s on Qwen 35B-A3B (allows 2–3 child turns at ~48 tok/s solo, ~35 tok/s under one-other-stream concurrency).
**Fail (any check):** Capture the failure in `SPIKE-RESULTS.md` H9 section with reproducible script + observed-vs-expected — this is the most realistic forcing function for design issues that mocks miss.
**Implication if fail:** Phase 4.5 plan opens with whichever issue H9 found, before any other work. H9 is the single most load-bearing data point in this spike.

---

## 3 — Time budget

| Hypothesis | Budget | Cumulative |
| --- | ---: | ---: |
| H1 — Services sharing | 60 min | 1:00 |
| H2 — customTools scope | 45 min | 1:45 |
| H3 — Cross-model | 45 min | 2:30 |
| H4 — Resource loader | 60 min | 3:30 |
| H5 — OTel propagation | 60 min | 4:30 |
| H6 — JSONL location | 30 min | 5:00 |
| H7 — Compaction independence | 45 min | 5:45 |
| H8 — dispose() leakage | 30 min | 6:15 |
| H9 — Real-deal E2E (Qwen 3.6 live) | 60 min | 7:15 |
| **Writing up** SPIKE-RESULTS.md + INTEGRATION-SKETCH.md | 45 min | **8:00** |

H1–H8 use a stub HTTP endpoint for `/v1/chat/completions` (≤30 lines `Bun.serve`). H9 is the only step that runs against the live vLLM container — so failures in H1–H8 stay fast, and H9 is the integrated forcing function. If H1 busts past 90 min → stop and escalate. The "1 day → fork pi" branch is real.

---

## 4 — Deliverables

1. **`scripts/spikes/04.5-subagents/h{1..8}-*.ts`** — runnable test scripts, each ≤120 lines.
2. **`.planning/pre-phase/04.5-subagents/SPIKE-RESULTS.md`** — for each H, one paragraph: pass/fail, evidence (file:line + observed behavior), design implication.
3. **`.planning/pre-phase/04.5-subagents/INTEGRATION-SKETCH.md`** — 1–2 page consolidated answer:
   - Recommended pattern for spawning a child (services-shared vs per-child)
   - Whether OTel propagation needs custom plumbing
   - Whether cross-model is feasible inside Phase 4.5 or must be deferred to 4.6
   - Concrete TS skeleton for `SubAgentTool.execute` (~40 lines)

---

## 5 — Decision matrix this informs

| Outcome cluster | Phase 4.5 shape |
| --- | --- |
| H1, H2, H4, H7 all pass | **Lean path** — share services, in-memory child sessionManager, customTools for scope. Fastest to ship. |
| H1 or H4 fail | **Standard path** — per-child services. ~50ms extra spawn cost, cleaner isolation. Default-recommended. |
| H3 fails | **Cross-model deferred to Phase 4.6.** Phase 4.5 ships single-model sub-agents only. |
| H5 fails | **Add explicit OTel injection** in SubAgentTool wrapper. Add 0.5 day to Phase 4.5 estimate. |
| H6 fails | **In-memory child + telemetry sidecar JSONL** as canonical. (Already the recommended posture.) |
| H8 fails | **Add cleanup workaround**, file upstream issue. Cosmetic. |
| Spike spills past 1 day | **Fork pi-mono.** Open a fork branch, expose what we need, contribute upstream where Mario will accept it. |

---

## 6 — What this spike deliberately does NOT cover

- vLLM concurrency / KV pressure under parent+child load → handled by the **vLLM sleep-mode + concurrency spike** running in parallel.
- TUI nesting / Ink component for collapsible child turns → Phase 4.5 plan, not spike scope. (Pi has no off-the-shelf nesting widget; we know we're building one.)
- Headless mode (`pi-emmy --batch`) → handled by the **headless-mode spike** running in parallel; partly *exposed* by the existing `runPrint` helper (`packages/emmy-ux/src/session.ts:284`).
- Sub-agent definition file format (YAML frontmatter on `.md`) → Phase 4.5 spec scope.
- Memory tool (Anthropic `memory_20250818`) → Phase 4.4 scope, separate from sub-agents.

---

## 7 — Open questions (for the user)

1. **Run scripts under bun or node?** Emmy is bun-installed (`bun.lock`), but scripts run under `tsx`/`node` would be portable. Bun is preferred unless H8's handle-counting needs Node specifics.
2. **Mock vLLM or real?** H3, H5, H6, H7 only need a stub HTTP endpoint that returns canned chunks. Real vLLM not required for the spike; saves cold-start time. Use `nock`/`msw` or a 30-line `http.createServer` stub.
3. **Where do spike results land in commit history?** I'd commit `scripts/spikes/04.5-subagents/` and `.planning/pre-phase/04.5-subagents/` together as one commit so the artifacts and their generators travel as a unit. OK?
