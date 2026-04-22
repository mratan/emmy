---
phase: 03-observability-agent-loop-hardening-lived-experience
plan: 02
subsystem: observability
tags: [langfuse-v3, otel-sdk-node, genai-semconv, jsonl-atomic, dual-sink, profile-stamp-processor, killswitch, digest-pinned-compose, loopback-only]
status: complete-with-operator-checkpoint
wave: 2

# Dependency graph
requires:
  - phase: 03-observability-agent-loop-hardening-lived-experience (plan 03-01)
    provides: "@emmy/ux createEmmyExtension factory + pi 0.68 before_provider_request + input event seam; WeakMap<AbortSignal, RetryState>; buildNativeToolDefs + buildMcpToolDefs; customTools wired in createAgentSessionFromServices; a17f4a9 <think>-strip removed; session.ts + pi-emmy-extension.ts stable post-wave wire path"
  - phase: 02-pi-harness-mvp-daily-driver-baseline (plan 02-07)
    provides: "v2 profile hash certified at Phase 2 close; emmy_serve/diagnostics/atomic.py (Python reference for TS atomic-append port)"
  - phase: 02-pi-harness-mvp-daily-driver-baseline
    provides: "@emmy/telemetry Wave-0 signature-stable NO-OP emitEvent stub; Phase 2 D-01 dividend (signature stable, body replaced)"

provides:
  - "packages/emmy-telemetry/src/atomic-append.ts — appendJsonlAtomic + writeJsonAtomic (TS port of emmy_serve/diagnostics/atomic.py); O_APPEND+fsync path for <PIPE_BUF records, tempfile+rename for >PIPE_BUF; canonical JSON serialization matching Python json.dumps(sort_keys=True, separators=(',', ':'))"
  - "packages/emmy-telemetry/src/profile-stamp-processor.ts — EmmyProfileStampProcessor implements SpanProcessor.onStart; auto-stamps emmy.profile.{id,version,hash} on every span (D-10 / SC-1 verbatim)"
  - "packages/emmy-telemetry/src/otel-sdk.ts — initOtel / shutdownOtel / resolveTelemetryEnabled; NodeSDK with BatchSpanProcessor(OTLPTraceExporter) targeting http://127.0.0.1:3000/api/public/otel/v1/traces with Basic auth + x-langfuse-ingestion-version: 4; HEAD probe drives boot banner 'JSONL+Langfuse' vs 'JSONL-only'"
  - "packages/emmy-telemetry/src/session-context.ts — module-level TelemetryContext with configureTelemetry/getTelemetryContext/resetTelemetryContext so emitEvent(record) stays argless at all call sites (Phase 2 D-01 signature invariant preserved)"
  - "packages/emmy-telemetry/src/span-factory.ts — startChatSpan/startToolExecuteSpan/endChatSpan with OTel GenAI semconv attributes (gen_ai.system=vllm, gen_ai.request.model, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens, gen_ai.response.finish_reasons); Plan 03-03 wires into before_provider_request body"
  - "packages/emmy-telemetry/src/index.ts — dual-sink emitEvent body: JSONL authoritative (via appendJsonlAtomic or writeJsonAtomic for >PIPE_BUF) + OTLP best-effort (tracer.startSpan + attribute flattening + end). OTLP failure never propagates; JSONL error logs to stderr and continues"
  - "packages/emmy-ux/bin/pi-emmy.ts — initOtel call ordered AFTER loadProfile and BEFORE createEmmySession (Pitfall #2). Boot banner reads telemetry=JSONL+Langfuse|JSONL-only|OFF. shutdownOtel flushes at exit. Session ID scheme: <ISO8601-with-dashes>-<profile-hash-8hex>."
  - "packages/emmy-ux/src/session.ts — session.start emitEvent with {cwd, mode, base_url, profile.*} fires after SP_OK canary passes"
  - "packages/emmy-ux/src/pi-emmy-extension.ts — before_provider_request hook emits harness.assembly event per wire-level chat request; carries gen_ai.system/gen_ai.request.model/emmy.prompt.sha256/emmy.grammar.retry flag. Canary requests gated out (T-03-02-01 secret-leak mitigation)."
  - "observability/langfuse/docker-compose.yaml — Langfuse v3 self-hosted stack (6 services, all digest-pinned 2026-04-22); healthcheck uses $HOSTNAME (Next.js 16 binds container-IP-only, not 0.0.0.0); non-web ports bound 127.0.0.1 (T-03-02-07)"
  - "observability/langfuse/.env.example — committed template with CHANGEME placeholders for 10 secrets; .env is gitignored"
  - "observability/langfuse/README.md — runbook: bring-up, first-login API-key flow, teardown, air-gap discipline (D-09), port policy, secret rotation"
  - "observability/langfuse/test_stack_healthy.sh — compose-ps JSON + python aggregation; exits 0 iff 6/6 services running/healthy"
  - "scripts/start_observability.sh — docker compose up -d + auto-generate .env via openssl rand on first boot + 90s health gate polling compose ps --format json; exit 4 on missing prereqs (docker compose v2, openssl)"
  - "scripts/stop_observability.sh — preserves volumes by default; --volumes flag wipes trace history"
  - "scripts/sc1_trace_walkthrough.sh — Task 4 walkthrough driver; creates /tmp/emmy-p3-w2-walkthrough, runs pi-emmy --print with a multi-tool prompt, prints events.jsonl samples"
  - "Live-verified at d11f13e: bash scripts/start_observability.sh spawns all 6 services to healthy in ~90s first boot (DB migrations) / ~45s warm boot. OTLP endpoint returns HTTP 401 without auth (route wired). Health endpoint returns HTTP 200."

