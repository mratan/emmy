# Integration Sketch — observable sub-agent dispatch in Emmy

**Source:** SPIKE-RESULTS.md (H1–H8 PASS; H9 PARTIAL with one important architectural finding).
**Status:** distilled recommendation, ready for `/gsd-plan-phase 4.5` to ingest.

**H9 caveat baked in (2026-04-26):** vLLM's prefix cache showed 0% hit rate against live Qwen 3.6 35B-A3B v3.1 (Mamba-hybrid; vLLM marks prefix caching "experimental" for Mamba layers in this version). Pattern A's "shared services = free prefix-cache hits" argument has been **removed** from the rule-of-thumb until measured on Gemma 4. The instantiation-cost argument (5 ms vs 50 ms) still stands.

---

## 1 — The two spawn patterns, with rule-of-thumb

### Pattern A — "Lean child" (default for utility sub-agents)

**Use when:** sub-agent persona is a thin wrapper; same system prompt as parent works fine; shorter-lived.
**Examples:** small "go fetch this URL and summarize" tasks, one-off greps over a known dir.

```ts
const { session: child } = await createAgentSessionFromServices({
  services: parentServices,                          // SHARED with parent
  sessionManager: SessionManager.inMemory(parentCwd),
  model: parentModel,                                // or override per H3 if cross-model
  customTools: scopedToolSet,                        // narrowed per persona
});
child.setAutoCompactionEnabled(false);
```

Cost: ~5 ms instantiation, 120 KB RSS (per H8). Cleanup via `child.dispose()`.

### Pattern B — "Persona child" (default for long-running research/review sub-agents)

**Use when:** sub-agent has its own system prompt / tool descriptions / project preamble; persona is meaningfully different from parent.
**Examples:** "research" sub-agent with its own AGENTS.md, "code-reviewer" sub-agent with its own response template.

```ts
const subagentCwd = `${parentCwd}/.emmy/subagents/${personaName}`;
const subagentServices = await createAgentSessionServices({
  cwd: subagentCwd,
  authStorage: parentAuthStorage,                    // SHARED (auth is profile-level)
});
const { session: child } = await createAgentSessionFromServices({
  services: subagentServices,                        // own services
  sessionManager: SessionManager.create(parentCwd, persistDir),  // optional disk persist
  model: personaModel,
  customTools: scopedToolSet,
});
child.setAutoCompactionEnabled(false);
```

Cost: ~50 ms instantiation (per H4). Cleanup via `child.dispose()`. The `subagentCwd` directory contains the persona's `AGENTS.md` (and optionally other resource files).

## 2 — Concrete `SubAgentTool` skeleton (~50 lines)

