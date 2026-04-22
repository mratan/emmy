# Phase 3 Wave 2 — Plan 03-02 Task 4 walkthrough

**Date:** 2026-04-22
**Executor:** orchestrator (main Claude) running on the DGX Spark directly
**emmy-serve:** Qwen3.6-35B-A3B-FP8 @ `127.0.0.1:8002`
**pi-emmy profile:** `qwen3.6-35b-a3b@v2`, hash `sha256:24be3eea...85d8b`
**Plan 03-02 must_have coverage:** Task 4 has three sub-cases — (i) live Langfuse UI trace, (ii) JSONL-only fallback when Langfuse unreachable, (iii) `EMMY_TELEMETRY=off` / `--no-telemetry` kill switch. This walkthrough validates **(ii) and (iii)**; (i) remains operator-gated (requires browser-mediated Langfuse UI API key provisioning).

---

## Case (ii) — JSONL-only fallback (no Langfuse stack running)

**Command:** `bash scripts/sc1_trace_walkthrough.sh`

**Preconditions:** Langfuse docker compose stack NOT running. `observability/langfuse/.env` has `LANGFUSE_PUBLIC_KEY=` / `LANGFUSE_SECRET_KEY=` empty.

**Observed boot banner:**

```
[emmy] Langfuse keys not set (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY) - running JSONL-only
pi-emmy starting (profile=qwen3.6-35b-a3b@v2, base_url=http://127.0.0.1:8002, telemetry=JSONL-only)
```

This satisfies must_have truth: _"OTLP exporter silently drops to JSONL-only when Langfuse unreachable at boot; boot banner distinguishes 'JSONL + Langfuse OTLP' vs 'JSONL-only' vs 'OFF'"_.

**pi-emmy result:** Exit 0. SP_OK canary fired. Agent produced `src/hello.ts` + `src/hello.test.ts`; `bun test` inside walkthrough → 1 pass / 0 fail.

**events.jsonl location:** `/tmp/emmy-p3-w2-walkthrough/runs/<session>/events.jsonl` — copied to `case-ii-events.jsonl`.

**JSONL integrity:**

- 16 total events across 7 distinct event types: `session.start`, `session.sp_ok.pass`, `session.tools.registered`, `session.transcript.open`, `prompt.assembled`, `harness.assembly` × 5, `tool.invoke` × 6.
- `15 / 16` events carry the full profile stamp (`profile.id` + `profile.version` + `profile.hash`). First event shape:

```json
{
  "event": "session.sp_ok.pass",
  "profile": {
    "hash": "sha256:24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b",
    "id": "qwen3.6-35b-a3b",
    "path": "/data/projects/emmy/profiles/qwen3.6-35b-a3b/v2",
    "version": "v2"
  },
  "ts": "2026-04-22T06:44:54.273Z"
}
```

**Observation — stamping gap on `prompt.assembled`:**

The `prompt.assembled` event carries its own `sha256` (prompt-layer hash per SC-5) but NO `profile` field:

```json
{
  "event": "prompt.assembled",
  "layers": [ ... system.md, AGENTS.md, tool_defs, user ... ],
  "sha256": "acde256e6ca13cdf40e939216c953948b121601c84be0dbc346ea1d307a45482",
  "ts": "2026-04-22T06:44:54.281Z"
}
```

Plan 03-02's must_have truth is narrowly scoped to **spans** (OTel) via `SpanProcessor.onStart`, not JSONL events. The profile stamp on JSONL events is a convention followed by 15/16 events but not enforced by a central processor on the JSONL side. `prompt.assembled` is emitted from the prompt-assembly path, which computes before the session profile context is bound to `emitEvent()`.

**Classification:** library-level gap, non-blocking for Task 4 acceptance, worth surfacing in Plan 03-07 Phase-3 CLOSEOUT as a deferred observation. Does not affect the OTel / Langfuse side (which the must_have truth governs).

---

## Case (iii) — `--no-telemetry` kill switch

**Command:** `bash scripts/sc1_trace_walkthrough.sh --no-telemetry`

**Observed boot banner:**

```
[emmy] OBSERVABILITY: OFF (EMMY_TELEMETRY=off or --no-telemetry)
pi-emmy starting (profile=qwen3.6-35b-a3b@v2, base_url=http://127.0.0.1:8002, telemetry=OFF)
```

This satisfies must_have truth: _"EMMY_TELEMETRY=off OR --no-telemetry suppresses BOTH sinks (JSONL + OTLP) and SDK init"_.

**pi-emmy result:** Exit 0. SP_OK canary fired. Agent produced files; `bun test` → 1 pass / 0 fail.

**events.jsonl:** NOT created. `find /tmp/emmy-p3-w2-walkthrough -name 'events.jsonl'` → empty. JSONL sink fully suppressed.

---

## Case (i) — live Langfuse UI trace — OPERATOR-GATED

Deferred — requires browser-based account + API key creation in the Langfuse UI:

1. `bash scripts/start_observability.sh` — brings up the 6-service Langfuse compose stack
2. Browser → `http://localhost:3000` — create first user + project
3. Langfuse UI → Settings → API Keys → "Create new API keys"
4. Paste `pk-lf-...` / `sk-lf-...` into `observability/langfuse/.env` under `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`
5. Re-run `bash scripts/sc1_trace_walkthrough.sh` — boot banner should now read `telemetry=JSONL + Langfuse OTLP`
6. Langfuse UI → Traces → most-recent session — inspect span tree; confirm every span carries `emmy.profile.{id,version,hash}`

**Resume signal:** `p3-02 trace green` once the operator confirms the live trace is visible with the full profile stamp.

Plan 03-02 executor pre-verified the 6/6 Docker Compose stack health during plan execution (commit `f410bfd`), so steps 1-3 are known-working. The remaining case-(i) verification is purely a UI-surface check.

---

## Task 4 summary

| Case | Status | Evidence |
|------|--------|----------|
| (i) live Langfuse UI trace | deferred (operator) | (pending) |
| (ii) JSONL-only fallback | ✓ green | `case-ii-events.jsonl` + `case-ii-jsonl-only.log` |
| (iii) `--no-telemetry` kill switch | ✓ green | `case-iii-telemetry-off.log` |

Cases (ii) and (iii) exercise 2 of the 3 boot-banner states (`JSONL-only`, `OFF`) — the third state (`JSONL + Langfuse OTLP`) requires case (i) UI provisioning and will be verified at Phase 3 CLOSEOUT (Plan 03-07).
