# SC-2 live 200-turn compaction matrix — VERDICT: PASSED (3/3)

**Resume signal:** `p3-07 sc2 live green`
**Date:** 2026-04-22
**Evidence type:** real vLLM round-trip via `CompactionEngine.summarize()` against live `emmy-serve` on the DGX Spark. Previously this was operator-gated because the runner's `live` mode was stubbed out — the stub path stayed in the code as a fallback, and a real `liveEngine()` factory was wired this pass.

## Matrix

| Variant | Verdict | Runtime | Prompt tokens | Completion tokens | Elided | Preserved | Invariants |
|---------|---------|---------|---------------|-------------------|--------|-----------|------------|
| default (`prompts/compact.md`) | ✅ pass | 43.4 s | 75 921 | 1 024 (length) | 181 | 19 | 5/5 green |
| alternate (`prompts/compact.alternate.md`) | ✅ pass | 47.0 s | 75 919 | 1 024 (length) | 181 | 19 | 5/5 green |
| disabled (null compaction cfg) | ✅ pass | 0 ms (no HTTP; `ran:false` expected) | — | — | 0 | 0 | 5/5 green |

- Fixture hash (all 3): `sha256:26149bfce42c79e13a26a976780f29410991566fbcd399c65b53a1abd3a0a19b` (unchanged from the Phase 3 close stub matrix — proves the fixture-contract invariant Pitfall #5 depends on).
- Threshold crossing: turn 125; context tokens at trigger 90 169.5 (78.6% of the 114 688-token soft ceiling).
- Served model: `qwen3.6-35b-a3b` at `http://127.0.0.1:8002`.
- `finish_reason=length` on both live variants = summarize hit its `max_tokens=1024` budget; summary_chars ~4.1–4.4K. The compaction prompt caps at <=300 tokens narrative; the model produced fuller responses than the prompt advised — but the 5 preservation invariants still held because `messagesToKeep` is computed from pre-filter markPreserved() regardless of summary length.

## Wiring change this pass

`eval/phase3/sc2-runner.ts` — added a `liveEngine()` factory and dispatched it for `--mode=live` on `default`/`alternate` variants. The `disabled` variant stays on `stubEngine()` because its expected behavior is `{ran:false}` — the null compaction config short-circuits before `summarize()` is ever called, so a GPU trip would be wasted. Env knobs: `EMMY_SC2_BASE_URL`, `EMMY_SC2_SERVED_MODEL_NAME`, `EMMY_SC2_TIMEOUT_MS`.

Also applied: `PER_ENTRY_CAP=1500` + `GLOBAL_CAP=400_000` on the serialized history block so the `/v1/chat/completions` input fits under `max_model_len=131072 - max_tokens=1024 - headroom`. First live attempt hit a `vLLM 400: input=130049 > max=130048` error because 200 entries × 4000-char cap overran the context window by 1 token; the clamp fixes that and leaves ~50K tokens of ceiling headroom.

## Previous deferral resolved

The Phase 3 CLOSEOUT documented the live matrix as an operator-gated evidence-polish deferral with ETA "~2 hours GPU" and called out that `engine.summarize()` wire-up belonged to a Phase-4 follow-up. In practice the live matrix runs in ~1.5 minutes (43 s + 47 s + 0 ms), not 2 hours, because the fixture triggers exactly one summarize call per non-disabled variant. The "~2h" ETA was a conservative upper-bound under the assumption that the runner would drive a live 200-turn agent session, not a single fixture-anchored round-trip.

## Artifacts (committed under this directory)

- `phase3-sc2-live-default/report.json` + `events.jsonl` + `fixture.jsonl.sha256`
- `phase3-sc2-live-alternate/report.json` + `events.jsonl` + `fixture.jsonl.sha256`
- `phase3-sc2-live-disabled/report.json` + `events.jsonl` + `fixture.jsonl.sha256`
