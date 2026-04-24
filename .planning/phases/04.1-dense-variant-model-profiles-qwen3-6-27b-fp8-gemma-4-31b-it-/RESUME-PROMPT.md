We're in the middle of Phase 04.1 (dense-variant model profiles) on the Emmy project. Previous session planned both plans + authored both bundles. This session needs to drive the remaining GPU-heavy chain (smoke → KV bisection → 2×2h thermal per plan) then land the docs-only Plan 04.1-03.

**Current state (HEAD: latest commit on main is `feat(04.1,bundles): author qwen3.6-27b/v1 + gemma-4-31b-it/v1 dense profiles`)**

Committed so far:
1. Plans: `04.1-01-qwen27b-PLAN.md`, `04.1-02-gemma31b-PLAN.md`, `04.1-03-routing-matrix-PLAN.md` (all 3 passed plan-checker across 12 dimensions)
2. `profiles/qwen3.6-27b/v1/` bundle — hash `sha256:6319225a08b9...` — validates cleanly
3. `profiles/gemma-4-31b-it/v1/` bundle — hash `sha256:cf1cc07d4aa9...` — validates cleanly
4. `profiles/qwen3.6-27b/DEFAULT_VARIANT` = `v1`, `profiles/gemma-4-31b-it/DEFAULT_VARIANT` = `v1`
5. Existing family DEFAULT_VARIANTs UNCHANGED (`qwen3.6-35b-a3b` → `v3.1`, `gemma-4-26b-a4b-it` → `v2`) — daily-driver default preserved
6. `.gitignore` extended to allow `runs/phase4.1-{qwen,gemma}-{kv,thermal}/` evidence dirs
7. `runs/phase4.1-qwen-kv/container-inspect.txt` = `sha256:77321e416cf4...9486` (NGC fastsafetensors-derived, matches v3.1)
8. `runs/phase4.1-gemma-kv/container-inspect.txt` = `sha256:db59febc6c47...09f8` (upstream vllm-openai, matches v2)

In-flight:
- HF weight downloads running in background (from Claude Code tasks `bpdg79yd5` + `b50hlrrjx`; their stdout/stderr at `/data/projects/emmy/runs/phase4.1-{qwen,gemma}-download/`). Progress at hand-off: Qwen 45% (36/80 files), Gemma early (metadata + tokenizer, no safetensors shards yet). Both processes healthy; verify with `ps -ef | grep huggingface-cli` and `du -sh /data/models/Qwen3.6-27B-FP8 /data/models/gemma-4-31B-it`.

**What's left for each plan (in order):**

### Plan 04.1-01 (Qwen 27B) — remaining tasks
- [ ] **Task 1 completion** — wait for HF download (~15 min more at last check). Verify: `ls /data/models/Qwen3.6-27B-FP8/ | wc -l` ≥ 80 files; `grep '"quant_method"' /data/models/Qwen3.6-27B-FP8/config.json`
- [ ] **Task 5 (checkpoint) — Smoke test.** `scripts/start_emmy.sh --profile profiles/qwen3.6-27b/v1 2>&1 | tee runs/phase4.1-qwen-kv/smoke.log`. Expected: `smoke ok: tok/s=...` in tail. Teardown with `docker stop emmy-serve` after success.
- [ ] **Task 7 (checkpoint) — KV bisection, ~3.5h.** `uv run python scripts/find_kv_budget.py --profile profiles/qwen3.6-27b/v1 --drive-minutes 10 --max-iters 12 2>&1 | tee runs/phase4.1-qwen-kv/find_kv_budget-stdout.log`. This script is the ONLY sanctioned writer to `gpu_memory_utilization` (seed is 0.55). Post-conditions: stdout ends with `converged:`; `grep gpu_memory_utilization profiles/qwen3.6-27b/v1/serving.yaml` ≠ 0.55; PROFILE_NOTES.md `## KV bisection result` populated; `uv run emmy profile validate profiles/qwen3.6-27b/v1` still exits 0.
- [ ] **Task 8 (checkpoint) — Thermal pass 1, ~2h.** `uv run python scripts/thermal_replay.py --profile profiles/qwen3.6-27b/v1 --target-wall-time-s 7200 --record-floors --out-dir runs/phase4.1-qwen-thermal/pass1-record-floors 2>&1 | tee runs/phase4.1-qwen-thermal/replay-pass1-stdout.log`. Pass gate: `preemptions_hour2: 0` AND `oom_events: 0` in summary.json. Tok/s floors recorded but NOT a gate.
- [ ] **Task 9 (checkpoint) — Thermal pass 2, ~2h.** Same command but `--assert-floors --out-dir runs/phase4.1-qwen-thermal/pass2-assert-floors`. Same pass gate.
- [ ] **Commit + SUMMARY.md** after each milestone (smoke / KV / thermal 1 / thermal 2).

### Plan 04.1-02 (Gemma 31B) — remaining tasks
Symmetrical to Plan 04.1-01 but against `profiles/gemma-4-31b-it/v1` + `runs/phase4.1-gemma-{kv,thermal}/`. Gemma cold-start is ~8 min (upstream image, no fastsafetensors). Expected tok/s is 6-10 and is NOT a gate. KV fallback branch per CONTEXT.md: if every value OOMs/preempts, reduce `max_model_len` 131072 → 65536 → 32768 → deferral (documented in PROFILE_NOTES.md § "Known-risk fallback branch").

### Plan 04.1-03 (routing + matrix) — pure docs, minutes
- [ ] Add optional `dense` role to `profiles/routes.yaml` → maps to `qwen3.6-27b` (default unchanged)
- [ ] Create `eval/MATRIX.md` enumerating all 4 profiles with hashes (Qwen 35B MoE v3.1, Qwen 27B dense v1, Gemma 26B MoE v2, Gemma 31B dense v1)
- [ ] Update `docs/runbook.md` § "Swapping profiles" with new names + HF paths + container-per-family note

**Load-bearing operator preferences (DO NOT violate):**
- Throughput is NOT an acceptance gate. Dense variants are bandwidth-bound by design.
- Daily-driver default stays `qwen3.6-35b-a3b@v3.1` — do not touch.
- `scripts/find_kv_budget.py` is the ONLY sanctioned writer to `gpu_memory_utilization` (Pitfall #1).
- Profile immutability (D-02) — no in-place edits to existing profiles.

**Kick-off steps (autonomous):**
1. Check download progress (`du -sh /data/models/Qwen3.6-27B-FP8 /data/models/gemma-4-31B-it`). If Qwen downloaded, proceed. If still downloading, wait.
2. When Qwen weights complete: run Plan 04.1-01 Task 5 smoke test. Commit smoke.log + SUMMARY.md update.
3. Continue with Task 7 (KV bisection) via `run_in_background`, monitor stdout for `converged:` line, auto-approve checkpoint when done.
4. Tasks 8 + 9 (thermal passes) — same pattern.
5. Move on to Plan 04.1-02 once Gemma weights complete (may already be done by the time Qwen finishes).
6. Plan 04.1-03 after both profiles are validated + thermally-passed.

**Don't ask me** — resume autonomously and commit per plan milestone. Come back only if truly blocked (OOM loop, HF auth failure, schema violation find_kv_budget.py can't resolve via fallback).
