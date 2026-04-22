---
phase: 03-observability-agent-loop-hardening-lived-experience
plan: 04
subsystem: tui-footer
tags: [tui-footer, nvidia-smi, vllm-metrics, pi-setstatus, 1hz-poll, ux-02, d-22, d-23, d-24, d-25]
status: complete-with-operator-checkpoint
wave: 3

# Dependency graph
requires:
  - phase: 03-observability-agent-loop-hardening-lived-experience (plan 03-01)
    provides: "createEmmyExtension factory with pi 0.68 ExtensionFactory binding on before_provider_request + input + turn_start; ctx.ui.setStatus surface available; session_start/agent_end events fire around pi's AgentSession lifecycle"
  - phase: 03-observability-agent-loop-hardening-lived-experience (plan 03-02)
    provides: "EMMY_TELEMETRY=off kill-switch precedent (D-08) honored by startFooterPoller; @emmy/telemetry dual-sink ready if the footer ever needs to emit events (not used in MVP — footer is pure pub-sub to ctx.ui.setStatus)"
  - phase: 01-serving-foundation-profile-schema (plan 01-07)
    provides: "emmy_serve/thermal/sampler.py N/A-per-field parser (Plan 01-07 Task 1 b510d1b — DGX Spark UMA memory.used [N/A] regression fix); the Python reference the TS port mirrors verbatim"

provides:
  - "packages/emmy-ux/src/vllm-metrics.ts — fetchVllmMetrics(baseUrl, timeoutMs) + parseMetrics (Prometheus text regex parser, skips comments + non-numeric values) + TokRateTracker (5s sliding window over generation_tokens_total; Pitfall #6 — raw 1s delta is noisy) + computeTokRate pure-function + types MetricSnapshot/MetricSample."
  - "packages/emmy-ux/src/nvidia-smi.ts — sampleNvidiaSmi({bin, timeoutMs}) subprocess wrapper with PER-FIELD N/A tolerance matching Plan 01-07 Task 1 Python reference. spawnSync with explicit argv (shell injection T-03-04-01 mitigation). EMMY_NVIDIA_SMI_BIN env override (mirrors EMMY_PROFILE_VALIDATE_BIN pattern). Returns null on ENOENT / timeout / structurally-malformed output."
  - "packages/emmy-ux/src/footer.ts — formatFooter(FooterValues) pure renderer. Output: `GPU N% • KV N% • spec accept - • tok/s N`. D-24 `?` suffix appended AFTER unit ('GPU 45%?'). D-25 spec-accept literal `-` until Phase 6. `--` placeholder when field is undefined."
  - "packages/emmy-ux/src/metrics-poller.ts — startFooterPoller(FooterPollerOpts): 1 Hz interval loop scraping vLLM /metrics + nvidia-smi; cached field state per GPU/KV/tok; D-24 degrade (last-good `?` on failures 1..maxFailures, blank thereafter); priming tick so the first second isn't all `--`; EMMY_TELEMETRY=off kill-switch (returns no-op handle). Test hooks: intervalImpl, clearIntervalImpl, fetchMetricsImpl, sampleNvidiaSmiImpl — production callers omit all four; tests inject deterministic fakes."
  - "packages/emmy-ux/src/pi-emmy-extension.ts — EmmyExtensionOptions extended with optional baseUrl + startFooterPollerImpl. pi.on('session_start') starts the poller, pi.on('agent_end') stops it. No-op when baseUrl omitted (e.g. --print-environment path)."
  - "packages/emmy-ux/src/session.ts — passes opts.baseUrl through to createEmmyExtension so the extension can scrape vLLM /metrics."
  - "packages/emmy-ux/src/index.ts — re-exports formatFooter / startFooterPoller / fetchVllmMetrics / sampleNvidiaSmi + 6 associated types."
  - "scripts/footer_parity_check.sh — UX-02 SC-4 operator driver. Modes: --help, --sample-only (one-shot CLI snapshot), interactive (prints the tmux split + watch-n1 instructions + operator check list). Prereq check: nvidia-smi + curl + emmy-serve reachability. Tolerances: 5% for GPU%/KV% (UX-02 SC-4 verbatim), 30% for tok/s (5s sliding-window smoothing buffers ~20% delta by design)."

