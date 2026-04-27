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

The fix cannot live in the V8 script alone. Two paths forward:

1. **Make session.ts own the parent_session span** (matches the architecture
   comment in `otel.ts:5`). createEmmySession would wrap its run-loop in
   `tracer.startActiveSpan("parent_session", ...)` so any tool-call dispatch
   from within the session is parented to it. The V8 script then verifies the
   shape on the existing emmy provider/exporter, no external span.
2. **Lift the parent_session ownership to the runtime callsite (pi-emmy.ts
   bin)** — open it before `createEmmySession`, but coordinate with `initOtel`
   so the context-manager activation isn't lost. Brittle.

Path (1) is the architecturally consistent choice (it's literally what the
otel.ts comment says) and matches the implementation pattern in `withSubagentSpan`
which uses `context.active()` to capture the parent span context.

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
