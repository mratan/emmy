---
phase: 02-pi-harness-mvp-daily-driver-baseline
plan: 03
subsystem: tools
tags: [hash-anchored-edit, hashline, sha-256, d-05, d-06, d-07, d-08, d-09, tools-08, atomic-write, unified-diff, bun, typescript, emmy-tools]

# Dependency graph
requires:
  - phase: 02-pi-harness-mvp-daily-driver-baseline
    provides: Wave 0 scaffold — @emmy/tools package shell + pi-coding-agent 0.68.0 pin + Bun workspace (Plan 02-01)
  - phase: 01-serving-foundation-profile-schema
    provides: emmy_serve/profile/hasher.py (SHA-256 + NFC + CRLF/CR→LF text normalization) — Plan 02-03 mirrors the discipline on the TS side; emmy_serve/diagnostics/atomic.py (fsync-then-rename) — writeAtomic() copies the pattern
provides:
  - hash8hex(text) — SHA-256 truncated to first 8 hex chars (D-06); consumers: readWithHashes, editHashline, future profile-related TS code
  - normalizeText(raw) — NFC → CRLF→LF → CR→LF with lone-surrogate rejection; Phase 1 hasher parity (modulo the D-06 truncation)
  - isBinary(buf) — NUL-byte scan (first 8 KiB) + UTF-8 round-trip; D-08 fallback trigger
  - readWithHashes(absPath, opts?) — returns {content, lines:HashedLine[], path, binary}; binary files short-circuit to base64 content + empty lines
  - renderHashedLines(lines) — emits `{8hex}  {content}\n` per line (D-07, EXACTLY two spaces)
  - editHashline(req) — DEFAULT edit format (D-05 per-line, D-09 payload shape); atomic write; post-hoc unified diff on every successful edit (TOOLS-08)
  - renderUnifiedDiff(before, after, path) — createTwoFilesPatch → `--- a/<path>` / `+++ b/<path>` headers
  - ToolsError / HasherError / StaleHashError / HashResolutionError — dotted-path message classes (Plan 06 extends with PoisonError + ToolNameCollisionError additively)
  - EditRequest / EditResult / EditOp / InsertOp / HashedLine — public types
affects: [02-06, 02-08, 02-09]

# Tech tracking
tech-stack:
  added:
    - diff 7.0.0 (prod) — unified-diff renderer via createTwoFilesPatch
    - "@types/diff 7.0.0 (dev)"
  patterns:
    - "Hash-anchored edits as default (Hashline) — D-05 per-line; hash = SHA-256 truncated to 8 hex chars (D-06); payload = {edits:[{hash,new_content}],inserts:[{after_hash,insert}]} (D-09)"
    - "Atomic write discipline mirrored from emmy_serve/diagnostics/atomic.py: dot-prefixed temp file in the same dir (so rename is atomic on the same FS), fsync before close, rename on success, unlink on rename failure"
    - "Fresh re-read on every edit — advisory hashesFromLastRead is ignored; text files STAY on hash-anchored path under stale-hash (re-read, re-anchor, re-edit) per D-08"
    - "Atomic-fail validation — ALL anchors validated BEFORE any mutation; no partial writes possible (either the full {edits,inserts} batch succeeds or the file is untouched)"
    - "Module-namespace fs imports (`import * as fs from 'node:fs'`) so spyOn(fs, 'renameSync') in tests can intercept — destructured binds lock the reference at import time and bypass the spy"
    - "Dotted-path error messages: `tools.<field>: <message>` — Plan 06 extends errors.ts additively (PoisonError, ToolNameCollisionError, etc.)"
    - "Cross-language shape fidelity: TS `hash8hex` ↔ Python `hasher._hash_file` — same SHA-256, same NFC + CRLF/CR→LF normalization, only difference is the D-06 8-char slice"