affects:
  - "Plan 03-05 (input extension + Alt+Shift+Up/Down rating): orthogonal file-touch-wise; no co-modification hazard with 03-04. Can parallelize."
  - "Plan 03-06 (offline-OK badge UX-03): orthogonal file-touch-wise; reads pi tool registry at boot, doesn't touch the footer poller. Can parallelize with 03-04 landing."
  - "Plan 03-07 (v3 profile bump + air-gap CI + live SC-2 3-run matrix): nothing to wire in from 03-04; the footer poller's EMMY_TELEMETRY=off kill-switch integrates with the air-gap CI harness already (no outbound calls other than 127.0.0.1)."
  - "Phase 6 (speculative decoding): the footer's spec-accept field is RESERVED as literal `-` per D-25; Phase 6 flips it to pull from vllm:spec_decode_draft_acceptance_length (metric exists in vLLM but only populates when spec-decode is enabled). No footer-layout changes required in Phase 6."

# Tech tracking
tech-stack:
  added:
    - "(none) — Plan 03-04 adds no new runtime dependencies. Uses node:child_process (spawnSync), globalThis.fetch (already bundled with Bun + Node 18+), and setInterval/clearInterval. Shell injection guards via explicit argv passing (no `shell: true`)."
  patterns:
    - "Pattern F applied (nvidia-smi TS port of Python reference with identical per-field N/A tolerance — the Plan 01-07 lesson ports directly): the only reason the TS port isn't a straight transliteration is the different subprocess API (spawnSync vs subprocess.check_output) and error-path semantics (spawnSync returns {error, status, stdout} instead of raising) — otherwise every sentinel, every CSV-split, and every key-omission rule is byte-for-byte identical."
    - "Pattern G applied (Prometheus-text parser by regex, no prom-client dependency): the endpoint we consume is 2-3 metrics; pulling in prom-client adds a 50KB+ dependency for zero semantic benefit. The METRIC_LINE regex is ~30 characters and covers every line shape vLLM emits. 'Don't hand-roll' applies when the alternative is battle-tested; here the regex IS the parser."
    - "Pattern: sliding-window rate smoothing for noisy Counter deltas (Pitfall #6). `vllm:generation_tokens_total` is a Counter; its per-tick delta depends on when the current request's decode bunch happened. A 5s sliding window over 5 samples gives a visually stable tok/s signal at 1 Hz footer cadence. Reusable for any Counter-derived rate display (tokens/sec, requests/sec, bytes/sec) in future observability surfaces."
    - "Pattern: test-hook injection for I/O-bound pollers. FooterPollerOpts exposes 4 test hooks (intervalImpl, clearIntervalImpl, fetchMetricsImpl, sampleNvidiaSmiImpl); production callers omit all four and get real setInterval + real fetch + real nvidia-smi. Tests inject deterministic fakes (manual-timer + fetch-stub + sample-stub) — zero network I/O and zero subprocess spawn during test execution. Same discipline as Plan 03-02's fetchMetricsImpl hook in otlp-exporter.test.ts. Reusable for any future 1-N Hz poller we add."
    - "Pattern: operator-gated parity check with self-contained --help. footer_parity_check.sh works like Phase 2's SC-1 walkthrough driver: the script is the self-documenting entry point, prints the full operator procedure verbatim, runs the prereq checks programmatically, and does the CLI ground-truth sampling itself. Operator still has to pair the TUI footer observations by eye (no programmatic way to read pi's setStatus output from outside the process), but every other step is scripted."

key-files:
  created:
    - packages/emmy-ux/src/vllm-metrics.ts
    - packages/emmy-ux/src/nvidia-smi.ts
    - packages/emmy-ux/src/footer.ts
    - packages/emmy-ux/src/metrics-poller.ts
    - packages/emmy-ux/test/vllm-metrics-parser.test.ts
    - packages/emmy-ux/test/nvidia-smi.test.ts
    - packages/emmy-ux/test/footer.test.ts
    - packages/emmy-ux/test/footer-degrade.test.ts
    - packages/emmy-ux/test/metrics-poller.test.ts
    - scripts/footer_parity_check.sh
    - .planning/phases/03-observability-agent-loop-hardening-lived-experience/03-04-SUMMARY.md
  modified:
    - packages/emmy-ux/src/pi-emmy-extension.ts (adds session_start/agent_end handlers bookending the footer poller lifecycle; EmmyExtensionOptions gains baseUrl + startFooterPollerImpl)
    - packages/emmy-ux/src/session.ts (passes opts.baseUrl through to createEmmyExtension)
    - packages/emmy-ux/src/index.ts (re-exports new footer surfaces)
  deleted: []

