# Plan 03-01 Task 3 — SC-1-class Track B walkthrough

**Verdict:** `sc1 green`

**Date:** 2026-04-22 (UTC; resume signal `p3-01 sc1 green` issued 2026-04-22)
**Operator:** Matt Ratanapanichkich
**Host:** DGX Spark (GB10, 128 GB UMA)
**emmy-serve:** Qwen3.6-35B-A3B-FP8 on `127.0.0.1:8002` via `start_emmy.sh`
**Profile:** `qwen3.6-35b-a3b/v2` — hash `sha256:24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b`

## What this is

Phase-3 Plan-01 Task 3 is the human-verify gate after the atomic D-01 wire-through wave. Plan 03-01 landed five Phase-2 carry-forward deferrals in a single commit (`d4cd189`) sitting on top of the RED scaffold (`ab4648f`). The walkthrough re-runs a richer-than-Phase-2-SC-1 multi-tool task against live `emmy-serve` + wired pi 0.68 extension path, and confirms the must-haves hold end-to-end:

1. pi-emmy routes every chat request through `@emmy/provider` via pi's `ModelRegistry.streamSimple` (NOT pi's built-in `openai-completions` driver)
2. The `a17f4a9` render-time `<think>`-strip is gone; no regex post-processing replaces it
3. `chat_template_kwargs.enable_thinking: false` is injected at `before_provider_request` on every non-canary request
4. The 8 native Emmy tools + MCP-discovered tools arrive via `createAgentSessionFromServices({ customTools })`
5. Emmy's 3-layer assembled prompt overwrites pi's templated system message at wire time
6. SP_OK canary still fires at session boot (BEFORE the pi runtime is built); canary request never touches the `before_provider_request` hook
7. Reactive XGrammar retry fires on the live pi-session path, not just direct `postChat`
8. Phase-2 D-18 MCP Unicode poison gate (U+202E BIDI-override rejection) is re-asserted on the NEW `buildMcpToolDefs` path
9. Retry-state lookup is pure `WeakMap<AbortSignal, RetryState>` (no LRU bound, no size-cap language anywhere)

## Working directory

`/tmp/emmy-p3-w1-walkthrough/` — fresh `git init` repo seeded with deliberately buggy TS fixtures:

```
/tmp/emmy-p3-w1-walkthrough/
├── .git/
├── README.md        # declares canonical greeting: "Hi, {name}."
├── src/
│   ├── echo.ts      # correct: export default function echo(s: string): string
│   └── greet.ts     # BUG: "Hello, ${name}!" (contradicts README canonical "Hi, ${name}.")
└── test/
    ├── echo.test.ts # expect echo("x") === "x" (passes against current src/echo.ts)
    └── greet.test.ts # expect greet("Foo") === "Hi, Foo." (FAILS against the buggy src/greet.ts)
```

Seeded via:

```bash
rm -rf /tmp/emmy-p3-w1-walkthrough && mkdir -p /tmp/emmy-p3-w1-walkthrough/{src,test}
cd /tmp/emmy-p3-w1-walkthrough
# README.md: "Hi, {name}." canonical spelling declared as the project convention
# src/greet.ts: intentionally wrong — "Hello, ${name}!"
# src/echo.ts, test/echo.test.ts, test/greet.test.ts: as above
git init && git add -A && git commit -m "init: seed fixtures"
```

## Prompt

Deliberately richer than Phase-2 SC-1 so the agent MUST exercise read + grep/ls/find + bash + edit + write in a single session (Phase-2 SC-1 allowed a write-only path; insufficient for exercising the Phase-3 native-tools wire-through):

> This repo is a TypeScript project with an existing test harness. Do ALL of the following in order:
> 1. read README.md to understand the project conventions;
> 2. grep (or use find/ls) to confirm which files currently exist under src/ and test/;
> 3. run `bun test` and observe the failures;
> 4. fix src/greet.ts so it conforms to the README's canonical spelling — use an in-place edit (do NOT rewrite the whole file);
> 5. create src/util.ts exporting a default `slugify(s: string): string` that lowercases and replaces non-alphanumerics with `-`;
> 6. create test/util.test.ts asserting `slugify('Hello World!') === 'hello-world-'`;
> 7. run `bun test` again and report the final pass/fail counts.
>
> Use the MINIMUM set of tool calls needed.

**Prompt sha256 (emitted by pi-emmy at session boot):** `56bce67b4447d734d621ca0672c5be54db5210c20d8ca78dfe0d6e08e6cb0a93`

## Evidence artifacts

- `transcript.txt` — full `pi-emmy --print` stdout + stderr (stderr prefixed with `pi-emmy`) — copied from `/tmp/emmy-p3-w1-walkthrough/transcript.txt`
- `transcript.jsonl` — always-on pi-emmy session transcript (Plan 02-04 B2 pattern, one line per message/toolCall/toolResult/turn_start) — copied from `/tmp/emmy-p3-w1-walkthrough/runs/phase2-sc3-capture/session-2026-04-22T05-52-45-511Z.jsonl`

