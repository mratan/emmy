# SPIKE — Headless mode for Emmy (`pi-emmy --batch`)

**Status:** proposed (pre-phase, not yet committed to roadmap)
**Owner:** TBD
**Time-box:** 1 day (8 working hours, hard cap)
**Phase that depends on this:** 04.5 (sub-agent dispatch v1) and 05 (Eval Harness — EVAL-02 SDK entry point)
**Decision this spike informs:** the CLI surface, JSON transcript schema, and slash-command preamble semantics for non-interactive emmy runs. Output is a runnable `pi-emmy --batch` plus `HEADLESS-RESULTS.md` documenting limitations.

---

## 1 — Context

The user has already established that the bugs that surface when they run emmy themselves are mostly **behavior / state / timing / profile-loading**, not Ink rendering. A headless mode covers ~90% of those cases for autonomous debugging. This is also exactly the surface required for **EVAL-02** (Phase 5: "public SDK entry point so harness can be imported as a library") — pulling EVAL-02 forward as a Phase 4.x spike pays double dividends:

1. The user gets autonomous debug coverage from Claude.
2. Phase 4.5's sub-agent dispatch needs to instantiate child sessions programmatically — same primitive.
3. Phase 5's eval driver consumes the same machine-readable transcript.

One artifact, three customers.

## 2 — Updated baseline (the work is already half-done)

Direct read of `packages/emmy-ux/src/session.ts:284–327` shows a `runPrint(prompt, {mode: "text" | "json"})` helper hidden inside the adapter. It already:

- Subscribes to `agent_end` event (line 296)
- Resolves with the last assistant message's concatenated text content (lines 301–314)
- Optionally collects all events when `mode === "json"` (line 295)
- Surfaces errors via `prompt().catch()` rejection (lines 320–325)

What's *not* there:
- No CLI flag to invoke it from `bin/pi-emmy.ts` (the binary is interactive-only today).
- No structured JSON envelope — `mode: "json"` returns `{text, messages: collectedEvents}` but the events are pi's raw shape, not a stable Emmy schema.
- No `--cmds` / slash-command preamble support — slash commands like `/start qwen3.6-35b@v3.1` are bound to the interactive TUI's input handler, not the headless path.
- No flags for `--seed`, `--max-turns`, `--no-memory`, `--profile`.
- No exit-code semantics (success / max-turns / error / abort).

So the spike is **mostly plumbing + schema design**, not new agent machinery.

## 3 — CLI surface (proposed)

```
pi-emmy --batch <task>          # task as final positional arg
pi-emmy --batch --task-file path/to/task.md
pi-emmy --batch --task-stdin   # read task from stdin

# Required (one of):
  <task> | --task-file FILE | --task-stdin

# Profile + lifecycle:
  --profile NAME[@VERSION]      # equivalent to running /start NAME@VERSION first
  --cmds 'cmd1; cmd2; ...'      # ordered slash-command preamble run before the task
  --max-turns N                 # hard cap on agent turns; default 50
  --timeout-seconds N           # wall-clock cap; default 600

# Determinism / reproducibility:
  --seed N                      # propagated to vLLM sampling (best-effort)
  --no-memory                   # skip filesystem memory tool's "view memory" preamble
  --memory-snapshot DIR         # read+restore .emmy/notes/ from snapshot before run

# Output:
  --output-format text|json     # default: json (one JSONL line per turn + final summary)
  --output FILE                 # default: stdout
  --transcript-dir DIR          # write per-turn JSONL + tool details here

# Diagnostics:
  --verbose                     # log lifecycle events to stderr
  --emit-otel                   # write OTLP trace tree as JSON to --output prefix
```

**Exit codes:**
- `0` — task completed (last assistant message reached terminal state)
- `2` — max-turns hit
- `3` — timeout hit
- `4` — agent error / unrecoverable provider failure
- `5` — pre-flight failure (profile not loaded, vLLM unreachable, slash command rejected)
- `130` — Ctrl-C (POSIX standard)

## 4 — JSON output schema (proposed)

A single JSON object on stdout (`--output-format json`), or one JSONL line per event when `--transcript-dir` is set. The single-object shape:

