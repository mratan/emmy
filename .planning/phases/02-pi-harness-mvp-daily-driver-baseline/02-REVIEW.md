---
status: issues-found
severity_counts:
  critical: 0
  high: 2
  medium: 6
  low: 5
files_reviewed: 52
depth: standard
date: 2026-04-22
phase: 02-pi-harness-mvp-daily-driver-baseline
---

# Phase 2 Code Review — Findings

**Reviewed:** 2026-04-22
**Depth:** standard
**Scope:** 52 files changed between `c0dcebc..HEAD`; TypeScript focus on `packages/emmy-{provider,tools,ux,telemetry}/src/`, profile v2 YAML, and `emmy_serve/profile/schema.py` schema patch.

## Executive summary

Phase 2 is in genuinely good shape. The code is tight, consistently commented with intent + decision anchors (D-*/W-*/B-*/Pitfall), and uniformly enforces fail-loud error discipline. Dotted-path errors, atomic writes, pre-mutation validation in hashline edits, and the Unicode poison blocklist are all implemented defensibly. The four SC-1 live bug fixes show up as solid, not patchy.

Findings cluster around three themes:
1. **`web_fetch` is missing SSRF protection entirely** — follows redirects transparently, no allowlist/denylist, RFC1918/localhost reachable.
2. **MCP bridge teardown-on-failure is best-effort and race-prone** — `kill()` fires `client.close()` without awaiting.
3. **A handful of narrower correctness fences** around atomic-write temp-file races and grammar-config defaulting.

None blocked SC-1..5 evidence collection; they become material when `web_fetch` sees adversarial URLs or MCP servers are misconfigured.

