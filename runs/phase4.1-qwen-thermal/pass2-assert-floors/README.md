# Qwen 27B dense — Thermal pass 2 (assert floors)

- **Profile:** `profiles/qwen3.6-27b/v1` (hash `sha256:c3ccf1e109fc54eed311be5a17b7b788efcd6335c6e9f55a8345d0eed84967bb`)
- **Run ID:** `20260424T143235Z_44de7f-thermal`
- **Mode:** `--assert-floors`
- **Verdict:** `All floors pass` ✓
- **Wall-clock:** 7744.8s (~2h 9min)
- **Hardware:** DGX Spark GB10 (spark-ff85)

## Pass gates (per operator directive — ALL GREEN)

- `preemptions_hour2 == 0` ✓ (0)
- `oom_events == 0` ✓ (0)
- `All floors pass` ✓ (script's default assertion)

## Floors asserted vs recorded (informational)

| Metric | Pass 1 (floor) | Pass 2 (observed) | Delta |
|---|---:|---:|---:|
| `decode_throughput_p50_hour2_tokps` | 7.57 | 7.60 | +0.03 |
| `decode_throughput_p1_hour2_tokps` | 6.47 | 6.93 | +0.46 (warm-cache gain) |
| `gpu_clock_p5_hour2_mhz` | 2476 | 2476 | 0 (flat) |
| `gpu_clock_p50_hour2_mhz` | 2476 | 2476 | 0 (flat) |
| `gpu_temp_p95_hour2_c` | 75 | 75 | 0 |

Clock remained flat (p5 == p50 == 2476 MHz) across both 2h runs — zero
thermal throttle on this profile. Temperature stable. Throughput actually
slightly IMPROVED from pass 1 to pass 2 (warm-cache effect).

Profile validates cleanly. Plan 04.1-01 Task 9 complete.
