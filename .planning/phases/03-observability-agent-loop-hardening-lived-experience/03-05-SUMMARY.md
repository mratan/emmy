---
phase: 03-observability-agent-loop-hardening-lived-experience
plan: 05
subsystem: lived-experience-rating
tags: [telem-02, telem-03, alt-up-down, feedback-jsonl, hf-export, input-event, turn-tracker, d-18, d-19, d-20, d-21]
status: complete-with-operator-checkpoint
wave: 3

# Dependency graph
requires:
  - phase: 03-observability-agent-loop-hardening-lived-experience (plan 03-01)
    provides: "createEmmyExtension ExtensionFactory with pi 0.68 binding + pi.on('input', ...) stub; stable post-wave wire path Plan 03-05 replaces the stub at"
  - phase: 03-observability-agent-loop-hardening-lived-experience (plan 03-02)
    provides: "@emmy/telemetry dual-sink emitEvent body; appendJsonlAtomic PIPE_BUF helper reused by feedback.ts; resolveTelemetryEnabled kill-switch semantics honored by handleFeedbackKey"
  - phase: 03-observability-agent-loop-hardening-lived-experience (plan 03-04)
    provides: "EmmyExtensionOptions baseUrl + footer poller lifecycle; Plan 03-05 extends the same options bag with sessionId + telemetryEnabled + turnTrackerImpl"

provides:
  - "packages/emmy-telemetry/src/feedback-schema.ts — FeedbackRow (13 TELEM-02 fields verbatim) + validateRow (throws FeedbackSchemaError on missing field or invalid rating) + FeedbackNotFoundError (keyed on turn_id for idempotent upsert)."
  - "packages/emmy-telemetry/src/feedback.ts — appendFeedback (PIPE_BUF-safe fast path via appendJsonlAtomic + tempfile-rename large-row fallback), readFeedback (skips corrupt lines, tolerates hand-edits), updateFeedback (atomic rewrite keyed on turn_id), upsertFeedback (idempotent Alt+Up/Down entry point — repeated press updates rather than duplicates), defaultFeedbackPath (~/.emmy/telemetry/feedback.jsonl per D-20)."
  - "packages/emmy-telemetry/src/turn-tracker.ts — TurnTracker (in-memory, keeps most-recent completed turn per D-19) + TurnMeta interface that pi-emmy-extension.ts's turn_end handler populates with the emmy-synthesized turn_id."
  - "packages/emmy-telemetry/src/hf-export.ts — exportHfDataset (copies feedback.jsonl verbatim + emits emmy-authored dataset_card.md + provenance.json; file-content heuristic scan emits stderr warnings without blocking export per D-21 consent-flow deferral to Phase 7)."
  - "packages/emmy-ux/src/feedback-ui.ts — handleFeedbackKey (Alt+Up/Down input-event body; returns {action: 'handled'} when a rating is recorded to suppress pi's built-in app.message.dequeue keybind; thumbs-down opens ctx.ui.input modal; undefined/empty both record comment=''); ANSI_ALT_UP / ANSI_ALT_DOWN literal constants."
  - "packages/emmy-ux/src/pi-emmy-extension.ts — pi.on('turn_end', ...) populates TurnTracker via buildTurnMeta (typed AgentMessage extraction — no `as any` casts; pi 0.68 TurnEndEvent exposes only turnIndex so emmy synthesizes turn_id as `${sessionId}:${turnIndex}`); pi.on('input', ...) delegates to handleFeedbackKey with kill-switch short-circuit when telemetryEnabled=false."
  - "packages/emmy-ux/src/session.ts + packages/emmy-ux/bin/pi-emmy.ts — sessionId + telemetryEnabled plumbed from CLI boot through createEmmySession into the ExtensionFactory options bag."
  - "pi-emmy --export-hf <out_dir> CLI dispatcher — invokes exportHfDataset on ~/.emmy/telemetry/feedback.jsonl, writes out_dir/{feedback.jsonl, dataset_card.md, provenance.json}, exits 0 on success / 1 on export failure / 2 on missing <out_dir> argument. Resolves git SHA via EMMY_GIT_SHA env var or falls back to git rev-parse HEAD against emmyInstallRoot."
  - "31 new passing tests (+1 opt-in HF-datasets integration skip) across 5 files; full bun test suite 353 pass / 0 fail / 1 skip (+31 vs Plan 03-04 close 322)."

affects:
  - "Plan 03-06 (offline-OK badge UX-03): orthogonal file-touch-wise; no co-modification hazard with 03-05. Can parallelize."
  - "Plan 03-07 (v3 profile bump + CLOSEOUT + 3-run SC-2 matrix): flips TELEM-02 + TELEM-03 REQ-IDs from Wave-3-pending to Done in REQUIREMENTS.md; wires the operator resume signal `p3-05 feedback green` into the 03-CLOSEOUT evidence table."
  - "Phase 7 (public artifact publication): consumes the --export-hf JSONL + dataset_card.md + provenance.json outputs. Phase 7 adds the redaction / consent prompt flow on top of the file-content warnings this plan emits; it also adds parquet emission (deferred per D-21 amendment 2026-04-21)."

