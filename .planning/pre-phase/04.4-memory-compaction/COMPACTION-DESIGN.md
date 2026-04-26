# Compaction Design — minimal prompt + append-only invariant

**Status:** proposed (pre-phase, not yet committed to roadmap)
**Phase that consumes this:** 04.4 (Filesystem memory + compaction polish; sibling of `MEMORY-TOOL-SPEC.md`)
**Decision this informs:** the compaction prompt content, the append-only-prefix invariant as a project-level decision, the `/compact` and `/clear` slash-command surfaces, and the verification tests that gate Phase 4.4 acceptance.

---

## 1 — What already exists vs. what's new

Emmy already has substantial compaction machinery — re-read before assuming we need to rebuild:

- **`@emmy/context` package** (`packages/emmy-context/`) drives the D-30 live-wire pattern: `emmyCompactionTrigger()` evaluates the soft threshold on `turn_start`, returns a directive, and pi's native `ctx.compact({customInstructions})` does the actual work.
- **D-11** soft-threshold default: 0.75 × `max_input_tokens` (114688 ceiling on Qwen 3.6 35B-A3B v3.1 → trigger ~86K).
- **D-13** profile-supplied prompt at `prompts/compact.md`.
- **D-14** preservation: keep most-recent-N turns verbatim (default 5).
- **D-15** preserve tool results: `error_only` (stack traces kept verbatim).
- **D-16** structured-pruning fallback: drop oldest turns until 50% of budget free if summarizer fails.
- **Telemetry:** `session.compaction.{trigger,complete,fallback}` OTel events.
- **Pi-mono's** `AgentSession.compact(customInstructions)` (`agent-session.d.ts:446`) does the round-trip itself; Emmy's directive supplies `customInstructions`.

What's NEW for Phase 4.4:

1. **Append-only-prefix invariant** codified as a new project decision (D-3X) — see §2. This is mostly an *audit and codification* of behavior pi-mono and Emmy already produce; the change is making it a load-bearing rule that future code can't violate.
2. **Trimmed `prompts/compact.md`** in keeping with pi-mono minimalism — see §3.
3. **`/compact` and `/clear` slash commands** — Phase 3.1 has stubs; Phase 4.4 confirms they're wired and verified.
4. **Verification tests** that exercise the above and catch drift early — see §8.

No new schema, no new code paths, no new package. Phase 4.4's compaction half is **prompt + invariant + tests**. Lean.

## 2 — The append-only-prefix invariant (D-3X, proposed)

**Decision:** *the system-prompt prefix sent to vLLM never mutates within a session.* Compaction replaces conversation-body turns; it never edits system prompt, tool descriptions, project preamble (CLAUDE.md / AGENTS.md), or any pre-turn content.

**Why:**
1. **vLLM automatic prefix caching** is the single largest free-money win in the long-context stack. Any prefix mutation invalidates blocks from the mutation point forward → full recompute on the next request → KV pressure → preemption risk on a 0.55-gmu single-GPU box.
2. **Cognition's 2026 lesson** (`multi-agents-working`, see CLAUDE.md research notes): "clean context for verifiers" outperformed re-seeding with summaries. Stable prefix is closer to clean than rewriting prefix.
3. **Reproducibility:** prefix mutations interleaved with compactions create non-deterministic histories — the same task twice under the same seed could end up with different prefix bytes. Eval breaks.

**What this allows:**
- Pi's `before_provider_request` payload mutations (Emmy's thinking-disable, reactive grammar, assembled-prompt-injection in `packages/emmy-ux/src/pi-emmy-extension.ts`). These mutate per-request payload features, not the conversation prefix.
- Compaction replacing *conversation body* turns — pi's existing behavior, which appends a `SessionCompactionEntry` at the cut point and removes summarized entries. The system prompt at index 0 is untouched.
- Adding a custom message via `sendCustomMessage` *after* the system prompt — that's appending, not mutating.

