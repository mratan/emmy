# Phase 3: Observability + Agent-Loop Hardening + Lived-Experience - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 lands **two tracks together**:

**Track A — ROADMAP-declared (9 REQ-IDs):**
- **HARNESS-09 + TELEM-01:** OTel GenAI semconv spans across harness↔vLLM → self-hosted Langfuse v3
- **HARNESS-05 + CONTEXT-02:** per-profile auto-compaction so a 200-turn session that exceeds `max_input_tokens` doesn't lose the active task
- **TELEM-02 + TELEM-03:** Alt+Up/Down rating → `~/.emmy/telemetry/feedback.jsonl` → `--export-hf` producing a HuggingFace-datasets-loadable artifact; 100% local; opt-out flag
- **UX-02:** TUI footer `[GPU 87% • KV 34% • spec accept 71% • tok/s 38]` at ≥1Hz; within 5% of equivalent CLI tools
- **UX-03:** green "OFFLINE OK" / red "NETWORK USED" badge from startup tool-registry audit

**Track B — Phase-2 architectural carry-forward (5 wire-throughs from 02-CLOSEOUT):**
1. `@emmy/provider` → pi's `streamSimple` via `BeforeProviderRequestEvent` (makes reactive grammar retry actually fire on the live path; removes `a17f4a9` `<think>`-strip stopgap)
2. Hash-anchored edit as pi's `customTools` override (replaces pi's built-in edit for text files)
3. MCP bridge → pi tool source via `customTools` (not just eval-driver bypass)
4. Emmy 3-layer prompt assembly through `BeforeProviderRequestEvent` (so pi emits OUR assembled prompt verbatim; makes `prompt.sha256` wire-path-authoritative)
5. `chat_template_kwargs.enable_thinking:false` at request level (proper fix, same scope as deferral #1)

**Success gate at close:** all 5 ROADMAP Phase-3 success criteria demonstrable; 9 REQ-IDs closed; every span in a recorded session carries `profile.{id,version,hash}`; SC-1-class daily-driver walkthrough (reusing Phase 2's walkthrough fixture) re-runs green against the now-wired paths.

**Out of Phase 3 (deferred):**
- Gemma 4 profile (Phase 4), `/profile` atomic swap with progress UX (UX-04, Phase 4)
- Cross-model planner/editor/critic routing (HARNESS-08, Phase 4)
- Eval harness + benchmark suite (Phase 5)
- SDK/RPC programmatic mode (UX-06, Phase 5)
- Speculative decoding paired-benchmark gate (Phase 6 — Phase 3 UX-02 footer field for spec-accept% remains a placeholder until then)
- Prompt-injection (natural-language) runtime detection (Phase 2 deferred; still not Phase 3 scope)
- `start_emmy.sh --airgap` 300s timeout (Phase 1 latent issue #1 — fix as discrete emmy-serve patch if surfaced, not harness scope)
- npm publish of `@emmy/*` (Phase 7 public-artifact work)

</domain>

<decisions>
## Implementation Decisions

### Wire-through sequencing (Phase-2 carry-forward, Track B)

- **D-01:** The 5 Phase-2 carry-forward wire-throughs land as **one atomic wave** (single plan, 1-2 commits). Rationale: all five are variations of "register real implementation on pi session start"; partial wiring creates split-brain states (provider wired but tools still pi-native, prompt assembled but not wire-authoritative, etc.). A single coordinated plan with a post-wave SC-1-class walkthrough is cleaner than 5 smaller plans each needing their own integration-test matrix. Follow-up plans (observability, compaction, TUI surfaces) instrument the stable post-wave paths.

- **D-02:** `@emmy/provider` wire pattern is **layer via streamSimple**, not replacement. Emmy registers an `emmy-vllm` provider implementing `ModelRegistry.streamSimple`; pi-ai's built-in `openai-completions` stays available for any non-vLLM debugging or future hosted-eval scenarios. `BeforeProviderRequestEvent` is the injection point for (a) `chat_template_kwargs.enable_thinking:false`, (b) `extra_body.guided_decoding.grammar` on reactive retry (Phase 2 D-11), (c) emmy's assembled 3-layer prompt overriding pi's templated one (carry-forward #4). Two streaming paths exist in the binary by design; `emmy-vllm` is the default and only one exercised in daily-drive.

- **D-03:** Tools binding is **customTools override**, pi keeps built-ins as fallback. `createAgentSession({ customTools: [emmyHashEditTool, ...mcpTools, ...emmyNativeTools] })` registers emmy's 8 native tools (read/write/edit/bash/grep/find/ls/web_fetch) plus all MCP-discovered tools (after D-18 Phase-2 Unicode poison gate). Pi's built-in tools are shadowed by same-named customTools. Rationale: no Replace risk (if emmy's edit has a bug, built-in fallback is available via debug flag); aligns with pi's public extension API.

- **D-04:** Wave sequencing is **wire-throughs first, observability after**. Plan 03-01 (or similar) = Track B atomic wave. Subsequent plans (Langfuse stack + OTel instrumentation; compaction; TUI surfaces) land after Track B is stable because they instrument the real wire paths, not moving targets. Matches Phase 2's "build the thing, then measure it" discipline.

### Observability architecture (HARNESS-09 + TELEM-01)

- **D-05:** Langfuse v3 self-hosted via **docker-compose**, orchestrated by a dedicated `scripts/start_observability.sh` (separate from `start_emmy.sh`). The compose stack is Langfuse Web + Worker + ClickHouse + Postgres + Redis, image digests pinned in `observability/langfuse/docker-compose.yaml`. Teardown via `scripts/stop_observability.sh`. Rationale: emmy-serve boot doesn't need to block on Langfuse readiness; the two stacks have independent failure modes; reproducibility via pinned digests matches Phase 1's NGC container discipline.

- **D-06:** Canonical sink is **JSONL-always + OTLP-if-up** (dual-sink, JSONL authoritative). Every per-turn event writes atomically to `runs/<session_id>/events.jsonl` via the `append_jsonl_atomic` pattern lifted from `emmy_serve/diagnostics/` (fsync-then-rename, never partial writes). The OTel SDK additionally fans out to OTLP exporter; exporter silently drops to JSONL-only if Langfuse is unreachable. Rationale: air-gap-safe by construction (Pitfall #8); JSONL is the eval/replay source of truth per ARCHITECTURE.md §7; Langfuse is the UI overlay.

- **D-07:** OTel stack is **`@opentelemetry/sdk-node`** + **`@opentelemetry/exporter-trace-otlp-http`** posting to Langfuse's `/api/public/otel` endpoint. Span attribute names from `@opentelemetry/semantic-conventions/incubating` (GenAI semconv is still "incubating" even after the 2026-03 standardization). Rationale: community-default stack; Langfuse self-hosting docs assume this exact combo; "stand on shoulders" principle.

- **D-08:** Telemetry is **opt-in-by-default with env-var kill-switch**. `pi-emmy` interactive TUI + `--print` + `--json` modes all write to `runs/<session_id>/events.jsonl` and emit OTLP spans by default. `EMMY_TELEMETRY=off` or `pi-emmy --no-telemetry` disables both sinks (and also suppresses the Langfuse OTLP exporter init). Boot prints a loud banner: `OBSERVABILITY: ON — writing runs/<session_id>/events.jsonl + localhost Langfuse OTLP`. Rationale: TELEM-03 says "100% local, opt-out via flag" — implies on-by-default for the lived-experience corpus thesis; SC-1 needs traces in Langfuse after sessions without per-session opt-in friction.

- **D-09 (Claude's Discretion):** Langfuse Docker images pinned by **digest** (not tag) and **cached in the Spark's local Docker registry** so Phase 1's air-gap CI still passes with observability stack running. Same discipline as Phase 1's NGC vLLM container digest pinning. The air-gap CI job must be extended to spin up both emmy-serve AND the Langfuse compose before the 50-turn replay — or (if that proves too heavy) a separate air-gap-observability CI job verifies zero outbound packets from the Langfuse stack specifically.

- **D-10 (Claude's Discretion):** `profile.{id,version,hash}` stamped on **every span**, not just the root trace. SC-1 reads "every span carries … attributes" verbatim. Planner owns the concrete span naming convention and whether `gen_ai.system = "vllm"` (OTel GenAI semconv canonical) or a custom namespace.

### Auto-compaction (HARNESS-05 + CONTEXT-02)

- **D-11:** Compaction **trigger = soft threshold + turn boundary**. When assembled-prompt token count crosses `harness.yaml.context.compaction.soft_threshold_pct` (default 0.75, i.e. ~86K at Phase 2's 114688 max_input_tokens), compaction fires at the **next turn boundary** (not mid-turn). Turns stay atomic.

- **D-12:** Hard ceiling = `max_input_tokens`. If a turn's assembled prompt would still exceed hard ceiling post-compaction attempt, fail-loud with a named `SessionTooFullError` (diagnostic bundle includes the turn that overflowed, the compaction attempt's round-trip result, the preservation list). Matches Phase 1 D-06 fail-loud discipline — silent degradation on context overflow would violate the daily-driver contract.

- **D-13:** Compaction produces **LLM summarization + verbatim preservation list**. Round-trip to the same vLLM endpoint asks the active model to summarize the elided turns (profile-defined prompt at `prompts/compact.md`); the preservation list (D-14) is NOT summarized. The summary replaces elided turns; preserved turns remain byte-identical. Rationale: Claude Code / Cursor / Cline do this; summary-vs-structured-prune has documented quality evidence; per-profile compaction prompt lets Qwen3.6 and Gemma 4 differ in summarization style.

- **D-14:** Preservation guarantees — **four items, all non-negotiable**:
  - **Structural core:** profile's `prompts/system.md` + `AGENTS.md` verbatim + tool definitions + the assembled-prompt SHA line (CONTEXT-04's locked prefix order, never violated by compaction).
  - **Error/diagnostic payloads verbatim:** any tool result flagged error (non-zero exit, thrown exception, parse failure) is kept verbatim, not truncated or summarized (Pitfall #15 guardrail — bottom-of-stacktrace is usually where the actual error lives).
  - **Active goal + recent turn window:** the first user message of the session (the "goal" turn) + the most recent N turns (default 5, profile-overridable) stay verbatim. Preserves the "active task" per SC-2.
  - **File pins + TODO state:** any `@file` pin (CONTEXT-03) and any TODO/PLAN file the agent created stay verbatim so file-pinning and plan-file patterns (TOOLS-09) remain intact post-compaction.

- **D-15:** Compaction is a **per-profile policy block** in `harness.yaml.context.compaction`:
  ```yaml
  context:
    max_input_tokens: 114688
    compaction:
      soft_threshold_pct: 0.75
      preserve_recent_turns: 5
      summarization_prompt_path: prompts/compact.md
      preserve_tool_results: error_only    # {error_only, none, all}
  ```
  All fields overridable per profile. Matches CLAUDE.md "all model-shaped logic lives in the profile" rule — Gemma 4 may want different thresholds and different compact prompts.

- **D-16 (Claude's Discretion):** On summarization round-trip failure (timeout, parse error, model refusal), **fall back to structured pruning**: keep preserved set from D-14, drop everything else by order of age, log the fallback in the session event stream. Session continues. Alternative fail-loud would block a 200-turn session on a transient round-trip — worse UX than a noisy fallback.

- **D-17 (Claude's Discretion):** Visible **"compacting N turns…"** status line in the pi TUI during the summarization round-trip. User knows why there's a pause. Format and color at planner discretion.

### Lived-experience capture (TELEM-02 + TELEM-03)

- **D-18:** Alt+Up / Alt+Down captured via **pi TUI extension hook**. Research agent must first verify pi 0.68.0 exposes a public keybinding-registration API; if pi does, use it (best option — keybinds appear in pi's `?` help alongside pi's own). If pi does NOT, fall back to an emmy TUI keypress overlay that pre-filters Alt+Up/Alt+Down before pi sees them (register ADR-style deviation in `PROFILE_NOTES` + a short `docs/keybind-fallback.md`). The fallback path is acceptable; the "separate CLI command after the fact" option is explicitly rejected (loses in-the-moment capture).

- **D-19:** Alt+Up/Down rates the **most-recent completed agent turn** by `turn_id`. Simple, matches TELEM-02 spec verbatim, zero transcript-cursor UI needed.

- **D-20:** Feedback JSONL lives at **`~/.emmy/telemetry/feedback.jsonl`** (global across sessions, accumulates the lived-experience corpus). Schema verbatim from TELEM-02: `{session_id, turn_id, profile_id, profile_version, profile_hash, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out}`. Thumbs-down opens a free-text prompt (modal or inline — planner's call); thumbs-up commits immediately with empty `comment`. Atomic JSONL append pattern same as D-06.

- **D-21:** HuggingFace export is **`pi-emmy --export-hf <out_dir>`** (subcommand-style flag, keeps single binary contract with D-03 Phase-2 D-03). Produces a HuggingFace `datasets`-loadable artifact (JSONL-only MVP; HF `datasets.load_dataset("json", data_files=...)` loads natively; parquet + dataset_card.md deferred to Phase 7) mapping the feedback JSONL schema to HF types. Consent/redaction policy for logged code excerpts is a Phase 7 publication concern, not Phase 3 scope — but the exporter must emit a warning if the output dir contains any turn where `model_response` or `tool_calls` reference file contents.

### TUI footer (UX-02)

- **D-22:** Data sources are **vLLM `/metrics` endpoint + nvidia-smi subprocess** every 1s. vLLM exposes Prometheus-format `/metrics` natively: KV usage (`vllm:gpu_cache_usage_perc`), running requests, decode throughput (`vllm:decode_tokens_per_second` or equivalent), spec-decode efficiency (`vllm:spec_decode_efficiency`, populated only when spec decoding is enabled). nvidia-smi subprocess: `nvidia-smi --query-gpu=utilization.gpu,memory.used,clocks.gr --format=csv,noheader,nounits`. One subprocess/sec is cheap on Spark; ties to Phase 1's existing `GpuSampler` pattern (Python side — TS reimplements with `child_process.spawn`). Rationale: matches research/STACK.md expectation; matches SC-4 language "reads nvidia-smi + vLLM `/metrics`" verbatim.

- **D-23:** Footer refresh rate is **1 Hz** (1-second poll cadence). SC-4 requires ≥1Hz and values within 5% of CLI tools at the same instant. Higher cadence burns Spark cycles for UX no human perceives at 1Hz.

- **D-24 (Claude's Discretion):** Graceful degrade on `/metrics` 500 or nvidia-smi failure: show last-good value with `?` suffix for 3 consecutive poll-failures, then blank the field. Boot-time failure of either source blanks its fields; does not abort session (unlike SP_OK canary failure which does).

- **D-25:** `spec-accept %` shows `-` (dash) until Phase 6 enables speculative decoding. The field is reserved in the footer layout so Phase 6's feature-flip is just wiring the existing metric source to the existing footer slot.

### Offline-OK badge (UX-03)

- **D-26:** Audit compares every registered tool's **required-hosts set** to `union(loopback_set, harness.yaml.tools.web_fetch.allowlist)`. `loopback_set = {127.0.0.1, localhost, ::1, loopback}`. web_fetch's allowlist field is a new profile-level config (default: empty list, making web_fetch itself network-red until allowlisted). Badge green if ALL registered tool host requirements are in the union; red if any tool's declared host escapes the union. Rationale: matches CLAUDE.md "web_fetch … documentation reading allowed" — allowlisted doc hosts (`docs.python.org`, `developer.mozilla.org`, etc.) keep the badge green as intended.

- **D-27:** Audit runs at **session boot + every web_fetch call** (runtime enforcement). Boot audit sets initial badge color. Runtime: every `web_fetch(url)` call checks `url` against the allowlist; unlistedhost flips badge to red and logs the violation in the session event stream. Rationale: without runtime enforcement, SC-5's "pointing web_fetch at a non-allowlisted host flips the badge to red" fails — boot audit alone can't catch it.

- **D-28 (Claude's Discretion):** Red-state UX = **warn-and-continue**. Red badge + loud banner in the TUI footer area + log entry in session events; session proceeds. Matches CLAUDE.md "YOLO defaults" — fail-loud boot rejection is reserved for infrastructure problems (SP_OK, profile-validate, MCP poison, port collision), not for user-attested network tools. User sees they went red and can decide.

### Claude's Discretion (additional)

- Concrete event-stream schema for `runs/<session>/events.jsonl` — must align with ARCHITECTURE.md §7; planner shapes the turn/span/tool-call/result hierarchy.
- Session-ID scheme (ISO timestamp + short profile-hash prefix recommended, but planner's call).
- Exact Lark grammar / JSON schema for the compaction "preservation policy" — YAML primitives are good enough but planner may opt for a discriminated union.
- Whether footer auto-hides when terminal is too narrow to fit all four fields (TUI rendering detail).
- Whether nvidia-smi is called once per poll with `--query-gpu=utilization.gpu,memory.used,clocks.gr` or split into two calls — measurement coherence concern.
- Whether the HF exporter adds a provenance manifest (recommended) and its shape.
- Where (if anywhere) Phase 6's eventual spec-accept wiring pulls the per-session acceptance rate for the footer's live value — planner can leave a TODO(Phase-6) comment in a profile or in the footer module.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and constraints
- `.planning/PROJECT.md` — vision, "stand on shoulders" principle, observability as declared Active requirement
- `.planning/REQUIREMENTS.md` — 66 v1 REQ-IDs; Phase 3 specifically covers HARNESS-05/09, CONTEXT-02, TELEM-01/02/03, UX-02/03
- `.planning/ROADMAP.md` §"Phase 3: Observability + Agent-Loop Hardening + Lived-Experience" — goal + 5 success criteria (all five MUST be demonstrable by phase close)
- `.planning/STATE.md` — Phase 2 closed 2026-04-21 with SC-1 green; current focus = Phase 3; Phase-2 carry-forward deferrals listed
- `CLAUDE.md` — pinned tech stack, keystone profile abstraction, 8 critical pitfalls, design principles (especially "all model-shaped logic lives in the profile")

### Research docs (already synthesized — do not re-research)
- `.planning/research/STACK.md` — Langfuse v3 + ClickHouse-backed analytics + OTLP `/api/public/otel` endpoint; OTel GenAI semconv standardization March 2026; pi-coding-agent v0.68.0 extension API surface
- `.planning/research/ARCHITECTURE.md` §7 (observability event schema shape + JSONL-on-disk + optional OTLP fan-out), §8 (eight extension seams including observability-sink fan-out), §9 (lived-experience = `journal` tool in research note — NOTE: Phase 3 SC-3 uses Alt+Up/Down keybind per TELEM-02; the research doc's journal-tool framing predates the current spec), §3 (per-turn data flow — step 7 is the `extra_body.guided_decoding.grammar` seam Phase 2 D-11 uses reactively)
- `.planning/research/FEATURES.md` — table-stakes vs differentiator vs anti-feature taxonomy; lived-experience corpus as a uniquely-local differentiator
- `.planning/research/PITFALLS.md` — **#15** (tool-result truncation drops critical info — D-14 error/diagnostic preservation guardrail), **#16** (infinite ReAct loop — Phase 2 HARNESS-04 already shipped; Phase 3 observability makes it diagnosable), **#17** (SP scaffolding bloat — D-14 structural-core preservation is finite), **#18** (sub-agent observability black-box — Phase 3 closes this at the trace level), **#8** (hidden cloud deps — D-06/D-09 guardrails), **#6** (SP delivery silently broken — D-04 wire-throughs MUST preserve Phase 2's SP_OK canary on every session start)
- `.planning/research/SUMMARY.md` — research synthesis; Phase 3 flagged as "parallelizable module" post-Phase-2 stable

### Phase 1 + Phase 2 artifacts Phase 3 builds on (read before planning)
- `.planning/phases/01-serving-foundation-profile-schema/01-CONTEXT.md` — profile bundle schema (D-01..D-04 Phase 1), SP_OK canary library shape (D-07 Phase 1), fail-loud boot rejection pattern (D-06 Phase 1), atomic JSON append pattern (from code_context)
- `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md` — three Phase-1 deferrals still open; not Phase 3 scope
- `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-CONTEXT.md` — **locked workspace topology** (D-01 four `@emmy/*` packages), **Bun+TS** (D-02), **`pi-emmy` binary name** (D-03), **customTools wrapper pattern** (D-05..D-09 hash-anchored edit), **reactive grammar** (D-11), **MCP stdio-only + flat dispatch + Unicode poison gate** (D-15..D-18), **3-layer prompt + CONTEXT-04 locked prefix order** (Claude's Discretion E)
- `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-CLOSEOUT.md` — **THE** source of truth for the 5 carry-forward wire-throughs Phase 3 picks up; SC-1 findings (`2c22018` / `4049d95` / `85fa910` / `a17f4a9` live bug fixes — especially `a17f4a9` which D-02/D-04 remove); profile hash `sha256:24be3eea…85d8b` is the certified-at-close baseline Phase 3 inherits
- `profiles/qwen3.6-35b-a3b/v2/harness.yaml` — the v2 bundle Phase 3 extends; any new `harness.yaml.context.compaction.*` fields + `harness.yaml.tools.web_fetch.allowlist` trigger Phase 1 D-02 content-hash contract (profile becomes v3 on any field change — OR Phase 3 can bump v2→v3 in one coordinated commit with schema + values)
- `profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md` — existing provenance appendix; Phase 3 adds a `validation_runs` extension after the wave-close walkthrough
- `packages/emmy-telemetry/src/index.ts` — the Wave-0 stub with `emitEvent(record)` NO-OP signature; Phase 3 replaces body with atomic JSONL append + OTLP span emission
- `packages/emmy-ux/src/session.ts` — existing `createEmmySession` boot order and `registerEmmyProvider` / `registerNativeTools` / `registerMcpServers` call sites. D-01..D-04 flip these from NO-OP to real
- `emmy_serve/diagnostics/atomic.py:append_jsonl_atomic` — the Phase 1 atomic-append pattern `@emmy/telemetry` ports to TS

### Prior-repo continuity (reference only)
- `/data/projects/setup_local_opencode/validation/COMPREHENSIVE_FINAL_ANALYSIS.md` — Qwen3 Phase-3 SP-delivery incident; the specific failure D-04 wire-throughs must NOT reintroduce (SP_OK canary still fires on every session start)

### External (read-only, don't re-research)
- `https://langfuse.com/self-hosting` — Langfuse v3 compose stack + ClickHouse + Postgres + Redis configuration
- `https://langfuse.com/integrations/native/opentelemetry` — `/api/public/otel` endpoint spec
- `https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai` — OTel GenAI semconv (incubating) — span names, attribute names, `gen_ai.system`, `gen_ai.request.model`, etc.
- `https://github.com/open-telemetry/opentelemetry-js` — `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http` reference
- `https://github.com/badlogic/pi-mono` — pi-coding-agent 0.68.0 source (extension API: `BeforeProviderRequestEvent`, `createAgentSession({ customTools })`, keybind-registration discovery for D-18)
- vLLM `/metrics` Prometheus exposition — key metrics: `vllm:gpu_cache_usage_perc`, `vllm:num_requests_running`, `vllm:prompt_tokens_total`, `vllm:generation_tokens_total`, `vllm:spec_decode_efficiency`
- HuggingFace `datasets` schema — target format for `--export-hf`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1 + Phase 2)

- **`packages/emmy-telemetry/src/index.ts`** — Wave-0 stub with `emitEvent(record: TelemetryRecord)` NO-OP signature. **Already imported** by `packages/emmy-ux/src/session.ts` and destined to be imported by `@emmy/provider` + `@emmy/tools`. Phase 3 replaces the body (atomic JSONL append + OTel span emission); call sites don't need to change. This is the dividend of Phase 2 D-01's "empty telemetry stub now ≫ telemetry-retrofit-workspace later" decision.
- **`emmy_serve/diagnostics/atomic.py:append_jsonl_atomic`** — canonical fsync-then-rename atomic append pattern. `@emmy/telemetry` must match this behavior in TS (using `fs.promises.appendFile` + sync + rename, or a Bun-native equivalent). Same discipline as Phase 1 D-06 diagnostic bundle.
- **`packages/emmy-ux/src/session.ts` createEmmySession** — boot order (SP_OK → profile load → AGENTS.md discovery → assemble prompt → open transcript → build pi session → register provider/tools/MCP → subscribe events) is the place the 5 wire-throughs (D-01..D-04) flip from NO-OP to real. Especially `registerEmmyProvider`, `registerNativeTools`, `registerMcpServers` call sites at session bootstrap and the in-memory `ModelRegistry` + `AuthStorage` setup from `a17f4a9`.
- **`packages/emmy-provider/`** — streaming provider library, reactive grammar retry, OpenAI-compat strip. D-02 wires this as pi's `ModelRegistry.streamSimple` implementation for `emmy-vllm` provider name; `BeforeProviderRequestEvent` handler injects `chat_template_kwargs.enable_thinking:false` + `extra_body.guided_decoding.grammar` per the reactive-retry path.
- **`packages/emmy-tools/`** — 8 native tools + `editHashline` + MCP bridge + post-hoc diff + Unicode poison gate. D-03 wires these as `customTools` array in `createAgentSession`.
- **`profiles/qwen3.6-35b-a3b/v2/harness.yaml`** — current shape; Phase 3 extends `context.*` with `compaction:` block, extends `tools.*` with `web_fetch.allowlist:`, possibly adds `telemetry:` block if any profile-level telemetry knobs surface. Either bump v3 in one coordinated commit OR rely on v2's hash change to force it.
- **Phase 1 `GpuSampler` pattern (Python)** — reference for TS nvidia-smi wrapper (D-22). Handles `[N/A]` per-field on DGX Spark UMA (fix from Plan 01-07 Task 1); TS reimplementation must replicate.

### Established Patterns to Replicate

- **Strict schema + content-hash discipline** (Phase 1 profile-system): Phase 3 config additions (compaction block, web_fetch allowlist, telemetry toggles) are profile fields → any change bumps profile hash per Phase 1 D-02.
- **Atomic JSONL append for event streams** (Phase 1 diagnostics, Phase 2 `runs/phase2-sc3-capture/`): emmy's event stream, feedback JSONL, and any derived artifacts all follow this pattern.
- **Fail-loud boot rejection for infrastructure failures** (Phase 1 D-06): SP_OK canary failure, profile-validate failure, Langfuse compose failure (if in boot path — D-05 says NOT), MCP poison detection, port collision. NOT for user-facing red-state (D-28).
- **3-run measurement discipline on any tuning change** (Phase 2 SC-3 "reactive / disabled / no_per_tool_sampling" three-run): any Phase 3 change to compaction threshold, summarization prompt, or per-tool sampling must be measured on the full corpus, not a subset (Pitfall #5 guardrail).

### Integration Points

- **Phase-2 NO-OP stubs flipping to real** (D-01..D-04):
  - `packages/emmy-ux/src/session.ts` → `registerEmmyProvider(runtime, { endpoint, profile })` becomes a real `ModelRegistry.registerProvider(...).streamSimple` bind
  - `createEmmySession` → pass `customTools: [...emmyTools, ...mcpTools]` to `createAgentSession`
  - Add `session.on('before-provider-request', (req) => inject enable_thinking:false + extra_body)` hook
  - Replace `runPrint` message construction with pi's assembled-prompt-via-our-template path
  - Remove `<think>`-strip render post-processing (`a17f4a9` stopgap)
- **`@emmy/telemetry` fanout targets** (Phase 3):
  - Local file: `runs/<session_id>/events.jsonl` — authoritative
  - OTLP exporter to `http://localhost:3000/api/public/otel` — best-effort
- **Observability audit points** for every per-turn event:
  - Session start (prompt.sha256, profile.hash, tool-registry snapshot, offline-OK badge color)
  - Before provider request (assembled prompt + extra_body + grammar state)
  - After provider response (tokens_in, tokens_out, latency, spec_accept if populated, retry count)
  - Per tool call (name, args_hash, duration, exit_code/error_flag)
  - Compaction events (turns_elided, turns_preserved, summary_tokens)
  - Feedback rating events (turn_id, rating, comment)
  - Session end (turn_count, total_tokens, footer_summary_snapshot)
- **TUI footer data fetch** (D-22):
  - vLLM `/metrics` HTTP GET against `emmy-serve:8002/metrics` (or whatever port Phase 1 exposes — verify)
  - nvidia-smi subprocess via `child_process.spawn` with 1s cadence

### Node / Bun toolchain status

- Existing: Bun 1.3 workspace, `bun.lock` committed, 4 `@emmy/*` packages, pi-coding-agent 0.68.0 pinned
- Phase 3 new deps (candidate — planner validates air-gap compat):
  - `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/semantic-conventions`
  - Langfuse compose images (not a Bun dep; Docker side) pinned in `observability/langfuse/docker-compose.yaml`
  - Possibly `@huggingface/datasets-js` or a parquet writer for `--export-hf` — may be able to write raw parquet without a heavy dep
  - Every new dep: Phase 2 SC-1 discipline — audit outbound hosts on install, verify lockfile pinning, re-run air-gap CI

</code_context>

<specifics>
## Specific Ideas

- **`a17f4a9` is removable in Phase 3.** The `<think>`-strip at render time was a Phase-2 stopgap explicitly tagged "Phase 3 removes by routing adapter through streamSimple" in 02-CLOSEOUT. D-02 + D-04 + Plan 03-01 (wire-through wave) enable its removal. The commit that removes the strip should cite `a17f4a9` and `02-CLOSEOUT.md § SC-1 findings` in the message body.

- **SC-1-class walkthrough re-runs at phase close.** Phase 2 set the precedent: a real daily-driver walkthrough against a clean repo is the human-observable verdict that infrastructure changes haven't regressed feel. Plan-phase should include a "SC-1-style walkthrough" task at Phase 3 close using Phase 2's `/tmp/emmy-sc1-walkthrough/` fixture (or equivalent), with traces visible in Langfuse and a rating captured via Alt+Up to exercise the full new surface.

- **The 9 REQ-IDs must all flip to Done† or Done at close.** Phase 2's traceability discipline is the bar: every REQ-ID gets a SHIPPED + TESTED + evidence-captured claim. Phase 3 closes: HARNESS-05, HARNESS-09, CONTEXT-02, TELEM-01, TELEM-02, TELEM-03, UX-02, UX-03. Plus the 5 Phase-2 Done† items (wire-through deferred) should flip from "Done †" to "Done" when the respective wire-through lands.

- **Measurement is the test.** SC-2 says "without the agent losing the active task" — this is testable. The SC-2 driver must run a 200-turn synthetic replay that crosses the soft threshold, then verify (a) the goal turn is still in context, (b) the most recent 5 turns are verbatim, (c) error-flagged tool results are verbatim, (d) the agent can still reference `@file`-pinned content, (e) truncation rate per tool is observable in the resulting trace. All five are assertable from the JSONL event stream alone.

- **Pitfall #5 is the biggest ambient risk, still.** Phase 2 locked the SC-3 3-run discipline for grammar/sampling changes. Phase 3's compaction prompt is a prompt-change. Planner must include a 3-run variant matrix for any compaction-prompt tweak (default / alternate / disabled-compaction) against the full 200-turn fixture. No subset victory claims.

- **Stand on shoulders for span attribute names.** OTel GenAI semconv defines `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons` — use these verbatim rather than invent emmy-specific names. Only add custom `emmy.*` attributes for fields the semconv doesn't cover (`emmy.profile.id`, `emmy.profile.version`, `emmy.profile.hash`, `emmy.prompt.sha256`, `emmy.grammar.retry_count`).

- **"OFFLINE OK" is emmy's identity badge.** Of all Phase 3 surfaces, UX-03 is the one that most directly surfaces the project thesis. If daily-driver sessions regularly show red, the badge becomes noise; the allowlist design (D-26) is how we make "green" the common case for documentation-reading workflows while keeping the honesty that a non-allowlisted host flips red (D-27).

</specifics>

<deferred>
## Deferred Ideas

- **User-selected turn ratings** — rating older turns requires a transcript-cursor UI. TELEM-02 spec says "thumb a turn" without specifying which; most-recent (D-19) is the MVP. Revisit if daily-driver feedback shows users want to rate older turns.
- **Thumbs-down modal vs inline free-text** — UX detail; planner picks one, revisit if friction shows up.
- **`pi-emmy --export-hf` consent/redaction flow** — Phase 7 publication concern. D-21 emits a warning if file contents appear in the corpus; actual redaction policy + user consent prompt belongs in the public-artifact phase.
- **parquet + dataset_card.md emission in `--export-hf`** — Phase 7 publication concern. Phase 3 ships JSONL-only MVP; HF `datasets.load_dataset("json", ...)` works natively without a parquet writer. Amended 2026-04-21 per RESEARCH Open Question #3 resolution and user decision.
- **Prompt-injection (natural-language) runtime detection** — Phase 2 deferred; still deferred. Phase 3 observability makes suspicious tool-call patterns diagnosable but doesn't ship an auto-reject. Revisit when lived-experience corpus surfaces real cases.
- **Sub-agent observability (Pitfall #18)** — Phase 3 closes the trace-level picture but Phase 4's within-model routing (HARNESS-08) is when sub-agents really appear. Phase 3 instruments the seam (tool-call + turn + provider request spans); Phase 4 extends it with routing spans.
- **Alt-combo keybind alternatives** — if pi 0.68.0 doesn't expose a public keybinding API (D-18 research-agent concern), fallback is emmy TUI overlay. If both fail, the rate-CLI-after-the-fact fallback was explicitly rejected for MVP; revisit only if no in-TUI path works.
- **Langfuse prompt management + dataset UI features** — Phase 3 uses Langfuse as a trace viewer only. The prompt management + dataset features are Phase 5 (eval corpus) or Phase 7 (publication) territory.
- **Proactive compaction on long tool results** — D-11 says turn-boundary only. If a single tool result is larger than `max_input_tokens - structural_core_size`, hard ceiling fires (D-12) and session fail-louds. Mitigating this with proactive per-tool-result truncation-before-assembly is a Phase 4+ concern if it surfaces.
- **Second-model summarizer** — D-16 uses same vLLM endpoint. If summarization quality degrades on long sessions or steals too much budget, Phase 4/5 can add a dedicated smaller profile for compaction. Not Phase 3.
- **npm publish for `@emmy/*`** — still Phase 7.
- **Session replay UI** — ARCHITECTURE.md §7 mentions "replay reader reconstructs runs." Phase 3 writes the replay-capable JSONL but does not ship a replay UI. Phase 5 eval is the first consumer of replay.

</deferred>

---

*Phase: 03-observability-agent-loop-hardening-lived-experience*
*Context gathered: 2026-04-21*
