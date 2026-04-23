---
phase: 04
plan: 04
subsystem: harness
tags: [routes, variants, within-model-routing, otel, profile-variant, harness-08]
requires:
  - 04-01  # v3.1 base profile + schema extensions for reasoning_parser + max_num_seqs
  - 04-03  # profile-stamp-processor mutable profile + harness-swap hot-swap contract
provides:
  - "profiles/routes.yaml"
  - "3 Qwen v3.1 sibling variant bundles (default, reason, precise)"
  - "routes-loader + variant-resolver + turn-role-context + OTel variant/role stamping"
  - "VariantSnapshot wire-path contract"
affects:
  - "packages/emmy-ux/src/pi-emmy-extension.ts (before_provider_request + turn_end)"
  - "packages/emmy-provider/src/before-request-hook.ts (optional variantSnapshot arg)"
  - "packages/emmy-telemetry/src/profile-stamp-processor.ts (variant/role attrs)"
  - "emmy_serve/profile/schema.py (HarnessConfig optional variant fields)"
tech-stack:
  added:
    - "js-yaml parse of profiles/routes.yaml (LiteLLM-shape)"
    - "Phase 4 HARNESS-08 variant filesystem convention (sibling dirs with byte-identical engine)"
  patterns:
    - "session-context.ts module-level state (applied to turn-role-context.ts)"
    - "profile-loader.ts js-yaml + ProfileLoadError style (applied to routes-loader.ts)"
    - "before_provider_request payload mutation (extended with variantSnapshot)"
key-files:
  created:
    - "profiles/routes.yaml"
    - "profiles/qwen3.6-35b-a3b/v3.1-default/ (full bundle)"
    - "profiles/qwen3.6-35b-a3b/v3.1-reason/ (full bundle)"
    - "profiles/qwen3.6-35b-a3b/v3.1-precise/ (full bundle)"
    - "packages/emmy-ux/src/routes-loader.ts"
    - "packages/emmy-provider/src/variant-resolver.ts"
    - "packages/emmy-telemetry/src/turn-role-context.ts"
    - "packages/emmy-ux/test/routes-loader.test.ts"
    - "packages/emmy-provider/test/variant-sampling.test.ts"
    - "packages/emmy-telemetry/test/variant-stamp.test.ts"
    - "packages/emmy-telemetry/test/variant-stamp-absent.test.ts"
    - "tests/unit/test_variant_engine_byte_identity.py"
  modified:
    - "emmy_serve/profile/schema.py (HarnessConfig + VariantSamplingDefaults)"
    - "packages/emmy-provider/src/types.ts (+VariantSnapshot)"
    - "packages/emmy-provider/src/before-request-hook.ts (+variantSnapshot arg)"
    - "packages/emmy-provider/src/index.ts (+variant-resolver exports)"
    - "packages/emmy-telemetry/src/profile-stamp-processor.ts (+onStart variant/role)"
    - "packages/emmy-telemetry/src/index.ts (+turn-role-context exports)"
    - "packages/emmy-ux/src/pi-emmy-extension.ts (factory routes load + before_provider_request classifier + turn_end clear)"
    - "packages/emmy-ux/src/index.ts (+routes-loader re-exports)"
decisions:
  - "D-10 resolved — sibling dirs under profiles/qwen3.6-35b-a3b/v3.1-*/ with engine byte-identical serving.yaml (CI-enforced)"
  - "D-11 resolved — role classifier in before_provider_request is (1) explicit emmy envelope override, (2) last-user-message regex for plan/edit/critic, (3) tools[] hint for edit/write, (4) default. Ordering: message-text first because nextTool is iteration-2+ only"
  - "Rule 3 deviation — schema.py HarnessConfig extended with optional sampling_defaults + chat_template_kwargs to support variant-level harness fields; base profiles validate unchanged"
  - "Rule 3 deviation — RouteRef/RoutesConfig types moved to @emmy/provider (not @emmy/ux) to break circular dependency; @emmy/ux re-exports from the single source of truth"
metrics:
  duration_minutes: 60
  completed: '2026-04-23'
  task_count: 2
  commits:
    - "219545b feat(04-04): Qwen v3.1 sibling variants + routes.yaml + byte-identity CI (HARNESS-08)"
    - "7cb2d7b feat(04-04): TS plumbing — routes-loader + variant-resolver + OTel variant/role stamping (HARNESS-08)"