**What this forbids:**
- Re-rendering the system prompt mid-session (e.g., to inject a "remember to use the memory tool" hint after the first poor showing).
- Re-ordering tool descriptions mid-session.
- Mutating CLAUDE.md / AGENTS.md and re-loading them mid-session.
- Adding a "session summary so far" block to the system prompt at compaction time.

**How to enforce:**
1. **One-time audit** during Phase 4.4: walk the call sites of `before_provider_request` and any other prefix-touching code; assert each is per-request payload mutation, not conversation prefix mutation.
2. **Test:** capture the bytes of the assembled system prompt at turn 0 and turn N (post-compaction); they must hash-equal. See V3 in §8.
3. **Telemetry assertion:** emit `emmy.prefix.hash = <sha256>` on every wire request; the assertion runs in CI and locally — any change in `prefix.hash` within one session-id without a profile reload is a violation.

This is a small write-down of an invariant the system already mostly upholds — but writing it down makes it part of the contract instead of an accident.

## 3 — Compaction prompt (`prompts/compact.md`)

Pi-mono ships a default compaction prompt; Emmy's profile-supplied prompt overrides it (D-13). Per the minimalism principle, **ship the shortest prompt that produces good summaries, measure, only expand if measurement shows it doesn't**.

**v1 prompt (~35 tokens):**

> Summarize the conversation above so a fresh context can resume the work. Preserve: explicit goals, decisions made, errors and their resolutions, files modified and their final state. Drop: dead-end exploration, redundant tool calls, transient state.

That's it. No five forced sections. No "if any decision is load-bearing for future sessions, write it to memory" clause (we considered; deferred to verification — see §6 of `MEMORY-TOOL-SPEC.md`). The model knows what a useful summary is.

**Calibration plan** (V1–V2 in §8): after running 10 multi-turn sessions that organically trigger compaction, hand-rate each summary on three axes:

- **Goal preservation:** does the summary state the active goal?
- **Decision preservation:** does it list locked-in decisions (file paths chosen, libraries committed)?
- **Error preservation:** does it carry forward unresolved errors with enough detail to act on?

Targets: ≥80% goal preservation, ≥70% decision preservation, 100% on unresolved-error preservation (this is the only critical dimension — losing an in-flight error is worse than losing a decision because the agent will rediscover the decision but might not the error context).

If any target misses, the v1 prompt gets the missing axis explicitly named and we re-test. **Do not pre-emptively name all three axes in the v1 prompt** — measurement-driven expansion only.

## 4 — Slash commands: `/compact` and `/clear`

Phase 3.1's plan 03.1-01 introduced `/compact` and `/clear` stubs. Phase 4.4 confirms both are wired through to pi's `AgentSession.compact()` / a reset path, and adds verification.

**`/compact [reason]`** (manual trigger):
- Calls `AgentSession.compact({customInstructions: composeReasonPrompt(reason)})`.
- `reason` is appended to the v1 prompt as a single `Reason: <user text>` line. No structural change to the prompt — just a hint.
- Telemetry: `emmy.compaction.trigger` with `trigger_kind: "manual"`.

