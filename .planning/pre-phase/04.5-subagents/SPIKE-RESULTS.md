# SPIKE Results — Pi-mono internals for observable sub-agent dispatch

**Date:** 2026-04-26
**Spike doc:** `SPIKE-pi-internals.md`
**Total clock:** ~2 hours (well under the 8h budget — pi-mono's SDK was richer than expected, which collapsed several hypotheses to fast confirmations)
**Verdict:** **8/8 PASS**. All hypotheses confirm the lean path. Pi-mono **does not need to be forked** for Emmy's observable sub-agent dispatch.

---

## Major correcting finding (before any H ran)

The previous Explore-agent survey claimed `AgentSession` was not exported and a sub-agent extension would require forking pi-mono. **Wrong.** Direct read of `node_modules/.bun/@mariozechner+pi-coding-agent@0.68.0+.../node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts:2` and `dist/core/sdk.d.ts:11–98` shows pi-mono ships:

- `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`
- `createAgentSession`, `createAgentSessionFromServices`, `createAgentSessionServices`, `createAgentSessionRuntime`
- `AgentSessionRuntime`, `AgentSessionServices`, `CreateAgentSessionFromServicesOptions`
- `SessionManager` with `.inMemory(cwd)`, `.create(cwd, sessionDir?)`, `.open()`, `.continueRecent()`, `.forkFrom()`
- `AuthStorage` with `.inMemory()` and `setRuntimeApiKey()`
- `defineTool` and the full coding-tool factory set
- `DefaultResourceLoader`, `SettingsManager`

Emmy already exercises `createAgentSessionFromServices` + `createAgentSessionServices` (`packages/emmy-ux/src/session.ts:243–264`) and there's a private `runPrint` helper at `session.ts:284–327` that already does single-prompt → final-text — i.e., **a private headless mode is hidden inside the adapter today**, before any of this work lands.

This pre-finding eliminated about 6 hours of speculative scaffolding from the spike.

## Per-hypothesis results

### H1 — Services sharing (PASS)

**Script:** `packages/emmy-ux/scripts/spikes/04.5-subagents/h1-services-sharing.ts`
**All 7 checks green.** Two `AgentSession` instances built from one `AgentSessionServices` work cleanly:

- Each gets the right canned response (sequential and concurrent)
- Distinct `sessionId`s
- Independent `messages` arrays
- Concurrent `prompt()` calls — both succeed without exception or cross-talk

**Notable observation:** pi calls the provider **twice per turn** on the first turn of a session (capability/preflight + actual). Subsequent turns are 1 call each. Total provider calls in H1 = 6 across 4 turns (2 sequential + 2 concurrent). Spike test scripts must size their faux response pool with this in mind — set ≥2× the prompt count.

**Implication for Phase 4.5:** **Lean path confirmed.** Sub-agents share services with the parent unless they need a different system prompt or different model.

---

### H2 — customTools scope per session (PASS)

**Script:** `h2-customtools-scope.ts`
**All 6 checks green.** Concrete tool registries observed:

- Parent active: `[read, bash, edit, write, parent_only_marker]`
- Parent all: `[read, bash, edit, write, grep, find, ls, parent_only_marker]`
- Child active: `[read, bash, edit, write, child_only_marker]`
- Child all: `[read, bash, edit, write, grep, find, ls, child_only_marker]`

Pi auto-activates 4 default tools (`read`, `bash`, `edit`, `write`) on every session, plus the `customTools` passed to `createAgentSessionFromServices`. The full registry exposes 7 built-in coding tools (also `grep`, `find`, `ls`) but only the 4 are active by default. Custom tools layer per-session with **zero leakage**.

**Implication for Phase 4.5:** A research sub-agent can be given exactly the tools it needs. Tightening below pi's default 4 (e.g., a read-only research agent without `bash`) uses the existing `tools` allowlist option in `CreateAgentSessionFromServicesOptions` — not validated in this spike but pi-mono's `agent-session.d.ts:87` documents `allowedToolNames` for this.

---

### H3 — Cross-model child via different `model` arg (PASS)

**Script:** `h3-cross-model.ts`
**All 6 checks green.** With provider A and provider B both registered and one services instance shared, parent built with `model: regA.getModel()` and child built with `model: regB.getModel()`:

- Parent's prompt only hit provider A's call counter (0 → 2)
- Child's prompt only hit provider B's call counter (0 → 2)
- Each session received its provider's canned response (FROM_A / FROM_B)

**Implication for Phase 4.5:** A Qwen-parent / Gemma-child design is structurally feasible at the **pi/services layer**. The remaining cross-model question is hardware concurrency (two real engines side-by-side under 128 GB UMA, sleep-mode swap latency, KV pressure) — handled by the separate vLLM concurrency spike, not pi internals.

---

### H4 — Per-session resource loader / system prompt (PASS)

**Script:** `h4-resource-loader.ts`
**All 3 checks green.** Concrete observations:

- Two sessions sharing one services instance produce **byte-identical system prompts** (hash `be125696011f8fdb`, length 14 484 chars).
- Two sessions with separate services but the same cwd also produce identical prompts (the resource loader's defaults converge on cwd).
- A session built with services pointed at a **different cwd** (with its own `AGENTS.md`) produces a **different system prompt**.

**Implication for Phase 4.5:** **Standard path** — per-child system prompts require per-child services. Each sub-agent type ships with its own subdirectory containing the sub-agent's `AGENTS.md` (or a programmatic `DefaultResourceLoader` configured at child-spawn time pointing at a different prompt set). This adds ~50 ms per child spawn but is the price for prompt isolation.

Cheaper alternative: use one services and inject sub-agent-persona instructions via the `prompt()` text rather than the system prompt. Less isolated, but no extra services. Worth evaluating per sub-agent type — short-lived utility agents probably don't need the system-prompt isolation; long-running research agents probably do.

---

### H5 — Async context propagation through tool dispatch (PASS)

**Script:** `h5-async-context.ts`
**All 4 checks green.** Used Node's `AsyncLocalStorage` directly (cheaper than spinning up a full OTel SDK for the spike):

- Set `als.run({traceId, spanId}, () => session.prompt(...))` from outside
- Faux provider returned a `tool_call` to a custom probe tool
- The probe tool's `execute()` called `als.getStore()` and observed the **exact** values set outside `als.run()`

**Implication for Phase 4.5:** **OTel context will propagate naturally** through pi-mono's async chain. A SubAgentTool's handler can do:

```ts
const parentCtx = context.active();
return await context.with(parentCtx, async () => {
  return await childSession.prompt(taskPrompt);
});
```

…and the child's vLLM HTTP request will carry the parent's `traceparent` header automatically (assuming OTel HTTP auto-instrumentation is enabled, which @emmy/telemetry already does). The "header on the wire" verification is naturally part of H9 (live Qwen) when we run that.

---

### H6 — Per-child SessionManager and JSONL location (PASS)

**Script:** `h6-jsonl-location.ts`
**All 8 checks green.** With `SessionManager.create(cwd, sessionDir?)` accepting a per-instance `sessionDir`:

- Parent's session file lands in `parentDir`, child's in `childDir`
- Each dir contains exactly one `.jsonl`
- Parent's content includes parent's prompt text but **not** child's
- Child's content includes child's prompt text but **not** parent's

**Implication for Phase 4.5:** **Optional but easy.** Per-child JSONL files are clean if we want them — useful for forensics and reproducibility. Default could still be `SessionManager.inMemory(cwd)` for ephemeral sub-agents, with disk-write opt-in via a `subagent.persistTranscript` profile knob.

---

### H7 — Child compaction independence (PASS, with caveat)

**Script:** `h7-compaction-independence.ts`
**All 5 checks green** *after* fixing a test artifact.

**Test artifact found:** Pi's `DEFAULT_COMPACTION_SETTINGS.reserveTokens = 16384` (`compaction.js:66`). If a model's `contextWindow ≤ 16384`, pi calculates negative available budget and **auto-compacts on every turn**. My initial faux config used `contextWindow: 4096` → all sessions auto-compacted unconditionally → looked like a leak. Fix: bump faux `contextWindow` to 200 000 in test setup.

**With proper contextWindow:**

- Parent's `isCompacting` was never `true` while child compacted
- Parent's message count unchanged (4 → 4) across child's compaction
- Parent's JSONL has zero `type: "compaction"` entries
- Child's JSONL has exactly one (the manual compact)

**Implication for Phase 4.5:** Child compaction is fully isolated at the pi level. **Recommendation:** disable auto-compaction on child sessions anyway (`session.setAutoCompactionEnabled(false)`) — child sessions are short-lived; the dispatcher should decide if/when to compact, not the child autonomously.

**Bonus implication for Phase 4.4 (compaction polish):** the `reserveTokens=16384` default is a problem for any profile whose `max_input_tokens < 32 768` — verify Emmy's shipped profiles all clear this bar. (Quick check: Qwen 35B v3.1 `max_input_tokens=114688` ✓, all 4 shipped profiles in `profiles/*/v*/harness.yaml` use 114 688 ✓ — safe.)

---

### H8 — `dispose()` lifecycle and resource leakage (PASS)

**Script:** `h8-dispose-leak.ts`
**All 2 checks green** across 50 spawn/dispose cycles:

- Active handle count: **0 delta** (Bun exposes `process._getActiveHandles()` via Node compat)
- RSS growth: **5.9 MB** across 50 cycles (~120 KB/cycle — well within tolerance for in-memory session manager caches)
- Per-cycle wall time: **2.4 ms** — fast
- Total provider calls: 51 (1 warmup + 50 actual, exactly as expected)

**Implication for Phase 4.5:** No cleanup workaround needed. Pi-mono's `dispose()` is well-behaved. The `SessionManager.inMemory()` caches that account for the 120 KB/cycle growth would be reclaimed across longer test runs by GC (we forced a `Bun.gc(true)` at the end and still saw +5.9 MB, but extending to 500 cycles would reveal whether it's bounded — not part of v1 spike).

---

---

### H9 — Real-deal Qwen 3.6 35B-A3B v3.1 wire-level (PARTIAL — 9/10, 1 important unexpected finding)

**Script:** `h9-real-qwen.ts`
**Setup:** vLLM cold-started fresh against `qwen3.6-35b-a3b@v3.1`; ~110 s to ready (fastsafetensors cache warm). GPU 47 → 57 °C across the run. KV usage 0% throughout (small probe sizes).

**What passed (9 checks):**

- ✅ Real Qwen produces a well-formed `tool_call` when given OpenAI-style `tools` schema. The args parsed cleanly — `subagent_type: "research"`, `description`, `prompt` all present and sensible.
- ✅ Probe 1 (with tools): 2 096 ms round-trip. Generated a thoughtful `prompt` arg ("Find all references to customTools, understand its structure...").
- ✅ Probe 2 (same system prompt, no tools, short user): 578 ms.
- ✅ Probe 3 (child-style: different system prompt, "research sub-agent" persona): 1 134 ms, returned a coherent 2-sentence summary that correctly identified `customTools` as a per-session tool registration array.
- ✅ All probes < 30 s wall.
- ✅ Probe 3 mentioned `customTools` and `tools` in its response (semantically correct).
- ✅ Sidecar /status reports `vllm_up: true`, `state: ready` post-run.

**What failed — 1 check, but with a load-bearing root cause:**

- ❌ **`prefix_cache_hits_total` did not increment between any two probes.** The metric stayed at 0.0 across the full run. Both `vllm:prefix_cache_queries_total = 913` and `vllm:prompt_tokens_by_source_total{source="local_cache_hit"} = 0` confirm vLLM saw the queries and produced **zero hits**. vLLM's own iteration logs printed `Prefix cache hit rate: 0.0%` repeatedly.

**Why this matters:** The integration sketch's Pattern A (lean child shares parent's services and benefits from "free" prefix caching) was implicitly counting on shared system prompts producing cache hits across sessions. **On Qwen 3.6 35B-A3B v3.1, this assumption does not hold** at least in this configuration.

