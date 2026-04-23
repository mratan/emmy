# PENDING — Gemma 4 2-hour thermal replay (operator-gated)

**Status:** OPERATOR-DEFERRED
**Resume signals:** `"p4 thermal floors recorded"` (first pass) → `"p4 thermal green"` (assert-floors pass)
**Phase 1 precedent:** Plan 01-04 + Plan 01-07 `sc5 floors recorded` / `sc5 reproducibility green`. Same two-pass discipline; see `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md` § SC-5 disposition.
**Depends on:** Task 1 (`p4 kv green`) — thermal replay inherits the `gpu_memory_utilization` value the KV bisection committed.

## What blocks this from being automation-green

`scripts/thermal_replay.py` runs a real vLLM container under sustained load for 7200 s (2 hours) while sampling `/metrics` decode throughput + nvidia-smi GPU clock. The orchestrator executing Phase 4-06 does not have DGX Spark GPU access, and a sustained 2-hour GPU burn is not a CI-friendly test anyway (Pitfall #4 — thermal throttle discipline requires the physical rig).

## Why two passes (the `--record-floors` / `--assert-floors` pair)

Single runs can bake in transient floors (ambient-cool Spark, freshly rebooted box, etc.). The re-assert pass 15+ min later confirms the floor is stable across Spark's thermal state. Same discipline Phase 1 Plan 01-04 established.

## Exact shell commands operator runs

```bash
# PASS 1 — record floors (2 hours wall clock)
uv run python scripts/thermal_replay.py \
  --profile profiles/gemma-4-26b-a4b-it/v1/ \
  --record-floors \
  --duration 7200

# Writes into profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md frontmatter:
#   decode_throughput_p50_hour2_tokps: <measured>
#   decode_throughput_p1_hour2_tokps:  <measured>
#   gpu_clock_p5_hour2_mhz:            <measured>
#   gpu_clock_p50_hour2_mhz:           <measured>
#   cold_start_seconds:                <first-boot-time>
#   warm_throughput_tokps:             <avg post-warmup>

# Recompute content hash — ONE write per resume-signal (Phase 1 D-13 discipline)
uv run emmy profile hash profiles/gemma-4-26b-a4b-it/v1/ --write

git add profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md \
        profiles/gemma-4-26b-a4b-it/v1/profile.yaml
git commit -m "meas(04-06): Gemma 4 thermal floors from 2-hour replay (record-floors pass)"

# Copy the thermal run transcript into this evidence dir
cp runs/<iso>_<rand>-thermal/transcript.json   runs/phase4-thermal/record-transcript.json
cp runs/<iso>_<rand>-thermal/thermal.log        runs/phase4-thermal/record.log

# Signal Claude: "p4 thermal floors recorded"

# ---- Wait at least 15 minutes for Spark to cool before the assert pass ----

# PASS 2 — re-assert (another 2 hours wall clock)
uv run python scripts/thermal_replay.py \
  --profile profiles/gemma-4-26b-a4b-it/v1/ \
  --assert-floors \
  --duration 7200

# Exit 0 iff re-measured p50/p1/clock-p5/clock-p50 ≥ recorded floors.
# Exit non-zero iff any floor was under-run.

# On assert-floors green: append validation_runs entry to PROFILE_NOTES.md,
# recompute hash, commit.
uv run emmy profile hash profiles/gemma-4-26b-a4b-it/v1/ --write
git add profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md \
        profiles/gemma-4-26b-a4b-it/v1/profile.yaml
git commit -m "cert(04-06): Gemma 4 thermal floors re-assert green (p4 thermal green)"

# Save the assert-pass transcript
cp runs/<iso>_<rand>-thermal/transcript.json   runs/phase4-thermal/assert-transcript.json
cp runs/<iso>_<rand>-thermal/thermal.log        runs/phase4-thermal/assert.log

# Signal Claude: "p4 thermal green"
```

## Expected evidence files (once signals fire)

| File | Stage | Contents |
|---|---|---|
| `record-transcript.json` | after pass 1 | Per-second decode-throughput + GPU-clock samples over 7200 s; percentile rollups at bottom |
| `record.log` | after pass 1 | Full stdout/stderr from thermal_replay.py (boot log, warmup log, sample log) |
| `assert-transcript.json` | after pass 2 | Same shape as record-transcript; each percentile annotated `floor=<recorded>, measured=<new>, pass=<bool>` |
| `assert.log` | after pass 2 | Full stdout/stderr from the re-assert run |
| `walkthrough.md` | at close | One-page narrative replacing PENDING.md; verdict `p4 thermal green` at top |

## Failure mode + escalation

**Record pass (pass 1) dies/OOMs:** likely KV budget too aggressive (upstream from Task 1). Blocks both tasks — escalate to `p4-kv-fail` review; do NOT record transient floors.

**Assert pass (pass 2) exits non-zero:** thermal-regression signal. Investigate per Pitfall #4:
- Is ambient temperature elevated?
- Is the Spark fan + intake clean?
- Was there prior sustained load immediately before pass 2?

If unresolvable, document as **deferral** in `04-CLOSEOUT.md` mirroring Phase 1's SC-5 disposition ("fix landed; re-validation deferred"). The Gemma 4 bundle still ships with the recorded floors; Phase 5 can re-run when a natural thermal re-run window opens. This is NOT a Phase 4 close blocker — Phase 1 precedent permits this shape.

## Verdict template

Once both passes land, replace this PENDING.md with `walkthrough.md`:

```
# Gemma 4 thermal replay — verdict p4 thermal green

## Pass 1 (record-floors)
- Start: <iso>
- End:   <iso>
- decode_throughput_p50_hour2_tokps: <recorded>
- decode_throughput_p1_hour2_tokps:  <recorded>
- gpu_clock_p5_hour2_mhz:            <recorded>
- gpu_clock_p50_hour2_mhz:           <recorded>
- cold_start_seconds:                <recorded>
- warm_throughput_tokps:             <recorded>
- Commit: <hash>

## Pass 2 (assert-floors)
- Cool-off gap: <minutes> min between passes
- Start: <iso>
- End:   <iso>
- decode_throughput_p50_hour2_tokps: <measured>  (floor=<recorded>, pass=true)
- decode_throughput_p1_hour2_tokps:  <measured>  (floor=<recorded>, pass=true)
- gpu_clock_p5_hour2_mhz:            <measured>  (floor=<recorded>, pass=true)
- gpu_clock_p50_hour2_mhz:           <measured>  (floor=<recorded>, pass=true)
- Commit: <hash>

## Profile hash trajectory
- before: <sha>
- after pass 1: <sha>
- after pass 2 (validation_runs append): <sha>
```