**Positive signals:** `editHashline` validate-all-before-mutate pattern; surrogate-before-`for..of` ordering in `assertNoPoison` (catches a real runtime-silent failure mode); `postChat` top-level-`chat_template_kwargs` wire-shape comment (prevents regression of the Pitfall #6 lesson); `writeAtomic` dot-prefix temp + fsync-before-rename by-the-book.

---

## HIGH

### HI-01 — `web_fetch` has no SSRF protection; redirects are unbounded and private IPs are reachable
**File:** `packages/emmy-tools/src/web-fetch.ts:33-40`
**Issue:** `webFetch` calls built-in `fetch(url, { signal })` with no `redirect` option (defaults to `"follow"`), no allowlist, no IP/host denylist. An agent-supplied URL can redirect to `http://127.0.0.1:8002/v1/models` (emmy-serve itself), or any RFC1918 / loopback endpoint. The tool description says "Documentation-reading only" but the code enforces nothing. Combined with YOLO agent loop, a mis-parsed URL from a model hallucination can probe localhost services and include the response body in the next turn's context.
**Why High not Critical:** single-user, single-machine, air-gapped deployment mitigates practical blast radius today; CLAUDE.md accepts YOLO. But CLAUDE.md Pitfall #8 (hidden cloud deps) makes this worth flagging — the air-gap invariant relies on `web_fetch` being infrequently called, not on any in-code guard.
**Remediation direction:** Block `file://`, `data://`, and private-IP literals pre-fetch; set `redirect: "manual"` and re-validate after 3xx; or add a profile-configurable allowlist. At minimum reject `localhost|127.|10.|192.168.|172.(1[6-9]|2\d|3[01])\.|169.254.` in initial parse and after every redirect hop.

### HI-02 — MCP bridge `kill()` is fire-and-forget; subprocess cleanup not awaited on teardown
**File:** `packages/emmy-tools/src/mcp-bridge.ts:72-80, 128-134`
**Issue:** `kill` is defined as `void client.close()` and the teardown loop `for (const s of spawned) s.kill()` runs synchronously without `await`. If the MCP SDK's `client.close()` is async, subprocesses may still be alive when `registerMcpServers` re-throws. The CLI then exits — taking its own process down — but spawned children become orphaned unless they receive SIGHUP on parent exit (Linux typically does, but not guaranteed). Additionally `kill()` only calls `client.close()`; the transport's underlying `child_process.kill()` is not explicitly invoked.
**Remediation direction:** Make `kill` return a Promise; in the catch block do `await Promise.all(spawned.map(s => s.kill().catch(() => {})))` before re-throwing. Reach into `transport._process` (already done for PID logging) and call `.kill("SIGTERM")` with a short grace window before `SIGKILL`.

---

## MEDIUM

### ME-01 — `webFetch` has no max-redirects cap and no per-hop timeout
**File:** `packages/emmy-tools/src/web-fetch.ts:33`
**Issue:** AbortController covers the whole request lifecycle, but because redirects are transparent the 30s default can be consumed by a chain of redirects.
**Remediation:** `redirect: "manual"` with an explicit count, or set `maxRedirects` via a custom dispatcher.

### ME-02 — `bash` denylist is regex-substring-matched; trivially bypassed
**File:** `packages/emmy-tools/src/native-tools.ts:48-53, 224-232`
**Issue:** `BASH_DEFAULT_DENY` matches `rm -rf /` via `^\s*rm\s+-rf\s+\/(?:\s|$)`. Bypasses: `/bin/rm -rf /`, `eval "rm -rf /"`, `bash -c 'rm -rf /'`. Code comment acknowledges denylist is theatre-at-best per CLAUDE.md — working as designed, but tool description suggests safety that doesn't exist.
**Remediation:** Either document in the tool description that denylist is cosmetic (YOLO discipline), or drop the denylist entirely.

### ME-03 — `isBinary` UTF-8 round-trip short-circuit is subtly wrong for invalid UTF-8
**File:** `packages/emmy-tools/src/text-binary-detect.ts:14-16`
**Issue:** `buf.toString("utf8")` silently replaces invalid bytes with U+FFFD. The try/catch wrapping `buf.toString` is dead code. `Buffer.from(decoded, "utf8")` allocates a full second buffer — 2× memory pressure. Not a bug, just inefficient.
**Remediation:** Use `Buffer.isUtf8(buf)` (Node ≥18) directly; drop round-trip allocation and unreachable catch. Keep NUL-byte 8KB prefix scan as primary cheap check.

### ME-04 — `writeAtomic` temp-file orphan cleanup scope is too narrow
**File:** `packages/emmy-tools/src/edit-hashline.ts:154-177`
**Issue:** Temp filename collision-resistant, good. But if `fsyncSync` throws between `writeFileSync(fd, ...)` and the `finally` that does `closeSync`, the tmp file is NOT unlinked. The catch-and-unlink only runs on `renameSync` failure. Write-barrier failure leaves `.a.txt.12345.abcdef12.tmp` on disk. On signal-termination between write and rename, also orphans.
**Remediation:** Wrap the entire temp-file lifecycle in a single try/finally that unlinks on any non-rename-succeeded exit. The atomic-write test currently validates only the `renameSync`-throws path.

### ME-05 — `parseGrammarConfig` allows unknown keys to slip through
**File:** `packages/emmy-ux/src/profile-loader.ts:171-203`
**Issue:** Validator checks `obj.path` and `obj.mode` but does not reject unknown keys. A typo like `{ path: 'x', mode: 'reactive', modee: 'extra' }` passes validation and silently drops `modee`. Python schema uses `extra="forbid"`; TS loader should match.
**Remediation:** Add `for (const k of Object.keys(obj)) if (k !== "path" && k !== "mode") throw new ProfileLoadError(...)`. Match the Python `ConfigDict(extra="forbid")` discipline.

### ME-06 — `session.ts` dummy `EMMY_VLLM_API_KEY` can mask real credentials
**File:** `packages/emmy-ux/src/session.ts:110-112`
**Issue:** `if (!process.env[EMMY_KEY_ENV]) process.env[EMMY_KEY_ENV] = "unused"`. If a user ever sets `EMMY_VLLM_API_KEY` to a real secret and overrides `--base-url`, it gets sent to whatever endpoint they pointed at. No redaction.
**Why Medium:** single-user + air-gap mitigates; pattern silently does wrong thing if `--base-url` is ever non-loopback.
**Remediation:** Warn on stderr when `EMMY_VLLM_API_KEY` is set to non-"unused" AND `baseUrl` is not loopback. Or: always pass `apiKey: "unused"` inline, ignore env var entirely.

---

## LOW

### LO-01 — `editHashline` in-memory mutation with `Symbol + filter` is fragile
**File:** `packages/emmy-tools/src/edit-hashline.ts:111-128`
**Issue:** `DELETED` symbol is local and cannot collide, but `(string | typeof DELETED)[]` through `.splice` and `.filter` depends on insertions not generating DELETED sentinels. Fragile to future changes.
**Remediation:** Separate pipelines or use a tagged-union index list.

### LO-02 — `web_fetch` timeout recovery via error-message regex
**File:** `packages/emmy-tools/src/web-fetch.ts:31, 64-66`
**Issue:** `ctl.abort(new Error("timeout"))` + `/timeout/i` regex match is brittle. If abort reason string changes, timeout branch silently breaks.
**Remediation:** Use captured boolean `timedOut = true` set by `setTimeout` callback, checked in catch.

### LO-03 — Prompt-assembly token estimate divides by 4; CJK/emoji skews wildly
**File:** `packages/emmy-ux/src/prompt-assembly.ts:41-57`
**Issue:** Acknowledged as deliberate — "for observability, not tokenizer-accurate." CJK content skews ~3×. Users should not rely on this for budget decisions.
**Remediation:** Add FIXME-style note in startup line itself (`tokens_approx ~= n/4`).

### LO-04 — `session.ts` tool-defs-text duplicates `native-tools.ts` descriptions
**File:** `packages/emmy-ux/src/session.ts:284-294`
**Issue:** 8-tool overview blob hardcoded, doesn't pull from `native-tools.ts` descriptions. Two sources of truth.
**Remediation:** Phase 3 wire-through should generate `toolDefsText` from registered `PiToolSpec[]`. No Phase 2 action.

### LO-05 — `grep` tool splits flags on whitespace without shell-style quoting
**File:** `packages/emmy-tools/src/native-tools.ts:270-283`
**Issue:** `flagsStr.split(/\s+/)` breaks `-e "hello world"`. Not security — ergonomic.
**Remediation:** Accept `flags` as `string[]` in schema, or document space-separated-tokens (no quotes).

---

## Cross-cutting observations

### Contract drift: Python and TS GrammarConfig both exist
Both `emmy_serve/profile/schema.py:190-203` (`GrammarConfig` with `extra="forbid"`) and `packages/emmy-provider/src/types.ts:21-24` (bare `interface GrammarConfig`) define the shape, but only Python side forbids extra keys. ME-05 is the code-level manifestation. "Profiles are the only shared contract" principle would benefit from single-source-of-truth — flag for Phase 3.

### Duplication: Three surrogate-scan loops
Identical lone-surrogate detection in `hash.ts:11-26`, `mcp-poison-check.ts:50-63`, and implicitly in `text-binary-detect.ts`. Extract a `scanForLoneSurrogates(text, onBad)` helper.

### Test gap: No test exercises `web_fetch` following a redirect
Given HI-01, highest-impact test to add. `Bun.serve` supports 302 responses; one-fixture test asserting redirect-to-loopback is rejected.

### Test gap: `editHashline` atomic-write only tests `renameSync` failure, not `fsyncSync`
See ME-04. Add `spyOn(nodeFs, "fsyncSync").mockImplementationOnce(() => throw ...)` test asserting tmp file unlinked + original unchanged.

---

## Positive signals (worth naming)

- **Fail-loud discipline held across 40+ files** — every boot path throws a named, dotted-path error. No silent degradation. Realizes CLAUDE.md's fail-loud invariant.
- **D-18 poison blocklist correctness** — surrogate-first ordering catches a real trap naïve implementations miss. Cf/Co/Cs + both bidi ranges (U+202A-U+202E, U+2066-U+2069) covered with ≥1 fixture each. Boundary tests prevent category creep. Key concern #1: clean, low false-negative risk.
- **Phase-1-schema-patch is backward-compatible** — `ToolsConfig.grammar: Optional[GrammarConfig] = None` accepts v1's `grammar: null`. Key concern #6: clean.
- **SP_OK canary cannot be accidentally bypassed** — `createEmmySession` calls `runSpOk` as first action before any profile parsing side-effects. No opt-out env var, no skip flag. Key concern #7: clean.
- **Prompt assembly order is locked and measured** — `prompt-assembly.ts:62-66` hard-codes CONTEXT-04 order. Changing order changes hash, fails SC-5 regression. Key concern #8: clean.
- **No new cloud dependencies introduced** — grep of imports across four TS packages turns up only `node:*`, `@modelcontextprotocol/sdk`, `turndown`, `js-yaml`, `diff`, workspace `@emmy/*`, `@mariozechner/pi-coding-agent`. No `openai`, `anthropic`, `@google/generative-ai`, `axios`. Key concern #9: clean modulo HI-01.

---

## Relevant file paths

- `/data/projects/emmy/packages/emmy-tools/src/web-fetch.ts` — HI-01, ME-01, LO-02
- `/data/projects/emmy/packages/emmy-tools/src/mcp-bridge.ts` — HI-02
- `/data/projects/emmy/packages/emmy-tools/src/native-tools.ts` — ME-02, LO-05
- `/data/projects/emmy/packages/emmy-tools/src/text-binary-detect.ts` — ME-03
- `/data/projects/emmy/packages/emmy-tools/src/edit-hashline.ts` — ME-04, LO-01
- `/data/projects/emmy/packages/emmy-ux/src/profile-loader.ts` — ME-05
- `/data/projects/emmy/packages/emmy-ux/src/session.ts` — ME-06, LO-04
- `/data/projects/emmy/packages/emmy-ux/src/prompt-assembly.ts` — LO-03
- `/data/projects/emmy/packages/emmy-tools/src/mcp-poison-check.ts` — clean (positive signal)
- `/data/projects/emmy/packages/emmy-ux/src/sp-ok-canary.ts` — clean (positive signal)
- `/data/projects/emmy/emmy_serve/profile/schema.py` — clean (positive signal)
- `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v2/harness.yaml` — clean (nested grammar shape)

Findings are advisory. `/gsd-code-review-fix` is the remediation channel if the author wants to bundle HI-01 + HI-02 + ME-04 as a Phase-2.1 hardening pass. Current recommendation: ship Phase 2 as-is; add HI-01 + HI-02 as early-scope Phase 3 tickets.