key-files:
  created:
    - packages/emmy-tools/src/types.ts (EditRequest, EditResult, EditOp, InsertOp, HashedLine)
    - packages/emmy-tools/src/errors.ts (ToolsError, HasherError, StaleHashError, HashResolutionError — Plan 06 will APPEND more here)
    - packages/emmy-tools/src/hash.ts (hash8hex + normalizeText; single `.slice(0, 8)` call site per D-06)
    - packages/emmy-tools/src/text-binary-detect.ts (isBinary — NUL scan first 8 KiB + UTF-8 round-trip)
    - packages/emmy-tools/src/read-with-hashes.ts (readWithHashes + renderHashedLines — D-07 two-space separator)
    - packages/emmy-tools/src/edit-hashline.ts (editHashline + writeAtomic; D-05/D-09 implementation; 174 LoC)
    - packages/emmy-tools/src/diff-render.ts (renderUnifiedDiff via createTwoFilesPatch)
    - packages/emmy-tools/tests/hash.test.ts (13 cases)
    - packages/emmy-tools/tests/text-binary-detect.test.ts (9 cases)
    - packages/emmy-tools/tests/read-with-hashes.test.ts (9 cases — 6 readWithHashes + 3 renderHashedLines)
    - packages/emmy-tools/tests/diff-render.test.ts (5 cases)
    - packages/emmy-tools/tests/edit-hashline.test.ts (16 cases, including spy-based atomic-crash simulation)
    - .planning/phases/02-pi-harness-mvp-daily-driver-baseline/deferred-items.md (pre-existing Phase 1 Python test_thermal_sampler failures — unrelated to 02-03)
  modified:
    - packages/emmy-tools/package.json (added diff 7.0.0 prod dep + @types/diff 7.0.0 dev dep)
    - packages/emmy-tools/src/index.ts (re-exports: types, errors, hash8hex, normalizeText, isBinary, readWithHashes, renderHashedLines, renderUnifiedDiff, editHashline — 8 export statements; Plan 06 appends its own)
    - bun.lock

key-decisions:
  - "Use createTwoFilesPatch (not createPatch) in diff-render.ts — needed to emit `--- a/<path>` / `+++ b/<path>` prefixes that the plan's behavior contract requires. createPatch treats its header args as timestamp columns and puts a single filename on both lines, which doesn't match standard unified-diff `a/` / `b/` convention."
  - "Import fs as namespace (`import * as fs from 'node:fs'`) in edit-hashline.ts rather than destructured, so the atomic-write crash test can spy on renameSync. Documented in a code comment so future edits don't inadvertently change to destructured imports."
  - "Lone-surrogate rejection happens BEFORE String.prototype.normalize('NFC'). NFC on a lone surrogate silently preserves it, but we want HasherError with 'lone surrogate' in the message. Matches the spirit of Python's behavior (raw.decode('utf-8') raises UnicodeDecodeError on lone surrogates)."
  - "writeAtomic places temp file as `.<basename>.<pid>.<4-hex>.tmp` in the SAME directory as the destination — required for rename to be atomic on the same filesystem. Mirrors emmy_serve/diagnostics/atomic.py:write_bytes_atomic's NamedTemporaryFile dir= and dot-prefix discipline."

patterns-established:
  - "D-05 per-line anchor granularity — canonical Hashline (weak-model empirical evidence: 6.7 → 68.3% on 180 tasks)"
  - "D-06 SHA-256 truncated to 8 hex chars — exactly one `.slice(0, 8)` call site in hash.ts"
  - "D-07 read-tool output format: `{8hex}  {line_content}\\n` with EXACTLY two spaces between hash and content"
  - "D-08 fallback trigger confined to binary files or newly-created files (no prior read). Text files under stale-hash STAY on the hash-anchored path — re-read, re-anchor, re-edit. No silent drift to string-replace on text."
  - "D-09 payload shape: {edits:[{hash,new_content}],inserts:[{after_hash,insert}]}. new_content:null = delete. inserts are a sibling op with `after_hash:''` reserved for new-file creation."
  - "TOOLS-08 post-hoc unified diff returned with every successful edit — visible even in YOLO mode"
  - "Atomic-fail mutation: validate ALL anchors before ANY write; failure leaves disk untouched"

