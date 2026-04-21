---
phase: 02-pi-harness-mvp-daily-driver-baseline
plan: 01
subsystem: infra
tags: [bun, typescript, pi-coding-agent, workspace, profile-bundle, mcp, agents-md]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: profiles/qwen3.6-35b-a3b/v1/ locked bundle (Phase 1 D-02 immutability, content hash sha256:b91e747...)
provides:
  - Bun workspace root with four @emmy/* package shells (@emmy/provider, @emmy/tools, @emmy/ux, @emmy/telemetry)
  - pi-emmy wave-0 shim binary on PATH after `bun link` (entry point for SC-1)
  - profiles/qwen3.6-35b-a3b/v2/ byte-for-byte clone of v1 (Plan 07 fills harness.yaml TODOs + recomputes hash)
  - @emmy/telemetry stable signature (TelemetryRecord interface + no-op emitEvent) — Phase 3 fills body without call-site churn
  - docs/mcp_servers_template.yaml (D-15/D-16/D-17/D-18 dispatch rules documented)
  - docs/agents_md_template.md (CONTEXT-01 starter)
  - bun.lock committed (Pitfall #8 reproducibility discipline, TS-side analog of uv.lock)
affects: [02-02, 02-03, 02-04, 02-06, 02-07, 02-08, 02-09]

# Tech tracking
tech-stack:
  added:
    - Bun 1.3.13 runtime + workspaces (D-02)
    - TypeScript 5.7.3 (typecheck-only, no compile step)
    - bun-types 1.1.42 (bun globals for tsc --noEmit)
    - @biomejs/biome 1.9.4 (lint/format stubs — Plans 02+ will wire to CI)
    - "@mariozechner/pi-coding-agent" 0.68.0 (EXACT pin, not ^/~ — four packages)
  patterns:
    - "Cross-language shape donor: emmy_serve/diagnostics/atomic.py:append_jsonl_atomic — Phase 3 @emmy/telemetry body impl will mirror (sort_keys, separators, fsync-then-append)"
    - "TS-side strict schema discipline deferred to per-package consumers (Shared Pattern 1 Phase 2 PATTERNS)"
    - "Lockfile-committed reproducibility: bun.lock (text, Bun 1.3 default) sits alongside uv.lock (Python). Neither is gitignored."
    - "Profile v2-as-sibling pattern: Phase 1 D-02 immutability preserved by building v2 beside v1 rather than mutating v1"
    - "pi-emmy binary name load-bearing (SC-1 verbatim) — shim lives in @emmy/ux/bin/pi-emmy.ts, Plan 04 replaces body"

key-files:
  created:
    - package.json (Bun workspace root)
    - tsconfig.base.json (strict TS 5.7 config)
    - biome.json (lint+format config)
    - bun.lock (text lockfile, committed)
    - packages/emmy-provider/{package.json,tsconfig.json,src/index.ts}
    - packages/emmy-tools/{package.json,tsconfig.json,src/index.ts}
    - packages/emmy-ux/{package.json,tsconfig.json,src/index.ts,bin/pi-emmy.ts}
    - packages/emmy-telemetry/{package.json,tsconfig.json,src/index.ts}
    - profiles/qwen3.6-35b-a3b/v2/{profile.yaml,serving.yaml,harness.yaml,PROFILE_NOTES.md,prompts/system.md,tool_schemas/.gitkeep,grammars/.gitkeep}
    - docs/mcp_servers_template.yaml
    - docs/agents_md_template.md
  modified:
    - .gitignore (added node_modules/, packages/*/dist/, .turbo/ — NOT bun.lock)

key-decisions:
  - "Bun 1.3 text-lockfile (bun.lock) committed instead of legacy bun.lockb — Bun 1.3 default; spirit of plan (Pitfall #8 reproducibility) preserved. bun.lockb no longer the current format."
  - "bun-types 1.1.42 added to workspace devDependencies because tsconfig.base.json references 'types: [bun-types]' — without it, typecheck failed TS2688. (Rule 3: missing dependency blocked plan execution)"
  - "pi-coding-agent 0.68.0 pinned exactly in all four packages (zero ^/~ drift per Pitfall #8)"
  - "@emmy/telemetry ships Wave-0 signature-only stub so other packages import { emitEvent } today without Phase 3 retrofitting call sites (D-01 rationale)"
  - "Profile v2-as-sibling preserves Phase 1 v1 locked hash (sha256:b91e747...); v2 profile.yaml carries KNOWN-STALE warning header + v1 hash until Plan 07 recomputes"

