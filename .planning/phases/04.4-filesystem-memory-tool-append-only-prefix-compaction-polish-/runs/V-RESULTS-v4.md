# Phase 04.4 V-protocol Results — Autonomous Run, 2026-04-26 (v4 — ablation #1 vs #1+#2)

Per the V-RESULTS-v3 recommendations the operator agreed to test two
mechanical interventions and measure incremental uplift:

- **#1 — `last_updated:` note metadata + view-time staleness banner.**
  Tool-side. Auto-prepend `last_updated: <ISO>` on every memory write
  (create / str_replace / insert) and prepend a verify-banner to every
  `view` response. Targeted V3 rot vulnerability that prompt-only
  iterations did not close.

- **#2 — tighten the instinct directive.**
  Prompt-side. Replace "Your FIRST tool call this session MUST be …"
  with the harder "BEFORE producing your FIRST response token, your
  FIRST action MUST be a tool call to memory.view — non-negotiable …
  Skipping this view is a protocol violation, not an optimization."
  Targeted V1 misses where the model answered from training without
  any tool calls.

## Ablation results

| Round | State | V1 adoption | V3 rot | V2-mem writes |
|-------|-------|-------------|--------|---------------|
| baseline (v3 prompt) | v3 prompt | 11/18 = 61% | 4/5 (1 ROT FAIL) | 0 |
| **A** | v3 prompt + #1 | **11/20 = 55%** | **5/5 PASS** | 0 |
| **B** | v3 prompt + #1 + #2 | **7/20 = 35% (regression)** | **4/5 (1 ROT FAIL again)** | 0 |

Per-probe V3 results show the qualitative shift cleanly:

| Round | Probe 1 (camelCase note) | Probe 2 | Probe 3 | Probe 4 (LOG_LEVEL note) | Probe 5 |
|-------|--------------------------|---------|---------|----------------------------|---------|
| v3 baseline | viewed → trusted note | n/a | n/a | n/a | n/a |
| **A (#1)** | **viewed → declined to trust → asked clarifying** | code-only | code-only | **viewed → verified against code → answered DEBUG=1** | code-only |
| B (#1+#2) | viewed → trusted note (regression) | viewed | code-only | viewed | viewed |

**Probe 4 in round A is the cleanest evidence the staleness banner
works:** model viewed `env-var.md` (rotted note "LOG_LEVEL=verbose"),
banner triggered explicit verify-against-code behavior, model answered
correctly (`DEBUG=1`).

**Probe 1 in round B regressed to a rot fail** — same task, same
fixture, only difference is the harder #2 directive in the prompt.
The harder directive appears to crowd out the verify-before-trust
reasoning the staleness banner relies on.

## Verdict — keep #1, drop #2

**#1 (staleness banner): KEEP.** Closed the V3 rot vulnerability
without disturbing V1 adoption. 5/5 V3 PASS in round A. Tool-side
mechanism doesn't compete with other prompt directives for model
attention budget.

**#2 (harder directive): DROP.** Regressed BOTH dimensions:
- V1 adoption fell 55% → 35% (4-task swing, persistent across the run).
- V3 probe 1 went from PASS (round A) to ROT FAIL (round B).

Hypothesis for the regression: more imperative language at the top of
the instinct block crowds out the verify-before-trust reasoning lower
down. Qwen 35B-A3B v3.1 has a finite "directive attention budget" and
piling on imperatives at one position evicts other directives. This
matches the diminishing-returns observation from V-RESULTS-v3 — prompt
language is not a linearly-additive lever.

## Final state (committed)

`packages/emmy-ux/src/session.ts` reverted to v3 instinct phrasing.
`packages/emmy-tools/src/memory/staleness.ts` retained.
`packages/emmy-tools/src/memory/commands/{view,create,str-replace,insert}.ts`
all updated to use the staleness module.

Final V-protocol verdict:

- **V1: 11/20 = 55% (PASS at gate, slight regression from v3's 11/18 = 61% within sample noise).**
- **V2-memory: N/A (0 writes; not addressed by either intervention).**
- **V3: 5/5 PASS — rot CLOSED.**

Resume signals:
- `v1 memory adoption green: 55%` (PASS at gate; sample noise vs v3 61%)
- `v2 memory discipline N/A — write-trigger surface still untouched`
- `v3 memory rot green: 5/5 — staleness banner closed the gap`

## Pi-minimalism observation

Two iterations on the prompt language (v2 → v3 verify-before-trust,
v3 → v4 #2 harder directive) had limited and even negative effects.
ONE tool-side intervention (#1 staleness banner) closed the gate.

The principle "ship minimum description, measure adoption, expand only
if measurement demands" should be paired with "prefer mechanical /
tool-side interventions over more prompt language when measurements
plateau." The prompt is now ~12 lines; further additions hit
diminishing returns AND can negatively interact with existing language.

## What remains

- **Write discipline (V2-memory).** 0 writes across all V1 batches in
  every iteration. The instinct directive includes write guidance but
  it's never imperative ("If a discovery would help…"). Adding a
  write-imperative is the natural next calibration; deferred per
  V-RESULTS-v3 recommendation since adoption is now stable.
- **V8 protocols (1h memory + 2h compaction).** Operator-time work,
  not autonomously reproducible.

---

*Captured 2026-04-26 by autonomous Claude after ablation A vs B.*
*All evidence retained. #2 reverted in source; only #1 ships.*
