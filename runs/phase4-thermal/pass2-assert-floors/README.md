# Thermal replay pass 2 (assert-floors) — Gemma 4 26B A4B-it v2

**Run ID:** `20260424T020112Z_bc8eb1-thermal`
**Profile:** `profiles/gemma-4-26b-a4b-it/v2/` @ `gpu_memory_utilization=0.86`, hash `sha256:8f9c23f500...`
**Started:** 2026-04-24 02:01:12 UTC
**Duration:** 7211.7 s (≈ 2 h, target 7200 s)
**Pre-condition:** emmy-serve still hot from pass 1 — no container restart between passes (stresses recovered-thermal-state rather than cold-start behaviour; the more discriminating test)
**Resume signal:** `p4 thermal green`
**Verdict:** `All floors pass`

## Pass 1 vs pass 2 comparison

| Metric | Pass 1 (record) | Pass 2 (assert) | Δ | Tolerance | Headroom |
|---|---|---|---|---|---|
| `decode_p50_hour2_tokps` | 35.90 | 35.78 | −0.33 % | ≥ 0.93 × = 33.39 | +7.1 % |
| `decode_p1_hour2_tokps` | 33.28 | 33.48 | +0.60 % | ≥ 0.90 × = 29.95 | +11.8 % |
| `gpu_clock_p5_hour2_mhz` | 2405 | 2405 | 0 | ≥ 0.95 × = 2285 | +5.3 % |
| `gpu_clock_p50_hour2_mhz` | 2496 | 2496 | 0 | (informational) | — |
| `gpu_temp_p95_hour2_c` | 73 | 71 | −2 °C | (informational) | — |
| `preemptions_hour2` | 0 | 0 | = | must = 0 | ✓ hard |
| `oom_events` | 0 | 0 | = | must = 0 | ✓ hard |
| `wall_time_s` | 7204.7 | 7211.7 | +7 s | (driver-side) | — |

Every measured metric holds within 1 % of pass 1. GPU clock percentiles are identical to the MHz. Pass 2 being 2 °C cooler likely reflects ambient drift between the pass-1 start (16:59 UTC) and pass-2 start (19:01 UTC) — not a profile-characteristic change.

## Why no container restart between passes

The `thermal_replay.py` CLI is explicitly lifecycle-agnostic — it drives a live endpoint, does not own the container. Pass 2 ran against the same emmy-serve instance that pass 1 just drove. Three reasons this is the right shape of the test:

1. **Discriminating:** a warm-start run should be the hardest — any thermal ceiling already hit once in pass 1 should still cap pass 2. "Did floors hold under continued sustained load?" is the question operators actually care about when leaving Gemma 4 running in the daily-driver slot.
2. **Avoids confounds:** profile hash must match between passes for `--assert-floors` to compare apples-to-apples. Restarting the container after pass 1 would rewrite nothing (serving.yaml and PROFILE_NOTES.md are stable after pass 1's frontmatter write), but it would reset CUDA graph cache / prefix cache state, which could perturb latency percentiles in ways that confuse the comparison.
3. **Matches Phase 1 D-14/D-15 convention:** the Qwen v1 thermal validation in Phase 1 ran both passes back-to-back on the same engine instance.

## Files

- `summary.json` — scalar measurements at end-of-run; floor comparisons already stamped PASS before the driver exited
- `stdout.log` — captures the `All floors pass` banner + `thermal replay complete` line
- `dmesg_tail.txt` — kernel log tail; zero OOM / MIG / PCIe errors during the 2 h window
- `gpu_samples-{head,tail}100.jsonl` — early-run + hour-2 steady-state GPU traces
- `vllm_metrics-{head,tail}50.jsonl` — vLLM `/metrics` scrapes for cross-check against summary floors
- Full unbounded streams remain in `runs/20260424T020112Z_bc8eb1-thermal/` (gitignored, local only)

## Phase 4 closure implication

Pass 2 clears the last operator-gated deferral in `04-HUMAN-UAT.md`. With `p4 kv green` + `p4 thermal floors recorded` + `p4 thermal green` all resolved on live DGX Spark, the Phase 4 close-out from 2026-04-21 can flip from `partial` → `resolved`. All four Phase 4 operator deferrals from `04-CLOSEOUT.md § Carry-forward` are closed.
