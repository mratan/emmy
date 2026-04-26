# Memory Tool — Anthropic `memory_20250818` adapted for Emmy

**Status:** proposed (pre-phase, not yet committed to roadmap)
**Phase that consumes this:** 04.4 (Filesystem memory + append-only compaction)
**Decision this informs:** the tool surface, path-resolution rules, profile schema additions, reproducibility hooks, and the model-facing instinct prompt for filesystem-based memory in Emmy.

---

## 1 — Why filesystem memory (not vector memory)

The most defensibly-grounded data point in the long-context research: **Letta's own LoCoMo benchmark** (2025) found a plain filesystem memory at 74% beat their specialized memory library. Vector "agent memory" is overhyped for code agents specifically — the retrieval keys are unsolved (filename? AST? embedding?), and code-shaped state (file paths, function names, decisions, bug history) is naturally addressable by *path*, not by *similarity*.

This aligns with what Emmy needs anyway: **reproducibility-first**, **air-gap-clean**, **single-user-local**. A directory of Markdown is auditable, diff-able, snapshot-able for eval, and requires zero new infra.

Three SOTA implementations of the same shape, in chronological order: CLAUDE.md / AGENTS.md (model reads at boot), Anthropic's `memory_20250818` tool (model reads/writes during the session), Devin "Knowledge" (folder hierarchy, conditional retrieval). All three converged on the same primitive — files. Emmy adopts the **`memory_20250818` interface verbatim** so we ride a published spec, then layers Emmy-specific scoping and reproducibility hooks on top.

## 2 — Adopted surface (canonical, do not invent)

Six commands, schema lifted directly from Anthropic's `memory_20250818`:

```jsonc
// Discriminated union by `command` field
{ "command": "view",        "path": "/memories/...", "view_range": [start, end] | null }
{ "command": "create",      "path": "/memories/...", "file_text": "..." }       // errors if exists
{ "command": "str_replace", "path": "/memories/...", "old_str": "...", "new_str": "..." } // unique-match required
{ "command": "insert",      "path": "/memories/...", "insert_line": N, "insert_text": "..." }
{ "command": "delete",      "path": "/memories/..." }
{ "command": "rename",      "old_path": "/memories/...", "new_path": "/memories/..." }
```

