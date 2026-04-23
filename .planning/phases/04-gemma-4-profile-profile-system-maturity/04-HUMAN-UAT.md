---
status: partial
phase: 04-gemma-4-profile-profile-system-maturity
source: [04-VERIFICATION.md]
started: 2026-04-23
updated: 2026-04-23
---

## Current Test

[awaiting operator DGX Spark GPU access for all 4 items]

## Tests

### 1. Gemma 4 KV budget bisection

expected: `scripts/find_kv_budget.py --profile profiles/gemma-4-26b-a4b-it/v1/` converges on a `gpu_memory_utilization` value under 30-min sustained load with zero preemption events + zero `dmesg` OOM events; measured value written into `serving.yaml.engine.gpu_memory_utilization` + decision log appended to `PROFILE_NOTES.md`. Starting seed: 0.55 (per 04-RESEARCH.md §2 given Gemma 4 26B ~28 GB weights + 16 GB KV at 128K context under Phase 3.1 UMA-pressure lesson).
scaffold: `runs/phase4-kv/PENDING.md`
resume_signal: `"p4 kv green"`
result: [pending]

### 2. Gemma 4 2-hour thermal replay (two-pass: record-floors → assert-floors)

expected: Two consecutive 2-hour `scripts/thermal_replay.py` runs on Gemma 4 v1. First run with `--record-floors` measures steady-state GPU clock floor + decode-throughput floor across hour 2; floors are baked into `PROFILE_NOTES.md` frontmatter. Second run with `--assert-floors` re-verifies and must not drop below recorded floors. Same methodology as Phase 1 D-14/D-15 applied to Gemma 4.
scaffold: `runs/phase4-thermal/PENDING.md`
resume_signal: `"p4 thermal floors recorded"` → `"p4 thermal green"` (two signals, one per run)
result: [pending]

### 3. SC-1 /profile swap walkthrough (Qwen3.6 ↔ Gemma 4 round-trip)

expected: Operator runs `pi-emmy` on a clean repo, types `/profile gemma-4-26b-a4b-it`, observes the four D-02 progress phases fire verbatim (`stopping vLLM` → `loading weights N%` → `warmup` → `ready`), runs a turn against Gemma 4 with its function-calling tool format, then types `/profile qwen3.6-35b-a3b` and swaps back cleanly. Evidence committed to `runs/phase4-sc1/walkthrough.md` with verdict `sc1 phase4 green` + transcript.json + docker-logs.txt.
scaffold: `runs/phase4-sc1/PENDING.md`
resume_signal: `"sc1 phase4 green"`
result: [pending]

### 4. SC-3 role-routing + SC-4 failure/rollback walkthroughs

expected: (a) SC-3 — operator runs a 5-turn session with `profiles/routes.yaml` wired to the three Qwen v3.1 sibling variants; inspects Langfuse or the JSONL sink for `emmy.profile.variant` + `emmy.role` attributes on every chat-request span; confirms the role heuristic routes correctly (plan / edit / critic / default). Evidence: `runs/phase4-sc3/walkthrough.md` + `report.json`. (b) SC-4 — operator deliberately breaks a profile (corrupted digest, missing weights) and triggers `/profile`; observes exit code 5 pre-flight failure with prior engine still alive; then triggers a post-stop failure case and observes exit code 6 rollback with prior engine re-loaded. Evidence: `runs/phase4-sc4/walkthrough.md`.
scaffold: `runs/phase4-sc3/PENDING.md` + `runs/phase4-sc4/PENDING.md`
resume_signal: `"sc3 phase4 green"` + `"sc4 phase4 green"`
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

None. All 4 items are intentional operator-gated deferrals following the Phase 1 D-15 precedent (Phase 1 closed with 3 identical-shape deferrals: SC-1 throughput, SC-5 sampler re-validation, SC-4 air-gap CI wrapper). Software side is fully verified automatically (188 pytest + 520 bun + 5 typecheck + 8 profile validates green). Live-rig evidence resumes opportunistically via `/gsd-progress` when operator GPU time allows.
