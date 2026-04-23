---
status: complete
phase: 03-observability-agent-loop-hardening-lived-experience
source: [03-VERIFICATION.md]
started: 2026-04-22T08:40:00Z
updated: 2026-04-22T23:50:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-1 — Langfuse UI trace visibility (browser) — RESOLVED 2026-04-22
expected: After `bash scripts/start_observability.sh`, create a Langfuse account at http://localhost:3000, generate API keys, populate `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` in `observability/langfuse/.env`, then run `bash scripts/sc1_trace_walkthrough.sh`. Langfuse UI Traces view should render one trace per turn; every span must carry `emmy.profile.id`, `emmy.profile.version`, `emmy.profile.hash` visible in the span detail panel; at least one span should have `gen_ai.system=vllm`. Resume signal: `p3-02 trace green`.
result: PASSED via REST-API verification after `LANGFUSE_INIT_*` bootstrap landed. 19 traces / 19 observations under project `emmy-phase3`; 19/19 carry `emmy.profile.id`, `emmy.profile.version`, `emmy.profile.hash`; 19/19 carry `gen_ai.system=vllm` at resource-level. Evidence: runs/p3-w7-langfuse-trace-verify/verdict.md + traces-snapshot.json + observations-snapshot.json. Browser UI step no longer required — `LANGFUSE_INIT_*` auto-provisions org/project/user/keys at first boot. Resume signal `p3-02 trace green` closed.

### 2. SC-3 — Interactive feedback capture (live TTY) — RESOLVED 2026-04-22
expected: Press shift+ctrl+up / shift+ctrl+down on most-recent completed turn in live pi-emmy TUI → feedback.jsonl row appended (13 fields, v3 profile hash); idempotent upsert on repress; free-text prompt on thumbs-down; EMMY_TELEMETRY=off suppresses. Chord changed from the originally-documented Alt+Up/Down after Plan 03-08 walkthrough revealed pi 0.68's alt+up is claimed by app.message.dequeue and pi.on("input") is NOT a keybind intercept.
result: PASSED via Plan 03-08 pexpect PTY walkthrough on live DGX Spark — all 6 steps green. Evidence: runs/p3-w5-gap-walkthrough/walkthrough.md + walkthrough-attempt-2.log + feedback-attempt-2.jsonl. Commits: ea159e2 (fix) + 42da230 (evidence). Resume signals `p3-05 feedback green` and `p3-08 tui green` both closed.

### 3. SC-5 — OFFLINE OK badge red-flip (live TUI + prompt) — RESOLVED 2026-04-22
expected: Boot pi-emmy — stderr shows green `[emmy] OFFLINE OK` banner (already live-verified). Issue a prompt that triggers web_fetch to a non-allowlisted host (e.g., `pi-emmy --print 'use web_fetch to retrieve https://example.com/nonexistent-allowlist-target and report what you see'`). The badge must flip to red `[emmy] NETWORK USED` before the non-local fetch is attempted, and the denied-call must print a stderr reminder noting the allowlist block. Resume signal: `p3-06 badge green`.
result: PASSED via `pi-emmy --print` driver targeting `news.ycombinator.com`. Green boot banner printed, red `[emmy] NETWORK USED (web_fetch → news.ycombinator.com) — blocked by profile allowlist` printed twice on agent's two retries, `tool.web_fetch.violation` event written to events.jsonl with full profile stamp. Wiring change: added a stderr emit inside `webFetchOnViolation` (session.ts) so the allowlist-block signal is visible outside interactive TUI. Evidence: runs/p3-w8-redflip-print/verdict.md + stderr.log + events.jsonl. Resume signal `p3-06 badge green` closed.

### 4. SC-2 — Live-mode 200-turn compaction matrix — RESOLVED 2026-04-22
expected: Run `bash scripts/sc2_200turn_compaction.sh` against live emmy-serve with `EMMY_SC2_LIVE=1` (the stub gate currently short-circuits). All 3 variants (default / alternate / disabled) must complete with verdict=pass on the 5 preservation invariants; the fixture hash `sha256:26149bfce4...a0a19b` must match; structured truncation must preserve error/diagnostic text verbatim; per-tool truncation rate must be observable in the resulting runs/ JSONL. Resume signal: `p3-07 sc2 live green`. ETA ~2 hours continuous GPU + no pre-emption from other profiles. Can be queued during off-hours.
result: PASSED 3/3 after `liveEngine()` factory was wired into sc2-runner.ts for `--mode=live`. default 43.4s, alternate 47.0s, disabled 0s (null cfg short-circuit). Fixture hash `sha256:26149bfce42c79e13a26a976780f29410991566fbcd399c65b53a1abd3a0a19b` stable across all 3. Prompt-tokens ~76K per live variant (under 131K context-window ceiling after the `PER_ENTRY_CAP=1500` + `GLOBAL_CAP=400000` clamp). Actual runtime was ~1.5 min, not 2h — the fixture triggers exactly one summarize call per variant. Evidence: runs/phase3-sc2-live-matrix/verdict.md + per-variant report.json/events.jsonl. Resume signal `p3-07 sc2 live green` closed.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

_None_ — all 4 SCs closed. SC-1/SC-5/SC-2 were operator-gated evidence-polish deferrals at Phase 3 close; all three are now green, with the following wiring changes landing in this pass:

- **observability/langfuse/docker-compose.yaml + .env + start_observability.sh** — parameterized `LANGFUSE_INIT_*` + fixed `LANGFUSE_S3_*_SECRET_ACCESS_KEY` to equal `MINIO_ROOT_PASSWORD` (Chainguard MinIO is root-only).
- **packages/emmy-ux/src/session.ts** — `webFetchOnViolation` now also writes a red stderr reminder.
- **eval/phase3/sc2-runner.ts** — `liveEngine()` factory + history-block clamp for the `--mode=live` path.