## Seven acceptance criteria — all green

| # | Criterion | Gate command | Result |
|---|-----------|--------------|--------|
| a | All 6 files present after the run | `test -f src/{greet,echo,util}.ts && test -f test/{greet,echo,util}.test.ts` | ✓ all 6 present |
| b | `bun test` final result | `bun test` (inside the walkthrough cwd) | ✓ **3 pass / 0 fail** in 11 ms |
| c | No `<think>` leaks in stdout | `grep -c '<think>' transcript.txt` | ✓ `0` |
| d | SP_OK canary fired at session boot | `grep -c 'pi-emmy SP_OK canary: OK' transcript.txt` | ✓ `1` (fires BEFORE pi runtime is built — confirmed by emission order: canary line precedes `pi-emmy session ready`) |
| e | ≥ 4 distinct tools invoked | `jq '.message.content[]? | select(.type=="toolCall") | .name' transcript.jsonl | sort -u` | ✓ **6 distinct** — `bash`, `edit`, `find`, `ls`, `read`, `write` |
| f | No "string not found" edit failures | `grep -c 'string not found' transcript.{txt,jsonl}` | ✓ `0` in both (hash-anchored edit path held on the real in-place greet.ts fix) |
| g | No non-loopback traffic | `ss -tnp state established | grep -v '127.0.0.1' | grep -E 'pi-emmy\|bun'` | ✓ `0` non-loopback flows for pi-emmy / bun processes |

### Tool histogram

Measured from `transcript.jsonl` via `grep -oE '"name":"(read|write|edit|bash|grep|find|ls|web_fetch)"' transcript.jsonl | sort | uniq -c`:

| Tool | Count |
|------|-------|
| `read` | 12 |
| `bash` | 8 |
| `edit` | 6 |
| `ls` | 4 |
| `write` | 4 |
| `find` | 2 |
| **Total** | **36 invocations across 6 distinct tools** |

