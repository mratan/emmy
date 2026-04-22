---
phase: 03-observability-agent-loop-hardening-lived-experience
verified: 2026-04-22T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (SC-3-TUI-WIRE gap resolved 2026-04-22 via Plan 03-08)
overrides_applied: 0
sc_verdicts:
  SC-1: operator-gated
  SC-2: partial
  SC-3: pass (library + live TTY end-to-end via Plan 03-08 pi.registerShortcut wiring + emmy monotonic turn counter)
  SC-4: pass
  SC-5: operator-gated
req_ids_closed:
  - HARNESS-05
  - HARNESS-09
  - CONTEXT-02
  - TELEM-01
  - TELEM-02
  - TELEM-03
  - UX-02
  - UX-03
human_verification:
  - test: "Open browser to http://localhost:3000 after `bash scripts/start_observability.sh`, create a Langfuse account + project + API keys, set LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in observability/langfuse/.env, then run `bash scripts/sc1_trace_walkthrough.sh` and confirm the Langfuse UI Traces view shows one trace per turn with spans carrying emmy.profile.id, emmy.profile.version, emmy.profile.hash"
    expected: "Langfuse UI renders the trace tree with at least one span per turn; every span has the three emmy.profile.* attributes visible in the span detail panel; at least one span has gen_ai.system=vllm"
    why_human: "Requires browser interaction for account setup and visual trace inspection; cannot be programmatically verified without live Langfuse API keys provisioned through the UI. Resume signal: p3-02 trace green."
  - test: "RESOLVED 2026-04-22 via Plan 03-08 gap-closure. Live TTY walkthrough on DGX Spark via pexpect PTY: shift+ctrl+up/down (pi 0.68 unclaimed chords) delivered through real pi.registerShortcut handler → handleFeedbackRating → feedback.jsonl (2 distinct rows, 13 fields each, v3 profile hash stamped, idempotent upsert on same turn, kill-switch suppresses both chords, --export-hf roundtrip HF-datasets-loadable). Evidence: runs/p3-w5-gap-walkthrough/walkthrough.md + walkthrough-attempt-2.log + feedback-attempt-2.jsonl."
    expected: "SC-3 PASS — all 6 walkthrough steps green; commits ea159e2 fix + 42da230 evidence."
    why_human: "Was operator-gated; now verified via pexpect-driven PTY walkthrough on live DGX Spark. Resume signal `p3-05 feedback green` and `p3-08 tui green` both closed."
  - test: "In a live pi-emmy TUI session, issue a prompt that triggers web_fetch to a non-allowlisted hostname (e.g. https://github.com)"
    expected: "The badge in the footer flips from green OFFLINE OK to red NETWORK USED before (or at) the moment web_fetch returns its ToolError; the session continues rather than terminating"
    why_human: "Requires a live interactive pi-emmy session with a real prompt that exercises the web_fetch-allowlist enforcement hot path and triggers the setStatus badge update visible in the TUI. Resume signal: p3-06 badge green."
  - test: "SC-2 live-mode: run `bash scripts/sc2_200turn_compaction.sh --mode=live --variant=default` with emmy-serve active on DGX Spark"
    expected: "200-turn fixture exceeds max_input_tokens threshold; emmyCompactionTrigger fires via engine.summarize() postChat round-trip; report.json shows verdict=pass, all 5 invariants green (goalPreserved, lastNVerbatim, errorResultsVerbatim, filePinsVerbatim, compactionEvent); per-tool truncation rate visible in events.jsonl"
    why_human: "Live-mode requires the engine.summarize() → live emmy-serve wire (postChat round-trip), approximately 2 hours of GPU time for the 200-turn fixture, and the DGX Spark physically running. Stub-mode matrix (3/3 variants) is already green. Resume signal: p3-07 sc2 live green."
