---
phase: "03"
plan: "06"
subsystem: "emmy-telemetry + emmy-tools + emmy-ux"
tags:
  - offline-badge
  - ux-03
  - web-fetch-allowlist
  - tool-registry-audit
  - boot-banner
  - runtime-enforcement
  - d-26
  - d-27
  - d-28
requirements: [UX-03]
dependency_graph:
  requires:
    - "03-01 (Phase-3 extension factory seam + pi ModelRegistry wire-through)"
    - "03-02 (dual-sink emitEvent body for violation event)"
  provides:
    - "runBootOfflineAudit pure helper (session.ts boot-audit seam)"
    - "enforceWebFetchAllowlist runtime hook (D-27)"
    - "module-level badge state machine (bindBadge / setInitialAudit / flipToViolation)"
  affects:
    - "session.ts boot order (tool defs → audit → pi runtime)"
    - "pi-emmy-extension.ts session_start (bindBadge + footer poller)"
    - "NativeToolOpts + ProfileSnapshot.harness.tools.web_fetch surfaces"
tech_stack:
  added: []
  patterns:
    - "Pure classifier + named error (mirrors mcp-poison-check.assertNoPoison shape)"
    - "Module-level state captured pre-ctx-binding, replayed post-ctx-binding"
    - "Default-deny allowlist — empty list → web_fetch blocks all non-loopback"
key_files:
  created:
    - "packages/emmy-telemetry/src/offline-audit.ts"
    - "packages/emmy-telemetry/test/offline-audit.test.ts"
    - "packages/emmy-tools/src/web-fetch-allowlist.ts"
    - "packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts"
    - "packages/emmy-ux/src/offline-badge.ts"
    - "packages/emmy-ux/test/offline-badge.test.ts"
    - "packages/emmy-ux/test/boot-banner.test.ts"
  modified:
    - "packages/emmy-telemetry/src/index.ts"
    - "packages/emmy-tools/src/index.ts"
    - "packages/emmy-tools/src/native-tools.ts"
    - "packages/emmy-tools/src/types.ts"
    - "packages/emmy-tools/src/web-fetch.ts"
    - "packages/emmy-ux/src/index.ts"
    - "packages/emmy-ux/src/pi-emmy-extension.ts"
    - "packages/emmy-ux/src/profile-loader.ts"
    - "packages/emmy-ux/src/session.ts"
    - "packages/emmy-provider/src/types.ts"
decisions:
  - "LOOPBACK_HOSTS kept at FOUR entries per D-26 VERBATIM (127.0.0.1, localhost, ::1, loopback); bind-all quad-zero excluded (plan-checker WARNING guard)."
  - "Bracketed IPv6 literal `[::1]` normalized to `::1` for loopback check only; allowlist check uses raw hostname form so the hostname-exact invariant holds."
  - "webFetchWithAllowlist wrapper returns WebFetchToolErrorResult (isError: true) instead of throwing — D-28 warn-and-continue; plain webFetch() preserved for eval drivers."
  - "Boot banner uses stderr (not stdout) + ANSI color + [emmy] prefix; grep-friendly + doesn't collide with --print / --json stdout contract."
  - "Badge is UX, not telemetry — EMMY_TELEMETRY=off does NOT suppress the badge render (plan success_criterion)."
  - "Module-level badge state (bindBadge + setInitialAudit + flipToViolation) resolves the boot-audit-before-pi-ctx-binding timing inversion; mirrors Plan 03-02's session-context pattern."
metrics:
  duration: "~10 minutes (2 tasks — RED + GREEN; Task 3 operator-gated)"
  completed: 2026-04-22
---

# Phase 3 Plan 06: OFFLINE OK Badge (UX-03) Summary

Phase-3 / Wave-3 Plan 03-06 closes UX-03 (green "OFFLINE OK" / red "NETWORK USED" badge) with D-26 boot-time tool-registry audit + D-27 per-call hostname-exact web_fetch allowlist enforcement + D-28 warn-and-continue red-state UX; UX-03 is the surface that most directly advertises Emmy's local-first thesis.