---

# Phase 4 Plan 04-04: Qwen variants + routes.yaml + within-model role routing

## One-liner

Within-model role routing: `routes.yaml` maps turn roles (plan/edit/critic) to Qwen v3.1 sibling variants; `before_provider_request` classifies role, resolves variant, applies harness overrides to the outgoing chat request, and stamps `emmy.profile.variant` + `emmy.role` on every turn's OTel span — without restarting the vLLM engine (sibling variants share a byte-identical `serving.yaml`, CI-enforced).

## What shipped

### 1. Three Qwen v3.1 sibling variant bundles + routes.yaml (Task 1)

| Variant | Content hash | Sampling override | chat_template_kwargs |
|---------|--------------|-------------------|----------------------|
| `v3.1-default` | `sha256:6ff80f620720563652f192d42da47418ecb2bfd96d3eacd6166252c35d65a4cf` | temperature=0.2 (Qwen team blog 2026-04-16 coding default) | enable_thinking=false |
| `v3.1-reason`  | `sha256:705dcb60bcfc1236d70298c967a20ad3eebbc143a48d0770ae1e2364c3e4836f` | temperature=0.6 (Qwen reasoning-turn guidance, qwenlm.github.io/blog/qwen3) | enable_thinking=true |
| `v3.1-precise` | `sha256:f16edde8cfe273ad9e9f3dd7a2ab3b03a7060a2acbb61e632585ed5ca19a95b2` | temperature=0.0 + every tool 0.0 (CLAUDE.md Hash-anchored edits + TOOLS-03) | enable_thinking=false |

**Engine byte-identity verified:** `diff profiles/qwen3.6-35b-a3b/v3.1/serving.yaml profiles/qwen3.6-35b-a3b/v3.1-{default,reason,precise}/serving.yaml` — all three produce empty diff.

**routes.yaml contents (verbatim):**

```yaml
default: qwen3.6-35b-a3b@v3.1-default

roles:
  plan:   qwen3.6-35b-a3b@v3.1-reason
  edit:   qwen3.6-35b-a3b@v3.1-precise
  critic: qwen3.6-35b-a3b@v3.1-default
```

**CI test `test_variant_engine_byte_identity.py`:**

- 3 tests: per-variant-group byte-identity, `emmy profile validate` per variant, hash uniqueness.
- All green (188/188 Python unit tests pass).

### 2. TS plumbing (Task 2)

**File → rough LOC:**

| File | LOC | Role |
|------|-----|------|
| `packages/emmy-ux/src/routes-loader.ts` | 130 | js-yaml parse of routes.yaml → RoutesConfig; RoutesLoadError on malformed input; roles fall back to default when absent |
| `packages/emmy-provider/src/variant-resolver.ts` | 55 | Pure `resolveVariant(role, routes, profilesRoot) → ResolvedVariant`; no I/O; owns the shared RouteRef/RoutesConfig types to break the @emmy/ux ↔ @emmy/provider circular dep |
| `packages/emmy-provider/src/before-request-hook.ts` (+40 LOC) | — | Added `variantSnapshot?` arg; when present, overrides `payload.temperature/top_p/top_k/max_tokens` + merges `chat_template_kwargs` over the Phase 3 D-02a default |
| `packages/emmy-provider/src/types.ts` (+35 LOC) | — | Added VariantSnapshot interface |
| `packages/emmy-telemetry/src/turn-role-context.ts` | 55 | Module-level turn context (session-context.ts analog): set / clear / get |
| `packages/emmy-telemetry/src/profile-stamp-processor.ts` (+20 LOC) | — | `onStart` now reads `getCurrentTurnRoleContext()` and conditionally stamps `emmy.profile.variant`, `emmy.profile.variant_hash`, `emmy.role` — absent when no turn context is set (backward-compat for Plan 03-02 span tests) |
| `packages/emmy-ux/src/pi-emmy-extension.ts` (+175 LOC) | — | Factory: `loadRoutes(...)` with ENOENT fallback; lazy per-variant snapshot cache (reads harness.yaml raw for the two variant-level fields). `before_provider_request` (now async): `classifyRole` → `resolveVariant` → `loadVariantSnapshot` → `setCurrentTurnRoleContext` → `handleBeforeProviderRequest({variantSnapshot})`. `turn_end`: `clearCurrentTurnRoleContext()` |

