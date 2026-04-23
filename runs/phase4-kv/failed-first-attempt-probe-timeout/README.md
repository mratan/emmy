# KV bisection — failed first attempt (probe-timeout misdiagnosis)

**Date:** 2026-04-23 20:03 UTC
**Session:** Phase 4 post-close operator-gated follow-up (from `.planning/phases/04-gemma-4-profile-profile-system-maturity/NEXT-SESSION-PROMPT.md`)
**Root cause:** `scripts/smoke_test.py` hardcoded `timeout_s=300` for `wait_for_vllm` — insufficient for Gemma 4 v2's plain-safetensors cold boot (~6–7 min). Fails before the bisection even starts its first drive iteration. The finder's `_restart_vllm` then misclassified the probe timeout as an OOM/preemption signal per its docstring ("creep past the 300s wait_for_vllm ceiling … functionally equivalent to a preemption failure"), wrote `gpu_memory_utilization=0.7` to `serving.yaml` with `iters=0`, and appended a bogus entry to `PROFILE_NOTES.md`.

## Evidence

- `bisect-stdout.log` — finder stdout. Shows "BOOT REJECTED (wait_for_vllm): /v1/models did not respond in 300s" → "Finder complete: gpu_memory_utilization = 0.7 (ok_value=0.75, preempted_at=0.75, iters=0)"
- `kv-finder-run-artifacts/summary.json` — `total_duration_s: 316.6`, `iterations: 0` (no drive period ever ran)
- `boot-failure-bundle/docker-logs.txt` — shows vLLM actively loading weights past the 300s probe ceiling: "Loading weights took 264.30 seconds" (after which model is loaded, CUDA graphs capture, warmup — easily another ~2 min). First successful boot path (via `emmy swap-profile`) took 379s wall-clock per `runs/phase4-sc1/swap-qwen-to-gemma-sc1-confirm/stdout.log`, confirmed via 18:34:30 (load start) → 18:40:49 (ready).

## Discrepancy

- Swap orchestrator (`emmy_serve/swap/orchestrator.py:61`): `warmup_timeout_s=900` default — handled Gemma 4 fine in prior session (SC-1 evidence).
- `scripts/smoke_test.py` (Phase 1 path used by `start_emmy.sh` → KV finder): hardcoded 300s. Did not accommodate the slower plain-safetensors loader mandated by the v2 container.

## Fix

Two timeout bumps in the prep commit adjacent to this directory:

1. `scripts/smoke_test.py:91` — `timeout_s=300` → `timeout_s=900` (matches swap orchestrator convention)
2. `emmy_serve/kv_finder/bisect.py:198` — subprocess `timeout=420` → `timeout=1200` (900s probe + headroom for profile validate, digest render, docker run, post-ready canaries)

Docstring comment at `emmy_serve/kv_finder/bisect.py:185` updated from "300s" → "900s" for consistency.

## Post-fix rollback

Revert of `profiles/gemma-4-26b-a4b-it/v2/serving.yaml` (0.7 → 0.55 seed) and `profiles/gemma-4-26b-a4b-it/v2/PROFILE_NOTES.md` (drop bogus `iters=0` entry) done via `git restore` before the re-run. Pitfall #1 discipline preserved: the finder remains the only writer to `gpu_memory_utilization` — a bad write from a misdiagnosed run was discarded, not hand-corrected.
