# SC-1 Daily-Driver Walkthrough

**Date:** 2026-04-21
**Operator:** Matt Ratanapanichkich (author / daily-driver user)
**Profile under test:** `qwen3.6-35b-a3b/v2` (hash `sha256:24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b`)
**Emmy-serve:** `127.0.0.1:8002`, Qwen3.6-35B-A3B-FP8, up on NGC `nvcr.io/nvidia/vllm:26.03.post1-py3`
**Walkthrough root:** `/tmp/emmy-sc1-walkthrough/` (clean throwaway repo; `git init` + `README.md` + `AGENTS.md` template pre-committed)

---

## Verdict

**sc1 green** — daily-driver bar met.

The author ran `pi-emmy --print` against a clean repo, asked it to create three files + tests + run the suite, and the agent completed the task using only pi's built-in `write` + `bash` tools against the local Qwen3.6 vLLM endpoint. No cloud call, no leaving the TUI/--print path, tests green.

**One-line reason:** The end-to-end path (SP_OK canary → profile-validate pre-flight → real pi AgentSession via ModelRegistry → live tool use → bun test 3/3 green) works from an arbitrary cwd on Qwen3.6 at Phase 1's honest 48 tok/s floor. The daily-driver experience is legitimately usable, not "usable with caveats."

---

## Walkthrough narrative

### Setup

```bash
cd /tmp && rm -rf emmy-sc1-walkthrough && mkdir emmy-sc1-walkthrough && cd emmy-sc1-walkthrough
git init
echo "# SC-1 Walkthrough" > README.md
cp /data/projects/emmy/docs/agents_md_template.md AGENTS.md
# (AGENTS.md describes: "This repo will have src/{foo,bar,baz}.ts; add a function in each.")
cat > package.json <<'EOF'
{"name":"emmy-sc1-walkthrough","type":"module","scripts":{"test":"bun test"}}
EOF
git add -A && git commit -m "init"
```

### Liveness sanity

```bash
curl -s http://127.0.0.1:8002/v1/models | jq '.data[0].id'
# => "qwen3.6-35b-a3b"
```

### The walkthrough prompt

```bash
pi-emmy --print "Add a function log(msg: string) to src/foo.ts, src/bar.ts, and src/baz.ts. Each should print '[<filename>] ' prefix. Create the files if they don't exist. Then run 'bun test' and verify all three files exist."
```

### What happened

1. **Session startup** — `pi-emmy` emitted:
   - `pi-emmy SP_OK canary: OK` (Phase 1 canary round-trip against `127.0.0.1:8002`)
   - `pi-emmy session ready (prompt.sha256=<hex>, layers=system.md,AGENTS.md,tool_defs,user)`
   - `pi-emmy transcript=runs/phase2-sc3-capture/session-2026-04-22T01-07-11-070Z.jsonl` (B2 capture — the D-13 real_replay corpus gets a natural feed)
   - Profile bundle shown: `qwen3.6-35b-a3b/v2` hash `sha256:24be3eea...`

2. **Agent tool loop** (from the transcript at `runs/phase2-sc1/transcript.json`):
   - Turn 1: `bash(ls -la /tmp/emmy-sc1-walkthrough/src/)` + `bash(cat package.json)` — reconnaissance
   - Turn 2: `write(src/foo.ts, ...)` + `write(src/bar.ts, ...)` + `write(src/baz.ts, ...)` — three log() implementations (each prints `[<filename>] ${msg}`)
   - Turn 3: `write(src/foo.test.ts, ...)` + `write(src/bar.test.ts, ...)` + `write(src/baz.test.ts, ...)` — one bun-test file per source, each imports + calls + captures stdout
   - Turn 4: `bash(cd /tmp/emmy-sc1-walkthrough && bun test)` → `3 pass / 0 fail / 3 expect() calls / Ran 3 tests across 3 files`
   - Turn 5: Final assistant text summarizes what was done + reports green tests

3. **Artifacts on disk after walkthrough:**
   ```
   /tmp/emmy-sc1-walkthrough/
   ├── AGENTS.md
   ├── README.md
   ├── package.json
   ├── runs/phase2-sc3-capture/
   │   ├── session-2026-04-22T01-00-57-845Z.jsonl  (74 turns — earlier iteration that surfaced the thinking-block leak bug)
   │   ├── session-2026-04-22T01-05-56-303Z.jsonl  (22 turns — iteration that surfaced the install-root path bug)
   │   └── session-2026-04-22T01-07-11-070Z.jsonl  (23 turns — the clean run, verdict-bearing)
   └── src/
       ├── bar.ts / bar.test.ts
       ├── baz.ts / baz.test.ts
       └── foo.ts / foo.test.ts
   ```

4. **Air-gap posture during the session:**
   ```bash
   ss -tnp | grep -v 127.0.0.1 | grep ESTAB
   # (no output — only loopback connections to emmy-serve:8002)
   ```

5. **Session completion:** Agent exited cleanly; `pi-emmy --print` returned the final assistant text and exit 0. No external terminal invocation, no cloud fallback.

---

## SC-1 findings — four live bug fixes