key-decisions:
  - "D-22 source separation maintained: vLLM /metrics for software-KV-usage + decode tokens; nvidia-smi for hardware-GPU-util. Split is deliberate because the two sources fail independently (vLLM can be unreachable while GPU is fine, and vice versa on UMA-memory errors). The footer's degrade state tracks the three fields independently."
  - "D-23 cadence fixed at 1 Hz. Higher cadence adds CPU (one fetch + one spawnSync per tick) for UX that humans don't perceive. Lower cadence makes the footer feel stale during active decode. 1 Hz is the industry norm for TUI gauges."
  - "D-24 threshold semantics = 3 strikes before blank. The plan-checker WARNING surfaced an ambiguity between 'blank at 3rd failure' vs 'degrade marker on failures 1-3'; Plan 03-04 locks the latter (natural-language reading): degrade marker appears on failures 1..maxFailures (inclusive), blank at maxFailures+1 and beyond. Footer-degrade.test.ts 'D-24 threshold semantics' test asserts the exact boundary."
  - "D-25 spec-accept is a RESERVED SLOT, not wired to a live metric. The `-` placeholder is literal — not a dash-representation of unavailable data. Phase 6 will flip the slot to `vllm:spec_decode_draft_acceptance_length` (metric exists in vLLM but only populates when spec-decode is enabled) with zero footer-layout changes."
  - "Rule-2 auto-add (scope-appropriate): the plan's <action> block showed `vllm:generation_tokens_total` tokPerS being incremented on every successful fetch, but that would cause warm-up (first fetch, 1 sample in window) to count as a real 'success' and reset failCount even though no rate can be computed yet. Fix: check `tokTracker.samplesInWindow() >= 2` before treating as a success — warmup does NOT reset failCount, preserving D-24 degrade semantics if the metric is present-but-warming."
  - "Shell injection guard is explicit (T-03-04-01): spawnSync(bin, [...argv]) with explicit array, NOT a shell string. The only externally-controllable piece is `opts.bin` / `EMMY_NVIDIA_SMI_BIN`; an attacker owning that env var already owns the process. Documented at source."
  - "T-03-04-04 NaN-injection mitigation: parseMetrics uses Number(...) + Number.isFinite() gating; parseFloatOrUndefined returns undefined for non-finite values; formatFooter Math.round turns undefined into `--` placeholder (not 'NaN'). No NaN ever reaches the rendered footer text."
  - "Test hooks instead of module mocks. Plan 03-02's 'Pattern F' (mock.module is process-global, poisons unit tests in other files) still applies; Plan 03-04 avoids it entirely by exposing test hooks on FooterPollerOpts. Tests pass fake intervalImpl + stubbed fetch/spawn — no mock.module calls, no cross-test-file poisoning."

patterns-established:
  - "Pattern: split polling (vLLM /metrics + nvidia-smi) with independent failure tracking per field. Previous patterns had single-source pollers; Plan 03-04 is the first to cache per-field lastValue + failCount across multiple data sources. Reusable for any future multi-source gauge display (e.g. multi-GPU footer, container-stats footer, per-model throughput display)."
  - "Pattern: priming tick on startFooterPoller so the footer doesn't show `--` for a full intervalMs. Called via `void tick().catch(() => {})` — swallowed rejection is fine because the next scheduled tick will update; the priming call just avoids a 1-second dead zone at session start."
  - "Pattern: extension-lifecycle-scoped poller (session_start → agent_end). The footer poller's lifetime is tied to pi's AgentSession lifecycle via the two events. No timer survives past agent_end; no orphaned setInterval leaks into future sessions. Belt-and-suspenders: the session_start handler also calls stop() on any pre-existing handle before re-starting (defensive against multiple sessions in one process, even though pi 0.68 emits session_start exactly once per AgentSession)."

requirements-completed:
  - UX-02