patterns-established:
  - "Four-package workspace topology: @emmy/provider (vLLM HTTP + compat), @emmy/tools (hash-anchor edit + MCP + web_fetch), @emmy/ux (CLI + session + prompt assembly), @emmy/telemetry (Phase 3 observability stub)"
  - "Stub contract stability: Wave-0 exports PACKAGE_VERSION from every package; @emmy/telemetry also exports TelemetryRecord interface + emitEvent() signature"
  - "pi-emmy entry shape: #!/usr/bin/env bun shebang, TS-native exec (no tsc compile), Plan 04 swaps body"
  - "Profile version directories are immutable siblings — v2/ cloned byte-for-byte from v1/ before any TODO fill"

requirements-completed: [HARNESS-01, CONTEXT-01]

# Metrics
duration: ~12min
completed: 2026-04-21
---

# Phase 2 Plan 01: Harness Workspace Bootstrap Summary

**Bun workspace with four @emmy/* package shells, `pi-emmy` wave-0 shim on PATH, and profile v2 sibling directory cloned byte-for-byte from the Phase 1 locked v1 bundle.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-21T21:29Z
- **Completed:** 2026-04-21T21:41Z
- **Tasks:** 2 / 2
- **Files created:** 20 (workspace root + 4 packages + v2 bundle + 2 docs templates + bun.lock)
- **Files modified:** 1 (.gitignore — TS/Node lines appended)

## Accomplishments

- Bun workspace root (`package.json`, `tsconfig.base.json`, `biome.json`) standing up in under a minute against a clean clone — `bun install` → `bun run typecheck` → `bun link` all GREEN.
- Four `@emmy/*` packages exist as typed empty shells, each pinning `@mariozechner/pi-coding-agent` to EXACTLY `0.68.0` (no `^`, no `~`) — Pitfall #8 reproducibility discipline on the TS side.
- `pi-emmy` shim binary exposed on `$PATH` via `bun link`; `pi-emmy` prints `pi-emmy wave-0 shim — Plan 04 wires createAgentSessionRuntime` and exits 0 — the SC-1 `pi-emmy` user-facing command reserves its slot ahead of Plan 04's real runtime wiring.
- `@emmy/telemetry` ships a signature-stable stub (`TelemetryRecord` interface + no-op `emitEvent`) — Phase 3 replaces the body with an atomic JSONL writer mirroring Phase 1's `emmy_serve/diagnostics/atomic.py:append_jsonl_atomic`, with zero call-site churn in `@emmy/provider`/`@emmy/tools`/`@emmy/ux`.
- `profiles/qwen3.6-35b-a3b/v2/` exists as a byte-for-byte clone of v1 (9-line diff, entirely contained in `profile.yaml`: 3-line KNOWN-STALE header + `version: v1` → `version: v2`). Every other file (`harness.yaml`, `serving.yaml`, `prompts/system.md`, `PROFILE_NOTES.md`, `.gitkeep`) is identical between v1 and v2. Plan 07 fills `harness.yaml` TODOs + recomputes the v2 hash.
- `docs/mcp_servers_template.yaml` ships with inline dispatch-rule documentation for D-15 (flat names + fail-loud collision), D-16 (user/project layering), D-17 (stdio-only), D-18 (Unicode blocklist Cf/Co/Cs + bidi U+202A..U+202E / U+2066..U+2069).
- `docs/agents_md_template.md` starter present with Build/Test, Key Paths, House Style, Preferred Patterns, Things to Avoid, Model Hints sections — CONTEXT-01 AGENTS.md discipline ready.
- `bun.lock` (text format, Bun 1.3 default) committed at repo root. `.gitignore` does NOT contain `bun.lock` or `bun.lockb` — reproducibility-floor discipline mirrors `uv.lock`.
- Phase 1 guardrails held: `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` exits 0 (v1 certification unchanged); `uv run pytest tests/unit -q` still 137 passed / 1 skipped (shellcheck, unchanged).

## Task Commits

Each task committed atomically on the main working tree:

1. **Task 1: Workspace root + four package shells + telemetry signature** — `4fa82ac` (feat)
2. **Task 2: Clone profile v1 → v2 sibling + docs templates** — `ae97e04` (feat)

_(Plan metadata commit (STATE/ROADMAP/SUMMARY) will follow this file write.)_

## Files Created/Modified

### Created — workspace root (4)
- `package.json` — Bun workspace manifest, `workspaces=["packages/*"]`, `engines.bun>=1.1`, dev deps: `@biomejs/biome 1.9.4`, `bun-types 1.1.42`, `typescript 5.7.3`
- `tsconfig.base.json` — strict TS 5.7 config with `noUncheckedIndexedAccess`, `moduleResolution: bundler`, `types: [bun-types]`
- `biome.json` — lint + format config (suspicious.noExplicitAny: warn, 2-space indent, 100-col line width)
- `bun.lock` — Bun text lockfile (1015 deps resolved; committed for reproducibility per Pitfall #8)

### Created — packages/emmy-provider (3)
- `packages/emmy-provider/package.json` — `@emmy/provider` 0.1.0, pins `@mariozechner/pi-coding-agent` 0.68.0
- `packages/emmy-provider/tsconfig.json` — extends base, includes `src/**/*.ts`
- `packages/emmy-provider/src/index.ts` — Wave-0 shell (`export const PACKAGE_VERSION = "0.1.0"`)

### Created — packages/emmy-tools (3)
- `packages/emmy-tools/package.json` — `@emmy/tools` 0.1.0
- `packages/emmy-tools/tsconfig.json` — extends base
- `packages/emmy-tools/src/index.ts` — Wave-0 shell

### Created — packages/emmy-ux (4)
- `packages/emmy-ux/package.json` — `@emmy/ux` 0.1.0, `"bin": { "pi-emmy": "./bin/pi-emmy.ts" }`
- `packages/emmy-ux/tsconfig.json` — extends base, includes `src/` + `bin/`
- `packages/emmy-ux/src/index.ts` — Wave-0 shell
- `packages/emmy-ux/bin/pi-emmy.ts` — `#!/usr/bin/env bun` shim, executable, prints wave-0 message + exit 0

