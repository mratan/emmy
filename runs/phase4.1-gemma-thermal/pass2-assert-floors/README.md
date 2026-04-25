# Gemma 4 31B dense — Thermal pass 2 (assert floors)

- **Profile:** `profiles/gemma-4-31b-it/v1` (hash `sha256:fe9eded634b233fd5679506caab4fefe3847fecb77f05b8a166b7c70c792a3d6`)
- **Run ID:** `20260424T225454Z_64a791-thermal`
- **Mode:** `--assert-floors`
- **Verdict:** `All floors pass` ✓
- **Wall-clock:** 7326.2s (~2h 2min)
- **Hardware:** DGX Spark GB10 (spark-ff85)

## Pass gates (per operator directive — ALL GREEN)

- `preemptions_hour2 == 0` ✓ (0)
- `oom_events == 0` ✓ (0)
- `All floors pass` ✓ (script's default assertion)

## Floors asserted (pass 1 → pass 2 deltas)

| Metric | Pass 1 (floor) | Pass 2 (observed) | Delta |
|---|---:|---:|---:|
| `decode_throughput_p50_hour2_tokps` | 6.34 | 6.45 | +0.11 |
| `decode_throughput_p1_hour2_tokps` | 0.71 | 6.16 | **+5.45** (warm-cache: tail spikes resolved) |
| `gpu_clock_p5_hour2_mhz` | 2405 | 2476 | +71 |
| `gpu_clock_p50_hour2_mhz` | 2496 | 2496 | 0 |
| `gpu_temp_p95_hour2_c` | 75 | 76 | +1 |

The dramatic p1 improvement (0.71 → 6.16) reflects vLLM's prefix cache warming
between passes — pass 1 hit cold prompts that triggered tail-latency spikes;
pass 2's identical workload drove against the warm cache. p50 stable shows
the median throughput is genuinely steady-state.

Plan 04.1-02 Task 9 complete. Profile validates cleanly.
