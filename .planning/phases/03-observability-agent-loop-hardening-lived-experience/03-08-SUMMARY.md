---
phase: 03-observability-agent-loop-hardening-lived-experience
plan: 08
type: gap_closure
wave: 5
status: complete
gap_closure: true
requirements:
  - TELEM-02
  - TELEM-03
commits:
  - 8fe750d  # test RED: runtime-tui + wiring integration tests
  - 7e7da29  # feat GREEN: buildRealPiRuntimeTui via createAgentSessionRuntime + InteractiveMode
  - 2d01448  # test: walkthrough attempt 1 — TUI launches; Alt+Up/Down delivery gap identified
  - ea159e2  # fix: pi.on(input) → pi.registerShortcut + monotonic emmy turn counter
  - 42da230  # test: walkthrough attempt 2 — SC-3 end-to-end GREEN
key_files:
  created:
    - packages/emmy-ux/test/runtime-tui.test.ts
    - packages/emmy-ux/test/runtime-tui-wiring.integration.test.ts
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w5-gap-walkthrough/walkthrough.md
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w5-gap-walkthrough/walkthrough-attempt-1.log
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w5-gap-walkthrough/walkthrough-attempt-2.log
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w5-gap-walkthrough/feedback-attempt-2.jsonl
  modified:
    - packages/emmy-ux/src/session.ts
    - packages/emmy-ux/src/feedback-ui.ts
    - packages/emmy-ux/src/pi-emmy-extension.ts
    - packages/emmy-ux/bin/pi-emmy.ts
    - packages/emmy-ux/test/feedback-flow.integration.test.ts
    - packages/emmy-ux/test/keybind-capture.test.ts
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/03-VERIFICATION.md
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/03-HUMAN-UAT.md
    - .planning/STATE.md
---

# Plan 03-08 Summary — SC-3-TUI-WIRE gap closure (TELEM-02/03)

## One-line

Closes the SC-3 gap discovered during the Phase 3 operator protocol: pi 0.68 interactive TUI now works (`pi-emmy` without `--print`), and shift+ctrl+up / shift+ctrl+down deliver real Alt-rating-equivalent keystrokes through pi's extension-shortcut API into emmy's feedback.jsonl — verified end-to-end on the live DGX Spark via a pexpect PTY walkthrough.

## What landed

1. **Interactive TUI wire-through** — `buildRealPiRuntimeTui` in `packages/emmy-ux/src/session.ts` graduates from Plan 02-04's SDK-only path to pi 0.68's full `createAgentSessionRuntime(factory, …)` + `new InteractiveMode(runtime, …).run()`. The `TUI unavailable in this pi 0.68.0 adapter` bail at `packages/emmy-ux/bin/pi-emmy.ts:337` is removed and replaced with a real `await runtime.runTui()` wrapped in try/finally with `shutdownOtel()`. Existing `buildRealPiRuntime` (SDK path) is preserved for `--print` / `--json` so the Plan 03-07-certified surface is not regressed.
2. **Correct keybind API** — Plan 03-05's assumption that `pi.on("input", handler)` intercepts keybindings was wrong. `on("input")` is a message-SUBMISSION event (`_extensionRunner.emitInput(text, images, source)` at `dist/core/agent-session.js:689-700`), not a keystroke intercept. Pi 0.68's authoritative extension-shortcut API is `pi.registerShortcut(keyId: KeyId, { description?, handler })`. `packages/emmy-ux/src/pi-emmy-extension.ts` now calls it twice at session-start, once per chord.
3. **Chord selection** — `alt+up` / `alt+down` are pi built-ins (`app.message.dequeue` / `app.message.requeue`) and pi's runner silently drops colliding extension shortcuts (`dist/core/extensions/runner.js:267`). Chords switched to `shift+ctrl+up` / `shift+ctrl+down` — verified unclaimed via a complete scan of `dist/core/keybindings.js` defaults. Constants exported as `EMMY_FEEDBACK_UP_KEYID` / `EMMY_FEEDBACK_DOWN_KEYID`.
4. **Monotonic turn counter** — Plan 03-05's `turn_id = ${sessionId}:${pi.turnIndex}` collapses all user-submitted turns onto `:0` because pi resets `_turnIndex = 0` on every `agent_start` (`dist/core/agent-session.js:376`). Fixed by threading an emmy-side `emmyTurnCounter++` through `buildTurnMeta`. Idempotency (same turn → same turn_id → upsert) and distinctness (different user messages → distinct turn_ids) both preserved.
5. **Handler shape refactor** — `handleFeedbackKey(event, ctx, tracker, path)` → `handleFeedbackRating(rating, ctx, tracker, path)`. The old ANSI-event shape is gone; rating is passed directly from the per-chord closure. 5 test files updated to match; `ANSI_ALT_UP`/`ANSI_ALT_DOWN` constants replaced with `EMMY_FEEDBACK_UP_KEYID`/`EMMY_FEEDBACK_DOWN_KEYID`.
6. **Debug instrumentation** — `EMMY_DEBUG_SHORTCUT=1` env var emits `[emmy-debug] registering shortcuts: …`, `[emmy-debug] turn_end recorded: turn_id=…`, `[emmy-debug] handleFeedbackRating ±1 → …` to stderr. Off by default. Useful as a walkthrough synchronization point (pexpect expects against `turn_end recorded` before sending chord).

