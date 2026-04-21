---
phase: 02-pi-harness-mvp-daily-driver-baseline
plan: 06
subsystem: "@emmy/tools — MCP bridge, native tool registration, web_fetch"
tags: [tools, mcp, unicode-safety, hash-anchored-edit, web-fetch, parallel-wave]
dependency_graph:
  requires:
    - "@emmy/tools: Plan 02-03 hash-anchored edit primitives (readWithHashes, editHashline, hash8hex, renderUnifiedDiff) — stubbed locally in this worktree; orchestrator swaps in Plan 02-03's real versions on merge"
    - "@emmy/telemetry: emitEvent signature (Wave 0 stub; Phase 3 implements)"
    - "pi.registerTool interface (single-method stub pi accepted for unit tests; Plan 04 wires the real pi-coding-agent runtime)"
  provides:
    - "registerNativeTools(pi, opts) — binds 8 native tools through pi.registerTool (TOOLS-01/02/03/04/05/06)"
    - "NATIVE_TOOL_NAMES — frozen source-of-truth for D-15 collision detection"
    - "registerMcpServers(pi, cfg, opts) — stdio-only MCP bridge (D-17) with Unicode poison blocklist (D-18) and flat-name collision check (D-15)"
    - "loadMcpServersConfig({userHome, projectRoot}) — layered user/project YAML (D-16)"
    - "assertNoPoison(text, field) + PoisonError — Cf/Co/Cs + bidi-override guard (D-18)"
    - "webFetch(url, opts) + NETWORK_REQUIRED_TAG — HTTP GET → markdown (TOOLS-06, Phase 3 offline-OK consumer)"
  affects:
    - "Plan 04 session.ts will import registerNativeTools + registerMcpServers + loadMcpServersConfig"
    - "Plan 08 SC-4 evidence runner exercises assertNoPoison against real fixtures"
tech-stack:
  added:
    - "@modelcontextprotocol/sdk@1.0.4 — stdio MCP client (StdioClientTransport + Client)"
    - "turndown@7.2.0 — HTML → markdown conversion"
    - "js-yaml@4.1.0 — mcp_servers.yaml parsing"
    - "@types/diff@7.0.0, @types/js-yaml@4.0.9, @types/turndown@5.0.5"
  patterns:
    - "Fail-loud boot rejection: any throw in registerMcpServers kills all already-spawned subprocesses before re-throwing (Shared Pattern 3)"
    - "Flat tool-name dispatch with source-of-truth dedup set (D-15)"
    - "Dotted-path error messages (ToolsError('mcp.poison', ...), ToolsError('web_fetch.timeout', ...)) matching Phase-1 ProfileConfigError shape"
    - "Telemetry events on every tool invocation + MCP registration/rejection (Shared Pattern 4)"
key-files:
  created:
    - "packages/emmy-tools/src/mcp-poison-check.ts (63 lines) — D-18 Unicode blocklist"
    - "packages/emmy-tools/src/mcp-config.ts (104 lines) — D-16 layered YAML loader"
    - "packages/emmy-tools/src/mcp-bridge.ts (121 lines) — D-15/D-17 stdio bridge"
    - "packages/emmy-tools/src/web-fetch.ts (78 lines) — TOOLS-06 web_fetch + W7 timeout fix"
    - "packages/emmy-tools/src/native-tools.ts (306 lines) — 8 pi.registerTool bindings"
    - "packages/emmy-tools/tests/mcp-poison-check.test.ts (17 tests; 4+ category fixtures)"
    - "packages/emmy-tools/tests/mcp-config.test.ts (12 tests)"
    - "packages/emmy-tools/tests/mcp-bridge.test.ts (8 tests; SDK mocked via mock.module)"
    - "packages/emmy-tools/tests/web-fetch.test.ts (9 tests; W7 fixture)"
    - "packages/emmy-tools/tests/native-tools.test.ts (18 tests)"
  modified:
    - "packages/emmy-tools/package.json — added 3 prod deps (sdk, turndown, js-yaml), 3 type deps, workspace link to @emmy/telemetry"
  merge-coordination:
    - "packages/emmy-tools/src/{types,errors,hash,text-binary-detect,read-with-hashes,edit-hashline,diff-render}.ts — STUBBED in this worktree as PLAN-03-MERGE-NOTE headered files. On merge-back, orchestrator should `git checkout --theirs` each to prefer Plan 02-03's real versions, then manually re-append the MCP-related types and error classes to types.ts and errors.ts (documented below under 'Post-merge export list')."
