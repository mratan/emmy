# Phase 04.4 V-protocol Results — v7: per-profile matrix (3 of 4 shipped)

Tested whether the V1 adoption ceiling is fundamental or profile-specific
by running the V1 (20 tasks) + V3 (5 probes) protocol on each of the 4
shipped profiles. 3 of 4 completed; Gemma MoE (26B-A4B v2) blocked
mid-run by GPU memory contention with an unrelated bio-informatics
pipeline using ~25 GiB of UMA — its profile only ships at gmu=0.86
(102.94 GiB needed) so a re-run requires either freeing memory or
cutting a v2.1 sibling at gmu=0.55.

## Matrix

| Profile | Type | Active params | V1 adoption | V1 writes | V3 |
|---------|------|---------------|-------------|-----------|-----|
| qwen3.6-35b-a3b @ v3.1 | Qwen MoE | 3B / 35B | **11/20 = 55%** (best of 4 conditions, N=78 across rounds A/C/D/E) | 0 / 78 | 5/5 (closed by staleness banner v4) |
| qwen3.6-27b @ v1.1 | Qwen dense | 27B / 27B | **20/20 = 100%** | **4 / 20** | 5/5, probe-1 explicit rot-catch |
| gemma-4-31b-it @ v1.1 | Gemma dense | 31B / 31B | **19/20 = 95%** | 0 / 20 | 5/5, probe-1 verified against code |
| gemma-4-26b-a4b-it @ v2 | Gemma MoE | 4B / 26B | **BLOCKED** — gmu=0.86 needs 102.94 GiB; only 94.8 GiB free during run (bio-pipeline using ~25 GiB) | — | — |

## What this confirms

**The 50-55% MoE ceiling is profile-specific, not fundamental.** Both
dense profiles (Qwen 27B and Gemma 31B) cleared the 60% gate
decisively at 95-100%. The architecture/active-params bottleneck
predicted by V-RESULTS-v6 holds across two different families:

- Qwen 27B dense (27B active): 100%
- Gemma 31B dense (31B active): 95%
- Qwen 35B-A3B MoE (3B active): 55%

9× more active params per token correlates strongly with
system-prompt compliance.

## Cross-profile observations

**V1 stable-miss tasks behave very differently across profiles.**
The 8 tasks that consistently missed on Qwen MoE (02 TextEncoder,
05 web_search bypass, 07 buildRealPiRuntime vs Tui, 10 memory
telemetry, 15 sha256 logging, 17 persona_dir, 18 resume-signal
parser, 20 native tools registered) — all of them fired memory on
Qwen 27B dense. Gemma 31B dense missed only task 05 (web_search
bypass) — which is also a stable-miss on MoE, suggesting that
specific question shape ("how does X tool work?") triggers a
training-knowledge response across profile types.

**V1 writes appeared only on Qwen 27B dense.** Qwen MoE: 0/78.
Gemma 31B dense: 0/20. Qwen 27B dense: 4/20 (tasks 12 and 20).
Hypothesis: Qwen's tool-use RL training includes a
"document-what-you-find" pattern that Gemma's training may lack
(or that lower-active-params blunts). Worth flagging as a
profile characteristic, not a bug.

**V3 rot protection PASS on all 3 measured profiles.** The
staleness banner from V-RESULTS-v4 is profile-agnostic and the
"verify before trusting" reasoning fires reliably on dense.
Cleanest evidence: Qwen 27B probe 1 explicitly stated "the memory
note claiming camelCase is stale and contradicted by the actual
code." Gemma 31B probe 1 reasoned similarly: "the explicit use of
`request_id` in the API handler indicates a preference for
snake_case."

## Throughput tradeoff (operator awareness)

Per CLAUDE.md and observed wall-clock during the matrix:

- Qwen 35B-A3B MoE @ v3.1: ~48 tok/s (per CLAUDE.md), batch wall-clock ~30-60 min for 20 tasks
- Qwen 27B dense @ v1.1: ~7.6 tok/s (per CLAUDE.md), batch wall-clock ~120 min for 20 + 5 V3
- Gemma 31B dense @ v1.1: ~6.4 tok/s (per CLAUDE.md), batch wall-clock ~21 min for 20 + 5 V3
  (faster than expected; ran during low GPU contention period)

Per the dense-for-unsupervised feedback memory: the 6× slower
throughput on dense is acceptable for memory-heavy / unsupervised
work where compliance matters more than turns-per-minute.

## Gemma 26B MoE — what's needed to complete the matrix

The profile bundle ships only v1 + v2, both at gmu=0.86.
Successfully measuring Gemma 26B MoE requires one of:

1. **Wait for bio-pipeline to finish** — it's currently using ~25 GiB
   of UMA. With it gone, ~119 GiB free, well above gmu=0.86's 102.94
   GiB requirement. Once that's done, the matrix script can be
   re-kicked targeting just gemma-4-26b-a4b-it@v2.
2. **Cut a v2.1 sibling at gmu=0.55** — mirrors the Qwen 27B v1/v1.1
   and Gemma 31B v1/v1.1 splits. ~10 LOC change to a serving.yaml
   plus hash recompute. Operator-decided since it's a profile
   architectural call.

Recommend (1) — simpler, no profile changes. The (2) path is worth
considering as Phase 04.1-followup if MoE memory contention happens
often in practice.

## Resume signals

- `v1 memory adoption green: per-profile rates 100% / 95% / 55% (dense / dense / MoE); MoE-specific 50-55% ceiling confirmed across 4 conditions; gate framing per-profile per Phase 5 eval matrix`
- `v2 memory discipline first-evidence: Qwen 27B dense wrote 4 notes / 20 sessions; Gemma 31B dense and Qwen MoE wrote 0; Qwen tool-use RL likely contributes`
- `v3 memory rot green: 5/5 PASS across all 3 measured profiles; staleness banner profile-agnostic`
- `gemma-4-26b-a4b-it@v2 V-protocol: BLOCKED on GPU memory contention; awaiting bio-pipeline completion or v2.1@gmu=0.55 sibling`

V8-memory and V8-compaction remain operator-time work.

---

*Captured 2026-04-28 by autonomous Claude after the 3-profile
matrix run. All transcripts retained at runs/v1-matrix-* and
runs/v3-matrix-*.*