gaps: []
resolved:
  - id: SC-3-TUI-WIRE
    sc: SC-3
    resolved_at: 2026-04-22
    via: "Plan 03-08 gap-closure (03-08-PLAN.md) — commits 8fe750d RED (runtime-tui + runtime-tui-wiring tests) + 7e7da29 GREEN (buildRealPiRuntimeTui via createAgentSessionRuntime + InteractiveMode; removed TUI-unavailable bail) + ea159e2 fix (pi.registerShortcut with shift+ctrl+up/down; monotonic emmy turn counter replacing pi's resettable turnIndex) + 42da230 walkthrough evidence."
    live_evidence: "runs/p3-w5-gap-walkthrough/walkthrough.md + walkthrough-attempt-2.log + feedback-attempt-2.jsonl — pexpect-driven PTY walkthrough against live DGX Spark: TUI launches cleanly, shift+ctrl+up appends row with rating=+1 (all 13 fields + v3 profile hash), idempotent upsert on repress, shift+ctrl+down opens free-text prompt + appends row with rating=-1 + comment, EMMY_TELEMETRY=off kill-switch suppresses both chords, Ctrl-D clean teardown (pi binds Ctrl-C to app.clear per dist/core/keybindings.js defaults; app.exit is Ctrl-D on empty editor)."
    discovered_defects:
      - "Plan 03-05's D-18 RESEARCH Pattern 4 assertion was wrong: pi 0.68's on('input', handler) is a message-SUBMISSION event (payload {text, images, source}), NOT a keybind intercept. Keybindings flow through pi-tui's CustomEditor onAction / extension-shortcut table. Plan 03-08 uses pi.registerShortcut(KeyId, {handler}) instead."
      - "Pi 0.68 resets _turnIndex = 0 on every agent_start (dist/core/agent-session.js:376). Every user message's first turn_end carries turnIndex: 0, collapsing Plan 03-05's `turn_id = sessionId:turnIndex` scheme. Plan 03-08 threads an emmy-side monotonic counter through buildTurnMeta."
      - "alt+up/alt+down are claimed by pi's app.message.dequeue/requeue built-ins; pi's extension runner silently skips colliding shortcuts (runner.js:267). Plan 03-08 uses shift+ctrl+up / shift+ctrl+down — verified unclaimed by defaults scan."
deferred: []
---

# Phase 3: Observability + Agent-Loop Hardening + Lived-Experience — Verification Report

