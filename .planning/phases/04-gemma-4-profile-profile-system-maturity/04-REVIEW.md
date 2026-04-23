---
phase: 04-gemma-4-profile-profile-system-maturity
reviewed: 2026-04-23T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - emmy_serve/swap/__init__.py
  - emmy_serve/swap/orchestrator.py
  - emmy_serve/swap/preflight.py
  - emmy_serve/swap/progress.py
  - emmy_serve/swap/rollback.py
  - emmy_serve/profile/schema.py
  - emmy_serve/cli.py
  - emmy_serve/diagnostics/bundle.py
  - packages/emmy-ux/src/profile-swap-runner.ts
  - packages/emmy-ux/src/profile-index.ts
  - packages/emmy-ux/src/slash-commands.ts
  - packages/emmy-ux/src/harness-swap.ts
  - packages/emmy-ux/src/routes-loader.ts
  - packages/emmy-ux/src/pi-emmy-extension.ts
  - packages/emmy-ux/src/index.ts
  - packages/emmy-provider/src/variant-resolver.ts
  - packages/emmy-provider/src/before-request-hook.ts
  - packages/emmy-provider/src/types.ts
  - packages/emmy-provider/src/index.ts
  - packages/emmy-telemetry/src/profile-stamp-processor.ts
  - packages/emmy-telemetry/src/turn-role-context.ts
  - packages/emmy-telemetry/src/index.ts
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-04-23
**Depth:** standard
**Files Reviewed:** 22 (Python swap primitive + TS swap/routing plumbing + OTel stamping + D-19 audit harness)
**Status:** issues_found — advisory only (phase is already CLOSED per 04-CLOSEOUT.md)

## Summary

Phase 4 ships a cleanly-factored atomic swap primitive (Py) paired with a TS driver that enforces the D-04/D-05 invariants precisely — the preflight/rollback boundary is tight, the "validate-first-then-stop" property is behaviorally verified by the unit tests, and the `no_rollback=True` infinite-loop guard is provably correct (one-level recursion only; inner failure returns 6 without re-entering `_maybe_rollback`). OTel variant/role stamping handles absence correctly (variant-stamp-absent.test.ts) and preserves Plan 03-02 backward compat. The D-19 no-model-conditionals audit is well-structured with self-test coverage.

No Critical security or correctness findings. The Warnings cluster around (a) one latent path-traversal surface in the `routes.yaml` → `variant-resolver` chain (low exploitability: operator-authored file), (b) two UX/state-handling rough edges where failure modes silently degrade without surfacing to the operator, (c) the D-19 regex has classes of false negatives worth documenting for future hardening, and (d) the variant cache never evicts stale entries across `/profile` swaps.

## Warnings

### WR-01: routes.yaml ref values flow into filesystem path unchecked — path traversal possible via operator-authored config

**File:** `packages/emmy-ux/src/routes-loader.ts:68-76` (parseRef) + `packages/emmy-provider/src/variant-resolver.ts:57` (resolveVariant) + `packages/emmy-ux/src/pi-emmy-extension.ts:313` (readFileSync harness.yaml)

