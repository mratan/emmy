# Parallel-Execution Runbook — Phases 04.4 and 04.5

**Audience:** post-`/clear` Claude (you, with no memory of the prior session). This file IS your full instruction set. Read top-to-bottom before doing anything else; it's self-contained.

**Purpose:** execute Phase 04.4 (memory tool + compaction polish) and Phase 04.5 (observable sub-agent dispatch) **in parallel** via two GSD workspaces, then merge each branch back to `main` on completion. The phases are code-independent (verified during planning); they overlap only on a small set of files that merge cleanly because the additions land at different positions in those files.

**Author and date:** previous-session Claude (same model, with full context). 2026-04-26.

---

## 1 — Pre-flight checklist (RUN VERBATIM)

Run these commands first, in this order. If any fail, **stop** and surface the failure to the user; do not proceed.

```bash
# 1.1 — Confirm we're at the project root and on main with a clean tree
cd /data/projects/emmy
git status --short
git branch --show-current   # MUST be 'main'

# 1.2 — Confirm both phases are planned and ready
ls .planning/phases/04.4-filesystem-memory-tool-append-only-prefix-compaction-polish-/*-PLAN.md | wc -l   # MUST print 9
ls .planning/phases/04.5-observable-sub-agent-dispatch-v1-inserted/*-PLAN.md | wc -l                       # MUST print 7

# 1.3 — Confirm vLLM is up (Phase 04.5's V8 in plan 04.5-07 needs real Qwen)
curl -s http://127.0.0.1:8003/status | python3 -c "import sys, json; d=json.load(sys.stdin); print('vllm_up:', d['vllm_up'], 'profile:', d.get('profile_id'), 'variant:', d.get('profile_variant'))"
# Expected: vllm_up: True profile: qwen3.6-35b-a3b variant: v3.1
# If vllm_up: False, run:
#   curl -sN -X POST http://127.0.0.1:8003/start -H 'content-type: application/json' \
#     -d '{"profile_id":"qwen3.6-35b-a3b","variant":"v3.1"}' > /tmp/vllm-start.log 2>&1 &
# Then poll /status every 5s until vllm_up: True (cold start ~110s with warm fastsafetensors cache).

# 1.4 — Confirm GSD agents are accessible
gsd-sdk query agent-skills gsd-executor 2>&1 | head -1   # MUST start with `{`
ls ~/.claude/agents/gsd-executor.md                       # MUST exist

# 1.5 — Bun + node versions (build tooling)
which bun        # MUST resolve, ~/.bun/bin/bun
node --version   # v22+
```

**Working tree must be clean.** If `git status --short` shows untracked files outside `planning/` (the user's scratch dir, expected) or `.planning/`, ask the user before proceeding — they may have in-progress work.

---

## 2 — Workspace setup

**Strategy:** keep Phase 04.4 in the main worktree (current directory `/data/projects/emmy` on branch `main`). Create a new git worktree for Phase 04.5 on a separate branch.

```bash
# 2.1 — Create the 04.5 worktree on a new branch
git worktree add ../emmy-04.5 -b gsd/04.5-subagents

# 2.2 — Verify both worktrees are healthy
git worktree list
# Expected output:
#   /data/projects/emmy           <sha> [main]
#   /data/projects/emmy-04.5      <sha> [gsd/04.5-subagents]

# 2.3 — Bootstrap node_modules in the 04.5 worktree (bun install hoists from root if workspace; safer to just run it)
cd /data/projects/emmy-04.5 && ~/.bun/bin/bun install
cd /data/projects/emmy

# 2.4 — Create a fresh branch for 04.4 work in the main tree (so main itself never gets dirty)
git switch -c gsd/04.4-memory-compaction
```

**Result:**
- Main tree at `/data/projects/emmy/` on branch `gsd/04.4-memory-compaction` — runs Phase 04.4
- Worktree at `/data/projects/emmy-04.5/` on branch `gsd/04.5-subagents` — runs Phase 04.5
- `main` branch is unchanged; both new branches will be merged back via PR/merge after completion

**If `/data/projects/emmy-04.5` already exists** (e.g. user ran this before): `git worktree remove ../emmy-04.5 --force` first, then re-create.

---

## 3 — Parallel execution dispatch (the key step)

**Approach:** spawn two `general-purpose` Agent subagents in **one message** with two tool_use blocks. Each agent runs one phase's `/gsd-execute-phase` via the Skill tool from its assigned worktree. They run concurrently because they're independent agent contexts.

**Why general-purpose and not `gsd-executor`:** the `gsd-executor` agent type runs ONE plan; we need a wrapper that runs the whole `/gsd-execute-phase` skill (which orchestrates many `gsd-executor` invocations across waves). The general-purpose agent has all tools, including `Skill`, so it can drive `/gsd-execute-phase`.

**Agent prompt template (use exactly this shape, parameterized per phase):**

```
You are executing Phase {PHASE} for the Emmy project. The complete planning artifacts are on disk in your assigned worktree.

**Working directory:** {WORKTREE}
**Branch:** {BRANCH}
**Phase number:** {PHASE}
**Plan count:** {PLAN_COUNT}

**Step 1 — Verify your worktree:**
- `cd {WORKTREE}`
- `git branch --show-current` MUST equal `{BRANCH}`
- `ls .planning/phases/{PHASE_DIR}/*-PLAN.md | wc -l` MUST equal `{PLAN_COUNT}`

**Step 2 — Run execute-phase via the Skill tool:**
Invoke `Skill(skill="gsd-execute-phase", args="{PHASE} --auto --no-transition")` from inside `{WORKTREE}`. This runs all plans in waves, with verification, atomic commits, and `gsd-verifier` agent at the end.

The `--no-transition` flag stops the chain after verification (no auto-advance to discuss-phase of next phase).
The `--auto` flag accepts default decisions at iteration gates instead of prompting (you have no human in the loop).

**Step 3 — Capture the result:**
After `gsd-execute-phase` returns, write a structured status file at `{WORKTREE}/.planning/phases/{PHASE_DIR}/{PADDED}-EXEC-STATUS.md` with this exact shape:

```
# Phase {PHASE} — Execution Status

**Date:** {ISO timestamp}
**Branch:** {BRANCH}
**Worktree:** {WORKTREE}
**Final commit:** {git rev-parse HEAD}
**Verification:** {PASSED | FAILED | PARTIAL}

## Plans landed
- {plan-id}: {commit-sha}: {one-line summary}
[...]

## Blockers / Notes
{verbatim from gsd-verifier output, or "none"}

## Operator-gated items still open
{list any checkpoint:human-verify items that are not yet flipped — e.g. plan 04.4-09's V1/V2/V3/V8/compaction-V2/V8 protocols}
```

**Step 4 — Reply to your dispatcher:**
Return a 5-line summary:
- Verdict: PASS | FAIL | PARTIAL
- Plans completed: N/M
- Final commit: <sha>
- Status file: <path>
- Notable: <one-sentence summary or "clean">

**Constraints:**
- Stay strictly inside `{WORKTREE}`. Do NOT touch the other worktree (`{OTHER_WORKTREE}`) under any circumstances.
- Do NOT push to remote. Do NOT create a PR. Do NOT merge.
- Do NOT modify `main` branch directly.
- If `gsd-execute-phase` stalls or asks for input, capture the question in EXEC-STATUS.md and return PARTIAL with the blocking question — do NOT guess at human decisions for non-routine choices.
- Routine iteration gates (plan-checker found warnings, executor caught a flaky test) — proceed with `--auto` defaults.
- Architecture decisions, design changes, scope reduction — STOP and return PARTIAL.

**Resume signals to look for in plan acceptance:**
The plans use `<resume-signal>` markers like `04.4-09-v3-rot-green` or `04.5-07-sc-walkthrough-green`. These flip Done† → Done after operator review. If you see one of these markers in plan acceptance criteria, treat it as "human-verify required" — do not assert it green from autonomous execution.
```

**Concrete two-agent dispatch:**

For Phase 04.4 (in main tree at `/data/projects/emmy`, branch `gsd/04.4-memory-compaction`, 9 plans):

```
{WORKTREE} = /data/projects/emmy
{BRANCH} = gsd/04.4-memory-compaction
{PHASE} = 04.4
{PHASE_DIR} = 04.4-filesystem-memory-tool-append-only-prefix-compaction-polish-
{PADDED} = 04.4
{PLAN_COUNT} = 9
{OTHER_WORKTREE} = /data/projects/emmy-04.5
```

For Phase 04.5 (in worktree at `/data/projects/emmy-04.5`, branch `gsd/04.5-subagents`, 7 plans):

```
{WORKTREE} = /data/projects/emmy-04.5
{BRANCH} = gsd/04.5-subagents
{PHASE} = 04.5
{PHASE_DIR} = 04.5-observable-sub-agent-dispatch-v1-inserted
{PADDED} = 04.5
{PLAN_COUNT} = 7
{OTHER_WORKTREE} = /data/projects/emmy
```

Spawn both with **`subagent_type: "general-purpose"`** in **one Agent tool message** containing two tool_use blocks. They will run concurrently; you'll receive both responses when both complete.

---

## 4 — While the agents run

Don't poll. The Agent tool blocks until both agents return. While waiting:
- The Bash tool may be unavailable (depends on runtime; usually fine for non-side-effecting reads in main session)
- vLLM keeps running on port 8002 — KV cap is 2 concurrent. Plan 04.5-07's V8 hits vLLM; Plan 04.4 plans hit it only via test fixtures (not real Qwen). Realistically both phases combined will not exceed vLLM's cap-of-2 since they execute serially within each phase wave anyway

**If you sense a long delay** (>30 minutes wall-clock with no activity signals): the user can interrupt; you should NOT spawn additional retry agents on top of in-flight ones (compounds the cost).

---

## 5 — Handling the two returns

After both agents return, read each phase's `EXEC-STATUS.md`. Possible combinations:

### 5.1 — Both PASS

Merge both branches back to main. Order: 04.4 first (smaller delta), then 04.5.

```bash
cd /data/projects/emmy
git switch main

# Merge 04.4 (current tree's branch)
git merge --no-ff gsd/04.4-memory-compaction -m "merge: phase 04.4 — filesystem memory tool + compaction polish"
# Expect clean. Conflicts only possible on packages/emmy-tools/src/index.ts and harness.yaml; both are append-style.
# If conflict, both phases edit different top-level keys — accept both with manual merge.

# Merge 04.5 (other worktree's branch)
git merge --no-ff gsd/04.5-subagents -m "merge: phase 04.5 — observable sub-agent dispatch v1"
# Expect resolvable conflicts on:
#   - packages/emmy-tools/src/index.ts (both append re-exports — accept both blocks)
#   - profiles/*/v*/harness.yaml (memory: vs subagents: are sibling keys — accept both)
#   - .planning/STATE.md (both add decisions — combine the decision blocks)
#   - docs/runbook.md (both append sections — accept both)

# Verify final tree
~/.bun/bin/bun test packages/emmy-tools 2>&1 | tail -10
~/.bun/bin/bun run --filter '*' typecheck 2>&1 | tail -10

# Cleanup worktree
git worktree remove ../emmy-04.5 --force
git branch -D gsd/04.4-memory-compaction gsd/04.5-subagents
```

If merge produces conflicts you cannot mechanically resolve (i.e., not the four expected files above), **stop, surface to the user** with the conflict diff. Do NOT force-resolve unfamiliar conflicts.

### 5.2 — One PASS, one PARTIAL

Merge only the PASS phase. Leave the PARTIAL phase's branch + worktree intact for the user to inspect. Report verdict + path to EXEC-STATUS.md of the PARTIAL phase.

### 5.3 — One PASS, one FAIL

Same as 5.2: merge the PASS phase, leave the FAIL phase's branch + worktree intact. Report.

### 5.4 — Both PARTIAL or both FAIL

Do NOT merge anything. Both branches stay isolated. Report both EXEC-STATUS.md files' contents to the user.

### 5.5 — Both FAIL with the same root cause

Look at the failures. If they share a root cause (e.g., a shared dep in `packages/emmy-tools` is broken), surface the common issue to the user instead of deep-diving — the user knows the codebase better than you do post-`/clear`.

---

## 6 — Operator-gated items will remain open

Even on a full PASS, the following human-verify items will NOT be green automatically. They are designed that way (Phase 04.2-06 paperwork-landed-then-operator-gated precedent):

**Phase 04.4-09 closeout-staging plan:**
- Memory V1 — adoption ≥ 60% on Qwen 35B-A3B (20-task hand-rated batch)
- Memory V2 — write discipline ≥ 70% load-bearing (hand-rated)
- Memory V3 — rot protection 100% (5 planted contradicting notes; **CRITICAL** dimension)
- Memory V8 — 1-hour live session organic memory use
- Compaction V2 — summary quality (goal ≥ 80% / decision ≥ 70% / error 100%)
- Compaction V8 — 2-hour live Qwen 3.6 session

**Phase 04.5-07 SC walkthroughs:**
- V8 real-deal Qwen E2E with parent-fires-Agent flow + 4-level OTel trace tree visible in Langfuse

The merge can land with these still pending — the corresponding ROADMAP entries will read `Done†` (paperwork landed, operator walkthroughs pending) as Phase 04.2 did. The user flips them to `Done` later by running the protocols and getting the resume-signal markers (`v1 memory adoption green`, `v3 memory rot green`, etc.) — which is by design, not a defect of your run.

**Do not attempt to autonomously certify any of these.** Report them as open in your final summary.

---

## 7 — Final reporting (your last user-visible message)

Structure the final response as:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PARALLEL EXECUTION COMPLETE — PHASES 04.4 + 04.5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Phase 04.4 — {VERDICT}
- Plans landed: N/9
- Final commit on gsd/04.4-memory-compaction: <sha>
- Notable: <one-line>
- Operator-gated still open: 04.4-09 (memory V1/V2/V3/V8 + compaction V2/V8)

## Phase 04.5 — {VERDICT}
- Plans landed: N/7
- Final commit on gsd/04.5-subagents: <sha>
- Notable: <one-line>
- Operator-gated still open: 04.5-07 V8 SC walkthrough

## Merge result
- {merged both | merged 04.4 only | merged 04.5 only | merged none — see EXEC-STATUS.md files}
- Final main HEAD: <sha>
- Build/typecheck post-merge: {clean | issues — see <path>}

## Worktree cleanup
- {removed | retained because <reason>}

## Next operator action
- Run V1/V2/V3/V8 protocols per 04.4-09-OPERATOR-PROTOCOLS.md (~2 hours)
- Run V8 real-deal Qwen walkthrough per docs/runbook.md § Sub-agents (~30 minutes)
- Check Langfuse for `agent.tool.Agent` + `subagent.research` spans
```

---

## 8 — Things to NOT do

- Do NOT push to remote. The user pushes after reviewing.
- Do NOT create PRs. Same reason.
- Do NOT modify or delete files in `planning/` (the untracked scratch dir — that's the user's, not yours).
- Do NOT touch other phases (Phase 5+ is in flight and out of scope here).
- Do NOT stop vLLM at the end. Leave it for the user; they'll stop it via `curl -X POST http://127.0.0.1:8003/stop` when ready.
- Do NOT spawn the two execution agents serially "to be safe" — that defeats the whole purpose. Two tool_use blocks in one Agent message is the contract.
- Do NOT force-resolve unfamiliar merge conflicts. Stop and ask.
- Do NOT autonomously certify operator-gated V-protocols.

---

## 9 — Key file paths (for reference; you'll discover most via Read/Glob)

**Pre-phase artifacts (locked design contracts; the planners read these):**
- `.planning/pre-phase/04.4-memory-compaction/MEMORY-TOOL-SPEC.md` (memory tool surface, V1–V8)
- `.planning/pre-phase/04.4-memory-compaction/COMPACTION-DESIGN.md` (D-3X invariant, v1 prompt, V1–V8)
- `.planning/pre-phase/04.5-subagents/SPIKE-RESULTS.md` (8/8 PASS + H9 PARTIAL with empirical evidence)
- `.planning/pre-phase/04.5-subagents/INTEGRATION-SKETCH.md` (~50-line SubAgentTool skeleton, persona schema, V1–V8)

**Phase plan dirs:**
- `.planning/phases/04.4-filesystem-memory-tool-append-only-prefix-compaction-polish-/` (9 plans)
- `.planning/phases/04.5-observable-sub-agent-dispatch-v1-inserted/` (7 plans)

**Spike scripts (proof-of-design for 04.5):**
- `packages/emmy-ux/scripts/spikes/04.5-subagents/h{1..9}-*.ts`

**Project conventions (read first):**
- `CLAUDE.md` — pi-minimalism, URL-config precedence, Pitfalls #18 + #22
- `.planning/research/PITFALLS.md` — Pitfall #22 governs Compaction V4 architecture-aware target

**Sidecar / vLLM:**
- Sidecar HTTP API: `http://127.0.0.1:8003/{healthz,status,start,stop,profile/swap}`
- vLLM: `http://127.0.0.1:8002/v1/{models,chat/completions,metrics}` (NOT `8002/openapi.json` — that's the sidecar)

**STATE.md:**
- Project decisions and history. Both phases will append to it. The merge step (5.1) will combine.

---

## 10 — Sanity check before you spawn the agents

Before issuing the two-Agent dispatch in §3:

- [ ] Pre-flight checklist (§1) all green
- [ ] Workspace setup (§2) created the worktree and branched correctly
- [ ] You understand: 2 Agent tool_use blocks in 1 message, run concurrently, both general-purpose subagent_type
- [ ] You understand: each agent invokes `Skill(skill="gsd-execute-phase", args="04.4 --auto --no-transition")` (or `04.5 ...`) from its assigned worktree
- [ ] You understand: do NOT merge until BOTH agents return, and apply §5 logic to the verdict combination

Then dispatch.

---

*Self-contained runbook for cross-session parallel execution of Phases 04.4 and 04.5.*
*Written 2026-04-26 by previous-session Claude with full context.*
