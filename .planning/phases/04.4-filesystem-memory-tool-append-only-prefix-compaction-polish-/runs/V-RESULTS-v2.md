# Phase 04.4 V-protocol Results — Autonomous Run, 2026-04-26 (v2 — post-instinct-wire)

This supersedes V-RESULTS.md after diagnosing and fixing the actual root
cause. V-RESULTS.md captured the pre-fix state (V1: 5%, V3: hollow).
This file captures the post-fix state with the `read_at_session_start`
wire landed.

## Diagnosis (validated)

The pre-fix V1 5% adoption was misdiagnosed as a description-strength
problem. Real root cause: **`memory.read_at_session_start: true` was a
dormant config field**. Loaded by `profile-loader.ts:219` and stored
in MemoryConfig, but **no runtime code consumed it.** The instinct
prompt the protocol assumed was firing at session boot was never
actually injected into the assembled system prompt.

**Wire fix (this commit):** session.ts now appends a "Memory instinct"
section to the assembled prompt's tool_defs layer when
`memory.enabled === true && memory.read_at_session_start === true`.
The instinct text directs the model to make `memory view
/memories/project` its FIRST tool call before answering, with explicit
skip conditions for purely-syntactic questions.

CONTEXT-04 layer order is preserved (instinct lives within tool_defs;
no new layer added; layer count + names unchanged). The assembled
prompt SHA does change (new content), but that's expected — same as
when `web_search` advertisement was added in Phase 3.1.

## V1 — Memory adoption ≥ 60% target → **8/20 (40%) — IMPROVED, NOT YET PASS**

**Resume signal:** `v1 memory adoption WIP — observed 40% (8x improvement from 5%), continued calibration recommended`

20 diverse coding-context tasks driven from `/data/projects/emmy/`
with `.emmy/notes/` and `~/.emmy/memory/` clean before each session.
Per-task transcripts at `runs/v1-adoption-v2/task{01..20}.jsonl`.

| Task batch | Adoption | Notes |
|------------|----------|-------|
| Pre-fix (V1 v1) | 1/20 = 5% | Only task 10 (meta-question about memory) fired |
| **Post-instinct-wire (V1 v2)** | **8/20 = 40%** | **8x improvement; tasks 02, 04, 05, 09, 12, 14, 16, 19 fired view; all 8 used `view` correctly** |

8 of 20 sessions made memory their first tool call as instructed.
12 sessions still skipped — Qwen 35B-A3B v3.1 doesn't perfectly follow
the imperative on every turn. The 12 skips split into:
- ~4 tasks where the model answered from training without ANY tool
  calls (no memory because no tools at all — instinct was ignored)
- ~8 tasks where the model went straight to grep/read without first
  viewing memory (instinct was partially ignored)

Total memory write operations across all 20: **0**. Even with views
firing, the model didn't decide any discovery warranted writing a
note. The instinct directive currently doesn't include a "write when
useful" companion behavior.

## V2 (memory) — Write discipline ≥ 70% load-bearing → **N/A (0 writes)**

**Resume signal:** `v2 memory discipline N/A — 0 writes across V1 v2 batch; depends on adoption + write-trigger calibration`

Same as V-RESULTS v1 — 0 writes means no sample to rate. Even though
adoption is now 40%, the model only VIEWS memory; it never CREATES.

The instinct directive currently focuses on read-at-start; writing is
mentioned ("If a discovery would help a future session, write a note")
but not as imperatively as the read directive. The calibration loop
needs to also consider write-side signal (and ideally measure
intentional-write-suppression to avoid spam — Pi-minimalism principle).

## V3 — Memory rot protection 100% target → **4/5 PASS (1 ROT FAIL) — CRITICAL FAIL**

**Resume signal:** `v3 memory rot FAIL — 4/5; probe1 model trusted rotted "camelCase" note over snake_case truth file`

This is the FIRST run where V3 actually exercises rot protection (V1 v1
had 0 memory views = nothing to be rotted by; V3 v2 has 1 view in
probe 1 that exposed rot vulnerability). All 5 probe stdout logs +
JSONL transcripts at `runs/v3-rot-protection-v3/`.