requirements-completed: [TOOLS-01, TOOLS-03, TOOLS-08]

# Metrics
duration: ~38min
completed: 2026-04-21
---

# Phase 2 Plan 3: Hash-Anchored Edit Primitives Summary

**Hash-anchored edit primitives for `@emmy/tools`: SHA-256/8-hex helper (D-06) + NFC-preserving text normalization, binary/text detect for the D-08 fallback trigger, D-07 read-with-hashes renderer, the D-05/D-09 `editHashline` default with atomic write, and a post-hoc unified-diff renderer (TOOLS-08) — all delivered via TDD (52 tests, 105 expect() calls, 100% green).**

## Performance

- **Duration:** ~38 min (4 commits: RED → GREEN × 2)
- **Started:** 2026-04-21T21:17:00Z
- **Completed:** 2026-04-21T21:55:02Z
- **Tasks:** 2 / 2
- **Files created:** 13 (7 src + 5 test + 1 deferred-items.md)
- **Files modified:** 3 (package.json, src/index.ts, bun.lock)

## Accomplishments

- **Hash primitives (D-06)** — `hash8hex` with SHA-256 + NFC + CRLF/CR→LF normalization + 8-char truncation. Parity with emmy_serve/profile/hasher.py modulo truncation. Lone-surrogate rejection with HasherError. 13 tests.
- **Binary/text detect (D-08)** — `isBinary(buf)` via NUL scan (first 8 KiB) + UTF-8 round-trip. No external `istextorbinary` dep needed per CONTEXT.md Claude's discretion. 9 tests (empty buf, ASCII, emoji/high-plane, NUL mid-buf, non-UTF-8, isolated continuation byte, PNG signature).
- **Read-with-hashes (D-07)** — `readWithHashes` returns `{content, lines:HashedLine[], path, binary}` with 1-based line numbers; binary files short-circuit to base64 content + empty lines array. `renderHashedLines` emits exact `{8hex}  {content}\n` format (two-space separator). CRLF file yields identical hashes to the LF equivalent. 9 tests including `lineRange` slicing.
- **Edit-hashline (D-05 + D-09)** — `editHashline` re-reads fresh on every call, validates ALL anchors before any mutation (atomic-fail), supports replace / delete (`new_content: null`) / insert (`{after_hash, insert:[...]}`). New-file creation via `after_hash: ""`. All failure modes have named errors with dotted-path messages: `edit.stale_hash`, `edit.hash_resolution` (duplicate/missing), `edit.new_content_multiline`, `edit.binary`, `edit.new_file`, `edit.insert_empty_anchor`.
- **Atomic write** — `writeAtomic` with dot-prefixed temp file in the same dir, fsync before close, rename on success, unlink on rename failure. Test uses `spyOn(fs, 'renameSync')` to simulate a crash between write and rename: target file byte-identical, no temp leaked.
- **Post-hoc unified diff (TOOLS-08)** — `renderUnifiedDiff` via `createTwoFilesPatch` emits `--- a/<path>` / `+++ b/<path>` headers. Returned in `EditResult.diff` on every successful edit — visible even in YOLO mode.

## Task Commits

1. **Task 1 RED** — `ce418d6` (test) — 4 test files + 4 module stubs + types.ts + errors.ts; 34 failing tests as expected.
2. **Task 1 GREEN** — `79327bd` (feat) — hash.ts + text-binary-detect.ts + read-with-hashes.ts + diff-render.ts implementations; `diff@7.0.0` + `@types/diff@7.0.0` added; 36 tests green.
3. **Task 2 RED** — `725249a` (test) — edit-hashline.test.ts (16 cases including atomic-crash spy) + edit-hashline.ts stub + index.ts re-export; 16 failing tests as expected.
4. **Task 2 GREEN** — `1ee3dda` (feat) — edit-hashline.ts full implementation with writeAtomic; 16 tests green.

