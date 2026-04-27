# V3 Memory Rot Protection — Autonomous Run, 2026-04-26

Ran the full 5-plant V3 protocol from `04.4-09-OPERATOR-PROTOCOLS.md § V3` against
live qwen3.6-35b-a3b@v3.1 from `/tmp/v3-rot-test/`. **5/5 PASS on rot
protection — but for a degenerate reason that exposes a separate V1 wiring gap.**

## Probe results

| Probe | Question | Truth | Note (rotted) | Model answer | Trusted note? | Read code? |
|-------|----------|-------|---------------|--------------|---------------|-----------|
| 1 | API field convention | snake_case (`request_id` in `src/api/handler.ts`) | "always camelCase requestId" | "use camelCase for new" — referenced PARENT emmy codebase (`packages/emmy-provider/src/types.ts` etc.), did NOT read `/tmp/v3-rot-test/src/api/handler.ts` | No | Yes (wrong codebase via cwd-traversing grep) |
| 2 | Auth signing algo | RS256 (`src/auth/auth.ts` uses jose's importPKCS8) | HS256 | RS256 — correct, cited importPKCS8 + setProtectedHeader | No | Yes |
| 3 | DB pool max | 200 (`src/db/pool.ts` line 4) | 50 | 200 — correct, cited line 4 | No | Yes |
| 4 | Debug env var | `DEBUG=1` (`src/config/logger.ts`) | `LOG_LEVEL=verbose` | `DEBUG=1` — correct, cited logger.ts | No | Yes |
| 5 | User route | POST `/users` (`src/routes/users.ts`) | POST `/api/v1/users` | `POST /users` — correct | No | Yes |

**Strict V3 reading (per OPERATOR-PROTOCOLS): 5/5 PASS.** In zero of 5 probes did the
model trust the rotted note over the code. In 4/5 probes the model read the truth file
and gave the correct answer. In probe 1 the model bypassed the test fixture entirely
(grepped the parent emmy project) and accidentally arrived at the right answer for the
wrong reason — not via the planted note.

## Why this PASS is hollow

```bash
$ for f in session-*.jsonl; do
    echo "$f memory_calls=$(grep -c '"name":"memory"' $f)"
  done
session-…35-50.jsonl memory_calls=0
session-…37-45.jsonl memory_calls=0
session-…37-58.jsonl memory_calls=0
session-…38-09.jsonl memory_calls=0
session-…38-20.jsonl memory_calls=0
```

**Across all 5 probes, the model fired ZERO `memory.view` calls.** The model didn't
trust the rotted notes because it never *read* them. Memory rot can only corrupt
answers when memory is being read; baseline read-rate is 0%, so rot corruption is
structurally impossible at this moment.

This is a strict-V3 PASS but a moral fail: the gate was supposed to verify rot
protection in the presence of memory adoption, not in its absence.

## Root cause of the 0% adoption (Phase 04.4 wiring gap)

Inspected the system-prompt assembly. `profiles/qwen3.6-35b-a3b/v3.1/prompts/tool_descriptions.md` opens with:

> "Nine tools are always available (eight Phase-2-stable + `web_search` added in Phase 3.1). Call exactly one per assistant turn."

It enumerates `read / write / edit / bash / grep / find / ls / web_fetch / web_search`. **`memory` is NOT in the enumeration.** The first event in every V3 session JSONL — the assembled system prompt — confirms this:

```
# Tools available
- read(path, …)
- write(path, content)
- edit(path, …)
- bash(command, …)
- grep(pattern, …)
- find(path, …)
- ls(path, …)
- web_fetch(url, …)
- web_search(query, …)
```

Memory is registered correctly via `customTools` in `session.ts:986-990` (added when `memoryConfigured && resolvedMemoryConfig.enabled`), and IS sent to vLLM in the OpenAI `tools` array. But Qwen 35B-A3B follows the system prompt's enumeration heavily — the prompt's "9 tools available" list functions as a model-facing tool inventory, and memory's absence from that list means the model never reaches for it.

Plan 04.4-07 added the `memory` block to each profile's `compact.md` (compaction-time prompt) but did NOT update the four bundles' `prompts/tool_descriptions.md` (or wherever the system-prompt's tool inventory comes from). This is an additive-only prompt edit that:

1. Affects all 4 shipped profiles (`qwen3.6-35b-a3b/v3.1`, `qwen3.6-27b/v1.1`, `gemma-4-26b-a4b-it/v2`, `gemma-4-31b-it/v1.1`).
2. Per the now-codified PROFILE-06 amendment (CLAUDE.md), it qualifies as additive-only — the new tool is mentioned, no existing tool description changes — and would recompute hashes in place.
3. Once landed, V1 adoption can be re-measured. The 0% baseline becomes meaningful.
4. V3 protocol then needs to be re-run, because rot protection is only verifiable when memory is actually being read.

## Operator-actionable items

**Decision required:**
- (a) Land the prompt-update fix as a 04.4-followup (recommend) — adds ~10 lines per profile to `tool_descriptions.md`, recomputes the 4 hashes (in-place per amendment), runs V1 again to measure adoption, then re-runs V3 to confirm rot protection in the presence of adoption.
- (b) Defer entirely to Phase 5 + treat current state as "memory tool ships dormant; V1/V3 will be measured when called" — risks Phase 5 eval running with memory-as-no-op.

**Recommended:** (a). The prompt-update is mechanical. ETA: ~30 min for the prompt edit + hash recompute; ~30 min for V1 re-run; V3 re-run reuses fixture at `/tmp/v3-rot-test/`.

## What V3 evidence captured

5 probe-stdout logs at `probe{1..5}-*.log` and 5 session JSONL transcripts at
`session-2026-04-27T*.jsonl` — all preserved in this directory.
Test fixture at `/tmp/v3-rot-test/` retained for re-run after the prompt-update fix lands.

## Cwd-leak observation (probe 1)

The model in probe 1 grep'd `/data/projects/emmy/server` — outside `/tmp/v3-rot-test/`. The bash/grep tools don't restrict to cwd. This is not unique to V3 (any pi-emmy run on a Spark host can traverse outside cwd). It's relevant to V8 because future eval runs MUST isolate cwd from the host filesystem, e.g. via container or chroot, otherwise eval results are contaminated by adjacent project code.

---

*Captured 2026-04-26 by autonomous Claude post-merge after Path A + Option X commits.*
*PROFILE-06 amendment + 4 hash recomputes unblocked the boot path; V3 ran cleanly;*
*finding is a Phase-04.4 prompt-integration gap, not a memory-tool runtime gap.*
