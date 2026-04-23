# PENDING — Gemma 4 KV budget bisection (operator-gated)

**Status:** OPERATOR-DEFERRED
**Resume signal:** `"p4 kv green"`
**Phase 1 precedent:** same shape as `sc1 resolved` / `sc5 floors recorded` — see `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md` § "SC-1 throughput" and Plan 04-06 Task 1 `<resume-signal>`.

## What blocks this from being automation-green

`scripts/find_kv_budget.py` drives a real vLLM container boot loop against a real GPU. Each iteration boots the engine with a candidate `gpu_memory_utilization`, runs a 30-min sustained load against `/v1/completions`, polls `/metrics` for preemption events, and steps UP or HALTS. The orchestrator executing Phase 4-06 does not have DGX Spark GPU access — physical-rig-only script.

The Gemma 4 v1 bundle ships with a LOW-end seed `gpu_memory_utilization: 0.55` (Plan 04-01, per 04-RESEARCH §1 + Phase 3.1 UMA lesson). Before daily-driver use, the operator MUST bisect UP against the measured ceiling.

## Exact shell commands operator runs

```bash
# 1. Verify DGX Spark is alive + Gemma 4 weights cached locally
nvidia-smi --query-gpu=name,memory.total --format=csv
ls -la /data/models/gemma-4-26B-A4B-it/  # or wherever serving.yaml:engine.model points

# (first time only) HF cache populate — requires HF_TOKEN for gated google/gemma-4
huggingface-cli download google/gemma-4-26B-A4B-it --local-dir /data/models/gemma-4-26B-A4B-it
export HF_HUB_OFFLINE=1  # after cache populated

# 2. Run the bisection finder
uv run python scripts/find_kv_budget.py \
  --profile profiles/gemma-4-26b-a4b-it/v1/ \
  --start 0.55 \
  --step 0.02 \
  --max 0.75

# If the finder halts at the --start value (0.55 too aggressive → preemption on first boot),
# re-run bisecting DOWN:
uv run python scripts/find_kv_budget.py \
  --profile profiles/gemma-4-26b-a4b-it/v1/ \
  --start 0.45 \
  --step 0.02 \
  --max 0.55

# 3. Finder writes measured value into serving.yaml:engine.gpu_memory_utilization.
#    Hand-edit PROFILE_NOTES.md frontmatter measured_values.gpu_memory_utilization to match,
#    citing "operator-measured via find_kv_budget.py" with the ISO date.

# 4. Recompute content hash (ONE write per resume-signal, Phase 1 D-13)
uv run emmy profile hash profiles/gemma-4-26b-a4b-it/v1/ --write

# 5. Validate
uv run emmy profile validate profiles/gemma-4-26b-a4b-it/v1/  # MUST exit 0

# 6. Commit
git add profiles/gemma-4-26b-a4b-it/v1/{serving,profile}.yaml \
        profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md
git commit -m "meas(04-06): Gemma 4 KV budget from find_kv_budget.py bisection on DGX Spark"

# 7. Save the finder transcript into this directory
cp runs/<iso>_<rand>-kv-finder/transcript.json runs/phase4-kv/finder-transcript.json
cp runs/<iso>_<rand>-kv-finder/finder.log       runs/phase4-kv/finder.log

# 8. Signal Claude: "p4 kv green"
```

## Expected evidence files (once signal fires)

- `finder-transcript.json` — each bisection iteration's candidate value + outcome (accepted / preempted / OOM)
- `finder.log` — full stdout/stderr from find_kv_budget.py
- `measured-values.md` — one-page narrative: seeded_value → measured_value → Spark state (thermal + RAM free), plus any surprising findings (e.g. measured < seed → document WHY)

## Failure mode + escalation

If bisection halts at 0.55 (the seed) on **first boot** because preemption fires immediately, that's a surprising UMA result worth investigating before proceeding. File as `p4-kv-fail` blocker in STATE.md "TODOs / Blockers"; do NOT proceed to thermal replay (Task 2) — thermal inherits the gpu_memory_utilization value.

## Verdict template

Once the run lands, replace this PENDING.md with `walkthrough.md` containing:

```
# Gemma 4 KV budget bisection — verdict p4 kv green
- Measured gpu_memory_utilization: <value>
- Bisection range walked: <start> → <halt>
- Preemption events seen: <count>
- OOM events seen: <count>
- Commit: <hash>
- Profile content hash after write: <sha256>
```