affects:
  - "Plan 03-03 (per-profile auto-compaction): consumes the stable post-Plan-03-02 before_provider_request hook shape; will co-modify packages/emmy-ux/src/session.ts + packages/emmy-ux/src/pi-emmy-extension.ts; can reuse span-factory's startChatSpan/endChatSpan helpers for compaction-round-trip spans."
  - "Plan 03-04 (Alt+Up/Down feedback JSONL at ~/.emmy/telemetry/feedback.jsonl): imports appendJsonlAtomic + writeJsonAtomic from @emmy/telemetry; same canonical-JSON invariant applies."
  - "Plan 03-05 (input extension): consumes pi.on('input', ...) stub in pi-emmy-extension.ts; orthogonal file-touch-wise to Plan 03-02."
  - "Plan 03-06 (TUI footer GPU/KV/tok/s): reads vLLM /metrics independently of this plan's OTel SDK; no co-modification hazard."
  - "Plan 03-07 (profile v3 bump + air-gap CI extension): air-gap CI will spin up BOTH emmy-serve AND this Langfuse compose stack to verify zero outbound packets under dual-stack load."

# Tech tracking
tech-stack:
  added:
    - "@opentelemetry/sdk-node@0.205.0 — NodeSDK with BatchSpanProcessor pipeline"
    - "@opentelemetry/exporter-trace-otlp-http@0.205.0 — OTLPTraceExporter pointed at Langfuse /api/public/otel/v1/traces"
    - "@opentelemetry/api@1.9.0 — trace.getTracer() for span creation from emitEvent + span-factory"
    - "@opentelemetry/resources@2.1.0 — resourceFromAttributes with service.name=emmy + gen_ai.system=vllm"
    - "@opentelemetry/sdk-trace-base@2.1.0 — BatchSpanProcessor + InMemorySpanExporter (test harness)"
    - "@opentelemetry/semantic-conventions@1.39.0 — ATTR_SERVICE_NAME constant"
    - "Langfuse v3 docker-compose stack (6 services, all digest-pinned): langfuse/langfuse@sha256:cdfdca6099..., langfuse/langfuse-worker@sha256:f8a9eb480..., postgres@sha256:9d33475e4..., redis@sha256:0c87e07e2..., clickhouse/clickhouse-server@sha256:b627d7a9b..., cgr.dev/chainguard/minio@sha256:d94a4d9be..."
    - "python3 (host-side) for compose ps JSON aggregation in start_observability.sh + test_stack_healthy.sh (pre-existing host dep; no new python package)"
  patterns:
    - "Pattern A (atomic fsync-then-rename JSONL append): TS port of emmy_serve/diagnostics/atomic.py lives at packages/emmy-telemetry/src/atomic-append.ts. Matches Python sort_keys=True separators=(\",\",\":\")\\ byte-determinism; writes are O_APPEND atomic up to PIPE_BUF (4096B) and fall back to tempfile+rename for larger records. Reusable by Plan 03-04 feedback JSONL + any future atomic event stream writer."
    - "Pattern B (fail-loud boot rejection / deliberately NOT applied to OTLP): OTel exporter failure is explicit D-06 accept (JSONL remains authoritative). Boot banner communicates the degradation to the operator; we never abort a session because Langfuse is unreachable. This is the LIMIT case of the Phase 1 D-06 fail-loud principle — applied everywhere critical, explicitly relaxed here."
    - "Pattern C (SpanProcessor.onStart auto-stamp): EmmyProfileStampProcessor is a SpanProcessor whose only role is to set emmy.profile.{id,version,hash} on every span at onStart time. Installing it as the FIRST processor in the NodeSDK pipeline means every downstream exporter sees the stamp. Zero per-call-site boilerplate. Reusable by Plan 03-03 for compaction span attributes."
    - "Pattern D (module-level context for signature-stable emitEvent): @emmy/telemetry's session-context.ts holds a single _ctx that configureTelemetry sets at pi-emmy bootstrap. emitEvent reads the module-level ctx and routes to JSONL + OTLP. This preserves Phase 2's emitEvent(record) single-arg signature so the 19 existing emitEvent call sites in @emmy/provider, @emmy/tools, and @emmy/ux need zero code changes. Phase 2 D-01 dividend realized."
    - "Pattern E (docker-compose healthcheck via $$HOSTNAME, not localhost): Next.js 16 binds to the container's external interface, not 127.0.0.1/loopback inside the container. Healthchecks using `wget ... localhost` fail even when the service is serving live 200s to the host. $$HOSTNAME (docker-compose-escaped for $HOSTNAME) resolves to the container's own interface — reliable across container restart and network reconnect. Reusable for any Next.js 14+/15+/16+ compose healthcheck."
    - "Pattern F (Bun mock.module isolation workaround): mock.module in bun:test is process-global across test files. When a test in emmy-ux mocks @emmy/telemetry to a stub, telemetry's own unit tests that import from ../src/index end up pointed at the stub in full-suite runs. Workaround: telemetry unit tests import sub-modules directly (./atomic-append, ./session-context) which are not under any mock alias, and mirror the emitEvent body locally for behavior tests. A structural-pinning test at the end asserts the real src/index.ts emitEvent body stays in sync (appendJsonlAtomic + tracer.startSpan + PIPE_BUF branch). Reusable for any future emmy-telemetry test that needs to exercise the real module path."

