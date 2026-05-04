# V-experiment plan: V1 rule-following diagnostic for Mistral 128B NVFP4

**Status:** PROPOSAL — locked in by operator 2026-05-04. Ready to execute.
**Predecessor:** V-RESULTS-v9-mistral-128b.md (V1 = 0/20 = 0%, V3 = 5/5).
**Goal:** Discriminate between 8 hypotheses for Mistral's V1 failure; either find a profile-level fix (Tier 1) or characterize the model's hard ceiling and ship a harness-level workaround (Tier 2). Use a structured probe→confirm→batch sequence with explicit stop conditions.

---

## Background — what we already measured

V-RESULTS-v9 ran the standard V-protocol against `mistral-medium-3.5/v2` (NVFP4, hash `sha256:28c0d7c3…`) with all task timeouts lifted. Results:

| Metric | Value |
|---|---|
| V1 strict adoption (memory.view as first tool call) | **0/20 = 0%** |
| V1 writes | 0/20 |
| V3 rot protection | 5/5 (CLEAN PASS — gold-standard contradiction-surfacing on probe1) |
| V1 completed-task decode throughput | 4.42 tok/s |
| V3 aggregate decode throughput | 5.00 tok/s |
| Cold start | ~600 s (10 min) |

Mistral 128B NVFP4 is the **first profile in the matrix to score 0/20 on V1 while passing V3 5/5 cleanly**. Every other profile that passed V3 also cleared V1 ≥55%. The divergence is informative: Mistral verifies-before-trusting when probed directly (V3) but doesn't internalize the proactive "FIRST tool call MUST be memory.view" instruction (V1).

### V1 failure-mode breakdown of the 0/20

| Bucket | Count | Behavior |
|---|---|---|
| `MEMORY_VIEW` (rule followed) | 0/20 | — |
| `NO_MEMORY` (responded with full coherent task work, skipped memory) | 6/20 | High-quality answers, just not memory-first |
| `SP_OK_ONLY` (overgeneralized canary rule, replied only `[SP_OK]` to non-`ping` user msg) | 2/20 | task05, task10 |
| `CTX_OVERFLOW` (request errored on input length > 128K) | 12/20 | First tool was `grep`, matched binary JSONL transcripts in `runs/` and `.planning/.../runs/`, prompt ballooned to 1.44M tokens |

Quality of completed work (the 6 `NO_MEMORY` rows) is **high** — accurate citations, clean structure, technical correctness. The issue is specifically pre-task rule-following, not output quality.

---

## Hypotheses (8)

Each predicts a different fix; some are mutually exclusive, some can compound.

| ID | Hypothesis | Evidence | Fix lives in… |
|---|---|---|---|
| **H1** | Position bias — memory rule lives BELOW the tool list; Mistral weights earlier instructions higher. | SP_OK rule (line 1) DID fire (2/20 over-applied); memory rule (line ~25) didn't fire (0/20). | system-prompt reordering |
| **H2** | SP_OK confounder — the SP_OK behavioral rule at the top crowds out the memory rule; without SP_OK, memory rule lands. | 2/20 SP_OK_ONLY suggests SP_OK occupies a privileged position in Mistral's rule registry. | drop SP_OK from system prompt; canary at harness layer |
| **H3** | Phrasing strength — current "MUST … no exceptions" isn't strong enough; Mistral may need numbered protocol or `[INST]` framing. | Other models read same phrasing fine; Mistral may have different prompt sensitivity. | rephrase the rule |
| **H4** | System-vs-user weighting — Mistral fundamentally weights user-message instructions over system-message ones (a published Mistral 3.x characteristic). | Mistral docs note user-priority tuning; consistent with Mistral's "follows user, not system" reputation. | move rule to user message; Tier 1 prompt reorders won't help |
| **H5** | Tool-list saliency — grep/find/bash being in the tool list activates a learned "explore code first" reflex that beats the memory rule. | 12/20 first-tool was grep; this is the trained-in coding-agent default. | restrict tool exposure on turn 1 |
| **H6** | Demonstration need — Mistral needs in-context examples, not directives. ICL beats imperative. | We have no ICL examples in the system prompt; just rules. | few-shot examples in prompt |
| **H7** | RL-trained reflex — Mistral's tool-use RL training built in "for code questions, grep first"; stronger than any prompt restructuring. | Indistinguishable from H4/H5 at the surface; different in what fixes work. | only mechanical enforcement helps |
| **H8** | Codebase-environment artifact — 12/20 ctx-overflow is partly because of THIS codebase's JSONL state, not pure model behavior. | v8's environment had fewer JSONL transcripts. | environmental control; tool-side filter |