The SC-1 walkthrough is not a rubber-stamp; it was the first time the harness was exercised end-to-end from an **arbitrary cwd against the live Qwen3.6 endpoint**. Four real bugs surfaced and were fixed inline under Rule 1 (bug fix) / Rule 3 (blocking) during the walkthrough cycle. Each is a legitimate Plan 02-09 artifact, not a regression.

| # | Commit | Title | Rationale |
|---|--------|-------|-----------|
| 1 | [`2c22018`](#) | `fix(02-09): pi-emmy default profile path resolved from install root, not cwd` | `pi-emmy` was resolving `profiles/` relative to the caller's cwd. Broke from any repo other than `/data/projects/emmy`. Fix: resolve default profile from `fileURLToPath(import.meta.url)` (with `$EMMY_PROFILE_ROOT` override). |
| 2 | [`4049d95`](#) | `fix(02-09): run 'uv run emmy profile validate' from emmy install root` | Same bug class. `execFileSync('uv', ...)` inherited pi-emmy's cwd; the Python `uv` project wasn't findable. Fix: pass `cwd: emmyInstallRoot()` to `execFileSync`. Extracted shared helper. |
| 3 | [`85fa910`](#) | `fix(02-09): wire real pi AgentSession via ModelRegistry so pi-emmy --print actually drives the agent loop` | **Scope mismatch surfaced.** Plan 02-04 had shipped `registerProvider`/`registerTool` as NO-OP stubs with a "Phase 3 extension-runner binding" comment. SC-1 demanded the session actually drive a model. Fix: `buildRealPiRuntime` now constructs an in-memory `AuthStorage` + `ModelRegistry`, registers `emmy-vllm` as an `openai-completions` provider, creates session via `createAgentSessionServices` + `createAgentSessionFromServices`, adds `runPrint()` that subscribes to `agent_end`. |
| 4 | [`a17f4a9`](#) | `fix(02-09): strip Qwen3.6 <think> blocks from pi-emmy --print output` | pi-ai's openai-completions stream only sends `chat_template_kwargs.enable_thinking:false` when `model.reasoning` is truthy AND `thinkingLevel` maps to a falsy `reasoningEffort`, which pi's default `medium` doesn't produce. Qwen's chat template defaulted thinking ON — reasoning tokens leaked into assistant text. **Phase-2 stopgap:** strip at render. **Phase-3 fix:** wire `@emmy/provider` through pi's `streamSimple` hook. |

### Interpretation

Fixes #1 and #2 are ordinary deploy-path bugs — the harness was only ever run from the emmy repo cwd during plans 02-04/07/08. SC-1's "run `pi-emmy` against a clean repo" demand exposed them immediately.

Fix #3 is the more interesting one: **Plan 02-04 shipped a skeleton pi runtime adapter with provider/tool registration as NO-OPs**, explicitly deferring "extension-runner binding" to Phase 3. SC-1's daily-driver bar requires `session.prompt()` to actually reach a model — a skeleton session with no registered provider cannot. The fix wires a minimum-viable real runtime so `--print` works; the broader extension-runner binding (emmy-provider / emmy-tools / MCP bridge wired through pi's pipelines) remains a Phase 3 deferral (see CLOSEOUT carry-forward).

Fix #4 is a chat-template default that pi's thinkingLevel heuristic doesn't disable. The right fix is wiring emmy-provider's OpenAI-compat adapter through pi's `streamSimple` so our `chat_template_kwargs.enable_thinking:false` reaches the wire — same Phase 3 scope as fix #3's deferred portion.

All four fixes landed with typecheck green + 54/54 emmy-ux tests green + live smoke re-verified. None introduced new deferrals beyond what's already documented in the CLOSEOUT carry-forward.

---

## Glaring UX rough edges

None that block the daily-driver bar. Documented observations (not blockers, not tickets):

- The `<think>...</think>` strip at render is a Phase-2 stopgap; the proper fix (enable_thinking:false at the request level via emmy-provider's `streamSimple` wiring) is Phase 3.
- pi-emmy's `--print` mode surfaces the assembled `prompt.sha256` to stderr only (not in the final --json output). That's fine for SC-1; Phase 3 observability will emit it structurally.

## Bugs warranting a patch before Phase 2 close

The four `fix(02-09):*` commits already landed. No further patches needed.

---

## Evidence

- **Transcript:** `runs/phase2-sc1/transcript.json` (copy of `/tmp/emmy-sc1-walkthrough/runs/phase2-sc3-capture/session-2026-04-22T01-07-11-070Z.jsonl`; 23 lines — the clean verdict-bearing run)
- **Earlier iterations:** (not copied into the evidence dir but kept in `/tmp/emmy-sc1-walkthrough/runs/phase2-sc3-capture/`) — the 74-turn and 22-turn sessions surfaced fixes #1–#4 before the clean run succeeded
- **Live test result:** `bun test` in `/tmp/emmy-sc1-walkthrough/` → 3 pass / 0 fail
- **Air-gap:** `ss -tnp | grep -v 127.0.0.1 | grep ESTAB` returned empty during the session
- **Commits:** `2c22018`, `4049d95`, `85fa910`, `a17f4a9`

---

*SC-1 walkthrough completed 2026-04-21; verdict `sc1 green`.*
