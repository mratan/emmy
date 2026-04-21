# D-14 Thermal Workload Audit — Phase 1

**Conducted:** 2026-04-21
**Auditor:** Executor (Plan 01-04 Task 1 — Phase A, code-only wave)
**Source corpus:** `/data/projects/setup_local_opencode/validation/eval_tasks.py` CODE_01..CODE_05
**Augmentation:** 8 synthetic agent-shape prompts + 11 tool-call-shape prompts per RESEARCH.md §9.4
**Scope:** Static audit of prompt characteristics (§9.5 thresholds 1–3 + 5); Threshold 4
(duty cycle) is a runtime measurement deferred to the first 2-hour thermal replay (Phase B).

## Prior-Repo Characterization (§9.2)

| Axis | Measured from prior `eval_tasks.py` (CODE_01..05) |
|------|---------------------------------------------------|
| Prompt length (system + user) | 492–1013 chars per task → est. 123–253 tokens |
| Expected output length | `max_tokens` 2048..4096; historical actuals ~1400 tokens avg (per prior `EXECUTIVE_SUMMARY.md`) |
| Context-size distribution | All under 2K; zero prompts exercise 10K+ prefill |
| Tool-call density | Zero (direct-API tasks only, `execution_mode="api"`) |
| Decode:prefill ratio (per prompt) | ~2:1 decode-heavy (small prefill, medium decode) |
| Duty cycle if looped | Near-continuous — a 5-prompt loop completes in ~3 minutes, so would cycle ~40× over 2 hours with prefix-cache dominating after first pass |

## Verdict (§9.3)

**FAIL** for thermal representativeness if used as-is. Rationale:

- Zero prompts ≥ 10K prefill (§9.5 threshold: ≥30% required) — under-exercises prefill
  compute, which is the main FLOPs-bound signal that stresses the chip on long contexts.
- Zero tool-call shapes (§9.5 threshold: ≥20% required) — misses the prefill-decode-prefill
  alternation pattern produced by Phase 2+'s agent loop.
- Would loop the same 5 prompts ~40× over 2 hours; prefix-cache hits dominate after the
  first pass and cold-path prefill stops exercising (§9.3 problem 2).

The prior prompts remain in the corpus as a **continuity baseline** (bridge from prior repo
metrics) but are **insufficient alone** for sustained thermal stress.

## Augmentation Decision

Per §9.4 spec, the final corpus synthesises the following new shapes alongside the 5 prior
coding prompts:

### Synthetic agent-shape prompts (`emmy_serve/thermal/corpus.py::SYNTHETIC_AGENT_PROMPTS`)

1. `AGENT_10K_REFACTOR` — 10K-token pasted-file + refactor task (prefill=10000, decode=8000)
2. `AGENT_20K_MULTIFILE` — 20K-token multi-file + add-feature task (prefill=20000, decode=12000)
3. `AGENT_30K_HISTORY` — 30K-token long-history + bug-fix task (prefill=30000, decode=4000)
4. `AGENT_LONG_OUTPUT_12K` — 12K-prefill + long planning output (prefill=12000, decode=8000)
5. `AGENT_15K_PASTED` — 15K-token architectural critique (prefill=15000, decode=6000)
6. `AGENT_18K_MULTIFILE_TRACE` — 18K-token call-graph trace (prefill=18000, decode=6000)
7. `AGENT_8K_REFACTOR` — 8K-token boilerplate extraction (prefill=8000, decode=4500)
8. `AGENT_6K_DEBUG` — 6K-token subtle-bug identification (prefill=6000, decode=3500)
9. `AGENT_SHORT_OUTPUT` — ~100-token tool-call-shape response (prefill=50, decode=80)

### Tool-call-shape prompts (`emmy_serve/thermal/corpus.py::TOOL_CALL_SEQUENCE`)