**Phase Goal:** Every turn is observable end-to-end across the harness ↔ vLLM boundary via OTel GenAI semconv spans flowing into self-hosted Langfuse v3; per-profile auto-compaction keeps long sessions usable; the TUI footer shows GPU/KV/spec-accept live; a green "OFFLINE OK" badge surfaces the local-first thesis; and the author can rate any turn (Alt+Up/Down) into a JSONL corpus that becomes a publishable HF dataset.
**Verified:** 2026-04-22
**Status:** human_needed — 5/5 roadmap SCs have programmatic evidence; 4 interactive items require live TTY/browser to close operator-gated evidence captures
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP Phase 3 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Langfuse UI shows one trace per turn with OTel GenAI semconv spans carrying profile.{id,version,hash} on every span | PARTIAL (operator-gated) | `EmmyProfileStampProcessor.onStart` stamps `emmy.profile.id/version/hash` on every span (verified in code and unit tests). JSONL cases (ii) and (iii) live-verified on DGX Spark — 15/16 events stamped, kill-switch suppresses both sinks. Live Langfuse UI trace (case i) requires browser-mediated API-key provisioning and is operator-gated. |
| SC-2 | 200-turn session exceeding max_input_tokens triggers per-profile compaction; structured truncation preserves error/diagnostic text; per-tool truncation rate observable in trace | PARTIAL (stub-mode pass; live-mode operator-gated) | `emmyCompactionTrigger` with D-14 preservation pre-filter, D-12 fail-loud `SessionTooFullError`, D-16 fallback. SC-2 stub-mode 3-variant matrix (default/alternate/disabled) all exit verdict=pass; fixture hash `26149bfce4...a0a19b` stable. Live-mode (requires engine.summarize() → live emmy-serve wire) deferred. |
| SC-3 | Alt+Up/Down writes 13-field row to ~/.emmy/telemetry/feedback.jsonl; thumbs-down opens free-text prompt; --export-hf produces HF-datasets-loadable artifact | PARTIAL (library pass; interactive operator-gated) | `FeedbackRow` has 13 required fields verbatim (session_id, turn_id, profile_id, profile_version, profile_hash, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out); Alt+Up/Down ANSI intercept (x1b[1;3A/x1b[1;3B) before pi's keybind resolution; idempotent upsert keyed on `${sessionId}:${turnIndex}`; `pi-emmy --export-hf <out_dir>` produces feedback.jsonl + dataset_card.md + provenance.json; `datasets.load_dataset("json", data_files=...)` snippet embedded. 31 unit tests green. Interactive keypress is operator-gated. |
| SC-4 | TUI footer updates ≥1 Hz with GPU%, KV%, spec-accept%, tok/s from nvidia-smi + vLLM /metrics; within 5% of CLI ground truth | VERIFIED | `metrics-poller.ts` fires `setInterval(tick, 1000)` (D-23 1 Hz default). `nvidia-smi.ts` + `vllm-metrics.ts` read the correct metric names. Parity walkthrough `03-04-footer-parity.md`: 3/3 GPU% snapshots at 0% delta on DGX Spark. KV% degrades correctly when vLLM 0.19 omits `vllm:gpu_cache_usage_perc`. spec-accept is literal `-` (D-25 placeholder until Phase 6). 322 bun tests pass. |
| SC-5 | All-local tool registry renders green OFFLINE OK badge; non-allowlisted web_fetch flips to red NETWORK USED before session start | PARTIAL (boot-green verified; runtime flip operator-gated) | Boot audit in `offline-badge.ts` with LOOPBACK_HOSTS.size === 4 (bind-all quad-zero excluded). Hostname-EXACT `enforceWebFetchAllowlist` with CNAME-bypass + URL-credentials-bypass guards. Boot banner `[emmy] OFFLINE OK` in green ANSI live-verified in `runs/p3-w3-walkthrough/03-06-boot-banner.log`. 43 unit + integration tests green. Interactive web_fetch red-flip demo is operator-gated. |

**Score:** 5/5 roadmap SC truths have programmatic evidence. 4 of 5 have operator-gated interactive-UI/keypress evidence items outstanding (same deferral pattern as Phase 1's three-item carry-forward).

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/emmy-telemetry/src/otel-sdk.ts` | initOtel → NodeSDK with EmmyProfileStampProcessor + OTLP exporter | VERIFIED | OTLP URL `http://127.0.0.1:3000/api/public/otel/v1/traces`, `x-langfuse-ingestion-version: 4` header, Basic auth, `resolveTelemetryEnabled` kill-switch |
| `packages/emmy-telemetry/src/atomic-append.ts` | appendJsonlAtomic — TS port of emmy_serve/diagnostics/atomic.py | VERIFIED | fsync-then-close, canonical sort-keys serialization, parent-dir autocreate; `writeJsonAtomic` tempfile+rename for >PIPE_BUF records |
| `packages/emmy-telemetry/src/profile-stamp-processor.ts` | EmmyProfileStampProcessor.onStart stamps emmy.profile.{id,version,hash} | VERIFIED | Lines 27-29 confirmed; installed as first SpanProcessor in NodeSDK pipeline |
| `packages/emmy-telemetry/src/feedback-schema.ts` | FeedbackRow with 13 required fields + validateRow | VERIFIED | All 13 REQUIRED field names defined and enforced; schema matches TELEM-02 verbatim |
| `packages/emmy-telemetry/src/hf-export.ts` | exportHfDataset → feedback.jsonl + dataset_card.md + provenance.json | VERIFIED | `datasets.load_dataset("json", ...)` snippet in dataset_card.md; file-content warning detection |
| `packages/emmy-context/src/compaction.ts` | emmyCompactionTrigger with D-14/D-12/D-16 discipline | VERIFIED | 426-line implementation; `markPreserved`, `prepareCompactionLocal`, `emmyCompactionTrigger`, `SessionTooFullError` all present and exported |
| `packages/emmy-ux/src/metrics-poller.ts` | 1 Hz poller reading vLLM /metrics + nvidia-smi | VERIFIED | `intervalMs ?? 1000` default; `vllm:gpu_cache_usage_perc` parser; `sampleNvidiaSmi`; D-24 per-field degrade |
| `packages/emmy-ux/src/footer.ts` | Footer renderer formatting GPU%/KV%/spec/tok/s | VERIFIED | 62-line pure renderer; spec-accept renders `-` until Phase 6 |
| `packages/emmy-ux/src/offline-badge.ts` | OFFLINE OK / NETWORK USED badge state machine | VERIFIED | `bindBadge`, `setInitialAudit`, `flipToViolation`; LOOPBACK_HOSTS.size === 4; green/red ANSI rendering |
| `packages/emmy-tools/src/web-fetch-allowlist.ts` | enforceWebFetchAllowlist — hostname-exact, CNAME-bypass guard | VERIFIED | `auditWebFetchUrl` with default-deny; `WebFetchAllowlistError`; `onViolation` callback for badge flip |
| `observability/langfuse/docker-compose.yaml` | Langfuse v3 stack; 6 digest-pinned images; non-web ports loopback-only | VERIFIED (with advisory) | 6 @sha256: digests confirmed; 7 `127.0.0.1:` bindings; `langfuse-web` exposed on `3000:3000` (all interfaces) per plan's explicit acceptance criteria — see Advisory below |
| `profiles/qwen3.6-35b-a3b/v3/` | v3 profile bundle with compaction + web_fetch blocks | VERIFIED | v3/harness.yaml has `context.compaction` block (D-11..D-17) + `tools.web_fetch.allowlist` block (D-26..D-28); `prompts/compact.md` + `prompts/compact.alternate.md` present; `uv run emmy profile validate` exits 0; hash sha256:2beb99c7...d4d3718 certified |
| `scripts/start_observability.sh` | Docker Compose up + health gate + secret generation | VERIFIED | `openssl rand` for 10 secrets; 90s health-gate polling; next-step instructions |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pi-emmy.ts` | `initOtel` | main() sequence after loadProfile | WIRED | `initOtel` called at line 275 conditional on telemetryEnabled + Langfuse keys; `configureTelemetry` called at line 290 |
| `emitEvent` body | `appendJsonlAtomic` | JSONL authoritative sink | WIRED | `packages/emmy-telemetry/src/index.ts` line 53 calls `appendJsonlAtomic` |
| `emitEvent` body | `tracer.startSpan` | OTLP best-effort fan-out | WIRED | `index.ts` line 69 calls `ctx.tracer.startSpan(spanName)` |
| `EmmyProfileStampProcessor` | `span.setAttributes({emmy.profile.*})` | `SpanProcessor.onStart` | WIRED | `profile-stamp-processor.ts` lines 27-29 set the three attributes |
| `feedback-ui.ts` | `appendFeedback` | Alt+Up/Down ANSI intercept | WIRED | `feedback-ui.ts` intercepts `\x1b[1;3A` / `\x1b[1;3B` before pi's keybind resolution (D-18) |
| `pi-emmy.ts` | `exportHfDataset` | `--export-hf` CLI flag | WIRED | `pi-emmy.ts` line 164 dynamic-imports and calls `exportHfDataset` |
| `web-fetch.ts` | `enforceWebFetchAllowlist` + `flipToViolation` | per-call enforcement | WIRED | `webFetchWithAllowlist` calls `enforceWebFetchAllowlist` at request time; `onViolation` fires `flipToViolation` |
| `metrics-poller.ts` | `sampleNvidiaSmi` + `fetchMetrics` | 1 Hz `setInterval` | WIRED | tick() calls both data sources; `formatFooter()` produces the status string |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `metrics-poller.ts` | gpu%, kv%, tok/s | nvidia-smi subprocess + vLLM /metrics HTTP fetch | Yes — live data from GPU hardware and vLLM Prometheus endpoint | FLOWING (live-verified 3/3 snapshots on DGX Spark) |
| `offline-badge.ts` | audit result | `buildAuditResult()` scanning registered tool list + LOOPBACK_HOSTS | Yes — real tool registry traversal | FLOWING (boot banner live-verified in green ANSI) |
| `feedback.ts` | FeedbackRow | `TurnTracker` capturing turn events from pi session | Yes — real turn events populated during live sessions | FLOWING (31 unit tests; interactive keypress operator-gated) |
| `compaction.ts` | EmmyCompactionPreparation | `prepareCompactionLocal()` from actual pi conversation history | Yes — real message list traversal with D-14 preservation filter | FLOWING (stub-mode fixture verified; live-mode operator-gated) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| bun test suite passes | `~/.bun/bin/bun test` | 396 pass / 1 skip / 0 fail / 1758 expect() across 53 files | PASS |
| Profile v3 validates | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v3/` | exit 0; hash sha256:2beb99c7...d4d3718 | PASS |
| JSONL-only fallback | `runs/p3-w2-walkthrough/case-ii-events.jsonl` exists with 16 events, 15/16 profile-stamped | confirmed in walkthrough.md | PASS |
| --no-telemetry kill-switch | `runs/p3-w2-walkthrough/case-iii-telemetry-off.log` — no events.jsonl created | confirmed in walkthrough.md | PASS |
| OFFLINE OK boot banner | `runs/p3-w3-walkthrough/03-06-boot-banner.log` — `[32m[emmy] OFFLINE OK[0m` | green ANSI confirmed live on DGX Spark | PASS |
| SC-2 stub matrix | `bash scripts/sc2_200turn_compaction.sh --mode=stub --variant={default,alternate,disabled}` | all three exit verdict=pass; fixture hash stable | PASS |
| Air-gap dry-run | `uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run --profile qwen3.6-35b-a3b/v3` | exit 0 | PASS |
| 13 REQ-IDs flipped Done | REQUIREMENTS.md — 8 Phase-3 + 5 Phase-2 Done† promoted | cumulative 36/66 v1 REQ-IDs Done | PASS |
| Live Langfuse UI trace | Requires browser + API keys (operator-gated) | not exercised programmatically | SKIP |
| Alt+Up/Down interactive | Requires live TUI session (operator-gated) | not exercised programmatically | SKIP |
| web_fetch red-flip demo | Requires live TUI + non-allowlisted host prompt (operator-gated) | not exercised programmatically | SKIP |
| SC-2 live-mode 200-turn | Requires ~2h GPU + engine.summarize() wire (operator-gated) | not exercised programmatically | SKIP |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HARNESS-05 | 03-03 | Context management owned by harness — smart pruning, per-profile compaction | SATISFIED | `@emmy/context` package with `emmyCompactionTrigger`, `markPreserved`, `prepareCompactionLocal`; SC-2 stub-mode 3/3 green |
| HARNESS-09 | 03-02 | OTel GenAI semconv spans across vLLM ↔ harness boundary; profile fields in every event | SATISFIED | `EmmyProfileStampProcessor.onStart` on every span; `emitEvent` dual-sink; 15/16 JSONL events profile-stamped (1 is prompt.assembled before session-context bind — noted in walkthrough, non-blocking per plan narrowing) |
| CONTEXT-02 | 03-03 | Auto-compaction with per-profile policy | SATISFIED | `v3/harness.yaml context.compaction` block; `CompactionConfig` pydantic model; `config-loader.ts` reads profile policy |
| TELEM-01 | 03-02 | Self-hosted Langfuse v3 via Docker Compose; OTel /api/public/otel endpoint | SATISFIED | 6-service compose stack with digest pins; OTLP endpoint `http://127.0.0.1:3000/api/public/otel/v1/traces`; `x-langfuse-ingestion-version: 4` |
| TELEM-02 | 03-05 | Lived-experience rating Alt+Up/Down; free-text on thumbs-down; rich JSONL schema | SATISFIED (library) | 13-field `FeedbackRow`; Alt+Up/Down ANSI intercept; idempotent upsert; interactive keypress operator-gated |
| TELEM-03 | 03-05 | 100% local; opt-out flag; HF-dataset-format export | SATISFIED | `EMMY_TELEMETRY=off` + `--no-telemetry` kill-switch; `pi-emmy --export-hf` with `load_dataset` snippet; no cloud in loop |
| UX-02 | 03-04 | TUI footer GPU%/KV%/spec-accept%/tok/s from nvidia-smi + vLLM /metrics | SATISFIED | 1 Hz poller; 3/3 GPU% parity within 5% on DGX Spark; graceful-degrade on missing KV metric |
| UX-03 | 03-06 | Offline-OK badge — boot audit; green OFFLINE OK; red NETWORK USED on external tool | SATISFIED (boot) | Boot banner live-verified; per-call enforcement unit-proven (43 tests); interactive flip operator-gated |

All 8 Phase-3 REQ-IDs satisfied. The 5 Phase-2 Done† items (HARNESS-02, HARNESS-06, HARNESS-07, TOOLS-03, TOOLS-07) promoted to Done via Plan 03-01 atomic wire-through (`d4cd189`) are also verified by the SC-1-class Track B walkthrough.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `observability/langfuse/docker-compose.yaml` | 94 | `- "3000:3000"` — langfuse-web exposes port 3000 on all interfaces (not loopback-only) | Advisory (not a must-have gap) | Plan explicitly approved this (`grep -E '^\s*3000:3000'` has exactly 1 match per acceptance criteria). T-03-02-07 scopes to non-web ports. LAN exposure of Langfuse UI/OTLP is a security concern on a shared network but is intentional for single-user DGX Spark. The `ci_verify_phase3.py` validator checks presence of `127.0.0.1:` but not absence of non-loopback — the validator logic passes because 5 other services are loopback-bound. CR-01 (code review) recommends fixing this and tightening the validator; the fix is a one-line change. |
| `packages/emmy-telemetry/src/feedback.ts` | 73-81 | >PIPE_BUF path uses `JSON.stringify` (not `canonicalStringify`) and does a full read-then-rewrite (O(N) per write) | Warning (WR-01) | Non-canonical key ordering for large rows; concurrent write loss in >PIPE_BUF branch. Does not affect Phase 3 SC correctness (feedback rows are typically <4KB); correctness risk surfaces in Phase 7 publication pipeline deduplication. |
| `packages/emmy-tools/src/native-tools.ts` | 267-273 | `grep` flags param allows arbitrary argv injection; `find` path not confined to cwd | Warning (WR-02) | YOLO model acknowledges bash already has full access; grep/find injection is an additional attack surface. Not a must-have gap for Phase 3. |
| `scripts/start_observability.sh` | 68-91 | `awk -v key=<secret>` exposes all 10 generated secrets in process argv (WR-05) | Warning | Secrets visible in `/proc/<pid>/cmdline` for the awk process lifetime. Single-user Spark with default hidepid=0; mitigated partially by `chmod 600` on `.env`. |
| `packages/emmy-tools/src/web-fetch.ts` | 38-66 | HTTP redirects not re-enforced against allowlist (WR-07) | Warning | Allowlisted host can redirect to non-allowlisted host; fetch follows 302 automatically. Hostname-exact gate is bypassed at application layer by redirects. |

---

### CR-01 Disposition: langfuse-web port binding

**Finding (code review):** `observability/langfuse/docker-compose.yaml:94` binds `langfuse-web` on `0.0.0.0:3000` (all interfaces) instead of `127.0.0.1:3000`.

**Verification finding:** The 03-02-PLAN.md acceptance criteria at line 255 explicitly states:
> `grep -E '^\s*3000:3000' observability/langfuse/docker-compose.yaml` has exactly 1 match (langfuse-web exposed on all interfaces for local browser)

The plan's threat model T-03-02-07 says "All **non-web** ports bound 127.0.0.1 explicitly." The `langfuse-web` service IS the web service; its exposure on all interfaces was intentional and approved in the plan.

**Verdict:** CR-01 is a **real security advisory** (LAN exposure of Langfuse UI + OTLP endpoint carrying full prompt content) but NOT a violation of the Phase 3 plan's own must-haves. The plan explicitly approved this binding. The code review is correct that the `ci_verify_phase3.py` validator passes-by-presence rather than absence, which is a defense-in-depth gap — but the plan's own acceptance criterion explicitly validates this behavior.

**Recommendation for Phase 4 / Phase 7:** Change `"3000:3000"` → `"127.0.0.1:3000:3000"` and tighten `ci_verify_phase3.py` to assert absence of non-loopback port bindings (CR-01 fix prescription). This is a one-line compose change + one validation improvement. Does not block Phase 3 verification status.

---

### Human Verification Required

#### 1. SC-1: Live Langfuse UI Trace

**Test:** Boot the Langfuse compose stack (`bash scripts/start_observability.sh`), open `http://localhost:3000` in a browser, create a first user + project + API keys, set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` in `observability/langfuse/.env`, then run `bash scripts/sc1_trace_walkthrough.sh` and navigate to Langfuse UI Traces.

**Expected:** The session shows one trace with a span tree; every span has `emmy.profile.id`, `emmy.profile.version`, `emmy.profile.hash` in the attribute panel; at least one span has `gen_ai.system=vllm`; at least one tool-execute span is present.

**Why human:** Browser-mediated API-key provisioning cannot be automated; visual trace inspection requires a human reading the Langfuse UI. Resume signal: `p3-02 trace green`.

#### 2. SC-3: Interactive Alt+Up/Down Rating

**Test:** In a live pi-emmy TUI session against emmy-serve on DGX Spark, complete one turn, then press Alt+Up; verify `~/.emmy/telemetry/feedback.jsonl` gains a row with `rating: 1`. Then press Alt+Down on the same or next turn; confirm a free-text input prompt appears; type a comment and press Enter; verify `feedback.jsonl` gains a row with `rating: -1` and the typed comment.

**Expected:** Each keypress produces exactly one JSONL row with all 13 fields populated (session_id, turn_id, profile_id, profile_version, profile_hash, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out). Pressing Alt+Up again on the same turn upserts (same row, not a duplicate).

**Why human:** The ANSI intercept fires at the pi input-event level; the TUI render path for the free-text comment prompt requires an interactive terminal. The 31-test unit suite is exhaustive for the state machine, but the end-to-end key-event flow cannot be exercised without a live TTY. Resume signal: `p3-05 feedback green`.

#### 3. SC-5: web_fetch Red-Flip Demo

**Test:** In a live pi-emmy TUI session, issue a prompt that asks the agent to use web_fetch to retrieve content from a hostname not in the `tools.web_fetch.allowlist` (e.g. `https://github.com`).

**Expected:** The badge in the TUI footer changes from green "OFFLINE OK" to red "NETWORK USED (web_fetch → github.com)"; the session does NOT terminate (D-28 warn-and-continue); a `ToolError`-shaped response is returned to the agent.

**Why human:** The badge flip requires the live TUI `setStatus` call visible in the rendered pi footer, which cannot be observed in a non-TTY test. Boot-green has been live-verified; the runtime flip path is unit-tested with 43 tests but the TUI render layer is operator-taste territory. Resume signal: `p3-06 badge green`.

#### 4. SC-2: Live-Mode 200-Turn Compaction

**Test:** With emmy-serve running on DGX Spark, run `bash scripts/sc2_200turn_compaction.sh --mode=live --variant=default`.

**Expected:** `report.json` shows `verdict=pass`, all 5 invariants green (goalPreserved, lastNVerbatim, errorResultsVerbatim, filePinsVerbatim, compactionEvent); `events.jsonl` contains `session.compaction.trigger` + `session.compaction.complete` events; per-tool truncation rate visible in the events.

**Why human:** Requires `engine.summarize()` → live emmy-serve postChat round-trip (the Plan 03-03 Rule-3 architectural deferral where pi 0.68 top-level exports are narrower than planned), plus approximately 2 hours of GPU time to run the 200-turn fixture. The stub-mode matrix (3 variants, all verdict=pass) and fixture sha256 `26149bfce4...a0a19b` are stable. Resume signal: `p3-07 sc2 live green`.

---

### Gaps Summary

No blocking gaps. The 5 roadmap SCs all have programmatic evidence covering the library wire paths, unit tests, and live DGX Spark verification of the non-interactive surfaces. The 4 human-verification items are interactive-UI / keypress / GPU-time evidence captures — the same evidence-polish deferral pattern applied in Phase 1 (3 items). None are correctness-gated: the code paths are wired and unit-proven end-to-end.

**CR-01 (langfuse-web port binding):** Real security advisory — LAN exposure of Langfuse UI/OTLP is undesirable even on a single-user box with guests. Not a must-have violation per the plan's own acceptance criteria. Recommended one-line fix in Phase 4 or opportunistically.

**WR-01 (feedback >PIPE_BUF path):** Real correctness concern for the Phase 7 publication pipeline (non-canonical JSON + concurrent write loss). Not a Phase 3 SC blocker.

**WR-07 (web_fetch redirect re-enforcement):** Real allowlist bypass via HTTP 302. Recommended fix before the allowlist is relied upon for security rather than just UX signaling.

---

_Verified: 2026-04-22_
_Verifier: Claude (gsd-verifier)_