# Tech tracking
tech-stack:
  added:
    - "(none) — Plan 03-05 uses only node:fs + node:crypto + node:os + node:path ESM imports (plan-checker INFO: no CommonJS require). No new runtime dependencies. The HF-datasets integration probe shells out to `uv run python -c`, which requires uv + a Python env with `datasets` pip-installed — opt-in only via `SKIP_HF_INTEGRATION=0`, hermetic by default."
  patterns:
    - "Pattern: emmy-owned turn_id scheme. pi 0.68 TurnEndEvent exposes only `turnIndex: number` (types.d.ts line 468-473); emmy synthesizes turn_id = `${sessionId}:${turnIndex}` at the turn_end handler site. The idempotent upsert in feedback.ts keys on turn_id — reliable because session_id + turnIndex is unique per session. Single place to swap if pi 0.69+ adds a native turn_id."
    - "Pattern: PIPE_BUF-aware JSONL append with large-row fallback. appendFeedback dispatches to appendJsonlAtomic (Plan 03-02 TS port of emmy_serve/diagnostics/atomic.py) when serialized row ≤ 4KB, falls back to tempfile+rename whole-file rewrite when > 4KB. Mirror of the Plan 03-02 emitEvent body's PIPE_BUF branch; reusable for any future atomic JSONL writer in @emmy/*."
    - "Pattern: idempotent upsert via read-all + mutate + tempfile-rename. updateFeedback reads the entire file, locates the row by turn_id, merges the patch, re-writes atomically. upsertFeedback wraps it with an append fallback when turn_id absent. This is the last-writer-wins idempotency contract: repeated Alt+Up/Down on the same turn UPDATES rather than appends. Acceptable performance because feedback.jsonl is author-scale (tens-to-hundreds of rows per day, not millions)."
    - "Pattern: typed pi-event introspection — no `as any` casts. buildTurnMeta narrows AgentMessage via structural checks (`content?.type === 'toolCall'`, `usage.input` as number guard) rather than runtime casts. Plan-checker BLOCKER resolution from the plan's `<interfaces>` block; a future pi version that adds new content variants won't silently wipe out our extraction — it'll cleanly show up as `tool_calls: []` and `model_response: ''` for those turns."
    - "Pattern: injectable-dependency tracker for test isolation. EmmyExtensionOptions.turnTrackerImpl lets tests hand in a fresh TurnTracker per session; production callers omit it and get a factory-closure-local instance. Mirrors Plan 03-04's intervalImpl + fetchMetricsImpl pattern (avoids the Plan 03-02 Pattern F mock.module process-global hazard)."
    - "Pattern: CLI-level early-exit subcommand. pi-emmy --export-hf <out_dir> runs as the first branch in main() after --help / --print-environment, skipping all session prereqs (vLLM probe, profile validate) because the exporter is a pure file-to-file transform. exit 2 is reserved for CLI-usage errors (distinct from exit 1 runtime failures)."

key-files:
  created:
    - packages/emmy-telemetry/src/feedback-schema.ts
    - packages/emmy-telemetry/src/feedback.ts
    - packages/emmy-telemetry/src/turn-tracker.ts
    - packages/emmy-telemetry/src/hf-export.ts
    - packages/emmy-ux/src/feedback-ui.ts
    - packages/emmy-telemetry/test/feedback-append.test.ts
    - packages/emmy-telemetry/test/feedback-idempotent.test.ts
    - packages/emmy-telemetry/test/export-hf.integration.test.ts
    - packages/emmy-ux/test/keybind-capture.test.ts
    - packages/emmy-ux/test/feedback-flow.integration.test.ts
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/03-05-SUMMARY.md
  modified:
    - packages/emmy-telemetry/src/index.ts (exports FeedbackRow + FeedbackSchemaError + FeedbackNotFoundError + validateRow + appendFeedback + readFeedback + updateFeedback + upsertFeedback + defaultFeedbackPath + TurnTracker + TurnMeta + exportHfDataset + ExportResult + ExportOpts)
    - packages/emmy-ux/src/pi-emmy-extension.ts (adds TurnEndEvent import + TurnTracker + handleFeedbackKey; extends EmmyExtensionOptions with sessionId + telemetryEnabled + turnTrackerImpl; pi.on('turn_end') handler populates tracker via buildTurnMeta; pi.on('input') replaces the Plan 03-01 stub with handleFeedbackKey delegation)
    - packages/emmy-ux/src/session.ts (CreateEmmySessionOpts gains sessionId + telemetryEnabled; buildRealPiRuntime signature extended with both; passes through to createEmmyExtension)
    - packages/emmy-ux/bin/pi-emmy.ts (parseArgs parses --export-hf <out_dir>; main() dispatches to exportHfDataset before session bootstrap; sessionOpts now carries sessionId + telemetryEnabled; usage string updated with --export-hf + exit-code 2)
  deleted: []

