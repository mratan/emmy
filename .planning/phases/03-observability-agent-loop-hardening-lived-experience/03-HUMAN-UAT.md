---
status: partial
phase: 03-observability-agent-loop-hardening-lived-experience
source: [03-VERIFICATION.md]
started: 2026-04-22T08:40:00Z
updated: 2026-04-22T22:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-1 — Langfuse UI trace visibility (browser)
expected: After `bash scripts/start_observability.sh`, create a Langfuse account at http://localhost:3000, generate API keys, populate `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` in `observability/langfuse/.env`, then run `bash scripts/sc1_trace_walkthrough.sh`. Langfuse UI Traces view should render one trace per turn; every span must carry `emmy.profile.id`, `emmy.profile.version`, `emmy.profile.hash` visible in the span detail panel; at least one span should have `gen_ai.system=vllm`. Resume signal: `p3-02 trace green`.
result: [pending]

### 2. SC-3 — Interactive feedback capture (live TTY) — RESOLVED 2026-04-22
expected: Press shift+ctrl+up / shift+ctrl+down on most-recent completed turn in live pi-emmy TUI → feedback.jsonl row appended (13 fields, v3 profile hash); idempotent upsert on repress; free-text prompt on thumbs-down; EMMY_TELEMETRY=off suppresses. Chord changed from the originally-documented Alt+Up/Down after Plan 03-08 walkthrough revealed pi 0.68's alt+up is claimed by app.message.dequeue and pi.on("input") is NOT a keybind intercept.
result: PASSED via Plan 03-08 pexpect PTY walkthrough on live DGX Spark — all 6 steps green. Evidence: runs/p3-w5-gap-walkthrough/walkthrough.md + walkthrough-attempt-2.log + feedback-attempt-2.jsonl. Commits: ea159e2 (fix) + 42da230 (evidence). Resume signals `p3-05 feedback green` and `p3-08 tui green` both closed.

### 3. SC-5 — OFFLINE OK badge red-flip (live TUI + prompt)
expected: Boot pi-emmy — stderr shows green `[emmy] OFFLINE OK` banner (already live-verified). Issue a prompt that triggers web_fetch to a non-allowlisted host (e.g., `pi-emmy --print 'use web_fetch to retrieve https://example.com/nonexistent-allowlist-target and report what you see'`). The badge must flip to red `[emmy] NETWORK USED` before the non-local fetch is attempted, and the denied-call must print a stderr reminder noting the allowlist block. Resume signal: `p3-06 badge green`.
result: [pending]

### 4. SC-2 — Live-mode 200-turn compaction matrix (~2 hours GPU)
expected: Run `bash scripts/sc2_200turn_compaction.sh` against live emmy-serve with `EMMY_SC2_LIVE=1` (the stub gate currently short-circuits). All 3 variants (default / alternate / disabled) must complete with verdict=pass on the 5 preservation invariants; the fixture hash `sha256:26149bfce4...a0a19b` must match; structured truncation must preserve error/diagnostic text verbatim; per-tool truncation rate must be observable in the resulting runs/ JSONL. Resume signal: `p3-07 sc2 live green`. ETA ~2 hours continuous GPU + no pre-emption from other profiles. Can be queued during off-hours.
result: [pending]

## Summary

total: 4
passed: 1
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

_None_ — SC-3 closed via Plan 03-08 gap-closure. Remaining 3 items (SC-1 Langfuse UI, SC-5 web_fetch red-flip, SC-2 live 200-turn compaction) are evidence-polish deferrals that need external resources (browser for API keys, ~2h GPU window).