### 3. Role heuristic (D-11 resolution)

Implemented in `classifyRole(payload)` — **pure on payload shape, never on profile id or model name (D-19 compliant):**

```
1. payload.emmy.role (explicit override)      → verbatim  (tests/replay)
2. last user message text regex:
     ^(plan:|think about|architect|design|strategy|outline)  → "plan"
     ^(edit|write|modify|rename|refactor|fix)\s              → "edit"
     ^(review|critique|audit|check|verify)\s                 → "critic"
3. payload.tools[] contains function name "edit" or "write"  → "edit"   (iter 2+ refinement)
4. else                                                      → "default"
```

**First-invocation note:** On iteration 1 of any turn, `turn.nextTool` is undefined, so the user-message regex does the initial classification. If iteration 2+ refines the role (e.g. the model emits an `edit` tool call on a turn initially classified "default"), the second `before_provider_request` invocation re-stamps `emmy.role` on the new chat-request span. **One turn_id can therefore carry spans with different `emmy.role` values across iterations**, and Plan 04-06's SC-3 walkthrough scoring rule will be: a turn is "correctly routed" iff its FINAL chat-request span (the one that produced the tool call) carries the expected role.

### 4. D-12 OTel attribute extension

EmmyProfileStampProcessor.onStart now stamps up to **6 attributes** (3 base + 3 optional):

- **Always:** `emmy.profile.id`, `emmy.profile.version`, `emmy.profile.hash`
- **When turn context set:** `emmy.profile.variant`, `emmy.profile.variant_hash`, `emmy.role`

Backward-compat: Plan 03-02's span-attribute tests still pass because the processor only emits keys that are populated. The `variant-stamp-absent.test.ts` asserts this invariant explicitly.

## Test counts

| Test | Count | Status |
|------|-------|--------|
| Python: `test_variant_engine_byte_identity.py` | 3 | ✅ all green |
| Python: full `tests/unit/` suite | 188 | ✅ all green (1 skip: shellcheck-not-installed — unchanged) |
| TS: `routes-loader.test.ts` | 5 | ✅ all green |
| TS: `variant-sampling.test.ts` | 4 | ✅ all green |
| TS: `variant-stamp.test.ts` | 3 | ✅ all green |
| TS: `variant-stamp-absent.test.ts` | 1 | ✅ green |
| TS: full `bun test` across 73 files | 520 | ✅ all green |
| TS: `bun run typecheck` across 5 packages | 5 | ✅ all exit 0 |
| D-19: `test_no_model_conditionals.py` | 2 | ✅ all green |
| D-19: `no-model-conditionals.test.ts` | 2 | ✅ all green |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] HarnessConfig schema extension for variant-level sampling_defaults + chat_template_kwargs**

- **Found during:** Task 1, during variant `emmy profile validate`.
- **Issue:** The plan's Task 2 Step 2c + research §4.2 called for variant harness.yaml to carry `sampling_defaults` at top level, but `HarnessConfig` in `emmy_serve/profile/schema.py` had `extra="forbid"` and rejected the field. RESEARCH.md §4 claimed "Schema does not change", but that was optimistic — VariantSnapshot semantics require these fields on harness.yaml, not serving.yaml (serving.yaml is byte-identical across siblings).
- **Fix:** Added `VariantSamplingDefaults` BaseModel (all fields Optional) + extended `HarnessConfig` with optional `sampling_defaults: Optional[VariantSamplingDefaults]` and `chat_template_kwargs: Optional[dict[str, Any]]`. Base profiles (v1, v2, v3, v3.1 root) continue to validate unchanged because both fields default to None.
- **Files modified:** `emmy_serve/profile/schema.py`
- **Commit:** 219545b

**2. [Rule 3 - Blocking] RouteRef/RoutesConfig types in @emmy/provider, not @emmy/ux**