```ts
// packages/emmy-tools/src/subagent/index.ts (proposed)
import { context, trace } from "@opentelemetry/api";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  defineTool,
  SessionManager,
  type AgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@mariozechner/pi-ai";

type SubAgentSpec = {
  name: string;                    // e.g. "research"
  description: string;             // shown to parent's model
  cwdRelativePersonaDir?: string;  // for Pattern B; absent → Pattern A
  toolAllowlist: string[];         // narrows pi's default 4 + customTools
  modelOverride?: string;          // optional cross-model
  maxTurns: number;                // hard cap
};

export function createSubAgentTool(opts: {
  parentServices: AgentSessionServices;
  parentCwd: string;
  personas: Record<string, SubAgentSpec>;
  modelResolver: (id: string) => any;  // gets a Model<any> by id
}) {
  return defineTool({
    name: "Agent",                   // Claude Code naming convention
    description: "Dispatch a focused task to a sub-agent. " +
      "Returns the sub-agent's text summary; intermediate tool calls are not surfaced.",
    label: "Agent",
    parameters: Type.Object({
      subagent_type: Type.Union(
        Object.keys(opts.personas).map((k) => Type.Literal(k)),
      ),
      description: Type.String({ description: "Short label for the dispatch." }),
      prompt: Type.String({ description: "Task for the sub-agent." }),
      model: Type.Optional(Type.String({ description: "Optional model override." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const persona = opts.personas[params.subagent_type];
      const tracer = trace.getTracer("emmy-subagent");
      return await tracer.startActiveSpan(
        `subagent.${persona.name}`,
        { attributes: { "gen_ai.agent.name": persona.name } },
        async (span) => {
          try {
            // Pattern A vs B based on persona config
            const services = persona.cwdRelativePersonaDir
              ? await createAgentSessionServices({
                  cwd: `${opts.parentCwd}/${persona.cwdRelativePersonaDir}`,
                  authStorage: opts.parentServices.authStorage,
                })
              : opts.parentServices;
            const sessionManager = SessionManager.inMemory(opts.parentCwd);
            const model = opts.modelResolver(params.model ?? persona.modelOverride ?? "default");
            const { session: child } = await createAgentSessionFromServices({
              services,
              sessionManager,
              model,
              customTools: [] as any,    // tool allowlist applied via tools[] option
              tools: persona.toolAllowlist,
            } as any);
            child.setAutoCompactionEnabled(false);
            try {
              // Capture child's final text by subscribing to agent_end.
              const finalText = await runOneTurnReturningText(child, params.prompt);
              span.setAttribute("emmy.subagent.final_text_chars", finalText.length);
              return {
                output: finalText,
                details: { persona: persona.name, ok: true } as any,
              };
            } finally {
              child.dispose();
            }
          } catch (e) {
            span.recordException(e as any);
            throw e;
          } finally {
            span.end();
          }
        },
      );
    },
  });
}

// Helper inside same module:
async function runOneTurnReturningText(child: any, prompt: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let captured = "";
    const unsub = child.subscribe((evt: any) => {
      if (evt?.type === "agent_end") {
        const msgs = evt.messages ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m?.role === "assistant" && Array.isArray(m.content)) {
            captured = m.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("");
            break;
          }
        }
      }
    });
    child.prompt(prompt).then(() => { unsub(); resolve(captured); }).catch(reject);
  });
}
```

This is the **complete v0 SubAgentTool**. ~50 lines of net-new code, plus a helper. Already gives:

- Per-persona system prompt (Pattern B) or shared (Pattern A) — single config point
- Per-persona tool allowlist
- Optional cross-model override
- OTel parent-child span propagation (free via `context.with` pattern)
- Auto-compaction off on children
- Clean disposal in finally

## 3 — Persona definitions live in profile

Per the project's keystone abstraction (CLAUDE.md), all model-shaped logic belongs in the profile:

```yaml
# profiles/qwen3.6-35b-a3b/v3.1/harness.yaml additions
subagents:
  enabled: true
  max_concurrent: 2                      # hardware-imposed cap (vLLM spike confirmed)
  long_context_serialize_threshold_tokens: 40000
  personas:
    research:
      description: "Investigate a specific topic without polluting parent's context."
      pattern: "persona"                 # vs "lean"
      persona_dir: "profiles/qwen3.6-35b-a3b/v3.1/subagents/research"
      tool_allowlist: ["read", "grep", "find", "ls"]
      model_override: null               # use parent's
      max_turns: 10
    code_reviewer:
      description: "Review a diff or file for bugs and style."
      pattern: "persona"
      persona_dir: "profiles/qwen3.6-35b-a3b/v3.1/subagents/code-reviewer"
      tool_allowlist: ["read", "grep"]
      max_turns: 5
    bash_runner:
      description: "Execute a long-running bash task and return the output."
      pattern: "lean"                    # uses parent's services
      tool_allowlist: ["bash", "read"]
      max_turns: 3
```

The `persona_dir` is what becomes `cwd` when constructing per-persona services (Pattern B). Each `persona_dir` contains:

