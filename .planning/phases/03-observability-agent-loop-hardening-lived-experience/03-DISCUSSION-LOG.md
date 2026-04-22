# Phase 3: Observability + Agent-Loop Hardening + Lived-Experience - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `03-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 03-observability-agent-loop-hardening-lived-experience
**Areas discussed:** Wire-through sequencing, Observability architecture, Auto-compaction policy, TUI surfaces (3 bundled)

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Wire-through sequencing | Phase-2 carry-forward (5 bindings) — atomic vs waves; @emmy/provider replace vs layer | ✓ |
| Observability architecture | Langfuse deployment, OTel SDK, opt-out semantics, JSONL vs Langfuse-only | ✓ |
| Auto-compaction policy | Trigger, output, preservation, per-profile knobs | ✓ |
| TUI surfaces (3 bundled) | Lived-experience + footer + offline-OK badge | ✓ |

**User's choice:** All 4 selected.

---

## Wire-through sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| One wave, atomic bundle | All 5 bindings in one coordinated plan; SC-1 style re-walkthrough after | ✓ |
| Incremental waves | Provider first, then tools, then prompt + enable_thinking | |
| Test-first then all-atomic | Tests written against real paths first (RED), then flip all 5 in one commit | |

**User's choice:** One wave, atomic bundle.

| Option | Description | Selected |
|--------|-------------|----------|
| Layer via streamSimple | @emmy/provider implements ModelRegistry.streamSimple; pi-ai's built-in stream stays | ✓ |
| Full replacement | Deregister pi-ai's openai-completions at boot; emmy-vllm is the only provider | |

**User's choice:** Layer via streamSimple.

| Option | Description | Selected |
|--------|-------------|----------|
| Override via customTools | Pass emmy's tools via customTools; pi keeps built-ins as fallback | ✓ |
| Replace pi built-ins | Strip pi's built-in tool registry; only emmy tools registered | |
| Hybrid: edit + MCP override, others via pi | Only reimplemented tools go through customTools | |

**User's choice:** Override via customTools.

| Option | Description | Selected |
|--------|-------------|----------|
| Wire-throughs first, observability after | Wave 1 flips NO-OPs; Wave 2 Langfuse + OTel | ✓ |
| Parallel waves | Wire-throughs and observability land in parallel plans | |
| Observability first, then wire-throughs | Build Langfuse + OTel against pi-ai's current paths first | |

**User's choice:** Wire-throughs first, observability after.

---

## Observability architecture

| Option | Description | Selected |
|--------|-------------|----------|
| docker-compose-with-emmy | `docker compose up` part of boot sequence; 4 containers | ✓ |
| Standalone daemon, manual lifecycle | User runs Langfuse compose independently before pi-emmy | |
| Embedded fallback + optional Langfuse | JSONL always; Langfuse optional exporter | |

**User's choice:** docker-compose-with-emmy.

| Option | Description | Selected |
|--------|-------------|----------|
| JSONL-always + OTLP-if-up | Dual-sink; JSONL authoritative; OTLP best-effort fan-out | ✓ |
| Langfuse-primary, JSONL-fallback | OTLP primary; JSONL only if OTLP unreachable | |
| OTel collector pattern | Emit to localhost OTel collector; collector fans out to JSONL + Langfuse | |

**User's choice:** JSONL-always + OTLP-if-up.

| Option | Description | Selected |
|--------|-------------|----------|
| @opentelemetry/sdk-node + OTLP/HTTP | Canonical Node OTel SDK + OTLP HTTP exporter | ✓ |
| Hand-rolled OTLP/HTTP client | Small fetch-based exporter | |
| Langfuse JS SDK directly | @langfuse/node bypasses OTel | |

**User's choice:** @opentelemetry/sdk-node + OTLP/HTTP.

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-in-by-default; env var kill-switch | On for interactive + --print + --json; EMMY_TELEMETRY=off disables | ✓ |
| Opt-in-explicit; flag required | Off unless --telemetry or EMMY_TELEMETRY=on | |
| Per-profile config flag | harness.yaml.telemetry.enabled per profile | |

**User's choice:** Opt-in-by-default; env var kill-switch.

| Option | Description | Selected |
|--------|-------------|----------|
| More questions | Dig into air-gap CI integration, span schema details, start_observability.sh | |
| Next area | Move on; defaults go to Claude's Discretion | ✓ |

**User's choice:** Next area. Claude's Discretion fills: Langfuse images digest-pinned + cached in local registry for air-gap CI; profile fields on every span per SC-1 verbatim; separate `start_observability.sh`.

---

## Auto-compaction policy

| Option | Description | Selected |
|--------|-------------|----------|
| Soft threshold + turn boundary | 75% of max_input_tokens triggers; fires at next turn boundary | ✓ |
| Hard-ceiling-only, mid-turn compact | Fires only when turn would overflow; compacts inside the turn | |
| Aggressive, compact every N turns | Every N turns regardless of token count | |

**User's choice:** Soft threshold + turn boundary.

| Option | Description | Selected |
|--------|-------------|----------|
| LLM summarization + verbatim preservation list | Round-trip summarization; preservation list never summarized | ✓ |
| Structured pruning only | Drop pattern-matched turns; never call the model | |
| Sliding window, keep last N turns | Hard drop all but last N turns + system + AGENTS.md + pins | |

**User's choice:** LLM summarization + verbatim preservation list.

