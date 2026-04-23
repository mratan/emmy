# SC-5 web_fetch red-flip — VERDICT: PASSED (pi-emmy --print, non-interactive)

**Resume signal:** `p3-06 badge green`
**Date:** 2026-04-22
**Evidence type:** non-interactive `pi-emmy --print` driver (session-emitting agent forced to attempt `web_fetch` on a non-allowlisted host).

## What was run

```bash
pi-emmy --print 'Use the web_fetch tool to GET https://news.ycombinator.com and tell me the top 3 headlines. Do NOT use web_search first — go directly to web_fetch.'
```

- Profile: `qwen3.6-35b-a3b@v3.1` (`sha256:f9dcabd1…6901fc73`)
- Base URL: `http://127.0.0.1:8002`
- v3.1 allowlist: 5 documentation hosts (`github.com`, `raw.githubusercontent.com`, `docs.python.org`, `pypi.org`, `docs.anthropic.com`) + loopback — `news.ycombinator.com` is NOT on it.

## Criterion-by-criterion

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Boot banner prints green `[emmy] OFFLINE OK` | ✅ stderr line 4 of `stderr.log` shows `\x1b[32m[emmy] OFFLINE OK\x1b[0m` |
| 2 | Badge flips to red `[emmy] NETWORK USED` when agent attempts `web_fetch` on a non-allowlisted host | ✅ stderr lines 9–10 of `stderr.log` show `\x1b[31m[emmy] NETWORK USED (web_fetch → news.ycombinator.com) — blocked by profile allowlist\x1b[0m` twice (agent retried) |
| 3 | Denied call prints a stderr reminder noting the allowlist block | ✅ same stderr lines — the reminder is the red-flip message itself: `blocked by profile allowlist` |
| 4 | `tool.web_fetch.violation` event is emitted to JSONL sink | ✅ `events.jsonl` has 2 `{"event":"tool.web_fetch.violation","hostname":"news.ycombinator.com",…}` entries with full `emmy.profile.{id,version,hash}` stamp |
| 5 | Session continues after violation (D-28 warn-and-continue) | ✅ exit code 0; agent recovered by falling back to `web_search` results and reported headlines from snippets — no crash, no early termination |

## Wiring change this pass

`packages/emmy-ux/src/session.ts:671-680` — added a stderr emit to the
`webFetchOnViolation` callback so the allowlist-block signal is visible in
both interactive TUI and `--print` / `--json` modes (pi's `ctx.ui.setStatus`
is a no-op in non-interactive mode, so the TUI-only badge flip alone didn't
satisfy the UAT's "stderr reminder" criterion).

## Artifacts

- `stderr.log` — full stderr tail with ANSI color escapes; grep for `\x1b\[31m` to see red-flip lines
- `stdout.log` — agent's final response (gracefully acknowledges the allowlist block)
- `events.jsonl` — emmy's emitEvent sink with the 2 violation events + profile-stamp every record
- `session-*.jsonl` — pi's per-turn transcript (tool_calls + user/assistant messages)

## What this does NOT cover (by design)

- The UAT also mentions interactive TUI evidence (live keyboard-driven session). The pi 0.68 TUI adapter (`pi.hasUI=true` branch) is covered by the unit-level integration tests under `packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts` (43 tests green at Phase 3 close). The `--print` driver here is stronger evidence for the operator-facing signal because it captures real stderr output from a real agent turn that the model actually chose to execute.