10. `TOOL_SEQ_SIMPLE_READ` — read_file (prefill=100, decode=250)
11. `TOOL_SEQ_WRITE_THEN_READ` — write then read (prefill=120, decode=300)
12. `TOOL_SEQ_BASH_RESULT` — bash + summarize (prefill=100, decode=300)
13. `TOOL_SEQ_GREP_FILES` — grep + summarize (prefill=110, decode=400)
14. `TOOL_SEQ_EDIT_AFTER_READ` — read + edit (prefill=130, decode=400)
15. `TOOL_SEQ_MULTITURN_3K` — 3K history + test-writing ask (prefill=3000, decode=1500)
16. `TOOL_SEQ_MULTITURN_5K` — 5K history + refactor ask (prefill=5000, decode=3000)
17. `TOOL_SEQ_MULTITURN_6K` — 6K history + factory-function ask (prefill=6000, decode=3500)
18. `TOOL_SEQ_MULTITURN_8K` — 8K history + multi-file refactor (prefill=8000, decode=4000)
19. `TOOL_SEQ_MULTITURN_10K` — 10K history + audit ask (prefill=10000, decode=5000)
20. `TOOL_SEQ_MULTITURN_12K` — 12K history + planning ask (prefill=12000, decode=6000)

All synthetic prompts are **deterministically generated** (no random seeds — see
`_build_pasted_python_file()`, `_build_multifile_codebase()`, `_build_conversation_history()`,
`_build_multiturn_context()` in corpus.py). This means the corpus byte-contents is stable
across re-generation, and the profile hash is determined purely by the committed text.

Token counts are `≈ len(text) / 4`; real counts from vLLM's `usage.prompt_tokens`
are logged during replay (any ≥20% divergence is a Rule 1 bug — the §9.5 audit math is
computed from the expected_* fields, so drift between expected and actual silently
breaks the threshold guarantee).

## §9.5 Thresholds (computed by `emmy_serve/thermal/audit.py`)

Measured from the committed `ALL_THERMAL_PROMPTS` (5 + 9 + 11 = **25 prompts**):

| Threshold | Measured | Required | Status |
|-----------|----------|----------|--------|
| (1) prefill:decode ratio ∈ [1:2, 2:1] | 1.90 | [0.5, 2.0] | PASS |
| (2) % prompts with prefill ≥ 10K | 32% | ≥30% | PASS |
| (3) % prompts including tool-call shape | 44% | ≥20% | PASS |
| (5) no single prompt > 15% of total token mass | 14% (`agent_30k_history`) | ≤15% | PASS |

Threshold (4) — duty cycle ≥80% (GPU busy / wall-time) — is a runtime measurement; the first
2-hour thermal run measures it from GPU samples (§9.6 sampler output). If the first run
reports <80% duty cycle, the corpus must be re-augmented (e.g., reduce inter-request gap
below 5s, or add more high-decode prompts). Re-audit after any augmentation.

## Final Corpus Size

`ALL_THERMAL_PROMPTS = PRIOR_CODING_TASKS + SYNTHETIC_AGENT_PROMPTS + TOOL_CALL_SEQUENCE
= 5 + 9 + 11 = 25 prompts`, total estimated **251,690 tokens** per full cycle (164,760 prefill
+ 86,930 decode). At a 5-second inter-request gap and ~100 tok/s sustained aspiration, a
full cycle takes ~10 minutes of compute + ~2 minutes of gap → ~12 min per cycle → ~10
cycles per 2-hour run.

## Sign-off

`PASSES: True` — `uv run python -m emmy_serve.thermal.audit` exits 0.

All four static thresholds are met. Threshold 4 (duty cycle) requires the 2-hour replay
measurement and is not an audit-time property — the Phase B launch of `scripts/thermal_replay.py`
reports it; if <80%, the corpus is re-augmented and re-audited before any measured floors
are committed to `PROFILE_NOTES.md`.

## Machine-readable output

```
$ uv run python -m emmy_serve.thermal.audit --format json
{
  "failures": [],
  "max_share_task_id": "agent_30k_history",
  "max_single_prompt_share": 0.1351,
  "passes": true,
  "pct_includes_tool_call": 0.44,
  "pct_prefill_gte_10k": 0.32,
  "prefill_to_decode_ratio": 1.8953,
  "total_decode_tokens": 86930,
  "total_prefill_tokens": 164760,
  "total_prompts": 25
}
```

The JSON output is consumed by CI (Plan 05's airgap workflow can grep for
`"passes": true` before running the replay) and by `scripts/thermal_replay.py`'s
pre-replay gate (which refuses to start a 2-hour run on a failing corpus).