_TDD cycle preserved: a `test(02-03)` commit precedes each `feat(02-03)` commit._

## Files Created/Modified

**Source (7 new + 1 modified):**
- `packages/emmy-tools/src/types.ts` — EditRequest, EditResult, EditOp, InsertOp, HashedLine
- `packages/emmy-tools/src/errors.ts` — ToolsError, HasherError, StaleHashError, HashResolutionError (Plan 06 APPENDS here)
- `packages/emmy-tools/src/hash.ts` — hash8hex + normalizeText (38 LoC, single `.slice(0, 8)` site)
- `packages/emmy-tools/src/text-binary-detect.ts` — isBinary (20 LoC)
- `packages/emmy-tools/src/read-with-hashes.ts` — readWithHashes + renderHashedLines (40 LoC)
- `packages/emmy-tools/src/edit-hashline.ts` — editHashline + writeAtomic (177 LoC)
- `packages/emmy-tools/src/diff-render.ts` — renderUnifiedDiff (23 LoC)
- `packages/emmy-tools/src/index.ts` (modified) — 8 export statements covering only the Plan 02-03 primitives. Plan 06 will APPEND its own exports during merge-back (explicit coordination note from prompt).

**Tests (5 new):**
- `packages/emmy-tools/tests/hash.test.ts` (76 LoC, 13 cases)
- `packages/emmy-tools/tests/text-binary-detect.test.ts` (44 LoC, 9 cases)
- `packages/emmy-tools/tests/read-with-hashes.test.ts` (121 LoC, 9 cases)
- `packages/emmy-tools/tests/diff-render.test.ts` (38 LoC, 5 cases)
- `packages/emmy-tools/tests/edit-hashline.test.ts` (262 LoC, 16 cases)

**Manifest + lockfile (2 modified):**
- `packages/emmy-tools/package.json` — added `diff@7.0.0` prod + `@types/diff@7.0.0` dev (exact pins, no ^/~)
- `bun.lock` — resolved the diff graph

**Supporting (1 new):**
- `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/deferred-items.md` — pre-existing Phase 1 Python `test_thermal_sampler` failures (7 tests, pydantic_core import error), confirmed via `git stash` to be unrelated to 02-03.

## D-05..D-09 Coverage Matrix (grep-verifiable)

| Locked decision | Implementation evidence | Test evidence |
|---|---|---|
| **D-05** per-line anchor | `hashToIdx: Map<string, number[]>` in edit-hashline.ts line 80; fresh.lines.forEach per-line indexing | replace/delete/insert tests in edit-hashline.test.ts |
| **D-06** SHA-256 truncated to 8 hex | `createHash("sha256")...digest("hex").slice(0, 8)` in hash.ts (single call site, `grep -c '.slice(0, 8)'` = 1) | `output is 8 lowercase hex chars` + `/^[0-9a-f]{8}$/` regex in hash.test.ts |
| **D-07** `{8hex}  {content}\n` | `${l.hash}  ${l.content}\n` in read-with-hashes.ts line 39 (EXACTLY two spaces) | `exact two-space separator, newline per line` in read-with-hashes.test.ts |
| **D-08** fallback only on binary/new-file | `if (fresh.binary) throw ToolsError("edit.binary", ...)` (text files stay on hash path); `if (!fileExists) { ... after_hash:"" } else { throw edit.insert_empty_anchor }` | `binary file → ToolsError('edit.binary')` + `non-existent path + one insert with after_hash:'' → file created` + `existing file + after_hash:'' → edit.insert_empty_anchor` |
| **D-09** `{edits, inserts}` shape | EditRequest interface in types.ts + full edit/insert handling in edit-hashline.ts; new_content:null deletes; inserts sorted descending by anchor index | replace + delete + insert + combined tests in edit-hashline.test.ts |
| **TOOLS-08** post-hoc diff | `diff: renderUnifiedDiff(...)` in EditResult on every successful edit path (lines 44 + 142) | `successful edit emits non-empty diff — TOOLS-08` + all happy-path tests check `--- a/` and `+++ b/` headers |