```jsonc
{
  "schema_version": "1",
  "emmy_version": "<from package.json>",
  "profile": { "id": "qwen3.6-35b-a3b", "version": "v3.1", "hash": "<sha256>" },
  "task": "<verbatim user task>",
  "preamble_cmds": ["/start qwen3.6-35b@v3.1"],
  "started_at": "2026-04-26T...",
  "ended_at": "2026-04-26T...",
  "exit_reason": "completed" | "max_turns" | "timeout" | "error" | "aborted",
  "turns": [
    {
      "turn_index": 0,
      "role": "user" | "assistant" | "tool",
      "content": "...",                          // assistant text or user prompt
      "tool_calls": [                            // when role === assistant
        { "name": "Bash", "args": {...}, "id": "..." }
      ],
      "tool_results": [                          // when role === tool
        { "name": "Bash", "tool_call_id": "...", "ok": true, "details": {...} }
      ],
      "tokens": { "input": 0, "output": 0, "cache_read": 0, "cache_write": 0 },
      "wall_ms": 0
    }
  ],
  "final_assistant_text": "<the canonical answer>",
  "totals": { "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "wall_seconds": 0 },
  "telemetry": {
    "compactions": [{ "trigger": "threshold", "before_tokens": 0, "after_tokens": 0 }],
    "errors": []
  },
  "trace": {                                     // when --emit-otel
    "trace_id": "<32hex>",
    "root_span_id": "<16hex>",
    "spans": [...]                                // OTel-flavored tree
  }
}
```

This is **the same envelope an eval driver would consume** (EVAL-02). Sub-agent transcripts in Phase 4.5 nest as `turn.tool_results[i].subagent_transcript` with the same shape recursively, depth-capped at 1.

## 5 — Slash-command preamble strategy

Pi's slash commands live in the interactive TUI's input handler — they are not callable from `session.prompt()`. Two implementation options for `--cmds '/start qwen3.6-35b@v3.1'`:

- **Option A — execute extension commands directly.** Emmy's slash-command implementations live in `packages/emmy-ux/src/slash-commands.ts`; expose an internal `executeSlashCommand(name, args, ctx)` API that the headless runner calls before `session.prompt(task)`. This matches how interactive mode dispatches them but bypasses the TUI input handler.
- **Option B — re-implement /start as a programmatic option.** Map `--profile NAME@VERSION` to the same code path `/start` calls (profile loading, sidecar lifecycle, etc.) without going through a slash command at all.

**Recommendation: B for `--profile`** (the most common case, deserves a dedicated flag), **A for everything else** via `--cmds`. Both share the same underlying `executeSlashCommand` plumbing — building it once, calling it from two surfaces.

## 6 — Spike scope: 6 hypotheses

### H1 — Wire `runPrint` to a `--batch` flag (60 min)
**Method:** Add `--batch` / `--task-file` / `--task-stdin` parsing to `bin/pi-emmy.ts`; route to `runPrint` from the existing adapter; emit text or JSON to stdout.
**Pass:** `pi-emmy --batch 'echo hello via Bash'` runs end-to-end, returns exit 0, prints either the assistant text or a JSON envelope.
**Fail:** Pi's existing `bin/pi-emmy.ts` is too entangled with interactive-mode bootstrap — would require splitting boot into shared+TUI halves. Add a follow-up plan to Phase 4.x.

### H2 — Stable JSON envelope (60 min)
**Method:** Define the §4 schema as a TS type. Build a converter from pi's raw event stream + `session.getSessionStats()` into the envelope. Run it across 5 sample tasks (a Bash one-shot, a multi-turn edit, a grep+read, a deliberately-failing task, a task that triggers compaction).
**Pass:** All 5 produce a schema-valid envelope. `final_assistant_text` matches the human-visible last message in the equivalent interactive run.
**Fail:** Schema needs additional fields (e.g., compaction timing details) — adjust §4 and re-test.

### H3 — `--profile NAME@VERSION` (45 min)
**Method:** Reuse `/start` profile-loading code path (Option B in §5). Pre-flight: vLLM up, profile valid. Run a `--batch` task immediately after.
**Pass:** Same observable behavior as `interactive → /start → prompt`. Exit code 5 if profile missing.
**Fail:** Profile loading has interactive-only side effects (TUI prompts, interactive auth) — refactor required.

### H4 — `--cmds` for arbitrary slash-command preamble (60 min)
**Method:** Implement `executeSlashCommand` API (Option A in §5). Test with `--cmds '/profile show; /context'`.
**Pass:** Each command runs in order; failures abort with exit 5 and a structured error in stderr.
**Fail:** Some commands depend on TUI state (e.g., `/clear` for the screen) — document which commands are headless-incompatible.

### H5 — Determinism flags (45 min)
**Method:** `--seed N` propagates to the vLLM sampling layer; `--no-memory` skips the memory tool's preamble (matters once Phase 4.4 lands; for now just a no-op flag with a TODO marker); `--memory-snapshot DIR` restores `.emmy/notes/` from a directory before the run.
**Pass:** Two `--seed 42 --batch ...` runs produce byte-identical `final_assistant_text` (best-effort — vLLM batched FP8 is non-deterministic at the kernel level, so accept any drift ≤1% by token count and document).
**Fail:** Seed not honored at all — file an upstream issue and document the limit.