H1, H2, H3, H6 are addressable by prompt engineering (Tier 1).
H4, H5, H7 require harness-side changes (Tier 2).
H8 is an environmental control to apply to all experiments.

---

## Threshold definitions

Three confidence tiers for what counts as a "fix":

| Tier | Phase-C V1 result | Interpretation |
|---|---|---|
| **PERFECT** | ≥19/20 (≥95%) | Matches Gemma dense / Gemma MoE / Qwen dense level. Mistral effectively cured. |
| **PASS** | ≥12/20 (≥60%) | Clears V1 spec bar. Profile is V1-eligible going forward. |
| **PROGRESS** | 1-11/20 (>0%, <60%) | Direction is right but doesn't pass spec. |
| **FAIL** | 0/20 | No movement. |

V1 spec pass bar is **≥60%** per `04.4-09-OPERATOR-PROTOCOLS.md` V1.

---

## Phase A — Diagnostic sweep (single-task probes, ~45 min)

Each probe is task01 ("What's the project's hash-anchored edit pattern? Explain how it differs from a plain string-replace.") — chosen because it has clear memory-relevance and reliably produces substantive output. **One variable changed per probe.** Result: did Mistral's first tool call = `memory` with command=`view`?

| ID | Hypothesis tested | Setup |
|---|---|---|
| **D0** | CONTROL — baseline reproducibility | task01 with vanilla v2 prompt (current shipped state) |
| **D1** | H1 alone (position) | Memory rule moved to FIRST line of system.md; SP_OK kept |
| **D2** | H2 alone (SP_OK confounder) | SP_OK removed entirely; memory rule unchanged in its current position |
| **D3** | H1 + H2 combined | Memory rule first, SP_OK removed |
| **D4** | H3 (phrasing strength) | Memory rule rewritten as numbered protocol with Mistral-style `[INST]` framing; same position as v2 |
| **D5** | H4 (user-message weighting) | System prompt unchanged; user message gets prefixed with "Before answering, view /memories/project for prior notes." |
| **D6** | H5 (tool saliency) | System prompt unchanged; only `memory` tool registered for turn 1 (no read/grep/find/bash) |
| **D7** | H6 (few-shot ICL) | Two ICL examples in system prompt: "user: X → memory.view → answer" before task description |
| **D8** | H8 (environment) | task01 from a fresh `/tmp/v1-clean-test/` directory with NO JSONL artifacts; vanilla v2 prompt |

### Phase A stop conditions

```
RUN ALL 9 PROBES regardless of intermediate hits.
  Reason: Phase A is cheap (5 min/probe), each negative result is
  independently informative (rules out a hypothesis). Operator's
  "knock down possibilities one by one" goal needs the full sweep.

EXCEPTION — STOP if D0 (control) shows memory.view firing.
  That would mean the v9 0/20 wasn't reproducible (sampling at temp=0.15
  gave us a misleading first measurement). Re-investigate before continuing.

EXIT GATES at end of Phase A:
  a) ≥1 variant fires memory.view  → proceed to Phase B with the winner
                                      (or top-2 if results are close;
                                       run them in series)
  b) 0 variants fire memory.view   → all of H1-H6 ruled out;
                                      skip Phase B + C; go to Phase D
```

---

## Phase B — 5-task confirmation (~25 min)

Run the Phase-A winner against tasks 1-5 from `v1-tasks.txt`. Filters out task01-specific noise.

### Phase B stop conditions