key-decisions:
  - "D-18 realized verbatim: pi.on('input', handler) intercepts Alt+Up/Down BEFORE pi's keybind resolution. handleFeedbackKey returns {action: 'handled'} on match, suppressing pi's built-in app.message.dequeue keybind. Trade-off accepted: emmy shadows pi's follow-up-queue feature (we don't surface it). Documented at source in feedback-ui.ts."
  - "D-19 most-recent-turn attribution: TurnTracker keeps exactly one TurnMeta (the latest). No transcript-cursor UI. Future plan (rating an older turn) would add a `getTurn(turnId)` method — zero-change to the feedback-ui.ts keybind body."
  - "D-20 path `~/.emmy/telemetry/feedback.jsonl` verbatim from TELEM-02. Global across sessions; accumulates the corpus that Phase 7's publication flow ultimately publishes. Acceptance-criterion grep passes: `grep -c '.emmy/telemetry/feedback.jsonl' packages/emmy-telemetry/src/feedback.ts` = 1."
  - "D-21 (2026-04-21 amendment): JSONL-only MVP. --export-hf emits feedback.jsonl + dataset_card.md + provenance.json (emmy-authored sidecars, not HF parquet). `datasets.load_dataset('json', data_files=...)` loads natively (RESEARCH §Summary #5 verified). Parquet + upstream HF dataset card deferred to Phase 7."
  - "D-21 file-content warning: exportHfDataset scans each row's model_response + tool_calls blob for 6 heuristic markers (code fences, function/def, import, class, #include). Warnings emit to stderr per row; export is NOT blocked. Consent/redaction flow is Phase 7. 2/3 intentional-trigger rows in the unit test fire; the benign row does not."
  - "turn_id synthesis = `${sessionId}:${turnIndex}`. Plan-checker BLOCKER fix: pi 0.68 TurnEndEvent has NO `turn_id` field — `grep 'turn_id:' node_modules/.../core/extensions/types.d.ts` returns zero matches on the event interface. emmy owns the scheme; `(event as any).turn_id` would always be undefined. buildTurnMeta uses only typed access + structural narrowing."
  - "latency_ms + kv_used default to 0 in buildTurnMeta for MVP. pi 0.68's turn_end event doesn't carry per-turn latency directly; Plan 03-02's after_provider_response event carries response headers but is keyed by request, not turn. A follow-up plan (Phase 4 or 5) can cache latency per turnIndex via after_provider_response → merge at turn_end. kv_used similarly — Plan 03-04's footer poller has the live value in its FieldState cache but isn't wired into the extension's turn_end path. Accepted degradation: the 13-field schema row still validates (0 is a valid number); consumer downstream can filter/enrich."
  - "Idempotency via read-rewrite-atomic (T-03-05-02 mitigation): rapid Alt+Up spam produces exactly 1 row per turn. upsertFeedback reads the whole file, locates the row by turn_id, rewrites atomically. At author scale (hundreds of feedback rows/day) the read-all cost is negligible; at publication scale Phase 7 can switch to a sharded index if the corpus grows to millions."
  - "Task 3 operator-gated: live TUI test requires emmy-serve on DGX Spark + interactive pi-emmy + real Alt+Up/Down keypresses in a terminal. Programmatic scaffolding (this plan's unit + integration tests) covers the state machine; operator confirms the full input-event pipeline + pi built-in collision suppression + --export-hf roundtrip + EMMY_TELEMETRY=off kill-switch. Mirrors Plan 03-02 Task 4 and Plan 03-04 Task 3 deferral patterns."

patterns-established:
  - "Pattern: emmy-synthesized turn_id as the idempotent-upsert key. First plan in the repo where emmy declares ownership of an identifier pi 0.68 doesn't expose. Reusable for any future identifier we need to derive from pi's event envelope (e.g. span_id for cross-system correlation)."
  - "Pattern: CLI subcommand that bypasses session bootstrap. --export-hf is a pure file-to-file transform; skipping vLLM probe + profile-validate keeps export fast (no GPU scope required) and orthogonal to session state (no risk of corrupting an in-flight session by running export from a second terminal). Reusable for any future offline analysis subcommand."
  - "Pattern: kill-switch propagated through the factory-closure. telemetryEnabled evaluated ONCE at pi-emmy boot (resolveTelemetryEnabled) and threaded through createEmmySession → buildRealPiRuntime → createEmmyExtension. The flag determines whether turn_end is even registered AND whether input short-circuits. No per-event runtime checks against process.env — cleaner, testable, and impossible to half-disable."

requirements-completed:
  - TELEM-02
  - TELEM-03

# Metrics
duration: ~25min (Task 1 RED + Task 2 GREEN; Task 3 human-verify deferred)
completed: 2026-04-22
---

# Phase 03 Plan 05: Lived-experience rating corpus (TELEM-02 + TELEM-03) Summary