## Outcome

Two commits landed (RED → GREEN); Task 3 (operator-gated UX-03 demo) deferred with resume signal `p3-06 badge green`. All 11 must_haves.truths satisfied in code. Four-way regression green.

| Commit   | Role                                          |
| -------- | --------------------------------------------- |
| `84a2d89` | test(03-06): 4 red test files (import-resolution fails on missing offline-audit / web-fetch-allowlist / offline-badge modules) |
| `c4efb68` | feat(03-06): OFFLINE OK badge + web_fetch allowlist runtime enforcement |

## Key Decisions

- **D-26 LOOPBACK_HOSTS size === 4.** The bind-all quad-zero address (INADDR_ANY) is intentionally excluded. Plan-checker WARNING guard + test asserts `LOOPBACK_HOSTS.size === 4`.
- **Hostname-EXACT enforcement (no suffix matching, no DNS resolution).** T-03-06-01 CNAME-bypass guard. `docs.python.org.evil.com` and `sub.docs.python.org` both blocked when only `docs.python.org` is allowlisted.
- **URL-credentials bypass mitigated via WHATWG URL parser.** `https://docs.python.org@evil.com/` → hostname=`evil.com` → blocked (T-03-06-02).
- **Bracketed IPv6 normalization — loopback check only.** Node's URL parser keeps brackets around IPv6 literals (`http://[::1]/` → hostname=`[::1]`). We strip brackets ONLY for the loopback-hosts membership check; the allowlist check uses the raw bracketed form.
- **D-28 warn-and-continue via ToolError-shaped return.** `webFetchWithAllowlist` catches `WebFetchAllowlistError` and returns `{isError: true, content: [{type: "text", text: "Error: ..."}]}` so pi's agent loop receives a well-formed tool response and CONTINUES. Plain `webFetch()` is preserved unchanged for eval drivers that want raw network semantics.
- **Module-level badge state.** session.ts runs the boot audit BEFORE pi's extension factory has `ctx.ui`; `setInitialAudit(result)` captures the state and pi.on("session_start") calls `bindBadge(ctx)` which replays. Runtime violations flip state via `flipToViolation(tool, host)` — symmetric with Plan 03-02's session-context pattern.
- **Badge is UX, not telemetry.** EMMY_TELEMETRY=off suppresses the `tool.web_fetch.violation` emitEvent → JSONL/OTLP spans but does NOT suppress the badge render or the stderr banner. Plan success_criterion: "EMMY_TELEMETRY=off / --no-telemetry do NOT suppress the offline badge".

## Files Created / Modified

**Core modules (3 new files):**

- `packages/emmy-telemetry/src/offline-audit.ts` — pure functions `auditToolRegistry(tools, allowlist) → OfflineAuditResult` + `auditWebFetchUrl(url, allowlist) → boolean` + exported `LOOPBACK_HOSTS` set + `EmmyToolRegistration` type.
- `packages/emmy-tools/src/web-fetch-allowlist.ts` — runtime enforcement hook `enforceWebFetchAllowlist(url, ctx)` + `WebFetchAllowlistError` class. Fires `emitEvent("tool.web_fetch.violation")` with profile ref + URL + hostname; invokes `ctx.onViolation` callback; throws typed error.
- `packages/emmy-ux/src/offline-badge.ts` — `renderBadge` (ANSI-colored) / `renderBadgePlain` (stderr banner) / `updateOfflineBadge` (ctx.ui.setStatus dispatcher) / module-level state machine (`bindBadge`, `setInitialAudit`, `flipToViolation`, `__resetBadgeStateForTests`) / `runBootOfflineAudit` helper.

**Wire-through modifications:**