```
STOP-EARLY:  If first 3 tasks all fire memory.view AND responses are
             substantive (>50 output tokens), promote to Phase C
             immediately. Saves ~10 min.

STOP-FAIL:   If first 3 tasks show ≤1 memory.view fire, the Phase-A
             winner doesn't generalize. Revisit Phase A's #2 or #3
             candidate; if no backup, go to Phase D.

EXIT GATES at end of Phase B:
  a) 4-5 / 5 fire memory.view → proceed to Phase C
  b) ≤3 / 5                    → revert to Phase-A backup variant;
                                  if no backup, go to Phase D
```

---

## Phase C — Full V1 batch (~60 min)

The winning variant gets the full 20-task batch. **No early stop within the batch** — partial wins are misleading because of bucket effects (a few short-task SP_OK_ONLYs can flip a PERFECT into a PASS).

### Phase C exit gates

```
PERFECT  (≥19/20)  → SHIP. Write V-RESULTS-v10. Skip Phase D.
                     The fix is decisive and well-characterized.
PASS     (12-18/20) → SHIP. Write V-RESULTS-v10 noting
                     "passes V1 spec but below Gemma-grade."
                     Skip Phase D.
PROGRESS (1-11/20) → DON'T SHIP yet. Try Phase-A backup variant's
                     full Phase-C batch (operator decision lock-in: YES,
                     run #2 backup).
FAIL     (0/20)    → All of Tier 1 prompt engineering ruled out.
                     Phase D mandatory.
```

---

## Phase D — Mechanical enforcement (~60 min)

Run only if Phase C is PROGRESS-with-no-recovery or FAIL.

Two options (sequential, run both if needed):

- **P5a — Forced first-turn memory.view injection.** Pi-emmy auto-runs `memory.view /memories/project` BEFORE the user's first message reaches the model, then injects the result as a `tool_result` block. Model never has to decide.
- **P5b — Conditional tool exposure.** Only the `memory` tool is registered for turn 1; the full toolset becomes available after `memory.view` fires.

### Phase D exit gates

```
Either approach yields V1=20/20 trivially (memory.view becomes
mechanical) → SHIP with honest framing: "rule-following from
system prompt is not fixable via prompt engineering for Mistral;
profile uses harness-side enforcement."

If Phase D fails (mechanism doesn't actually inject memory.view, or
the model errors after the inject) → that's a code bug, not a model
characteristic. Fix the mechanism and re-run.
```

---

## Total compute budget