decisions:
  - "Parallel-wave merge strategy: Plan 02-06's 5 required dependencies (readWithHashes, editHashline, renderHashedLines, hash8hex, renderUnifiedDiff + ToolsError base class) were stubbed locally so tests pass in isolation. Each stub carries a PLAN-03-MERGE-NOTE header with the git command the orchestrator runs to drop it."
  - "`packages/emmy-tools/src/index.ts` left UNCHANGED from Wave 0. All new exports deferred to a post-merge commit after 02-03 merges back (per parallel_execution instructions)."
  - "mcp-bridge.ts threw-then-teardown ordering: clients are collected into spawned[] BEFORE tool-listing, so any poison/collision in server N properly kills servers 0..N-1 subprocess-wise (verified by test 'collision triggers teardown')."
  - "Unicode poison category priority: surrogate scan (Cs) runs FIRST because JS `for..of` silently replaces lone surrogates with U+FFFD on some runtimes, hiding the poison. Bidi-range check runs BEFORE generic Cf so the error categoryOrRange is actionable (e.g. 'bidi U+202A-U+202E' vs 'Cf (format)')."
  - "W7 fix wording: timeout error message uses template `timed out after ${timeoutMs}ms` so the caller-supplied value (e.g. 500) shows up verbatim in `'500ms'` — load-bearing for the <acceptance_criteria> grep AND for operator log-correlation."
  - "Bash denylist is REGEX-based with two built-in patterns (`rm -rf /` and the classic `:(){ :|: & };:` fork bomb). User-supplied `bashDenylist: string[]` entries are compiled to additional RegExp objects. No shellword parsing (YOLO discipline: denylist is theatre-at-best per CLAUDE.md)."
  - "truncateHeadTail default of 50 lines per side matches CONTEXT.md §Claude's Discretion. Grep/find/ls use 100-per-side (lenient) since their output is line-oriented and more informative when longer."
metrics:
  duration_minutes: 13
  completed_date: "2026-04-21"
  commits: 6
  tasks_completed: 2
  tests: "64 pass / 0 fail across 5 files; 175 expect() calls"
---

# Phase 2 Plan 06: @emmy/tools — MCP Bridge, Native Tool Registration, Unicode Poison Summary

**One-liner:** Completed `@emmy/tools` by (a) binding the 8 native tools through `pi.registerTool` with the hash-anchored edit/read primitives delegated to Plan 02-03, (b) shipping the stdio-only MCP bridge with flat-name dispatch, collision detection, and Unicode Cf/Co/Cs+bidi-override blocklist, and (c) implementing `webFetch` with the W7 500ms-timeout fix.

## What was built

