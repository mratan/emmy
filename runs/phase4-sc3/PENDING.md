# PENDING — SC-3 role-routing walkthrough (operator-gated)

**Status:** OPERATOR-DEFERRED
**Resume signal:** `"sc3 phase4 green"`
**Phase precedent:** same shape as Phase 2 SC-3 (`runs/phase2-sc3/`) except live-driven rather than corpus-replay.

## What blocks this from being automation-green

SC-3 is a multi-turn live session against a real vLLM engine where the operator drives 5+ turns each triggering a different role (plan / edit / default), then inspects Langfuse UI (or the JSONL sink) for `emmy.profile.variant` + `emmy.role` attrs on each turn's span. Cannot be run by the planning orchestrator:

- Requires DGX Spark GPU with Qwen v3.1 cached
- Requires operator-typed prompts — the role classifier (Plan 04-04) runs on **user message text**, so synthetic replay would need pre-fabricated prompts that happen to hit each regex branch, and Plan 04-04 commit `7cb2d7b` already exercises that mechanically via unit test. SC-3 is the LIVE version where the operator types real daily-driver prompts.
- Requires Langfuse UI inspection (browser-based) OR JSONL-sink grep. The plan's acceptance allows either.

## Exact shell commands operator runs

```bash
# Terminal A — cold-boot Qwen v3.1-default with routes.yaml live
bash scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1-default/

# Optional — Terminal B — Langfuse stack up (if using Langfuse UI inspection)
bash scripts/start_observability.sh
# OR confirm JSONL sink is being written:
ls -la ~/.emmy/telemetry/*.jsonl

# Terminal C — launch pi-emmy
pi-emmy

# Inside pi-emmy — run 5 turns exercising all 3 role branches:
# Turn A (plan): "plan: design a rate-limiter interface for emmy-tools"
#   → regex hits ^plan: → role=plan → variant=v3.1-reason (temp=0.6, enable_thinking=true)
#
# Turn B (edit): "edit packages/emmy-tools/src/example.ts to add a comment"
#   → regex hits ^edit → role=edit → variant=v3.1-precise (temp=0.0, enable_thinking=false)
#
# Turn C (default): "list files in packages/"
#   → no plan/edit/critic regex hit → role=default → variant=v3.1-default
#
# Turn D (plan): "plan: how would we test this?"
#   → role=plan → variant=v3.1-reason
#
# Turn E (default): "grep 'TODO' across packages"
#   → role=default → variant=v3.1-default

/quit

# --- Inspection ---

# Option 1: Langfuse UI
# Open http://127.0.0.1:3000 → drill into the session → verify per-turn span carries:
#   emmy.profile.id         = "qwen3.6-35b-a3b"
#   emmy.profile.version    = "v3.1-default" (the base profile on which /profile was set)
#   emmy.profile.variant    = one of v3.1-reason / v3.1-precise / v3.1-default per turn
#   emmy.profile.variant_hash = the matching variant hash from 04-04-SUMMARY.md
#   emmy.role               = "plan" / "edit" / "default" per turn

# Option 2: JSONL sink grep
grep -c 'emmy.profile.variant' ~/.emmy/telemetry/*.jsonl   # must be >= 5
grep 'emmy.role' ~/.emmy/telemetry/*.jsonl | head -20      # one per turn

# Build report.json by hand from trace data (see template below).
# Author walkthrough.md with verdict at top.

git add runs/phase4-sc3/walkthrough.md runs/phase4-sc3/report.json
git commit -m "evidence(04-06): SC-3 role-routing walkthrough — sc3 phase4 green"

# Signal Claude: "sc3 phase4 green"
```

## Expected evidence files (once signal fires)

| File | Contents |
|---|---|
| `walkthrough.md` | Operator narrative; 5-turn session log with prompt, classified role, resolved variant, variant_hash on span, temperature applied. Verdict `sc3 phase4 green` at top. |
| `report.json` | Structured summary (authored from trace data, NOT auto-generated): `session_id`, array of 5 `turns` each with `turn_id`, `role`, `variant`, `variant_hash`, `temperature_applied`; final `verdict` field. See template below. |
| `langfuse-traces.png` (optional) | Screenshot of Langfuse UI showing the 5 turns with role/variant attrs drilled down |
| `jsonl-excerpt.log` (if JSONL-path used) | Relevant rows from `~/.emmy/telemetry/*.jsonl` showing per-turn `emmy.profile.variant` + `emmy.role` |

## report.json template

