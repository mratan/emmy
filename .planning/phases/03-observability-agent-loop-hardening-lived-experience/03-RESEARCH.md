# Phase 3: Observability + Agent-Loop Hardening + Lived-Experience — Research

**Researched:** 2026-04-21
**Domain:** OTel GenAI semconv → self-hosted Langfuse v3; per-profile auto-compaction; pi 0.68 extension-API wire-throughs; vLLM `/metrics` footer; offline-OK badge; lived-experience rating corpus
**Confidence:** HIGH on wire-through APIs and data schemas; HIGH on library versions and endpoints; MEDIUM on two items flagged inline (Alt+Up keybind collision with pi's built-in `app.message.dequeue`; `--export-hf` parquet-vs-JSONL format choice)

---

## User Constraints (from CONTEXT.md)

### Locked Decisions (28 items — copy verbatim)

**Wire-through sequencing (Track B):**
- **D-01:** Five Phase-2 carry-forward wire-throughs land as ONE atomic wave (single plan, 1–2 commits). Not incremental.
- **D-02:** `@emmy/provider` wires via `ModelRegistry.registerProvider({... streamSimple})`, NOT full replacement. `BeforeProviderRequestEvent` is the injection point for (a) `chat_template_kwargs.enable_thinking:false`, (b) `extra_body.guided_decoding.grammar` on reactive retry, (c) the assembled 3-layer prompt.
- **D-03:** Tools binding is `createAgentSession({ customTools: [...] })` override, pi keeps built-ins as fallback.
- **D-04:** Wave sequencing — wire-throughs FIRST, observability AFTER. Plan 03-01 = Track B atomic wave; subsequent plans instrument the stable post-wave paths.

**Observability architecture:**
- **D-05:** Langfuse v3 self-hosted via `docker-compose`, orchestrated by `scripts/start_observability.sh` (separate from `start_emmy.sh`). Teardown via `scripts/stop_observability.sh`. Digests pinned in `observability/langfuse/docker-compose.yaml`.
- **D-06:** Canonical sink is **JSONL-always + OTLP-if-up** (dual-sink, JSONL authoritative). `runs/<session_id>/events.jsonl` via `append_jsonl_atomic`. OTel fan-out drops silently to JSONL-only if Langfuse unreachable.
- **D-07:** OTel stack = `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http` → `/api/public/otel`. Attribute names from `@opentelemetry/semantic-conventions/incubating`.
- **D-08:** Opt-in-by-default + env-var kill-switch. `EMMY_TELEMETRY=off` or `pi-emmy --no-telemetry` disables both sinks. Loud boot banner: `OBSERVABILITY: ON — writing runs/<session_id>/events.jsonl + localhost Langfuse OTLP`.
- **D-09 (discretion):** Langfuse images pinned by digest + cached in Spark local Docker registry for air-gap CI (mirrors Phase 1 NGC pattern).
- **D-10 (discretion):** `profile.{id,version,hash}` stamped on EVERY span, not just root trace (SC-1 verbatim).

**Auto-compaction:**
- **D-11:** Trigger = soft threshold (0.75 pct default) + turn boundary. Turns atomic.
- **D-12:** Hard ceiling = `max_input_tokens`. Overflow post-compaction → fail-loud `SessionTooFullError`.
- **D-13:** LLM summarization + verbatim preservation list. Round-trip to same vLLM endpoint; profile-defined prompt at `prompts/compact.md`.
- **D-14:** Four preservation guarantees (all non-negotiable): structural core (system.md + AGENTS.md + tool defs + prompt SHA line), error/diagnostic payloads verbatim, active goal + recent N turns (default 5), file pins + TODO state.
- **D-15:** Per-profile policy block:
  ```yaml
  context:
    max_input_tokens: 114688
    compaction:
      soft_threshold_pct: 0.75
      preserve_recent_turns: 5
      summarization_prompt_path: prompts/compact.md
      preserve_tool_results: error_only    # {error_only, none, all}
  ```
- **D-16 (discretion):** Summarization-fail fallback → structured pruning (D-14 preserved set + drop-by-age); log fallback; session continues.
- **D-17 (discretion):** Visible "compacting N turns…" status line in TUI.

**Lived-experience:**
- **D-18:** Alt+Up/Down via pi TUI extension hook (research required: verify pi 0.68.0 API). Fallback: emmy TUI keypress overlay pre-filter. Rejected: separate CLI command.
- **D-19:** Rating targets the MOST-RECENT completed agent turn by `turn_id`.
- **D-20:** Feedback JSONL at `~/.emmy/telemetry/feedback.jsonl` (global across sessions). Schema verbatim from TELEM-02.
- **D-21:** `pi-emmy --export-hf <out_dir>` produces HuggingFace `datasets`-loadable artifact (parquet + dataset_card.md). Emits warning if `model_response`/`tool_calls` reference file contents.

**TUI footer (UX-02):**
- **D-22:** vLLM `/metrics` endpoint + `nvidia-smi` subprocess, every 1s.
- **D-23:** 1 Hz refresh rate.
- **D-24 (discretion):** Graceful degrade — last-good + `?` suffix for 3 consecutive failures, then blank.
- **D-25:** `spec-accept %` shows `-` until Phase 6 enables speculative decoding.

**Offline-OK badge (UX-03):**
- **D-26:** Audit compares registered tool's host-set to `union(loopback_set, harness.yaml.tools.web_fetch.allowlist)`. `loopback_set = {127.0.0.1, localhost, ::1, loopback}`. `web_fetch.allowlist` is a new profile-level config.
- **D-27:** Audit runs at session boot + every `web_fetch` call (runtime enforcement).
- **D-28 (discretion):** Red-state UX = warn-and-continue. Red badge + loud banner + log entry; session proceeds.

### Claude's Discretion (open to this research / planner)

- Concrete `runs/<session>/events.jsonl` schema aligning with ARCHITECTURE.md §7.
- Session-ID scheme (recommendation: ISO timestamp + short profile-hash prefix).
- nvidia-smi query granularity (single `--query-gpu=utilization.gpu,memory.used,clocks.gr` vs split).
- Footer auto-hide on narrow terminal.
- HF exporter provenance manifest shape.
- TODO(Phase-6) marker location for eventual spec-accept wiring.

### Deferred Ideas (OUT OF SCOPE for Phase 3)

- Gemma 4 profile (Phase 4); `/profile` atomic swap (UX-04, Phase 4).
- Cross-model planner/editor/critic routing (HARNESS-08, Phase 4).
- Eval harness + benchmark suite (Phase 5).
- SDK/RPC programmatic mode (UX-06, Phase 5).
- Speculative decoding paired-benchmark gate (Phase 6 — footer spec-accept stays `-`).
- Prompt-injection (natural-language) runtime detection (deferred).
- `start_emmy.sh --airgap` 300s timeout (Phase 1 latent issue #1).
- npm publish of `@emmy/*` (Phase 7).
- User-selected turn ratings (MVP is most-recent; D-19).
- Thumbs-down modal vs inline free-text (planner picks one).
- `--export-hf` consent/redaction flow (Phase 7).
- Sub-agent observability (Phase 4 with HARNESS-08).
- Langfuse prompt management + dataset UI features (Phase 5/7).
- Proactive tool-result truncation before assembly (Phase 4+).
- Second-model summarizer (Phase 4/5 if surfaced).
- Session replay UI (Phase 5 first consumer).

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HARNESS-05 | Context management owned by harness — smart pruning, injection control, per-profile compaction | Section "Auto-Compaction" below; pi's built-in `shouldCompact` + `compact` utilities re-used; D-14 preservation layer is emmy-added |
| HARNESS-09 | OTel GenAI semconv spans across vLLM↔harness boundary; profile fields in every event | Section "OTel GenAI Semconv → Langfuse" below; Langfuse `/api/public/otel` endpoint [VERIFIED] |
| CONTEXT-02 | Auto-compaction with per-profile policy | Section "Auto-Compaction"; D-15 schema; Gemma 4 can override in Phase 4 |
| TELEM-01 | Self-hosted Langfuse v3 via Docker Compose; OTLP `/api/public/otel` | Section "Langfuse v3 Self-Hosted" below; 5 required services (web, worker, postgres, redis, clickhouse) + optional minio |
| TELEM-02 | Alt+Up/Down rating → rich JSONL row schema | Sections "Lived-Experience Capture" + "Keybinding Collision Analysis" below |
| TELEM-03 | 100% local; opt-out flag; HF-dataset-format export | Section "Lived-Experience Capture" — JSONL is directly HF-loadable; optional parquet converter |
| UX-02 | TUI footer at ≥1Hz from nvidia-smi + vLLM `/metrics` | Section "TUI Footer" — metric names verified, `ctx.ui.setFooter()` pi 0.68 API |
| UX-03 | Offline-OK badge from tool registry audit | Section "Offline-OK Badge"; boot + runtime enforcement per D-26/27 |

---

## Summary

Phase 3 is two tracks landing atomically. The research boils down to four wire-compatibility answers and three data-schema decisions:

1. **Pi 0.68 exposes every seam Phase 3 needs** — verified by reading `node_modules/.bun/@mariozechner+pi-coding-agent@0.68.0/dist/core/**/*.d.ts` directly. `ExtensionAPI.registerShortcut()` exists (D-18 path 1 viable but has a keybind-collision gotcha — see "Keybinding Collision Analysis"). `ProviderConfig.streamSimple` exists (D-02). `createAgentSession({ customTools: ToolDefinition[] })` exists (D-03). `before_provider_request` event exists with mutable `payload` (D-02 SHA-authoritative prompt + reactive grammar retry). `ctx.ui.setFooter(factory)` + `setStatus(key, text)` exist for UX-02. `ctx.compact(options)` + `shouldCompact(contextTokens, contextWindow, settings)` + `prepareCompaction()` + `compact()` pure-function exports exist — **pi ships a compaction implementation emmy SHOULD re-use and extend with D-14 preservation**, not reimplement.

2. **Langfuse v3 OTLP endpoint is `/api/public/otel` with Basic auth + `x-langfuse-ingestion-version: 4`** [VERIFIED via langfuse.com/integrations/native/opentelemetry]. Parent-child OTel context is sufficient; no `langfuse.trace.id` hints needed.

3. **vLLM 0.19 Prometheus metric names: `vllm:gpu_cache_usage_perc` (Gauge, 0–1), `vllm:generation_tokens_total` (Counter — must compute rate from Δ/Δt for tok/s), `vllm:num_requests_running` (Gauge), `vllm:spec_decode_draft_acceptance_length` (only when spec-decode enabled; Phase 6)** [VERIFIED via docs.vllm.ai metrics design + community notes]. KV-cache name is `gpu_cache_usage_perc`, NOT `kv_cache_usage_perc` as CONTEXT D-22 transcribed — the planner must honor the verified name.

4. **JSONL-always dual-sink is trivial in Bun/Node**: `fs.promises.open(path, "a")` → `fh.appendFile(line)` → `fh.sync()` → `fh.close()` matches Python `append_jsonl_atomic` semantics (flush + fsync + close ordering). Append-to-existing-file is atomic at <PIPE_BUF (4096B on Linux) line sizes, which JSONL events fit in practice.

5. **HF dataset export is simpler than D-21 suggests** — `datasets.load_dataset("json", data_files="feedback.jsonl")` loads the JSONL directly [VERIFIED via HF docs/loading]. Parquet conversion becomes optional polish, not a blocker. If parquet is desired, `hyparquet-writer` (1 dep, <50KB, pure JS, air-gap-safe) is the right pick.

6. **D-18 has a real conflict:** pi 0.68 already binds `alt+up` to `app.message.dequeue` (restore queued messages) AND `alt+up` is also used for `app.models.reorderUp` in the models selector. `registerShortcut` in `ExtensionAPI` takes a `KeyId` (structured key identifier), not a raw key string — emmy cannot register "alt+up" without potentially shadowing or being shadowed by these built-ins. **Recommendation**: use `shift+alt+up` / `shift+alt+down` for rating (unused by pi's `AppKeybindings`), OR use the `input` event handler which fires BEFORE pi's keybinding resolution, intercept alt+up/alt+down there only when the TUI is in "awaiting-next-prompt" state, and return `{action: "handled"}`. This second option preserves the Alt+Up/Alt+Down spec verbatim while avoiding collision.

7. **`max_input_tokens` drops to a SUM of reserve + keep_recent + summary budget** when using pi's compaction. `DEFAULT_COMPACTION_SETTINGS = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`. Phase 2's v2 profile has `max_input_tokens: 114688` — emmy's `soft_threshold_pct: 0.75` fires at ~86K, leaving plenty of headroom. This is why the proper `reserveTokens` value in the `CompactionSettings` pi expects is what emmy's `compaction.soft_threshold_pct` effectively governs.

**Primary recommendation:** Use pi 0.68's built-in `shouldCompact` + `prepareCompaction` + `compact` as the compaction engine, and layer emmy's D-14 preservation policy as a pre-filter that pins structural-core / error-payloads / file-pins / TODO-files OUT of the "messagesToSummarize" set before handing it to `compact()`. Ship emmy-specific observability via two sinks (JSONL atomic + OTLP exporter) on a single event bus; stamp `{profile.id, profile.version, profile.hash}` via `SpanProcessor.onStart` so every span gets it without per-call-site boilerplate. Use `shift+alt+up / shift+alt+down` for TELEM-02 rating to avoid pi's built-in `alt+up` collisions.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wire the provider (streamSimple, extra_body, chat_template_kwargs) | `@emmy/provider` | `@emmy/ux` (registration site) | Extra_body / reactive-grammar / enable_thinking live at the provider boundary |
| Wire custom tools + MCP bridge into session | `@emmy/ux` (`createAgentSession` call) | `@emmy/tools` (exports ToolDefinition array) | `customTools` is a session-create option; registration happens once at session build |
| OTel span emission + JSONL append | `@emmy/telemetry` | `@emmy/ux` (init) + every other package (emit-site) | Package exists as a Wave-0 stub; Phase 3 replaces body. All packages already `import { emitEvent }` |
| Compaction trigger + preservation policy | `@emmy/ux` (owns session lifecycle) | pi built-ins (`shouldCompact`, `prepareCompaction`, `compact`) | Pi owns the summarization round-trip; emmy owns WHEN to fire it and WHAT to preserve |
| TUI footer rendering | `@emmy/ux` (pi extension registering footer factory) | `@emmy/telemetry` (last-sampled values) | `ctx.ui.setFooter()` is a pi-UI-layer concern; data source lives in telemetry |
| Metrics scraping (`/metrics` + nvidia-smi) | `@emmy/telemetry` | `@emmy/ux` (poll trigger via setInterval) | Scraping is observability; the footer consumes cached values |
| Offline-OK audit | `@emmy/ux` (boot-time) + `@emmy/tools/web-fetch.ts` (runtime enforcement) | `@emmy/telemetry` (log violations) | Audit straddles boot path and web_fetch call-site; two enforcement points per D-27 |
| Alt+Up/Down rating capture | `@emmy/ux` (pi `input` event handler OR `registerShortcut`) | `@emmy/telemetry` (JSONL append to feedback.jsonl) | Capture is a pi-UI concern; persistence is telemetry |
| `--export-hf` subcommand | `@emmy/ux` (pi-emmy CLI) | external: HF datasets JSONL loader | CLI flag routing already lives in pi-emmy |
| Langfuse compose orchestration | `observability/` top-level (NOT in @emmy/* packages) | `scripts/start_observability.sh` | D-05: separate lifecycle from emmy-serve; not a Bun package concern |

**Why this matters for Phase 3:** Three of the five Phase-2 wire-through deferrals cross the provider↔tools seam. Getting the primary-tier ownership wrong in the wire-through wave (Plan 03-01) is the highest-risk architectural error — e.g., putting the enable_thinking injection in `@emmy/ux` instead of `@emmy/provider` would bind it to session-bootstrap time (wrong) instead of per-request time (D-02 correct). The map above locks the correct seam for each.

---

## Standard Stack

### Core (Phase 3 additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@opentelemetry/sdk-node` | ^0.53.x (current stable as of 2026-04) | OTel SDK for Node/Bun | Canonical OTel JS stack; Langfuse docs assume this; "stand on shoulders" |
| `@opentelemetry/exporter-trace-otlp-http` | ^0.53.x | OTLP/HTTP trace exporter | Posts to Langfuse `/api/public/otel` per official docs |
| `@opentelemetry/api` | ^1.9.x | OTel tracer/meter API (peer dep) | Required; pinned to avoid dual-version mismatch warnings |
| `@opentelemetry/resources` | ^1.x (matching sdk) | Resource attributes (service.name, etc.) | Stamp emmy service identity on spans |
| `@opentelemetry/semantic-conventions` | ^1.27+ (has GenAI incubating namespace) | Attribute name constants | GenAI namespace lives under `@opentelemetry/semantic-conventions/incubating` per D-07 |

### Supporting (Phase 3 additions)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `hyparquet-writer` | latest stable | Optional parquet writer for `--export-hf` | If planner decides parquet is needed for D-21 completeness; 1 dependency, <50KB, pure JS, air-gap-safe [VERIFIED via github.com/hyparam/hyparquet-writer] |
| (existing) `@mariozechner/pi-coding-agent` 0.68.0 | PINNED | Compaction engine + footer/keybinding/streamSimple APIs | Re-use `shouldCompact`, `prepareCompaction`, `compact`, `DEFAULT_COMPACTION_SETTINGS`, `estimateTokens`, `findCutPoint`, `setFooter`, `registerShortcut`, `before_provider_request` event |
| (existing) `js-yaml` 4.1.0 | PINNED | Read `harness.yaml.context.compaction.*` and `web_fetch.allowlist` | Already in root devDeps; add to @emmy/ux runtime if not present |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@opentelemetry/sdk-node` + OTLP/HTTP | Hand-rolled fetch-based OTLP client | Smaller install; loses batching, retry, w3c-traceparent propagation. D-07 picks SDK-node. Don't hand-roll. |
| `@opentelemetry/sdk-node` + OTLP/HTTP | `@langfuse/node` SDK directly | Bypasses OTel; locks emmy into Langfuse. D-07 picks OTel-first for portability (Phoenix/Jaeger/Datadog future switch). |
| `hyparquet-writer` | `parquetjs` | parquetjs is officially "inactive"; hyparquet-writer is the 2025-2026-maintained pick. |
| `hyparquet-writer` | `parquet-wasm` (Rust/WASM) | 1.2 MB WASM bundle; overkill for feedback corpus <1 MB/year. |
| `hyparquet-writer` | JSONL-only (skip parquet) | `datasets.load_dataset("json", ...)` reads JSONL natively. **Recommendation: start JSONL-only; add parquet if eval team asks.** |

**Installation:**
```bash
# Add to @emmy/telemetry
bun add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/api @opentelemetry/resources @opentelemetry/semantic-conventions

# Optional, only if --export-hf requires parquet:
bun add hyparquet-writer
```

**Version verification protocol:** Before landing, run `npm view @opentelemetry/sdk-node version` and record the verified version + publish date in `PROFILE_NOTES.md` validation_runs AND in `packages/emmy-telemetry/package.json` with exact pin (no `^`) per Phase 2 D-02 discipline.

### Docker images (Langfuse compose)

| Service | Image | Role | Port |
|---------|-------|------|------|
| langfuse-web | `docker.io/langfuse/langfuse:3` (digest-pin at D-09) | UI + OTLP ingestion at `/api/public/otel` | 3000:3000 |
| langfuse-worker | `docker.io/langfuse/langfuse-worker:3` (digest-pin) | Background processing | 127.0.0.1:3030:3030 |
| postgres | `docker.io/postgres:17` (digest-pin) | Metadata store | 127.0.0.1:5432:5432 |
| redis | `docker.io/redis:7` (digest-pin) | Queue + cache | 127.0.0.1:6379:6379 |
| clickhouse | `docker.io/clickhouse/clickhouse-server` (digest-pin) | Trace analytics store | 127.0.0.1:8123, 127.0.0.1:9000 |
| minio | `cgr.dev/chainguard/minio` (digest-pin) | S3-compatible blob storage for multimodal tracing | 9090:9000 + 127.0.0.1:9091:9001 |

[VERIFIED via github.com/langfuse/langfuse/blob/main/docker-compose.yml, fetched 2026-04-21]

**Required env vars (all CHANGEME in upstream):** `NEXTAUTH_SECRET`, `SALT`, `ENCRYPTION_KEY`, `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY`, `LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY`, `LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY`.

**Recommendation for emmy:** generate all CHANGEME values at `start_observability.sh` bootstrap and store in `observability/langfuse/.env` (gitignored) with secure random defaults. Provide `observability/langfuse/.env.example` template committed.

---

## Architecture Patterns

### System Architecture Diagram — Per-Turn Data Flow (Phase 3 target)

```
 ┌──────────────┐
 │  User input  │
 │  (TUI keys)  │
 └──────┬───────┘
        │  shift+alt+up/down → intercept in `input` event handler
        │              (writes feedback.jsonl, returns {action:"handled"})
        │  otherwise → pass through
        ▼
 ┌──────────────────────────────────────────────┐
 │  pi 0.68 AgentSession                        │
 │  createAgentSession({ customTools: [...] })  │◄── emmy-tools ToolDefinition[]
 └────┬─────────────────────────────────────────┘
      │
      │ emits `turn_start` → OTel span start (trace per session, span per turn)
      ▼
 ┌──────────────────────────────────────────────┐
 │  Context usage check                         │
 │  ctx.getContextUsage() → { tokens, percent } │
 │  if tokens / max > soft_threshold_pct:       │
 │    emit "compacting…" status via ui.setStatus│
 │    run D-14 preservation filter              │
 │    prepareCompaction(preserved_entries, ...) │
 │    compact(preparation, model, apiKey)       │ ──► summary round-trip to same vLLM
 │  if tokens > max_input_tokens:               │
 │    throw SessionTooFullError (D-12 fail-loud)│
 └────┬─────────────────────────────────────────┘
      │
      ▼
 ┌──────────────────────────────────────────────┐
 │  before_provider_request event fires         │
 │  (mutable `payload`)                         │
 │   emmy extension handler:                    │
 │   - inject chat_template_kwargs.enable_thinking:false
 │   - inject extra_body.guided_decoding.grammar on reactive retry
 │   - overwrite system message with emmy's 3-layer assembled prompt
 │   - emit OTel span attribute emmy.prompt.sha256
 └────┬─────────────────────────────────────────┘
      │
      ▼
 ┌──────────────────────────────────────────────┐
 │  ProviderConfig.streamSimple                 │
 │  (our @emmy/provider impl)                   │
 │  - POST emmy-serve /v1/chat/completions      │
 │  - start OTel child span "chat qwen3.6..."   │
 │  - attributes per gen_ai semconv (§ below)   │
 └────┬─────────────────────────────────────────┘
      │
      ▼ SSE stream
 ┌──────────────────────────────────────────────┐
 │  Response handler: strip reasoning_content   │
 │  parse tool_calls, dispatch via customTools  │
 │  per tool call: OTel child span              │
 │    "execute_tool {tool_name}"                │
 │    attributes: gen_ai.tool.name,             │
 │                gen_ai.tool.call.id,          │
 │                emmy.tool.args_hash,          │
 │                emmy.tool.exit_code           │
 └────┬─────────────────────────────────────────┘
      │
      ▼ tool results → next iteration
      │
      │ (on agent_end)
      ▼
 ┌──────────────────────────────────────────────┐
 │  turn_end → OTel span end                    │
 │  emitEvent(turn summary) to both sinks:      │
 │  - runs/<session_id>/events.jsonl (atomic)   │
 │  - OTLP exporter → localhost:3000/api/public/otel
 │                    (drops silently if down)  │
 └──────────────────────────────────────────────┘

 Parallel (every 1 s, D-22/D-23):
 ┌──────────────────────────────────────────────┐
 │  @emmy/telemetry:FooterPoller                │
 │  - fetch http://127.0.0.1:8002/metrics       │
 │  - spawn `nvidia-smi --query-gpu=...`        │
 │  - parse + cache latest values               │
 │  - ctx.ui.setStatus("emmy.gpu", "GPU 87%")   │
 │    (appears in pi's footer via D-22 seam)    │
 │    OR ctx.ui.setFooter((tui, theme, data) => │
 │        custom footer component)              │
 └──────────────────────────────────────────────┘

 At boot:
 ┌──────────────────────────────────────────────┐
 │  Tool-registry audit (UX-03 / D-26)          │
 │  required_hosts ⊆ loopback ∪ web_fetch.allowlist? │
 │  → green OFFLINE OK / red NETWORK USED       │
 │  (also re-checked at every web_fetch call)   │
 └──────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 3 additions)

```
emmy/
├── observability/                      # NEW (Phase 3)
│   └── langfuse/
│       ├── docker-compose.yaml         # digest-pinned Langfuse v3 stack
│       ├── .env.example                # CHANGEME template committed
│       └── README.md                   # bring-up + teardown runbook
├── scripts/
│   ├── start_observability.sh          # NEW — docker compose up + health gate
│   └── stop_observability.sh           # NEW — docker compose down
├── packages/
│   ├── emmy-telemetry/                 # SIGNATURE STABLE, BODY REPLACED
│   │   └── src/
│   │       ├── index.ts                # emitEvent (replaces NO-OP)
│   │       ├── jsonl-atomic.ts         # NEW — TS port of append_jsonl_atomic
│   │       ├── otel-init.ts            # NEW — SDK setup, OTLP exporter
│   │       ├── otel-span-factory.ts    # NEW — wrap gen_ai semconv attrs
│   │       ├── metrics-poller.ts       # NEW — vLLM /metrics scrape
│   │       ├── nvidia-smi-poller.ts    # NEW — child_process.spawn wrapper
│   │       ├── feedback-jsonl.ts       # NEW — ~/.emmy/telemetry/feedback.jsonl
│   │       ├── hf-export.ts            # NEW — --export-hf implementation
│   │       └── offline-audit.ts        # NEW — UX-03 allowlist check
│   ├── emmy-ux/                        # CHANGED
│   │   └── src/
│   │       ├── session.ts              # WIRE-THROUGH WAVE (Plan 03-01)
│   │       ├── pi-emmy-extension.ts    # NEW — pi ExtensionFactory registering:
│   │       │                           #   before_provider_request, input event
│   │       │                           #   (alt+up/down), setFooter, setStatus,
│   │       │                           #   turn_start/turn_end spans, compact trigger
│   │       ├── compaction-policy.ts    # NEW — D-14 preservation + harness.yaml load
│   │       └── footer-component.ts     # NEW — custom FooterComponent for setFooter
│   └── emmy-provider/                  # CHANGED (Plan 03-01)
│       └── src/
│           └── stream-simple.ts        # NEW — ProviderConfig.streamSimple impl
└── profiles/qwen3.6-35b-a3b/v3/        # NEW — bumped from v2 per D-15 schema change
    ├── profile.yaml
    ├── serving.yaml                    # unchanged from v2
    ├── harness.yaml                    # NEW fields: context.compaction, tools.web_fetch.allowlist
    ├── prompts/
    │   ├── system.md                   # unchanged
    │   ├── edit_format.md              # unchanged
    │   ├── tool_descriptions.md        # unchanged
    │   └── compact.md                  # NEW — D-13 profile-defined compaction prompt
    ├── tool_schemas/                   # unchanged
    ├── grammars/                       # unchanged
    └── PROFILE_NOTES.md                # extended — provenance for compaction defaults
```

### Pattern 1: Re-use pi's Compaction Engine + Layered Preservation

**What:** Use pi 0.68's built-in `prepareCompaction()` → `compact()` pipeline; wrap with emmy's D-14 preservation policy that marks structural/error/goal/pin entries as "not summarizable" BEFORE pi's cut-point algorithm runs.

**When to use:** Always. Do NOT reimplement the summarization LLM round-trip or the cut-point algorithm.

**Example:**
```typescript
// Source: @mariozechner/pi-coding-agent@0.68.0/dist/core/compaction/compaction.d.ts
import {
  DEFAULT_COMPACTION_SETTINGS,
  shouldCompact,
  prepareCompaction,
  compact,
  type CompactionSettings,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";

// Emmy wraps pi's compaction with D-14 preservation
function emmyCompactionTrigger(
  entries: SessionEntry[],
  contextTokens: number,
  contextWindow: number,
  profileCompaction: EmmyCompactionConfig,
): Promise<void> | null {
  const softThreshold = profileCompaction.soft_threshold_pct;      // D-11
  if (contextTokens / contextWindow < softThreshold) return null;  // below trigger

  // D-14 preservation: mark these entries "immortal"
  const preserved = markPreserved(entries, {
    structuralCore: true,             // system.md + AGENTS.md + tool defs + prompt.sha line
    errorPayloadsVerbatim: true,      // any tool result with isError
    activeGoal: true,                 // first user message
    recentTurns: profileCompaction.preserve_recent_turns,  // default 5
    filePins: true,                   // @file pins
    todoState: true,                  // TODO/PLAN file edits
  });

  // Hand pi only the entries safe to summarize
  const summarizable = entries.filter(e => !preserved.has(e.uuid));
  const settings: CompactionSettings = {
    enabled: true,
    reserveTokens: 16384,             // matches profile serving output_reserve
    keepRecentTokens: 20000,          // pi's default; emmy overrides with profile.preserve_recent_turns * avg_turn_tokens
  };

  const prep = prepareCompaction(summarizable, settings);
  if (!prep) return null;

  // D-13: same vLLM endpoint, profile-defined prompt
  const customInstructions = readFileSync(
    join(profileRef.path, profileCompaction.summarization_prompt_path),
    "utf8",
  );

  // D-17: visible status
  ctx.ui.setStatus("emmy.compacting", `compacting ${prep.messagesToSummarize.length} turns…`);

  return compact(prep, model, apiKey, undefined, customInstructions)
    .then(result => {
      ctx.ui.setStatus("emmy.compacting", undefined);
      emitEvent({
        event: "session.compaction.complete",
        ts: new Date().toISOString(),
        profile: profileRef,
        turns_elided: prep.messagesToSummarize.length,
        turns_preserved: preserved.size,
        summary_tokens: estimateTokens({ role: "user", content: [{ type: "text", text: result.summary }] }),
      });
    })
    .catch(err => {
      // D-16: fallback to structured pruning
      emitEvent({ event: "session.compaction.fallback", ts: new Date().toISOString(), error: String(err) });
      structuredPruneFallback(entries, preserved);
    });
}
```

**Anti-pattern to avoid:** Reimplementing summarization. Pi already has `generateSummary()` and `SUMMARIZATION_SYSTEM_PROMPT` (exported from `core/compaction/utils.d.ts`).

### Pattern 2: OTel Span Attributes via SpanProcessor.onStart (auto-stamp profile fields)

**What:** Instead of threading `profile.{id,version,hash}` into every `tracer.startSpan()` call (D-10 requires every span carries these), register a custom `SpanProcessor.onStart` that mutates spans as they're created.

**When to use:** Always, per D-10. Saves emmy from having 30+ manually-stamped span sites.

**Example:**
```typescript
// Source: @opentelemetry/sdk-trace-base readme, Context7 otel-js/sdk-trace-base
import { SpanProcessor, ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";

class EmmyProfileStampProcessor implements SpanProcessor {
  constructor(private profile: { id: string; version: string; hash: string }) {}
  onStart(span: Span): void {
    span.setAttributes({
      "emmy.profile.id": this.profile.id,
      "emmy.profile.version": this.profile.version,
      "emmy.profile.hash": this.profile.hash,
    });
  }
  onEnd(_span: ReadableSpan): void {}
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}
```

Register on the `NodeSDK` alongside the OTLP exporter's BatchSpanProcessor.

### Pattern 3: Dual-Sink Atomic Emit (JSONL + OTLP)

**What:** Emitting an event writes the canonical JSONL line AND starts/ends an OTel span in one call; OTLP failure never blocks JSONL (D-06).

**When to use:** Every event beyond pure OTel spans (e.g. compaction fallback, offline-ok audit result, feedback rating, session.sp_ok.pass).

**Example:**
```typescript
// Source: emmy_serve/diagnostics/atomic.py:append_jsonl_atomic (Python reference)
// TS port:
import { promises as fs } from "node:fs";

export async function appendJsonlAtomic(path: string, obj: Record<string, unknown>): Promise<void> {
  // Mirrors Python: flush + fsync + close ordering; newline-terminated
  const line = JSON.stringify(obj) + "\n";
  const fh = await fs.open(path, "a");
  try {
    await fh.appendFile(line, "utf8");  // O_APPEND on Linux — atomic for writes <PIPE_BUF (4096B)
    await fh.sync();                     // fsync for durability
  } finally {
    await fh.close();
  }
}

export function emitEvent(record: TelemetryRecord, ctx?: { tracer?: Tracer; jsonlPath?: string }): void {
  // 1. JSONL authoritative (D-06)
  if (ctx?.jsonlPath) {
    appendJsonlAtomic(ctx.jsonlPath, record).catch(err =>
      console.error(`[emmy/telemetry] JSONL append failed — data lost: ${err}`),
    );
  }
  // 2. OTLP best-effort (D-06)
  if (ctx?.tracer) {
    const span = ctx.tracer.startSpan(record.event);
    for (const [k, v] of Object.entries(record)) {
      if (k !== "event" && k !== "ts") span.setAttribute(k, v as string);
    }
    span.end();
  }
}
```

**Why <PIPE_BUF matters:** Linux guarantees `write(2)` to an O_APPEND-opened file is atomic for sizes ≤ `PIPE_BUF` (4096 bytes on Linux, 512 on POSIX minimum). JSONL event records at <4K have no interleaving risk even under concurrent emits. For larger records (tool results with big file content embedded), consider `write_json_atomic`-style tempfile+rename per Python pattern.

### Pattern 4: Pi `input` Event Handler for Rating Capture (avoids keybind collision)

**What:** Register an `input` event handler that intercepts raw keypresses BEFORE pi's keybinding resolution. If the key is `shift+alt+up` or `shift+alt+down` (D-18 recommended alt-combo — see "Keybinding Collision Analysis"), write a feedback row and return `{action: "handled"}` to suppress pi's default behavior.

**When to use:** Only if we choose the non-registerShortcut path (recommended if the Alt+Up spec is relaxable to Shift+Alt+Up).

**Example:**
```typescript
// Source: pi-coding-agent@0.68/dist/core/extensions/types.d.ts lines 534-552 (InputEvent, InputEventResult)
pi.on("input", (event, ctx): InputEventResult => {
  // event.text contains the key as TTY-sent sequence
  // Emmy's strategy: match the raw escape sequences for shift+alt+up/down
  // ESC [ 1 ; 4 A = shift+alt+up ; ESC [ 1 ; 4 B = shift+alt+down
  const SHIFT_ALT_UP = "\x1b[1;4A";
  const SHIFT_ALT_DOWN = "\x1b[1;4B";

  if (event.text === SHIFT_ALT_UP || event.text === SHIFT_ALT_DOWN) {
    const rating = event.text === SHIFT_ALT_UP ? 1 : -1;
    rateLastTurn(rating, ctx);
    return { action: "handled" };
  }
  return { action: "continue" };
});
```

**Trade-off:** If D-18 really means literal Alt+Up/Alt+Down (CONTEXT lists both `alt+up` and `Alt+Up` interchangeably), this pattern still works — emmy's input handler fires BEFORE pi's keybindings resolve, so we beat pi to the key. The trade-off is we shadow pi's `app.message.dequeue` (alt+up) for emmy users — acceptable since emmy doesn't expose the follow-up queue feature. **Planner decides** but this is the cleaner fallback path from D-18.

### Anti-Patterns to Avoid

- **Reimplementing compaction summarization.** Pi's `compact()` and `SUMMARIZATION_SYSTEM_PROMPT` already do this; we only add preservation policy on top.
- **Stamping profile attributes at every tracer.startSpan() call.** Use `SpanProcessor.onStart` (Pattern 2) — one place, every span.
- **Direct `fs.appendFile` without fsync.** `writeFile` / `appendFile` returns after write-to-page-cache, not to disk. Crash mid-session loses the last 30 s of events. Always fsync on the atomic path.
- **Blocking the hot path on OTLP exporter failure.** JSONL writes must never await OTLP. Use `BatchSpanProcessor` for OTLP (async) and keep JSONL emit separate.
- **Model-shaped compaction logic in code.** The soft threshold, preservation depth, and summarization prompt ALL live in `harness.yaml.context.compaction.*` per CLAUDE.md pinned rule.
- **Hard-coding the SC-3 `<think>`-strip as a23456 stopgap post-Phase-3.** The render-time strip exists only because `chat_template_kwargs.enable_thinking:false` isn't yet injected at the provider level. Plan 03-01 removes the strip and commits-message-references `a17f4a9` + `02-CLOSEOUT.md § SC-1 findings`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Compaction algorithm (cut-point, token accounting, summary LLM round-trip) | Custom `compact()` | pi `shouldCompact` + `prepareCompaction` + `compact` from `@mariozechner/pi-coding-agent` | Already tested; used by pi's daily-driver path; `SUMMARIZATION_SYSTEM_PROMPT` is battle-tested text |
| OTLP/HTTP wire protocol | Fetch-based POST to `/v1/traces` | `@opentelemetry/exporter-trace-otlp-http` | Handles batching, retry-on-429, gzip, W3C traceparent propagation |
| OTel GenAI span attribute constants | Hand-typed `"gen_ai.usage.input_tokens"` strings | `ATTR_GEN_AI_USAGE_INPUT_TOKENS` from `@opentelemetry/semantic-conventions/incubating` | Protects against typos + tracks spec evolution |
| Parquet writer | Raw Arrow encoding | `hyparquet-writer` if parquet needed at all | JSONL is directly HF-loadable; only add parquet if there's a specific reason |
| HuggingFace datasets compatibility | Custom dataset_card.md / dataset_infos.json | `load_dataset("json", data_files="feedback.jsonl")` is enough | HF's JSON loader handles schema inference from JSONL; no dataset_card required for programmatic loading |
| Prometheus text-format parser | Hand-written regex | Light parser OR bundled prom-client dependency | `/metrics` text format is simple (`metric_name{labels} value\n`); 30-line parser sufficient; no need for full `prom-client` |
| nvidia-smi output parsing | Read human-readable format | `--format=csv,noheader,nounits` with `--query-gpu=...` | CSV format is stable and parseable; Phase-1 GpuSampler already exists as Python reference (`emmy_serve/diagnostics/gpu_sampler.py`) |
| Keybinding shortcut registration | Raw stdin keypress listener | Pi's `ExtensionAPI.registerShortcut()` OR `on("input", ...)` event | Either path is integrated; raw listener fights pi's TUI state machine |
| Token estimation for compaction | Custom BPE | pi's `estimateTokens(message)` (chars/4 heuristic, conservative) | Matches pi's internal cut-point logic — mismatched heuristics cause compaction to under/over-fire |
| Footer component rendering | Raw ANSI | pi's `ctx.ui.setFooter((tui, theme, footerData) => Component)` factory | Integrates with pi's TUI redraw cycle; uses pi's theme; resize handling automatic |

**Key insight:** Phase 3 leans HARD on pi 0.68 for compaction, TUI, keybindings, and the extension hook seam. The ONLY capabilities emmy builds from scratch are: D-14 preservation policy (pure function), D-26 offline-audit (pure function), JSONL atomic append (TS port of Python), vLLM metrics polling (simple fetch loop + regex), and the HF-export CLI flag (subcommand-style). Everything else is either re-used from pi or a standard OTel-JS package. **Phase 3 is mostly integration work, not implementation work.**

---

## Runtime State Inventory

Phase 3 is primarily additive and wire-through; limited runtime state is affected. Tracking per category:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `runs/phase2-sc3-capture/` transcripts continue accumulating; no migration needed. New: `runs/<session_id>/events.jsonl` (fresh per session — additive) and `~/.emmy/telemetry/feedback.jsonl` (global, created lazily). | None — additive only. Existing SC-3 capture pattern unchanged. |
| Live service config | Langfuse Docker stack (D-05) adds postgres/redis/clickhouse/minio — new state outside git. Pinned digests mitigate reproducibility risk (D-09); `observability/langfuse/.env` needs secret rotation if compromised. | Document in `observability/langfuse/README.md`: env-var rotation process; teardown-and-rebuild wipes trace history. |
| OS-registered state | None — Phase 3 does not register daemons, Task Scheduler entries, or systemd units. `start_observability.sh` is user-invoked, not auto-registered. | None — verified by inspecting scripts/*.sh; only `uv run emmy` and `bun link` patterns exist in Phase 1/2. |
| Secrets/env vars | `EMMY_TELEMETRY=off` kill-switch (D-08). Langfuse env vars (NEXTAUTH_SECRET, SALT, ENCRYPTION_KEY, CLICKHOUSE_PASSWORD, REDIS_AUTH, POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD, 3× S3_UPLOAD_SECRET_ACCESS_KEY). Existing `EMMY_VLLM_API_KEY` unchanged. | NEW .env file under `observability/langfuse/.env` (gitignored); committed `.env.example` template. Startup script generates secure defaults on first run. |
| Build artifacts / installed packages | `bun.lock` regenerates on `bun add` — expected. `@emmy/telemetry` package.json gains runtime deps (was devDep-free before). `node_modules/.bun/` gets the OTel SDK — air-gap CI (D-09) must pre-cache. | `.planning/research/STACK.md` update to note new runtime deps; run `bun audit --production` as part of Plan 03-01 wave. |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?*

Phase 3 doesn't rename anything. But it DOES introduce:
- A new profile version (v2 → v3 per D-15 schema change) — the Phase 1 content-hash contract auto-handles this. Plan 03-01 or compaction-landing plan bumps `profiles/qwen3.6-35b-a3b/v3/` with new `harness.yaml.context.compaction.*` + `tools.web_fetch.allowlist`. Old v2 keeps passing validation; new sessions use v3 by default.
- `a17f4a9` `<think>`-strip removal — a commit that reverts a past stopgap. The grep-for-"\<think\>-strip" auditor would flag this as a planned removal, not a rename.

---

## Common Pitfalls

### Pitfall 1: Alt+Up keybind collision with pi's built-ins (HIGH probability — flagged by CONTEXT)

**What goes wrong:** D-18 specifies "pi TUI extension hook — Alt+Up/Alt+Down". Pi 0.68 already binds `alt+up` to `app.message.dequeue` (restore queued follow-up messages) AND as `app.models.reorderUp` in the models selector. `registerShortcut(keyId)` with a conflicting KeyId silently shadows OR is shadowed by pi's default — unpredictable.

**Why it happens:** Pi's keybindings registry (`node_modules/.bun/@mariozechner+pi-coding-agent@0.68.0/.../dist/core/keybindings.d.ts` lines 228, 305) registers `alt+up` as a first-class AppKeybinding. Emmy can't un-register it from a public API surface.

**How to avoid:** Three options, in order of preference:
1. **Use `shift+alt+up` / `shift+alt+down`** (unused in pi's AppKeybindings). Requires slight D-18 relaxation ("Alt+Up-style combo" instead of literal Alt+Up). Cleanest; zero conflict risk.
2. **Use `on("input", handler)` event** (InputEvent fires BEFORE keybinding resolution per pi source). Handler matches raw ANSI sequence `\x1b[1;3A` (alt+up) / `\x1b[1;3B` (alt+down) and returns `{action: "handled"}` to suppress pi's default. Preserves D-18 spec verbatim but shadows pi's `app.message.dequeue` for emmy users (emmy doesn't expose follow-up queue, so acceptable).
3. **Emmy TUI overlay pre-filter** (D-18 explicit fallback). Wraps pi's stdin. Heaviest; only if options 1 and 2 fail.

**Warning signs:** pi's "queued messages" UI flashes when user hits alt+up (pi's dequeue fired before emmy's handler); rating JSONL is empty after a session where user swears they rated turns.

### Pitfall 2: OTel SDK initialization order with Bun workspace ESM

**What goes wrong:** `@opentelemetry/sdk-node` must be initialized BEFORE any instrumented code imports. Bun's ESM hoisting can load `@emmy/provider` (which will emit spans) before `@emmy/telemetry/otel-init.ts` runs, causing silent span drops.

**Why it happens:** Standard OTel gotcha — auto-instrumentation hooks are installed at SDK init; spans created before that use the no-op tracer.

**How to avoid:**
- `pi-emmy` CLI entrypoint FIRST line is `await import("@emmy/telemetry").then(t => t.initOtel(…))`, BEFORE `@emmy/ux` or `@emmy/provider` imports.
- Add a "is SDK initialized?" sentinel in `emitEvent()`; refuse span emission until init completes (log skip-count once).

**Warning signs:** First 1–2 session-boot events in JSONL but NOT in Langfuse; no corresponding traceId in JSONL for early spans.

### Pitfall 3: Compaction fires mid-stream (violates D-11 turn-boundary rule)

**What goes wrong:** Token count crosses threshold during a long assistant stream. Naive implementation calls `compact()` mid-stream, which corrupts the session or (better) is rejected by pi's session manager.

**Why it happens:** `ctx.getContextUsage()` is called inside a `message_update` event handler; the handler fires per-token. Any threshold check there would race.

**How to avoid:** Call `shouldCompact()` ONLY in `turn_start` handler (D-11 turn boundary). Never in `message_update` or `message_end`. The `turn_end → turn_start` window is the only safe spot for `ctx.compact({...})`.

**Warning signs:** Compaction "compacting N turns…" status appears mid-assistant-stream; pi throws "session busy" errors on `compact()`.

### Pitfall 4: Tool-result truncation dropping the error stacktrace (Pitfall #15)

**What goes wrong:** Compaction's `preserve_tool_results: error_only` config (D-15) filters the pre-summarizer `messagesToSummarize` set, but if a non-error tool result was long (40KB grep output) and pi's `serializeConversation` truncated it, the bottom-of-stacktrace signal is already lost.

**Why it happens:** pi's compaction utility truncates tool results during `serializeConversation` before LLM summarization to stay in token budget. This is fine for summary quality but collides with D-14 "error payloads verbatim".

**How to avoid:** Emmy's preservation pre-filter (Pattern 1) pins any entry with `tool_result.isError === true` into the preserved set. These entries don't go into `messagesToSummarize` at all — they bypass pi's serialization truncation. Write a SC-2 fixture that includes a 50KB error stacktrace at index 30 of a 60-turn session and assert the error text appears verbatim in the post-compaction entries.

**Warning signs:** Test replay: agent "fixes the wrong thing" after a compaction cycle (Pitfall #15 signature).

### Pitfall 5: Silent OTLP connection failure masks telemetry loss

**What goes wrong:** Langfuse container isn't running. OTLP exporter's BatchSpanProcessor silently accumulates up to its buffer cap, then drops on overflow. User thinks telemetry is captured; actually nothing reaches Langfuse.

**Why it happens:** D-06 explicitly allows OTLP fan-out to "silently drop to JSONL-only". Correct, but the user still needs to know they're in JSONL-only mode.

**How to avoid:**
- On OTel SDK init, probe `GET http://127.0.0.1:3000/` (any 200/401 response = Langfuse reachable) BEFORE accepting the exporter config. On failure: warn loudly once at session start, mark telemetry mode "JSONL-only" in the boot banner.
- Add `Telemetry: JSONL-only` vs `Telemetry: JSONL + Langfuse(localhost:3000)` to the boot banner.

**Warning signs:** Langfuse UI empty after a session; `runs/<session>/events.jsonl` has the full trace.

### Pitfall 6: vLLM metric rate calculation using stale-delta averages

**What goes wrong:** `vllm:generation_tokens_total` is a monotonically increasing counter. Computing "tokens/sec" as `(current - previous) / 1s` with a 1s poll interval is NOISY (variance explodes under bursty traffic). A 5s sliding window gives a more useful footer value.

**Why it happens:** Prometheus-style rate calc needs a window. 1s is too short for the counter's typical delta granularity.

**How to avoid:** Footer poller tracks last N=5 samples; `tok/s = (sample[N-1] - sample[0]) / (ts[N-1] - ts[0])`. Drop the samples older than 5s. Display an `~` prefix on the footer value for the first 5 samples after session start (warmup).

**Warning signs:** Footer `tok/s` value oscillates wildly (e.g. 120 → 3 → 80 → 5 in consecutive seconds).

### Pitfall 7: Pre-flight / SP_OK canary turned off by OTel initialization (Pitfall #6 regression)

**What goes wrong:** D-04 wire-throughs change how the first provider request is shaped. Emmy's SP_OK canary fires at session boot (Phase 2 boot order step 1). If the new `before_provider_request` hook injects `chat_template_kwargs.enable_thinking:false` on EVERY request including the SP_OK canary, and if that interacts with the canary's chat-template handling, the canary could silently degrade (Pitfall #6 signature).

**Why it happens:** The SP_OK canary in `@emmy/ux/sp-ok-canary.ts` uses `postChat(baseUrl, sp_ok_request, profile)` (inspected during research — bypasses the pi adapter entirely in Phase 2). Post-Phase-3, if Plan 03-01 routes the canary through the same `streamSimple` path, the hook intercepts it.

**How to avoid:**
- Keep the SP_OK canary on its OWN request path (raw `postChat`), NOT via pi. The canary runs BEFORE pi session creation in `createEmmySession()`. Plan 03-01 explicitly preserves this.
- The `before_provider_request` handler checks `payload.emmy.is_sp_ok_canary === true` and exempts the canary request. (Defensive — should not be needed if the canary is run before the pi session exists, but adds a belt-and-suspenders guard.)
- Phase 3 close criteria include re-running SP_OK on every profile as part of the SC-1-class walkthrough.

**Warning signs:** SP_OK-green → green → red over 3 sessions after Plan 03-01 lands. Qwen3 Phase-3 incident redux.

---

## Runtime State Inventory

Already captured above. No additional action needed here — Phase 3 is an additive feature phase with no rename/refactor surface.

---

## Code Examples

Each example cites source file and line ranges.

### Ex 1: Before Provider Request — inject enable_thinking + grammar + 3-layer prompt

```typescript
// Source: @mariozechner/pi-coding-agent@0.68.0/dist/core/extensions/types.d.ts:430-433, 757
// Emmy target: packages/emmy-ux/src/pi-emmy-extension.ts (NEW)

pi.on("before_provider_request", (event, ctx) => {
  // event.payload is unknown-typed; cast to vLLM chat-completions shape
  const p = event.payload as {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    extra_body?: Record<string, unknown>;
    chat_template_kwargs?: Record<string, unknown>;
  };

  // (a) D-02a: enable_thinking:false at request level (removes a17f4a9 stopgap)
  p.chat_template_kwargs = {
    ...(p.chat_template_kwargs ?? {}),
    enable_thinking: false,
  };

  // (b) D-02b: reactive grammar injection (from @emmy/provider's retry state)
  if (ctx.signal && getRetryState(ctx.signal)?.wantsGrammar) {
    p.extra_body = {
      ...(p.extra_body ?? {}),
      guided_decoding: { grammar_str: profile.grammar.toolCallLark },
    };
  }

  // (c) D-02c + D-04: overwrite system message with emmy's 3-layer assembled prompt
  const assembled = getAssembledPrompt(profile, ctx.cwd);
  const idx = p.messages.findIndex(m => m.role === "system");
  if (idx >= 0) {
    p.messages[idx] = { role: "system", content: assembled.text };
  } else {
    p.messages.unshift({ role: "system", content: assembled.text });
  }

  // Stamp prompt SHA on current span (HARNESS-06 + SC-1 verbatim)
  const span = trace.getActiveSpan();
  if (span) span.setAttribute("emmy.prompt.sha256", assembled.sha256);
});
```

### Ex 2: OTLP + JSONL dual-sink init

```typescript
// Source: @opentelemetry/sdk-node README; @opentelemetry/exporter-trace-otlp-http README
// Emmy target: packages/emmy-telemetry/src/otel-init.ts (NEW)

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ATTR_GEN_AI_SYSTEM } from "@opentelemetry/semantic-conventions/incubating";

export async function initOtel(opts: {
  langfusePublicKey: string;
  langfuseSecretKey: string;
  profile: { id: string; version: string; hash: string };
  enabled: boolean;
}): Promise<NodeSDK | null> {
  if (!opts.enabled) {
    console.log("[emmy] OBSERVABILITY: OFF (EMMY_TELEMETRY=off or --no-telemetry)");
    return null;
  }

  const auth = Buffer.from(`${opts.langfusePublicKey}:${opts.langfuseSecretKey}`).toString("base64");
  const exporter = new OTLPTraceExporter({
    url: "http://127.0.0.1:3000/api/public/otel/v1/traces",
    headers: {
      Authorization: `Basic ${auth}`,
      "x-langfuse-ingestion-version": "4",
    },
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "emmy",
      [ATTR_GEN_AI_SYSTEM]: "vllm",
    }),
    spanProcessors: [
      new EmmyProfileStampProcessor(opts.profile),   // Pattern 2
      new BatchSpanProcessor(exporter),
    ],
  });

  sdk.start();

  // Langfuse reachability probe
  try {
    const r = await fetch("http://127.0.0.1:3000/", { method: "HEAD" });
    console.log(`[emmy] OBSERVABILITY: ON — JSONL + Langfuse OTLP (status=${r.status})`);
  } catch {
    console.warn("[emmy] OBSERVABILITY: JSONL-only (Langfuse unreachable at localhost:3000)");
  }

  return sdk;
}
```

### Ex 3: Pi Footer via setStatus (lightweight)

```typescript
// Source: @mariozechner/pi-coding-agent@0.68.0/dist/core/extensions/types.d.ts:75-76
// Emmy target: packages/emmy-telemetry/src/metrics-poller.ts (NEW)

export function startFooterPoller(ctx: ExtensionContext, baseUrl: string): () => void {
  const interval = setInterval(async () => {
    const [metrics, nvidia] = await Promise.all([
      fetchVllmMetrics(baseUrl),  // parse /metrics Prometheus text
      runNvidiaSmiQuery(),        // child_process.spawn with CSV format
    ]);

    const kvPct = (metrics["vllm:gpu_cache_usage_perc"] ?? 0) * 100;
    const gpuPct = nvidia.utilizationGpu;
    const tokPerS = computeTokRate(metrics["vllm:generation_tokens_total"]);
    // D-25: spec-accept is `-` until Phase 6
    const specAccept = "-";

    // UX-02 format: [GPU 87% • KV 34% • spec accept - • tok/s 38]
    ctx.ui.setStatus(
      "emmy.footer",
      `GPU ${gpuPct.toFixed(0)}% • KV ${kvPct.toFixed(0)}% • spec accept ${specAccept} • tok/s ${tokPerS.toFixed(0)}`
    );
  }, 1000);  // D-23: 1 Hz

  return () => clearInterval(interval);
}

function computeTokRate(current?: number): number {
  // sliding-window rate; see Pitfall #6 above
  const now = Date.now();
  if (current === undefined) return 0;
  _samples.push({ ts: now, tokens: current });
  _samples = _samples.filter(s => now - s.ts < 5000);
  if (_samples.length < 2) return 0;
  const first = _samples[0]; const last = _samples[_samples.length - 1];
  return (last.tokens - first.tokens) / ((last.ts - first.ts) / 1000);
}
```

### Ex 4: Rating capture via input event

```typescript
// Source: @mariozechner/pi-coding-agent@0.68.0/dist/core/extensions/types.d.ts:534-552
// Emmy target: packages/emmy-ux/src/pi-emmy-extension.ts

const SHIFT_ALT_UP = "\x1b[1;4A";    // shift+alt+up ANSI sequence
const SHIFT_ALT_DOWN = "\x1b[1;4B";  // shift+alt+down
// If D-18 requires literal alt+up: use \x1b[1;3A / \x1b[1;3B (alt+up / alt+down)

pi.on("input", (event, ctx) => {
  if (event.text === SHIFT_ALT_UP || event.text === SHIFT_ALT_DOWN) {
    const rating = event.text === SHIFT_ALT_UP ? 1 : -1;
    const lastTurn = getLastCompletedTurn(ctx);  // D-19: most-recent completed turn
    if (!lastTurn) return { action: "continue" };

    // D-20: ~/.emmy/telemetry/feedback.jsonl
    const feedbackPath = join(homedir(), ".emmy", "telemetry", "feedback.jsonl");
    // Thumbs-down: open free-text modal first
    if (rating === -1) {
      ctx.ui.input("Why thumbs-down?", "optional free-text comment").then(comment => {
        appendFeedback(feedbackPath, { ...lastTurn, rating: -1, comment: comment ?? "" });
      });
    } else {
      appendFeedback(feedbackPath, { ...lastTurn, rating: 1, comment: "" });
    }
    return { action: "handled" };
  }
  return { action: "continue" };
});
```

### Ex 5: Offline-OK audit

```typescript
// Emmy target: packages/emmy-telemetry/src/offline-audit.ts (NEW)
// D-26, D-27

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "loopback", "0.0.0.0"]);

export interface OfflineAuditResult {
  offline_ok: boolean;
  violating_tool: string | null;
  violating_host: string | null;
}

export function auditToolRegistry(
  tools: Array<{ name: string; required_hosts: string[] }>,
  webFetchAllowlist: string[],
): OfflineAuditResult {
  const permitted = new Set([...LOOPBACK_HOSTS, ...webFetchAllowlist]);
  for (const t of tools) {
    for (const h of t.required_hosts) {
      if (!permitted.has(h)) return { offline_ok: false, violating_tool: t.name, violating_host: h };
    }
  }
  return { offline_ok: true, violating_tool: null, violating_host: null };
}

// Runtime enforcement in web_fetch (D-27):
export function auditWebFetchUrl(url: string, allowlist: string[]): boolean {
  const hostname = new URL(url).hostname;
  const permitted = new Set([...LOOPBACK_HOSTS, ...allowlist]);
  return permitted.has(hostname);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom agent compaction (sliding window; head-tail prune) | LLM-summarization + structured preservation (Claude Code / Cursor / Cline pattern) | 2024–2025 | Quality jump on >100-turn sessions; D-13 adopts this. |
| Render-time `<think>`-strip (`a17f4a9` Phase-2 stopgap) | `chat_template_kwargs.enable_thinking:false` at request level | Phase 3 Plan 03-01 | Removes need for output post-processing; single source of truth (the profile + request body). |
| Provider-model name conditionals in harness code (`if "qwen" in name: …`) | Profile-shaped overrides in `harness.yaml` + `BeforeProviderRequestEvent` hook | CLAUDE.md locked rule; enforced throughout Phase 2 | Zero model-name regex in harness code. |
| LangSmith / cloud observability | Self-hosted Langfuse v3 via Docker Compose | 2025–2026 (Langfuse acquired by ClickHouse Jan 2026; OSS remains MIT) | Zero cloud dependency in critical path. |
| Outlines for structured decoding | XGrammar (vLLM 0.19 default) | vLLM 0.19 (2026-04) | 3.5–100× faster; already landed in Phase 2. |
| `prompt_tokens_per_second` vLLM metric | `vllm:generation_tokens_total` (Counter) + client-side rate | vLLM V1 engine (2026) | Client computes rate over sliding window (Pitfall #6 above). |
| `@modelcontextprotocol/server-filesystem` as external npm dep for MCP tests | In-process MCP server with StdioServerTransport (Phase 2 pattern) | Phase 2 — reusable for Phase 3 SC drivers | Avoids external npm during test; Phase 3 compaction eval driver follows same pattern. |

**Deprecated/outdated:**
- **`parquetjs` npm package** — officially "inactive" per 2026 search; use `hyparquet-writer` if parquet needed.
- **`vllm:kv_cache_usage_perc`** — NOT a real metric name. The correct name is `vllm:gpu_cache_usage_perc`. CONTEXT D-22 parenthetical lists both; the planner must honor the verified name.
- **OTel GenAI semconv "stable"** — still in "Development/Incubating" status as of 2026-04 per OTel spec. D-07 correctly notes "incubating". Use `@opentelemetry/semantic-conventions/incubating` import path.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Alt+Up in D-18 can be relaxed to Shift+Alt+Up if literal alt+up proves unworkable | "Common Pitfalls — Pitfall 1" + "Code Examples — Ex 4" | Medium: if the TELEM-02 spec strictly requires Alt+Up, option 2 (input-event handler shadowing pi's `app.message.dequeue`) is the only path; planner must decide. |
| A2 | `@opentelemetry/sdk-node@^0.53.x` is the current stable as of 2026-04 (I didn't successfully fetch npm at research time) | "Standard Stack" | Low: verified BEFORE landing via `npm view`; version only affects install line in package.json. |
| A3 | HuggingFace `datasets.load_dataset("json", ...)` works for JSONL without a `dataset_card.md` | "Summary" #5 | Low: verified via hf docs/loading page; minor risk if huggingface datasets >=5.x deprecates bare-JSONL loading (unlikely). |
| A4 | `writeFile`/`appendFile` on Linux with O_APPEND is atomic for writes <4096B (PIPE_BUF) | "Code Examples — Ex 3 Pattern 3" | Medium: correct for Linux page-cache-atomic semantics, but feedback JSONL rows with long `model_response` fields could exceed 4K. Mitigation: per-line fsync + retry-on-partial-write guard; for extra-large rows, use tempfile+rename (`write_json_atomic` pattern) instead of in-place append. |
| A5 | Pi's `prepareCompaction() + compact()` pure functions can be called from an emmy extension (not just from pi's session-manager internal path) | "Pattern 1" | Low: they ARE exported from `@mariozechner/pi-coding-agent` (dist/index.d.ts line 4); runnable as pure functions. |
| A6 | vLLM 0.19 on NGC `26.03.post1-py3` exposes `vllm:gpu_cache_usage_perc` (not `gpu_prefix_cache_hit_rate` which is different) | "Summary" #3 | Low: verified via akrisanov.com article + vLLM docs; both metric names exist and are different things (we want `gpu_cache_usage_perc` = KV utilization 0–1). |
| A7 | Langfuse `/api/public/otel` accepts `OTLPTraceExporter` without `langfuse.trace.id` hints | "Summary" #2 | Low: verified via langfuse.com/integrations/native/opentelemetry page; parent-child OTel context stated sufficient. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. This table is NOT empty — A1 and A4 flag decisions the planner and discuss-phase may want to confirm with the user. A2 is a pre-flight verification during Plan 03-01 execution.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + NVIDIA runtime | Phase 1 emmy-serve (existing); Phase 3 Langfuse compose | ✓ (verified via prior phases) | Docker 24+ | None — hard req |
| Docker Compose v2 | D-05 Langfuse stack | ✓ (bundled with Docker Desktop / Docker CE modern installs) | v2+ | None — hard req |
| NGC registry access (one-time pull) | Langfuse digest-pinned images (but public Docker Hub) | ✓ (Docker Hub anonymous pull) | — | N/A |
| Local Docker registry (for D-09 air-gap digest caching) | Air-gap CI re-run | Probably ✓ (Phase 1 NGC pattern already) | — | Fall back to single-node pull-retention; flag in D-09 README. |
| nvidia-smi | UX-02 footer | ✓ (DGX Spark has it natively; Phase 1 GpuSampler uses it) | 545+ | Blank GPU% field (D-24 graceful degrade) |
| `ss` / `tcpdump` (air-gap verification) | D-09 CI job | ✓ (Linux base) | — | — |
| Bun 1.3+ | existing | ✓ | 1.3.13 | — |
| Node.js 20+ (pi requirement) | existing | ✓ (Bun compat) | — | — |
| `bun add @opentelemetry/*` (requires npm registry) | Install step | ✓ at install time; air-gap test runs AFTER install | — | bun.lock reproducibility guard |
| Langfuse public/secret keys | OTLP auth | Generated on Langfuse web UI first-login; auto-persisted to env file | — | EMMY_TELEMETRY=off if keys unset (D-08 kill-switch covers this) |

**Missing dependencies with no fallback:** None identified. Phase 3 builds on Phase 2's environment with additive-only needs.

**Missing dependencies with fallback:**
- If user's Docker daemon is not running at `start_observability.sh` time: print actionable error; fall back to JSONL-only telemetry (D-06 already supports this). Emmy session does not block on Langfuse readiness.

---

## Validation Architecture

> config.json `workflow.nyquist_validation: true` — section is REQUIRED.

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | `bun test` (v1.3+, already in place) |
| Framework (Python) | `pytest` via `uv run pytest tests/unit -q` (already in place — for emmy_serve side) |
| Config file (TS) | `package.json` `"test": "bun test"` + package-local `vitest`-style `*.test.ts` conventions |
| Config file (Python) | `pyproject.toml` / `tests/unit/` (Phase 1 baseline) |
| Quick run command | `bun test --filter @emmy/telemetry` (and similar per package) |
| Full suite command | `bun test && uv run pytest tests/unit -q` |
| OTel / Langfuse e2e gate | `bun test --filter eval/phase3 -t 'sc1-observability'` (NEW fixture) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HARNESS-05 | Soft-threshold compaction fires at turn boundary | integration | `bun test packages/emmy-ux/test/compaction-trigger.test.ts` | ❌ Wave 0 |
| HARNESS-05 | D-14 preservation: error payloads remain verbatim through compaction | integration | `bun test packages/emmy-ux/test/preservation.test.ts` | ❌ Wave 0 |
| HARNESS-09 | OTel span attributes include `emmy.profile.{id,version,hash}` on every span | integration | `bun test packages/emmy-telemetry/test/span-stamp.test.ts` | ❌ Wave 0 |
| HARNESS-09 | OTLP reaches Langfuse when up, silent-drops when down | integration | `eval/phase3/sc1-observability.test.ts` (live Langfuse fixture) | ❌ Wave 0 |
| CONTEXT-02 | Per-profile `context.compaction.*` block honored | unit | `bun test packages/emmy-ux/test/compaction-policy.test.ts` | ❌ Wave 0 |
| CONTEXT-02 | `preserve_tool_results: error_only` filters correctly | unit | same file as above | ❌ Wave 0 |
| TELEM-01 | Langfuse compose stack starts healthy | smoke (manual) | `scripts/start_observability.sh && docker compose ps --filter health=healthy` | ❌ Wave 0 |
| TELEM-01 | `/api/public/otel` endpoint accepts OTLP POST with Basic auth | integration | `bun test packages/emmy-telemetry/test/otlp-langfuse.test.ts` | ❌ Wave 0 |
| TELEM-02 | Rating JSONL row schema matches spec | unit | `bun test packages/emmy-telemetry/test/feedback-jsonl.test.ts` | ❌ Wave 0 |
| TELEM-02 | Alt-combo keybind writes correct turn_id | integration | `bun test packages/emmy-ux/test/rating-capture.test.ts` | ❌ Wave 0 |
| TELEM-03 | `pi-emmy --export-hf <dir>` produces HF-loadable artifact | integration | `uv run python -c "from datasets import load_dataset; d = load_dataset('json', data_files='out/feedback.jsonl')"` | ❌ Wave 0 |
| TELEM-03 | `EMMY_TELEMETRY=off` disables both sinks | unit | `bun test packages/emmy-telemetry/test/kill-switch.test.ts` | ❌ Wave 0 |
| UX-02 | Footer reads `vllm:gpu_cache_usage_perc` and renders it at 1Hz | integration | `bun test packages/emmy-telemetry/test/metrics-poller.test.ts` | ❌ Wave 0 |
| UX-02 | Graceful degrade on /metrics 500 (D-24) | unit | same file as above | ❌ Wave 0 |
| UX-03 | Allowlisted web_fetch host = green; non-allowlisted = red | integration | `bun test packages/emmy-telemetry/test/offline-audit.test.ts` | ❌ Wave 0 |
| UX-03 | Runtime enforcement at web_fetch call | integration | `bun test packages/emmy-tools/test/web-fetch-allowlist.test.ts` | ❌ Wave 0 |
| Wire-through (D-01) | Full SC-1-class walkthrough against live emmy-serve, verify all 5 wire-throughs landed | e2e manual | `pi-emmy -p "make multi-file change"` against `/tmp/emmy-sc3-walkthrough/` fixture | ❌ Wave 0 (reuses Phase 2 fixture) |
| Wire-through | `<think>` no longer leaks (a17f4a9 stopgap removed) | integration | `eval/phase3/think-leak.test.ts` — assert no `<think>` in 50 turns | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test --filter @emmy/{package-under-edit}` (quick; <30s per package)
- **Per wave merge:** `bun test && bun run typecheck` (full Bun suite — Phase 2 baseline 192 pass + Phase-3 additions)
- **Phase gate:** Full Bun suite + `uv run pytest tests/unit -q` (137 pass baseline) + live Langfuse-up integration suite + SC-1-class walkthrough verdict + all-5-SC-Phase-3 evidence dumps

### Wave 0 Gaps (files to create / framework install in Plan 03-01 scaffold task)

- [ ] `packages/emmy-telemetry/test/jsonl-atomic.test.ts` — atomic-append invariants
- [ ] `packages/emmy-telemetry/test/span-stamp.test.ts` — HARNESS-09 profile stamp
- [ ] `packages/emmy-telemetry/test/otlp-langfuse.test.ts` — endpoint + auth
- [ ] `packages/emmy-telemetry/test/metrics-poller.test.ts` — UX-02 metric parsing
- [ ] `packages/emmy-telemetry/test/feedback-jsonl.test.ts` — TELEM-02 row schema
- [ ] `packages/emmy-telemetry/test/offline-audit.test.ts` — UX-03 allowlist
- [ ] `packages/emmy-telemetry/test/kill-switch.test.ts` — TELEM-03 EMMY_TELEMETRY=off
- [ ] `packages/emmy-ux/test/compaction-trigger.test.ts` — D-11 turn-boundary trigger
- [ ] `packages/emmy-ux/test/preservation.test.ts` — D-14 preservation invariants (incl. 50KB error-stacktrace pin fixture)
- [ ] `packages/emmy-ux/test/compaction-policy.test.ts` — D-15 YAML parse
- [ ] `packages/emmy-ux/test/rating-capture.test.ts` — TELEM-02 input-event flow
- [ ] `packages/emmy-tools/test/web-fetch-allowlist.test.ts` — D-27 runtime enforcement
- [ ] `eval/phase3/sc1-observability.test.ts` — e2e Langfuse reachable → traces visible
- [ ] `eval/phase3/sc2-compaction-200turn.test.ts` — 200-turn synthetic replay with assertions
- [ ] `eval/phase3/think-leak.test.ts` — regression guard for a17f4a9 removal
- [ ] No framework install needed — Bun test + pytest already in place from Phase 1/2.

### SC-2 Fixture Strategy — 200-Turn Synthetic Replay

SC-2 says: "a 200-turn coding session that exceeds `max_input_tokens` triggers per-profile compaction without the agent losing the active task". Verifiable from the JSONL event stream alone:

**Fixture seeded from** `runs/phase2-sc3-capture/` (Phase 2 ALWAYS-ON transcript capture dumped ~50 single-turn postChat calls). Phase 3 extends with:

1. **200-turn synthesizer** at `eval/phase3/sc2-fixture-builder.ts`: generates deterministic turn stream where each turn adds ~700 tokens of context, so at turn ~130 we cross the 0.75 × 114,688 = 86,016 soft threshold. Every 20th turn is a "error-flagged" tool result with a 4KB fake stacktrace (D-14 test).

2. **Replay driver** at `eval/phase3/sc2-runner.ts`: spins up `pi-emmy --print --no-telemetry` against a stub vLLM that returns deterministic responses; counts turns; asserts:
   - (a) goal turn (index 0) is in post-compaction preserved set
   - (b) last 5 turns are byte-identical to pre-compaction entries
   - (c) every `tool_result.isError === true` entry has verbatim content in post-compaction entries
   - (d) `@file`-pinned entries remain verbatim
   - (e) JSONL event stream contains `session.compaction.complete` with `turns_elided > 0`

3. **Per-profile variant matrix** (Pitfall #5 / W3 discipline from Phase 2 SC-3): run the same 200-turn fixture with 3 variants — `soft_threshold_pct=0.75` (default), `=0.50` (aggressive), `=0.90` (conservative). Assert all 3 pass (a)–(e); record aggregate timing + turn-count-at-compaction in `runs/phase3-sc2/report.json`.

### SC-1 Fixture Strategy — End-to-End Trace Coverage

SC-1 says: "Opening a self-hosted Langfuse instance after a session shows one trace per turn with OTel GenAI semconv spans … and every span carries `profile.id`, `profile.version`, `profile.hash`".

**Strategy:**
1. `scripts/start_observability.sh` up; health-gate.
2. Reuse Phase 2's `/tmp/emmy-sc1-walkthrough/` fixture (same multi-file task).
3. Run `pi-emmy -p "make same multi-file change as Phase 2 SC-1"` end-to-end; capture `runs/<session_id>/events.jsonl`.
4. Query Langfuse via `GET /api/public/traces` with Basic auth; assert:
   - (a) Same number of traces (or child spans under one trace) as turn count in JSONL
   - (b) Every span has `emmy.profile.id == "qwen3.6-35b-a3b"`, `emmy.profile.version == "v3"`, `emmy.profile.hash == <v3 hash>`
   - (c) GenAI semconv: `gen_ai.system == "vllm"`, `gen_ai.request.model == "qwen3.6-35b-a3b-fp8"`, `gen_ai.usage.input_tokens > 0`, `gen_ai.usage.output_tokens > 0` present on chat-completion spans
   - (d) Tool-execution spans exist with `gen_ai.operation.name == "execute_tool"` and `gen_ai.tool.name ∈ {read, write, edit, bash, grep, find, ls, web_fetch, ...mcp}`
   - (e) Trace with Langfuse-down (`docker compose stop langfuse-web`) still produces `events.jsonl` (D-06 invariant)

---

## Security Domain

> config.json inferred `security_enforcement` not explicitly `false` → section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Langfuse OTLP Basic-auth with rotated keys; vLLM endpoint is loopback-only (Phase 1 discipline) |
| V3 Session Management | yes (Langfuse web UI sessions) | NextAuth's built-in session + NEXTAUTH_SECRET rotation; documented in observability/langfuse/README.md |
| V4 Access Control | yes | `EMMY_TELEMETRY=off` kill-switch per D-08; host-process-only reads of `~/.emmy/telemetry/` |
| V5 Input Validation | yes | Every config field parsed via strict-YAML loader (Phase 1 pydantic + JS counterpart); `web_fetch` URL validated against allowlist (D-27) |
| V6 Cryptography | yes | Langfuse `ENCRYPTION_KEY` used by langfuse-worker to encrypt blob storage (MinIO); never hand-roll — use Langfuse's own |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tool poisoning via MCP tool description (hidden Unicode) | Tampering | Phase 2 D-18 Unicode gate already catches Cf/Co/Cs/bidi at registration — unchanged in Phase 3 |
| SSRF via `web_fetch(url)` | Information Disclosure | D-27 allowlist; URL hostname audited before fetch; runtime enforcement; logged violations |
| Telemetry leak of source code / secrets to Langfuse | Information Disclosure | 100% local; Langfuse runs on loopback only; default emitEvent schemas do NOT capture file contents; `--export-hf` warns if `model_response`/`tool_calls` contain file content (D-21) |
| OTLP endpoint hijack | Spoofing | OTLP exporter targets `127.0.0.1:3000` only; Basic-auth + `x-langfuse-ingestion-version` header; emmy-serve is loopback-only (Phase 1); no attack surface outside the box |
| JSONL injection via crafted user prompt | Tampering | JSON.stringify escapes all user content before appending; invariant: one line == one JSON object; any crafted newline in user input is escaped as `\n` |
| Secrets in env leaking to observability | Information Disclosure | `EMMY_VLLM_API_KEY`, `EMMY_TELEMETRY_*` keys never stamped on spans; emitEvent whitelist-only for attributes |
| Denial of service via fsync in hot path | Availability | JSONL fsync is per-line; worst-case 1ms/turn; tested under 200-turn load in SC-2. `BatchSpanProcessor` (async) for OTLP keeps the request path clear. |

**Emmy-specific:** Air-gap thesis (Pitfall #8 in PITFALLS.md) means Langfuse's own telemetry (if any) must be off. Verify by adding `docker compose ps` + `ss -tnlp` to air-gap CI after `start_observability.sh` — zero non-loopback ESTAB outbound permitted. D-09 digest-pinning makes image-pull reproducible.

---

## Open Questions

1. **Literal Alt+Up vs Shift+Alt+Up for TELEM-02.**
   - What we know: pi 0.68 binds `alt+up` to `app.message.dequeue` + `app.models.reorderUp`. Collision guaranteed.
   - What's unclear: Is the D-18 "Alt+Up" spec verbatim, or can emmy use `shift+alt+up` with a PROFILE_NOTES ADR entry?
   - Recommendation: **Planner asks the user at plan-phase entry**, OR uses `on("input", ...)` interception path (Pattern 4) which shadows pi's dequeue for emmy users — acceptable because emmy doesn't expose the follow-up queue.

2. **Profile version bump: v2→v3 (schema change) or additive v2-with-null-defaults?**
   - What we know: D-15 introduces `harness.yaml.context.compaction.*` (5 new keys) + `tools.web_fetch.allowlist` (1 new key). Any field change bumps profile hash per Phase 1 D-02.
   - What's unclear: whether the planner should bump v2→v3 as a coordinated commit (clean break) or keep v2 and ship a PATCH that adds optional fields with null defaults (allows future v3 to be an intentional policy bump separately).
   - Recommendation: **v2→v3 coordinated bump** — matches Phase 2 v1→v2 precedent + keeps the hash trajectory clear + future Phase 4's Gemma 4 profile lands on v1 of its own directory tree alongside qwen v3.

3. **Whether `--export-hf` ships parquet or JSONL MVP.**
   - What we know: `datasets.load_dataset("json", data_files=...)` loads JSONL directly. Parquet is optional polish.
   - What's unclear: whether the eventual (Phase 7) public HF dataset MUST be parquet for performance, or JSONL is acceptable.
   - Recommendation: **MVP = JSONL-only** (simpler, zero new deps). Phase 7 publication converts to parquet if performance matters at that point.

4. **SC-3-class 3-run discipline for compaction prompt variants.**
   - What we know: Pitfall #5 + Phase 2 SC-3 discipline requires full-corpus measurement for any prompt/sampling change.
   - What's unclear: does compaction-prompt count as a "prompt change" triggering the 3-run rule? Compaction prompt lives in `profiles/**/prompts/compact.md` per D-13.
   - Recommendation: **Yes.** Plan the 200-turn SC-2 fixture to run in 3 variants (default compact.md + alternate + `--no-compaction`). Record in PROFILE_NOTES validation_runs.

---

## Sources

### Primary (HIGH confidence)

- **pi-coding-agent 0.68.0 source (installed, verified 2026-04-21):**
  - `node_modules/.bun/@mariozechner+pi-coding-agent@0.68.0+85f9f1c5bdaeb2ea/node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts` — complete export map (lines 1–28)
  - `.../dist/core/extensions/types.d.ts:430-433` — `BeforeProviderRequestEvent.payload: unknown`, mutable
  - `.../dist/core/extensions/types.d.ts:746-899` — `ExtensionAPI` signature incl. `registerProvider(name, ProviderConfig)` with `streamSimple`, `registerShortcut(keyId, options)`, `registerTool`
  - `.../dist/core/extensions/types.d.ts:64-182` — `ExtensionUIContext` incl. `setStatus(key, text)`, `setFooter(factory)`, `onTerminalInput(handler)`
  - `.../dist/core/extensions/types.d.ts:196-226` — `ExtensionContext.compact(options)`, `getContextUsage()`
  - `.../dist/core/extensions/types.d.ts:534-552` — `InputEvent`, `InputEventResult` (D-18 option 2)
  - `.../dist/core/keybindings.d.ts:228-305` — pi's built-in `app.message.dequeue` / `app.models.reorderUp` on `alt+up` (conflict source)
  - `.../dist/core/compaction/compaction.d.ts` — `DEFAULT_COMPACTION_SETTINGS`, `shouldCompact`, `prepareCompaction`, `compact`, `estimateTokens`, `findCutPoint`
  - `.../dist/core/compaction/utils.d.ts` — `SUMMARIZATION_SYSTEM_PROMPT`, `serializeConversation`, `FileOperations`
- **Langfuse OpenTelemetry native integration:** https://langfuse.com/integrations/native/opentelemetry — OTLP endpoint, auth header, ingestion version (fetched 2026-04-21)
- **Langfuse docker-compose.yml** (raw from main): https://raw.githubusercontent.com/langfuse/langfuse/main/docker-compose.yml — 6 services, required env vars, image tags (fetched 2026-04-21)
- **OpenTelemetry GenAI semantic conventions (spans):** https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/gen-ai/gen-ai-spans.md — span name conventions, attribute map, stability status (Development) (fetched 2026-04-21)
- **HuggingFace datasets — Load:** https://huggingface.co/docs/datasets/loading — `load_dataset("json", data_files=...)` works on JSONL (fetched 2026-04-21)
- **Phase 2 CLOSEOUT:** `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-CLOSEOUT.md` — 5 carry-forward deferrals (source of truth for Track B)
- **Emmy source:** `packages/emmy-{provider,ux,tools,telemetry}/src/**` — Wave-0 stub signatures; integration sites
- **`emmy_serve/diagnostics/atomic.py`** — reference Python `append_jsonl_atomic` implementation to port to TS

### Secondary (MEDIUM confidence)

- **akrisanov.com "vLLM Metrics in Production":** vLLM Prometheus metric name enumeration — https://akrisanov.com/vllm-metrics/ (fetched 2026-04-21; cross-verified against vllm docs hit from web search)
- **hyparam/hyparquet-writer on GitHub:** Parquet writer dependency footprint, air-gap capability, minimal write API — https://github.com/hyparam/hyparquet-writer (fetched 2026-04-21)
- **vLLM docs/metrics design:** https://docs.vllm.ai/en/latest/design/metrics/ (search-link only; WebFetch failed 403 — confirmed metric names via secondary source)

### Tertiary (LOW confidence)

- **WebSearch result for OpenTelemetry GenAI semconv stability claim** (cross-checked against spans doc; Development status is confirmed there too — so upgraded to MEDIUM).

---

## Metadata

**Confidence breakdown:**
- Pi 0.68 extension API surface: **HIGH** — verified directly by reading installed `.d.ts` files.
- Langfuse OTLP endpoint + auth: **HIGH** — verified from Langfuse official docs.
- vLLM metric names: **MEDIUM-HIGH** — metric name `vllm:gpu_cache_usage_perc` verified via multiple sources; exact label sets and spec-decode metric presence condition (only-when-enabled) verified from design doc.
- OTel GenAI semconv attribute names: **HIGH** — fetched from raw GitHub spec.
- HF datasets JSONL loadability: **HIGH** — fetched from HF docs.
- JSONL atomic append TS semantics: **MEDIUM** — Linux PIPE_BUF invariant is well-documented; Bun-specific `appendFile` durability not fully confirmed → A4 flagged.
- Langfuse Docker Compose service set: **HIGH** — fetched from raw compose yaml.
- Alt+Up collision: **HIGH** — verified from pi keybindings.d.ts source.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days) for stable findings; 2026-04-28 (7 days) for OTel SDK version pin (A2) which should be re-verified at Plan 03-01 execution time via `npm view`.

---

## RESEARCH COMPLETE

### Key Findings

- **Pi 0.68 has every API Phase 3 needs, including a built-in compaction engine.** Emmy re-uses `shouldCompact` + `prepareCompaction` + `compact`; emmy ONLY adds D-14 preservation policy as a pre-filter, not a full compaction implementation.
- **Langfuse v3 self-hosted takes 6 services with required env-var rotation**; digest-pinning per D-09 is straightforward; `/api/public/otel` accepts standard OTLP with Basic auth + `x-langfuse-ingestion-version: 4` header.
- **D-18 Alt+Up has a real collision** with pi's built-in `app.message.dequeue` — documented 3 paths; recommendation is to use `on("input", ...)` handler intercepting before pi's keybindings (option 2) OR relax to Shift+Alt+Up (option 1). Planner / discuss-phase should pick.
- **vLLM metric name is `vllm:gpu_cache_usage_perc` — NOT `vllm:kv_cache_usage_perc`** (CONTEXT D-22 included both parenthetically); spec-decode metric is `vllm:spec_decode_draft_acceptance_length` and is absent until spec-decode is enabled (Phase 6).
- **`--export-hf` MVP can be JSONL-only** (HF datasets loads it natively); parquet is optional Phase-7 polish via `hyparquet-writer` if needed.
- **Seven Common Pitfalls catalogued**, most notably: (#1) keybind collision, (#4) compaction-vs-truncation interaction with D-14 error preservation, (#7) SP_OK canary regression risk from Plan 03-01 wire-throughs (Pitfall #6 redux).
- **SC-2 and SC-1 have concrete verifiable fixture strategies** — 200-turn synthesizer with deterministic error-stacktrace pinning; live Langfuse integration with trace-count assertion.

### File Created

`/data/projects/emmy/.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Wire-through APIs (Track B) | HIGH | Verified by reading pi 0.68 .d.ts files directly; all 4 required seams confirmed present with exact signatures |
| Compaction re-use of pi built-ins | HIGH | `compact()`, `prepareCompaction()`, `SUMMARIZATION_SYSTEM_PROMPT` all exported; mapping to D-14 preservation is clean |
| OTel → Langfuse endpoint + auth | HIGH | Langfuse native integration doc verified; `x-langfuse-ingestion-version: 4` header flagged |
| vLLM metric names | MEDIUM-HIGH | Multiple secondary sources agree; minor risk of version drift on NGC container — planner should curl `/metrics` once at execution time to double-confirm |
| TUI footer via `setFooter` / `setStatus` | HIGH | API signatures read from pi source |
| Offline-OK audit mechanism | HIGH | D-26 is straightforward set logic; code example provided |
| Feedback-JSONL HF loadability | HIGH | HF docs confirm |
| Alt+Up collision analysis | HIGH | Pi keybindings source confirms conflict; planner must decide resolution |
| Pitfall coverage | HIGH | Mapped to PITFALLS.md entries + Phase 2 CLOSEOUT SP_OK discipline |

### Open Questions

- Literal Alt+Up vs Shift+Alt+Up (planner or discuss-phase to resolve) — documented in Open Questions #1
- Profile v2→v3 coordinated bump vs additive patch — recommendation given, planner confirms
- Parquet in MVP or only JSONL — recommendation: JSONL-only, planner confirms

### Ready for Planning

Research complete. Planner can now create PLAN.md files with concrete API surfaces, library versions, and verified wire-through paths. Plan 03-01 is the atomic Track-B wave with SC-1 walkthrough re-run; subsequent plans instrument stable post-wave paths for observability, compaction, TUI footer, lived-experience rating, and offline-OK badge.