**`/clear`** (full reset):
- Disposes the current session, instantiates a new one with the same profile.
- Memory dir, sub-agent state, and OTel parent trace ID **do not** carry over — clearing is clearing. (If we ever want a "soft clear" that preserves memory, that's a different command.)
- The boot-time profile load happens again; this is intentional — `/clear` is the user's escape hatch when the session has gone off the rails.

**`/compact` and `/clear` are headless-mode-incompatible by design.** The headless runner does not expose them as `--cmds` candidates because both alter session lifecycle in ways that don't compose with one-shot runs. Headless's `--max-turns` + auto-compaction is the equivalent.

## 5 — What pi-mono already does that we keep

- `shouldCompact()` predicate (`pi-coding-agent/dist/core/compaction/index.d.ts`).
- `compact()` round-trip with token-counting and message-rewriting.
- `SessionCompactionEntry` JSONL format — already includes `customInstructions`, `tokensBefore`, `tokensAfter`, `summary`.
- Auto-retry on transient summarizer failures.

Don't rebuild any of this. Emmy's wedge is the **directive pattern** (D-30), the **profile-supplied prompt** (D-13), and now the **append-only invariant** (D-3X) — *not* re-implementing the round-trip.

## 6 — Profile schema (no new fields)

The existing schema covers v1:

```yaml
context:
  max_input_tokens: 114688
  compaction:
    soft_threshold_pct: 0.75
    preserve_recent_turns: 5
    preserve_tool_results: error_only
    summarization_prompt_path: prompts/compact.md
```

If V1–V2 verification (§8) shows the v1 prompt misses, we *update `prompts/compact.md`*, not the schema. The schema as it stands is the right surface; we don't need new knobs.

## 7 — What this design deliberately does NOT include

- **Hierarchical / multi-level summarization** (`summary_level_1`, `summary_level_2`). Once compaction has run, the next compaction summarizes-the-summary-plus-new-turns just fine. The drift problem is real but is best caught by the v1 prompt's "files modified and their final state" clause, not by extra prompt machinery.
- **Compaction-time auto-write to memory.** Considered in `MEMORY-TOOL-SPEC.md` §6 conversation; rejected for v1 on provenance-ambiguity grounds. The model already has memory tools; if a compaction-worthy decision exists, the model can call `memory.create` deliberately. We measure (V8 in `MEMORY-TOOL-SPEC.md`) before adding any auto-write.
- **Compaction prompt sectioning** (goals / decisions / blockers / files / open-questions as forced fields). Cognition's exact pattern is unpublished and their newest guidance backs away from heavy summarization-as-handoff. The v1 prompt names what to preserve in one line.
- **Soft-threshold tuning per profile.** D-11's 0.75 default holds; tuning is a Phase 5 eval decision, not a Phase 4.4 design decision.

## 8 — Verification — how we test the minimal design works

### V1 — Compaction triggers at the right time
**Setup:** 1 long session driven by `pi-emmy --batch` against a real profile; build conversation past 0.75 × max_input_tokens through repeated long tool outputs.
**Pass:** `emmy.compaction.trigger` event fires within ±5% of the soft threshold; no preemption observed in vLLM `/metrics`.
**Fail:** plan 04.4-06 (compaction trigger audit) reopens.

### V2 — Compaction summary quality (the v1 prompt's payoff)
**Setup:** 10 multi-turn coding sessions, each long enough to trigger one compaction. Hand-rate each summary on goal / decision / error preservation per §3.
**Pass:** ≥80% goal, ≥70% decision, 100% error preservation.
**Fail:** revise `prompts/compact.md` to add the missing axis explicitly; rerun.

### V3 — Append-only-prefix invariant holds
**Setup:** instrumented session that captures the assembled prompt bytes on every wire request via `before_provider_request`. Run a session that organically triggers one compaction.
**Pass:** the system-prompt-prefix portion of every request hash-equals the turn-0 hash.
**Fail:** D-3X is being violated somewhere; locate via `emmy.prefix.hash` mismatch and patch.

### V4 — Prefix-cache hit rate after compaction (per profile, architecture-aware)
**Background:** Pitfall #22 (added 2026-04-26 from Phase 4.5 spike H9): vLLM's prefix caching can be silently a no-op on Mamba-hybrid models even when `enable_prefix_caching: True`. Empirically observed at 0% hit rate on Qwen 3.6 35B-A3B v3.1 (`Qwen3_5MoeForConditionalGeneration` with Mamba layers). This V4 must therefore measure per profile and apply architecture-aware thresholds — not a single project-wide target.
**Setup:** the same V3 session, run independently against each shipped profile (Qwen 3.6 35B-A3B v3.1, Qwen 27B v1.1 dense, Gemma 4 26B-A4B v2, Gemma 4 31B v1.1 dense). Query vLLM `/metrics` for `vllm:prefix_cache_hits_total` and `vllm:prefix_cache_queries_total` before and after compaction. Also tail vLLM container logs for the `Mamba cache mode is set to 'align' ... experimental` warning at boot — that warning's presence is the architecture-detection signal for adjusting the target.
**Pass criteria, per profile:**
- **Attention-only profiles** (Qwen 27B dense, Gemma 31B dense): `prefix_cache_hits_total` increments on the post-compaction turn AND hit-rate ≥ 80% on the first post-compaction request. Hard target.
- **Mamba-hybrid profiles** (Qwen 35B-A3B, Gemma 26B-A4B): record the observed hit rate and tail log evidence of the experimental warning. **Pass = measurement performed and acknowledged**, not a hit-rate threshold. If the architecture-detection signal (boot warning) is gone in a future vLLM version, re-run and apply the 80% target.
**Fail:** measurement skipped, OR an attention-only profile shows hit rate < 80%, OR a Mamba-hybrid profile shows hit rate > 0% but the eval harness still asserts the 80% threshold (mis-applied gate).
**Why not just gate on 80% everywhere:** invalidates currently-shipping profiles for an upstream limitation that isn't ours to fix. The right behavior is "measure, document, retry on upstream change" — not "block Phase 4.4 acceptance on a vLLM Mamba feature."

### V5 — `/compact [reason]` and `/clear` work end-to-end
**Setup:** interactive session; user issues `/compact "stuck on auth flow"`. Verify the compaction prompt receives the reason as `Reason: stuck on auth flow`. Issue `/clear`. Verify a new session-id, fresh JSONL, profile re-loaded.
**Pass:** both commands behave per §4.
**Fail:** Phase 3.1 plan revisited.

### V6 — Auto-retry on summarizer failure
**Setup:** stub vLLM to return a malformed summary on first call, then succeed. Trigger compaction.
**Pass:** pi's auto-retry kicks in; the second call's summary is used; D-16 fallback is *not* invoked.
**Fail:** investigate retry plumbing.

### V7 — D-16 fallback engages on persistent failure
**Setup:** stub vLLM to return malformed summaries 3+ times. Trigger compaction.
**Pass:** D-16 structured-pruning fallback fires; oldest turns dropped; `emmy.compaction.fallback` event emitted; session continues without crash.
**Fail:** plan 04.4-07 reopens.

### V8 — Real-deal long session
**Setup:** 2-hour interactive session on Qwen 3.6 35B-A3B v3.1 doing real work. Operator does meaningful coding. Watch for compaction events, KV preemption, prefix cache hit rate, summary coherence.
**Pass (qualitative):** at least one compaction fires organically; session continues coherently after; no preemption; the next-turn-after-compaction hit rate stays ≥80%.
**Fail:** the issue surfaces here that V1–V7 missed; the corresponding V is sharpened so it would have caught it.

**V1–V7 are blocking** for Phase 4.4 acceptance. **V8 is the smoke-test forcing-function.** This is the same V1–V8 shape as the memory spec, intentional — Phase 4.4 has two halves and they share a verification rhythm.

## 9 — Plan-phase intake (when 4.4 enters `/gsd-plan-phase`)

Suggested plan breakdown — 3 small plans for the compaction half (the memory half adds 5 more, see `MEMORY-TOOL-SPEC.md` §9):

- **04.4-06 — Append-only invariant audit + telemetry assertion.** Walk all `before_provider_request` and prefix-touching code; emit `emmy.prefix.hash`; add the V3 + V4 tests. ~150 LoC + tests.
- **04.4-07 — Trimmed `prompts/compact.md` for all 4 shipped profiles** (Qwen 35B v3.1, Qwen 27B v1.1, Gemma 26B v2, Gemma 31B v1.1). Add V1, V2, V6, V7 tests. ~50 LoC + tests + 4 prompt files updated.
- **04.4-08 — `/compact` and `/clear` confirmation + V5 test.** If Phase 3.1's stubs are still stubs, finish them. ~100 LoC + tests.

Total Phase 4.4 plan count = 8 (5 memory + 3 compaction). Wave-parallelizable: 04.4-01..04.4-05 in one wave, 04.4-06..04.4-08 in a second wave. V8 runs once both halves are complete.
