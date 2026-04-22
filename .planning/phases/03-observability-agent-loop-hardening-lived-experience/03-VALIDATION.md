---
phase: 03
slug: observability-agent-loop-hardening-lived-experience
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (Bun-compatible) for TS packages; pytest 7.x for any emmy_serve-side helpers |
| **Config file** | `vitest.config.ts` per package (Phase 2 pattern); `pyproject.toml` (Phase 1) |
| **Quick run command** | `bun test --filter <package>` |
| **Full suite command** | `bun test` (runs every `@emmy/*` package) + `pytest emmy_serve/tests/` |
| **Estimated runtime** | ~45s quick, ~4 min full (200-turn SC-2 fixture runs live against emmy-serve) |

---

## Sampling Rate

- **After every task commit:** Run package-scoped `bun test --filter @emmy/<pkg>`
- **After every plan wave:** Run full `bun test` + `pytest emmy_serve/tests/`
- **Before `/gsd-verify-work`:** Full suite must be green AND SC-1-class walkthrough re-runs green against post-wave paths AND SC-2 200-turn compaction fixture passes against live emmy-serve
- **Max feedback latency:** 60 seconds at commit cadence

---

## Per-Task Verification Map

*Filled by planner — every task in every plan must have an Automated Command or a Wave-0 dependency.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CONTEXT-01-carryover | — | emmy-vllm provider registered via ModelRegistry.registerProvider; streamSimple binds to @emmy/provider | unit | `bun test --filter @emmy/ux -- session.boot.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | CONTEXT-01-carryover | — | before_provider_request hook injects chat_template_kwargs.enable_thinking:false + extra_body.guided_decoding.grammar on reactive retry | unit | `bun test --filter @emmy/provider -- hook.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | TOOLS-01-carryover | T-03-01 / SP_OK preserved | SP_OK canary fires before pi session; emmy-vllm hook exempts boot probe via payload.emmy.is_sp_ok_canary guard | integration | `bun test --filter @emmy/ux -- sp-ok-canary.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | CONTEXT-04-carryover | — | a17f4a9 `<think>`-strip removed; streamSimple path yields clean text; no regression on SC-1 walkthrough | manual | `/tmp/emmy-sc1-walkthrough re-run; grep-check no <think> tags in transcript` | ❌ W0 | ⚠️ manual |
| 03-02-01 | 02 | 2 | TELEM-01 / HARNESS-09 | — | docker-compose up brings Langfuse v3 stack (web, worker, clickhouse, pg, redis) to healthy; digests pinned | integration | `bash observability/langfuse/test_stack_healthy.sh` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | TELEM-01 | — | OTLP exporter posts traces to http://localhost:3000/api/public/otel with basic-auth header; 200 response | unit | `bun test --filter @emmy/telemetry -- otlp-exporter.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | HARNESS-09 | — | Every span carries {emmy.profile.id, emmy.profile.version, emmy.profile.hash, emmy.prompt.sha256} | unit | `bun test --filter @emmy/telemetry -- span-attributes.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 2 | TELEM-01 | T-03-02 / air-gap | EMMY_TELEMETRY=off suppresses both JSONL sink and OTLP exporter (including SDK init) | unit | `bun test --filter @emmy/telemetry -- killswitch.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-05 | 02 | 2 | TELEM-01 | — | JSONL-always, OTLP-if-up: Langfuse unreachable → exporter silently drops; JSONL still authoritative | integration | `bun test --filter @emmy/telemetry -- dual-sink.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-06 | 02 | 2 | HARNESS-09 | — | append_jsonl_atomic TS port matches emmy_serve/diagnostics/atomic.py fsync-then-rename semantics | unit | `bun test --filter @emmy/telemetry -- atomic-append.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-07 | 02 | 2 | TELEM-01 + HARNESS-09 | — | SC-1 evidence: one trace per turn in Langfuse UI; spans cover harness assembly, vLLM request, tool calls, tool results | manual | `scripts/sc1_trace_walkthrough.sh && echo "review http://localhost:3000"` | ❌ W0 | ⚠️ manual |
| 03-03-01 | 03 | 2 | HARNESS-05 / CONTEXT-02 | — | harness.yaml.context.compaction block parses; soft_threshold_pct, preserve_recent_turns, summarization_prompt_path, preserve_tool_results validated | unit | `bun test --filter @emmy/profile -- compaction-schema.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | HARNESS-05 | — | Emmy pre-filter produces preservation set matching D-14 (structural core, error/diagnostic verbatim, goal+recent N, file pins + TODO) before invoking pi's prepareCompaction | unit | `bun test --filter @emmy/context -- preservation.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 2 | CONTEXT-02 | — | Soft threshold crossing (0.75 of max_input_tokens) triggers compaction at NEXT turn boundary (not mid-turn) | unit | `bun test --filter @emmy/context -- trigger.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-04 | 03 | 2 | CONTEXT-02 | — | Hard ceiling overflow post-compaction throws SessionTooFullError with diagnostic bundle | unit | `bun test --filter @emmy/context -- hard-ceiling.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-05 | 03 | 2 | HARNESS-05 | — | Summarization round-trip failure (timeout/parse/refusal) falls back to structured pruning; event stream logs fallback | integration | `bun test --filter @emmy/context -- summarize-fallback.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-06 | 03 | 2 | CONTEXT-02 | — | SC-2 evidence: 200-turn fixture that crosses threshold → goal still in context, 5 recent verbatim, error-flagged results verbatim, @file pins intact, per-tool truncation rate in trace | integration | `bash scripts/sc2_200turn_compaction.sh && bun run verify-sc2-from-jsonl` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 3 | UX-02 | — | vLLM /metrics parser handles `vllm:gpu_cache_usage_perc`, `vllm:num_requests_running`, decode throughput (verify metric name at exec time) | unit | `bun test --filter @emmy/ux -- vllm-metrics-parser.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 3 | UX-02 | — | nvidia-smi subprocess wrapper handles `[N/A]` per-field on DGX Spark UMA (port Phase 1 GpuSampler pattern) | unit | `bun test --filter @emmy/ux -- nvidia-smi.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-03 | 04 | 3 | UX-02 | — | TUI footer renders `[GPU 87% • KV 34% • spec accept - • tok/s 38]` at ≥1Hz via pi setFooter | unit | `bun test --filter @emmy/ux -- footer.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-04 | 04 | 3 | UX-02 | — | Footer values within 5% of `nvidia-smi` CLI + curl `/metrics` at same instant (3 sample timing) | manual | `scripts/footer_parity_check.sh` | ❌ W0 | ⚠️ manual |
| 03-04-05 | 04 | 3 | UX-02 | — | Graceful degrade: 3 consecutive poll failures → `?` suffix → blank field; does not abort session | unit | `bun test --filter @emmy/ux -- footer-degrade.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 3 | TELEM-02 | — | Alt+Up/Down OR Shift+Alt+Up/Down (planner-selected, documented in PROFILE_NOTES) captured via pi input hook (no collision with app.message.dequeue / app.models.reorderUp) | unit | `bun test --filter @emmy/ux -- keybind-capture.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-02 | 05 | 3 | TELEM-02 | — | Rating writes atomic JSONL row to ~/.emmy/telemetry/feedback.jsonl with full schema (session_id, turn_id, profile_id, profile_version, profile_hash, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out) | unit | `bun test --filter @emmy/telemetry -- feedback-append.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-03 | 05 | 3 | TELEM-02 | — | Thumbs-down opens free-text prompt; thumbs-up commits with empty comment | integration | `bun test --filter @emmy/ux -- feedback-flow.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-04 | 05 | 3 | TELEM-03 | — | `pi-emmy --export-hf <out_dir>` produces HF-datasets-loadable artifact (JSONL-only MVP, parquet optional) + warning if file content detected in model_response/tool_calls | integration | `bun test --filter @emmy/telemetry -- export-hf.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-05-05 | 05 | 3 | TELEM-02 | — | Rate limiter: repeated Alt+Up/Down on same turn_id updates (idempotent) not duplicates | unit | `bun test --filter @emmy/telemetry -- feedback-idempotent.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-01 | 06 | 3 | UX-03 | T-03-03 / offline-first | Offline audit computes union(loopback_set, web_fetch.allowlist); badge = green if every tool host ∈ union, red otherwise | unit | `bun test --filter @emmy/ux -- offline-audit.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-02 | 06 | 3 | UX-03 | — | Runtime enforcement: web_fetch(url) with non-allowlisted host flips badge red + logs violation in event stream (warn-and-continue per D-28) | integration | `bun test --filter @emmy/tools -- web-fetch-enforcement.integration.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-03 | 06 | 3 | UX-03 | — | Boot banner reports badge color; OBSERVABILITY and OFFLINE banners visible in interactive TUI + --print + --json | unit | `bun test --filter @emmy/ux -- boot-banner.test.ts` | ❌ W0 | ⬜ pending |
| 03-06-04 | 06 | 3 | UX-03 | — | SC-5 evidence: all-local config → green; add network-requiring tool OR point web_fetch at non-allowlisted host → red before any session starts | manual | `scripts/sc5_offline_badge.sh` | ❌ W0 | ⚠️ manual |
| 03-07-01 | 07 | 4 | profile-hash contract | — | profiles/qwen3.6-35b-a3b bumped v2→v3 with context.compaction block + tools.web_fetch.allowlist + any telemetry toggle; PROFILE_NOTES documents provenance | unit | `python emmy_serve/scripts/validate_profile.py profiles/qwen3.6-35b-a3b/v3` | ❌ W0 | ⬜ pending |
| 03-07-02 | 07 | 4 | Phase 3 close | — | SC-1 walkthrough fixture re-runs green against post-wave paths; traces in Langfuse; Alt+Up rating captured; footer live; badge green | manual | `bash scripts/phase3_close_walkthrough.sh` | ❌ W0 | ⚠️ manual |
| 03-07-03 | 07 | 4 | Phase 3 close | — | Air-gap CI extended: emmy-serve + Langfuse compose up; 50-turn replay; zero outbound packets from either stack | integration | `.github/workflows/airgap-phase3.yml` | ❌ W0 | ⬜ pending |
| 03-07-04 | 07 | 4 | Phase 3 close | — | 9 REQ-IDs (HARNESS-05, HARNESS-09, CONTEXT-02, TELEM-01, TELEM-02, TELEM-03, UX-02, UX-03) + 5 Phase-2 Done† → Done in REQUIREMENTS.md traceability | manual | `gsd-sdk query requirements.coverage phase:03` | ❌ W0 | ⚠️ manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky/manual*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — add to any @emmy/* package that lacks it (provider, telemetry, context, ux, tools, profile)
- [ ] `packages/emmy-telemetry/src/index.test.ts` — stubs for atomic-append, otlp-exporter, span-attributes, dual-sink, killswitch, feedback-append, export-hf, feedback-idempotent
- [ ] `packages/emmy-context/` — NEW package if not yet created; compaction engine lives here to keep HARNESS-05/CONTEXT-02 isolated from provider concerns
- [ ] `packages/emmy-ux/src/session.boot.test.ts` — Wave 1 Track-B wire-through regression stubs
- [ ] `packages/emmy-ux/src/footer.test.ts`, `nvidia-smi.test.ts`, `vllm-metrics-parser.test.ts`, `footer-degrade.test.ts`, `keybind-capture.test.ts`, `feedback-flow.integration.test.ts`, `boot-banner.test.ts`, `offline-audit.test.ts`
- [ ] `packages/emmy-provider/src/hook.test.ts` — before_provider_request hook unit stubs
- [ ] `packages/emmy-tools/src/web-fetch-enforcement.integration.test.ts`
- [ ] `observability/langfuse/docker-compose.yaml` + `observability/langfuse/test_stack_healthy.sh` (Wave 2 infrastructure)
- [ ] `scripts/sc1_trace_walkthrough.sh`, `scripts/sc2_200turn_compaction.sh`, `scripts/sc5_offline_badge.sh`, `scripts/phase3_close_walkthrough.sh`, `scripts/footer_parity_check.sh` (Wave 4 evidence scripts)
- [ ] `.github/workflows/airgap-phase3.yml` (Wave 4 CI extension)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Langfuse UI shows one trace per turn with all GenAI spans visible | HARNESS-09 / TELEM-01 (SC-1) | UI inspection; automated span-count check complements but does not replace visual verification | `scripts/sc1_trace_walkthrough.sh` → open http://localhost:3000 → click through most recent session → confirm span tree matches expected shape (harness.assembly → vllm.request → tool.\<name\> → tool.result.\<name\>) |
| Footer values within 5% of CLI tools at same instant | UX-02 (SC-4) | Requires human eye comparing two terminals at wall-clock sync | `scripts/footer_parity_check.sh` — opens side-by-side tmux; record `nvidia-smi dmon -s u` + `curl /metrics` every second; overlay footer screenshots; eyeball delta |
| SC-1-class daily-driver walkthrough re-runs green | Phase 3 close gate | Subjective "feel"; Phase 2 precedent — real walkthrough is the human verdict | `bash scripts/phase3_close_walkthrough.sh` on clean `/tmp/emmy-p3-walkthrough/` — run the 12 prompts from Phase 2's SC-1 fixture; confirm: traces visible, rating captured, footer live, badge green, no regressions |
| Offline-OK badge flips red on adding network tool | UX-03 (SC-5) | Requires config-mutation + boot-restart dance | `scripts/sc5_offline_badge.sh` — step 1: boot clean → green; step 2: add fake network tool to registry → restart → red; step 3: remove → restart → green |
| REQ-ID traceability matrix updated | Phase 3 close | Manual review against REQUIREMENTS.md | `gsd-sdk query requirements.coverage phase:03` + human audit of each row's SHIPPED+TESTED+evidence claim |
| `a17f4a9` stopgap removed cleanly | Track B wire-through | Diff inspection — must be exactly the removal commit, not a refactor spiral | `git show <removal-commit>` — confirms `<think>`-strip deleted from render path; commit body cites a17f4a9 + 02-CLOSEOUT.md § SC-1 findings |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (vitest configs per package, scripts, compose stack)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