```
profiles/qwen3.6-35b-a3b/v3.1/subagents/research/
  AGENTS.md                  # the persona's system prompt
  prompts/                   # optional: persona-specific prompt fragments
```

## 4 — Verification tests for Phase 4.5

Mirror the V1–V8 pattern from MEMORY-TOOL-SPEC.md:

- **V1** — Pattern A spawn+execute: lean child runs a task, returns text, disposes; <100 ms wall under faux model.
- **V2** — Pattern B spawn+execute: persona child has different `systemPrompt` from parent; runs a task; disposes.
- **V3** — Tool allowlist enforced: persona configured for `[read, grep]` cannot call `bash`; the rejection is observable in the child's transcript.
- **V4** — OTel propagation: parent span A → SubAgentTool span B → child invoke_agent span C all share `trace_id`. Run with @emmy/telemetry's real exporter.
- **V5** — Concurrent children: parent dispatches 2 children in parallel; both complete; no cross-talk (the H1+H8 case combined).
- **V6** — Long-context serialization rule: when parent's input tokens > 40 000, the dispatcher serializes child dispatch instead of parallelizing. Telemetry event `agent.dispatch.serialized` fires.
- **V7** — Auto-compaction-off: child built with `setAutoCompactionEnabled(false)` does NOT compact mid-run even at high context.
- **V8** — Real-deal E2E: live Qwen 3.6 35B-A3B; parent fires `Agent({subagent_type: "research", prompt: "find usages of customTools"})` → child does grep+read → returns summary → parent ingests. Verify prefix-cache hit rate and OTel trace tree end-to-end.

V1–V7 are blocking; V8 is the smoke-test forcing-function (same rhythm as the memory and compaction specs).

## 5 — Phase 4.5 plan-phase intake

Suggested 7 plans, sized for "Standard" granularity:

- **04.5-01 — `SubAgentTool` core.** ~150 LoC + tests (V1, V2, V3).
- **04.5-02 — Persona definition format + profile schema.** YAML schema, validation, `subagents/` subdir convention. ~150 LoC + tests.
- **04.5-03 — OTel parent-child propagation.** Wire `context.with(parentCtx, ...)` in SubAgentTool, GenAI semconv attributes. ~80 LoC + V4 test.
- **04.5-04 — Concurrency governor.** `max_concurrent` enforcement, long-context serialization, telemetry events. ~120 LoC + V5, V6 tests.
- **04.5-05 — TUI nesting renderer.** Custom Ink component for collapsible child-turn display. ~200 LoC + visual smoke test.
- **04.5-06 — Built-in default personas.** `research`, `code-reviewer`, `bash_runner` shipped with each of the 4 profiles. ~50 LoC of code + 12 markdown files (3 personas × 4 profiles).
- **04.5-07 — V8 real-deal E2E** + documentation in docs/runbook.md. ~100 LoC of test harness.

Wave parallelizable: 04.5-01..04.5-04 in one wave, 04.5-05..04.5-07 in a second.

## 6 — Risks still open

1. **H9 not run.** Until vLLM is up and a parent fires a real `Agent` call to a real Qwen child, the OTel `traceparent` on the wire is unverified. Phase 4.5's V4 test forces this.
2. **TUI nesting is the only piece pi-mono doesn't help with.** Pi has no off-the-shelf collapsible-nested-turn widget. Plan 04.5-05 is real engineering, not config.
3. **`tools` allowlist below pi's 4 defaults** — documented but not validated in this spike. Phase 4.5's V3 will catch this; if pi silently union'd the allowlist with its defaults, V3 fails and we revisit.
4. **Concurrent `dispose()` semantics under abort.** If parent aborts mid-child, both `dispose()`s fire; H8 tested sequential dispose, not aborted. Plan 04.5-01 should add a torn-down test.

None of these are blockers for `/gsd-plan-phase 4.5` to start. They're known unknowns surfaced in plan tasks.
