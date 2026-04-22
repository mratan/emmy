---
status: partial
phase: 03-observability-agent-loop-hardening-lived-experience
source: [03-VERIFICATION.md]
started: 2026-04-22T08:40:00Z
updated: 2026-04-22T08:40:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-1 — Langfuse UI trace visibility (browser)
expected: After `bash scripts/start_observability.sh`, create a Langfuse account at http://localhost:3000, generate API keys, populate `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` in `observability/langfuse/.env`, then run `bash scripts/sc1_trace_walkthrough.sh`. Langfuse UI Traces view should render one trace per turn; every span must carry `emmy.profile.id`, `emmy.profile.version`, `emmy.profile.hash` visible in the span detail panel; at least one span should have `gen_ai.system=vllm`. Resume signal: `p3-02 trace green`.
result: [pending]

### 2. SC-3 — Interactive Alt+Up / Alt+Down feedback capture (live TTY)
expected: Open an interactive pi-emmy session, complete at least one turn, press Alt+Up (thumbs-up) on the most-recent turn. `~/.emmy/telemetry/feedback.jsonl` should grow by exactly one 13-field row (session_id, turn_id, profile_id, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out, ts, source). Pressing Alt+Up again on the same turn must NOT create a duplicate row (idempotent upsert). Press Alt+Down on a different turn — a free-text prompt opens; typing text and confirming writes a second row with rating=down + comment populated. Resume signal: `p3-05 feedback green`.
result: [pending]

### 3. SC-5 — OFFLINE OK badge red-flip (live TUI + prompt)
expected: Boot pi-emmy — stderr shows green `[emmy] OFFLINE OK` banner (already live-verified). Issue a prompt that triggers web_fetch to a non-allowlisted host (e.g., `pi-emmy --print 'use web_fetch to retrieve https://example.com/nonexistent-allowlist-target and report what you see'`). The badge must flip to red `[emmy] NETWORK USED` before the non-local fetch is attempted, and the denied-call must print a stderr reminder noting the allowlist block. Resume signal: `p3-06 badge green`.
result: [pending]

### 4. SC-2 — Live-mode 200-turn compaction matrix (~2 hours GPU)
expected: Run `bash scripts/sc2_200turn_compaction.sh` against live emmy-serve with `EMMY_SC2_LIVE=1` (the stub gate currently short-circuits). All 3 variants (default / alternate / disabled) must complete with verdict=pass on the 5 preservation invariants; the fixture hash `sha256:26149bfce4...a0a19b` must match; structured truncation must preserve error/diagnostic text verbatim; per-tool truncation rate must be observable in the resulting runs/ JSONL. Resume signal: `p3-07 sc2 live green`. ETA ~2 hours continuous GPU + no pre-emption from other profiles. Can be queued during off-hours.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

_None_ — all 4 items are evidence-polish deferrals, not correctness gaps. All code paths unit-proven and live-proven where achievable without the missing operator medium (browser, TTY, long GPU window).
