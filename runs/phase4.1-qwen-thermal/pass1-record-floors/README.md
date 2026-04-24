# Qwen 27B dense — Thermal pass 1 (record floors)

- **Profile:** `profiles/qwen3.6-27b/v1` (hash `sha256:ab02fc2fc8559607db848569cc1ab24cea7ee010b26bfcea2760df8b18d2fe2d`)
- **Run ID:** `20260424T122140Z_bd4c4f-thermal`
- **Mode:** `--record-floors`
- **Wall-clock:** 7749.1s (~2h 9min; target 7200s)
- **Hardware:** DGX Spark GB10 (spark-ff85)

## Pass gates (per operator directive)

- `preemptions_hour2 == 0` ✓ (0)
- `oom_events == 0` ✓ (0)

## Recorded floors (informational — tok/s NOT a gate)

| Metric | Value |
|---|---|
| `decode_throughput_p50_hour2_tokps` | 7.57 |
| `decode_throughput_p1_hour2_tokps` | 6.47 |
| `gpu_clock_p5_hour2_mhz` | 2476 |
| `gpu_clock_p50_hour2_mhz` | 2476 |
| `gpu_temp_p95_hour2_c` | 75 |

Clock held perfectly flat (p5 == p50 == 2476 MHz) across hour 2 — zero thermal
throttle. Temperature capped at 75°C, well inside comfort range.

Throughput at ~7.5 tok/s is bandwidth-bound dense behavior on GB10 (27B FP8
weights loaded per decode step vs MoE's 3B active). This matches the pattern
flagged in CLAUDE.md § Pinned Tech Stack as "Gemma 4 31B dense bandwidth-bound
at 6.9 tok/s" — Qwen3.6-27B lands in the same zone. Per operator directive
2026-04-24 (`feedback_dense_model_throughput.md`), this is expected and
NOT an acceptance gate.

## Next

Pass 2 `--assert-floors` — runs the same 2h drive and asserts the recorded
floors are not regressed.