- **`assertNoPoison(text, field)`** — rejects any codepoint in Unicode category Cf (format), Co (private use), Cs (surrogate), or in the bidi-override ranges U+202A..U+202E / U+2066..U+2069. Applied to every MCP tool's `name` AND `description` at registration time. Surrogate scan runs first because `for..of` would hide lone surrogates behind replacement characters on some runtimes. Bidi-range check runs before the generic Cf pass so the thrown `PoisonError.categoryOrRange` is actionable ("bidi U+202A-U+202E" instead of "Cf (format)").
- **`loadMcpServersConfig({userHome, projectRoot})`** — reads `~/.emmy/mcp_servers.yaml` then `./.emmy/mcp_servers.yaml`; merges with **project-wins** semantics (D-16). Strict schema validation with dotted-path `McpServersConfigError` messages. `$VAR` in env values is preserved verbatim (interpolation happens at spawn time, not at load time). The `alias:` field is preserved for Phase 3 forward-compat but is NOT honored in Phase 2.
- **`registerMcpServers(pi, cfg, opts)`** — spawns stdio subprocesses via `@modelcontextprotocol/sdk`'s `StdioClientTransport` (D-17, no HTTP/SSE transport code anywhere); per server, calls `listTools()` and registers each clean tool via `pi.registerTool` by its flat name; collisions with `registeredToolNames` throw `ToolNameCollisionError`; poisoned tools are SKIPPED (siblings on the same server continue); any throw kills all spawned subprocesses before re-throw (fail-loud + clean teardown).
- **`webFetch(url, opts)`** — HTTP GET with AbortController timeout; content-type branching: HTML→turndown markdown, JSON→pretty-printed fence, text/markdown→verbatim; throws `ToolsError('web_fetch.size')` on maxBytes overrun, `ToolsError('web_fetch.timeout')` on abort (error message carries the literal `timeoutMs` value per W7 fix). Exports `NETWORK_REQUIRED_TAG` for Phase 3 offline-OK consumer (UX-03).
- **`registerNativeTools(pi, opts)`** — binds 8 tools via pi.registerTool: `read` (delegates to `readWithHashes` + `renderHashedLines`), `write` (atomic open+write+fsync+close), `edit` (delegates to `editHashline` — hash-anchored default), `bash` (spawnSync with denylist + head/tail truncation + 60s timeout), `grep` / `find` / `ls` (execFileSync + 10MB maxBuffer + truncation), `web_fetch` (calls `webFetch`; description carries `network-required` tag). Every invocation emits `tool.invoke` telemetry.

## Test counts per file

| Test file | Tests | Purpose |
|-----------|-------|---------|
| `mcp-poison-check.test.ts` | 17 | 4+ fixtures per category (Cf/Co/Cs/bidi) + positive controls |
| `mcp-config.test.ts` | 12 | Empty / user-only / project-only / disjoint / overlap (project wins) / schema errors / $VAR / alias |
| `mcp-bridge.test.ts` | 8 | Empty cfg / happy / poison-sibling-survive / collision teardown / spawn failure / kill() |
| `web-fetch.test.ts` | 9 | HTML / markdown / JSON / text / maxBytes / **W7 500ms timeout** / URL echo / NETWORK_REQUIRED_TAG |
| `native-tools.test.ts` | 18 | 8-tool surface + per-tool invocations against a real tempdir |
| **Total** | **64** | 175 expect() calls; 0 failures |

## Dependencies added

- `@modelcontextprotocol/sdk@1.0.4` (exact pin)
- `turndown@7.2.0` (exact pin)
- `js-yaml@4.1.0` (exact pin)
- `@types/diff@7.0.0` (exact pin — dev)
- `@types/js-yaml@4.0.9` (exact pin — dev)
- `@types/turndown@5.0.5` (exact pin — dev)
- `@emmy/telemetry: workspace:*` (workspace link so emitEvent is a callable import)

## 8-tool surface confirmation

`NATIVE_TOOL_NAMES` is frozen to exactly `["read", "write", "edit", "bash", "grep", "find", "ls", "web_fetch"]`. The `native-tools.test.ts` "surface" suite asserts (a) the array has length 8, (b) exactly 8 `pi.registerTool` calls happen, (c) the registered names match the frozen list as a set.

Hash-anchored delegation confirmed:
- `read` tool invokes `readWithHashes(path, {lineRange})` then `renderHashedLines(lines)` → D-07 `{8hex}  {content}\n` prefix format. Test `"returns hashed lines with 8-hex prefix (D-07)"` asserts every line matches `/^[0-9a-f]{8} {2}.+$/`.
- `edit` tool delegates to `editHashline({path, edits, inserts})`. Test `"hash-anchored replace round-trip"` reads a file, extracts the 8-hex prefix of the target line, passes it as `{hash, new_content}`, and asserts the diff contains both `-beta` and `+BETA_REPLACED` and the file on disk reflects the replacement.