## Atomic-Write Crash Test Result

Test `atomic-write crash between write and rename — target unchanged, temp cleaned` passes green.

- Spy installed on `fs.renameSync` to throw once.
- Target file contents re-read post-failure: **byte-identical** to pre-edit state.
- `readdirSync(dir)` before vs after: **identical** (no orphan `.<basename>.<pid>.<4-hex>.tmp` file left behind).
- Confirms writeAtomic's unlink-on-rename-failure branch.

## Phase-1-Hasher Parity

TS `normalizeText` in hash.ts applies:
1. Lone-surrogate rejection (UTF-16 specific; Python's `bytes.decode("utf-8")` would raise `UnicodeDecodeError` on equivalent invalid UTF-8 — same fail-loud intent).
2. `String.prototype.normalize('NFC')` ↔ Python `unicodedata.normalize("NFC", text)`.
3. `.replace(/\r\n/g, '\n').replace(/\r/g, '\n')` ↔ Python `text.replace("\r\n", "\n").replace("\r", "\n")`.

Only functional delta: TS-side `.slice(0, 8)` truncation (D-06). Full 64-hex SHA-256 on text normalized identically across the two languages would match byte-for-byte.

## Decisions Made

See key-decisions in frontmatter. Summary:
1. `createTwoFilesPatch` instead of `createPatch` — required for `a/`/`b/` header prefix compliance.
2. Namespace fs import in edit-hashline.ts so `spyOn(fs, 'renameSync')` can intercept.
3. Lone-surrogate check before `normalize('NFC')` — NFC silently preserves lone surrogates, and we want explicit HasherError with "lone surrogate" message.
4. `writeAtomic` temp file is dot-prefixed and placed in the destination's dir — rename atomicity requires same filesystem.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `createPatch` header shape didn't match behavior contract**
- **Found during:** Task 1 GREEN test run (diff-render.test.ts line 13 expected `--- a/<path>`, got `--- <path>`).
- **Issue:** The plan's stub implementation used `createPatch(path, before, after, "", "")` but `diff`'s `createPatch` treats `oldHeader`/`newHeader` as *tab-separated timestamp columns* after the filename, not as `a/`/`b/` prefix replacements. Result: `--- a.txt\n+++ a.txt\n`, failing the standard unified-diff header contract.
- **Fix:** Switched to `createTwoFilesPatch(\`a/${path}\`, \`b/${path}\`, before, after, "", "", { context: 3 })`. Output now matches `--- a/<path>\n+++ b/<path>\n` exactly.
- **Files modified:** `packages/emmy-tools/src/diff-render.ts`
- **Verification:** `grep -E '^-alpha$' diff` + `grep -E '^\+ALPHA$' diff` both match; `--- a/` + `+++ b/` both contained.
- **Committed in:** `79327bd` (Task 1 GREEN).

**2. [Rule 2 — Missing Critical] `fs` destructured imports would bypass the crash spy**
- **Found during:** Task 2 GREEN (before writing impl — caught during design review of `editHashline`).
- **Issue:** Plan's sketch destructured `fs` imports (`import { renameSync, writeFileSync, ... } from "node:fs"`). Bun's `spyOn(fs, 'renameSync')` replaces the property on the `fs` module namespace, but destructured imports bind to the original function by value — the spy never fires. The atomic-crash test would falsely pass.
- **Fix:** Use namespace import (`import * as fs from "node:fs"`) and dispatch all calls through `fs.x(...)`. Added a code comment documenting the reason so later edits don't inadvertently change back.
- **Files modified:** `packages/emmy-tools/src/edit-hashline.ts`
- **Verification:** The crash-simulation test passes green, confirming the spy fires.
- **Committed in:** `1ee3dda` (Task 2 GREEN).

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical).
**Impact on plan:** Both are surface-level adjustments to the plan's sketch, not architectural or contract-changing. All D-05..D-09 + TOOLS-08 decisions implemented exactly as specified.