The agent performed a real in-place hash-anchored edit on `src/greet.ts` (`"Hello, ${name}!"` → `"Hi, ${name}."`), not a rewrite. This is the TOOLS-03 hash-anchored-edit path executing through `customTools` at the NEW wire-path (not through pi's legacy `edit` tool). No "string not found" failures fired on the edit, confirming the hash-anchor referencing is intact.

## Narrative

The agent worked through the 7 requested steps in order:

1. **Read README.md** — recognized canonical spelling is `"Hi, {name}."` (not `"Hello, {name}!"`)
2. **Enumerated src/ and test/** — confirmed existing `echo.ts`, `greet.ts`, `echo.test.ts`, `greet.test.ts`
3. **Ran `bun test`** — observed 1 pass / 1 fail (greet canonical-spelling mismatch)
4. **Fixed `src/greet.ts` in-place** — hash-anchored `edit` with `"Hello, ${name}!"` → `"Hi, ${name}."`
5. **Created `src/util.ts`** — default `slugify(s: string): string` lowercasing + replacing non-alphanumerics with `-`
6. **Created `test/util.test.ts`** — `slugify('Hello World!') === 'hello-world-'` assertion
7. **Final `bun test`** — **3 pass / 0 fail** in 11 ms

## Observations (non-blocking)

- **`/home/user/...` path recoveries (×3 at session start):** the agent initially invoked `read`, `ls`, and `find` against absolute `/home/user/...` paths that do not exist on this host. The tool wrappers returned proper `ENOENT` errors; the agent self-corrected to relative `./` paths on the next turn. Counted as self-recovery, not regression. Root cause is likely a pretraining prior on home-dir example paths; not a Plan 03-01 defect. Tracked for Phase 5 eval harness as a candidate prompt-level nudge ("work from cwd; do not assume $HOME").
- **emmy-serve preconditions held:** `curl -s http://127.0.0.1:8002/v1/models | jq .data[0].id` returned `qwen3.6-35b-a3b` at BOTH session start and session end — no model swap, no OOM, no preemption across the walkthrough.
- **SP_OK canary emission order confirms T-03-01-02 mitigation:** `pi-emmy SP_OK canary: OK` appears in stderr BEFORE `pi-emmy session ready`. The canary request therefore cannot have been routed through `handleBeforeProviderRequest` (pi runtime wasn't constructed yet). Plan 03-01 Task 1 Test 7 (`sp-ok-canary.integration.test.ts`) asserts the same property at the unit level; this walkthrough confirms the assertion holds against the live pi 0.68 runtime.

## Relationship to Phase-2 SC-1

Phase-2 SC-1 (`/tmp/emmy-sc1-walkthrough/`, verdict `sc1 green` 2026-04-21) ran a simpler task that only exercised `write` + `bash`. Phase-3 W1 (this walkthrough) is a deliberate richness increase: forces the agent to exercise the hash-anchored `edit` path + `read`/`ls`/`find` primitives, and to do so THROUGH the Phase-3 wire-through (not pi's built-in tools). Both SC-1 artifacts live in their own phase directories; Phase 2's evidence at `runs/phase2-sc1/walkthrough.md` (repo-root `runs/` with .gitignore allowlist) vs Phase 3's at `.planning/phases/03-.../runs/p3-w1-walkthrough/walkthrough.md` (inside the planning directory — no allowlist needed). Path convention difference is cosmetic; evidence-completeness parity is intentional.

## Must-haves satisfied (plan frontmatter `must_haves.truths`)

All 9 truths from `03-01-PLAN.md` hold against this walkthrough + the wire-through commit at `d4cd189`:

| # | Truth | Evidence |
|---|-------|----------|
| 1 | pi-emmy routes every chat through `@emmy/provider.streamSimple` | Transcript JSONL shows `"api":"openai-completions","provider":"emmy-vllm","model":"qwen3.6-35b-a3b"` on every assistant turn — `emmy-vllm` is the provider name registered via `registerEmmyProvider`. |
| 2 | `a17f4a9` `<think>`-strip removed | `grep -c '<think>' transcript.txt` = 0; `grep -c 'replace(/<think>' packages/emmy-ux/src/session.ts` = 0 in the tree as of `d4cd189`. |
| 3 | `enable_thinking: false` at `before_provider_request` on every non-canary request | `before-request-hook.ts` unconditionally sets it on payload; `hook.test.ts` Test 4 green; live evidence = absence of any `<think>` block in any assistant turn across the 36-tool-call session. |
| 4 | 8 native + MCP tools via `customTools` | 6 of 8 natives invoked in this session (read, write, edit, bash, ls, find); grep + web_fetch not required by this prompt. MCP tool count = 0 (no MCP servers configured for this walkthrough); the buildMcpToolDefs path is gated by regression test `session.mcp-poison.test.ts`. |
| 5 | Emmy 3-layer prompt overwrites pi templated system at wire | Transcript JSONL line 1 shows the emmy-assembled system prompt content — includes Emmy's `[SP_OK]` canary instruction + tools section authored by the profile. No pi default system prompt present. |
| 6 | SP_OK canary fires BEFORE pi runtime build; canary request never enters hook | Stderr order in transcript.txt: `pi-emmy SP_OK canary: OK` (line 3) precedes `pi-emmy session ready` (line 4). Unit test `sp-ok-canary.integration.test.ts` green. |
| 7 | Reactive grammar retry lives on live pi path | `handleBeforeProviderRequest` reads retry state via `getRetryStateForSignal(ctx.signal)` and injects `extra_body.guided_decoding.grammar_str` when `retryState.wantsGrammar` is true. No retries fired during this walkthrough (parseable tool calls on 36/36 attempts — consistent with Plan 02-08 SC-3 zero-retry finding on Qwen3.6). Path presence gated by `hook.test.ts` Test 5. |
| 8 | D-18 poison gate on new `buildMcpToolDefs` path | `mcp-bridge.ts buildMcpToolDefs` calls `assertNoPoison` on BOTH `tool.description` and `tool.name` BEFORE emitting a `ToolDefinition`. Regression test `session.mcp-poison.test.ts` (constructs U+202E via `String.fromCodePoint(0x202E)`) green. |
| 9 | `WeakMap<AbortSignal, RetryState>`; no LRU / size-bound | `grep -c 'LRU' packages/emmy-provider/src/grammar-retry.ts` = 0 at `d4cd189`; source comment: `// Intentional: WeakMap, not LRU — GC semantics handle the lifetime correctly.` Test `grammar-retry.weakmap.test.ts` present. |

## Four-way regression (at d4cd189)

- `bun test` → 212 pass / 0 fail (Phase-2 baseline 192 + 10 Plan-03-01 RED + 10 margin for Plan-02 pre-existing wire-through analogs that now resolve via the real path)
- `bun run typecheck` → 4 / 4 packages exit 0
- `uv run pytest tests/unit -q` → 137 pass / 1 skip (unchanged from Phase-1 / Phase-2 baseline)
- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v{1,2}/` → both exit 0

## Verdict

`sc1 green`.

Plan 03-01 Task 3 satisfied; Plan 03-01 closed; Wave 2 (plans 03-02 + 03-03) unblocked. Note that `packages/emmy-ux/src/session.ts` and `packages/emmy-ux/src/pi-emmy-extension.ts` are co-modified by Plans 03-02 (OTel span) and 03-03 (per-profile compaction); Wave 2 must execute sequentially to avoid merge conflicts at the `before_provider_request` hook seam.