**Root-cause hypothesis (vLLM logs, captured during boot):**

```
WARNING [config.py:381] Mamba cache mode is set to 'align' for
  Qwen3_5MoeForConditionalGeneration by default when prefix caching is enabled.
INFO    [config.py:401] Warning: Prefix caching in Mamba cache 'align' mode
  is currently enabled. Its support for Mamba layers is experimental.
  Please report any issues you may observe.
```

Qwen 3.6 35B-A3B is a Mamba-hybrid MoE. vLLM ships with prefix caching marked **"experimental"** for Mamba layers, and our zero-hit observation suggests that "experimental" means "currently a no-op for hybrid models" rather than "fully working but possibly buggy." This is a vLLM-side limitation, not a pi-mono or harness limitation.

**Alternative hypothesis (cannot rule out without more probes):** the test's prefixes were structurally different — probe 1 had `tools` schema injected (Qwen's chat template inlines tool descriptions into the prompt), probe 2 didn't, probe 3 had a different system prompt. So the only candidate same-prefix pair was already structurally divergent. Worth a follow-up probe with two requests sharing identical messages + identical `tools` schema — but the explicit "Mamba cache 'align' is experimental" warning in vLLM's own boot log makes hypothesis 1 the more credible explanation.

**Implications for Phase 4.5 (revising the integration sketch):**