## Tasks

| # | Task | Kind | Commit |
|---|------|------|--------|
| 1 | RED — runtime TUI + wiring integration tests | test | `8fe750d` |
| 2 | GREEN — buildRealPiRuntimeTui + pi.registerShortcut + monotonic counter | feat + fix | `7e7da29` + `ea159e2` |
| 3 | Live TTY walkthrough | test (evidence) | `2d01448` (attempt 1) + `42da230` (attempt 2) |

## Must-have truths — all verified

1. ✓ `pi-emmy` without `--print` launches a real pi 0.68 TUI that stays up until user quits (Ctrl-D / `/quit`) — no "TUI unavailable" bail.
2. ✓ Real pi shortcut fires emmy's handler on shift+ctrl+up / shift+ctrl+down — verified by integration test mounting real pi runtime AND by operator-equivalent pexpect PTY walkthrough.
3. ✓ Every Plan 03-01..03-07 extension binding still fires on the new runtime path: before_provider_request, turn_end, session_start footer-poller, session_start offline-badge, SP_OK canary, transcript writer, turn_start compaction.
4. ✓ SP_OK canary fires BEFORE the pi runtime is built — preserved by the `runSpOk → emitEvent('session.sp_ok.pass') → buildRealPiRuntimeTui` ordering in `createEmmySession`.
5. ✓ initOtel called AFTER parseCliArgs BEFORE createEmmyRuntime — preserved in `packages/emmy-ux/bin/pi-emmy.ts`.
6. ✓ Profile hash unchanged — v1+v2+v3 all validate exit 0; no harness.yaml touches.
7. ✓ Four-way regression green: bun test 412 pass / 1 skip / 0 fail (+16 new tests), typecheck 5/5, pytest 144 pass / 1 skip (unchanged), profile validate v1+v2+v3 all exit 0.
8. ✓ Live TTY walkthrough evidence captured under `runs/p3-w5-gap-walkthrough/` — 2 distinct rows (rating=+1 and -1), 13 fields each, v3 profile hash stamped, idempotent upsert on repress, kill-switch honored, Ctrl-D clean teardown.

## Deviations

1. **Chord rename** — `Alt+Up/Down` → `shift+ctrl+up/down`. Documented above; unavoidable because pi's built-ins claim Alt+Up/Down. Narrative across 03-CONTEXT.md / 03-RESEARCH.md / 03-05-PLAN.md docs still references Alt+Up/Down historically; this SUMMARY + 03-VERIFICATION.md + 03-HUMAN-UAT.md carry the authoritative current state.
2. **Two Plan 03-05 defects surfaced & fixed mid-execution** — the `pi.on("input")` mis-assumption and the `turnIndex` collapse. Both were planning-time defects not caught by plan-checker nor the Plan 03-05 unit tests (because the unit tests mocked pi's event delivery using the assumption-under-test). Live walkthrough is load-bearing for this kind of integration defect.
3. **Ctrl-C teardown** — test script originally expected Ctrl-C to exit; pi 0.68 binds Ctrl-C to `app.clear`. Walkthrough now uses Ctrl-D (`app.exit` on empty editor).

## Four-way regression at `42da230`

- `bun test` → **412 pass / 1 skip / 0 fail / 1822 expect() calls across 55 files** (+16 new tests vs Plan 03-07 close 396/1)
- `bun run typecheck` → **5/5 @emmy/* packages exit 0**
- `uv run pytest tests/unit -q` → **144 pass / 1 skip** (unchanged)
- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v{1,2,3}/` → all three exit 0; v3 hash `sha256:2beb99c7...d4d3718` unchanged

## Self-Check: PASSED

SC-3-TUI-WIRE resolved. SC-3 verdict in 03-VERIFICATION.md flipped from `gap (library pass; interactive TUI wiring missing)` to `pass (library + live TTY end-to-end)`. Phase 3 status flipped from `gaps_found` back to `human_needed` — the remaining 3 operator-deferred items (SC-1 Langfuse UI, SC-5 web_fetch red-flip, SC-2 live 200-turn compaction) are evidence-polish deferrals, not correctness gaps.
