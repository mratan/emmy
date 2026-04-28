# Phase 04.4 V-protocol Results — v8: 4-profile matrix complete

V-RESULTS-v7 left the Gemma 4 26B-A4B MoE profile blocked on GPU
memory contention with an unrelated bio-informatics pipeline. With
that pipeline freed, the matrix is now complete: V1 (20 tasks) +
V3 (5 rot probes) on all 4 shipped profiles.

The headline finding **falsifies the v7 hypothesis** that the 50-55%
V1 ceiling on Qwen MoE was an MoE-active-params bottleneck. Gemma 4
MoE clears 100% on V1 with only 4B active params (just 33% more than
Qwen MoE's 3B). The compliance gap is **Qwen-MoE-specific**, not
architectural — there are now both a high-active-params dense win
*and* a low-active-params MoE win on the same gate.

## Matrix

| Profile | Type | Active params | V1 adoption | V1 writes | V3 rot |
|---------|------|---------------|-------------|-----------|--------|
| qwen3.6-35b-a3b @ v3.1 | Qwen MoE | 3B / 35B | **11/20 = 55%** (best of 4 conditions, N=78 across rounds A/C/D/E from v7) | 0 / 78 | 5/5 |
| qwen3.6-27b @ v1.1 | Qwen dense | 27B / 27B | **20/20 = 100%** | **4 / 20** (2/2 load-bearing per v7) | 5/5 |
| gemma-4-31b-it @ v1.1 | Gemma dense | 31B / 31B | **19/20 = 95%** | 0 / 20 | 5/5 |
| **gemma-4-26b-a4b-it @ v2** | **Gemma MoE** | **4B / 26B** | **20/20 = 100%** | **0 / 20** | **5/5** |

Profile hash for the new run: `sha256:5ff29567a7deeaa1603dea5f2ac2a0789b5b8951ca850a0a09601ff527c2169f`.
Container: `vllm/vllm-openai:gemma4-0409-arm64-cu130` (Day-1 image,
~9 min cold start observed). Boot sequence note: the sidecar control
plane at `127.0.0.1:8003` died during this swap, but vLLM came up
cleanly at `127.0.0.1:8002` and `pi-emmy --print` ran the full
20+5 batch with 100% jsonl capture coverage and zero rc≠0 outside
one timeout (task17 hit the 360s wall). All transcripts under
`runs/v1-matrix-gemma-26b-moe/` and `runs/v3-matrix-gemma-26b-moe/`.

## What this changes vs v7

**v7's hypothesis (ruled out by this run):** "9× more active params
per token correlates with system-prompt compliance" — i.e. the MoE
ceiling came from too few active params per token to internalize the
"first call MUST be memory.view" instinct.

**Why the data falsifies it:**

- Qwen MoE 3B active → 55%
- **Gemma MoE 4B active → 100%** ← this is the killer
- Qwen dense 27B active → 100%
- Gemma dense 31B active → 95%

If active-params was the bottleneck, Gemma MoE (only 33% more active
params than Qwen MoE) should have clustered with Qwen MoE, not with
both denses. It clustered with denses. So the compliance gap is *not*
an architectural property of MoE-with-few-active-params; it tracks
something specific to the Qwen MoE family.

**Plausible candidates for the actual driver (not yet measured):**

1. **Qwen-MoE-specific tool-use RL trade-off.** Qwen 3 Coder (and the
   A3B series) are trained heavily on tool-use SFT/RL. That training
   may have over-fit "answer with what you know first, tool-call only
   when needed" — exactly the pattern that defeats a "MUST call X
   first" system instinct. Gemma 4 MoE doesn't have the same RL
   pipeline.
2. **Routing-collapse on instruction tokens.** MoE expert routers
   trained on coding distributions may route `MUST` / `FIRST` /
   numbered-instruction tokens to a narrow subset of experts whose
   training preferred direct answers. Same architecture, different
   training mix → different collapse. Gemma 4 MoE has 8 active
   experts of 64 (per Day-1 release notes) vs Qwen 3 A3B's 8 of 128 —
   wider routing surface in Gemma may dilute the effect.
3. **System-prompt tokenization.** Qwen and Gemma use different
   chat-template wrappers. The "Memory instinct" block lands at a
   different positional and template-role boundary in each. Worth
   checking the `prompt.assembled sha256` paths to compare what
   actually reaches the model.

The runbook implication is the same regardless of which is right:
**don't generalize Qwen-MoE compliance findings to other MoE
families**. Per-profile gates from v7 stay correct; the v7 framing
just attributed the gap to the wrong variable.

## V1 writes — Qwen-dense-only pattern reinforced

Writes to `/memories/project` after the 20 V1 sessions:

| Profile | Writes |
|---------|--------|
| Qwen MoE | 0 / 78 |
| Qwen 27B dense | 4 / 20 (2 load-bearing per v7 audit) |
| Gemma 31B dense | 0 / 20 |
| **Gemma 26B MoE** | **0 / 20** |

Both Gemma profiles produced zero writes — same as Qwen MoE. Only
Qwen *dense* wrote. The v7 hypothesis ("Qwen tool-use RL training
includes a document-what-you-find pattern that Gemma lacks") gets
direct support from this run: the same family vs across-family
split holds for writes (Qwen-dense yes, Qwen-MoE no, Gemma-either no).

Operator note: this is a profile *characteristic*, not a defect. The
v2 acceptance criterion ("model writes notes when discoveries warrant
it") is met by Qwen 27B dense and not met by anything else. Two
choices for the runbook:
- Treat Qwen 27B dense as the v2-memory-discipline reference profile,
  with Gemma profiles documented as zero-write-but-100%-read.
- Add a v2-memory-discipline rubric that scores read+reasoning
  about memory rather than write-rate, normalizing across families.

Recommend the second for Phase 5 eval-matrix formalization.

## V3 rot protection — green across all 4

Same 5 probes against `/tmp/v3-rot-test` (5 planted notes; 3 of them
contradict truth-source code at `src/api/handler.ts`,
`src/db/pool.ts`, `src/routes/users.ts`). All 4 profiles answered
based on code, not notes. Cleanest evidence per profile:

- **Qwen 27B dense, probe 1:** "the memory note claiming camelCase
  is stale and contradicted by the actual code"
- **Gemma 31B dense, probe 1:** "the explicit use of `request_id` in
  the API handler indicates a preference for `snake_case`"
- **Gemma 26B MoE, probe 1:** "the explicit use of `request_id` in
  the API handler suggests that **snake_case** is the established
  convention" — also viewed `/memories/global` (only profile that
  did) before reading code, suggesting more thorough-but-defensive
  retrieval
- **Qwen MoE (v7 round D):** PASSED 5/5 after the v4 staleness banner
  shipped

The staleness-banner intervention from V-RESULTS-v4 is profile-
agnostic. **Tool-side, in shipping code, ready for Phase 5.**

## Throughput tradeoff — refined

Per CLAUDE.md and observed wall-clock:

| Profile | Decode tok/s | V1 batch wall-clock | V3 batch wall-clock |
|---------|-------------|---------------------|---------------------|
| Qwen MoE @ v3.1 | ~48 | 30-60 min | <5 min |
| Qwen 27B dense | ~7.6 | ~120 min | ~30 min |
| Gemma 31B dense | ~6.4 | ~21 min (low contention period) | <5 min |
| **Gemma 26B MoE @ v2** | **~36** | **~30 min** | **~6 min** |

Gemma 26B MoE measured close to its CLAUDE.md spec of 36 tok/s. One
task hit the 360s timeout (task17, persona_dir / pattern question)
but partial transcript captured the memory.view first-call so it
counts toward strict adoption.

## Resume signals

- `v1 memory adoption green: per-profile rates 100%/100%/95%/55%
  (Gemma MoE / Qwen dense / Gemma dense / Qwen MoE); the 50-55%
  ceiling is Qwen-MoE-specific, NOT MoE-architectural`
- `v2 memory discipline first-evidence: Qwen 27B dense wrote 4/20
  (2/2 load-bearing); both Gemmas and Qwen MoE wrote 0; Phase 5
  rubric should score read-and-reason rather than write-rate`
- `v3 memory rot green: 5/5 PASS across all 4 profiles; staleness
  banner profile-agnostic`
- `v7 hypothesis falsified: active-params is not the driver of MoE
  compliance gap; candidates are Qwen-MoE-specific tool-use RL,
  router collapse on instruction tokens, or chat-template
  differences — measure in Phase 5`

V8-memory and V8-compaction remain operator-time work. The 4-profile
V1+V3 matrix is sealed.

---

*Captured 2026-04-28 by autonomous Claude after the bio-pipeline
freed enough UMA for `gpu_memory_utilization=0.86`. All 25 transcripts
(20 V1 + 5 V3) retained at runs/v1-matrix-gemma-26b-moe/ and
runs/v3-matrix-gemma-26b-moe/. Profile hash sealed against
gemma-4-26b-a4b-it@v2 sha256:5ff29567...c2169f.*
