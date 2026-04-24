---
status: resolved
phase: 04-gemma-4-profile-profile-system-maturity
source: [04-VERIFICATION.md]
started: 2026-04-23
updated: 2026-04-24
---

## Current Test

[All 4 operator-gated items resolved. SC-1 + SC-3 + SC-4 closed in 2026-04-23 follow-up session; KV bisection + 2×thermal replay closed in 2026-04-24 follow-up session (~6h wall-clock). Gemma 4 v2 bundle fully certified on live DGX Spark.]

## Tests

### 1. Gemma 4 KV budget bisection

expected: `scripts/find_kv_budget.py --profile profiles/gemma-4-26b-a4b-it/v1/` converges on a `gpu_memory_utilization` value under 30-min sustained load with zero preemption events + zero `dmesg` OOM events; measured value written into `serving.yaml.engine.gpu_memory_utilization` + decision log appended to `PROFILE_NOTES.md`. Starting seed: 0.55 (per 04-RESEARCH.md §2 given Gemma 4 26B ~28 GB weights + 16 GB KV at 128K context under Phase 3.1 UMA-pressure lesson).
scaffold: `runs/phase4-kv/PENDING.md`
resume_signal: `"p4 kv green"`
result: **[resolved 2026-04-24 — `p4 kv green` fired]** — 11-iteration KV bisection on Gemma 4 v2 @ spark-ff85 converged to `gpu_memory_utilization=0.86` (highest clean 0.91 × 5 % safety margin). First preemption at 0.915 (boot-side UMA rejection: "Free memory 108.44 < required 109.52 GiB"); zero runtime preemptions or swaps across 9 clean iterations (0.75 → 0.91). Final value is noticeably higher than the Phase-3.1-derived 0.55 seed — that seed was calibrated against 70B-dense worst case (Pitfall #3), but Gemma 4 26B MoE's actual weight footprint is 25.67 GiB which leaves substantially more KV headroom. Side quest: a probe-timeout misdiagnosis on the first attempt (hardcoded `timeout_s=300` in `scripts/smoke_test.py` was too tight for Gemma 4 v2's plain-safetensors ~7 min cold boot) required a prep commit to bump probe 300→900 s + finder subprocess 420→1200 s. Also surfaced + fixed a latent hash-recompute ordering bug in the finder (`_append_profile_notes` was called after `emmy profile hash --write`, leaving every run's manifest hash stale; swapped the order). Total wall-clock 3h34m. Evidence: `runs/phase4-kv/final-run/` + `runs/phase4-kv/failed-first-attempt-probe-timeout/`. Commits: prep `4c5f5c3`, result `b27ec1f`.

### 2. Gemma 4 2-hour thermal replay (two-pass: record-floors → assert-floors)

expected: Two consecutive 2-hour `scripts/thermal_replay.py` runs on Gemma 4 v1. First run with `--record-floors` measures steady-state GPU clock floor + decode-throughput floor across hour 2; floors are baked into `PROFILE_NOTES.md` frontmatter. Second run with `--assert-floors` re-verifies and must not drop below recorded floors. Same methodology as Phase 1 D-14/D-15 applied to Gemma 4.
scaffold: `runs/phase4-thermal/PENDING.md`
resume_signal: `"p4 thermal floors recorded"` → `"p4 thermal green"` (two signals, one per run)
result: **[resolved 2026-04-24 — both `p4 thermal floors recorded` AND `p4 thermal green` fired]** — two consecutive 2 h `scripts/thermal_replay.py` runs against Gemma 4 v2 @ `gpu_memory_utilization=0.86` on the same warm emmy-serve instance (profile hash `sha256:8f9c23f500...` stable across both passes). Pass 1 (`--record-floors`, 7204.7 s): `decode_p50_hour2=35.9 tok/s`, `decode_p1_hour2=33.28 tok/s`, `gpu_clock_p50_hour2=2496 MHz`, `gpu_clock_p5_hour2=2405 MHz`, `gpu_temp_p95_hour2=73 °C`, zero preemptions, zero OOM — 91 MHz p5 clock floor quantifies Pitfall #4 thermal throttle on this box for the first time. Pass 2 (`--assert-floors`, 7211.7 s): **"All floors pass"** — every measured metric held within 1 % of pass 1 (p50 decode slipped 0.33 %, p1 gained 0.60 %, GPU clocks identical to the MHz, 2 °C cooler). Same methodology as Phase 1 D-14/D-15 applied to Gemma 4. Evidence: `runs/phase4-thermal/pass1-record-floors/` + `runs/phase4-thermal/pass2-assert-floors/`. Commits: `282737b` + `262a66e`.

### 3. SC-1 /profile swap walkthrough (Qwen3.6 ↔ Gemma 4 round-trip)

expected: Operator runs `pi-emmy` on a clean repo, types `/profile gemma-4-26b-a4b-it`, observes the four D-02 progress phases fire verbatim (`stopping vLLM` → `loading weights N%` → `warmup` → `ready`), runs a turn against Gemma 4 with its function-calling tool format, then types `/profile qwen3.6-35b-a3b` and swaps back cleanly. Evidence committed to `runs/phase4-sc1/walkthrough.md` with verdict `sc1 phase4 green` + transcript.json + docker-logs.txt.
scaffold: `runs/phase4-sc1/PENDING.md`
resume_signal: `"sc1 phase4 green"`
result: **[resolved 2026-04-23 late — `sc1 phase4 green` fired]** — full Qwen↔Gemma 4 live round-trip captured end-to-end once profile v2 / `p4 gemma-container green` landed: 3 consecutive swaps (Qwen → Gemma → Qwen → Gemma), all exit code 0, all four D-02 progress phases emitted verbatim per swap. Earlier partial evidence (swap mechanism + rollback UX on boot failures) remained valid. Evidence: `runs/phase4-sc1/walkthrough.md` + `runs/phase4-sc1/walkthrough-sc1-full-green.md`. Commit: `15dc87b`.

### 4. SC-3 role-routing + SC-4 failure/rollback walkthroughs

expected: (a) SC-3 — operator runs a 5-turn session with `profiles/routes.yaml` wired to the three Qwen v3.1 sibling variants; inspects Langfuse or the JSONL sink for `emmy.profile.variant` + `emmy.role` attributes on every chat-request span; confirms the role heuristic routes correctly (plan / edit / critic / default). Evidence: `runs/phase4-sc3/walkthrough.md` + `report.json`. (b) SC-4 — operator deliberately breaks a profile (corrupted digest, missing weights) and triggers `/profile`; observes exit code 5 pre-flight failure with prior engine still alive; then triggers a post-stop failure case and observes exit code 6 rollback with prior engine re-loaded. Evidence: `runs/phase4-sc4/walkthrough.md`.
scaffold: `runs/phase4-sc3/PENDING.md` + `runs/phase4-sc4/PENDING.md`
resume_signal: `"sc3 phase4 green"` + `"sc4 phase4 green"`
result: **[resolved 2026-04-23 — both `sc3 phase4 green` AND `sc4 phase4 green` fired]**.

- **SC-3:** 4/4 turns routed to the correct variant on a live session against Qwen3.6. All 4 role classifier branches (plan / edit / critic / default) verified. Evidence: `runs/phase4-sc3/walkthrough.md` + `report.json`. Two real defects surfaced + fixed inline: (a) `harness.assembly` JSONL record missing `emmy.role` + `emmy.profile.variant` attrs, (b) `classifyRole` iteration-2+ fallthrough iterated tool-descriptor catalog instead of assistant tool_calls.
- **SC-4:** 4 failure-mode cases captured: 2× exit-5 preflight-fail (nonexistent path, corrupted digest) + 2× exit-6 post-stop rollback (captured incidentally via the Gemma 4 boot failures). All 4 cases fully verified the D-04/D-05 invariants end-to-end on live DGX Spark. Evidence: `runs/phase4-sc4/walkthrough.md`.

## Summary

total: 4
passed: 4 (all items resolved on live DGX Spark)
issues: 0
pending: 0
skipped: 0
blocked: 0

## New Deferral Added 2026-04-23 (now resolved)

**`p4 gemma-container green`** — upgrade the NGC vLLM container to a build whose Transformers library includes `Gemma4ForCausalLM`. **Resolved 2026-04-23** via `profiles/gemma-4-26b-a4b-it/v2/` bundle on upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` (vLLM 0.19.1.dev6 + Transformers 5.5.0, aarch64, CUDA 13.0; image local ID `sha256:db59febc6c47...`). This unblocked items 1, 2, and 3 simultaneously.

## Gaps

None. All 4 operator-gated items from 04-CLOSEOUT.md § Carry-forward fully resolved via live DGX Spark evidence: items 3 + 4 + the container-upgrade deferral in the 2026-04-23 late follow-up session; items 1 + 2 in the 2026-04-24 follow-up session (6h wall-clock of KV bisection + thermal replay × 2). Phase 4 close-with-deferrals discipline cleared. Phase 4 fully green.
