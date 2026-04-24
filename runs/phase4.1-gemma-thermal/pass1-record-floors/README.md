# Gemma 4 31B dense — Thermal pass 1 (record floors)

- **Profile:** `profiles/gemma-4-31b-it/v1` (hash `sha256:fe9eded634b233fd5679506caab4fefe3847fecb77f05b8a166b7c70c792a3d6`)
- **Run ID:** `20260424T205237Z_f420be-thermal`
- **Mode:** `--record-floors`
- **Wall-clock:** 7265.7s (~2h 1min; target 7200s)
- **Hardware:** DGX Spark GB10 (spark-ff85)

## Pass gates (per operator directive — ALL GREEN)

- `preemptions_hour2 == 0` ✓ (0)
- `oom_events == 0` ✓ (0)

## Recorded floors (informational — tok/s NOT a gate)

| Metric | Value |
|---|---|
| `decode_throughput_p50_hour2_tokps` | 6.34 |
| `decode_throughput_p1_hour2_tokps` | 0.71 |
| `gpu_clock_p5_hour2_mhz` | 2405 |
| `gpu_clock_p50_hour2_mhz` | 2496 |
| `gpu_temp_p95_hour2_c` | 75 |

GPU clock fluctuated ~91 MHz between p5 (2405) and p50 (2496) across hour 2 —
matches the pattern from the v2 MoE Phase 4 run exactly. Temperature stable
at 75°C (well inside comfort).

Throughput at ~6.3 tok/s lands mid-range in the CONTEXT.md-flagged 6-10 tok/s
bandwidth-bound dense zone. The p1 tok/s of 0.71 reflects tail-latency spikes
under sustained load (same shape observed on Gemma v2 MoE). Per operator
directive 2026-04-24 (`feedback_dense_model_throughput.md`), throughput is
informational ONLY — NOT an acceptance gate.

## Next

Pass 2 `--assert-floors` — runs another 2h drive and asserts the recorded
floors are not regressed.
