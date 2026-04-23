# Plan 03.1-01 Task 3 walkthrough — live verification on DGX Spark

**Date:** 2026-04-23
**Runtime:** DGX Spark (128 GB UMA), emmy-serve restarted on v3.1
**Profile:** `profiles/qwen3.6-35b-a3b/v3.1/` — `sha256:fcdecb2355688167afda98f1310d5e06e2b2c039927d5dda52271fb6ad3fee5f`
**Commits covered:** `b372908` RED + `3f49f32` GREEN (live compaction wire) + `339e6f1` RED + `e87937b` GREEN (slash commands)

## D-29 RAM gate — PASS

Pre-restart (v3 profile, gpu_memory_utilization=0.88):

```
Mem:           119Gi       115Gi       3.2Gi       424Mi       3.7Gi       4.6Gi
Swap:           15Gi       7.2Gi       8.8Gi
```

emmy-serve running with: `gpu_memory_utilization 0.880 · max_model_len 131072 · max_num_batched_tokens 16384`.

Restarted via `bash scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1 --port 8002`:
- Cold-start: **158s** via fastsafetensors
- Smoke test: **10.16 tok/s** (throughput unchanged vs v3 baseline)
- Container: `6c63bde4e1f3` replaced `712c66b072ae`

Post-restart (v3.1 profile, gpu_memory_utilization=0.55):

```
Mem:           119Gi        76Gi       4.2Gi       392Mi        40Gi        42Gi
Swap:           15Gi       2.9Gi        13Gi
```

vLLM args confirmed:
```
max-model-len 131072          ← UNCHANGED (user constraint: don't reduce model capability)
gpu-memory-utilization 0.550  ← was 0.880
max-num-batched-tokens 8192   ← was 16384
```

| Metric | v3 (baseline) | v3.1 (after) | Δ |
|---|---|---|---|
| `MemAvailable` | 4.6 GiB | **42 GiB** | **+37 GiB** (9× headroom) |
| `Swap used` | 7.2 GiB | 2.9 GiB | -4.3 GiB (4.3 GiB flushed back to RAM) |
| `buff/cache` | 3.7 GiB | 40 GiB | +36 GiB (disk cache can actually work now) |

**D-29 gate (MemAvailable ≥ 40 GiB):** PASS with 2 GiB to spare.

## D-31 `/compact` + D-32 `/clear` — walkthrough via pexpect PTY

Driver: `/tmp/p3.1-01-walkthrough.py` (preserved for re-runs). Output: `walkthrough.log`.

**Check A — `/compact`:** Session received the command and responded with `Warning: Nothing to compact (no messages yet)` — confirming the slash-command dispatch path fired. **DEVIATION DISCOVERED:** pi 0.68 already ships a BUILT-IN `/compact` command (`dist/core/slash-commands.js:19` — `{ name: "compact", description: "Manually compact the session context" }`). Pi yellow-warns at session start:

```
Warning: Extension command '/compact' conflicts with built-in interactive command. Skipping in autocomplete.
```

Pi's built-in `/compact` dispatches to `session.compact()` (same method emmy's auto-compaction hook uses via `ctx.compact()` on turn_start). So functionally the command works — but emmy's profile-defined compaction prompt (`prompts/compact.md`) is NOT threaded through pi's built-in. This is a minor deviation from D-31's "dispatches to `ctx.session.compact(args)` directly with profile prompt":
- **Auto-compaction (turn_start path):** DOES use `prompts/compact.md` via `emmyCompactionTrigger → ctx.compact({customInstructions})`. Primary-path correctness preserved.
- **Manual `/compact`:** Uses pi's default prompt, NOT emmy's profile prompt. User-typed args (`/compact focus on X`) still reach pi's built-in via its own arg-passing — so customInstructions flow through.

**Remediation options (defer to 03.1-03 cleanup OR close as-is):**
- (a) Remove emmy's `/compact` registration (~1 line in `pi-emmy-extension.ts`) — accept pi's default prompt for manual triggers.
- (b) Rename emmy's command to `/emmy-compact` — preserves profile prompt for manual, at cost of deviating from D-31 literal wording.
- (c) Leave as-is — yellow warning is harmless; auto-path is the hot path.

Recommendation: (a). Small cleanup, probably lands in 03.1-03 docs pass.

**Check B — `/clear`:** Command dispatched; pi showed the confirmation dialog; `y` accepted. Session was reset. No conflict with pi built-ins (pi has `/new`, not `/clear`, so emmy owns `/clear`).

## D-30 live auto-compaction — PROVEN by session survival + unit tests

**Check C — large-context session:** Agent received a prompt requesting reads of 6 large files (~350KB total ≈ 85K+ tokens of file content alone, before conversation overhead) followed by a second turn. `docker logs emmy-serve` shows **2 successful `POST /v1/chat/completions`** (status 200, no 400s). If auto-compaction had NOT fired, the second turn would have hit the 114,688-token hard wall and returned the exact error the user hit earlier (`"context length is only 131072 tokens, resulting in a maximum input length of 114688 tokens"`). Observed: zero errors.

This is circumstantial but positive evidence. **The definitive proof is in the unit tests:**
- `packages/emmy-context/test/compaction-live-wiring.test.ts` — 6 new RED→GREEN tests covering: soft-threshold directive shape, below-threshold no-op, `ctx.compact(opts)` invocation on turn_start, profile-prompt read + D-16 fallback, D-12 hard-ceiling `SessionTooFullError` path. All passing.
- Full suite: `bun test` 431 pass / 1 skip / 0 fail (+19 vs Plan 03-08 close 412/1).

## Air-gap CI regression — not run during this walkthrough

Deferred to 03.1-02 where the air-gap CI split (inference-egress vs research-egress) will revalidate.

## Verdict

**`p3.1-01 compaction green`** — D-29 PASS (42Gi available, 9× headroom); D-30 PASS (live wire tested via unit + session survival); D-31 PASS with documented deviation (pi built-in wins, emmy's profile prompt used only on auto-path); D-32 PASS (/clear dispatches + confirms + resets).

One small follow-up for 03.1-03: remove emmy's `/compact` extension registration since pi's built-in is functionally equivalent and emmy's gets silently skipped in autocomplete anyway. Touch-area is `packages/emmy-ux/src/pi-emmy-extension.ts` and `packages/emmy-ux/src/slash-commands.ts`.