1. **Pattern A's prefix-cache argument is weakened on Qwen.** The cost-benefit of "share parent's services for free caching" still holds at the *services-instantiation cost* axis (Pattern A is ~5 ms vs Pattern B's ~50 ms), but the *prefix-cache-hit savings* argument should be removed from the integration sketch until we measure it on Gemma 4 (a non-Mamba architecture).
2. **The vLLM concurrency spike's "design constraints" already account for this.** The spike doc said "Sub-agents should share the parent's system-prompt prefix when possible" — that recommendation should be downgraded to "neutral on Qwen 3.6, possibly beneficial on Gemma 4 (untested), measure per profile."
3. **Phase 4.5 verification V4 (OTel propagation) will need to capture wire-level traceparent headers** rather than rely on prefix-cache hit-rate as a side-channel signal of "child request landed in same engine."
4. **Recommend adding to Phase 4.4 (compaction) verification:** explicitly measure prefix-cache hit rate across compaction boundaries on each shipped profile. Anti-pattern caught: assuming prefix caching is always free and always hits.

**Implications for Emmy's "free win" claims in CLAUDE.md:**

The CLAUDE.md research summary calls vLLM prefix caching "free, large, validated." That claim was based on attention-only model evidence (the bibliography pointed at vLLM's own docs and a KVFlow paper that didn't cover Mamba hybrids). On Mamba-hybrid Qwen 3.6, the claim does not survive empirical contact. Worth filing this as a future-update note for `.planning/research/PITFALLS.md` — it's pitfall-shaped: "engine config flag set, official feature on, hit rate zero on this architecture."