```json
{
  "session_id": "<session uuid from pi-emmy>",
  "profile_base": "qwen3.6-35b-a3b@v3.1-default",
  "routes_yaml_hash": "<sha256 of profiles/routes.yaml at run time>",
  "turns": [
    { "turn_id": "T1", "prompt_prefix": "plan: design...", "role": "plan",    "variant": "v3.1-reason",  "variant_hash": "sha256:705dcb60bcfc1236d70298c967a20ad3eebbc143a48d0770ae1e2364c3e4836f", "temperature_applied": 0.6 },
    { "turn_id": "T2", "prompt_prefix": "edit packages/...",  "role": "edit",    "variant": "v3.1-precise", "variant_hash": "sha256:f16edde8cfe273ad9e9f3dd7a2ab3b03a7060a2acbb61e632585ed5ca19a95b2", "temperature_applied": 0.0 },
    { "turn_id": "T3", "prompt_prefix": "list files...",      "role": "default", "variant": "v3.1-default", "variant_hash": "sha256:6ff80f620720563652f192d42da47418ecb2bfd96d3eacd6166252c35d65a4cf", "temperature_applied": 0.2 },
    { "turn_id": "T4", "prompt_prefix": "plan: how would...", "role": "plan",    "variant": "v3.1-reason",  "variant_hash": "sha256:705dcb60bcfc1236d70298c967a20ad3eebbc143a48d0770ae1e2364c3e4836f", "temperature_applied": 0.6 },
    { "turn_id": "T5", "prompt_prefix": "grep 'TODO'...",     "role": "default", "variant": "v3.1-default", "variant_hash": "sha256:6ff80f620720563652f192d42da47418ecb2bfd96d3eacd6166252c35d65a4cf", "temperature_applied": 0.2 }
  ],
  "verdict": "sc3 phase4 green",
  "notes": "<any deviations, e.g. iteration-2 role refinement on a turn>"
}
```

## Scoring rule (per 04-04-SUMMARY.md "First-invocation note")

Plan 04-04 classifier runs on user-message text first, then refines on `turn.nextTool` in iteration 2+. So a turn CAN carry different `emmy.role` values across iterations (e.g. iter 1 classifies "default" on message text, iter 2 sees `tools[]` contains `edit` and refines to "edit"). The SC-3 scoring rule is:

**A turn is "correctly routed" iff its FINAL chat-request span (the one that produced the tool call that ran) carries the expected role.**

Middle-of-turn span re-stamping is expected, not a bug. Document any observed refinement in walkthrough.md for completeness.

## Failure modes + escalation

| Observation | Disposition |
|---|---|
| Span attrs missing `emmy.profile.variant` entirely | BUG in Plan 04-04 (profile-stamp-processor.ts onStart). Fix before closing SC-3. |
| Span has `emmy.role: default` on a turn that clearly should be `plan` | Classifier regex may need widening. Expected minor edge cases — document but do not block unless 3+ misclassifications in 5 turns. |
| Variant `enable_thinking:true` on `v3.1-reason` produced `<think>` leaks in output | Phase 3 Plan 03-01 `<think>`-strip landed (`d4cd189`). If leaks visible, investigate whether reasoning-turn path re-introduced stripped markers. |
| Langfuse UI missing spans (or JSONL has 0 rows) | Check `EMMY_TELEMETRY=off` isn't accidentally set. Phase 3 Plan 03-02 dual-sink should always write JSONL even if OTLP fails. |

## Verdict template (for walkthrough.md replacement)

```
# SC-3 phase4 — verdict sc3 phase4 green

## Environment
- Host: <hostname>, <iso-date>
- Profile base: qwen3.6-35b-a3b@v3.1-default
- routes.yaml contents: (verbatim from profiles/routes.yaml)

## Turn log
| # | Prompt | Classified role | Variant | variant_hash | temp applied |
|---|--------|----------------|---------|--------------|--------------|
| T1 | "plan: design a rate-limiter..."  | plan    | v3.1-reason  | sha256:705dcb60... | 0.6 |
| T2 | "edit packages/emmy-tools/..."    | edit    | v3.1-precise | sha256:f16edde8... | 0.0 |
| T3 | "list files in packages/"         | default | v3.1-default | sha256:6ff80f62... | 0.2 |
| T4 | "plan: how would we test this?"   | plan    | v3.1-reason  | sha256:705dcb60... | 0.6 |
| T5 | "grep 'TODO' across packages"     | default | v3.1-default | sha256:6ff80f62... | 0.2 |

## Trace inspection path used
- [ ] Langfuse UI (screenshot attached: langfuse-traces.png)
- [ ] JSONL sink grep (jsonl-excerpt.log attached)

## Verdict
sc3 phase4 green.
```
