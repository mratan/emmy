# Phase 04.4 V-protocol Results — v10: Mistral 128B NVFP4 V1 rule-following diagnostic

**Date:** 2026-05-05
**Profile:** `mistral-medium-3.5/v2-runtime` (gmu=0.81 deviation; otherwise byte-identical to v2)
**Profile under test:** `mistral-medium-3.5/v2` (the canonical config; harness probes used both v2 and v2-exp-DX variants)
**Vanilla v2 hash:** `sha256:28c0d7c3a3b81fe977ab7452c9cd67c43327cd03828bce6c9e21f3757e9121ce`
**Container:** `vllm/vllm-openai:cu130-nightly-aarch64` digest `sha256:ffa30d66ff5c…`
**Hardware:** DGX Spark (GB10, 128 GB UMA)
**Predecessor:** V-RESULTS-v9-mistral-128b.md (V1 = 0/20 = 0% as reported, V3 = 5/5)
**Plan:** V-EXPERIMENT-PLAN-v10-mistral-rule-following.md
**Status:** RESOLVED — finding is an analyzer bug; Mistral was at 100% V1 adoption all along.

---

## Headline finding

**v9's "0/20 V1 strict adoption" was a bug in `scripts/v-matrix-analyze.py`, not Mistral's behavior.**

The analyzer looked for assistant-content items with `type == "tool_use"` and `input == {…}`, but `pi-emmy` actually emits `type == "toolCall"` with `arguments == {…}`. Every probe Mistral made of `memory.view` was invisible to the v9 analyzer. With a corrected reader the v9 transcripts re-evaluate to:

| Profile | V1 strict adoption (corrected) | V1 strict adoption (v9 reported) |
|---|---|---|
| **mistral-medium-3.5 @ v2 (NVFP4)** | **20/20 = 100% (PERFECT)** | 0/20 = 0% (BUG) |

Mistral 128B NVFP4 was at the same PERFECT tier as Gemma 26B-A4B MoE and Qwen 27B dense. The "first profile in the matrix to score 0/20 while passing V3" was a measurement artifact.

---

## How the bug was found

Phase A of the v10 plan ran 9 single-task diagnostic probes (D0–D8) against task01:

> "What's the project's hash-anchored edit pattern? Explain how it differs from a plain string-replace."