### Created — packages/emmy-telemetry (3)
- `packages/emmy-telemetry/package.json` — `@emmy/telemetry` 0.1.0
- `packages/emmy-telemetry/tsconfig.json` — extends base
- `packages/emmy-telemetry/src/index.ts` — `TelemetryRecord` interface + `emitEvent` no-op (Phase 3 impl seam)

### Created — profiles/qwen3.6-35b-a3b/v2 (7)
- `profiles/qwen3.6-35b-a3b/v2/profile.yaml` — cloned + 3-line KNOWN-STALE header + `version: v2`
- `profiles/qwen3.6-35b-a3b/v2/harness.yaml` — byte-identical to v1 (TODO(Phase-2) comments intact; Plan 07 fills)
- `profiles/qwen3.6-35b-a3b/v2/serving.yaml` — byte-identical to v1
- `profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md` — byte-identical to v1
- `profiles/qwen3.6-35b-a3b/v2/prompts/system.md` — byte-identical to v1 (SP_OK canary line preserved)
- `profiles/qwen3.6-35b-a3b/v2/tool_schemas/.gitkeep` — byte-identical to v1
- `profiles/qwen3.6-35b-a3b/v2/grammars/.gitkeep` — byte-identical to v1

### Created — docs (2)
- `docs/mcp_servers_template.yaml` — user-level MCP registry example + D-15/D-16/D-17/D-18 dispatch rules
- `docs/agents_md_template.md` — AGENTS.md starter stub for CONTEXT-01

### Modified (1)
- `.gitignore` — appended `node_modules/`, `packages/*/dist/`, `.turbo/` (bun.lock / bun.lockb deliberately NOT added)

## Decisions Made

