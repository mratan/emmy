# Emmy

## What This Is

Emmy (named after Emmy Noether) is a fully local coding agent for NVIDIA DGX Spark, built in two architecturally separate parts: (1) a vLLM serving framework specialized for coding agents — coding-tuned sampling defaults, grammar-constrained tool output, long-context optimization, and speculative decoding — targeting Gemma 4 and Qwen 3.6 as first-class models, and (2) a pi.dev-based agent harness that exposes every surface (tool format, agent loop, context management, system prompt, sampling control, multi-model routing, observability, tool extensibility) that opinionated harnesses like Claude Code and opencode hide. Emmy is for the project author as a daily driver and for the open research community as a reproducible artifact about local coding agents.

## Core Value

A local coding agent good enough to be the author's daily driver, structured rigorously enough to be a public research artifact others can reproduce — with no cloud dependency anywhere in the loop.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. Hypotheses until shipped. -->

- [ ] Specialized vLLM serving stack on DGX Spark with first-class profiles for Gemma 4 and Qwen 3.6
- [ ] Coding-tuned sampling defaults (per-model, per-task) sourced from community best practice; only run new experiments where consensus does not exist
- [ ] Grammar-constrained / structured tool-call output so weaker models always emit parseable tool calls
- [ ] Long-context optimization (KV cache strategy, prompt caching, attention handling) sized for real codebases
- [ ] Speculative decoding (draft + target) for latency without quality loss
- [ ] pi.dev-based harness with full control over: tool-call format, agent loop / retry / self-correction, context injection and pruning, system prompt layering, sampling per tool/task, multi-model routing, observability hooks, tool extensibility
- [ ] First-class **model profile** abstraction shared by serving and harness layers — known-good configs are versioned artifacts, not buried in code
- [ ] Reproducible benchmark suite that extends the Phase 1 prompts from `../setup_local_opencode` so anyone can re-run and verify claims
- [ ] Daily-driver UX: emmy is good enough that the author reaches for it instead of Claude Code on real personal projects
- [ ] Self-hosted: vLLM and pi.dev both run on the DGX Spark; no cloud inference or hosted services in the critical path

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Cloud inference — defeats the local self-hosted thesis and the research-artifact reproducibility story
- Hosted multi-user deployment — emmy is a personal tool / research artifact, not a SaaS
- Non-coding agent use cases (general chat, literature review, etc.) — narrow focus is what makes the specialization valuable; revisit only if coding-agent v1 is solid
- Model fine-tuning / training — emmy uses stock weights; the bet is on scaffolding, not on training a better base model
- Backwards compatibility with the `setup_local_opencode` prior repo — emmy is a clean rebuild that draws on its lessons, not its code

## Context

**Prior work — `../setup_local_opencode`:**

- Extensive 7+ hour evaluation across Qwen3-Next-80B-A3B-Instruct-FP8, MiniMax-M2-REAP-162B-A10B, and openai/gpt-oss-120b
- Qwen3-Next won at 8.5/10 quality, 24–77s/task, 48K practical context, on the **original** prompt
- Critical Phase 2 lesson: *"More prompt engineering ≠ better performance"* — Qwen3 regressed (8.5 → 6.8) under heavy tuning; MiniMax improved on conciseness tuning (6.5 → 8.5 on unit tests). Defaults from community knowledge usually beat custom tuning unless there's clear signal.
- Open issue inherited from prior work: Qwen3 system prompt delivery was flaky over the vLLM Anthropic-compatible endpoint in Phase 3. Worth reproducing and fixing — or designing emmy's harness path so the failure mode doesn't recur.
- Prior architecture put Claude Code on top of vLLM via the `/model haiku` Anthropic-compatible route. Emmy explicitly replaces that harness with pi.dev for extensibility.

**Why a custom harness:**

The author tried to push Qwen3 with the off-the-shelf agent harnesses (Claude Code, opencode) and hit walls on every dimension that matters for weaker local models:

- Tool format rigidity — couldn't reshape tool-call schema or function descriptions to match what the model parses best
- Agent loop opacity — couldn't customize ReAct loop, retry logic, self-correction, or interleave compiler/test feedback
- Context management — couldn't control injection, summarization, pruning, RAG strategy
- System prompt control — couldn't fully replace or layer the harness prompt (mirrors the Phase 3 prompt-delivery issue)
- Sampling / decoding control — couldn't tune temperature, penalties, speculative decoding, or grammar per-tool/per-task
- Multi-model routing — hard to route subtasks (planning vs editing vs search) across different local models
- Observability / eval hooks — couldn't instrument the loop for traces, replay, or running the phase-style evals against real sessions
- Tool extensibility — adding/removing tools or custom dev integrations was clunky

These eight pain points define the required surface area of emmy's pi.dev harness.

**Design principle — stand on shoulders:**

A wealth of community knowledge already exists on optimal sampling parameters, prompt patterns, and tool formats per model and per use case. Emmy starts from the best published settings as the default profile for each model, and only runs in-house experiments where the community has not yet converged. This keeps the project lean and avoids re-litigating settled questions.

**Subjective ↔ objective tension to design for:**

"Daily driver" is a subjective lived-experience bar. "Research artifact" is an objective measurable bar. They don't always agree (a model can score well on the eval and still feel bad to use). Emmy needs both an automated benchmark suite AND a way for the author to record lived-experience feedback during real use; both inform iteration.

## Constraints

- **Hardware**: DGX Spark — vLLM and pi.dev both must run on this single box. Model and KV-cache memory budgets are bounded by Spark's unified memory.
- **Tech stack — serving**: vLLM is the inference engine. Models are stock Gemma 4 and Qwen 3.6 weights (FP8 or equivalent quantization for memory fit).
- **Tech stack — harness**: pi.dev is the agent-runtime substrate. The harness must remain deeply customizable across all eight pain-point axes.
- **Reproducibility**: every benchmark claim must be re-runnable from a clean DGX Spark by an outside party — pinned versions, versioned profiles, deterministic seeds where applicable.
- **No cloud dependency**: in the critical inference and agent-loop paths. Reading documentation from the web is fine; calling hosted models is not.
- **No fine-tuning**: stock weights only. All capability gains come from serving-layer + harness-layer scaffolding.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Two-part architecture: specialized vLLM serving + pi.dev harness | Each part has different concerns and changes at different rates; clean separation makes both testable and replaceable | — Pending |
| Both Gemma 4 and Qwen 3.6 as first-class v1 models | The author wants real choice across two distinct model families; profiles must be designed for plurality from day one (architect for any local model) | — Pending |
| pi.dev as harness substrate (not Claude Code / opencode) | Existing harnesses are too opinionated to extract maximum capability from weaker local models; pi.dev gives full extensibility across all eight pain-point axes | — Pending |
| First-class model-profile abstraction shared by serving + harness | Known-good configs (sampling, prompt scaffolding, tool format) are versioned artifacts, not buried in code; enables both "stand on shoulders" and reproducibility | — Pending |
| Stock weights only — no fine-tuning | Bet is on scaffolding, not on training; keeps scope tractable and reproducible | — Pending |
| Reproducible benchmark suite extending Phase 1 prompts from `setup_local_opencode` | Continuity with prior eval data; lets emmy's claims be validated against an existing baseline | — Pending |
| Stand on community-knowledge defaults; experiment only where consensus is missing | Avoids reinventing settled questions; Phase 2 lesson confirmed that aggressive custom tuning often regresses against well-known defaults | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-20 after initialization*