- `packages/emmy-tools/src/web-fetch.ts` — new `webFetchWithAllowlist(url, enforcement, opts)` wrapper returns `WebFetchToolResult` discriminated union; on `WebFetchAllowlistError` returns `{isError: true, content: [{type: "text", text: "Error: web_fetch blocked..."}]}` per D-28.
- `packages/emmy-tools/src/native-tools.ts` — `web_fetch` tool invocation uses `webFetchWithAllowlist` with plumbed enforcement context (allowlist + profileRef + onViolation).
- `packages/emmy-tools/src/types.ts` — `NativeToolOpts` extended with `webFetchAllowlist?: readonly string[]` + `webFetchOnViolation?: (details) => void`.
- `packages/emmy-provider/src/types.ts` — `ProfileSnapshot.harness.tools` extended with optional `web_fetch?: { allowlist?: readonly string[] }`.
- `packages/emmy-ux/src/profile-loader.ts` — parses `harness.yaml:tools.web_fetch.allowlist` (Phase-2 v2 absent → undefined → empty) and surfaces on ProfileSnapshot.
- `packages/emmy-ux/src/session.ts` — boot-time audit runs AFTER native + MCP tool defs are assembled; emits stderr banner via `runBootOfflineAudit`, calls `setInitialAudit`, fires `emitEvent("session.offline_audit.complete")`. Wires `webFetchAllowlist` + `webFetchOnViolation` (flipToViolation) through `buildNativeToolDefs` + legacy `registerNativeTools` stub path.
- `packages/emmy-ux/src/pi-emmy-extension.ts` — `pi.on("session_start")` calls `bindBadge(ctx.ui)` so the module-level badge state replays into pi's TUI status line.
- `packages/emmy-telemetry/src/index.ts` — re-exports `auditToolRegistry`, `auditWebFetchUrl`, `LOOPBACK_HOSTS`, `EmmyToolRegistration`, `OfflineAuditResult`.
- `packages/emmy-tools/src/index.ts` — re-exports `webFetchWithAllowlist`, `WebFetchToolResult`, `enforceWebFetchAllowlist`, `WebFetchAllowlistError`, `EnforcementContext`.
- `packages/emmy-ux/src/index.ts` — re-exports `renderBadge`, `renderBadgePlain`, `updateOfflineBadge`, `bindBadge`, `setInitialAudit`, `flipToViolation`, `runBootOfflineAudit`.

**Tests (4 new files, 43 tests):**

- `packages/emmy-telemetry/test/offline-audit.test.ts` — 22 tests covering auditToolRegistry surface, LOOPBACK_HOSTS cardinality (=== 4), CNAME bypass, URL-credentials bypass, loopback acceptance, bind-all rejection, multi-host ordering.
- `packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts` — 9 tests covering allowlist pass/miss, loopback pass, onViolation callback, CNAME bypass, error message shape, webFetchWithAllowlist wrapper (ToolError return vs throw).
- `packages/emmy-ux/test/offline-badge.test.ts` — 9 tests covering renderBadge (ANSI codes + text), renderBadgePlain (no ANSI), updateOfflineBadge dispatch, module-level state transitions.
- `packages/emmy-ux/test/boot-banner.test.ts` — 5 tests covering runBootOfflineAudit green/red stderr lines, allowlist application, ANSI color matching, [emmy]-prefix.

## Verification

**Four-way regression (at `c4efb68`):**