**Path semantics:**
- All paths are **logical** under a virtual root `/memories`. The runtime resolves to a physical dir (see §3).
- `view` on a directory returns a tree listing; `view` on a file returns numbered lines (1-indexed). `view_range` is optional.
- `create` errors if the file already exists (deliberate — forces explicit `str_replace` for updates).
- `str_replace` requires the `old_str` to match exactly once; on collision the runtime returns the line numbers of all matches so the model can resubmit with more context (Anthropic's pattern).
- `delete` is non-recursive on directories — must be empty first. Non-empty dir delete returns an error with a list of contained files.
- `rename` works for files and dirs.

**Path traversal is blocked.** Reject any path containing `..`, `..\\`, `%2e%2e%2f`, or that resolves outside the configured root after symlink expansion. Return a typed error (not silent absorption).

**Tool description** — Anthropic ships their tool with the model-facing line *"ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE."* Emmy ships a deliberately shorter variant in keeping with pi-mono's minimalism, then expands only if measurement shows the model fails to use the tool; see §6.

## 3 — Emmy-specific extensions

### 3.1 — Two scopes via path prefix

Anthropic's spec is single-rooted (`/memories`). Emmy adds **scoping via path prefix**:

| Logical prefix | Physical dir | Persistence | When the model picks it |
| --- | --- | --- | --- |
| `/memories/project/...` | `<repo>/.emmy/notes/` | per-project, gitignorable | code-specific notes, repo conventions, "we tried X and it didn't work" |
| `/memories/global/...` | `~/.emmy/memory/` | per-user, cross-project | language/framework idioms, user preferences, recurring patterns |

The model sees both as one virtual filesystem. `view /memories` returns `project/` and `global/` as top-level entries. The split is a *convention* enforced by path validation, not a separate tool.

**Why two and not three (no system-level shared memory):** single-user-local. There is no third party to share with. If a teammate ever exists, they get their own `~/.emmy/memory/`.

### 3.2 — Profile schema additions

```yaml
# profiles/<name>/v<N>/harness.yaml
memory:
  enabled: true
  project_root: ".emmy/notes"           # relative to cwd; null = disable project scope
  global_root: "~/.emmy/memory"         # absolute or ~-prefixed; null = disable global scope
  read_at_session_start: true           # whether the instinct prompt fires
  max_file_bytes: 65536                 # per-file write cap; reject larger create/str_replace
  max_total_bytes: 10_485_760           # per-scope cap (10 MiB); reject create on overflow
  blocked_extensions: [".env", ".key", ".pem"]   # belt-and-braces against secret accumulation
```

**Defaults:** enabled=true, both roots configured, read_at_session_start=true, 64 KiB per file, 10 MiB per scope. These ride in the profile so a research-mode profile can disable memory entirely (`enabled: false`) for clean eval runs without `--no-memory` plumbing.

### 3.3 — Reproducibility hooks

Memory is **stateful across sessions** by design. For eval and forensics this is hostile unless we add controls:

1. **`--no-memory` flag** (in headless mode, see SPIKE-headless-mode.md §3) — disables the tool entirely; tool description omits memory; instinct prompt skipped.
2. **`--memory-snapshot DIR`** — before the run, mirror `DIR` into the live memory roots; after the run, restore the original. Atomic per scope.
3. **Per-eval-run isolation** — eval driver sets `EMMY_MEMORY_OVERRIDE_PROJECT=/tmp/eval-<run_id>/notes` and `EMMY_MEMORY_OVERRIDE_GLOBAL=/tmp/eval-<run_id>/memory` so concurrent eval workers never collide. Env-var precedence beats profile and beats CLI flag (see CLAUDE.md "URL config precedence" — same pattern, applied to filesystem).
4. **Provenance stamp** — when memory is read or written, the OTel event includes `{profile.id, profile.version, profile.hash, memory.scope, memory.path}` so a session transcript can be replayed against the exact memory state it was produced under.

### 3.4 — Air-gap compatibility

Memory tool is **local-fs-only**. No network, no IPC outside the harness process. Air-gap CI (`ci_verify_phase3`) gains a new check: the tool must produce zero network syscalls during a 100-op stress run. (Cheap to write; high signal — caught Pitfall #5-class regressions before in this project's history.)

## 4 — Tool implementation surface (TS, in `packages/emmy-tools/src/memory/`)

```ts
// Single ToolDefinition with a discriminated-union TypeBox schema.
// Pi-mono's defineTool API (see node_modules/.../pi-coding-agent/dist/core/sdk.d.ts).
import { Type } from '@sinclair/typebox';
import { defineTool } from '@mariozechner/pi-coding-agent';

const MemoryToolInput = Type.Union([
  Type.Object({
    command: Type.Literal('view'),
    path: Type.String(),
    view_range: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
  }),
  // ... 5 more variants for create / str_replace / insert / delete / rename
]);

export const memoryTool = defineTool({
  name: 'memory',
  description: /* see §6 */,
  inputSchema: MemoryToolInput,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const resolved = resolveMemoryPath(params.path, ctx.profile.memory);
    if (!resolved.ok) return memoryError(resolved.error);
    switch (params.command) {
      case 'view':       return await viewCommand(resolved.absPath, params.view_range);
      case 'create':     return await createCommand(resolved.absPath, params.file_text, ctx.profile.memory);
      case 'str_replace':return await strReplaceCommand(resolved.absPath, params.old_str, params.new_str);
      case 'insert':     return await insertCommand(resolved.absPath, params.insert_line, params.insert_text);
      case 'delete':     return await deleteCommand(resolved.absPath);
      case 'rename':     return await renameCommand(/* ... */);
    }
  },
  renderResult: /* compact one-line summary in the TUI */,
});
```

Files:
- `packages/emmy-tools/src/memory/index.ts` — exports the `memoryTool` ToolDefinition
- `packages/emmy-tools/src/memory/path-resolver.ts` — scope resolution + traversal block
- `packages/emmy-tools/src/memory/commands/{view,create,str-replace,insert,delete,rename}.ts` — one file per command
- `packages/emmy-tools/src/memory/quotas.ts` — file-bytes + scope-bytes enforcement
- `packages/emmy-tools/src/memory/types.ts` — TypeBox schemas + result types
- `packages/emmy-tools/test/memory/*.test.ts` — one file per command, plus a path-traversal suite, plus a provenance-stamp suite

## 5 — Telemetry / OTel

Each memory op emits one OTel span under the active tool span:

```
gen_ai.tool.name = "memory"
gen_ai.tool.call.arguments = "<redacted file_text if blocked_extensions match>"
emmy.memory.command = "view" | "create" | ...
emmy.memory.scope = "project" | "global"
emmy.memory.path = "/memories/project/notes/conventions.md"
emmy.memory.bytes = 1234              // for read/write ops
emmy.memory.result = "ok" | "exists" | "not_found" | "quota_exceeded" | "traversal_blocked" | "ambiguous_match"
```

Plus session-aggregate counters in the headless JSON envelope:
```jsonc
"telemetry": {
  "memory_ops": { "view": 3, "create": 1, "str_replace": 2, "insert": 0, "delete": 0, "rename": 0 },
  "memory_bytes_read": 4096,
  "memory_bytes_written": 512
}
```

## 6 — Tool description

Pi-mono ships a deliberately minimal system prompt; new tools should match. Ship the shortest description that gets adoption, measure, and only expand if the model fails to use the tool.

**v1 description (~45 tokens):**

> `memory` — read and write notes that persist across sessions. Two scopes: `/memories/project/...` for repo-specific knowledge, `/memories/global/...` for cross-project preferences. Check what's there before non-trivial work; write notes only when a discovery would help a future session.

**Calibration protocol** (Phase 4.4 verification, see §10): run a 20-task batch (mix of simple and non-trivial) with the v1 description. Measure:

- **Adoption rate:** % of non-trivial tasks where the model called `view /memories` before its first non-memory tool call. Target ≥60% on Qwen 3.6 35B-A3B v3.1.
- **Write discipline:** % of writes that contain a counter-intuitive finding vs. narration of completed work. Target ≥70% load-bearing. Hand-rate the writes from the batch.
- **Rot protection:** when a planted contradicting note is in memory, % of tasks where the model trusts code over the note. Target 100% (this is the only critical-failure dimension).

Only if Adoption < 60% OR Rot Protection < 100% do we extend the description with sterner language. The expansion is **measurement-driven, not speculation-driven** — the SOTA "ALWAYS VIEW MEMORY FIRST" exists in Anthropic's spec because they measured failure without it.

## 7 — Edge cases and failure modes

| Failure mode | Mitigation |
| --- | --- |
| Memory rot (notes contradict current code) | Caught by the §10 verification's rot-protection planted-contradiction test. Optional: `last_updated:` line every note carries. If verification shows <100% rot protection, the §6 description gets a "trust the code" clause added. |
| Unbounded growth | §3.2 quotas (per-file 64 KiB, per-scope 10 MiB). On overflow, `create` returns an error directing the model to consolidate. |
| Secret accumulation | §3.2 `blocked_extensions`. Plus: project memory is gitignored by default; user opts in to commit. Tool description does not promise secrecy. |
| Concurrent writes (parent + child sub-agent) | Phase 4.5 problem, not 4.4. v0 punt: per-agent memory namespaces (`/memories/project/parent/...`, `/memories/project/agents/research/...`). Revisit when Phase 4.5 lands. |
| Symlink escape | Path resolver expands symlinks then re-checks containment. Reject if final path falls outside root. |
| Race between `view` and `str_replace` | The model sees a snapshot at view time and modifies based on it. Two concurrent `str_replace`s on the same file race naturally. v0 acceptance: best-effort; if the second `old_str` no longer matches, return `ambiguous_match` / `not_found` and let the model retry. No flock. |
| Eval reproducibility | §3.3 snapshot/restore + `EMMY_MEMORY_OVERRIDE_*` env precedence. |

## 8 — What this spec deliberately does NOT include

- **Vector embeddings or RAG-over-notes.** The whole point of filesystem memory is that the model picks files by path. Vector retrieval is separate, deferred to v2 if ever.
- **Automatic note generation.** The model decides when to write. No background "summarize this session into memory" job. Implicit writes are how notes go stale; explicit writes go stale slower.
- **Cross-machine sync.** Single-user-local. If you want sync, `git push` your `.emmy/notes/`.
- **Encryption at rest.** The filesystem already provides this if the OS does. Emmy is single-user-local; threat model does not include local-disk attackers (consistent with the broader project's threat model — see `.planning/PITFALLS.md`).
- **Multiple memory backends.** No "swap filesystem for SQLite for Redis." YAGNI; one backend, well-documented.
- **An MCP server wrapper.** If a consumer wants memory-tool-via-MCP, they wrap it themselves. Native pi tool first; MCP layer is a follow-up if anyone asks.

## 9 — Plan-phase intake (when 4.4 enters `/gsd-plan-phase`)

Suggested plan breakdown — 5 plans, sized for the project's "Standard" granularity:

- **04.4-01 — Tool surface + path resolver.** TypeBox schemas, two-scope resolution, traversal block, quota plumbing. ~250 LoC + tests.
- **04.4-02 — Six command implementations.** view/create/str_replace/insert/delete/rename, one file each. ~400 LoC + tests.
- **04.4-03 — Profile schema + harness.yaml integration.** Add `memory.*` block to all four shipped profiles' harness.yaml, defaults, validation. ~150 LoC + a profile-level snapshot test.
- **04.4-04 — Telemetry + OTel events.** GenAI semconv emission, redaction of blocked extensions, headless envelope counters. ~200 LoC + air-gap test extension.
- **04.4-05 — Reproducibility hooks.** `--no-memory`, `--memory-snapshot`, `EMMY_MEMORY_OVERRIDE_*` precedence, snapshot/restore atomicity. ~200 LoC + an end-to-end test that confirms snapshot fidelity.

Note: *"append-only compaction" is the other half of Phase 4.4* — its spec lives in a sibling doc (`COMPACTION-DESIGN.md`). The two halves of Phase 4.4 share no code; they're co-phased because they're both small filesystem-and-prompt work that pairs well in one execute-phase wave.

## 10 — Verification — how we test that the minimal design actually works

Pi minimalism plus measurement is the deal: ship the v1 description (§6), profile defaults (§3.2), and command surface (§2), then run the following tests *before* declaring Phase 4.4 done. If any test misses target, the doc gets revised and the relevant plan reopened — not the description preemptively bloated.

### V1 — Adoption (covers §6 v1 description sufficiency)
**Setup:** 20-task batch under `pi-emmy --batch`, mix of trivial (T1, T2, …) and non-trivial (T11–T20). Memory dir pre-seeded with 5 plausible notes. Run on Qwen 3.6 35B-A3B v3.1.
**Pass:** ≥60% of non-trivial tasks call `view /memories` before their first non-memory tool call. Hand-rate from headless JSON envelopes.
**Fail:** revise §6 to add Anthropic's "VIEW MEMORY FIRST" clause; rerun.

### V2 — Write discipline (covers §6 "write only when load-bearing" intent)
**Setup:** same batch as V1; collect every `create` / `str_replace` write. Hand-rate each as **load-bearing** (counter-intuitive finding, confirmed-working pattern, dead-end others should skip) vs. **narrative** (description of work just done).
**Pass:** ≥70% load-bearing.
**Fail:** §6 gets one explicit "do not write narration" clause added; rerun. (Cheaper than building structural anti-narration enforcement.)

### V3 — Rot protection (critical-failure dimension)
**Setup:** 5 deliberately-mis-stated notes planted in `/memories/project/...` (e.g., "the `Edit` tool requires absolute paths" — wrong, it accepts relative paths in this project). Tasks ask the model to use the contradicted facility.
**Pass:** 100%. Model trusts what it observes from the code over the planted note.
**Fail:** §6 description gets a "trust the code" clause added; rerun. This is the only verification with a 100% target — anything less ships a footgun.

### V4 — Path-traversal block (security)
**Setup:** 30 hostile path inputs (`../`, `..\\`, URL-encoded variants, symlink-out, absolute paths, null-byte injection).
**Pass:** all 30 rejected with `traversal_blocked` result; zero filesystem access outside configured roots.
**Fail:** plan 04.4-01 reopens.

### V5 — Air-gap (covers §3.4)
**Setup:** 100-op stress run (mixed read/write/list) under air-gap CI's `ci_verify_phase3` (STRICT). `strace -e trace=network` or equivalent.
**Pass:** zero outbound network syscalls.
**Fail:** plan 04.4-04 reopens.

### V6 — Snapshot/restore fidelity (covers §3.3 reproducibility)
**Setup:** snapshot a populated `~/.emmy/memory/` to `T0`. Run a session that performs all 6 commands. Restore from `T0`. Diff.
**Pass:** byte-identical to original snapshot.
**Fail:** plan 04.4-05 reopens.

### V7 — Quota enforcement (covers §3.2)
**Setup:** attempt `create` with 65537-byte file (should reject); fill scope to 10 MiB - 1 byte then `create` 2 bytes (should reject); rename within scope at quota boundary (should succeed; renames don't grow bytes).
**Pass:** all three behaviors as specified.
**Fail:** plan 04.4-01 reopens.

### V8 — Real-deal E2E session
**Setup:** 1-hour live session on Qwen 3.6 35B-A3B v3.1 doing real work in this repo. Memory dir starts empty. Operator (or Claude via headless) does meaningful work; observe organic memory use.
**Pass (qualitative):** at session end, `/memories/project/` contains 1–5 notes, each genuinely useful, none narrative. No quota errors. No rot incidents.
**Fail:** revise §6 + rerun V1–V3 with the new description.

**V1–V7 are blocking** for Phase 4.4 acceptance. **V8 is the smoke-test forcing-function** that catches anything V1–V7 missed.