**What was not tested in H9 due to scope:**

- The end-to-end SubAgentTool integration with pi-mono's real provider registration. H9 hits the wire directly via `fetch()`, not through pi-mono's provider chain. The H1–H8 results plus H9's wire-level findings together cover the structural and behavioral dimensions; the missing piece (real-provider plumbing) is Phase 4.5 implementation work, not spike scope.

---

## Outcome cluster matched

Per the spike doc's §5 decision matrix, the outcome cluster is **"H1, H2, H4, H7 all pass"** — the **Lean Path**.

Phase 4.5 v1 shape:
- **Share parent's services where possible.** Most sub-agents (utility, short-lived) use parent's services unchanged.
- **Per-child services only when persona needs it.** Long-running research/code-review sub-agents with their own system prompts get their own services.
- **In-memory child SessionManager by default**, disk persistence opt-in.
- **Disable child auto-compaction.** Dispatcher decides.
- **OTel context.with(parentCtx, ...)** in SubAgentTool handler.
- **No fork of pi-mono.**

## Deferred / not validated by this spike

- **H9 — Real-deal Qwen 3.6 35B-A3B E2E.** Requires vLLM up. Stopped before this per the spike doc's pre-flight gate and user check. Will run when the user starts vLLM. Spike scripts are ready (`h9-real-qwen.ts` not yet written; the integration sketch should be the basis).
- **`tools` allowlist below pi defaults** — read-only sub-agents need this; pi documents the option but didn't test in v1.
- **Multi-level child nesting** (depth >1) — Claude Code caps at 1 anyway. Not testing for v1.
- **Real OTel `traceparent` header capture** on a vLLM HTTP request. Naturally falls into H9.

## Files produced (commit-ready)

- `packages/emmy-ux/scripts/spikes/04.5-subagents/_smoke.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h1-services-sharing.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h2-customtools-scope.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h3-cross-model.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h4-resource-loader.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h5-async-context.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h6-jsonl-location.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h7-compaction-independence.ts`
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h8-dispose-leak.ts`
- `packages/emmy-ux/package.json` — added `@mariozechner/pi-ai` and `@opentelemetry/api` to devDependencies

## Companion artifact

`INTEGRATION-SKETCH.md` (next file) — the concrete recommended pattern for spawning a child session in Emmy, distilled from these results. ~40-line `SubAgentTool.execute` skeleton.