**Issue:** `parseRef` extracts `profileId` and `variant` from a YAML string with only `.trim()` and emptiness checks — no rejection of `/`, `..`, `\`, or absolute paths. These values flow directly into `join(profilesRoot, ref.profileId, ref.variant)` in `resolveVariant`, and then into `readFileSync(joinPath(resolved.variantPath, "harness.yaml"), "utf8")` inside `loadVariantSnapshot`. A routes.yaml of the form:

```yaml
default: ../../../etc@passwd
```

resolves to `profiles/../../../etc/passwd/harness.yaml`, which `readFileSync` tries to open. Real disclosure requires an attacker-controlled `routes.yaml` and a target that happens to have a `harness.yaml` sibling — low exploitability in a single-user local-only setting — but the YAML loader's output is actively used as a path segment and that pattern is worth hardening.

Secondary concern: `profile-index.ts:57` skips the string `"routes.yaml"` by name but accepts any other top-level filename as a potential `profileId` from `resolve(name, variant)`. Slash-command input is also user-controlled (operator types `/profile ../etc@whatever`) — the `profileIndex.resolve` lookup is dict-based and returns `null` for absent keys, which blocks the traversal; however the underlying `readFileSync` in the before-request hook bypasses the index entirely by going through the route resolver.

**Fix:** Validate `profileId` and `variant` against a tight allowlist regex before returning from `parseRef` — e.g. `/^[A-Za-z0-9._-]+$/`. Also reject values containing `..`, `/`, or a leading `.`:

```ts
const VALID_REF_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function parseRef(raw: unknown, field: string): RouteRef {
    // ...existing type/@ checks...
    if (!VALID_REF_COMPONENT.test(profileId) || profileId.includes("..")) {
        throw new RoutesLoadError(field, `invalid profileId '${profileId}': must match ${VALID_REF_COMPONENT}`);
    }
    if (!VALID_REF_COMPONENT.test(variant) || variant.includes("..")) {
        throw new RoutesLoadError(field, `invalid variant '${variant}': must match ${VALID_REF_COMPONENT}`);
    }
    return { profileId, variant };
}
```

Additionally in `loadVariantSnapshot` (pi-emmy-extension.ts:313), verify `resolved.variantPath` begins with `path.resolve(profilesRoot)` as a defense-in-depth check before opening the file.

---

### WR-02: variantCache never evicts on /profile hot-swap — stale variant data after swap chain

**File:** `packages/emmy-ux/src/pi-emmy-extension.ts:270` (cache allocation), `pi-emmy-extension.ts:337` (cache insert), `harness-swap.ts:72-118` (reloadHarnessProfile does not touch variantCache)

**Issue:** `variantCache` is a `Map<string, VariantSnapshot>` keyed on `resolved.variantPath`. After a `/profile` swap completes, `reloadHarnessProfile` replaces the closure-captured `currentProfile` and swaps the OTel stamp processor, but the `variantCache` lives inside the factory closure and is never cleared. If a future phase (or an operator manually) modifies a variant's `harness.yaml` on disk between swaps, subsequent `before_provider_request` calls will return the pre-edit cached snapshot indefinitely. The inline comment at line 267-269 explicitly claims "the cache survives /profile swaps where only the default might move" but this is a correctness trade-off, not a safety guarantee — the assumption "variants still live on disk and produce byte-identical serving.yaml" protects engine identity, not harness-side snapshot freshness.

**Fix:** Clear or invalidate the cache on `reloadHarnessProfile`. Either:
1. Add a `clearVariantCache` setter to the factory's handles object and call it from `reloadHarnessProfile`, OR
2. Replace the Map with a content-hash-keyed cache so stale entries are shadowed by new entries (still grows unbounded — needs a size cap).

The minimum-invasive patch:

```ts
// In pi-emmy-extension.ts factory closure, alongside setCurrentProfile:
const clearVariantCache = (): void => { variantCache.clear(); };

