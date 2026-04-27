# V8 SC walkthrough — finding from autonomous Claude run, 2026-04-26

## What happened

V8 runner (`packages/emmy-ux/scripts/v8-real-deal-e2e.ts`) was executed against
live `qwen3.6-35b-a3b@v3.1` on this DGX Spark.

After two prerequisite fixes (script shipped with two dev defects, see § Fixes
applied below), the dispatch flow itself succeeded end-to-end:

1. Parent session booted. SP_OK canary green. Transcript opened at
   `runs/phase2-sc3-capture/session-2026-04-27T00-08-32-265Z.jsonl`.
2. Parent fired Agent tool with `subagent_type="research"` + the prompt asking
   for `customTools` usages in `@emmy/tools`.
3. Sub-agent dispatched. `subagent.research` span recorded.
4. Parent produced a coherent 4-sentence answer naming `customTools`,
   `mcp-bridge.ts`, and `createAgentSessionFromServices` — semantic check
   would have passed.

## Why W1 still FAILED

The LOCKED 4-level trace tree shape `parent_session → agent.tool.Agent →
subagent.<persona> → child` does not link. Captured trace:

```
agent.tool.Agent  [trace=f6876bf7 span=8789988c parent=undefined]
  subagent.research  [trace=f6876bf7 span=78da2e81 parent=8789988c]
parent_session  [trace=2e2f0ded span=51aae711 parent=undefined]
```

- agent.tool.Agent ↔ subagent.research are correctly linked (level 2 ↔ 3).
- parent_session is in a DIFFERENT trace; level 1 ↔ 2 is not connected.

Root cause is an architectural gap, not an OTel-helper bug:

- `packages/emmy-tools/src/subagent/otel.ts:5` declares
  > "Level 1: parent_session (owned by emmy-ux's session.ts)"
- But session.ts never opens a `parent_session` span — grep finds no occurrence.
- The V8 runner script tried to compensate by opening one externally via
  `tracer.startActiveSpan("parent_session", ...)` BEFORE calling
  `createEmmySession`. That fails because `createEmmySession` calls
  `initOtel` internally (when `telemetryEnabled: true`) which disrupts the
  AsyncLocalStorage active-span chain. By the time the Agent tool fires its
  `withAgentToolSpan`, the script's parent_session is no longer the active
  context.

## Why this is real, not a script bug

The fix cannot live in the V8 script alone. Two paths considered:

1. **Make session.ts own the parent_session span** (matches the architecture
   comment in `otel.ts:5`).
2. **Lift the parent_session ownership to the runtime callsite (pi-emmy.ts
   bin)** — open it before `createEmmySession`, but coordinate with `initOtel`
   so the context-manager activation isn't lost. Brittle.

Path (1) was implemented (commit history below). It works for Level 1 — a
`parent_session` span is created, attributed with `gen_ai.conversation.id`,
and lives for the duration of `runPrint`. **But the V8 trace tree STILL
shows agent.tool.Agent in a separate trace**, captured 2026-04-26 post-Option-X:

```
parent_session   [trace=b584da73 span=975ccc7e ROOT]                ← session.ts opens
agent.tool.Agent [trace=46636a58 span=c1e18bcc parent=undefined]    ← still orphaned
  subagent.research [trace=46636a58 span=0e96f8d3 parent=agent.tool.Agent]
```

`tool.parentSpanId === undefined` means at the time `withAgentToolSpan` ran,
`context.active()` returned an empty context — no active span — even though
session.ts's `parent_session` is still alive at that point.

## Root cause (deeper than initial estimate)

AsyncLocalStorage propagation is breaking somewhere between
`session.prompt(prompt)` and the Agent tool's `execute()` callback. Most
likely candidates (in order of suspicion):

1. **pi-coding-agent's HTTP boundary in `session.prompt`.** `pi-ai`'s
   provider transport uses `fetch` (Node 22 undici). Node should preserve
   ALS across fetch awaits, but there are documented edge cases — e.g.
   when response handling routes through an `EventEmitter.emit()` callsite,
   the active context becomes the emitter's, not the original handler's.
   The H5 spike confirmed ALS works through pi's tool dispatch BUT used
   a faux in-process provider — H9 explicitly *did not* exercise pi-mono's
   real HTTP provider chain (SPIKE-RESULTS.md § "What was not tested in H9").
   V8 is the first end-to-end exercise of ALS-over-HTTP-via-pi, and it
   shows the gap.

2. **vLLM stream-response handler internals.** The provider handler in pi
   parses streamed tool_call chunks. Streaming response handlers may run
   in the context of whichever code added the chunk listener — which may
   not be the parent_session active context.

3. **OTel SDK's lazy context manager binding.** Tracers cache resolved
   context-manager refs. Even though install order is fixed (manager
   first, provider second), if a tracer is constructed before either is
   live, it binds to the no-op default. We checked this in v8 script;
   pi is its own consumer.