| Option | Description | Selected |
|--------|-------------|----------|
| Structural core | system.md + AGENTS.md + tool defs + prompt SHA | ✓ |
| Error/diagnostic payloads verbatim | Error-flagged tool results kept full | ✓ |
| Active goal + recent turn window | First user message + most-recent N turns | ✓ |
| File pins + TODO state | @file pins + agent-created TODO/PLAN files | ✓ |

**User's choice:** All four (multiSelect).

| Option | Description | Selected |
|--------|-------------|----------|
| Per-profile policy block | compaction: {soft_threshold_pct, preserve_recent_turns, summarization_prompt_path, ...} per profile | ✓ |
| Global config with per-profile override-or-inherit | Global defaults; profile overrides fields | |
| Global-only; profile can't override | One policy for the whole harness | |

**User's choice:** Per-profile policy block.

| Option | Description | Selected |
|--------|-------------|----------|
| More questions | Dig into summarizer model, compaction-failure recovery, visible status, SC-2 fixture | |
| Next area | Move on; defaults go to Claude's Discretion | ✓ |

**User's choice:** Next area. Claude's Discretion fills: same vLLM endpoint (Spark one-model-at-a-time); summarization-fail fallback to structured pruning + log + session continues; visible "compacting…" TUI status; SC-2 fixture = synthetic replay seeded from runs/phase2-sc3-capture/.

---

## TUI surfaces (3 bundled)

| Option | Description | Selected |
|--------|-------------|----------|
| pi TUI extension hook | Register Alt+Up/Down via pi's keybind API (if it exposes one) | ✓ |
| Emmy TUI overlay | Wrap pi's TUI with keypress pre-filter | |
| Separate CLI command | `pi-emmy rate last --thumbs-up` after the fact | |

**User's choice:** pi TUI extension hook (with emmy overlay as fallback if pi doesn't expose keybind API — research agent verifies).

| Option | Description | Selected |
|--------|-------------|----------|
| Most-recent completed turn | Always rate the last completed turn | ✓ |
| User-selected turn | Cursor up/down to select a turn, then Alt+Up/Down | |
| Both — last turn default, selection override | Default most-recent; selected turn overrides | |

**User's choice:** Most-recent completed turn.

| Option | Description | Selected |
|--------|-------------|----------|
| vLLM /metrics + nvidia-smi subprocess | Prom endpoint + 1s nvidia-smi poll | ✓ |
| NVML bindings + vLLM /metrics | In-process NVML via FFI + /metrics | |
| vLLM /metrics only; skip GPU% | One data source, no GPU% field | |

**User's choice:** vLLM /metrics + nvidia-smi subprocess.

| Option | Description | Selected |
|--------|-------------|----------|
| Loopback + web_fetch-allowlist | Green if all tools in loopback set OR web_fetch allowlist | ✓ |
| Loopback-only; web_fetch always red | Any web_fetch enabled flips badge red | |
| Boot-audit-only; runtime calls not tracked | One audit at boot; no runtime tracking | |

**User's choice:** Loopback + web_fetch-allowlist.

| Option | Description | Selected |
|--------|-------------|----------|
| More questions | JSONL schema location, --export-hf shape, red-state UX, spec-accept% placeholder | |
| Next: write context | Defaults to Claude's Discretion | ✓ |

**User's choice:** Next: write context. Claude's Discretion fills: feedback JSONL at `~/.emmy/telemetry/feedback.jsonl`; `pi-emmy --export-hf <dir>`; red-state = warn-and-continue; spec-accept% shows `-` until Phase 6.

---

## Claude's Discretion

- D-09: Langfuse Docker images digest-pinned + cached in local Docker registry for air-gap CI (mirrors Phase 1 NGC vLLM pattern)
- D-10: `profile.{id,version,hash}` on every OTel span (SC-1 verbatim)
- D-16: Compaction summarization-failure fallback = structured pruning + log + session continues
- D-17: Visible "compacting N turns…" TUI status during summarization round-trip
- D-24: Graceful-degrade on metrics 500 or nvidia-smi failure (last-good + ? for 3 failures, then blank)
- D-28: Red-state offline-OK = warn-and-continue (banner + red badge, not session block)
- Event-stream schema shape for runs/<session>/events.jsonl — planner aligns with ARCHITECTURE.md §7
- Session-ID scheme (ISO timestamp + profile-hash prefix recommended)
- nvidia-smi query granularity + spec-accept% placeholder handling
- HF exporter provenance manifest

## Deferred Ideas

- User-selected turn ratings (revisit if corpus shows need)
- Thumbs-down modal vs inline free-text (planner picks one)
- `--export-hf` consent/redaction flow (Phase 7)
- Prompt-injection runtime detection (still Phase 3+ deferred)
- Sub-agent observability (Phase 4 with HARNESS-08)
- Alt-combo keybind fallback cascade (if pi lacks public keybind API)
- Langfuse prompt management + dataset UI features (Phase 5 or 7)
- Proactive tool-result truncation before assembly (Phase 4+)
- Second-model summarizer (Phase 4/5 if surfaced)
- npm publish of `@emmy/*` (Phase 7)
- Session replay UI (Phase 5 eval is first consumer)

---

*Phase 3 discussion complete 2026-04-21 — all 4 areas covered, all recommended options accepted; non-trivial sub-decisions documented to Claude's Discretion with rationale.*