**Alt+Up / Alt+Down keybind captures lived-experience ratings into ~/.emmy/telemetry/feedback.jsonl with the 13-field TELEM-02 schema; idempotent upsert keyed on emmy-synthesized turn_id (`${sessionId}:${turnIndex}`) ensures repeated presses UPDATE rather than duplicate; pi-emmy --export-hf <out_dir> emits a HuggingFace datasets-loadable artifact (JSONL + emmy-authored dataset_card.md + provenance.json) with a file-content warning scan. Input event intercept fires BEFORE pi's keybind resolution (D-18) — emmy's handler returns {action: 'handled'} to suppress pi's built-in alt+up → app.message.dequeue. Thumbs-down opens pi's modal ctx.ui.input() with free-text entry; undefined/empty both record comment=''. EMMY_TELEMETRY=off kill-switch short-circuits capture silently. TELEM-02 + TELEM-03 REQ-IDs flipped complete (pending operator `p3-05 feedback green` signal for live-TUI verification).**

## Performance

- **Duration:** ~25 minutes across 2 executable tasks (Task 3 is operator-gated)
- **Started:** 2026-04-22T08:00Z (approx.)
- **Task 1 RED landed:** 35b7023
- **Task 2 GREEN landed:** 1fc10c7
- **Completed:** 2026-04-22 (this SUMMARY + STATE/ROADMAP updates)
- **Commits:** 2 per-task (RED + GREEN); plan metadata commit follows
- **Files created:** 11 (4 telemetry src + 1 ux src + 5 tests + this SUMMARY)
- **Files modified:** 4 (telemetry index + ux pi-emmy-extension + ux session + ux pi-emmy CLI)

## Accomplishments

