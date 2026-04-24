# Thermal replay pass 1 (record-floors) — Gemma 4 26B A4B-it v2

**Run ID:** `20260423T235910Z_062507-thermal` (canonical artifact dir is gitignored; this dir copies the evidence under the phase-scoped allowlist)
**Profile:** `profiles/gemma-4-26b-a4b-it/v2/` @ `gpu_memory_utilization: 0.86`
**Started:** 2026-04-23 23:59:10 UTC
**Duration:** 7204.7 s (≈ 2 h, target 7200 s)
**Pre-condition:** emmy-serve booted at 23:51 UTC via `scripts/start_emmy.sh` (455 s cold start, 36.28 tok/s smoke)
**Resume signal:** `p4 thermal floors recorded`

## Measured floors (baked into `PROFILE_NOTES.md` frontmatter)

| Floor | Value |
|---|---|
| `decode_throughput_p50_hour2_tokps` | 35.9 |
| `decode_throughput_p1_hour2_tokps` | 33.3 |
| `gpu_clock_p50_hour2_mhz` | 2496 |
| `gpu_clock_p5_hour2_mhz` | 2405 |

## Hard gates (pass 2 will re-assert these against zero)

| Gate | Value |
|---|---|
| `preemptions_hour2` | 0 |
| `oom_events` | 0 |
| `gpu_temp_p95_hour2_c` | 73 °C (informational, not a gate) |

## Interpretation

**Decode throughput held steady:** p50 of 35.9 tok/s over hour 2 is within ~3 % of the 37 tok/s smoke at boot. p1 of 33.3 tok/s (worst 1 %) stays above 90 % of p50 — no tail regression. Pass 2 will need to land above:
- `decode_p50 ≥ 35.9 × 0.93 ≈ 33.4`
- `decode_p1 ≥ 33.3 × 0.90 ≈ 30.0`

**GPU clock shows modest throttling in hour 2:** p50 = 2496 MHz (base clock) / p5 = 2405 MHz. The ~91 MHz p5 drop is the real-world shape of Pitfall #4 on this box — short smokes would have missed it. Pass 2 tolerance: `gpu_clock_p5 ≥ 2405 × 0.95 ≈ 2285`.

**GPU temp peaked at p95 = 73 °C** in hour 2. Comfortably below thermal limit, matches the base-clock p50 reading (no visible throttle at steady state, only at percentile fringes).

**Zero preemptions / zero OOM** across 2 hours of sustained load at `gpu_memory_utilization=0.86`. Confirms the KV-finder's 5 % safety margin is correct at this boundary — the 0.86 is genuinely safe, not just "didn't-preempt-in-10-min" safe.

## Files

- `summary.json` — scalar floor values (the canonical artifact the finder writes into PROFILE_NOTES.md)
- `stdout.log` — thermal replay stdout (final "thermal replay complete" banner + floor-record confirmation)
- `dmesg_tail.txt` — kernel log tail at run end (scanned for OOM / MIG / PCIe errors; zero matches)
- `gpu_samples-{head,tail}100.jsonl` — first 100 + last 100 GPU samples (5 s interval); head shows early cold-start region, tail shows hour-2 steady state
- `vllm_metrics-{head,tail}50.jsonl` — first 50 + last 50 vLLM `/metrics` snapshots for cross-check against summary floors
- Full sample streams remain in `runs/20260423T235910Z_062507-thermal/` (gitignored, local only)

## Pass 2 pre-condition

Profile hash is now `sha256:8f9c23f500e7ccac3ee2ebdf6ddece6379b3c29c1361c52dc11f8c68f40bc4db` after the frontmatter `measured_values` populated. Pass 2 must run against this exact hash — any profile edit between passes invalidates the comparison.