## Issues Encountered

- **Pre-existing Phase 1 Python failures** — `tests/unit/test_thermal_sampler.py` fails 7 tests with `ImportError: cannot import name 'validate_core_schema' from 'pydantic_core'`. Confirmed via `git stash` to be independent of this plan. Logged to `deferred-items.md` per the plan executor's scope-boundary rule (only auto-fix issues directly caused by the current task's changes).
- **Bun test verbosity** — Bun 1.3.13's default `bun test` output only prints per-test lines on failure; green runs collapse to a `X pass / Y fail / Z expect() calls` summary. The plan's `grep -Eic 'pass'` acceptance criterion returns `1` against this format (matches the "16 pass" summary line) rather than the ≥10 it expected against a per-test dump. Functionally equivalent — `16 pass` on `47 expect() calls` materially exceeds the ≥10 passing-assertions threshold. Documented here for the verifier.

## User Setup Required

None — no external service configuration.

## Next Phase Readiness

- **Plan 02-06** (parallel wave-mate) will `pi.registerTool(...)` the `editHashline` + `readWithHashes + renderHashedLines` surface as the canonical `edit` and `read` tools. Plan 06 will add its own exports (native-tools, mcp-bridge, web-fetch, mcp-poison-check) to `packages/emmy-tools/src/index.ts` during merge-back resolution — our index.ts exports ONLY the Plan 03 primitives, per the parallel-execution coordination directive.
- **Plan 02-08** will exercise the 5 prior-repo Phase-1 coding tasks + synthetic edit-heavy tasks against the wired surface for SC-2 evidence. The primitives shipped here are the foundation.
- **Plan 02-09** (SC-1 walkthrough) surfaces edit flow to the human verifier. Post-hoc diff in EditResult is ready.

---
*Phase: 02-pi-harness-mvp-daily-driver-baseline*
*Completed: 2026-04-21*

## Self-Check

Files claimed created:

| Path | Exists? |
|------|---------|
| packages/emmy-tools/src/types.ts | FOUND |
| packages/emmy-tools/src/errors.ts | FOUND |
| packages/emmy-tools/src/hash.ts | FOUND |
| packages/emmy-tools/src/text-binary-detect.ts | FOUND |
| packages/emmy-tools/src/read-with-hashes.ts | FOUND |
| packages/emmy-tools/src/edit-hashline.ts | FOUND |
| packages/emmy-tools/src/diff-render.ts | FOUND |
| packages/emmy-tools/tests/hash.test.ts | FOUND |
| packages/emmy-tools/tests/text-binary-detect.test.ts | FOUND |
| packages/emmy-tools/tests/read-with-hashes.test.ts | FOUND |
| packages/emmy-tools/tests/edit-hashline.test.ts | FOUND |
| packages/emmy-tools/tests/diff-render.test.ts | FOUND |
| .planning/phases/02-pi-harness-mvp-daily-driver-baseline/deferred-items.md | FOUND |

Commits claimed:

| Hash | Subject | Exists? |
|------|---------|---------|
| ce418d6 | test(02-03): RED hash + text-binary-detect + read-with-hashes + diff | FOUND |
| 79327bd | feat(02-03): hash primitives + read-with-hashes + diff (GREEN) | FOUND |
| 725249a | test(02-03): RED edit-hashline | FOUND |
| 1ee3dda | feat(02-03): editHashline atomic-write + post-hoc diff (GREEN) | FOUND |

## Self-Check: PASSED
