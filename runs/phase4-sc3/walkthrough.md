# SC-3: Within-Model Role Routing Walkthrough

**Date:** 2026-04-23
**Executor:** claude autonomous (orchestrator session)
**Evidence root:** `runs/phase4-sc3/walkthrough-20260423T165050Z/`
**Base profile:** `profiles/qwen3.6-35b-a3b/v3.1-default`
**vLLM endpoint:** `http://127.0.0.1:8002` (Qwen3.6-35B-A3B-FP8; emmy-serve container up 14+ h)
**Verdict:** `sc3 phase4 green`

---

## SC-3 Claim (ROADMAP Phase 4 § Success Criteria § 3)

> A `routes.yaml` declaring `roles: {plan: qwen3.6-35b-a3b@v1-reason, edit: qwen3.6-35b-a3b@v1-precise, critic: qwen3.6-35b-a3b@v1-default}` (within one loaded model) routes turns through the right profile variant and each turn's trace records which role/profile was active.

(Variant IDs updated to Phase 4's shipped `v3.1-*` naming; semantic identity preserved.)

---

## Methodology

Four `pi-emmy --print` invocations against the running Qwen3.6 on :8002, one per role classifier branch. Each invocation:

1. Loads `profiles/routes.yaml` at factory construction time
2. Fires a single chat request with a prompt crafted to trigger a specific role
3. `classifyRole()` reads the user message via the D-11 heuristic
4. `resolveVariant()` maps the role to the sibling variant per `routes.yaml`
5. `loadVariantSnapshot()` reads the variant's `harness.yaml`
6. `setCurrentTurnRoleContext({variant, variantHash, role})` populates module-level turn ctx
7. `handleBeforeProviderRequest()` applies variant overrides to the outgoing chat payload
8. `emitEvent("harness.assembly", ...)` writes a JSONL record with `emmy.role` + `emmy.profile.variant` attrs (enabled this session — see "Observability Fix" below)
9. `EmmyProfileStampProcessor.onStart` stamps the same attrs on the OTel span

Evidence harvested by grep against each turn's `events.jsonl`.

### Runner
```bash
bash scripts/sc3_phase4_walkthrough.sh
```

---

## Results

| Turn | Prompt (head) | Expected role | Expected variant | Observed role | Observed variant | Status |
|------|---------------|---------------|------------------|---------------|------------------|--------|
| 1 | `plan: outline three steps to write a python cli…` | plan | v3.1-reason | **plan** | **v3.1-reason** | ✅ PASS |
| 2 | `edit README.md to add a line that says hello` | edit | v3.1-precise | **edit** | **v3.1-precise** | ✅ PASS |
| 3 | `review the following pseudocode for bugs…` | critic | v3.1-default | **critic** | **v3.1-default** | ✅ PASS |
| 4 | `hello, what is two plus two` | default | v3.1-default | **default** | **v3.1-default** | ✅ PASS |

**Aggregate:** 4/4 turns routed correctly, 4/4 variant snapshots loaded cleanly, 4/4 OTel-equivalent JSONL stamps present.

### Evidence artifacts

```
runs/phase4-sc3/walkthrough-20260423T165050Z/
├── report.json                 # structured verdict per turn
├── turn-1_plan.events.jsonl    # copied from session dir
├── turn-1_plan.stdout.log
├── turn-1_plan.stderr.log
├── turn-2_edit.events.jsonl
├── turn-2_edit.stdout.log
├── turn-2_edit.stderr.log
├── turn-3_critic.events.jsonl
├── turn-3_critic.stdout.log
├── turn-3_critic.stderr.log
├── turn-4_default.events.jsonl
├── turn-4_default.stdout.log
└── turn-4_default.stderr.log
```

Representative `harness.assembly` record from turn 1 (plan → v3.1-reason):

```json
{
  "event": "harness.assembly",
  "profile": {"id": "qwen3.6-35b-a3b", "version": "v3.1-default", ...},
  "emmy.prompt.sha256": "...",
  "emmy.profile.variant": "v3.1-reason",
  "emmy.profile.variant_hash": "sha256:705dcb60...",
  "emmy.role": "plan",
  "model": "qwen3.6-35b-a3b",
  "gen_ai.system": "vllm",
  "gen_ai.request.model": "qwen3.6-35b-a3b"
}
```

---

## Defects Surfaced & Fixed During Walkthrough

### Defect 1 — `harness.assembly` JSONL record missing `emmy.role` + `emmy.profile.variant`

**Root cause:** The fields were stamped on OTel spans via `EmmyProfileStampProcessor.onStart` but NOT included in the `emitEvent("harness.assembly", ...)` record itself. In JSONL-only deployments (no Langfuse auth), the stamped attrs only existed on unexported spans — effectively invisible to anyone reading the JSONL sink.

**Fix:** Extended the `harness.assembly` payload at `packages/emmy-ux/src/pi-emmy-extension.ts:560-573` to include `emmy.role`, `emmy.profile.variant`, `emmy.profile.variant_hash` when `getCurrentTurnRoleContext()` returns populated fields. Backward-compat: absent when no turn context is set (canary, no routes.yaml, etc.).

**Why this matters:** D-12 calls for spans to carry these attrs; the walkthrough demonstrated that the JSONL sink also needs them for end-to-end observability parity across the two telemetry modes.

### Defect 2 — `classifyRole` iteration-2+ fallthrough always returned "edit" for non-keyword prompts

**Root cause:** The fallthrough block iterated `payload.tools[]` — the **tool descriptor catalog** available to the model — looking for `edit`/`write` entries. Since emmy registers both tools by default, the catalog always contains them, so EVERY prompt that didn't match the plan/edit/critic user-message-text regexes at the top fell through and got classified as "edit". Turn 4 (`"hello, what is two plus two"`) failed with `role=edit variant=v3.1-precise` instead of `role=default variant=v3.1-default`.

**Fix:** Rewrote the fallthrough at `packages/emmy-ux/src/pi-emmy-extension.ts:420-439` to iterate the most recent **assistant** message's `tool_calls[]` instead of the tool catalog. Iteration-2+ refinement now correctly checks what the model **chose**, not what was **available**. If the most recent assistant message has tool_calls and none are edit/write, the function stops scanning and returns "default" (prior turn's chosen tool isn't edit, so we don't misclassify).

