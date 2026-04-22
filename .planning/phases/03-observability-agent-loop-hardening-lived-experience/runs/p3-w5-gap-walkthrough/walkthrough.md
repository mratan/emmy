# Plan 03-08 Task 3 walkthrough — RESOLVED 2026-04-22

**Runtime:** DGX Spark; emmy-serve Qwen3.6-35B-A3B-FP8 @ `127.0.0.1:8002`; pi 0.68.0

## Timeline

**Attempt 1** (commit `7e7da29`) — Walkthrough exposed that Plan 03-05's D-18 strategy was based on a mis-reading of pi 0.68's API. TUI launched cleanly (no more "TUI unavailable" bail — that part of Plan 03-08 Task 2 was correct), but Alt+Up/Down never reached emmy's handler. Log: `walkthrough-attempt-1.log`.

**Fix-forward** (commits below) — Replaced `pi.on("input", handler)` keybind-intercept assumption with pi 0.68's authoritative extension-shortcut API `pi.registerShortcut(keyId, {handler})`. Selected `shift+ctrl+up` / `shift+ctrl+down` (verified unclaimed by pi built-ins per `dist/core/keybindings.js` scan; `alt+up` is reserved for `app.message.dequeue` and pi's extension runner silently skips colliding shortcuts at `runner.js:267`).

A second Plan 03-05 defect surfaced during the live run: pi resets `_turnIndex = 0` on every `agent_start` event (`dist/core/agent-session.js:376`), which means every user message's turn_end carries `turnIndex: 0`. Plan 03-05's `turn_id = ${sessionId}:${turnIndex}` scheme collapsed onto a single id, so upsertFeedback always replaced the same row. Fixed by maintaining an emmy-side monotonic counter (`emmyTurnCounter++`) threaded through `buildTurnMeta`.

**Attempt 2** (final build) — All 6 steps green. Log: `walkthrough-attempt-2.log`. Feedback rows: `feedback-attempt-2.jsonl`.

## Attempt 2 results

Driver: `/tmp/p3-08-walkthrough-v3.py` (pexpect PTY spawn of `pi-emmy --profile .../v3`).
Environment: `EMMY_DEBUG_SHORTCUT=1` for synchronization diagnostics (opt-in env var, absent from production).

| # | Step | Check | Result |
|---|------|-------|--------|
| 1 | Launch TUI | `pi-emmy session ready` banner; `OFFLINE OK` green; no `TUI unavailable` error | PASS |
| 2 | Turn 1 + shift+ctrl+up | `feedback.jsonl` grew 0 → 1; handler returned `{"action":"handled"}`; row has rating=+1, 13 fields, v3 profile hash `sha256:2beb99c773...d4d3718` | PASS |
| 3 | Idempotent repress | Second shift+ctrl+up on same turn → row count stayed at 1 (upsert not append) | PASS |
| 4 | Turn 2 + shift+ctrl+down + comment | New `agent_start` → emmy counter 0 → 1 → new turn_id `...:1`; modal input captured `walkthrough comment via shift+ctrl+down`; row count 1 → 2; rating=-1 | PASS |
| 5 | Ctrl-D teardown | pi exits cleanly via `app.exit` (Ctrl-C is `app.clear` in pi 0.68, not exit; correct chord is Ctrl-D on empty editor or `/quit`) | PASS |
| 6 | Kill switch (`EMMY_TELEMETRY=off`) | 3 × shift+ctrl+up during a kill-switch session → no row change; `registerShortcut` short-circuited at registration time (no handlers installed) | PASS |

**Final `feedback.jsonl` state (preserved as `feedback-attempt-2.jsonl`):**

```jsonl
{"rating":1,  "turn_id":"2026-04-22T22-19-33-004Z-sha256:2:0", "comment":"",                                         "profile_hash":"sha256:2beb99c7...d4d3718", fields=13}
{"rating":-1, "turn_id":"2026-04-22T22-19-33-004Z-sha256:2:1", "comment":"walkthrough comment via shift+ctrl+down",  "profile_hash":"sha256:2beb99c7...d4d3718", fields=13}
```

`--export-hf` roundtrip produced `/tmp/emmy-p3-08-hf/{feedback.jsonl, dataset_card.md, provenance.json}`; 0 file-content warnings; dataset is HF `datasets.load_dataset("json", ...)`-loadable.

## Commits

See git log since `7e7da29` — pi-emmy-extension.ts + feedback-ui.ts + tests.

## Verdict

**`p3-08 tui green`** — SC-3 verified end-to-end on live DGX Spark with real pi 0.68 TUI, real PTY, real pexpect-delivered keystrokes, real emmy-serve generating real turns.

**`p3-05 feedback green`** — closed as collateral. Plan 03-05's library surface was correct; the wiring at Plan 03-05 time just targeted the wrong pi API. Plan 03-08 closes the integration.

## Lessons for future plans

1. **Research Pattern 4 assumption was wrong.** The RESEARCH document asserted `pi.on("input", handler)` intercepts keybindings. Pi 0.68's reality: `on("input")` fires on MESSAGE SUBMISSION (the user hits Enter to submit a prompt); raw keystrokes go through pi-tui's CustomEditor `onAction`/extension-shortcut table. Plans that target keybindings in pi should always use `pi.registerShortcut(keyId, {handler})`.
2. **Pi resets turnIndex on every agent_start.** If you're synthesizing a turn_id from `event.turnIndex`, EITHER use an emmy-side monotonic counter OR combine turnIndex with an agent_start counter. Plans that assume pi's turnIndex is globally unique within a session will break.
3. **Ctrl-C in pi 0.68 is `app.clear`, not exit.** Pi binds `app.exit` to Ctrl-D on empty editor. Tests and walkthroughs that expect Ctrl-C → exit will falsely FAIL the teardown step.
4. **Live TUI walkthroughs via pexpect need explicit synchronization.** Without an observable event like `turn_end`, tests send keystrokes during streaming and the chord hits before tracker has a turn to rate → handler returns `continue` and the test FAILs with misleading symptoms. The `EMMY_DEBUG_SHORTCUT` env var now provides this sync point.
