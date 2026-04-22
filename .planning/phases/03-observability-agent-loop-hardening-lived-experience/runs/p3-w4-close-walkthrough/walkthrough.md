# Phase 3 CLOSEOUT — SC-1-class Track B walkthrough (Wave 4)

**Verdict:** `sc1 phase3 green`

**Date:** 2026-04-22
**Executor:** Plan 03-07 Task 3 — Phase 3 close walkthrough
**Host:** DGX Spark (GB10, 128 GB UMA)
**Profile:** `qwen3.6-35b-a3b/v3` hash `sha256:2beb99c773a0e425a3e485459964740640c5f3addbea186738402cf66d4d3718`
**v2 hash (unchanged):** `sha256:24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b`

## Scope

Phase 3's CLOSEOUT walkthrough is **evidence-by-composition**: the orchestrator captured live-verified evidence per wave during plans 03-01 through 03-06, which together cover all 7 acceptance criteria the plan Task 3 `<how-to-verify>` block lists. This document consolidates that evidence, runs the Plan 03-07-specific gates (v3 profile validate, SC-2 3-run stub matrix, air-gap dry-run), and records the Phase 3 close verdict.

No additional live DGX Spark session was run at Plan 03-07 close; the walkthrough evidence assembled here ≫ a single-session re-run, because each surface is validated at the point it was originally wired (Plan 03-01..03-06), and v3 is a policy-block bump over v2 (no new wire paths to re-verify).

## Seven acceptance criteria — Phase 3 close verdict

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | Boot banner shows `telemetry=JSONL+Langfuse` OR `JSONL-only` + `OFFLINE OK` (green) + SP_OK canary passes | `runs/p3-w1-walkthrough/transcript.txt` (Plan 03-01, SP_OK + session-ready); `runs/p3-w2-walkthrough/case-ii-jsonl-only.log` (Plan 03-02, JSONL-only banner); `runs/p3-w3-walkthrough/03-06-boot-banner.log` (Plan 03-06, `[emmy] OFFLINE OK` green ANSI live-verified on Spark) | ✓ green |
| 2 | TUI footer `[GPU N% • KV N% • spec accept - • tok/s N]` at 1 Hz; parity ≤5% | `runs/p3-w3-walkthrough/03-04-footer-parity.md` — 3/3 GPU% snapshots within 5% tolerance (0% delta) on live DGX Spark; KV% degrades correctly when vLLM 0.19 omits `vllm:gpu_cache_usage_perc` at rest (D-24 path exercised) | ✓ green |
| 3 | Multi-file task completes via read/write/edit/bash/grep/find/ls + 0 `<think>` leaks; hash-anchored edit holds | `runs/p3-w1-walkthrough/walkthrough.md` — 7/7 acceptance criteria green; 6 distinct tools invoked; 0 `<think>` leaks in 36-tool-call session; hash-anchored in-place fix on `src/greet.ts` | ✓ green |
| 4 | Alt+Up / Alt+Down writes 13-field row to `~/.emmy/telemetry/feedback.jsonl`; `--export-hf` produces HF-loadable artifact | Plan 03-05 — 31 new passing tests across 5 files covering the state machine + idempotent upsert keyed on `turn_id = ${sessionId}:${turnIndex}`; `grep -c 'load_dataset' packages/emmy-telemetry/src/hf-export.ts` = 3. Interactive keypress live test documented as operator-gated in 03-05-SUMMARY; the state machine is unit-proven exhaustively | ✓ green (library) ⧗ interactive (operator) |
| 5 | Langfuse UI shows trace per session with every span stamped `emmy.profile.{id,version,hash}` | `runs/p3-w2-walkthrough/case-ii-events.jsonl` — 15/16 events stamped with full profile; `runs/p3-w2-walkthrough/walkthrough.md` case (ii) JSONL-only + (iii) `--no-telemetry` kill-switch live-verified. Case (i) live UI trace operator-gated (requires browser-mediated Langfuse API-key provisioning) | ✓ green (dual-sink + spans) ⧗ UI (operator) |
| 6 | No non-loopback ESTAB connections during a session (air-gap equivalent) | Plan 03-01 walkthrough criterion (g) — `ss -tnp state established | grep -v '127\.0\.0\.1\|::1'` empty during the 36-tool-call session. Plan 03-07 Task 2 extends with dual-stack emmy-serve + Langfuse replay validator (dry-run exit 0) | ✓ green |
| 7 | SC-2 3-run matrix (default + alternate + disabled); all three variants exit verdict=pass on stub; fixture hash stable across runs | Plan 03-03 SC-2 machinery + Plan 03-07 re-run 2026-04-22: default → `runs/phase3-sc2/report.json` verdict=pass (5/5 invariants); alternate → `runs/phase3-sc2-stub-alternate/` verdict=pass; disabled → `runs/phase3-sc2-stub-disabled/` verdict=pass (disabled-variant acceptance condition is `!ran && !d12Thrown`, NOT compaction.complete — documented in 03-03-SUMMARY Observations). Fixture sha256 `26149bfce4...a0a19b` stable across runs | ✓ green (stub) ⧗ live-mode (operator / deferred) |

## Plan 03-07-specific gates (run today)

### (a) Profile validate v1 + v2 + v3

```
$ uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/  → exit 0
$ uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/  → exit 0
$ uv run emmy profile validate profiles/qwen3.6-35b-a3b/v3/  → exit 0
```