- **Found during:** Task 2 initial wiring.
- **Issue:** The plan's §12 pattern wrote `RoutesConfig` in `@emmy/ux/routes-loader.ts` and imported it into `@emmy/provider/variant-resolver.ts`. But `@emmy/ux` already depends on `@emmy/provider` (for `ProfileSnapshot`, `handleBeforeProviderRequest`, etc.), so the reverse direction creates a circular dependency.
- **Fix:** Moved `RouteRef`, `RoutesConfig`, `ResolvedVariant`, `RoleKey` type definitions into `@emmy/provider/src/variant-resolver.ts`. `@emmy/ux/src/routes-loader.ts` imports + re-exports them from `@emmy/provider` so callers of `loadRoutes()` still get a coherent public surface from a single package.
- **Files modified:** `packages/emmy-provider/src/variant-resolver.ts`, `packages/emmy-ux/src/routes-loader.ts`, `packages/emmy-provider/src/index.ts`
- **Commit:** 7cb2d7b

**3. [Rule 1 - Bug] Bun test harness: global tracer provider caches across tests**

- **Found during:** Task 2, running `variant-stamp.test.ts` after initial write.
- **Issue:** Original test used `trace.setGlobalTracerProvider(newProvider) + trace.getTracer("emmy-test")` per test. After the first test, subsequent tests hit a cached tracer bound to the first test's provider, so spans never reached each test's fresh `InMemorySpanExporter`.
- **Fix:** Switched to `provider.getTracer(...)` directly on the test-scoped provider, avoiding the global singleton entirely. No need to save/restore original provider either. Each test gets a fully isolated pipeline.
- **Files modified:** `packages/emmy-telemetry/test/variant-stamp.test.ts`, `packages/emmy-telemetry/test/variant-stamp-absent.test.ts`
- **No separate commit** — landed as part of 7cb2d7b.

## Operator-gated deferrals

- **SC-3 multi-turn walkthrough + Langfuse trace inspection:** deferred to Plan 04-06 per the plan's `<deferred>` section. Requires a live DGX Spark session, the operator driving turns that exercise each role classification branch, and an inspection of Langfuse spans to confirm `emmy.role` / `emmy.profile.variant` round-trip through OTLP.
- **D-19 audit formalization:** already landed in Plan 04-05 (Wave 1 base commit). This plan's Task 2 was verified against it (both Python + TS audits green).

## Known Stubs

None. Every code path in this plan is functionally wired end-to-end:
- Absent routes.yaml → factory silently falls back to default-only mode (intentional per D-08 "absence = default-only mode").
- Variant bundle load failure → `classifyRole` fires, `resolveVariant` returns a path, `loadVariantSnapshot` logs an error + returns null, `handleBeforeProviderRequest` runs without `variantSnapshot` (existing behavior). No UI rendering stubs; no placeholder strings.

## Files self-check

```
FOUND: /data/projects/emmy/profiles/routes.yaml
FOUND: /data/projects/emmy/profiles/qwen3.6-35b-a3b/v3.1-default/profile.yaml (hash sha256:6ff80f620720563652f192d42da47418ecb2bfd96d3eacd6166252c35d65a4cf)
FOUND: /data/projects/emmy/profiles/qwen3.6-35b-a3b/v3.1-reason/profile.yaml  (hash sha256:705dcb60bcfc1236d70298c967a20ad3eebbc143a48d0770ae1e2364c3e4836f)
FOUND: /data/projects/emmy/profiles/qwen3.6-35b-a3b/v3.1-precise/profile.yaml (hash sha256:f16edde8cfe273ad9e9f3dd7a2ab3b03a7060a2acbb61e632585ed5ca19a95b2)
FOUND: /data/projects/emmy/tests/unit/test_variant_engine_byte_identity.py
FOUND: /data/projects/emmy/packages/emmy-ux/src/routes-loader.ts
FOUND: /data/projects/emmy/packages/emmy-provider/src/variant-resolver.ts
FOUND: /data/projects/emmy/packages/emmy-telemetry/src/turn-role-context.ts
FOUND: /data/projects/emmy/packages/emmy-ux/test/routes-loader.test.ts
FOUND: /data/projects/emmy/packages/emmy-provider/test/variant-sampling.test.ts
FOUND: /data/projects/emmy/packages/emmy-telemetry/test/variant-stamp.test.ts
FOUND: /data/projects/emmy/packages/emmy-telemetry/test/variant-stamp-absent.test.ts
```

## Commits verified in git log

```
FOUND: 219545b feat(04-04): Qwen v3.1 sibling variants + routes.yaml + byte-identity CI (HARNESS-08)
FOUND: 7cb2d7b feat(04-04): TS plumbing — routes-loader + variant-resolver + OTel variant/role stamping (HARNESS-08)
```

## Self-Check: PASSED