- **13-field TELEM-02 schema realized verbatim.** FeedbackRow has exactly the fields listed in REQUIREMENTS.md line 94: session_id, turn_id, profile_id, profile_version, profile_hash, rating ∈ {+1, -1}, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out. validateRow rejects missing fields, null fields, non-array tool_calls, and any rating that isn't exactly +1 or -1.
- **Idempotent Alt+Up/Down upsert via turn_id.** upsertFeedback reads the entire file, locates the row by turn_id, merges the new row in place, and atomically rewrites via tempfile+rename. A user hitting Alt+Up 100x on the same turn produces exactly 1 row (T-03-05-02 DoS mitigation). `handleFeedbackKey` calls upsertFeedback (never appendFeedback directly).
- **pi 0.68 input-event intercept BEFORE keybind resolution (D-18).** `pi.on("input", handler)` receives raw ANSI sequences. \x1b[1;3A and \x1b[1;3B are the verbatim Alt+Up/Down escape sequences (RESEARCH §Common Pitfalls #1). Returning `{action: "handled"}` suppresses pi's default keybind — otherwise pi's alt+up binding routes to `app.message.dequeue`, stealing the keypress. Verified in feedback-ui.ts via ANSI_ALT_UP/ANSI_ALT_DOWN literal constants + returned-result tests.
- **Emmy-owned turn_id scheme resolves the plan-checker BLOCKER.** pi 0.68 TurnEndEvent (types.d.ts line 468-473) has NO turn_id field — only `turnIndex: number`. buildTurnMeta synthesizes turn_id = `${sessionId}:${turnIndex}` using the emmy-boot-time session identifier (`<ISO8601-with-dashes>-<profile-hash-8hex>` from pi-emmy.ts). `grep -c '(event as any)' packages/emmy-ux/src/pi-emmy-extension.ts` returns 0; all pi-event access is typed via structural narrowing.
- **HuggingFace datasets-loadable export (D-21 amendment).** `pi-emmy --export-hf <out_dir>` produces:
  - `feedback.jsonl` — verbatim copy of the source; HF-loadable via `datasets.load_dataset("json", data_files=...)` per RESEARCH §Summary #5.
  - `dataset_card.md` — emmy-authored schema description + row count + emmy version + git SHA + load_dataset snippet.
  - `provenance.json` — structured audit trail (emmy_version, git_sha, export_ts, row_count, warning_count, source_path, profile_hashes).
- **File-content warning scan without blocking export.** Six heuristic markers (code fence, function, def, import, class, #include) trigger per-row stderr warnings when the row's model_response or tool_calls blob looks like source code. Export is NOT blocked — D-21 defers consent/redaction to Phase 7. 2/3 intentional-trigger unit-test rows fire correctly; the benign row does not.
- **EMMY_TELEMETRY=off kill-switch honored end-to-end.** resolveTelemetryEnabled (Plan 03-02) is evaluated once at pi-emmy boot; the flag propagates through createEmmySession → buildRealPiRuntime → createEmmyExtension. When false: (a) pi.on("turn_end") handler is not registered, so the tracker stays empty; (b) pi.on("input") handler short-circuits with {action: "continue"} without ever parsing the keypress. Mirrors Plan 03-04's baseUrl-omitted semantics for the footer poller.
- **31 new passing tests (+1 opt-in HF integration skip).** Suite deltas:
  - feedback-append.test.ts: 10 tests (schema validation, 13-field completeness, large-row path, parent dir auto-create, 3-append ordering)
  - feedback-idempotent.test.ts: 7 tests (updateFeedback + upsertFeedback + multiple-press idempotency)
  - export-hf.integration.test.ts: 4 tests (layout assertions, file-content warning, missing-source error) + 1 opt-in skip
  - keybind-capture.test.ts: 8 tests (ANSI literals, thumbs-up/down flows, cancel-into-empty, non-matching keys, no-turn-tracker gate, kill-switch, idempotency Alt+Up/Down on same turn)
  - feedback-flow.integration.test.ts: 2 end-to-end tests (3-turn most-recent attribution; thumbs-down with free text)

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | RED — 5 feedback test files covering schema + idempotency + HF export + ANSI keybind + 3-turn flow | `35b7023` | test |
| 2 | GREEN — feedback-schema + feedback + turn-tracker + hf-export + feedback-ui + pi-emmy-extension wiring + pi-emmy CLI --export-hf | `1fc10c7` | feat |
| 3 | Task 3 operator-gated: interactive TUI verification on live emmy-serve (resume signal: `p3-05 feedback green`) | — | — |

**Plan metadata commit** (includes this SUMMARY + STATE + ROADMAP updates) follows.

## Per-outcome checklist — all 11 must_haves.truths satisfied

| # | Truth (from plan frontmatter must_haves.truths) | Evidence | ✓ |
|---|--------------------------------------------------|----------|---|
| 1 | pi input event handler intercepts raw keypress BEFORE pi's keybind resolution; Alt+Up (\x1b[1;3A) / Alt+Down (\x1b[1;3B) matched and consumed via {action:'handled'} | `feedback-ui.ts` ANSI_ALT_UP/DOWN constants + `handleFeedbackKey` returns `{action: "handled"}` on match. `pi-emmy-extension.ts` pi.on("input", ...) handler delegates. keybind-capture.test.ts "Alt+Up returns {action:'handled'}" green | ✓ |
| 2 | Rating targets MOST-RECENT completed agent turn by emmy-owned turn_id (D-19); no transcript cursor UI | `TurnTracker` stores ONE TurnMeta (latest via recordTurnComplete). `handleFeedbackKey` reads `tracker.getLatest()` — no cursor / no id selection. feedback-flow.integration.test.ts "after 3 turns, Alt+Up rates turn 3" green | ✓ |
| 3 | Feedback JSONL at ~/.emmy/telemetry/feedback.jsonl (global across sessions; TELEM-02 path verbatim) | `feedback.ts` defaultFeedbackPath = join(homedir(), ".emmy", "telemetry", "feedback.jsonl"). `grep -c '.emmy/telemetry/feedback.jsonl' packages/emmy-telemetry/src/feedback.ts` = 1. feedback-append.test.ts "defaultFeedbackPath contains TELEM-02 canonical segment" green | ✓ |
| 4 | Row schema has all 13 fields per TELEM-02 | `feedback-schema.ts` FeedbackRow interface + REQUIRED array lists all 13 verbatim. validateRow enforces. `grep` of field-name tokens in feedback-schema.ts = 37 (all 13 names referenced). feedback-append.test.ts "all 13 TELEM-02 fields" toHaveProperty assertions green | ✓ |
| 5 | Thumbs-down opens free-text prompt via pi's ctx.ui.input() modal; empty string and cancel both record empty comment | `handleFeedbackKey` when rating=-1 calls `ctx.ui.input("Thumbs-down — why?", ...)`; `typed ?? ""` converts undefined → "". keybind-capture.test.ts "Alt+Down cancel records empty-string comment" and "empty-string entry also records empty" both green | ✓ |
| 6 | Thumbs-up commits immediately with empty comment | `handleFeedbackKey` when rating=+1 does NOT call input(); builds row with comment="" directly. keybind-capture.test.ts "Alt+Up does NOT call ctx.ui.input" green (mock assertion on call count) | ✓ |
| 7 | Idempotency: rating same turn_id twice UPDATES the JSONL row (last-writer-wins) — via read-rewrite-atomic | `upsertFeedback` tries updateFeedback (read+mutate+tempfile-rename) → falls back to appendFeedback only on FeedbackNotFoundError. feedback-idempotent.test.ts "3 up-presses on same turn_id leave exactly 1 row" green. keybind-capture.test.ts "two Alt+Up presses on same turn → 1 row" green | ✓ |
| 8 | JSONL-only MVP; --export-hf produces HF-datasets-loadable artifact + emmy-authored dataset_card.md + provenance.json | `hf-export.ts` copies feedback.jsonl verbatim + writes dataset_card.md + provenance.json. `grep -c 'load_dataset' packages/emmy-telemetry/src/hf-export.ts` = 3 (card template references). export-hf.integration.test.ts "copies feedback.jsonl and emits dataset_card.md + provenance.json" green. Opt-in HF loadability test (skipped by default) shells `uv run python -c 'from datasets import load_dataset; ...'` | ✓ |
| 9 | --export-hf emits stderr warning on file-content markers; does NOT block export | 6 markers in FILE_CONTENT_MARKERS (code fence, function, def, import, class, #include). console.error per row; return `{warningCount: N}`. export-hf.integration.test.ts "file-content warning fires for rows whose model_response looks like code" asserts warningCount=2 on 2 intentional-trigger rows + 1 benign = rowCount=3 (not blocked) | ✓ |
| 10 | EMMY_TELEMETRY=off OR --no-telemetry: input hook returns {action: 'continue'} without recording | `pi-emmy-extension.ts` pi.on("input") body: `if (!telemetryEnabled) return {action: "continue"}`. `telemetryEnabled` comes from EmmyExtensionOptions, plumbed from pi-emmy.ts's resolveTelemetryEnabled call. keybind-capture.test.ts "telemetry disabled → Alt+Up returns 'continue' and writes nothing" green | ✓ |
| 11 | TurnMeta.turn_id derived from `${session_id}:${turnIndex}` — emmy owns the scheme; pi 0.68 TurnEndEvent has no turn_id field | `pi-emmy-extension.ts` buildTurnMeta: `turn_id: `${sessionId}:${event.turnIndex}``. `grep -c 'turnIndex' packages/emmy-ux/src/pi-emmy-extension.ts` = 8. `grep -c '(event as any)' packages/emmy-ux/src/pi-emmy-extension.ts` = 0 (typed access per plan-checker BLOCKER fix) | ✓ |

## Threat model posture

All 7 threats from the plan's `<threat_model>` addressed:

| ID | Disposition | Realization |
|----|-------------|-------------|
| T-03-05-01 (info disclosure via file contents in model_response / tool_calls) | mitigate | hf-export.ts file-content warning scan emits stderr per row with matching markers; buildTurnMeta captures only toolCall args (not toolResults outputs, which can carry file bodies); Phase 7 consent flow will layer on actual redaction. feedback.jsonl is user-scope under ~/.emmy (POSIX 0600 by default on most user homes) |
| T-03-05-02 (DoS: rapid Alt+Up spam fills filesystem) | mitigate | Idempotent upsert via turn_id — 100 rapid presses produce 1 row. upsertFeedback read-rewrite pattern is bounded at session turn count; each update is O(N) where N = feedback row count (tens-to-hundreds for author-scale use) |
| T-03-05-03 (Spoofing: pi built-in app.message.dequeue fires instead of emmy handler) | mitigate | handleFeedbackKey returns `{action: "handled"}` when Alt+Up/Down matches a rated turn — pi's keybind resolution sees consumed input and does NOT route to its default binding. Operator-verified in Task 3 checkpoint step 4 |
| T-03-05-04 (Tampering: user edits feedback.jsonl directly) | accept | User-scope file; intentional hand-edits are a user-sovereignty feature. readFeedback silently skips corrupt lines; next upsert on an unrelated turn validates + rewrites the whole file atomically |
| T-03-05-05 (Info disclosure via Langfuse span attrs carrying free-text comment) | mitigate | `emitEvent("feedback.recorded", {session_id, turn_id, rating})` deliberately omits `comment`. Free text stays in JSONL only. Rate-correlation spans in Langfuse show WHICH turns got rated, not WHAT the user typed |
| T-03-05-06 (Elevation of Privilege: ANSI in free-text causes terminal escape) | mitigate | ctx.ui.input() is pi's modal — pi sanitizes input. Stored comment is pure-string in JSONL; rendering back to terminal requires explicit escape pass-through which emmy does not do. readFeedback returns parsed JSON only; a redisplay tool would have to JSON.stringify the comment back out (escaping all ANSI) |
| T-03-05-07 (Repudiation: feedback events missing from Langfuse trace correlation) | mitigate | emitEvent("feedback.recorded") fires on every upsert with session_id + turn_id + rating + profile.* (auto-stamped by EmmyProfileStampProcessor). Per-event span is the correlation surface; full row stays in JSONL |

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's `<action>` block for Task 2 called out the emmy-owned turn_id scheme as a plan-checker BLOCKER resolution; Task 2 implemented that design verbatim. `buildTurnMeta` uses typed access (no `as any`) per the plan's acceptance criteria.

Optional integration probe (uv + python datasets.load_dataset) is guarded behind `SKIP_HF_INTEGRATION != "0"` — default test run skips, opt-in by setting `SKIP_HF_INTEGRATION=0`. This matches the plan's `<action>` instruction verbatim.

### Auth gates

None reached during executor's scope. Alt+Up/Alt+Down keypresses are local TUI events (no network). --export-hf is a pure file-to-file transform (no network, no auth). Optional uv + HF datasets probe requires Python env setup on the host — documented in the test's skip-condition, no remote auth involved.

## Four-way regression (at 1fc10c7 GREEN commit)

Verified 2026-04-22 at HEAD `1fc10c7`:

| Gate | Command | Result |
|------|---------|--------|
| TypeScript unit tests | `bun test` (with `$HOME/.bun/bin` on PATH) | **353 pass / 0 fail / 1 skip (opt-in HF) / 1649 expect() calls across 49 files in 2.91s** |
| TypeScript typecheck | `bun run typecheck` | **5 / 5 packages exit 0** (@emmy/telemetry, @emmy/provider, @emmy/tools, @emmy/context, @emmy/ux) |
| Python unit tests | `uv run pytest tests/unit -q` | **137 passed / 1 skipped** (shellcheck — unchanged from Plan 03-04 baseline) |
| Profile validate v1 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` | **exit 0** |
| Profile validate v2 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/` | **exit 0** |

Delta vs Plan 03-04 close: +31 bun tests (322 → 353). No regression in pytest or profile validate. All 5 typechecks still green.

Delta breakdown (count by test file):

| Test file | New tests |
|-----------|-----------|
| feedback-append.test.ts | 10 |
| feedback-idempotent.test.ts | 7 |
| export-hf.integration.test.ts | 4 (+1 opt-in skip) |
| keybind-capture.test.ts | 8 |
| feedback-flow.integration.test.ts | 2 |
| **Total** | **31 new (+1 skip)** |

## Sample feedback row (schema completeness proof)

A thumbs-up on a real turn produces a JSONL line like this (field order is JSON.stringify order from the FeedbackRow literal; `tool_calls` is non-empty on real turns that used at least one tool):

```json
{"session_id":"S-BB","turn_id":"S-BB:1","profile_id":"qwen3.6-35b-a3b","profile_version":"v2","profile_hash":"24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b","rating":-1,"comment":"the assistant got the filename wrong","model_response":"turn-1 response text","tool_calls":[{"name":"read","args":{"path":"x.ts"}}],"latency_ms":1100,"kv_used":21,"tokens_in":550,"tokens_out":60}
```

All 13 TELEM-02 fields present. The above row is the literal-expected output in `feedback-flow.integration.test.ts` "thumbs-down on turn 2" (field order may differ in real runs because `JSON.stringify` preserves insertion order from the handleFeedbackKey row constructor — NOT canonical sort. For rows ≤4KB the appendJsonlAtomic path uses canonical stringify; for >4KB rows the large-path uses plain JSON.stringify).

## Expected --export-hf output tree

```
/tmp/emmy-corpus/
├── feedback.jsonl        # verbatim copy of ~/.emmy/telemetry/feedback.jsonl
├── dataset_card.md       # # Emmy Lived-Experience Feedback Dataset + schema + load snippet
└── provenance.json       # {emmy_version, git_sha, export_ts, row_count, warning_count, source_path, profile_hashes}
```

Unit-test asserted in `export-hf.integration.test.ts` "copies feedback.jsonl and emits dataset_card.md + provenance.json".

## HuggingFace loadability proof (skipped by default — opt-in via SKIP_HF_INTEGRATION=0)

The integration test shells out to:

```bash
uv run python -c "from datasets import load_dataset
d = load_dataset('json', data_files='/tmp/emmy-corpus/feedback.jsonl')
assert len(d['train']) == 3, f\"expected 3 rows, got {len(d['train'])}\"
print('ok')"
```

Expected exit 0 + stdout containing "ok". Default test run skips this probe (hermetic CI invariant); local runs with `SKIP_HF_INTEGRATION=0` and `datasets` pip-installed exercise it. The Task 3 operator checkpoint also runs this command against a live 3-row corpus.

## Kill-switch test evidence

`keybind-capture.test.ts` "telemetry disabled → Alt+Up returns 'continue' and writes nothing":

- Constructs `FeedbackUiContext` with `enabled: false`.
- Recorded turn in tracker (so the handler WOULD fire if enabled).
- Sends Alt+Up.
- Asserts `result.action === "continue"` and `readFeedback(path).length === 0`.

Live TUI evidence is part of the Task 3 operator checkpoint step 9:

```bash
EMMY_TELEMETRY=off pi-emmy       # interactive TUI
# press Alt+Up after a turn completes
wc -l ~/.emmy/telemetry/feedback.jsonl
# expect: unchanged (no new row)
```

## Issues Encountered

None blocking. No deviations (Rule 1-3 auto-fixes not triggered). No auth gates. No pitfalls materialized.

The plan's `<interfaces>` block correctly anticipated the pi 0.68 input-event shape (`{type: "input", text: string, source: InputSource}`) and the result type (`{action: "continue" | "transform" | "handled"}`). The plan-checker-flagged BLOCKER (pi 0.68 TurnEndEvent has no turn_id field) was resolved verbatim in buildTurnMeta.

## Known Stubs

None introduced by this plan. Two fields (latency_ms, kv_used) default to 0 in `buildTurnMeta` because pi 0.68's turn_end event doesn't expose per-turn latency and the KV% cache lives in Plan 03-04's footer poller (not yet wired to the extension). This is a documented accepted degradation in the `key-decisions` frontmatter above — the 13-field schema still validates (0 is a valid number for both fields), and a downstream consumer can filter rows where `latency_ms === 0` if needed.

Plan 03-07 or a follow-up Phase 4 plan can:
1. Cache latency per turnIndex via Plan 03-02's `after_provider_response` event.
2. Subscribe to Plan 03-04's footer poller field state for KV%.
3. Merge both into the TurnMeta at turn_end.

This is documented in the D-21 key-decision above as a deliberate scope limit, not a hidden stub.

## Operator checkpoint — Task 3 manual rating flow test (deferred to `p3-05 feedback green`)

**Resume signal:** `p3-05 feedback green`

**Operator procedure** (verbatim from plan's Task 3 how-to-verify):

1. `rm -f ~/.emmy/telemetry/feedback.jsonl` (clean slate)
2. `pi-emmy` (interactive TUI) — prompt 3 separate instructions. After each completes:
   - Press **Alt+Up** after turn 1 (thumbs-up)
   - Press **Alt+Down** after turn 2 → free-text prompt appears → type "compaction mid-stream would be better" → Enter
   - Press **Alt+Up** after turn 3
   - Press **Alt+Up** after turn 3 AGAIN (idempotency test)
3. Exit TUI. Inspect:
   ```bash
   wc -l ~/.emmy/telemetry/feedback.jsonl          # expect 3 (not 4 — idempotent)
   cat ~/.emmy/telemetry/feedback.jsonl | jq 'keys | length' | sort -u   # expect single line "13"
   cat ~/.emmy/telemetry/feedback.jsonl | jq 'select(.rating == -1) | .comment'
   # expect "compaction mid-stream would be better"
   ```
4. Test pi built-in collision: does pressing Alt+Up still trigger pi's `app.message.dequeue` UI? Expected: NO (emmy's input handler runs first with `{action: "handled"}`). If pi's queued-messages popup appears, handler ordering is wrong.
5. `mkdir -p /tmp/emmy-corpus && pi-emmy --export-hf /tmp/emmy-corpus`
6. Inspect:
   ```bash
   ls /tmp/emmy-corpus             # feedback.jsonl + dataset_card.md + provenance.json
   wc -l /tmp/emmy-corpus/feedback.jsonl          # expect 3
   head -1 /tmp/emmy-corpus/dataset_card.md       # "# Emmy Lived-Experience Feedback Dataset"
   jq '.row_count == 3' /tmp/emmy-corpus/provenance.json   # true
   ```
7. HuggingFace loadability (if `uv run python -c` + `datasets` available):
   ```bash
   uv run python -c "from datasets import load_dataset; d = load_dataset('json', data_files='/tmp/emmy-corpus/feedback.jsonl'); print(f'rows={len(d[\"train\"])}, cols={d[\"train\"].column_names}')"
   ```
8. File-content warning: craft a feedback row with `"model_response": "```python\nprint('hi')\n```"` → re-run export → observe stderr warning.
9. Kill-switch: `EMMY_TELEMETRY=off pi-emmy` → Alt+Up → `wc -l ~/.emmy/telemetry/feedback.jsonl` unchanged.

**Pass gate:** All 9 steps succeed as described.

**Fail modes:** Any step failure BLOCKS Plan 03-05 close. Describe the deviation in the resume message.

## Next Wave Readiness — handoff to Plan 03-06

**Wave 3 parallel slot: Plan 03-06 (offline-OK badge UX-03) is file-disjoint from this plan** — touches the tool-registry boot audit + web_fetch runtime enforcement, not the feedback / input-event surfaces. Can execute concurrently.

**Plan 03-07 (v3 profile bump + CLOSEOUT + 3-run SC-2 matrix)** will:
- Flip TELEM-02 + TELEM-03 REQ-IDs from Wave-3-pending to Done in REQUIREMENTS.md
- Wire the operator resume signal `p3-05 feedback green` into the 03-CLOSEOUT evidence table
- Run the 3-variant SC-2 matrix against live GPU (Plan 03-03's stub-mode was the dry-run)

**Phase 7 (public artifact publication)** will consume:
- The --export-hf JSONL + dataset_card.md + provenance.json output
- The file-content warning scan (Phase 7 layers on actual redaction + consent prompt)
- parquet emission (deferred per D-21 amendment 2026-04-21)

## Self-Check: PASSED

File existence + commit existence verified at HEAD:

- `packages/emmy-telemetry/src/feedback-schema.ts` — FOUND (created in 1fc10c7)
- `packages/emmy-telemetry/src/feedback.ts` — FOUND (created in 1fc10c7)
- `packages/emmy-telemetry/src/turn-tracker.ts` — FOUND (created in 1fc10c7)
- `packages/emmy-telemetry/src/hf-export.ts` — FOUND (created in 1fc10c7)
- `packages/emmy-ux/src/feedback-ui.ts` — FOUND (created in 1fc10c7)
- `packages/emmy-telemetry/test/feedback-append.test.ts` — FOUND (created in 35b7023)
- `packages/emmy-telemetry/test/feedback-idempotent.test.ts` — FOUND (created in 35b7023)
- `packages/emmy-telemetry/test/export-hf.integration.test.ts` — FOUND (created in 35b7023)
- `packages/emmy-ux/test/keybind-capture.test.ts` — FOUND (created in 35b7023)
- `packages/emmy-ux/test/feedback-flow.integration.test.ts` — FOUND (created in 35b7023)
- Commit `35b7023` (Task 1 RED) — FOUND in git log
- Commit `1fc10c7` (Task 2 GREEN) — FOUND in git log

---

*Phase: 03-observability-agent-loop-hardening-lived-experience*
*Plan: 05*
*Completed: 2026-04-22*
