# Plan 03-05 SC-3 library probe — evidence

**Date:** 2026-04-22
**Runtime:** DGX Spark; emmy-serve Qwen3.6-35B-A3B-FP8 @ `127.0.0.1:8002`
**Commit at gate:** `bcce47d` (Phase 3 verifier output + HUMAN-UAT)
**Context:** interactive `pi-emmy --profile .../v3` bailed with `TUI unavailable in this pi 0.68.0 adapter — use --print or --json for now, or run pi directly`. Plan 03-05's handler+schema+JSONL+HF layer is library-complete, but the pi 0.68 TUI wire-through (`runtime.runTui`) needed to deliver a real Alt+Up/Down keystroke to emmy's handler is absent. This is a Plan 02-04 residual deferral inherited by Plan 03-01 Wave 1 (Track B focused on `--print`-mode paths; interactive TUI was not in scope).

## Programmatic probe (ran inside packages/emmy-ux)

Drove `handleFeedbackKey` directly with the exact ANSI bytes pi would deliver and a TurnTracker seeded with two completed turns:

| Step | Event | Telemetry | Expected | Actual |
|------|-------|-----------|----------|--------|
| 1 | Alt+Up (\x1b[1;3A) on turn 0 | on | `{handled}`; row appended | `{"action":"handled"}`; rows=1 |
| 2 | Alt+Up same turn (idempotency) | on | `{handled}`; NO duplicate row | `{"action":"handled"}`; rows still 1 (upsert) |
| 3 | Alt+Down (\x1b[1;3B) on turn 1 + comment | on | `{handled}`; row with non-empty comment | `{"action":"handled"}`; rows=2, second has `comment="too short; wanted a one-paragraph answer"` |
| 4 | Alt+Up with `enabled=false` | off | `{continue}`; NO append | `{"action":"continue"}`; rows still 2 |
| 5 | plain arrow-up (`\x1b[A`, no modifier) | on | `{continue}`; non-matching key passes through | `{"action":"continue"}`; rows still 2 |

Final state of feedback.jsonl (under `/data/scratch/emmy-sc3-Bj55Lb/feedback.jsonl`): 2 rows, 13 fields each, idempotent upsert honored, kill-switch honored, non-matching keys pass through.

Every truth in Plan 03-05 `must_haves.truths` that can be exercised without the pi TUI binding is exercised here on a real filesystem — same code paths Alt+Up would trigger through pi, just dispatched directly via the `handleFeedbackKey(event, ctx, tracker, feedbackPath)` seam.

## Gap

**The pi 0.68 interactive TUI wire-through (`runtime.runTui`) is not implemented.** Plan 02-04 deliberately chose `createAgentSession` (SDK path) over `createAgentSessionRuntime` (full runtime including TUI binding). Plan 03-01 Wave 1 did not close this carry-forward. Plan 03-05 implemented the Alt+Up/Down handler but never got a real keypress delivered because pi's input-event path isn't bound to emmy's handler without the TUI wiring.

**Impact:**
- Interactive `pi-emmy` (no `--print`) is unusable — the TUI-unavailable error blocks daily-driver use.
- Full SC-3 operator evidence (press Alt+Up on a live turn, watch feedback.jsonl grow) requires TUI.
- Plan 03-05 truth #11 "`--export-hf` produces HF-datasets-loadable artifact" works today, but the accumulated corpus it exports assumes daily-driver capture via TUI — which isn't happening yet.

**Remediation:** Phase-3 gap plan to wire `createAgentSessionRuntime` (or the equivalent pi 0.68 TUI binding) and route pi's `input` event through `pi.on("input", handleFeedbackKey)`. This is the right closing-bracket to Plan 02-04's deferral AND the thing that unlocks Alt+Up/Down end-to-end.

## Verdict

SC-3 library: **pass** on programmatic probe.
SC-3 end-to-end: **gap — pi 0.68 TUI wire-through required.**