### H6 — Real-deal E2E with live Qwen 3.6 35B-A3B (90 min, runs last)
**Method:**
1. `start_emmy.sh` brings vLLM up on `qwen3.6-35b-a3b@v3.1` (operator step, off the spike clock).
2. Run a 5-task batch script:
   - **T1:** "what's in the current directory?" — sanity check, exit 0, ≤2 turns.
   - **T2:** "search this repo for the string `customTools` and tell me what it does" — multi-turn grep+read.
   - **T3:** "create a file `/tmp/emmy_test.txt` with the text `hello` and confirm" — write tool exercised.
   - **T4:** "read every file in `packages/emmy-context/src/` and summarize the public API" — long-context, may trigger compaction.
   - **T5:** Deliberately broken — "fix the syntax error in a file that doesn't exist" — must exit non-zero with a useful error envelope.
3. Verify:
   - All 5 produce schema-valid JSON envelopes.
   - T4 shows at least one `telemetry.compactions[]` entry if input grows past threshold.
   - T5 exits non-zero with `exit_reason: "error"` and a populated `telemetry.errors[]`.
   - `final_assistant_text` for T1–T4 matches what an interactive operator would observe (eyeball check; for T1 the answer is fully deterministic given pwd).
**Pass:** All checks succeed; per-task wall-clock ≤120s on Qwen 35B-A3B.
**Fail:** Capture in `HEADLESS-RESULTS.md` H6 section; flag any UX gap that an interactive operator would never have hit (e.g., a slash command that hangs because it expects TTY confirmation).

## 7 — Time budget

| Hypothesis | Budget | Cumulative |
| --- | ---: | ---: |
| H1 — `--batch` plumbing | 60 min | 1:00 |
| H2 — JSON envelope schema | 60 min | 2:00 |
| H3 — `--profile` flag | 45 min | 2:45 |
| H4 — `--cmds` preamble | 60 min | 3:45 |
| H5 — Determinism flags | 45 min | 4:30 |
| H6 — Real-deal E2E (Qwen 3.6 live) | 90 min | 6:00 |
| **Writing up** HEADLESS-RESULTS.md + updating CLI help text | 90 min | 7:30 |
| **Slack** for follow-up issues filed upstream | 30 min | **8:00** |

## 8 — Deliverables

1. **`packages/emmy-ux/src/headless-runner.ts`** (~150 lines) — the runner module. Exports `runHeadless(opts: HeadlessOptions): Promise<HeadlessResult>`.
2. **`packages/emmy-ux/bin/pi-emmy.ts`** edits — `--batch` and friends parsing, dispatch.
3. **`packages/emmy-ux/src/headless-schema.ts`** — TS types for the §4 envelope, exported for eval-driver consumers.
4. **`scripts/headless-smoke/`** — 5 task files for H6, plus a `run_all.sh` for repeat smoke-testing.
5. **`.planning/pre-phase/04.5-subagents/HEADLESS-RESULTS.md`** — per-H pass/fail with evidence.
6. **CLI help text** updated; brief mention in `docs/runbook.md` if the spike succeeds.

## 9 — Decision matrix this informs

| Outcome cluster | Phase 4.x shape |
| --- | --- |
| H1, H2, H3 pass; H4 fails partly | **Ship `--batch + --profile + JSON envelope` immediately.** `--cmds` deferred to a follow-up. Most users only need `--profile` anyway. |
| H1 passes; H2 fails | **Ship text-only headless first**, JSON envelope as a separate plan. Eval-driver work waits for envelope. |
| H1 fails | **Refactor pi-emmy bootstrap** as its own plan in Phase 4.4 or 4.5; headless mode blocks behind it. |
| H6 passes | **Headless mode is daily-driver-ready.** Claude can self-debug without operator. EVAL-02 90% done. |
| H6 fails on >1 task | **Headless mode usable but with caveats.** Document which task classes don't work yet. Operator still needed for that residue. |

## 10 — What this spike deliberately does NOT cover

- **Interactive TUI parity** — headless mode is intentionally a subset. Things that require tty (Ctrl-P model cycle, interactive auth, the GPU/KV footer's live redraw) stay out.
- **Streaming output to stdout** — final-answer-only on stdout for v1. A `--stream` flag for live token output is a follow-up.
- **Multi-turn user interaction** — headless runs one task to completion. A REPL-over-stdin mode (`--repl`) is out of scope.
- **`--abort-on` heuristics** — quality-based abort (e.g., "stop if assistant says X") is for the eval driver, not the runner.
- **The actual Phase 5 eval harness** — this spike *enables* EVAL-02 by providing the SDK entry; it doesn't build the benchmark suite, dataset loaders, or scoring pipeline.

---

## 11 — Decisions locked in (from discussion)

- **Runtime:** Bun (matches `bun.lock` + Emmy's existing posture).
- **Mocking:** H1–H5 use stub HTTP for `/v1/chat/completions` (≤30 lines `Bun.serve`). H6 is the only step that exercises live vLLM.
- **Commit posture:** spike scripts (`scripts/headless-smoke/` + any spike-specific test harness) and `.planning/pre-phase/04.5-subagents/` artifacts land as one commit so artifacts and their generators travel together.