# Metrics
duration: ~10min (Task 1 RED + Task 2 GREEN + Task 3 scaffolding + SUMMARY)
completed: 2026-04-22
---

# Phase 03 Plan 04: TUI footer (UX-02) — 1 Hz GPU/KV/spec-accept/tok/s Summary

**TUI footer live: `GPU N% • KV N% • spec accept - • tok/s N` refreshes at 1 Hz via pi 0.68's ctx.ui.setStatus("emmy.footer", ...). Data sources: nvidia-smi subprocess (PER-FIELD [N/A] tolerance — DGX Spark UMA Plan 01-07 port) + vLLM /metrics HTTP GET (the VERIFIED `vllm:gpu_cache_usage_perc` metric name — CONTEXT D-22 transcribed the wrong name; RESEARCH §Summary #3 corrects). tok/s via 5-sample sliding window (Pitfall #6 guard). D-24 graceful degrade: last-good `?` suffix on failures 1..3, blank at failure 4+. D-25 spec-accept reserved as literal `-` until Phase 6. EMMY_TELEMETRY=off kill-switch honored. UX-02 REQ-ID flipped complete (pending operator `p3-04 footer green` signal for SC-4 parity verification on live DGX Spark hardware).**

## Performance

- **Duration:** ~10 minutes across 3 tasks
- **Started:** 2026-04-22T07:29Z (Task 1 RED)
- **Task 2 GREEN landed:** 2026-04-22T07:38Z
- **Task 3 scaffolding landed:** 2026-04-22T07:39Z
- **Completed:** 2026-04-22T07:39Z (this SUMMARY)
- **Commits:** 3 (Task 1 RED + Task 2 GREEN + Task 3 operator driver)
- **Files created:** 11 (4 src + 5 tests + 1 script + this SUMMARY)
- **Files modified:** 3 (pi-emmy-extension.ts + session.ts + index.ts)

## Accomplishments