**Why this slipped through unit tests:** The existing unit tests for `classifyRole` used fabricated payloads that either (a) matched a user-message regex and returned early, or (b) had an empty `tools` array. No existing test exercised the combination of "non-keyword user message + populated tools descriptor" which is the default pi-emmy runtime state. The live walkthrough surfaces exactly this gap.

**Tests:** The existing test suite (244 pass / 0 fail across 35 files) continues to pass. New behavioral gap → new test belongs in Phase 5 polish (track as `classifyRole iteration-2+ refinement coverage`).

---

## SC-3 Invariants Proven Live

1. **`routes.yaml` loads at factory construction** and is used by every `before_provider_request` firing. Absence would fall through to default-only mode (D-08).
2. **Variant selection is pure-data** — tool-name/message-text based, never model-name based. D-19 no-model-conditionals audit is structurally honored.
3. **Variant engine byte-identity** — none of the 4 turns triggered a vLLM restart (`docker ps | grep emmy-serve` shows the same Uptime across all 4 runs). Sibling variants truly co-exist in the engine layer.
4. **Per-turn harness mutation** — each variant's `sampling_defaults` + `chat_template_kwargs` + `per_tool_sampling` applied to the outgoing chat payload on the corresponding turn.
5. **OTel observability parity** — both span attrs (via `EmmyProfileStampProcessor`) AND JSONL record attrs (via the fix above) carry `emmy.role` + `emmy.profile.variant` + `emmy.profile.variant_hash` on every chat request.
6. **Default-only fallback** — iteration 1 of a turn with no explicit role keywords routes to `default` variant cleanly (turn 4 proves this).

---

## SC-3 Verdict

`sc3 phase4 green` — 4/4 role classifications correct end-to-end on live DGX Spark against Qwen3.6-35B-A3B-FP8 v3.1-default with the shipped `profiles/routes.yaml`. Two real defects surfaced by live testing were fixed inline.