- **Bun 1.3 text-lockfile (`bun.lock`) committed in place of legacy binary `bun.lockb`.** Bun ≥1.2 defaulted to text lockfiles; the binary `bun.lockb` has been deprecated as the default. Text lockfile satisfies the plan's reproducibility spirit (Pitfall #8 — lockfile must be committed, not gitignored, and must be regeneration-stable) better than the binary format because it is diff-readable. Updated `.gitignore` to ignore neither `bun.lock` nor `bun.lockb`.
- **`bun-types 1.1.42` added to workspace devDependencies.** The plan's `tsconfig.base.json` spec references `"types": ["bun-types"]`, which requires that package be installed for `tsc --noEmit` to resolve. Not explicitly listed in the plan's devDependencies — a Rule 3 (blocking-issue) fix caught by the typecheck gate.
- **pi-coding-agent pinned EXACTLY `0.68.0` in all four packages** (zero `^`/`~` per CLAUDE.md Pitfall #8 + T-02-01-04 threat register).
- **Profile v2 as a sibling directory** rather than mutating v1 (follows 02-PATTERNS.md §Profile-side modifications recommended path — preserves Phase 1 v1-locked smoke test).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Bun runtime not installed on host**
- **Found during:** Pre-flight (before Task 1)
- **Issue:** `bun` not on PATH; plan `user_setup` called out Bun 1.1+ as an install requirement but no Bun was present on the DGX Spark host. Every plan command (`bun install`, `bun run typecheck`, `bun link`) would fail.
- **Fix:** Ran `curl -fsSL https://bun.sh/install | bash` per `user_setup.dashboard_config` — installed Bun 1.3.13 (>= 1.1 required). Exported `$HOME/.bun/bin` onto PATH for the executor shell.
- **Files modified:** None in repo (Bun installed to `~/.bun/bin/bun`, outside the working tree)
- **Verification:** `bun --version` → `1.3.13`; subsequent `bun install`, `bun run typecheck`, `bun link` all exit 0.
- **Committed in:** N/A (host-level install, not a code change)

**2. [Rule 3 - Blocking Issue] Missing `bun-types` devDependency**
- **Found during:** Task 1, typecheck step
- **Issue:** `bun run typecheck` failed in all four packages with `TS2688: Cannot find type definition file for 'bun-types'`. The plan's `tsconfig.base.json` spec (reproduced verbatim into the repo) declares `"types": ["bun-types"]` but the plan's workspace `devDependencies` block listed only `@biomejs/biome` and `typescript`. Without `bun-types`, `tsc --noEmit` cannot resolve the referenced type library.
- **Fix:** Added `"bun-types": "1.1.42"` to workspace `package.json` → `devDependencies`. Re-ran `bun install` (8 packages installed in 581ms) + `bun run typecheck` → all 4 packages exit 0.
- **Files modified:** `package.json` (workspace root devDependencies)
- **Verification:** `bun run typecheck` → all four `Exited with code 0`.
- **Committed in:** `4fa82ac` (part of Task 1 commit)

**3. [Rule 3 - Tool Format Drift] `bun.lockb` → `bun.lock` (Bun 1.3 default)**
- **Found during:** Task 1, post-install file check
- **Issue:** Plan acceptance criteria (Task 1 + overall verification) checked for `test -f bun.lockb` and `grep -c 'bun\.lockb' .gitignore`. Bun 1.3.13 produces `bun.lock` (JSONC text format) as the default lockfile; `bun.lockb` (binary) was the Bun 1.1-era default but is no longer generated by default. Forcing `bun.lockb` via `--save-binary-lockfile` would contradict Bun's current stance and produce a non-diffable artifact.
- **Fix:** Committed `bun.lock` as the lockfile-of-record. Verified `.gitignore` contains NEITHER `bun.lock` NOR `bun.lockb` (so any format Bun happens to produce in the future is captured). The underlying plan intent (Pitfall #8 — lockfile committed for reproducibility; TS-side analog of Phase 1 `uv.lock` discipline) is preserved — `bun.lock` is actually a BETTER reproducibility artifact than `bun.lockb` because it is diff-readable for audit.
- **Files modified:** `bun.lock` (created, committed); `.gitignore` (no bun-lockfile entry present)
- **Verification:** `test -f bun.lock` → found. `grep -c 'bun\.lock' .gitignore` → 0 (neither format ignored).
- **Committed in:** `4fa82ac` (part of Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking issues)
**Impact on plan:** All three deviations were strict blockers for plan execution. None introduced scope creep. Deviation 3 is the only one where the committed artifact differs from the plan spec; the underlying reproducibility invariant (Pitfall #8) is preserved exactly — arguably strengthened since the text lockfile is auditable.

## Issues Encountered

None beyond the three auto-fixed deviations above. `bun install` succeeded against the live npm registry on first attempt (no air-gap fallback needed); `bun link` placed `pi-emmy` at `~/.bun/bin/pi-emmy` (symlink into `~/.bun/install/global/node_modules/@emmy/ux/bin/pi-emmy.ts`) without needing a PATH tweak.

## User Setup Required

The plan's `user_setup` block called for Bun 1.1+ on the DGX Spark host. Bun 1.3.13 was installed during pre-flight (documented as Deviation 1). No further user action needed for Plan 02-01 itself. Downstream plans (02-04, 02-06) may need:
- MCP-server npm packages installed (for MCP bridge integration tests) — deferred to their own plans
- `@mariozechner/pi-coding-agent` actual usage (imports beyond the pinned package.json) — deferred to Plan 02-02/02-04

See `docs/mcp_servers_template.yaml` and `docs/agents_md_template.md` for user-level config starters.

## Next Phase Readiness

**Wave 1 unblocked:** Plans 02-02, 02-03, 02-06 can now run in parallel against this skeleton (worktree-isolated per Phase 2 parallel plan).

**Wave 2 unblocked after Wave 1:** Plan 02-04 (`pi-emmy` real wiring — `createAgentSessionRuntime`) replaces `packages/emmy-ux/bin/pi-emmy.ts` and wires `@emmy/provider` + `@emmy/tools` extensions.

**Profile v2 ready for Plan 07:** `profiles/qwen3.6-35b-a3b/v2/harness.yaml` still carries every `TODO(Phase-2)` comment from v1. Plan 07 fills them + recomputes the v2 hash (`uv run emmy profile hash --write`). v2 profile currently carries the v1 hash as KNOWN-STALE — do NOT ship v2 as the active profile until Plan 07 lands.

**Guardrails confirmed post-plan:**
- Phase 1 v1 profile byte-identical (certification hash `sha256:b91e747...` preserved)
- Phase 1 unit tests: 137 passed / 1 skipped (no regression)
- `bun run typecheck` on all four packages: GREEN
- `pi-emmy` shim smoke: GREEN (prints wave-0, exits 0)

## Self-Check: PASSED

Verified before returning:

- **Files created:**
  - `FOUND: package.json`
  - `FOUND: tsconfig.base.json`
  - `FOUND: biome.json`
  - `FOUND: bun.lock`
  - `FOUND: packages/emmy-provider/{package.json,tsconfig.json,src/index.ts}`
  - `FOUND: packages/emmy-tools/{package.json,tsconfig.json,src/index.ts}`
  - `FOUND: packages/emmy-ux/{package.json,tsconfig.json,src/index.ts,bin/pi-emmy.ts}`
  - `FOUND: packages/emmy-telemetry/{package.json,tsconfig.json,src/index.ts}`
  - `FOUND: profiles/qwen3.6-35b-a3b/v2/{profile.yaml,serving.yaml,harness.yaml,PROFILE_NOTES.md,prompts/system.md,tool_schemas/.gitkeep,grammars/.gitkeep}`
  - `FOUND: docs/mcp_servers_template.yaml`
  - `FOUND: docs/agents_md_template.md`
- **Commits exist:**
  - `FOUND: 4fa82ac` (Task 1 feat)
  - `FOUND: ae97e04` (Task 2 feat)
- **Guardrails:**
  - `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1/` → exit 0 (Phase 1 v1 unchanged)
  - `uv run pytest tests/unit -q` → 137 passed, 1 skipped (Phase 1 suite unchanged)
  - `bun run typecheck` → 4/4 packages exit 0
  - `pi-emmy` smoke → prints `pi-emmy wave-0 shim — Plan 04 wires createAgentSessionRuntime`, exit 0
  - `diff -r v1 v2 | wc -l` → 9 (under ≤ 10 gate)

---
*Phase: 02-pi-harness-mvp-daily-driver-baseline*
*Completed: 2026-04-21*