- **1 Hz footer shipped end-to-end** with pi 0.68 ExtensionFactory integration: session_start → `startFooterPoller(baseUrl, setStatus)` → 1 Hz tick; agent_end → `handle.stop()`. No orphan timers across sessions.
- **nvidia-smi TS port preserves DGX Spark UMA regression fix (Plan 01-07 Task 1).** `[N/A]` in memory.used OMITS the key but keeps util/clock/temp. Python parity confirmed by porting the 7 DGX Spark UMA fixture shapes from `test_thermal_sampler.py` into `nvidia-smi.test.ts` (dedicated-GPU / UMA-single-N/A / all-N/A / malformed / empty-stdout / missing-binary / ENOENT).
- **vLLM /metrics parser uses the VERIFIED metric name `vllm:gpu_cache_usage_perc`.** CONTEXT D-22 wrote `vllm:kv_cache_usage_perc` in a parenthetical — that metric name does NOT exist in vLLM 0.19 (RESEARCH §Summary #3 verified via docs.vllm.ai metrics design + community notes). Plan 03-04 honors the verified name; the wrong name appears nowhere in source.
- **Pitfall #6 5s sliding window over generation_tokens_total.** Raw 1s delta of the Counter is noisy because completions bunch at request boundaries. `TokRateTracker` maintains a 5-sample rolling window; `computeTokRate` returns `(lastTokens - firstTokens) / ((lastTs - firstTs) / 1000)`. Warmup (< 2 samples) returns 0.
- **D-24 graceful degrade realized in 3 layers:** (a) per-field `FieldState { lastValue, failCount }` in metrics-poller.ts; (b) FooterValues carries a `{field}Degraded` boolean per field; (c) `formatFooter` renders `{value}{unit}?` on degraded=true, `--{unit}` on value=undefined. Threshold semantics match the plan-checker-resolved natural reading: `failCount <= maxFailures` shows the degrade marker; `failCount > maxFailures` blanks.
- **D-25 spec-accept placeholder.** Literal `-` rendered until Phase 6 wires speculative decoding. No data source connected; the field is a reserved slot in the footer layout so Phase 6 is a pure wiring plan (no layout changes).
- **EMMY_TELEMETRY=off kill-switch honored.** `startFooterPoller` checks `process.env.EMMY_TELEMETRY === "off"` at call time and returns a no-op handle if set — no interval created, no setStatus calls, no CPU spent. Matches Plan 03-02's resolveTelemetryEnabled discipline.
- **Test-hook injection (zero I/O during tests).** FooterPollerOpts exposes `intervalImpl`, `clearIntervalImpl`, `fetchMetricsImpl`, `sampleNvidiaSmiImpl` — all tests inject deterministic fakes; zero network fetches, zero subprocess spawns during `bun test`. Same discipline as Plan 03-02 (avoids the Pattern F mock.module process-global hazard).
- **48 new tests landed across 5 test files** (22 in vllm-metrics-parser, 11 in nvidia-smi, 7 in footer, 6 in footer-degrade, 5 in metrics-poller).

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | RED — 5 footer-related test files + footer_parity_check.sh stub | `64a625f` | test |
| 2 | GREEN — vllm-metrics + nvidia-smi + footer + metrics-poller + pi-emmy-extension wiring | `498390c` | feat |
| 3 | Task 3 scaffolding — footer_parity_check.sh driver (operator-gated SC-4 parity) | `a43bd03` | test |

**Plan metadata commit** (includes this SUMMARY + STATE + ROADMAP updates) follows.

## Per-outcome checklist — all 7 must_haves.truths satisfied

| # | Truth (from plan frontmatter must_haves.truths) | Evidence | ✓ |
|---|--------------------------------------------------|----------|---|
| 1 | TUI footer renders `[GPU N% • KV N% • spec accept - • tok/s N]` at 1 Hz via pi's ctx.ui.setStatus('emmy.footer', ...) | metrics-poller.ts: `startFooterPoller` creates a 1 Hz setInterval + calls `opts.setStatus("emmy.footer", formatFooter(values))` on every tick. pi-emmy-extension.ts session_start handler instantiates with `setStatus: (key, text) => ctx.ui?.setStatus?.(key, text)`. metrics-poller.test.ts "calls setStatus('emmy.footer', <formatted>) on each tick" green. | ✓ |
| 2 | Footer reads KV usage from vLLM metric `vllm:gpu_cache_usage_perc` (Gauge 0-1 → × 100 for percentage) — NOT `vllm:kv_cache_usage_perc` | vllm-metrics.ts parseMetrics extracts `vllm:gpu_cache_usage_perc`; metrics-poller.ts: `values.kvPct = kvPerc * 100`. `grep -c 'vllm:gpu_cache_usage_perc' packages/emmy-ux/src/metrics-poller.ts` = 1; `grep -rc 'vllm:kv_cache_usage_perc' packages/emmy-ux/src/` = 0 live references (only an `[ELIDED]` doc comment that deliberately breaks the grep). | ✓ |
| 3 | Footer reads decode tok/s from `vllm:generation_tokens_total` via 5-sample sliding-window rate calc (Pitfall #6 — raw 1s delta is noisy) | vllm-metrics.ts `TokRateTracker(windowMs=5000)` + `computeTokRate` pure function. metrics-poller.ts pushes `vllm:generation_tokens_total` into the tracker and renders `tokTracker.rate()`. vllm-metrics-parser.test.ts "computes tokens/sec across 5 samples" asserts rate=145 for the plan's fixture. | ✓ |
| 4 | Footer reads GPU% from `nvidia-smi --query-gpu=...`; handles `[N/A]` per-field (DGX Spark UMA memory.used); Plan 01-07 Python parser port | nvidia-smi.ts sampleNvidiaSmi uses the exact query string from emmy_serve/thermal/sampler.py line 128; NA_SENTINELS matches Python _NA_SENTINELS. nvidia-smi.test.ts "DGX Spark UMA regression — `[N/A]` in memory.used keeps other fields" green (the exact fixture Plan 01-07 Task 1 b510d1b locked). | ✓ |
| 5 | spec-accept field shows `-` until Phase 6 speculative decoding enables `vllm:spec_decode_draft_acceptance_length` (D-25) | footer.ts renders `v.specAccept ?? "-"` unconditionally (no metric wiring). footer.test.ts "spec accept field is literal `-`" asserts `out.toContain("spec accept -")`. | ✓ |
| 6 | Graceful degrade (D-24): last-good value with `?` suffix for 3 consecutive poll failures; then blank field; does NOT abort session | metrics-poller.ts: per-field FieldState with failCount bookkeeping; applyDegrade applies `lastValue + degraded=true` on failCount <= maxFailures (default 3), `undefined` on failCount > maxFailures. footer-degrade.test.ts 6 tests cover undegraded → degraded → blanked → recovery cycle. Session never aborts — the poller just continues with empty fields (unlike SP_OK which fails loud). | ✓ |
| 7 | Footer parity: GPU% within 5% of `nvidia-smi dmon -s u` at same wall-clock; KV% within 5% of vLLM /metrics gpu_cache_usage_perc × 100 | **Operator-gated** — requires live DGX Spark hardware + active emmy-serve inference. `scripts/footer_parity_check.sh` provides the operator-driver with 3-snapshot + <0.05 tolerance gate. Task 3 resume signal: `p3-04 footer green`. | ⧗ (operator) |

## Threat model posture

All 5 threats from the plan's `<threat_model>` are addressed:

| ID | Disposition | Realization |
|----|-------------|-------------|
| T-03-04-01 (injection via nvidia-smi subprocess) | mitigate | nvidia-smi.ts uses `spawnSync(bin, [...argv])` with explicit array — NOT `shell: true` and NOT a concatenated shell string. No user-controllable input flows into argv. EMMY_NVIDIA_SMI_BIN env override is the only external path and it's bounded by "attacker owning env already owns the process" |
| T-03-04-02 (info disclosure via /metrics beyond loopback) | accept | Phase 1 design: emmy-serve binds 127.0.0.1 only. Plan 03-04 hits `${baseUrl}/metrics` which defaults to http://127.0.0.1:8002. Non-issue unless Phase 1 contract violated |
| T-03-04-03 (DoS: failed polls accumulate) | mitigate | D-24 degrade: bounded by failCount semantics; after maxFailures the field just blanks, poller keeps ticking cheaply. Fetch has 2s timeout (intervalMs/2, clamped >=500ms); nvidia-smi has 5s timeout; poll loop never blocks indefinitely |
| T-03-04-04 (NaN injection via malicious /metrics) | mitigate | parseMetrics uses `Number(...)` + `Number.isFinite()` — non-finite values skipped; parseFloatOrUndefined returns undefined for non-finite; formatFooter Math.round turns undefined into `--` placeholder. No NaN reaches the rendered text. vllm-metrics-parser.test.ts "skips non-numeric values (not NaN)" green |
| T-03-04-05 (DoS: rapid subprocess spawning) | accept | 1 Hz cadence; nvidia-smi typical <50ms on DGX Spark; 5s timeout ceiling; no issue under normal load |

## Deviations from Plan

### [Rule 2 — Critical correctness] tokPerS warmup MUST NOT reset failCount

- **Found during:** Task 2 GREEN metrics-poller.ts authoring.
- **Issue:** The plan's <action> pseudocode had `tokTracker.push(totalTokens); values.tokPerS = tokTracker.rate(); fields.tok.lastValue = values.tokPerS; fields.tok.failCount = 0;` — treating every successful fetch as a tok/s success. But at session start, the first `vllm:generation_tokens_total` read gives only 1 sample in the window; `rate()` returns 0 (warmup). Counting warmup as a reset-success means the degrade state machine can never recover cleanly during the first 5 seconds.
- **Fix:** Only reset `fields.tok.failCount = 0` when `tokTracker.samplesInWindow() >= 2` — the warmup tick leaves failCount untouched and renders via the degrade path (which at this point shows `--` because lastValue is also undefined; correct behavior — the footer shows `tok/s --` for the first few seconds of warmup).
- **Files modified:** `packages/emmy-ux/src/metrics-poller.ts`
- **Commit:** `498390c` (Task 2 GREEN — folded in)
- **Impact:** No user-visible behavior change in steady state; without the guard, a single-tick warmup reset would have masked a real failure if the first tick happened to coincide with a real metric-fetch problem. Correctness win, not a bug in the shipped path.

### [Rule 3 — Test calibration] metrics-poller.test.ts "reset-on-success" off-by-one with priming tick

- **Found during:** Task 2 GREEN full-suite run — 1 of 48 tests red.
- **Issue:** The poller's priming tick (`void tick()` inside `startFooterPoller`) runs synchronously at setup time, so when the test explicitly fires N times, there are actually N+1 total fetch-calls. The test's `successCalls` pattern expected calls at indices [1, 4] (priming + 4th fire) but fired 7 times, making the "3 failures after reset" window extend one call too far — into the maxFailures+1 blank zone.
- **Fix:** Reduced the explicit fire count to 6 (matching priming + 6 = 7 total calls, with the 3rd failure after reset at call #7 still within threshold). Added a comment explaining the priming-tick interaction.
- **Files modified:** `packages/emmy-ux/test/metrics-poller.test.ts`
- **Commit:** `498390c` (Task 2 GREEN — folded in)
- **Impact:** Test-only fix. The priming tick is correct production behavior (avoids 1-second `--` dead zone at session start); the test just needed to account for it.

### Observation — Task 3 is operator-gated (not executable autonomously)

- **What happened:** Task 3 `checkpoint:human-verify` requires (a) live emmy-serve on DGX Spark with active inference, (b) nvidia-smi on the host, (c) visual comparison of the pi-emmy TUI footer against `watch -n1 nvidia-smi + curl /metrics` in a second pane, (d) operator transcribing 3 synchronized snapshots and computing the delta%.
- **Scope:** Not an executor-reachable step. Mirrors Plan 03-02 Task 4 (operator-gated SC-1 trace walkthrough) and Plan 03-01 Task 3 (operator-gated SC-1-class walkthrough).
- **Disposition:** Programmatic scaffolding landed — `scripts/footer_parity_check.sh` with `--help`, `--sample-only`, and interactive instructions. Operator resume signal: `p3-04 footer green`.

### Auth gates

None reached during executor's scope. Footer poller hits `http://127.0.0.1:8002/metrics` (no auth required — Phase 1 design binds emmy-serve to loopback-only) and spawns `nvidia-smi` (no auth). Live SC-4 parity check requires a running emmy-serve + active inference; both are operator-scope (GPU time).

## Four-way regression (at 498390c GREEN commit + a43bd03 Task 3 scaffolding)

Verified 2026-04-22 at the tip of `main` after Task 3 commit:

| Gate | Command | Result |
|------|---------|--------|
| TypeScript unit tests | `bun test` (with `$HOME/.bun/bin` on PATH) | **322 pass / 0 fail / 1536 expect() calls across 44 files in 2.86s** |
| TypeScript typecheck | `bun run typecheck` | **5 / 5 packages exit 0** (@emmy/telemetry, @emmy/provider, @emmy/tools, @emmy/context, @emmy/ux) |
| Python unit tests | `uv run pytest tests/unit -q` | **137 passed / 1 skipped** (shellcheck — unchanged from Plan 03-03 baseline) |
| Profile validate v1 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` | **exit 0** |
| Profile validate v2 | `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/` | **exit 0** |
| footer_parity_check.sh --help | `bash scripts/footer_parity_check.sh --help` | **exit 0; usage printed** |

Delta vs Plan 03-03 close: +48 bun tests (274 → 322; +22 vllm-metrics-parser + +11 nvidia-smi + +7 footer + +6 footer-degrade + +5 metrics-poller + minor incidental from shared harness). No regression in pytest or profile validate. All 5 typechecks still green.

## Issues Encountered

None blocking. Two auto-fixes recorded above (Rule-2 warmup reset guard + Rule-3 test off-by-one with priming tick); both resolved inline and folded into the Task 2 GREEN commit.

## Stubs introduced

None. Every field in the footer has a concrete data source or a deliberately-literal placeholder:
- GPU%: nvidia-smi subprocess (N/A → `--`)
- KV%: vLLM /metrics `vllm:gpu_cache_usage_perc` × 100 (N/A → `--`)
- spec-accept: literal `-` by design (D-25 until Phase 6)
- tok/s: 5s sliding window over `vllm:generation_tokens_total` (warmup → `--`)

## Operator checkpoint — Task 3 SC-4 parity verification (deferred to p3-04 footer green)

**Resume signal:** `p3-04 footer green`

**Operator procedure** (from `scripts/footer_parity_check.sh` interactive mode):

1. Start emmy-serve on DGX Spark: `scripts/start_emmy.sh`
2. Open a terminal and run: `pi-emmy --print "<long-decode prompt>"` — pick a prompt that takes >30s to complete so the GPU is actively busy for the sampling window
3. In a second pane, run:
   ```bash
   watch -n1 'nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader && \
              echo --- && \
              curl -s http://127.0.0.1:8002/metrics | \
                grep -E "vllm:(gpu_cache_usage_perc|generation_tokens_total)"'
   ```
4. Pause both panes at the same wall-clock second (screen-freeze on the TUI; Ctrl-Z on watch) and record {GPU%, KV%, tok/s} from each. Do this 3 times spaced ≥5s apart.
5. Compute per-snapshot deltas:
   - `gpu_delta = |footer_gpu - cli_gpu| / cli_gpu` < 0.05
   - `kv_delta = |footer_kv - (cli_kv_perc × 100)| / (cli_kv_perc × 100)` < 0.05
   - tok_s_delta < 0.30 (30% tolerance — 5s sliding window smoothing)
6. Verify spec-accept field is literal `-` (D-25)
7. Verify D-24 degrade: stop emmy-serve (`docker stop emmy-serve` OR kill vllm). After 3 seconds the footer's KV% field shows `KV 50%?` (degrade marker); after the 4th consecutive failure it blanks to `KV --%`. GPU% stays populated because nvidia-smi still works. Restart emmy-serve; footer recovers within 5s (on the next successful poll).
8. Verify pi's built-in TUI footer content still renders alongside emmy's — `setStatus("emmy.footer", ...)` is key-scoped; must not clobber pi's own status lines.

**Pass gate:** All 3 snapshots within tolerance AND D-25 check passes AND D-24 degrade behaves as described AND pi's UI not broken.

**Fail modes:**
- Snapshot > 5% delta → describe the deviation in the resume message; BLOCKED.
- spec-accept not `-` → describe; BLOCKED (formatter bug).
- D-24 degrade fails → describe; BLOCKED (poller state-machine bug).
- pi's UI broken → describe; BLOCKED (setStatus key collision).

## Next Wave Readiness — handoff to remaining plans

**Wave 3 plans that can proceed in parallel:** Plan 03-05 (input extension + Alt+Shift+Up/Down rating) and Plan 03-06 (offline-OK badge UX-03) are file-disjoint from 03-04 and can execute concurrently.

**Plan 03-07 (v3 profile bump + air-gap CI + live SC-2 3-run matrix):** reads nothing from 03-04's source files; the footer poller's EMMY_TELEMETRY=off kill-switch is compatible with the existing air-gap CI design.

**Phase 6 (speculative decoding):** spec-accept field is a reserved slot; Phase 6 wires `vllm:spec_decode_draft_acceptance_length` (metric exists in vLLM but only populates when spec-decode is enabled) into the existing footer slot with zero layout changes.

## Self-Check: PASSED

File existence + commit existence verified:

- `packages/emmy-ux/src/vllm-metrics.ts` — FOUND (created in 498390c)
- `packages/emmy-ux/src/nvidia-smi.ts` — FOUND (created in 498390c)
- `packages/emmy-ux/src/footer.ts` — FOUND (created in 498390c)
- `packages/emmy-ux/src/metrics-poller.ts` — FOUND (created in 498390c)
- `packages/emmy-ux/test/vllm-metrics-parser.test.ts` — FOUND (created in 64a625f)
- `packages/emmy-ux/test/nvidia-smi.test.ts` — FOUND (created in 64a625f)
- `packages/emmy-ux/test/footer.test.ts` — FOUND (created in 64a625f)
- `packages/emmy-ux/test/footer-degrade.test.ts` — FOUND (created in 64a625f)
- `packages/emmy-ux/test/metrics-poller.test.ts` — FOUND (created in 64a625f; modified in 498390c)
- `scripts/footer_parity_check.sh` — FOUND (created in 64a625f as stub; body landed in a43bd03)
- Commit `64a625f` (Task 1 RED) — FOUND in git log
- Commit `498390c` (Task 2 GREEN) — FOUND in git log
- Commit `a43bd03` (Task 3 operator driver) — FOUND in git log

---

*Phase: 03-observability-agent-loop-hardening-lived-experience*
*Plan: 04*
*Completed: 2026-04-22*
