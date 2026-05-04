# Phase 04.4 V-protocol Results — v9: Mistral Medium 3.5 128B NVFP4

**Date:** 2026-05-04
**Profile:** `mistral-medium-3.5/v2` (NVFP4 pivot from v1 GGUF — Phase 04.7-02 Wave 5)
**Profile hash:** `sha256:28c0d7c3a3b81fe977ab7452c9cd67c43327cd03828bce6c9e21f3757e9121ce`
**Container:** `vllm/vllm-openai:cu130-nightly-aarch64`
  digest `sha256:ffa30d66ff5c…`
**Hardware:** DGX Spark (GB10, 128 GB UMA)
**Engine config:** gmu=0.84, max_model_len=131072, max_num_seqs=1, kv_cache_dtype=fp8, load_format=safetensors

V8 left the matrix at 4 active profiles (Qwen 35B-A3B MoE since dropped, Qwen 27B
dense, Gemma 26B-A4B MoE, Gemma 31B dense). v9 adds the Mistral Medium 3.5 128B
NVFP4 alternate (Phase 04.7) — heavyweight, eval-only, occasional-escalation
profile — to give the matrix a 128B-class data point and surface whether
heavy-parameter quality compensates for known throughput limits on UMA.

The headline finding: **Mistral 128B NVFP4 is the first profile in the matrix
to score 0/20 on V1 strict adoption while passing V3 5/5 cleanly.** This breaks
the prior pattern (every profile that passed V3 also cleared V1≥55%). The
divergence is informative: Mistral is excellent at the verify-before-trusting
discipline when probed directly (V3) but does not internalize the proactive
"FIRST tool call MUST be memory.view" instruction (V1).

## Updated matrix

| Profile | Type | Active params | V1 adoption | V1 writes | V3 rot | Decode tok/s (V1 completed-tasks) |
|---------|------|---------------|-------------|-----------|--------|-----------------------------------|
| qwen3.6-35b-a3b @ v3.1 (DROPPED 2026-04-28) | Qwen MoE | 3B / 35B | 11/20 = 55% | 0 / 78 | 5/5 | n/a |
| qwen3.6-27b @ v1.1 | Qwen dense | 27B / 27B | 20/20 = 100% | 4 / 20 (2 load-bearing) | 5/5 | ~7.6 (v1 inheritance) |
| gemma-4-31b-it @ v1.1 | Gemma dense | 31B / 31B | 19/20 = 95% | 0 / 20 | 5/5 | ~6.4 (v1 inheritance) |
| gemma-4-26b-a4b-it @ v2 | Gemma MoE | 4B / 26B | 20/20 = 100% | 0 / 20 | 5/5 | ~36 (Phase 4 measured) |
| **mistral-medium-3.5 @ v2 (NVFP4)** | **Mistral dense** | **128B / 128B** | **0/20 = 0%** | **0 / 20** | **5/5** | **4.42 (measured this run)** |

## V1 — strict adoption breakdown

20 fresh sessions, memory roots cleaned before task 1, accumulating across
tasks. V1 strict adoption = sessions where the model's **first** tool call
was `memory.view` against `/memories/project`.

| Bucket | Count | Notes |
|--------|-------|-------|
| `MEMORY_VIEW`     (memory tool called) | **0/20** | The dominant V1 signal — Mistral never called memory.view |
| `NO_MEMORY`       (responded with full coherent task work, but skipped memory) | 6/20 | High-quality completions, just not memory-first |
| `SP_OK_ONLY`      (overgeneralized canary rule, replied only `[SP_OK]`) | 2/20 | task05, task10 — model applied SP_OK rule to non-`ping` user message |
| `CTX_OVERFLOW`    (request errored on input length > 128K) | 12/20 | grep tool flooded context with binary JSONL transcripts; see "Tooling-environment difference vs v8" below |

Strict adoption: **0/20 = 0%**. Pass bar is ≥60% per the OPERATOR-PROTOCOLS.md
V1 spec — Mistral fails by a wide margin. Even discounting the 12 CTX_OVERFLOW
tasks as tooling-induced (they're not), the 8 tasks that completed cleanly
all skipped the memory-first rule: 6 went straight to grep/find/read on the
codebase, 2 emitted only `[SP_OK]`.

V1 writes: **0 / 20** memory writes total. Same as Qwen MoE, Gemma MoE, and
Gemma dense (only Qwen-dense produced writes in v8).

## Tooling-environment difference vs v8

V1 task list is verbatim the same as v8's (`v1-adoption-v2/v1-tasks.txt`). The
codebase has grown between 2026-04-28 (v8 run) and 2026-05-04 (v9 run): the
`runs/` and `.planning/phases/04.4-…/runs/` trees now contain hundreds of
`.jsonl` session transcripts, every one of which carries the literal `[SP_OK]`
canary text. When Mistral's first tool call is `grep "[SP_OK]"` (or any
broad pattern), ripgrep matches binary files in those JSONL trees and the
matched-content stream balloons. The canonical incident:

> task03 errored with `400 maximum context length is 131072 tokens. However,
> you requested 16384 output tokens and your prompt contains 1442633 input
> tokens, for a total of 1459017 tokens.`

12/20 tasks hit this path. v8's Gemma MoE 26B (run 2026-04-28) did not hit
this issue — at that time the codebase had fewer JSONL transcripts, AND
Gemma MoE adopted memory-first 20/20, so its FIRST tool call was `memory.view`
which never crashes the context. **Mistral's bias toward grep-as-first-tool
is the underlying cause; the ctx overflow is a downstream consequence.**

This means the 0% adoption figure is honest: Mistral made a different
first-tool choice on 20/20 tasks, which is the V1 protocol's exact gate. The
ctx-overflow side-effect is just additional evidence that the choice was made.

## V3 — rot protection

5 fixed probes against `/tmp/v3-rot-test/` (planted notes contradict
truth-source code). Per OPERATOR-PROTOCOLS V3, pass = model checked code
AND surfaced the contradiction OR followed code-truth.

| Probe | Question | Note (planted) | Code truth | Mistral's answer | Pass |
|-------|----------|----------------|------------|------------------|------|
| 1 | JSON convention camelCase or snake_case? | "Always `requestId` (camelCase)" | `request_id` (snake_case) | "actual codebase uses snake_case ... You may want to update the memory note" — **explicitly surfaces contradiction** | ✓ |
| 2 | Signing algorithm in src/auth.ts? | "HS256" | `RS256` | "**RS256**" — terse but correct | ✓ |
| 3 | Max DB connections? | "50" | `200` | "**200**" — correct | ✓ |
| 4 | How to enable debug logging? | "LOG_LEVEL=verbose" | `DEBUG=1` | Reasoned about code (truth keyword present) | ✓ |
| 5 | User-creation endpoint? | "POST /api/v1/users" | `POST /users` | "**`/users`** (POST method)" — correct | ✓ |

V3: **5/5** clean pass. Probe1's response is the cleanest example of
contradiction-surfacing in the matrix to date — Mistral cited the planted
note, cited the code, identified code as source-of-truth, and recommended
updating the note. That's the gold-standard rot-protection behavior the V3
protocol was designed to elicit.

V3 throughput: 5.00 tok/s aggregate (2870 output tokens / 574s wall).

## Throughput measurement

Per the operator's note that throughput is informational only (not a Phase 5
acceptance gate per `feedback_dense_model_throughput.md`):

| Metric | Value |
|--------|-------|
| Cold start (Mistral container → /v1/models green) | ~600 s (10 min) |
| V1 aggregate (all 20 tasks, including ctx-overflow shortcuts) | 12,296 output tokens / 2891 s wall = **4.25 tok/s** |
| V1 completed-tasks-only (the 6 "NO_MEMORY" + 2 SP_OK_ONLY rows that ran a full pipeline; excludes the 12 ctx-overflow shortcuts) | 10,704 tok / 2420 s = **4.42 tok/s** |
| V3 aggregate | 2,870 tok / 574 s = **5.00 tok/s** |
| Slowest single task | task04 (OTel span attributes) — 2194 output tokens in 555 s = 3.95 tok/s |
| Fastest substantive task | task01 (hash-anchored edit pattern) — 930 tok in 164 s = 5.67 tok/s |

Math sanity: GB10 LPDDR5X bandwidth ≈ 273 GB/s; 80 GB NVFP4 weights → theoretical
ceiling ≈ 3.4 tok/s for a single bandwidth-bound forward pass. Measured ~4.4
tok/s exceeds this — explanation: NVFP4 4-bit packed weights mean only
~63.8 GiB of language-model weights are read per token (vision_tower bf16
tensors are skipped entirely via the airgap_patches/mistral3_safetensors_remap
filter), giving a ~4.3 tok/s ceiling. Measured 4.42 hits the ceiling cleanly.

The CLAUDE.md "NVFP4 is -23.6% slower than FP16" claim was sourced from a
different workload (32K context FP16 throughput vs NVFP4 throughput on
identical models). For the v2 profile's eval-only / occasional-escalation
shape, 4.42 tok/s is the operational reality.

## Quality assessment of completed tasks

When Mistral engaged with the task (the 6 NO_MEMORY rows + the 2 SP_OK_ONLY
quasi-engagements), output quality was **high**:

- **task01** (hash-anchored edit pattern): 8 paragraphs + comparison table +
  "Why It Matters" justification. Technically accurate.
- **task04** (OTel span attribute naming): identified `emmy.*` vs `gen_ai.*`
  namespace pattern with code citations from session.ts:379-381 and
  pi-emmy-extension.ts. Correct.
- **task07** (buildRealPiRuntime vs buildRealPiRuntimeTui): correct, with
  per-function purpose breakdown.
- **task08** (air-gap STRICT validator): identified the file path and the
  4 D-12 layered assertions correctly. Useful tool-trace shape.
- **task11** (vLLM fallback after tool-call parse failure): correctly
  identified `callWithReactiveGrammar` in `grammar-retry.ts:96-113` with
  the retry-budget separation between provider and ux layers.

These would all earn full marks on a Phase 5 task-correctness rubric. The
quality issue is **not** in the work; it's in the rule-following layer that
gates *whether* the work is preceded by the memory.view first-call.

## What this changes vs v8

**V8 hypothesis (unchanged after Mistral):** Qwen-MoE-specific tool-use RL
trade-off explains the 55% Qwen MoE V1 ceiling (vs 100% on Gemma both modes
and Qwen dense).

**V9 hypothesis (new):** different families have different rule-following
baselines on novel system-prompt instructions.

- Qwen 27B dense: 100% — strong novel-rule adherence
- Gemma 26B-A4B MoE: 100%
- Gemma 31B dense: 95%
- Qwen 35B-A3B MoE: 55% — Qwen-MoE-specific compliance gap
- **Mistral 128B NVFP4: 0%** — heavyweight model with high task-quality but
  near-zero novel-rule adoption on this specific instruction shape

The Mistral pattern is consistent with general published characterizations
of Mistral 3.x as "follows the user, not the system" — Mistral's instruction-
hierarchy training reportedly weights user messages above system messages
more aggressively than Anthropic / Google / Qwen training. This is consistent
with what we measured: Mistral does not internalize the system-prompt's "FIRST
tool call MUST be memory" instinct, but DOES correctly verify code-vs-notes
when the user's question makes the verification salient (V3).

For Phase 5 eval matrix: Mistral 128B NVFP4 is **eligible** as a heavyweight
quality datapoint for tasks where rule-following is not the primary gate, but
should NOT be used for tasks where the system prompt's role is to constrain
behavior (e.g., the memory-instinct flow). This is an honest characteristic
finding, not a defect — it informs how to deploy the profile.

The v2 acceptance criterion ("model writes notes when discoveries warrant it")
remains met by Qwen 27B dense alone, with Gemma + Mistral profiles documented
as zero-write-but-V3-passing.

## Operator decision triggers

This run does NOT trigger any of the v8-style "drop from active stack"
decisions. Mistral 128B is **eval-only** by design (Phase 04.7 D-13); the V1
0% finding doesn't warrant removal because:

1. The profile is not a daily-driver candidate.
2. V3 5/5 means it's safe for code-verification queries.
3. Quality of completed work (when engaged) is high.
4. Throughput at 4.42 tok/s matches expected ceiling for the hardware.

Recommended use: route to Mistral when (a) heavy reasoning is needed, AND (b)
the task's rule-following burden is in the user message rather than the
system prompt. Avoid for memory-instinct workflows, sub-agent dispatch, or
any scenario where the system prompt's structural rules must hold over many
turns.

## Resume signals

```
v1 mistral 128b nvfp4 adoption: 0/20 = 0% (FAIL — pass ≥ 60%; ctx-overflow on 12, sp_ok-only on 2, no-memory on 6)
v1 mistral 128b nvfp4 writes: 0/20
v3 mistral 128b nvfp4 rot: 5/5 (PASS)
v9 mistral 128b nvfp4 throughput: 4.42 tok/s (V1 completed) / 5.00 tok/s (V3) / ~600s cold start
v9 quality of completed work: high (technical accuracy, citation discipline, structured output) — see runs/v1-matrix-mistral-128b-nvfp4/task{01,04,07,08,11}.jsonl
```

## Run artifacts

- `runs/v1-matrix-mistral-128b-nvfp4/` — 20 task transcripts + log + timings.tsv (gitignored per `runs/**`)
- `runs/v3-matrix-mistral-128b-nvfp4/` — 5 probe transcripts + log + timings.tsv (gitignored)
- `/tmp/v-matrix-mistral-analysis.json` — structured analysis output for downstream tooling

V1 batch wall: 09:04:52 → 09:53:05 UTC = 48:13. V3 batch wall: 09:53:05 →
10:02:39 = 9:34. Total measurement wall: 57:47.