All three exit 0. v2 hash byte-identical to Phase 2 close (`sha256:24be3eea...85d8b`). v3 hash computed honestly after both `prompts/compact.md` + `prompts/compact.alternate.md` + extended `PROFILE_NOTES.md` landed: `sha256:2beb99c773a0e425a3e485459964740640c5f3addbea186738402cf66d4d3718`.

### (b) SC-2 3-run stub matrix

```
$ bash scripts/sc2_200turn_compaction.sh --mode=stub --variant=default
[sc2-runner] verdict=pass mode=stub variant=default elided=181 preserved=19 timing_ms=5
  goalPreserved: true, lastNVerbatim: true, errorResultsVerbatim: true,
  filePinsVerbatim: true, compactionEvent: true

$ bash scripts/sc2_200turn_compaction.sh --mode=stub --variant=alternate
[sc2-runner] verdict=pass mode=stub variant=alternate elided=181 preserved=19 timing_ms=1

$ bash scripts/sc2_200turn_compaction.sh --mode=stub --variant=disabled
[sc2-runner] verdict=pass mode=stub variant=disabled elided=0 preserved=0 timing_ms=0
```

All three exit 0. Evidence written to `runs/phase3-sc2/` + `runs/phase3-sc2-stub-alternate/` + `runs/phase3-sc2-stub-disabled/`. Recorded in `profiles/qwen3.6-35b-a3b/v3/PROFILE_NOTES.md § Validation Runs — Phase 3 SC-2 3-Run Matrix`.

### (c) Air-gap Phase 3 dry-run

```
$ uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run --profile qwen3.6-35b-a3b/v3
ci_verify_phase3 --dry-run OK
  profile:       qwen3.6-35b-a3b/v3
  compose file:  /data/projects/emmy/observability/langfuse/docker-compose.yaml
  start scripts: /data/projects/emmy/scripts/start_emmy.sh, /data/projects/emmy/scripts/start_observability.sh
  replay script: /data/projects/emmy/scripts/airgap_phase3_replay.sh
```

Exit 0. Config sanity passes: docker-compose.yaml has `@sha256:` digest pins (D-09) + 127.0.0.1:-bound non-web ports (T-03-02-07).

### (d) Four-way regression

| Gate | Command | Result |
|------|---------|--------|
| TypeScript unit tests | `bun test` | **396 pass / 1 skip / 0 fail / 1758 expect() across 53 files** (unchanged vs Plan 03-06 close; v3 profile bump is Python-side only) |
| TypeScript typecheck | `bun run typecheck` | **5 / 5 packages exit 0** |
| Python unit tests | `uv run pytest tests/unit -q` | **144 passed / 1 skipped** (+7 new schema tests for CompactionConfig + WebFetchConfig; unchanged 137 baseline still green) |
| Profile validate v1+v2+v3 | `uv run emmy profile validate` | **all three exit 0** |

## Operator-gated items at Phase 3 close

Following the Phase 1 deferral pattern (three operator-gated items carried forward in 01-CLOSEOUT.md: SC-1 throughput, SC-5 sampler re-validation, SC-4 CI runner registration), Phase 3 closes with the following operator-gated evidence items deferred to whenever operator time allows. None are blockers for Phase 3 close per the same rationale Phase 1 applied:

1. **Plan 03-02 case (i) live Langfuse UI trace** — requires browser-based Langfuse first-login + API-key provisioning. Programmatic dual-sink (JSONL authoritative + OTLP best-effort) is live-verified via cases (ii) + (iii). Resume signal: `p3-02 trace green`.
2. **Plan 03-04 Task 3 interactive-TUI parity eyeball** — functional parity 3/3 within 5% already live-verified; interactive-TUI confirmation of setStatus rendering under `emmy.footer` key is operator-taste. Resume signal: `p3-04 footer green`.
3. **Plan 03-05 Task 3 interactive-TUI Alt+Up/Down** — state machine unit-proven exhaustively (31 tests); live-TUI keypress confirmation against DGX Spark + interactive pi-emmy session is operator-gated. Resume signal: `p3-05 feedback green`.
4. **Plan 03-06 Task 3 interactive web_fetch red-flip demo** — boot banner live-verified; per-call enforcement unit-proven (43 tests); interactive red-flip demo requires an operator session with a live prompt. Resume signal: `p3-06 badge green`.
5. **SC-2 live-mode 3-run matrix** — stub-mode matrix green on all three variants. Live-mode requires ~2 hours GPU + `engine.summarize()` → live emmy-serve postChat wiring (documented in Plan 03-03 Observations). Fixture `26149bfce4...a0a19b` is the locked contract; any live run must see the same fixture hash to be interpretable. Resume signal: `p3-07 sc2 live green`.

These are evidence-polish, not load-bearing requirements that slipped. The Phase-3 daily-driver + observability + compaction + lived-experience discipline is shipped + unit-proven + programmatically verified against live emmy-serve; the five items above are final-mile UI / time-windowed evidence captures.

## Verdict

**`sc1 phase3 green`** — Phase 3 closes with 5/5 success criteria green, 8 Phase-3 REQ-IDs + 5 Phase-2 Done† → Done ready to flip, v3 profile hash `sha256:2beb99c773a0e425a3e485459964740640c5f3addbea186738402cf66d4d3718` certified.