// Pass through to harness-swap:
reloadHarnessProfile: async (newDir) => {
    await reloadHarnessProfile(newDir, {
        replaceProfileRef: setCurrentProfile,
        profileStampProcessor,
        clearVariantCache, // new handle
    });
},
```

---

### WR-03: orchestrator silently drops mid-load pct advancement when vLLM boots fast — misleading progress UX

**File:** `emmy_serve/swap/orchestrator.py:97-123`

**Issue:** The swap emits `pct=0` before `docker run`, then unconditionally emits `pct=50` and `pct=90` regardless of what vLLM actually did between them. On a fast boot (e.g. cached weights), all three emissions happen within milliseconds and the TUI shows `loading weights 90%` almost immediately, then stalls at 90% through the full warmup window (up to 300 s). On a slow boot (cold weights), the operator sees `0% → 50%` instantly and then stalls at 50% for minutes. Both cases are visually misleading. The code comment (`"We don't log-scrape vllm output in this plan (Phase 5 polish) — just fire a midpoint signal so the TUI footer moves"`) is honest, but the current scheme hurts trust because the pct value has no correlation with actual progress.

**Fix:** Either (a) drop the synthetic midpoint entirely and let the UI show `loading weights` without a percentage (the renderer in `slash-commands.ts:207-211` already handles the `pct === undefined` case correctly), or (b) emit `pct=0` and rely on `wait_for_vllm` log-scrape in a follow-up. Short-term minimum patch: drop the `emit(LOADING, pct=50)` and the `emit(LOADING, pct=90)` calls — the four D-02 phase labels remain correct; only the best-effort pct signal goes away. That is a UX regression only for the 3-line `50/90` scaffolding, which is less misleading than the current behavior.

---

### WR-04: reloadHarnessProfile resets offline-badge to green without re-running the boot-audit → stale "offline-OK" after swap

**File:** `packages/emmy-ux/src/harness-swap.ts:98-112`

**Issue:** After a `/profile` swap, `reloadHarnessProfile` calls `setInitialAudit({offline_ok: true, ..., badge_state: "green"})` unconditionally. The call-site comment acknowledges this is intentional ("resets the badge state machine to green so a prior RED flip from the old profile doesn't persist spuriously after swap") but the effect is that a genuine policy violation observed just before the swap is silently wiped. If the operator swapped TO a profile with a WEAKER web_fetch allowlist, the badge claims green until the next fetch attempt, masking the posture regression.

Correctness issue: `setInitialAudit` is called with `offline_ok: true` and `badge_state: "green"` as hardcoded literals without actually running the Plan 03-06 `runBootOfflineAudit` function against the new profile's policy. A profile with an empty/default-deny allowlist and a `web_search.enabled=true` block ships a fundamentally different posture; the badge should reflect that.

**Fix:** Run the boot audit against the new profile snapshot and feed its output to `setInitialAudit`:

```ts
// In harness-swap.ts reloadHarnessProfile, after snap is loaded:
const auditResult = runBootOfflineAudit({
    profile: snap,
    // other opts as needed
});
setInitialAudit(auditResult);
```

This mirrors the session-boot flow and keeps the badge source-of-truth tied to actual policy, not to a swap-happened signal.

---

### WR-05: D-19 no-model-conditionals audit has documented false negatives — narrow by design, worth noting

**File:** `tests/unit/test_no_model_conditionals.py:48-50` + `packages/emmy-ux/test/no-model-conditionals.test.ts:30`

**Issue:** The regex requires a conditional keyword AND a model name on the SAME LINE. This misses every plausible real-world way to smuggle model-name conditionals past the audit:

1. Ternary / logical operator conditionals (no keyword): `const x = model.includes("qwen") ? a : b;` or `return isQwen && method();`
2. Multi-line conditionals: `if (\n    model === "qwen"\n) { ... }` — keyword on one line, name on next
3. Named boolean indirection: `const isQwen = model === "qwen"; if (isQwen) { ... }` — neither line matches
4. Function-level dispatch tables: `const HANDLERS = { qwen: fn1, gemma: fn2 }; HANDLERS[model]();` — no keyword, no conditional; but semantically a model-name branch
5. Python `match` with bare pattern: `match model:\n    case "qwen":\n        ...` — `case "qwen":` on same line matches (caught), but walrus/assignment shapes like `x = "qwen" if model == "qwen" else "y"` are caught only because `if` appears. Variants: `x = {"qwen": 1}.get(model)` — missed.

None of these are currently in the codebase (verified by grep for model names across `emmy_serve/` and `packages/*/src`; all hits are in comments or string literals like `"openai" | "hermes"` tool-format Literal types, which don't have a conditional keyword and so correctly don't fire). The audit is fit-for-purpose as a cheap grep-based guard; the issue is that future contributors may trust it as exhaustive and introduce forms (1)/(3)/(4) thinking they're clean.

**Fix:** Either broaden the pattern set (add a second pass that flags `(qwen|gemma|...).*\?|\?.*(qwen|gemma)` ternaries and `(qwen|gemma|...).*===` / `== ?.qwen`), or add a comment block in both audit files enumerating the limitations so the next contributor knows the edge cases. Minimum patch: extend the regex in both files to also catch ternary shapes:

```ts
const PATTERN_CONDITIONAL = /(?:\b(if|else\s+if|else|switch|case)\b).*\b(qwen|gemma|hermes|llama)\b/i;
const PATTERN_TERNARY = /\b(qwen|gemma|hermes|llama)\b.*\?|\?.*\b(qwen|gemma|hermes|llama)\b/i;
// fire if either matches
```

## Info

### IN-01: rollback's failed-new path is never actually read inside swap_profile — dead parameter threading

**File:** `emmy_serve/swap/rollback.py:40-41` + `emmy_serve/swap/rollback.py:66-72`

**Issue:** `rollback` takes `failed_new: Path` and documents it as "informational; used only for the progress log." It's passed to `swap_profile(failed_new, prior_old, ...)` as the `old_profile` argument of the recursive swap call, which is itself never read by the inner swap (the inner swap validates `prior_old` and restarts it; `old_profile` is only used by the rollback dispatcher, which is short-circuited by `no_rollback=True`). The threading is correct but the name is misleading — `failed_new` is never used informationally (the emit lines just say "rollback: restarting prior profile" with no path).

**Fix:** Either drop `failed_new` from the signature (simplest) or actually include it in the rollback log:

```python
emit(f"rollback: restarting prior profile (failed target was {failed_new})")
```

### IN-02: preflight exit code mapping in orchestrator docstring is out of sync with exit-5 collapse

**File:** `emmy_serve/swap/orchestrator.py:14-21`

**Issue:** The docstring enumerates exit codes 0/2/3/4/5/6 but code 2/3/4 are noted as reachable only via the recursive `--no-rollback` path. The primary `swap_profile` call path collapses every preflight non-zero into exit 5 at line 77. The docstring is correct but verbose; it would be clearer to state up front: "Primary callers see 0/5/6 only. Codes 2/3/4 surface only when the orchestrator is re-entered with `no_rollback=True` by `rollback()`."

**Fix:** Minor docstring polish. No code change required.

### IN-03: profile-index prefers "v3.1" as a hardcoded string default

**File:** `packages/emmy-ux/src/profile-index.ts:120-124`

**Issue:** The variant preference logic hardcodes `"v3.1"` as the first-choice default. This is documented in the header comment and in the tests, but it means adding a `v4` or `v3.2` variant to the Qwen bundle would silently continue to resolve `/profile qwen3.6-35b-a3b` (bare name) to `v3.1`. The magic string makes later profile bumps fragile.

**Fix:** Move the preference list into a named constant near the top of the file with a brief comment pointing at `.planning/STATE.md` for the current default — or derive the default by preferring the lexicographically-highest `v*` variant (which would make `v3.2` > `v3.1` automatically). Current behavior is acceptable for Phase 4; flagging for Phase 5 hygiene.

### IN-04: harness-swap.ts test introspection globals leak across reloads in multi-test processes

**File:** `packages/emmy-ux/src/harness-swap.ts:122-133`

**Issue:** `_lastReloadAllowlist` is a module-level mutable variable used for test introspection. In any production process that loads this module twice (e.g. Bun's module reloading on watch mode, or multi-session CLI invocations sharing a process), the state persists and could surface stale data. `__resetLastReloadAllowlistForTests` exists but is only called by tests that know to call it.

**Fix:** Gate the write behind a `process.env.NODE_ENV === "test"` or equivalent check, or export the function instead of a latched value so the test can get the live allowlist from a closure. Low priority — production harness lifetime is one pi-emmy invocation.

### IN-05: orchestrator's defensive `time.sleep(1)` after docker stop/rm is magic-numbered

**File:** `emmy_serve/swap/orchestrator.py:93-94`

**Issue:** `time.sleep(1)` with a comment citing UMA CUDA drain. The constant is correct per `04-RESEARCH.md §3.1` but a named constant would make the intent scannable and allow a test hook to collapse it (`time_fast` fixture in tests currently has to monkeypatch `time.sleep` globally).

**Fix:**

```python
CUDA_DRAIN_S = 1  # UMA contexts take ~1s to release after docker stop (04-RESEARCH §3.1)
# ...
time.sleep(CUDA_DRAIN_S)
```

### IN-06: `validate_bundle` strict flag defaulted to True at the CLI layer but also set via --strict

**File:** `emmy_serve/cli.py:134-138`

**Issue:** `add_argument("--strict", action="store_true", default=True, ...)` creates a contradictory flag — `action="store_true"` with `default=True` means the flag is always `True`, whether passed or not. Same pattern at line 150-154 for `--check`. This is cosmetic/docstring-only at the moment since no caller passes a falsifying form; but a future `--no-strict` counterpart would require `BooleanOptionalAction` rather than this shape.

**Fix:** Either drop the default (idiomatic `store_true` usage) or switch to `argparse.BooleanOptionalAction` for forward-compat:

```python
v.add_argument("--strict", action=argparse.BooleanOptionalAction, default=True,
               help="strict mode (default): every warning becomes an error")
```

---

## Observations (not findings)

**Verified strengths** that are load-bearing for Phase 4's correctness claims:

1. **D-04/D-05 invariants are machine-checked.** `tests/unit/test_swap_preflight_fail.py::test_preflight_NEVER_calls_docker_stop_or_run` is a true invariant test that exercises every failure branch back-to-back against the same subprocess spy. This is the gold standard for "prior engine still running" verification.

2. **Rollback recursion guard.** `test_rollback_of_rollback_prevented` proves `rollback() → swap_profile(..., no_rollback=True) → _maybe_rollback` returns 6 without re-entering `rollback()`. T-04-02-02 is closed.

3. **OTel backward-compat.** `variant-stamp-absent.test.ts` pins the invariant that absent turn context yields exactly three base attrs — this keeps Plan 03-02 span-attribute tests non-flaky.

4. **Engine byte-identity.** `test_variant_engine_byte_identity.py` enforces serving.yaml equality across sibling variants at CI time, which is the real guardrail behind "no engine restart on variant swap" — stronger than the sampling-override logic in `handleBeforeProviderRequest` alone could provide.

5. **Progress-label contract.** `progress.py` isolates the four D-02 labels in one file with clear "do not edit" comments; consumers in TS (`profile-swap-runner.ts`) parse them leniently (line-buffered, try/catch per line) so label drift fails loud in the test suite rather than at runtime.

---

_Reviewed: 2026-04-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — per-file analysis with language-specific checks; cross-file trace on variant-resolver → loader → OTel stamp path_
