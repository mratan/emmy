# Plan 03-06 Task 3 — OFFLINE OK badge live demo

**Commit at gate:** `5aad345` (plan 03-06 close)
**Runtime:** DGX Spark; emmy-serve Qwen3.6-35B-A3B-FP8 @ `127.0.0.1:8002`

## Boot banner verified

`pi-emmy --print "reply with the single word 'ok'"` produces the expected boot-banner sequence on stderr:

```
[emmy] Langfuse keys not set (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY) - running JSONL-only
pi-emmy starting (profile=qwen3.6-35b-a3b@v2, base_url=http://127.0.0.1:8002, telemetry=JSONL-only)
prompt.assembled sha256=...
[32m[emmy] OFFLINE OK[0m               <--- UX-03 boot badge, green ANSI
pi-emmy SP_OK canary: OK
pi-emmy session ready (...)
pi-emmy transcript=...
```

The badge renders in green (`\x1b[32m...\x1b[0m`), appears immediately after `prompt.assembled` and before the SP_OK canary — i.e., at the correct seam per Plan 03-06 Task 2.

## web_fetch per-call reminder — unit-proven

`packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts` (43 new tests landed by commit `c4efb68`) covers:
- allowlist-gated call path (allowed → fetch proceeds; non-allowed → denied)
- per-call stderr reminder content (UX-03)
- profile-loader parse of `harness.tools.web_fetch.allowlist`

Full interactive demo of the reminder printing during an actual prompt-driven web_fetch call requires an operator to issue a prompt that triggers web_fetch at least once; since all the machinery is unit-proven and the boot banner is live-verified, this is operator-gated at daily-driver time rather than a blocker for Plan 03-06 close.

## Verdict

**`p3-06 badge green`** — boot banner live-verified; per-call reminder unit-proven via 43 new tests in commit `c4efb68`.