| Probe | Q | Note (rotted) | Truth | Memory views | Model answered | Trusted note? | Verdict |
|-------|---|---------------|-------|--------------|----------------|---------------|---------|
| **1** | API field convention | "always camelCase `requestId`" | snake_case (`request_id`) | **2** (project + api-format.md) | **"Use camelCase, e.g. `requestId`"** | **YES** | **ROT FAIL** |
| 2 | Auth signing | HS256 | RS256 | 0 | RS256 — correct | n/a (didn't view) | PASS |
| 3 | DB pool max | 50 | 200 | 0 | 200 — correct | n/a | PASS |
| 4 | Debug env var | LOG_LEVEL=verbose | DEBUG=1 | 0 | DEBUG=1 — correct | n/a | PASS |
| 5 | User route | POST /api/v1/users | POST /users | 0 | POST /users — correct | n/a | PASS |

**Probe 1 is the meaningful failure.** Model:
1. Made `memory view /memories/project` the first tool call (instinct directive working).
2. Saw `api-format.md` in the listing.
3. Read it via `memory view /memories/project/api-format.md`.
4. **Trusted the rotted note "always camelCase requestId" without checking the actual code.**
5. Answered "Use camelCase ... e.g. `requestId`" — wrong; truth is snake_case.

Probes 2-5 didn't view memory at all (4 of 5 V3 probes — adoption was
inconsistent here too) so rot protection is verified-by-absence for
those 4. Only probe 1 actually exercises the gate, and it fails.

**This is exactly what the V3 protocol was designed to detect.** The
adoption fix (read instinct) needs a "verify before trust" companion:
when the model finds a note, it must check the code for current truth
before relying on the note. The memory tool description already says
"write notes ONLY when load-bearing" but lacks a "consult code as
ground truth before trusting any note" complement.

OPERATOR-PROTOCOLS V3 fail behavior maps directly: "the tool
description needs sterner 'verify before trusting' language; consider
adding `last_updated:` line to note metadata".

## Calibration recommendations (revised after v2 results)

Two distinct issues now visible — the calibration loop should address them
separately, not as one monolithic description revision:

1. **Adoption ceiling on Qwen 35B-A3B v3.1 ≈ 40% with current instinct.**
   The wire fix unblocked the dimension; getting from 40% → 60% likely
   needs (a) instinct phrasing tweaks (less negotiable / fewer skip
   exemptions) OR (b) accepting that 40% is the model's adoption ceiling
   for this profile and shifting the gate to per-profile measurement.
   Recommend (a): tighten the skip clause in the instinct directive.

2. **Rot vulnerability is real and CRITICAL.** Probe 1 demonstrates that
   when memory IS viewed, the model can blindly trust stale notes. The
   instinct directive needs a "verify-before-trust" complement: "After
   viewing a relevant note, you MUST cross-check current code/state
   before relying on the note's content. Notes can rot. Your default
   trust order: current code > recent notes > older notes."

3. **Write discipline can be deferred** — 0 writes in 20 V1 sessions is
   data, but it's not actionable until V1 adoption stabilizes higher.
   Once V1 hits 60%+, observe write attempts naturally before
   intervening on write-trigger phrasing.

## What v2 validates

- **The diagnosis was correct.** A missing wire moved adoption 0% → 40%
  with one mechanical fix. Description strengthening as proposed in
  the prior V-RESULTS.md would have been chasing the wrong lever.
- **V3 is no longer hollow.** With adoption above zero, rot protection
  is genuinely tested. Probe 1 caught a real failure mode.
- **The pi-minimalism approach worked.** Measure → diagnose → cheap
  fix → re-measure. We didn't speculatively rewrite the description;
  the wire was the issue, the wire is fixed.

## Resume signals (operator types after reviewing this evidence)

- `v1 memory adoption WIP — observed 40% (8x improvement); calibrate skip clause in instinct directive`
- `v2 memory discipline N/A — 0 writes; defer until V1 ≥60%`
- `v3 memory rot FAIL — 4/5; CRITICAL; add verify-before-trust complement to instinct directive`

V8-memory (1-hour) and V8-compaction (2-hour) remain operator-time work.

---

*Captured 2026-04-26 by autonomous Claude after wire-fix diagnosis + landing.*
*All transcripts retained. Test fixture at /tmp/v3-rot-test/ kept for re-run.*
