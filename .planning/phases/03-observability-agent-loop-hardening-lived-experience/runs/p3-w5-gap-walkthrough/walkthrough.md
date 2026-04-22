# Plan 03-08 Task 3 walkthrough — attempt 1

**Date:** 2026-04-22
**Runtime:** DGX Spark; emmy-serve Qwen3.6-35B-A3B-FP8 @ `127.0.0.1:8002`
**Driver:** `pexpect` (PTY-backed spawn of `pi-emmy --profile .../v3`)
**Build at gate:** commits `8fe750d` (RED) + `7e7da29` (GREEN) from Plan 03-08

## Results

| Step | Check | Result |
|------|-------|--------|
| 1 | TUI launches without "TUI unavailable" bail | ✓ GREEN — `pi-emmy starting (profile=qwen3.6-35b-a3b@v3, telemetry=JSONL-only)` + live prompt editor + footer renders |
| 2 | Turn 1 completes, Alt+Up appends a row | ✗ FAIL — Alt+Up keystroke sent through PTY, but `feedback.jsonl` row count stayed at 0 |
| 3 | Idempotent Alt+Up | — (trivially passed because step 2 never wrote) |
| 4 | Turn 2, Alt+Down + comment | ✗ FAIL — same cause as step 2 |
| 5 | Ctrl-C clean teardown | ✓ GREEN — pi cleaned up the terminal, no scrambled stty |
| 6 | Kill-switch — `EMMY_TELEMETRY=off` banner + no writes | ✓ GREEN — banner `OBSERVABILITY: OFF`; `telemetry=OFF`; zero writes (trivially, since baseline path also doesn't write) |

Full pexpect transcript in `walkthrough-attempt-1.log` (181 lines, includes ANSI from pi's TUI + emmy stderr boot lines).

## Root-cause finding

Plan 03-05's D-18 "intercept Alt+Up/Down BEFORE pi's keybind resolution via `pi.on('input', handler)`" is based on a mis-reading of pi 0.68's API. Confirmed from pi sources at `node_modules/@mariozechner/pi-coding-agent/dist/`:

1. **`pi.on("input", handler)` is a message-submission event, NOT a keybind event.** Pi fires it via `_extensionRunner.emitInput(text, images, source)` inside `agent-session.js:689-700`, and `emitInput` is called only when the user submits a message (types text and hits Enter). The handler payload is `{text, images, source}` where `text` is the typed message. Raw keystrokes are NEVER delivered through this event — `event.text === "\x1b[1;3A"` can never match because pi doesn't put ANSI byte sequences into the `text` field.

2. **Alt+Up is routed through pi's CustomEditor.onAction keybind table.** `interactive-mode.js:1857`:
   ```js
   this.defaultEditor.onAction("app.message.dequeue", () => this.handleDequeue());
   ```
   So even though emmy's handler was registered, pi delivers Alt+Up to its own `handleDequeue` handler; emmy never sees the keystroke.

3. **Pi 0.68 DOES expose an extension-facing shortcut API** — `pi.registerShortcut(shortcut: KeyId, options)` at `core/extensions/types.d.ts:780`, with `ExtensionContext` delivered to the handler at `types.d.ts:971-976`:
   ```ts
   export interface ExtensionShortcut {
     shortcut: KeyId;
     description?: string;
     handler: (ctx: ExtensionContext) => Promise<void> | void;
     extensionPath: string;
   }
   ```

4. **But `alt+up` is reserved for the built-in `app.message.dequeue`.** Pi's extension runner declines extension shortcuts that collide with built-ins (`dist/core/extensions/runner.js:267`):
   ```
   Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.
   ```
   So a direct `pi.registerShortcut("alt+up", ...)` would be silently skipped.

## Implications

Plan 03-08 GREEN Task 2 **did** ship a correct TUI wire-through at the runtime level:
- `buildRealPiRuntimeTui` graduates from Plan 02-04's SDK path to `createAgentSessionRuntime` + `InteractiveMode`.
- All six `pi.on(...)` handlers (before_provider_request, turn_end, session_start footer, session_start badge, turn_start compaction, agent_end) still register.
- SP_OK canary order preserved.
- initOtel order preserved.
- bun test 412 / 1 skip / 0 fail (up from 396 / 1).
- v1+v2+v3 profile validate green.
- No `TUI unavailable` bail.
- Clean Ctrl-C teardown.

But the Alt+Up/Down delivery path **does not work** because:
- `pi.on("input", ...)` is a text-submission event, not a keybind intercept.
- `alt+up` / `alt+down` are claimed built-ins in pi 0.68.
- No emmy-side ANSI intercept exists ahead of pi's `CustomEditor`.

## Next-step decision space

Three plausible paths to close SC-3 end-to-end:

| Option | Approach | Cost | Trade-off |
|--------|----------|------|-----------|
| **A. Override built-in via `keybindings.json`** | Ship a project-local keybindings override that unbinds `app.message.dequeue` from `alt+up` and lets emmy claim it via `pi.registerShortcut("alt+up", ...)` | 0.5 day | Loses pi's dequeue UX; may need an alternate binding for dequeue |
| **B. Unclaimed keybinding** | Use `ctrl+alt+up/down` or `meta+shift+u/d` — keys pi does NOT claim — via `pi.registerShortcut` | 0.5 day | Doc says `Alt+Up`, but users can live with a different chord; HF-dataset shape unchanged |
| **C. Slash-command pivot** | Use `/thumbs-up` and `/thumbs-down` slash commands (text input, fires `pi.on("input")`); handler matches `event.text === "/thumbs-up"` | 0.5 day | Requires typing 10+ chars instead of one keystroke; loses the "quick-hit low-friction rating" user story |

Resume signal: **NOT YET** — gap remains. Plan 03-05's D-18 assumption is structurally broken; we need a choice before the next iteration.

## Artifacts

- `walkthrough-attempt-1.log` — pexpect transcript (181 lines)
- `/tmp/p3-08-tui-walkthrough.py` — pexpect driver (preserved for re-runs)
- pi-emmy binary at HEAD `7e7da29` — TUI launches cleanly; subsequent wiring iteration only needs to swap the emmy-side capture mechanism