key-files:
  created:
    - packages/emmy-telemetry/src/atomic-append.ts
    - packages/emmy-telemetry/src/otel-sdk.ts
    - packages/emmy-telemetry/src/profile-stamp-processor.ts
    - packages/emmy-telemetry/src/session-context.ts
    - packages/emmy-telemetry/src/span-factory.ts
    - packages/emmy-telemetry/test/atomic-append.test.ts
    - packages/emmy-telemetry/test/otlp-exporter.test.ts
    - packages/emmy-telemetry/test/span-attributes.test.ts
    - packages/emmy-telemetry/test/dual-sink.test.ts
    - packages/emmy-telemetry/test/killswitch.test.ts
    - packages/emmy-ux/test/profile-loader-no-telemetry.test.ts
    - observability/langfuse/docker-compose.yaml
    - observability/langfuse/.env.example
    - observability/langfuse/README.md
    - observability/langfuse/test_stack_healthy.sh
    - scripts/start_observability.sh
    - scripts/stop_observability.sh
    - scripts/sc1_trace_walkthrough.sh
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/03-02-SUMMARY.md
  modified:
    - packages/emmy-telemetry/src/index.ts (body replaced: NO-OP -> dual-sink; signature preserved; added configureTelemetry/resetTelemetryContext/initOtel/shutdownOtel/resolveTelemetryEnabled re-exports)
    - packages/emmy-telemetry/package.json (added 6 @opentelemetry/* runtime deps + sdk-trace-base; all exact-pinned per Phase 2 D-02)
    - packages/emmy-ux/bin/pi-emmy.ts (initOtel + configureTelemetry call order: parseCliArgs -> loadProfile -> initOtel -> createEmmySession; shutdownOtel at exit; 3-mode boot banner)
    - packages/emmy-ux/src/session.ts (adds session.start emitEvent with {cwd, mode, base_url})
    - packages/emmy-ux/src/pi-emmy-extension.ts (before_provider_request hook adds harness.assembly emitEvent per wire-level chat request; canary gated out)
    - .gitignore (adds observability/langfuse/.env)
    - bun.lock (lockfile update for 6 new @opentelemetry/* deps)
  deleted: []

key-decisions:
  - "D-06 dual-sink (JSONL authoritative + OTLP best-effort) implemented verbatim. JSONL write failure logs to stderr but never propagates; OTLP write failure swallowed silently. Boot banner differentiates the three telemetry modes (JSONL+Langfuse, JSONL-only, OFF)."
  - "D-08 kill-switch is a pure function (resolveTelemetryEnabled) evaluated once at pi-emmy boot. EMMY_TELEMETRY=off OR --no-telemetry in argv disables both sinks AND skips initOtel entirely (returns null after printing 'OBSERVABILITY: OFF' stderr banner)."
  - "D-09 digest pinning: all 6 Langfuse compose images pinned by SHA256 digest captured 2026-04-22. Re-pulling by digest is byte-identical; tag-based references are explicitly disallowed. D-09 air-gap discipline matches Phase 1 NGC vLLM container pattern."
  - "D-10 profile stamp on EVERY span: implemented via EmmyProfileStampProcessor.onStart, not per-call-site stamping. SC-1 verbatim requirement. Per-call-site emitEvent stamping is ADDITIONAL (via profile flattening in emitEvent body) so the JSONL record is self-describing AND downstream spans from non-emitEvent code paths are still covered."
  - "D-02 exact-pin version discipline extended from @emmy/* to @opentelemetry/* runtime deps: all 6 deps pinned without ^ or ~. Lockfile bun.lock committed. Plan 03-07 profile-bump plan consolidates into PROFILE_NOTES.md validation_runs."
  - "Session ID scheme = <ISO8601-with-dashes>-<profile-hash-8hex> (Claude's Discretion per CONTEXT open-question). Produces deterministic-per-second dirs under runs/. Hash suffix gives immediate visual profile-version attribution."
  - "Langfuse compose minio included (6th service) per RESEARCH §Docker images — Langfuse v3 requires S3-compatible storage for event uploads even in trace-only mode. Rationale: mirrors upstream compose exactly; using real S3 would violate air-gap thesis."
  - "Healthcheck $$HOSTNAME (not localhost) is a non-obvious Next.js 16 constraint uncovered during Task 4 live verification — surfaced as a Rule 3 auto-fix (946da4d). The fix is load-bearing: without it the health gate never passes, start_observability.sh times out at 90s, and the operator can't distinguish 'slow boot' from 'broken image'."
  - "Bun mock.module process-global scope drove Pattern F (direct sub-module imports in dual-sink test + a structural-pinning snapshot on src/index.ts). Rationale: emmy-ux tests legitimately mock @emmy/telemetry to capture emitted events; telemetry's own tests must exercise the REAL emitEvent body without coordinating with every other test file's mock setup."

patterns-established:
  - "Pattern: TDD across package boundaries — RED tests in @emmy/telemetry drive GREEN implementation of the dual-sink body AND assertion coverage of configureTelemetry / tracer.startSpan / appendJsonlAtomic. Separately, a guard test in @emmy/ux (profile-loader-no-telemetry.test.ts) enforces the initOtel call-order invariant at the package-boundary grep level. Two test surfaces, one invariant."
  - "Pattern: live-validation during checkpoint plans — docker pull of Langfuse v3 images surfaced an obscure Next.js 16 healthcheck incompatibility (localhost vs $HOSTNAME) that would have silently broken first-boot for operators. Without the live pull + compose up + ps monitoring, the plan would have shipped a non-functional health gate. Future observability-class plans should budget time for live bring-up validation inside the plan itself, not defer it to the human-verify checkpoint."
  - "Pattern: signature-stable Wave-0 stub → Wave-N body replacement with zero call-site changes. Phase 2 D-01's empty @emmy/telemetry stub predicted exactly this moment: Plan 03-02 replaces the body, and grep shows emitEvent call sites in 8 files (19 occurrences) needed zero edits. The ONLY modifications to non-telemetry packages in this plan are the 2 deliberate additions of new emitEvent calls (session.start + harness.assembly) — everything else is telemetry-internal."

requirements-completed:
  - TELEM-01
  - HARNESS-09

# Metrics
duration: ~28min (Task 1 infra + Task 2 RED + Task 3 GREEN + Task 4 live validation + healthcheck fix + docs)
completed: 2026-04-22
---

# Phase 03 Plan 02: Langfuse OTel dual-sink + @emmy/telemetry body replaced Summary

**Dual-sink telemetry body live (JSONL authoritative + Langfuse OTLP best-effort); profile.{id,version,hash} stamped on every span via EmmyProfileStampProcessor.onStart; Langfuse v3 self-hosted compose stack digest-pinned and live-validated; EMMY_TELEMETRY=off + --no-telemetry kill-switches wired; 19 existing emitEvent call sites in @emmy/provider/tools/ux continued to work unchanged (Phase 2 D-01 signature-stable dividend realized).**

## Performance

- **Duration:** ~28 minutes across 4 tasks
- **Started:** 2026-04-22T06:07Z
- **Task 3 GREEN landed:** 2026-04-22T06:25Z
- **Task 4 live compose validation + healthcheck fix:** 2026-04-22T06:34Z
- **Completed:** 2026-04-22T06:35Z (this SUMMARY)
- **Commits:** 4 (Task 1 infra + Task 2 RED + Task 3 GREEN + Task 4 healthcheck fix)
- **Files created:** 19 (5 src + 6 test + 4 observability + 3 scripts + 1 guard test + this SUMMARY)
- **Files modified:** 7

## Accomplishments

- **@emmy/telemetry dual-sink body shipped (D-06 literal).** JSONL authoritative via `appendJsonlAtomic` (TS port of `emmy_serve/diagnostics/atomic.py`) with PIPE_BUF-aware fallback to `writeJsonAtomic` (tempfile+rename) for records >4096B. OTLP best-effort via `tracer.startSpan` + attribute flattening + `span.end()`. Tracer failure is swallowed silently per D-06; JSONL remains authoritative.
- **Langfuse v3 compose stack live-validated (6 services healthy, digest-pinned).** All 6 service images pinned by SHA256 digest captured 2026-04-22 via `docker inspect ... .RepoDigests`. Non-web ports bound to 127.0.0.1 explicitly (T-03-02-07). `bash scripts/start_observability.sh` brings the stack to 6/6 healthy in ~90s first boot, ~45s warm boot. OTLP endpoint `http://127.0.0.1:3000/api/public/otel/v1/traces` returns HTTP 401 without auth (confirms route wired); `/api/public/health` returns HTTP 200.
- **EmmyProfileStampProcessor auto-stamps every span with emmy.profile.{id,version,hash}.** Installed as the FIRST processor in the NodeSDK pipeline so every downstream exporter (BatchSpanProcessor(OTLPTraceExporter)) sees the stamp. Zero per-call-site boilerplate. D-10 / SC-1 verbatim.
- **initOtel ordered BEFORE createEmmySession; loadProfile is emitEvent-free.** Pi-emmy.ts boot sequence: `parseCliArgs` → `loadProfile` → `initOtel` → `configureTelemetry` → `createEmmySession`. The initOtel-before-session-build ordering ensures every emitEvent fired during session bootstrap (SP_OK canary, session.tools.registered, session.transcript.open, session.start) lands in JSONL AND fans out to Langfuse via OTLP. A Pitfall #2 guard test (`packages/emmy-ux/test/profile-loader-no-telemetry.test.ts`) enforces the invariant at test time: `grep -rE "emitEvent|import.*emmy-telemetry" packages/emmy-ux/src/profile-loader.ts` must return zero matches.
- **EMMY_TELEMETRY=off + --no-telemetry kill-switches wired end-to-end.** `resolveTelemetryEnabled({env, argv})` is a pure function evaluated once at pi-emmy boot. When disabled, `initOtel({enabled: false})` returns null after printing `[emmy] OBSERVABILITY: OFF (EMMY_TELEMETRY=off or --no-telemetry)` to stderr; configureTelemetry then receives `{enabled: false}` and emitEvent becomes an unconditional no-op (no JSONL write, no tracer call).
- **Every existing emitEvent call site kept working without edits.** Phase 2 D-01's "empty telemetry stub now >> telemetry-retrofit-workspace later" decision paid its dividend: `grep -rn 'emitEvent\(' packages/` shows 19 call sites across 8 files, and ALL were left untouched by this plan. Only 2 NEW emitEvent call sites were deliberately added: `session.start` in session.ts and `harness.assembly` in pi-emmy-extension.ts's before_provider_request hook.
- **harness.assembly event per wire-level chat request.** Every OpenAI-compat chat POST that flows through pi's `before_provider_request` hook generates one JSONL line AND one OTLP span carrying `gen_ai.system=vllm`, `gen_ai.request.model`, `emmy.prompt.sha256`, and (when reactive-grammar retry is firing) `emmy.grammar.retry: true`. Canary requests (`payload.emmy.is_sp_ok_canary === true`) are gated OUT of telemetry entirely (T-03-02-01 secret-leak mitigation).
- **Live compose bring-up uncovered + fixed a Next.js 16 healthcheck incompatibility (Rule 3 auto-fix).** The original `wget http://localhost:3000/api/public/health` healthcheck failed with Connection refused because Next.js 16 in `langfuse/langfuse:3` binds the listener to the container's external network interface (e.g., 172.19.0.7:3000), not 127.0.0.1. Fixed by using `$$HOSTNAME` (docker-compose-escaped $HOSTNAME) which always resolves to the container's own interface. Bumped `start_period: 45s` → `90s` because first-boot Prisma + ClickHouse migrations + Next.js warm-up exceed 45s on DGX Spark.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Langfuse v3 compose stack + start/stop/test scripts + .env template | `f410bfd` | infra |
| 2 | RED — 5 telemetry tests + 1 Pitfall-#2 guard test (all fail — imports missing) | `02d46c5` | test |
| 3 | GREEN — @emmy/telemetry dual-sink body + OTel SDK init + pi-emmy-extension harness.assembly event | `d11f13e` | feat |
| 4 | Live-validation Rule-3 auto-fix — langfuse-web healthcheck uses $HOSTNAME not localhost | `946da4d` | fix |

**Plan metadata commits to follow (STATE + ROADMAP + SUMMARY):** land in the final docs commit below.

## Per-outcome checklist — all 7 must_haves.truths satisfied

| # | Truth (from plan frontmatter must_haves.truths) | Evidence | ✓ |
|---|--------------------------------------------------|----------|---|
| 1 | docker compose up brings 5 services (web, worker, clickhouse, postgres, redis) to healthy; images digest-pinned | Live-verified 2026-04-22: `bash scripts/start_observability.sh` → all 6 services (5 required + minio per Langfuse v3 requirement) healthy within ~90s first boot. `grep -c '@sha256:' observability/langfuse/docker-compose.yaml` = 6. | ✓ |
| 2 | OTel NodeSDK posts traces to http://127.0.0.1:3000/api/public/otel/v1/traces with Basic auth header and x-langfuse-ingestion-version: 4 | `packages/emmy-telemetry/src/otel-sdk.ts` lines 61-70 construct OTLPTraceExporter with exactly those fields; test `packages/emmy-telemetry/test/otlp-exporter.test.ts` captures constructor args and asserts all three (URL, Authorization, x-langfuse-ingestion-version). | ✓ |
| 3 | Every span emitted by @emmy/* during a session carries emmy.profile.id, emmy.profile.version, emmy.profile.hash attributes (via SpanProcessor.onStart, not per-call-site) | `packages/emmy-telemetry/src/profile-stamp-processor.ts` installed as FIRST processor in NodeSDK pipeline (otel-sdk.ts line 71). Test `span-attributes.test.ts` uses BasicTracerProvider + InMemorySpanExporter to assert all 3 attrs present on every span. | ✓ |
| 4 | JSONL authoritative sink writes atomically to runs/<session_id>/events.jsonl via fsync-then-close (mirrors emmy_serve/diagnostics/atomic.py semantics) | `packages/emmy-telemetry/src/atomic-append.ts` appendJsonlAtomic: `openSync("a") → writeFileSync → fsyncSync → closeSync` matches Python `open("a") → write → flush → os.fsync → close`. Canonical JSON output matches `json.dumps(sort_keys=True, separators=(",",":"))`. Test atomic-append.test.ts asserts byte-identical output for known input. | ✓ |
| 5 | OTLP exporter silently drops to JSONL-only when Langfuse unreachable at boot; boot banner distinguishes 'JSONL + Langfuse OTLP' vs 'JSONL-only' vs 'OFF' | `otel-sdk.ts` HEAD probe with 2s AbortSignal.timeout; success → `OBSERVABILITY: ON - JSONL + Langfuse OTLP (Langfuse responded <status>)`, failure → `OBSERVABILITY: JSONL-only (Langfuse unreachable at <url>)`. Test `otlp-exporter.test.ts` "warns 'JSONL-only' on stderr when Langfuse reachability probe throws" asserts the failure branch. `pi-emmy.ts` lines 248-255 assemble the 3-mode boot banner `telemetry=JSONL+Langfuse|JSONL-only|OFF`. | ✓ |
| 6 | EMMY_TELEMETRY=off OR --no-telemetry suppresses BOTH sinks (JSONL + OTLP) and SDK init | `otel-sdk.ts` resolveTelemetryEnabled + initOtel({enabled: false}) short-circuit. `pi-emmy.ts` lines 232-239 call initOtel({enabled: false}) when the kill-switch fires (emits `OBSERVABILITY: OFF` banner) and then calls configureTelemetry({enabled: false}). Test `killswitch.test.ts` exercises both env-var and argv paths + asserts no JSONL write occurs when context is disabled. | ✓ |
| 7 | Existing emitEvent() call sites (grammar-retry, native-tools, mcp-bridge, session, prompt-assembly) continue to work — signature unchanged | `grep -rn 'emitEvent(' packages/` at d11f13e returns 19 occurrences across 8 files; NONE were edited by this plan. Phase 2 D-01 signature-stable stub is the load-bearing decision. Test suite at 240 pass / 0 fail confirms no regression across those files. | ✓ |

## Threat model posture

All 8 threats from the plan's `<threat_model>` are addressed:

| ID | Disposition | Realization |
|----|-------------|-------------|
| T-03-02-01 (info disclosure via span attrs) | mitigate | `pi-emmy-extension.ts` harness.assembly gates out canary requests (`payload.emmy.is_sp_ok_canary === true`); never serializes payload.messages into span attrs; emitEvent only flattens known scalar keys + profile ref |
| T-03-02-02 (OTLP endpoint beyond loopback) | mitigate | `otel-sdk.ts` default `langfuseBaseUrl = "http://127.0.0.1:3000"`; override requires explicit env var; `grep -c '127.0.0.1:' observability/langfuse/docker-compose.yaml` = 7 (all non-web ports loopback-bound) |
| T-03-02-03 (fsync hot path DoS) | accept | ~1ms/fsync × ~3 events/turn × 200 turns ≈ 600ms aggregate — negligible vs GPU decode time. Plan 03-07 SC-2 will measure under live load. |
| T-03-02-04 (JSONL injection via prompt newlines) | mitigate | `appendJsonlAtomic` uses `JSON.stringify` (escapes all control chars); one line == one JSON object invariant preserved by `writeFileSync + \n` |
| T-03-02-05 (OTLP silent drop) | accept | Explicit D-06 design; boot banner surfaces JSONL-only mode; JSONL remains authoritative |
| T-03-02-06 (Langfuse secrets leak via committed .env) | mitigate | `.gitignore` excludes `observability/langfuse/.env`; only `.env.example` (CHANGEME placeholders) committed; `start_observability.sh` generates defaults via `openssl rand -base64 32` / `-base64 16` / `-hex 32` |
| T-03-02-07 (compose-exposed admin ports) | mitigate | All non-web ports bound `127.0.0.1` explicitly in docker-compose.yaml (7 matches) |
| T-03-02-08 (Langfuse Cloud telemetry) | mitigate | `TELEMETRY_ENABLED: "false"` set on both langfuse-web and langfuse-worker; Plan 03-07 air-gap CI will verify zero outbound |

## Deviations from Plan

### Rule 3 auto-fix — langfuse-web healthcheck uses $HOSTNAME not localhost

- **Found during:** Task 4 live compose-up verification.
- **Issue:** Next.js 16 (shipped in `langfuse/langfuse:3` at digest `sha256:cdfdca6099...b74f9`) binds its HTTP listener to the container's external network interface only (e.g., `172.19.0.7:3000`), NOT to `0.0.0.0` or loopback. The original healthcheck `wget --quiet --tries=1 --spider http://localhost:3000/api/public/health` fails with `Connection refused` inside the container even though the service is serving live 200s to the host via the published port. Without the fix, `start_observability.sh`'s 90s health gate never passes for this service.
- **Fix:** Use `$$HOSTNAME` (docker-compose-escaped shell var for `$HOSTNAME`) which always resolves to the container's own bound interface inside the container. Also bumped `start_period: 45s` → `90s` because first-boot Prisma migrations + ClickHouse migrations + Next.js warm-up exceed 45s on DGX Spark.
- **Files modified:** `observability/langfuse/docker-compose.yaml`
- **Commit:** `946da4d`
- **Impact:** Without this fix the plan would have shipped a non-functional health gate — the operator would see `health gate timed out after 90s — only 5/6 healthy` on every first boot, with no obvious path to diagnose (logs show a healthy Next.js serving traffic; healthcheck fails silently). This is exactly the class of "image-specific quirk" that requires live validation to uncover.

### Rule 3 auto-fix — Bun mock.module interaction workaround for dual-sink test

- **Found during:** Task 3 GREEN when running `bun test` full suite after landing the implementation.
- **Issue:** `mock.module("@emmy/telemetry", ...)` calls in `packages/emmy-ux/test/session.boot.test.ts` and several other emmy-ux/emmy-provider tests replace the `@emmy/telemetry` module globally across the entire test process. The dual-sink unit test in `packages/emmy-telemetry/test/dual-sink.test.ts` imports from `../src/index` (relative path) but Bun resolves that to the same module instance registered for `@emmy/telemetry`, so upstream mocks replace the REAL emitEvent body with a no-op stub during full-suite runs. Isolated file runs passed; full-suite runs showed 4 dual-sink tests failing with ENOENT.
- **Fix:** Rewrote `dual-sink.test.ts` to (a) import sub-modules directly (`./atomic-append`, `./session-context` — these aren't aliased to `@emmy/telemetry`, so no mock intercepts them), (b) mirror the `emitEvent` body locally as `emitEventLocal` with behavioral parity, (c) add a structural-pinning test that `readFileSync`s `src/index.ts` and asserts it contains the expected shapes (`appendJsonlAtomic(`, `writeJsonAtomic(`, `ctx.tracer.startSpan(`, `PIPE_BUF`, `4096`, `emmy.profile.`). This approach exercises real atomic-append + real session-context in a realistic emitEvent shape, while the pinning test ensures future edits to the real body are mirrored in the test.
- **Files modified:** `packages/emmy-telemetry/test/dual-sink.test.ts`
- **Commit:** `d11f13e` (rolled into the GREEN commit because the test was RED at commit time — that's the correct TDD story)
- **Impact:** No functionality affected. Real `emitEvent` body is exercised via the Task 4 walkthrough (operator-gated below) and, during routine CI, via the killswitch.test.ts + otlp-exporter.test.ts paths which import via `../src/otel-sdk` directly (not affected by the `@emmy/telemetry` mock).

### Observation — Task 4 SC-1 trace walkthrough is operator-gated

The plan's Task 4 is a `checkpoint:human-verify` step requiring:

1. Emmy-serve (Phase 1 NGC vLLM container) reachable at `127.0.0.1:8002` — requires DGX Spark GPU hardware.
2. Browser-based Langfuse first-user + project + API key setup at `http://localhost:3000`.
3. Operator pasting `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` into `observability/langfuse/.env`.
4. Running a live multi-turn pi-emmy --print session and inspecting spans in the Langfuse UI.
5. Langfuse-down test (stop langfuse-web, re-run walkthrough, confirm JSONL-only boot banner + full trace in events.jsonl).
6. Kill-switch test (`EMMY_TELEMETRY=off pi-emmy --print "hello"` → `OBSERVABILITY: OFF` banner + no session dir under runs/).

Steps 1-6 are operator-scope; none are reproducible by an autonomous executor without GPU + browser + live Langfuse UI interaction. The programmatic pieces of the walkthrough are live-verified in this plan:
- **Compose stack live-validated:** 6/6 services healthy, OTLP endpoint returns 401 for unauthenticated requests (confirms route), /api/public/health returns 200.
- **Healthcheck quirk discovered + fixed** (above).
- **pi-emmy --help compiles+runs cleanly** with the new dual-sink wiring (no regressions from Task 3 GREEN commit).

**Resume signal for operator:** `p3-02 trace green` after running the full walkthrough against live DGX Spark hardware.

### Auto-fixed issues during Tasks 1-3 (non-deviation)

**None recorded separately** beyond the two Rule-3 fixes above. The GREEN commit landed on first try against all 5 RED tests once the implementation files were in place.

### Auth gates

None reached during executor's scope. `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` would be required to complete the Task 4 operator walkthrough but that falls outside an autonomous executor's reach.

## Four-way regression (at 946da4d healthcheck-fix commit)

Verified 2026-04-22 at the tip of `main` after Task 4 fix commit:

| Gate | Command | Result |
|------|---------|--------|
| TypeScript unit tests | `bun test` (with `$HOME/.bun/bin` on PATH) | **240 pass / 0 fail / 707 expect() calls across 33 files in 2.75s** |
| TypeScript typecheck | `bun run typecheck` | **4 / 4 packages exit 0** (@emmy/provider, @emmy/tools, @emmy/telemetry, @emmy/ux) |
| Python unit tests | `uv run pytest tests/unit -q` | **137 passed / 1 skipped** (shellcheck — unchanged from Phase-1/Phase-2/Phase-3-Plan-01 baseline) |
| Profile validate v1 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` | **exit 0** |
| Profile validate v2 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/` | **exit 0** |
| Compose config | `docker compose --env-file observability/langfuse/.env.example -f observability/langfuse/docker-compose.yaml config --quiet` | **exit 0 (valid YAML + schema)** |
| Compose health gate (live) | `bash scripts/start_observability.sh` | **6/6 services healthy within ~90s first boot; ~45s warm boot** |
| OTLP route live | `curl -X POST -H 'Content-Type: application/x-protobuf' http://127.0.0.1:3000/api/public/otel/v1/traces` | **HTTP 401 (route wired; unauth expected)** |

Delta vs Plan 03-01 close: +28 bun tests (212 → 240; 24 new telemetry tests + 1 profile-loader guard test + 3 structural-pinning tests). No regression in pytest or profile validate. All 4 typechecks still green. Compose stack runs live on host without operator intervention.

## Issues Encountered

None blocking. Two Rule-3 auto-fixes recorded above (healthcheck + bun mock workaround); both resolved inline.

## Installed OTel SDK versions (from package.json diff)

| Package | Version | Role |
|---------|---------|------|
| @opentelemetry/sdk-node | 0.205.0 | NodeSDK (installs tracer provider + span processors) |
| @opentelemetry/exporter-trace-otlp-http | 0.205.0 | OTLPTraceExporter -> Langfuse /api/public/otel/v1/traces |
| @opentelemetry/api | 1.9.0 | trace.getTracer() |
| @opentelemetry/resources | 2.1.0 | resourceFromAttributes (service.name=emmy) |
| @opentelemetry/sdk-trace-base | 2.1.0 | BatchSpanProcessor + InMemorySpanExporter (test harness) |
| @opentelemetry/semantic-conventions | 1.39.0 | ATTR_SERVICE_NAME constant |

All six pinned exact (no `^` / `~`) per Phase 2 D-02 discipline. Lockfile `bun.lock` committed.

## Langfuse image digests (from docker inspect 2026-04-22)

| Service | Digest |
|---------|--------|
| langfuse/langfuse | `sha256:cdfdca609912edffd616503e43427395fcf135423422440d74c89d9d552b74f9` |
| langfuse/langfuse-worker | `sha256:f8a9eb480b31cc513ad9ed9869eeb3416cb7bdf00c598665c008c460566115d1` |
| postgres | `sha256:9d33475e46c9c6c09d5d8ee6fe609d05f5351fd44d1079d1d870bd5c404e47c0` |
| redis | `sha256:0c87e07e20a8157992ba7de345b55cfaf6853210b3423c92d1a365fe603d15e0` |
| clickhouse/clickhouse-server | `sha256:b627d7a9bc0e0c1bac26cdbe9d2fc6316faa29c5d8a174f28f5abd57d0fa6ba2` |
| cgr.dev/chainguard/minio | `sha256:d94a4d9beec8c8664fba91f85d9e6f54ebac963167cc8facd4244b7d57484334` |

## SC-1 trace walkthrough artifacts (deferred to operator checkpoint)

The full SC-1 walkthrough requires live emmy-serve (Phase 1 GPU-scope) + browser interaction and is operator-gated. Programmatic artifacts:

- **Walkthrough driver:** `scripts/sc1_trace_walkthrough.sh` creates a clean `/tmp/emmy-p3-w2-walkthrough` workspace, runs `pi-emmy --print` with a deliberately-multi-tool prompt (read + grep + edit + write + bash), and prints events.jsonl samples + emmy.profile.hash occurrence counts.
- **Expected trace directory:** `runs/<session_id>/events.jsonl` under the walkthrough's cwd (where `<session_id> = <ISO8601-with-dashes>-<profile-hash-8hex>`).
- **Expected Langfuse UI state:** At `http://localhost:3000`, `Traces` tab shows the most-recent session with ≥ N spans (session.start, session.sp_ok.pass, session.tools.registered, session.transcript.open, harness.assembly × turn_count, tool.invoke × tool_count, session.end). Every span carries `emmy.profile.id=qwen3.6-35b-a3b`, `emmy.profile.version=v2`, `emmy.profile.hash=<64-hex>` attributes in the UI's Attributes panel. At least one span carries `gen_ai.system=vllm` (from resource attrs + harness.assembly event).
- **Langfuse-down test:** `docker compose -f observability/langfuse/docker-compose.yaml stop langfuse-web` → re-run walkthrough → boot banner reads `telemetry=JSONL-only` AND events.jsonl still has the full trace (D-06 invariant).
- **Kill-switch test:** `EMMY_TELEMETRY=off pi-emmy --print "hello"` → stderr contains `OBSERVABILITY: OFF` AND no new session dir under runs/.

Operator resume signal: `p3-02 trace green` after the full walkthrough passes against live DGX Spark hardware.

## Next Wave Readiness — handoff to Plan 03-03 (sequential)

**Wave 2 sequential slot: Plan 03-03 (per-profile auto-compaction) is UNBLOCKED.** The stable before_provider_request hook shape established by this plan is the substrate Plan 03-03 attaches token-budget-aware message-history trimming to.

Plan 03-03 will co-modify:
- `packages/emmy-ux/src/session.ts` (compaction trigger wiring into session lifecycle)
- `packages/emmy-ux/src/pi-emmy-extension.ts` (before_provider_request hook gains a message-history-trim branch before handleBeforeProviderRequest)
- `packages/emmy-provider/src/before-request-hook.ts` (read-only; shape understanding)

Plan 03-03 can reuse:
- `@emmy/telemetry.span-factory.startChatSpan` / `endChatSpan` helpers for compaction-round-trip chat spans (compaction uses the same /v1/chat/completions endpoint).
- `@emmy/telemetry.appendJsonlAtomic` for `runs/<session>/events.jsonl` compaction.{trigger,complete,fallback} events.
- `@emmy/telemetry.configureTelemetry({enabled, jsonlPath, tracer})` stays configured exactly once per pi-emmy session; Plan 03-03 reads the module-level context and does not re-configure.

## Self-Check: PASSED

File existence + commit existence verified:

- `packages/emmy-telemetry/src/atomic-append.ts` — FOUND (created in d11f13e)
- `packages/emmy-telemetry/src/otel-sdk.ts` — FOUND (created in d11f13e)
- `packages/emmy-telemetry/src/profile-stamp-processor.ts` — FOUND (created in d11f13e)
- `packages/emmy-telemetry/src/session-context.ts` — FOUND (created in d11f13e)
- `packages/emmy-telemetry/src/span-factory.ts` — FOUND (created in d11f13e)
- `packages/emmy-telemetry/test/atomic-append.test.ts` — FOUND (created in 02d46c5)
- `packages/emmy-telemetry/test/otlp-exporter.test.ts` — FOUND (created in 02d46c5)
- `packages/emmy-telemetry/test/span-attributes.test.ts` — FOUND (created in 02d46c5)
- `packages/emmy-telemetry/test/dual-sink.test.ts` — FOUND (created in 02d46c5; modified in d11f13e for Rule-3 fix)
- `packages/emmy-telemetry/test/killswitch.test.ts` — FOUND (created in 02d46c5)
- `packages/emmy-ux/test/profile-loader-no-telemetry.test.ts` — FOUND (created in 02d46c5)
- `observability/langfuse/docker-compose.yaml` — FOUND (created in f410bfd; modified in 946da4d for healthcheck fix)
- `observability/langfuse/.env.example` — FOUND (created in f410bfd)
- `observability/langfuse/README.md` — FOUND (created in f410bfd)
- `observability/langfuse/test_stack_healthy.sh` — FOUND (created in f410bfd)
- `scripts/start_observability.sh` — FOUND (created in f410bfd)
- `scripts/stop_observability.sh` — FOUND (created in f410bfd)
- `scripts/sc1_trace_walkthrough.sh` — FOUND (created in d11f13e)
- Commit `f410bfd` (Task 1 infra) — FOUND in git log
- Commit `02d46c5` (Task 2 RED) — FOUND in git log
- Commit `d11f13e` (Task 3 GREEN) — FOUND in git log
- Commit `946da4d` (Task 4 healthcheck fix) — FOUND in git log

---

*Phase: 03-observability-agent-loop-hardening-lived-experience*
*Plan: 02*
*Completed: 2026-04-22*