## What Path (1) DID accomplish

- Level 1 of the LOCKED 4-level shape now lives in the right architectural
  place (session.ts owns it; matches `otel.ts:5` comment).
- The V8 script no longer needs an external compensating span — removed.
- `parent_session` carries `gen_ai.conversation.id` + `emmy.session.mode`
  attributes, so when the propagation fix lands, the level-1 span will
  already be correctly attributed.
- The run-loop body has explicit error handling via `recordException` +
  `setStatus(ERROR)` for any uncaught throw out of `session.prompt`.

This is real progress that should not be reverted. The remaining gap is
the level-1↔level-2 trace linkage.

## What Path (1) revealed that needs a follow-up plan

The W1 invariant "Pitfall #18 mitigation via observable trace tree" is
NOT achievable by ALS-only propagation through pi-coding-agent's real
provider chain. The follow-up plan needs to:

A. **Explicit context threading.** Capture `context.active()` inside
   `runPrint` after `parent_session` opens; pass it down to
   `createSubAgentTool` via a session-scoped holder; have
   `withAgentToolSpan` wrap inner in `context.with(capturedCtx, …)`
   instead of relying on `context.active()`. This bypasses ALS entirely
   for the level-1↔level-2 hop.

B. **Wire-level traceparent capture verification.** The H9 spike author
   explicitly flagged this in SPIKE-RESULTS.md § "Implications for
   Phase 4.5 V4": "Phase 4.5 verification V4 (OTel propagation) will
   need to capture wire-level traceparent headers rather than rely on
   prefix-cache hit-rate as a side-channel signal." V8 must assert on
   the actual `traceparent` HTTP header on the child's vLLM POST.

C. **Investigation: where does pi lose ALS?** A small instrumentation
   spike inside pi-coding-agent's response stream handler should pin
   down the exact callsite where context is reset. May reveal that pi
   itself needs a small upstream contribution (and we should NOT fork
   pi per CLAUDE.md "MCP via pi extension, not a fork").

ETA on this follow-up plan: real plan-phase work, not a 30-min wrap.
Recommend a 04.5-08 phase or filing as 04.5-followup with a proper
PLAN.md.

## Fixes applied during this run (defects in 04.5-07 Task 2's V8 script)

These were prerequisites just to make the script execute. They do NOT
constitute the W1 fix and have NOT been committed:

1. **Missing devDeps in `packages/emmy-ux/package.json`** — script imports
   `@opentelemetry/context-async-hooks` and `@opentelemetry/sdk-trace-base`
   but only `@opentelemetry/api` was declared. Added both at v2.1.0
   (matching the versions used in @emmy/telemetry / @emmy/tools).

2. **Wrong runtime API** — script calls `out.runtime.run(prompt, {mode: "json"})`,
   but the PiRuntime adapter exposes `runPrint`, not `run` (per
   `packages/emmy-ux/src/session.ts:128`). Changed to `runPrint`.

After both fixes, the script ran to completion. Both fixes are uncommitted in
the working tree pending operator review of WHETHER to land the W1 architectural
fix in the same commit or a separate one.

## Operator-actionable items

| Item | Status |
|------|--------|
| `04.5-07-sc-walkthrough-green` resume signal | **NOT GREEN** — W1 4-level shape fails as documented above |
| Functional dispatch (parent → Agent → sub-agent → coherent answer) | GREEN under autonomous run |
| Pitfall #18 mitigation (sub-agent observability) | PARTIAL — sub-agent span exists and is correctly attributed; missing only the parent_session linkage |
| Defect: missing devDeps in emmy-ux | TRIVIAL — fix in working tree, awaiting commit |
| Defect: V8 script calls non-existent `runtime.run` instead of `runPrint` | TRIVIAL — fix in working tree, awaiting commit |
| Defect: session.ts does not own a `parent_session` span | NEEDS PLAN — architecturally required by `otel.ts:5` comment; not a 04.5-07 scope-creep, it IS the W1 contract |

## Recommendation

A small follow-up plan (04.5-08 or in-04.5-followup) wraps `runPrint` (and any
TUI-mode equivalent) inside `createEmmySession`'s adapter at
`packages/emmy-ux/src/session.ts:399` with `tracer.startActiveSpan("parent_session", ...)`,
re-runs the V8 script, captures the now-linked trace tree as evidence, and
flips `04.5-07-sc-walkthrough-green`. ETA: ~30 minutes.

Until then, V8 stays YELLOW — the dispatch works, the visibility gate doesn't.

---

*Captured 2026-04-26 by autonomous Claude post-merge run on main.*
*Trace tree at `runs/v8-trace-tree.txt`; parent text first 300 chars
visible in `/tmp/v8-run.log`.*