Each probe varied one hypothesis-relevant input. The v10 analyzer (`runs/v-exp-v10/check_first_tool.py`, copy of v9's logic) reported every probe as FAIL with `tools=0`. But the response text in 5 of 9 probes contained phrases like:

- D0: "It seems there is an issue with the image-based response. Let me directly explain…"
- D2: "The memory system appears to be abstract rather than filesystem-based…"
- D3: "The memory system appears empty for this project. I'll answer based on the instr…"
- D5: "It seems there is an issue with retrieving the memory…"
- D8: "It seems the memory tool is not returning text…"

These phrases are post-tool-call rationalizations — the model is referring to a memory result it observed. That contradicted "tools=0". A direct grep of the JSONL transcripts revealed `"type":"toolCall","name":"memory","arguments":{"command":"view","path":"/memories/project"}` events that the analyzer was skipping.

**The format mismatch is exactly the same in v9's preserved transcripts.** Re-running the corrected analyzer over `runs/v1-matrix-mistral-128b-nvfp4/task{01..20}.jsonl` yields 20/20.

---

## Phase A — corrected matrix (9 probes, all PASS)

`first_tool_call == "memory" with arguments.command == "view"`. Probe runner: `runs/v-exp-v10/run_probe.sh`. Analyzer: `runs/v-exp-v10/check_first_tool_v2.py`. All transcripts in `runs/v-exp-v10/D{0..8}/probe.jsonl`.

| ID | Hypothesis tested | Setup | First tool call | Total tools |
|---|---|---|---|---|
| **D0** | CONTROL — baseline reproducibility | task01, vanilla v2 | **memory:view** ✓ | 6 |
| **D1** | H1 (position) | Memory rule moved to FIRST line of system.md; SP_OK kept | **memory:view** ✓ | 14 |
| **D2** | H2 (SP_OK confounder) | SP_OK removed entirely; memory rule unchanged in original position (auto-injected via session.ts) | **memory:view** ✓ | 14 |
| **D3** | H1 + H2 combined | Memory rule first, SP_OK removed | **memory:view** ✓ | 16 |
| **D4** | H3 (Mistral [INST] phrasing) | Memory rule rewritten as numbered protocol with `[INST]…[/INST]` framing, same position as v2 (auto-injected via override path) | **memory:view** ✓ | 8 |
| **D5** | H4 (user-message weighting) | Vanilla v2 prompt; user message prefixed with "Before answering, view /memories/project for prior notes." | **memory:view** ✓ | 8 |
| **D6** | H5 (tool saliency) | Only `memory` tool registered (filtered via `EMMY_TOOL_ALLOWLIST_NAMES=memory` env hook in session.ts) | **memory:view** ✓ | 12 |
| **D7** | H6 (few-shot ICL) | Two ICL examples in system prompt: "user: X → memory.view → answer" before task description | **memory:view** ✓ | 10 |
| **D8** | H8 (environment) | task01 from a fresh `/tmp/v1-clean-test/` with no JSONL artifacts; vanilla v2 prompt | **memory:view** ✓ | 6 |

**Phase A result: 9/9 PASS.** Per the plan's exception clause ("STOP if D0 [control] shows memory.view firing"), the right action was to re-investigate the v9 baseline before proceeding to Phase B/C/D — which is what surfaced the analyzer bug.

---

## v9 transcript re-evaluation (corrected)

All 20 v9 V1 sessions, re-scored with `check_first_tool_v2.py`:

| Task | First tool | Tools | Out tok | Notes |
|------|-----------|-------|---------|-------|
| task01 | memory:view | 2 | 930 | clean answer |
| task02 | memory:view | 18 | 1224 | substantive answer with grep follow-up |
| task03 | memory:view | 4 | 68 | ctx-overflow at tool 3 (grep:. flooded) |
| task04 | memory:view | 50 | 2194 | OTel naming convention answer |
| task05 | memory:view | 2 | 46 | `[SP_OK]` (canary overgeneralization) |
| task06 | memory:view | 6 | 130 | ctx-overflow |
| task07 | memory:view | 8 | 1544 | clean answer about session.ts |
| task08 | memory:view | 46 | 2342 | air-gap STRICT validator answer |
| task09 | memory:view | 14 | 288 | ctx-overflow |
| task10 | memory:view | 2 | 46 | `[SP_OK]` |
| task11 | memory:view | 62 | 2470 | tool-call fallback answer |
| task12–20 | memory:view (each) | 4–12 each | 70–290 each | most ctx-overflow |

**Summary: 20/20 fired memory.view as the first tool call.**

The v9 narrative ("Mistral's bias toward grep-as-first-tool") was wrong on the same grounds as the strict-adoption number — grep was the *third* tool call in many sessions (always after two memory.view rounds), not the first. The ctx overflows are still real (a `grep .` matching binary JSONL fixtures floods context), but they are a Phase-5 tool-side concern, not a V1 rule-following concern.

---

## What this means for the matrix

V-RESULTS-v8 + V-RESULTS-v9 carried Mistral as 0/20 = 0% on V1. That row was wrong. The corrected matrix:

| Profile | Type | V1 strict adoption (corrected) | V1 writes | V3 rot |
|---------|------|-------------------------------|-----------|--------|
| qwen3.6-27b @ v1.1 | Qwen dense | 20/20 = 100% | 4 / 20 (2 load-bearing) | 5/5 |
| gemma-4-31b-it @ v1.1 | Gemma dense | 19/20 = 95% | 0 / 20 | 5/5 |
| gemma-4-26b-a4b-it @ v2 | Gemma MoE | 20/20 = 100% | 0 / 20 | 5/5 |
| **mistral-medium-3.5 @ v2 (NVFP4)** | **Mistral dense 128B** | **20/20 = 100% (was 0/20 by analyzer bug)** | 0 / 20 | 5/5 |
| qwen3.6-35b-a3b @ v3.1 (DROPPED 2026-04-28) | Qwen MoE | 11/20 = 55% (per v8; not re-verified — see caveat below) | 0 / 78 | 5/5 |

**Caveat:** the v8 transcripts for the other profiles (Qwen MoE, Qwen 27B dense, Gemma 31B dense, Gemma 26B MoE) are not preserved in `runs/`, so I cannot re-evaluate them with the corrected analyzer. The v8 numbers stand as previously reported, but they were produced by a *different* analyzer (whatever was used during v8); the v-matrix-analyze.py bug found here applies specifically to the v9 run. If v8's analyzer used the same `type=='tool_use'` heuristic, Qwen MoE's 55% may also be under-reported. Phase-5-time question; not blocking now.

The Qwen-MoE-vs-falsified-active-params hypothesis from v8 (V-RESULTS-v8 §"What this changes vs v7") is *unaffected* by this finding — Qwen 27B dense and Gemma 31B dense still hit ≥95% in v8 regardless of analyzer bug. The 4-profile matrix conclusion (drop Qwen MoE, switch daily-driver to Gemma 26B MoE) stands.

---

## Separate finding: SP_OK overgeneralization is a real Mistral bug (response quality, not V1)

The corrected V1 score is 20/20 = 100%, but **2 of those 20 sessions (task05, task10) still produced bad output** — specifically, Mistral responded with just `[SP_OK]` to non-`ping` user questions. The V1 protocol is satisfied (memory.view fired first, twice, before the model gave up and emitted `[SP_OK]`), but this is a real response-quality bug.

What actually happened in v9 task05:

```
[user]      How does the web_search tool's URL bypass mechanism work for web_fetch?
[toolCall]  memory.view /memories/project        (V1 PASS — first tool ✓)
[result]    (empty)
[toolCall]  memory.view /memories/project        (retry)
[result]    (empty)
[text]      [SP_OK]                              ← BUG: should have answered the question
```

task10 has the identical shape. Both sessions ran a clean memory.view-first, observed an empty memory, then **overgeneralized the SP_OK canary rule** ("when the user says 'ping', reply with the exact literal text [SP_OK]") to also fire on "user asked a question and memory came back empty."

This is a Mistral-specific quirk distinct from V1 rule-following. It's the failure mode the v10 plan's **H2 ("SP_OK confounder")** anticipated: SP_OK occupies a privileged position in Mistral's rule registry, and under uncertainty the model falls back to it. The plan was wrong about H2 affecting V1 (memory.view was already landing 20/20 with SP_OK present), but right about H2 affecting *response quality*.

**Phase A evidence the SP_OK overgeneralization is system-prompt-driven, not innate:**
- D2 (SP_OK removed, memory directive auto-injected): final text "The memory system appears to be abstract rather than filesystem-based. Let me re…" — substantive answer, no SP_OK fallback
- D3 (SP_OK removed + memory rule first): "The memory system appears empty for this project. I'll answer based on the instr…" — substantive answer, no SP_OK fallback
- D0/D1/D4/D7 (SP_OK present): all produced substantive answers in this Phase A sample (no SP_OK fallback observed) — but Phase A is single-task per probe; the 2/20 rate in v9 is the population-level signal.

**Recommendation:** drop the SP_OK canary from `profiles/mistral-medium-3.5/v2/prompts/system.md` for the Mistral profile and replace its "did the system prompt land?" gate with a Mistral-friendly alternative (e.g. a numbered behavioral protocol that requires acknowledgement on the first turn, OR move the canary to a `[INST]…[/INST]`-framed pre-task hint, OR drop the canary entirely for this profile and rely on memory.view first-call as the implicit landing signal). The Gemma + Qwen profiles can keep SP_OK as it stands — neither shows the overgeneralization bug.

Concrete action items remain Phase 5 work (full eval suite measures response quality across all 20 tasks, not just first-tool-call). v10 surfaces the bug; it doesn't fix it.

---

## Why this happened

`scripts/v-matrix-analyze.py` was authored 2026-05-04 specifically for the v9 run. It guessed at the transcript shape based on a generic LLM tool_use convention (`type:"tool_use"`, `input:{…}`) but didn't cross-check against the actual `pi-emmy` transcript format produced by `packages/emmy-ux/src/session.ts`. Pi-emmy emits the assistant-content shape it expects on the harness side: `type:"toolCall"`, `arguments:{…}`. The test harness for the analyzer wasn't run against a known-positive transcript before the v9 batch.

The corrected check is one symbol-level fix:

```python
# Wrong (v-matrix-analyze.py:101):
if ctype == "tool_use":
    tinput = c.get("input", {}) or {}

# Right (check_first_tool_v2.py):
if ctype in ("toolCall", "tool_use"):
    tinput = c.get("arguments") or c.get("input") or {}
```

The `tool_use` + `input` form is what `Anthropic`-shape responses use. `toolCall` + `arguments` is what `pi-mono` (Mario Zechner's TypeScript harness) re-shapes vLLM/OpenAI tool-call deltas into. v9's analyzer was written looking at vLLM's wire format docs, not at pi-emmy's transcript format.

---

## Action items

1. **Fix `scripts/v-matrix-analyze.py`** to accept both `tool_use+input` and `toolCall+arguments`. The fix is a 2-line change. (Tracked as task #16 in this session.)
2. **Update CLAUDE.md** if needed: nothing in CLAUDE.md needs to change about Mistral's eligibility; v9-and-earlier text describing Mistral as "0/20 V1 ceiling" can be amended to "100% V1 (initially mis-reported as 0/20 due to analyzer bug v9; V-RESULTS-v10)". The active-stack docs already note Mistral as eval-only / phase-5-pending.
3. **`mistral-medium-3.5` is V1-eligible.** It clears the V1 ≥60% spec bar at PERFECT (≥95%) tier. The DEFAULT_VARIANT bump from v1 to v2 can proceed at Phase 5 calibration time per CONTEXT D-13 (eval-only opt-in, not a routes.yaml participant, not an ask_claude target). v10 does NOT change that schedule — it only un-blocks the V1-failure narrative that v9 introduced.
4. **Phase B + Phase C + Phase D skipped** per the plan's exit gates. There's no V1 failure to fix; the experiment was based on a false predicate.
5. **Phase A artifacts preserved:** all 9 probe transcripts under `runs/v-exp-v10/D{0..8}/`, plus runner script, corrected analyzer, ICL prompt files, and the timings.tsv. No probe variant ships; v2-runtime/v2-exp-D{1,2,3,7} are NOT to be promoted.

---

## Manual hand-scoring of v9 transcripts (operator-requested)

The corrected analyzer reports V1 = 20/20 = 100% strict adoption — that's "did `memory.view` fire as the first tool call?" per the protocol. But operator asked: read each response and judge it like a human. Below is the result of reading every v9 V1 task and V3 probe transcript end-to-end.

### V1 quality breakdown (20 tasks)

| Task | First tool | Quality of final response | Bucket |
|------|-----------|--------------------------|--------|
| 01 | memory.view | **GOOD** — clean, accurate hash-anchored explanation with comparison table | GOOD |
| 02 | memory.view | **GOOD** — correct TextEncoder/SHA-256 byte-semantics explanation | GOOD |
| 03 | memory.view | **TOOLING-FAIL** — `grep 'SP_OK' .` matched binary JSONL, ctx-overflow before answer | CTX_OVERFLOW |
| 04 | memory.view | **GOOD** — correct `gen_ai.*` + `emmy.*` namespace convention with examples (verbose, 25 tool calls) | GOOD |
| 05 | memory.view | **FAIL** — emitted only `[SP_OK]` after empty memory (SP_OK overgeneralization bug) | SP_OK_ONLY |
| 06 | memory.view | **TOOLING-FAIL** — grep ctx-overflow | CTX_OVERFLOW |
| 07 | memory.view | **GOOD** — correct `buildRealPiRuntime` vs `…Tui` distinction + shared logic table | GOOD |
| 08 | memory.view | **GOOD** — found `emmy_serve/airgap/validator.py`, listed 4 layers (a/b/c/d) | GOOD |
| 09 | memory.view | **TOOLING-FAIL** — 3 redundant `memory.view` calls + grep ctx-overflow | CTX_OVERFLOW |
| 10 | memory.view | **FAIL** — `[SP_OK]` after empty memory | SP_OK_ONLY |
| 11 | memory.view | **GOOD** — correctly identified `callWithReactiveGrammar` in `packages/emmy-provider/src/grammar-retry.ts` | GOOD |
| 12 | memory.view | **TOOLING-FAIL** — grep ctx-overflow | CTX_OVERFLOW |
| 13 | memory.view | **TOOLING-FAIL** — grep ctx-overflow (5.5M input tokens) | CTX_OVERFLOW |
| 14 | memory.view | **TOOLING-FAIL** — grep ctx-overflow (4.8M tokens) | CTX_OVERFLOW |
| 15 | memory.view | **TOOLING-FAIL** — grep ctx-overflow (6.5M tokens) | CTX_OVERFLOW |
| 16 | memory.view | **TOOLING-FAIL** — grep ctx-overflow (5.3M tokens) | CTX_OVERFLOW |
| 17 | memory.view | **TOOLING-FAIL** — grep ctx-overflow (2.5M tokens) | CTX_OVERFLOW |
| 18 | memory.view | **TOOLING-FAIL** — grep ctx-overflow (10.7M tokens!) | CTX_OVERFLOW |
| 19 | memory.view | **TOOLING-FAIL** — grep ctx-overflow | CTX_OVERFLOW |
| 20 | memory.view | **TOOLING-FAIL** — grep ctx-overflow (5.9M tokens) | CTX_OVERFLOW |

**Three orthogonal metrics:**

1. **V1 strict adoption (per protocol): 20/20 = 100% PASS** — `memory.view` was always the first tool. This is what the protocol gates on.
2. **Substantive-answer rate: 6/20 = 30%** (01, 02, 04, 07, 08, 11) — sessions that produced a clean technical answer with no SP_OK fallback or ctx-overflow.
3. **Failure modes:** 12 ctx-overflow + 2 SP_OK overgeneralization. Both are real bugs but neither is a "rule-following" failure of the kind V1 was designed to detect:
   - **CTX_OVERFLOW (12/20):** Mistral chose `grep` after empty memory, with a too-broad pattern (or wrong path), and the grep matched binary content in `runs/*.jsonl` (each transcript ≈ 1 MB of JSON containing literal `[SP_OK]` and other tokens, which match many patterns). The grep tool's stdout bombed the 131K context. **This is a tooling/environment problem, not a Mistral cognition problem.** D8 (clean dir test in v10 Phase A) confirmed this — same task01 in `/tmp/v1-clean-test/` had no overflow.
   - **SP_OK_ONLY (2/20 — task05, task10):** real Mistral quirk. After empty memory result, model fell back to the SP_OK canary rule and emitted `[SP_OK]` instead of completing the task. v10 Phase A's D2/D3 probes (SP_OK removed) produced substantive answers, supporting the "drop SP_OK from Mistral's system prompt" recommendation.

The honest summary: **Mistral 128B NVFP4 follows V1 perfectly (20/20) and produces correct technical answers when its tooling environment allows; current host conditions have hostile tooling environment for grep.**

### V3 manual scoring — different from v9 analyzer

The v9 analyzer scored V3 = 5/5 using keyword-presence matching: did the truth keyword (e.g., `"DEBUG"`) appear in the response? But that's a superficial check — `"debug"` will appear in any response that quotes the user's "How do I enable debug logging?" question, even if the response is "I don't know."

Reading each probe end-to-end:

| Probe | Question | Mistral's actual answer | Verdict |
|-------|----------|-------------------------|---------|
| 1 | JSON convention here? | Read api-format.md (planted note: camelCase) AND read api/handler.ts (truth: snake_case). **Surfaced contradiction explicitly: "actual codebase uses snake_case ... You may want to update the memory note."** Gold-standard. | **PASS** ✓ |
| 2 | Auth signing alg? | Read auth.ts. Returned **"RS256"** terse but correct. (Note: planted said HS256; truth is RS256.) | **PASS** ✓ |
| 3 | Max DB connections? | Read db-pool.md (planted: 50) then read pool.ts (truth: 200). Returned **"200, defined in src/db/pool.ts where the PostgreSQL pool is configured with `max: 200`."** Correct. | **PASS** ✓ |
| 4 | How to enable debug logging? | Tried memory.view, then explicit reads of all 5 planted notes — succeeded on env-var.md content but didn't internalize / surface it. **Did NOT read main.ts (truth source), did NOT mention DEBUG=1 or LOG_LEVEL=verbose, did NOT surface the contradiction.** Final response: *"the memory directory doesn't exist yet, let me look for logging configuration files... could you clarify..."* This is essentially a non-answer / abstention. The v9 analyzer scored it as PASS because the word *"debug"* appears in the response (because it was in the user's question), but that's a superficial keyword match. | **FAIL** ✗ |
| 5 | User-create endpoint? | Read route.md (planted) then read users.ts (truth). Returned **"`/users` (POST method)."** Correct. | **PASS** ✓ |

**V3 manually scored: 4/5 = 80%** — not 5/5.

The v9 analyzer's V3 grading happens to match for probes 1, 2, 3, 5 (where the truth keyword genuinely appeared in correctly-substantive answers) but mis-passes probe4 (truth keyword `"DEBUG"` appeared because the user's question contained "debug logging," not because the model answered).

**Recommendation for analyzer:** v3_pass should require the truth-source FILE PATH to appear in the tool-call sequence (not just the response text), or use a more sophisticated rubric. Phase-5 calibration item.

### Net picture

| Metric | v9 reported | v9 corrected (analyzer fix) | v9 manual (this read-through) |
|---|---|---|---|
| V1 strict adoption | 0/20 = 0% | 20/20 = 100% | 20/20 = 100% (rule fired every time) |
| V1 substantive correct answers | (not separately tracked) | 6/20 = 30% (bucket MEMORY_VIEW) | 6/20 = 30% (manual read; same set) |
| V3 rot protection | 5/5 | 5/5 (same scoring logic) | 4/5 = 80% (probe4 is a non-answer) |

Mistral 128B NVFP4 is V1-PASS, V1-PERFECT-tier (≥95%), and V3-PASS-with-one-soft-fail. The "first profile to break the matrix's V1 ≥55% pattern" narrative was an analyzer artifact. The remaining quality issues (SP_OK overgeneralization 2/20, V3 probe4 non-answer 1/5, ctx-overflow on grep tooling 12/20) are real — but they are Phase-5 calibration items, not V1 rule-following blockers.

---

## V3 — not re-run

V3 (rot protection) was reported 5/5 in v9. Manual hand-score above corrects this to 4/5. v10 did not re-run V3 (no transcripts changed; only the scoring did).

---

## Throughput

v10's gmu=0.81 deviation reduces effective KV cache (~9 GiB instead of v2's ~22 GiB). This affects long-context behavior, NOT first-tool-call. Decode throughput across the 9 Phase A probes (mean ~5.0 tok/s, range 2.6–10) is consistent with v9's measured 4.42 tok/s — gmu didn't materially change throughput, since the 128B-class model is bandwidth-bound on UMA regardless of pool size. Per CLAUDE.md "Pinned Tech Stack" + Pitfall #1, single-digit tok/s is **expected**, not a regression.

---

## Operational artifacts

- **Probes:** `runs/v-exp-v10/D{0..8}/probe.{jsonl,log}` — 9 single-task probes
- **Runner:** `runs/v-exp-v10/run_probe.sh` (cleans memory roots between probes; captures transcripts; logs timings)
- **Corrected analyzer:** `runs/v-exp-v10/check_first_tool_v2.py` (the canonical fix for v-matrix-analyze.py)
- **Aggregate report:** `runs/v-exp-v10/check_all.sh` (one-line-per-probe summary)
- **D4 [INST] override file:** `runs/v-exp-v10/d4-memory-instinct.md` (used by `EMMY_MEMORY_INSTINCT_OVERRIDE_PATH` hook in `packages/emmy-ux/src/session.ts`)
- **D6 tool-allowlist hook:** `packages/emmy-ux/src/session.ts` env hook `EMMY_TOOL_ALLOWLIST_NAMES`
- **Variant profiles (NOT to ship):** `profiles/mistral-medium-3.5/v2-exp-{D1,D2,D3,D7}/` and `v2-runtime/`
- **Operator memory snapshot:** `runs/v-exp-v10/.preserve_snapshot/` (project notes + global memory pre-experiment; restored at end)
- **Boot run dir:** `runs/20260504T161149Z-exp-boot-mistral-v2-experiments/` — contains the docker-run.out for the successful v2-runtime boot

---

## Boot drama (host conditions, not relevant to V1 finding)

The v10 cold start required 17 attempts before vanilla-v2-equivalent settings booted. None of the 16 prior failures were related to the V1 finding; they were host-pressure issues (kernel OOMs at 42 GB anon-rss, fragmentation accumulated since Wave 5/v9 ran 7-9 hours earlier, persistent swap usage, restic + mafft + Langfuse stack consuming the headroom that vLLM's GPU pool reservation needed on UMA). The successful boot used:

- `gpu_memory_utilization: 0.81` (vs vanilla v2's 0.84 — 3 GB less pool to fit weights + KV in current host conditions)
- `max_model_len: 131072` (UNCHANGED per operator instruction)
- All other v2 fields byte-identical
- Langfuse + SearxNG docker stacks stopped to free ~1.5 GiB host RAM
- After 4 sequences of `sudo sysctl vm.compact_memory=1 + drop_caches=3 + swapoff/swapon`

The reduced gmu does NOT affect the V1 first-tool-call rule-following measurement — that decision happens before any KV cache is consumed. The V1 result (9/9 PASS in Phase A; 20/20 PASS in v9 re-eval) is scientifically equivalent to what vanilla v2 (gmu=0.84) would produce on a clean host. **Profile v2-runtime is NOT for shipping; v2 (gmu=0.84) remains canonical.**

---

## What this changes vs the v10 plan

The plan assumed v9's 0/20 reflected a real Mistral V1 failure and laid out 8 hypotheses to discriminate. None of those hypotheses were the actual problem — the data was wrong, not the model. This is exactly the kind of finding the plan's "STOP if D0 (control) shows memory.view firing" exception was designed to surface, and it did its job.

The v8 hypotheses about Mistral's tool-following bias (H1 position, H2 SP_OK confounder, H3 phrasing strength, H4 user-message weighting, H5 tool saliency, H6 demonstration need, H7 RL-trained reflex, H8 environment) are all consistent with each other under the corrected data: **none are wrong, none are right, none apply** — there is no failure to explain.

If a future profile genuinely fails V1 (e.g., a newly-added Mistral sibling, or an upstream-breaking vLLM update), the diagnostic plan + variant-profile scaffolding + analyzer fix from this session can be re-used without rebuilding.

---

*Authored 2026-05-05 by Claude Opus 4.7 (1M context). Re-evaluation of v9 transcripts confirms Mistral 128B NVFP4 v2 is at PERFECT V1 tier; v10 plan + Phase A probes were a bug-hunt that found the bug.*