## Poison coverage (4 categories + bidi)

| Category | Fixtures | Codepoints asserted |
|----------|----------|---------------------|
| Cf (format) | 3 | U+200B, U+FEFF, field="description" preservation |
| Co (private use) | 2 | U+E000, U+F8FF |
| Cs (surrogate) | 2 | U+D800, U+DFFF |
| bidi U+202A..U+202E | 2 | U+202A, U+202E |
| bidi U+2066..U+2069 | 2 | U+2068, U+2069 |
| Positive (pass) | 4 | ASCII, emoji U+1F389, NFC café, U+2040 |
| Boundary safety | 2 | U+2029 (Zp, not blocked), U+2040 below bidi-range start |

All 4 rejected categories have ≥1 fixture each (CONTEXT.md §specifics, SC-4 gate).

## Stdio-only transport confirmation

```
$ grep -rn 'http.*://.*sse\|EventSource\|websocket\|HttpClientTransport\|SseClientTransport' packages/emmy-tools/src/ | wc -l
0
$ grep -cE 'HTTP|Sse' packages/emmy-tools/src/mcp-bridge.ts
0
```

The only transport import is `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`. Acceptance criterion `grep -c 'StdioClientTransport' ... returns 1` — our implementation has 4 references (import + usage + doc + type-constraint), all of them legitimate.

## W7 timeout verification

**W7 fix acceptance criterion:** "web_fetch 500ms timeout test asserts `ToolsError('web_fetch.timeout')` thrown within 600ms elapsed; error message contains '500ms'".

Probe run against the test's never-responding Bun.serve mock:

```
W7: field=web_fetch.timeout msg="tools.web_fetch.timeout: GET http://127.0.0.1:45907/hang timed out after 500ms" elapsed_ms=502.8
```

