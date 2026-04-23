# KV-finder final run — Gemma 4 26B A4B-it v2

**Run ID:** `20260423T201355Z_847870-kv-finder` (canonical artifact dir is gitignored; this directory copies the evidence under the phase-scoped allowlist)
**Started:** 2026-04-23 20:13:55 UTC
**Finished:** 2026-04-23 23:48:07 UTC
**Total duration:** 3h 34m (12,851 s)
**Profile:** `profiles/gemma-4-26b-a4b-it/v2/` (upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130`; image local ID `sha256:db59febc6c47...`)
**Hardware:** spark-ff85 (DGX Spark / GB10, 119.7 GiB UMA visible to CUDA)
**Seed / initial:** 0.55 (profile) / 0.75 (finder default `--initial`)
**Resume signal:** `p4 kv green`

## Verdict

| Measurement | Value |
|---|---|
| `gpu_memory_utilization` (final) | **0.86** |
| Highest clean value observed | 0.91 |
| First preemption | 0.915 (iter 11) |
| Second preemption | 0.93 (iter 9) |
| Third preemption | 0.92 (iter 10) |
| Iterations | 11 |
| Drive duration per clean iter | 10–13 min |
| Safety margin applied | 5 % (0.91 × 0.95 = 0.8645 → 0.86) |

Final value `0.86` is noticeably higher than the Phase 3.1 RAM-conservative seed of `0.55`. The seed came from the pessimistic "DGX Spark UMA shares model + KV + harness CPU" reading of Pitfall #3 which is calibrated to the 70B dense model budget. Gemma 4 26B MoE's actual weight footprint on this box is only 25.67 GiB (confirmed by docker logs: "Model loading took 25.67 GiB memory"), which leaves substantially more KV headroom than Qwen 35B-A3B FP8 (which settles near 0.85 in Phase 3.1's equivalent bisection).

## Preemption mode

At the ceiling, vLLM rejects *at boot time* rather than degrading at runtime. Three consecutive boot-failure bundles (`boot-failures/`) all terminate on the same root cause:

```
ValueError: Free memory on device cuda:0 (N.NN/119.7 GiB) on startup is less than
desired GPU memory utilization (K, M.MM GiB). Decrease GPU memory utilization or
reduce GPU memory used by other processes.
```

| Iter | Util | Free GiB | Required GiB | Delta |
|---|---|---|---|---|
| 9 | 0.93 | 110.52 | 111.32 | −0.80 |
| 10 | 0.92 | 109.33 | 110.12 | −0.79 |
| 11 | 0.915 | 108.44 | 109.52 | −1.08 |

The "free GiB" number drifts downward between boots — Langfuse / SearxNG / other host-side services (Phase 3/3.1 artifacts kept running during the bisection) consume a little more UMA each time. At these utils, margins are tight enough that a few hundred MiB of host-side pressure moves the line. This confirms the 5 % safety margin is load-bearing, not cosmetic.

Notably, runtime preemption (the `preemptions_delta` / `swapped_delta` counters from vLLM's scheduler) **never fired** in any clean iteration — the failure mode on this hardware is purely boot-side UMA budgeting, not in-flight eviction. All 9 clean iterations (0.75 → 0.91) showed 0 preemptions / 0 swaps across 14-16 requests each.

## Per-iteration timeline

See `iterations.jsonl` for the full per-iter metrics. Highlights:

- Iter 0–8 (0.75, 0.77, 0.79, 0.81, 0.83, 0.85, 0.87, 0.89, 0.91): all clean, zero preemptions, 22-26k tokens per 10-13 min drive window.
- Iter 7 (0.89) uniquely posted a **p99 latency of 60.8 s** vs ~175-180 s for all other clean iters, while also hitting 16 requests (vs 14). That's likely prefix-cache friendliness at that specific util × cache-size pairing; noted but not acted on.
- Cold-start wall-clock drifted 406 s → 470 s across iters (thermal accumulation — Phase 1 Pitfall #4 prediction holds, now quantified against the 900 s ceiling we set in the prep commit).

## Relationship to Phase 1 / 3.1 equivalents

| Profile | Final util | Model | Notes |
|---|---|---|---|
| Qwen v1 (Phase 1) | 0.75 | Qwen 3.6 35B-A3B FP8 | Original bisection |
| Qwen v3 / v3.1 (Phase 3, 3.1) | 0.85 | Qwen 3.6 35B-A3B FP8 | Re-bisected |
| **Gemma 4 v2 (this run)** | **0.86** | **Gemma 4 26B-A4B MoE** | First Gemma bisection |

The fact that a 26B MoE model tolerates *marginally higher* KV budget than a 35B MoE is expected: smaller weight footprint leaves more room for KV cache at the same free-memory threshold.

## Notes for thermal replay (next step)

- Gemma 4 v2 decode throughput at boot has been 35.56 – 37.89 tok/s across 11 boots (rolling average ~36.7 tok/s at 100-token smoke). The 2-hour thermal replay's `decode_tokps_p1_h2` floor should exceed ~30 tok/s per Phase 1 D-15 methodology; expected drop of ~20 % p5 is realistic given cold-start throughput already dropped 3 % across this bisection alone (thermal pressure is observable even at 10-min drive windows).
- Clean iteration durations: 641-770 s on 14-16 request batches. 2-hour replay at same inter-request gap (~45 s) gives ~160 requests — should be enough to populate the p1/p5/p50 histogram well.

## See also

- `../failed-first-attempt-probe-timeout/README.md` — the first bisection attempt misdiagnosed the 300 s wait_for_vllm ceiling as a preemption signal. Fixed in prep commit at `4c5f5c3` (probe 300 → 900 s, finder subprocess 420 → 1200 s).
- `profiles/gemma-4-26b-a4b-it/v2/PROFILE_NOTES.md` → "KV-finder result" section (appended by the finder)
- `profiles/gemma-4-26b-a4b-it/v2/serving.yaml:35` → `gpu_memory_utilization: 0.86`
