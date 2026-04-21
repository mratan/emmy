# SC-3 corpus + runner

Per CONTEXT.md §D-12, D-13, D-14 and Plan 02-08 plan-level must-haves.

## Corpus composition (100 calls total)

- **synthetic.jsonl (50 entries)** — hand-authored per D-13. Covers 8 native tools + 2 MCP-client-synthetic entries, with adversarial shapes (long_path, nested_args, unicode_filename, empty_arg, normal).
  - Distribution: 7 read, 6 write, 8 edit, 7 bash, 5 grep, 5 find, 5 ls, 5 web_fetch, 1 fs_read_file (MCP), 1 playwright_click (MCP)
  - Adversarial shape tags: 5 long_path, 10 nested_args, 6 unicode_filename, 8 empty_arg, remainder normal

- **real_replay.jsonl (50 entries)** — sourced per D-13. Plan 02-04's B2 capture feed (`runs/phase2-sc3-capture/`) was empty at plan-execution time (no daily-driver sessions captured between Plan 04 land and Plan 08 execute), so the corpus is **backfilled via `corpus_fill.ts`**: 50 single-turn `postChat` calls against live emmy-serve with rotating real prompts lifted from prior-repo `eval_tasks.py` spirit. Each entry is a real model-produced tool_calls shape under the v2 profile's native tool schemas.
  - Source breakdown: 0 natural-capture, 50 backfill-postChat (recorded in each entry's `source:` field)
  - When future daily-driver use populates `runs/phase2-sc3-capture/`, re-running `corpus_fill.ts --count 50` will prefer natural captures and only backfill the shortfall.

## Sampling provenance disclosure (D-13 requirement)

At the time of Plan 02-08 execution:
- `runs/phase2-sc3-capture/session-*.jsonl` count: **0** (naturally captured from daily-driver sessions)
- Backfilled via `corpus_fill.ts`: **50**

If `runs/phase2-sc3-capture/` has ≥ 50 tool-call turns at any future re-run, the runner will prefer natural captures and disclose the ratio in the re-generated corpus.

## Files

- `corpus/synthetic.jsonl` — 50 hand-authored entries (immutable; edit only if you also re-run SC-3 all three variants).
- `corpus/real_replay.jsonl` — 50 real-shape entries (backfilled; regenerate with `corpus_fill.ts`).
- `corpus_fill.ts` — backfill helper (prefers natural capture; backfills via postChat; exits 0 iff exactly `--count` entries written).
- `run_sc3.ts` — three-variant runner (reactive, disabled, no_per_tool_sampling).

## Run

```bash
# Run A: reactive (production default)
bun eval/phase2/sc3/run_sc3.ts --profile profiles/qwen3.6-35b-a3b/v2 --variant reactive --out runs/phase2-sc3/report.json

# Run B: disabled (D-14 no-grammar baseline)
bun eval/phase2/sc3/run_sc3.ts --profile profiles/qwen3.6-35b-a3b/v2 --variant disabled --out runs/phase2-sc3/baseline.json

# Run C: no_per_tool_sampling (W3 / Pitfall #5 before/after)
bun eval/phase2/sc3/run_sc3.ts --profile profiles/qwen3.6-35b-a3b/v2 --variant no_per_tool_sampling --out runs/phase2-sc3/no_per_tool_sampling.json
```

## Verdict gate (reactive only)

Per D-12, Run A's verdict = `pass` iff all three:
- synthetic_parse_rate >= 0.98 (49 of 50 synthetic turns parse cleanly after at most one grammar retry)
- real_replay_parse_rate >= 0.95 (47 of 50 real turns parse cleanly)
- aggregate_parse_rate >= 0.97 (97 of 100 total)

Runs B and C are informational only — they carry no verdict gate. The plan-09 CLOSEOUT computes the delta (Run A vs B, Run A vs C) for the Pitfall #5 Before/After record.