| Outcome | Phases run | Total wall |
|---|---|---|
| Phase C PERFECT (≥19/20 first try) | A → B → C | ~2h 10m |
| Phase C PASS (60-95%) | A → B → C | ~2h 10m |
| Phase C PROGRESS (try variant #2) | A → B → C → B' → C' | ~3h 20m |
| All Tier 1 fails → Phase D works | A → D | ~1h 45m |
| Phase C FAIL → Phase D | A → B → C → D | ~3h 10m |

Best case ~2h 10m. Worst case ~3h 20m.

---

## Operator decisions locked in (2026-05-04)

1. **Run all 9 Phase-A probes even if D2 hits.** Learning value > saved 25 min.
2. **In Phase C PROGRESS scenario, run Phase-A backup variant's full Phase-C.** Costs ~85 min more but disambiguates which mechanism actually generalizes.
3. **STOP early at the LATEST Phase-C result that hits PERFECT or PASS.** No need to run subsequent phases once the fix is decisive.

---

## Pitfall #1 considerations

CLAUDE.md Pitfall #1 ("more prompting trap") is the primary risk. Two safeguards in this design:

1. **Each diagnostic tests ONE variable.** No combined experiments in Phase A. Anything that wins in Phase A goes through Phase B confirmation before being promoted.
2. **The full V-protocol is the gate, not partial wins.** A Phase-C V1 batch must hit ≥60% to count as a "fix" by V1's spec. A Phase-A single-task win means nothing on its own. The full 20-task batch is the published-result scale.

The full Phase 5 eval suite (terminal-bench, SWE-bench, etc.) is NOT required for V-protocol declarations — V-protocol is the gate for V1/V3 specifically. But any DOWNSTREAM claim about Mistral's general capability would still need the full eval suite per EVAL-08.

---

## What we'd learn even if every experiment fails

Even if Phase A through D all show 0/20 adoption, the result-set is informative:

- D1 negative + D2 negative + D3 negative + D4 negative → rule structure isn't the bottleneck → H1/H2/H3 ruled out → likely H4/H7 (deep characteristic).
- D5 negative → H4 ruled out → user-anchoring doesn't help → likely H7.
- D6 negative → H5 ruled out (Mistral didn't call memory even when grep was unavailable) → likely H7.
- D7 negative → H6 ruled out → likely H7.

If H7 is left as the only un-falsified hypothesis: **Mistral 128B has a hard-trained reflex that doesn't yield to prompt engineering.** Tier 2 (mechanical) becomes the only option, and Tier 4 (accept and route around) becomes the defensible recommendation.

---

## Operational details

### Where artifacts live

- **Existing V-protocol runner:** `scripts/v-matrix-runner.sh` — sequential V1 (20 tasks) + V3 (5 probes) batch. Reads tasks from `.planning/phases/04.4-…/runs/v1-adoption-v2/v1-tasks.txt`.
- **V3 fixture setup:** `scripts/v3-rot-fixture-setup.sh` — plants `/tmp/v3-rot-test/` with 5 contradicting notes + truth-source code.
- **Analyzer:** `scripts/v-matrix-analyze.py` — parses session transcripts for `memory.view` first-call detection, V3 truth-keyword presence, throughput math.
- **v9 results:** `.planning/phases/04.4-…/runs/V-RESULTS-v9-mistral-128b.md` — full v9 narrative with per-task analysis.
- **v9 raw transcripts (gitignored):** `runs/v1-matrix-mistral-128b-nvfp4/task{01..20}.{jsonl,log}` + `runs/v3-matrix-mistral-128b-nvfp4/probe{1..5}.{jsonl,log}`.

### Profile bundle locations

- **Mistral v2 (current ship):** `profiles/mistral-medium-3.5/v2/` — hash `sha256:28c0d7c3…`. Contains:
  - `serving.yaml` — gmu=0.84, max_model_len=131072, load_format=safetensors, quantization=compressed-tensors, tokenizer_mode=mistral
  - `prompts/system.md` — current shipped system prompt with SP_OK + memory instinct + tool descriptions
  - `airgap_patches/mistral3_safetensors_remap.py` — name-remap patch (load-time fix, don't touch)
- **For Phase A experiments, create sibling directories** under `profiles/mistral-medium-3.5/` with names like `v2-exp-D1`, `v2-exp-D2`, etc. (NOT mutating v2's bytes per profile immutability rule). Recompute hash after each edit.
- **For Phase C confirmation, the winning variant becomes `v2.1` or `v3` (operator decides at promote-to-ship time).**

### Boot procedure

Mistral cannot coexist with Gemma daily-driver (UMA contention). For each experiment:

```bash
# 1. Stop Gemma cleanly
curl -X POST http://127.0.0.1:8003/stop -H "Content-Type: application/json" -d '{}'
sleep 4
docker stop emmy-serve 2>/dev/null
docker rm emmy-serve 2>/dev/null

# 2. Boot Mistral with the experimental profile
RUN_ID="$(date -u +'%Y%m%dT%H%M%SZ')-$(head -c 6 /dev/urandom | xxd -p | head -c 6)"
RUN_DIR="runs/${RUN_ID}-boot-mistral-exp-DX"
mkdir -p "$RUN_DIR"
DOCKER_RUN_ARGS="$(uv run python -m emmy_serve.boot.runner render-docker-args \
  --profile profiles/mistral-medium-3.5/v2-exp-DX --port 8005 --run-dir "$RUN_DIR")"
eval docker run --name emmy-serve-mistral --detach $DOCKER_RUN_ARGS

# 3. Wait for ready
until curl -sS --max-time 2 http://127.0.0.1:8005/v1/models 2>/dev/null | grep -q mistral-medium; do sleep 5; done

# 4. Run the probe
bun packages/emmy-ux/bin/pi-emmy.ts \
  --profile profiles/mistral-medium-3.5/v2-exp-DX \
  --base-url http://127.0.0.1:8005 \
  --print "<task01 prompt>" 2>&1 | tee runs/exp-DX/task01.log

# 5. After all probes for this profile variant, restore Gemma
docker stop emmy-serve-mistral; docker rm emmy-serve-mistral
curl -X POST http://127.0.0.1:8003/start -H "Content-Type: application/json" -d '{"profile_id":"gemma-4-26b-a4b-it","variant":"v2.1"}' &
# (Then wait for Gemma /v1/models, then `systemctl --user restart emmy-sidecar.service`
#  to make sidecar adopt Gemma into state=ready via boot-probe)
```

**Important:** Mistral cold-start is ~10 min. Each Phase A probe variant needs its own boot if the profile bundle changes (system prompt is in `prompts/system.md` which is part of the profile). To minimize cold starts, batch experiments that share a profile variant (e.g., D5 and D6 use the same vanilla v2 prompt, so they can share a single Mistral boot).

### How to detect memory.view first call (auto)

```python
# From scripts/v-matrix-analyze.py
import json
events = [json.loads(l) for l in open(jsonl_path) if l.strip()]
for e in events:
    msg = e.get("message")
    if isinstance(msg, dict) and isinstance(msg.get("content"), list):
        for c in msg["content"]:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "memory":
                cmd = (c.get("input", {}) or {}).get("command")
                if cmd == "view":
                    return True  # memory.view fired
                break  # first tool call wasn't memory.view
        break
return False
```

The analyzer at `scripts/v-matrix-analyze.py` already does this. For per-experiment quick checks, just `grep '"name": "memory"' <task>.jsonl` and inspect the first hit.

### V3 fixture state

`/tmp/v3-rot-test/` was planted during the v9 run and may still exist. To re-plant: `bash scripts/v3-rot-fixture-setup.sh`. The fixture is recreated idempotently each time; safe to re-run.

### Memory state discipline

The runner `scripts/v-matrix-runner.sh` saves operator's `.emmy/notes/` and `~/.emmy/memory/` before V1, runs with clean memory, restores after. **Use this same discipline for Phase A/B/C runs.** Pre-run snapshot lives at `runs/v1-matrix-mistral-128b-nvfp4/_pre_v1_memory_snapshot/` from the v9 run — DO NOT clobber.

---

## State at handoff (2026-05-04)

- **Daily-driver Gemma**: state=ready, vllm_up=true, profile=gemma-4-26b-a4b-it@v2.1, on port 8002. Confirmed via sidecar `/status`.
- **Mistral v2 NVFP4 bundle**: shipped + committed (`ca1fe77`). DEFAULT_VARIANT for `mistral-medium-3.5/` still pointing to v1 (the GGUF audit artifact); operator can flip after Phase 5 readiness, not before.
- **V-protocol scripts**: in `scripts/`, committed.
- **v9 results**: `.planning/phases/04.4-…/runs/V-RESULTS-v9-mistral-128b.md`, committed.
- **This experiment plan**: this file. No code changes yet.
- **v9 transcript artifacts**: in `runs/v1-matrix-mistral-128b-nvfp4/` and `runs/v3-matrix-mistral-128b-nvfp4/` — gitignored per `runs/**` but preserved on disk.

---

## What to do first

When the next session picks this up:

1. Read `V-RESULTS-v9-mistral-128b.md` for context.
2. Read this file for plan + stop conditions.
3. Read `profiles/mistral-medium-3.5/v2/prompts/system.md` to see the current prompt structure (so D1-D7 variants can be written intelligently).
4. Read `04.4-09-OPERATOR-PROTOCOLS.md` V1 + V3 sections for the spec.
5. Stop Gemma. Begin Phase A with D0 (the control). Confirm baseline reproducibility before investing in D1-D8.

If D0 reproduces 0/memory.view, proceed to D1 immediately. If D0 fires memory.view (which would falsify v9), STOP and re-investigate.

---

*Authored 2026-05-04 by Claude Opus 4.7 (1M context) for operator handoff. Self-contained — no prior conversation context required to execute.*