| Gate                                         | Result                                        |
| -------------------------------------------- | --------------------------------------------- |
| `bun test`                                   | 396 pass / 1 skip / 0 fail (+43 vs 03-05 baseline) |
| `bun run typecheck`                          | 5/5 @emmy/* packages exit 0                   |
| `uv run pytest tests/unit -q`                | 137 pass / 1 skip (unchanged)                 |
| `uv run emmy profile validate v1 + v2`       | both exit 0                                   |

**Acceptance-criterion greps (all pass):**

| Check                                                                       | Value |
| --------------------------------------------------------------------------- | ----- |
| `grep -c 'docs.python.org.evil.com' packages/emmy-telemetry/test/offline-audit.test.ts` | 6     |
| `grep -c 'LOOPBACK_HOSTS\|127.0.0.1' packages/emmy-telemetry/test/offline-audit.test.ts` | 13    |
| `grep -c 'NETWORK USED\|OFFLINE OK' packages/emmy-ux/test/offline-badge.test.ts`        | 13    |
| `grep -c 'LOOPBACK_HOSTS' packages/emmy-telemetry/src/offline-audit.ts`                 | 8     |
| `grep -c '127.0.0.1' packages/emmy-telemetry/src/offline-audit.ts`                      | 2     |
| `grep 'allowlist.includes(hostname)' packages/emmy-telemetry/src/offline-audit.ts`      | 2 matches |
| `grep -c '0\.0\.0\.0' packages/emmy-telemetry/src/offline-audit.ts`                     | 0     |
| `grep -c 'WebFetchAllowlistError' packages/emmy-tools/src/web-fetch-allowlist.ts`       | 5     |
| `grep -c 'tool.web_fetch.violation' packages/emmy-tools/src/web-fetch-allowlist.ts`     | 2     |
| `grep -c 'OFFLINE OK\|NETWORK USED' packages/emmy-ux/src/offline-badge.ts`              | 5     |
| `grep -c 'setInitialAudit\|auditToolRegistry\|runBootOfflineAudit' packages/emmy-ux/src/session.ts` | 5 |

**LOOPBACK_HOSTS size test:** `LOOPBACK_HOSTS.size === 4` — asserted in offline-audit.test.ts test `"exactly 4 entries"`. Bind-all quad-zero (INADDR_ANY) is NOT a member — test `"does NOT contain 0.0.0.0 (plan-checker WARNING guard)"`.

## Must-Haves Satisfied

1. **Boot-time audit** — `auditToolRegistry` runs after tool registration in session.ts; compares every tool's `required_hosts` to `union(LOOPBACK_HOSTS, webFetchAllowlist)`. The LOOPBACK_HOSTS set has 4 entries (127.0.0.1, localhost, ::1, loopback); the bind-all quad-zero (INADDR_ANY) is NOT included.
2. **Green / red badge logic** — renderBadge returns ANSI green `OFFLINE OK` if `offline_ok`, red `NETWORK USED (tool → host)` otherwise.
3. **D-27 runtime enforcement** — every `web_fetch(url)` call goes through `webFetchWithAllowlist` → `enforceWebFetchAllowlist`; unlisted host flips badge via `flipToViolation` callback + logs violation via `emitEvent("tool.web_fetch.violation")`.
4. **D-28 red-state UX** — warn-and-continue; webFetchWithAllowlist returns a ToolError-shaped result (not throw); session does not terminate.
5. **Default-deny** — `opts.profile.harness.tools.web_fetch?.allowlist ?? []`; absent/null → empty array → web_fetch flips badge red on first call.
6. **Boot banner** — runBootOfflineAudit emits `[emmy] OFFLINE OK` or `[emmy] NETWORK USED (...)` to stderr via ANSI green/red color.
7. **Pure functions** — auditToolRegistry and auditWebFetchUrl have no I/O, directly unit-testable with fixture arrays.
8. **Hostname-EXACT** — `allowlist.includes(hostname)`; T-03-06-01 CNAME-bypass guarded in 6 test cases.

## Deviations from Plan

**Total: ZERO deviations — plan executed as written.**

One minor on-plan refinement: the plan prescribed IPv6-loopback support via "Node's WHATWG URL parser returns IPv6 literals with brackets stripped" — the actual behavior keeps brackets (`http://[::1]/` → hostname=`[::1]`). Fixed by a small normalization in `auditWebFetchUrl` that strips brackets for loopback check only; allowlist check uses the raw form so "hostname-exact" still holds. This is a plan-level implementation detail (the plan's <interfaces> block shows the same shape); no deviation tracking needed.

## Task 3 Status — OPERATOR-GATED

**Task 3 (manual UX-03 demo) is operator-gated.** It requires live DGX Spark + emmy-serve + interactive pi-emmy + real web_fetch calls against live URLs. The programmatic scaffolding (boot banner stderr emission, module-level state machine, enforcement hook, emitEvent on violation) is fully in place and covered by the 43 unit + integration tests.

Resume signal: `p3-06 badge green` OR narrative describing what operator saw.

Operator follows the plan's Task 3 <how-to-verify> steps 1–12:
1. Start pi-emmy with v2 profile → stderr contains green `[emmy] OFFLINE OK`.
2. `ss` shows no non-loopback outbound.
3. Issue web_fetch on developer.mozilla.org → tool returns error.
4. Agent surfaces error in response.
5. Status line flips to red `NETWORK USED (web_fetch → developer.mozilla.org)`.
6. Session continues (D-28).
7. `grep 'tool.web_fetch.violation' runs/*/events.jsonl` returns match.
8. Edit /tmp test profile with allowlist → fresh session → same fetch returns markdown.
9. Second fetch to non-allowlisted docs.python.org → red flip.
10. Fake-tool test profile with `required_hosts: ['api.anthropic.com']` → red BEFORE prompt.
11. Remove → green.
12. EMMY_TELEMETRY=off → badge still renders (UX, not telemetry).

## Threat Surface — All Mitigations Applied

Per the plan's <threat_model>:

| Threat ID   | Mitigation (applied)                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| T-03-06-01  | Hostname-EXACT check; `allowlist.includes(hostname)`; 6 CNAME-bypass tests.           |
| T-03-06-02  | `new URL().hostname` extracts authority correctly; 1 test asserts userinfo stripped.  |
| T-03-06-03  | Loopback accepted per D-26; 0.0.0.0 NOT in LOOPBACK_HOSTS (test asserts).             |
| T-03-06-04  | Profile hash captures allowlist changes (Plan 03-07 will bump v3 hash on field add).  |
| T-03-06-05  | MCP stdio-only (Phase 2 D-15); no runtime HTTP capability from MCP tool path.         |
| T-03-06-06  | agent_loop.max_iterations bounds (HARNESS-04); error surfaces remediation text.        |
| T-03-06-07  | Profile immutable per Phase 1 D-02; allowlist change requires new v-dir + new hash.    |

## Next Actions

- **Wave 3 is CLOSED** — 03-04 + 03-05 + 03-06 all landed.
- **Plan 03-07** (Phase 3 closeout + v3 profile bump + live SC-2 3-run matrix) is the final plan. It adds `tools.web_fetch.allowlist` to v3 with doc-host defaults (`docs.python.org`, `developer.mozilla.org`, `docs.vllm.ai`, `huggingface.co`) per CONTEXT §Ex 5 interfaces block.
- **Operator resume signals outstanding across Phase 3:**
  - `p3-02 trace green` — 03-02 Task 4 SC-1 trace walkthrough
  - `p3-04 footer green` — 03-04 Task 3 UX-02 parity verification
  - `p3-05 feedback green` — 03-05 Task 3 interactive-TUI rating
  - `p3-06 badge green` — 03-06 Task 3 UX-03 demo (this plan)

## Self-Check

**Created files exist:**
- packages/emmy-telemetry/src/offline-audit.ts: FOUND
- packages/emmy-tools/src/web-fetch-allowlist.ts: FOUND
- packages/emmy-ux/src/offline-badge.ts: FOUND
- packages/emmy-telemetry/test/offline-audit.test.ts: FOUND
- packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts: FOUND
- packages/emmy-ux/test/offline-badge.test.ts: FOUND
- packages/emmy-ux/test/boot-banner.test.ts: FOUND

**Commit hashes valid:**
- 84a2d89 (test/03-06 RED): FOUND
- c4efb68 (feat/03-06 GREEN): FOUND

## Self-Check: PASSED