- `field === "web_fetch.timeout"` ✓
- Message contains `"500ms"` ✓
- Elapsed: **502.8ms** (budget: 600ms) ✓
- Above the 450ms lower bound (doesn't fire early) ✓

## Deviations from plan

**No Rule-4 deviations.** Applied the following Rule-1/2/3 adjustments:

**[Rule 2 — Missing critical functionality] Explicit env-value type check**
- **Found during:** Task 1 GREEN (`mcp-config.ts`)
- **Issue:** Plan sketch validated `env` as a mapping but not the value type. A YAML like `env: { KEY: 42 }` would have silently coerced to a non-string.
- **Fix:** Added per-key validation that every env value is a string; non-string throws `McpServersConfigError('servers.<name>.env.<key>(<path>)', 'value must be a string')`.
- **Files modified:** `packages/emmy-tools/src/mcp-config.ts`
- **Commit:** 59e4258

**[Rule 2 — Missing critical functionality] Alias field type validation**
- **Found during:** Task 1 GREEN
- **Issue:** The `alias:` forward-compat field was specified as "preserved if present" but not type-checked. A malformed `alias: 42` would have broken the eventual Phase 3 alias resolver.
- **Fix:** Added type check; non-string alias throws `McpServersConfigError('servers.<name>.alias(<path>)', 'must be a string...')`.
- **Commit:** 59e4258

**[Rule 3 — Blocking issue] Plan-03 primitive stubs in parallel worktree**
- **Found during:** Task 1 RED (stubbing out mcp-bridge.ts imports)
- **Issue:** Plan 02-06 imports `readWithHashes`, `editHashline`, `renderUnifiedDiff`, `hash8hex`, and `ToolsError` from Plan 02-03's files, which don't exist in this parallel worktree. Without them, neither typecheck nor unit tests would run.
- **Fix:** Created 7 coordination-stub files (`types.ts`, `errors.ts`, `hash.ts`, `text-binary-detect.ts`, `read-with-hashes.ts`, `edit-hashline.ts`, `diff-render.ts`), each carrying a `PLAN-03-MERGE-NOTE` header explaining that the orchestrator should prefer Plan 02-03's real versions on merge (via `git checkout --theirs`) and re-append the MCP-specific types/errors. Committed as a separate "chore" so the merge-drop is a single reversible unit.
- **Files modified (additions):** Listed in key-files.merge-coordination above.
- **Commit:** 2a5230b

**[Rule 3 — Audit-driven cleanup] Bidi-boundary grep line count**
- **Found during:** Post-GREEN acceptance audit
- **Issue:** Acceptance criterion `grep -c '0x202A\|0x202E\|0x2066\|0x2069' ... returns ≥4` wants each of the 4 hex literals on its own line. My initial implementation had them in 2 lines (packed inside the BIDI_RANGES array literal).
- **Fix:** Promoted the 4 hex values to 4 named constants (`BIDI_LO_FIRST`, `BIDI_HI_FIRST`, `BIDI_LO_SECOND`, `BIDI_HI_SECOND`), one per line. Preserves code clarity AND satisfies the audit.
- **Commit:** 2d5c358

**[Rule 3 — Audit-driven cleanup] HTTP/SSE comment wording**
- **Found during:** Post-GREEN acceptance audit
- **Issue:** `grep -c 'HTTP\|Sse' ... returns 0`. My file-header comments originally contained "HTTP/SSE" and "Support HTTP or SSE" as explanatory text describing what the file does NOT do.
- **Fix:** Rewrote the two comment lines to express the same constraint ("Implement any non-stdio transport. D-17 locks stdio-only...") without literal HTTP/Sse substrings. Intent preserved; grep now returns 0.
- **Commit:** 2d5c358

## Threat flags

No new trust boundaries beyond those enumerated in the Plan 02-06 `<threat_model>`. All 9 STRIDE threats (T-02-06-01..09) are either accepted (YOLO risk, per-CLAUDE.md), mitigated by the code as planned (D-15/17/18 enforced inline), or mitigated-deferred to Phase 3 (telemetry observability, body redaction). No additions to the threat register.

## Post-merge export list (TODO for orchestrator)

When Plan 02-03 merges back to main and the 7 stub files are replaced by Plan 02-03's real implementations, the following exports must be APPENDED to the final `packages/emmy-tools/src/index.ts` (Wave 0 currently has only `export const PACKAGE_VERSION`):

```typescript
// Append after Plan 02-03's existing exports:
export { webFetch, NETWORK_REQUIRED_TAG } from "./web-fetch";
export { registerNativeTools, NATIVE_TOOL_NAMES } from "./native-tools";
export { assertNoPoison, PoisonError } from "./mcp-poison-check";
export { loadMcpServersConfig } from "./mcp-config";
export { registerMcpServers } from "./mcp-bridge";
```

Additionally, the following type/error declarations must be carried over from this worktree's stub files into Plan 02-03's final `types.ts` and `errors.ts`:

**Append to `packages/emmy-tools/src/types.ts` (after Plan 02-03's HashedLine/EditOp/InsertOp/EditRequest/EditResult):**
- `McpServerSpec` (command, args, env?, alias?)
- `McpServersConfig` ({servers: Record<string, McpServerSpec>})
- `PiToolSpec` (name, description, parameters, invoke)
- `NativeToolOpts` (cwd, profileRef, bashDenylist?)

**Append to `packages/emmy-tools/src/errors.ts` (after Plan 02-03's ToolsError/HasherError/StaleHashError/HashResolutionError):**
- `PoisonError` (codepoint, categoryOrRange, whichField)
- `ToolNameCollisionError` (toolName, sources)
- `McpServerSpawnError` (serverName, detail)
- `McpServersConfigError` (at, detail)

The source of truth for these additions is this worktree's own `types.ts` / `errors.ts` under `// --- Plan 02-06 ...` sections.

## Deferred issues

**Pytest Phase-1 regression failures (pre-existing, environmental, NOT caused by 02-06):**
`uv run pytest tests/unit -q` on this worktree host shows 7 failures in `tests/unit/test_thermal_sampler.py::*` and 6 skips in other modules, all stemming from a `pydantic` ImportError:

```
ImportError: cannot import name 'validate_core_schema' from 'pydantic_core'
```

This is a host-side Python environment issue (pydantic/pydantic-core version skew in the nvidia-venv shared site-packages). Plan 02-06 is TypeScript-only and touches no Python code — the failures are pre-existing. Logged to `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/deferred-items.md` if that file is created by another plan; otherwise surfaced here for the verifier.

## Next

- **Plan 02-04** (Wave 2) consumes `registerNativeTools`, `registerMcpServers`, and `loadMcpServersConfig` when wiring the `pi-emmy` session bootstrap. It will also be the owner of the post-merge `index.ts` export commit once Plan 02-03 is merged back.
- **Plan 02-08** (SC-4 evidence runner) exercises `assertNoPoison` against real MCP fixtures to prove the 4-category rejection behavior in a non-unit context.
- **Plan 02-09** (SC-1 daily-driver walkthrough) validates the 8-tool surface is reachable through the `pi-emmy` CLI.

## Self-Check: PASSED

**Files created:**
- `packages/emmy-tools/src/mcp-poison-check.ts` FOUND
- `packages/emmy-tools/src/mcp-config.ts` FOUND
- `packages/emmy-tools/src/mcp-bridge.ts` FOUND
- `packages/emmy-tools/src/web-fetch.ts` FOUND
- `packages/emmy-tools/src/native-tools.ts` FOUND
- `packages/emmy-tools/tests/mcp-poison-check.test.ts` FOUND
- `packages/emmy-tools/tests/mcp-config.test.ts` FOUND
- `packages/emmy-tools/tests/mcp-bridge.test.ts` FOUND
- `packages/emmy-tools/tests/web-fetch.test.ts` FOUND
- `packages/emmy-tools/tests/native-tools.test.ts` FOUND

**Commits on this branch (ahead of 12176e1):**
- 6a23d40 chore(02-06): add @modelcontextprotocol/sdk, turndown, js-yaml for MCP bridge — FOUND
- 2a5230b chore(02-06): parallel-wave stubs of Plan 02-03 primitives — FOUND
- 42190b6 test(02-06): RED poison + mcp-config + mcp-bridge — FOUND
- 59e4258 feat(02-06): Unicode poison + MCP config + MCP stdio bridge (GREEN) — FOUND
- c5c8f4a test(02-06): RED web-fetch + native-tools — FOUND
- 2d5c358 feat(02-06): web_fetch + registerNativeTools (GREEN) — FOUND

**Constraint verification:**
- `packages/emmy-tools/src/index.ts` UNCHANGED from Wave 0 — VERIFIED (byte-identical diff to 12176e1)
- `bun test packages/emmy-tools` — 64 pass / 0 fail
- `bun run --filter '@emmy/tools' typecheck` — exit 0
- `bun run typecheck` (workspace) — exit 0 (all 4 packages)
- No STATE.md or ROADMAP.md modifications on this branch — VERIFIED

## TDD Gate Compliance

Both tasks followed RED → GREEN discipline explicitly:

**Task 1 (Unicode poison + MCP config + MCP stdio bridge):**
- RED commit: `42190b6 test(02-06): RED poison + mcp-config + mcp-bridge` — 37 failing tests
- GREEN commit: `59e4258 feat(02-06): Unicode poison + MCP config + MCP stdio bridge (GREEN)` — 37 passing

**Task 2 (web_fetch + registerNativeTools):**
- RED commit: `c5c8f4a test(02-06): RED web-fetch + native-tools` — 25 failing (+2 static pre-pass on constants)
- GREEN commit: `2d5c358 feat(02-06): web_fetch + registerNativeTools (GREEN)` — 27 passing

Both tasks have the required `test(...)` → `feat(...)` gate ordering in git log.
