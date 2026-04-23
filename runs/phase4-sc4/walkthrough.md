# SC-4: /profile Swap Failure/Rollback Walkthrough

**Date:** 2026-04-23
**Executor:** claude autonomous (orchestrator session)
**Profile state at start:** Qwen3.6-35B-A3B-FP8 v3.1 loaded on emmy-serve container (up 14h); port 8002 live.
**Evidence root:** `runs/phase4-sc4/`

---

## SC-4 Claim (ROADMAP Phase 4 § Success Criteria § 4)

> A swap that fails (e.g. corrupted weight file) leaves the user with a clear error message and the prior model still loaded — no crash, no half-loaded engine.

**Two failure-mode classes:**
- **Exit 5 — preflight fail:** preflight catches the problem BEFORE touching the running engine. Prior engine untouched. This is the D-05 LOCKED invariant (validate-first-then-stop).
- **Exit 6 — post-stop rollback:** preflight passes but vLLM start of the new profile fails. Swap primitive auto-rolls back to the prior profile via the same primitive with `--no-rollback` flag preventing recursion. D-04 LOCKED invariant.

---

## Exit-5 Cases (preflight fail, engine untouched)

Both cases below follow the same pattern: trigger a swap with a corrupted target profile → observe exit code 5 → verify Qwen is still responding on :8002 → inspect the diagnostic bundle written to `runs/boot-failures/<iso>-swap-preflight-failure/`.

### Case 1 — nonexistent profile path

**Command:**
```bash
uv run emmy swap-profile \
  --from profiles/qwen3.6-35b-a3b/v3.1 \
  --to   profiles/does-not-exist/v99 \
  --run-dir runs/phase4-sc4/exit5-case1-nonexistent-path
```

**Result:**
- Exit code: **5** ✓
- stderr: `ERROR (schema): file not found: profiles/does-not-exist/v99/profile.yaml`
- vLLM /v1/models: `200 OK`, `qwen3.6-35b-a3b` still served ✓
- emmy-serve container: `Up 14 hours` (no restart) ✓
- Diagnostic bundle: `runs/phase4-sc4/exit5-case1-nonexistent-path/boot-failures/<iso>-swap-preflight-failure/` with `check.json`, `env.json`, `profile.json`

### Case 2 — corrupted container_image_digest

**Setup:**
```bash
cp -r profiles/qwen3.6-35b-a3b/v3.1 /tmp/qwen-v3.1-bogus-digest
# Replace container_image_digest with all-zeros sha to trigger `docker inspect` miss
sed -i 's|sha256:77321e41...|sha256:0000000000000000000000000000000000000000000000000000000000000000|' /tmp/qwen-v3.1-bogus-digest/serving.yaml
uv run emmy profile hash /tmp/qwen-v3.1-bogus-digest --write  # recompute content hash so schema passes
```

**Command:**
```bash
uv run emmy swap-profile \
  --from profiles/qwen3.6-35b-a3b/v3.1 \
  --to   /tmp/qwen-v3.1-bogus-digest \
  --run-dir runs/phase4-sc4/exit5-case2-corrupted-digest
```

**Result:**
- Exit code: **5** ✓
- Diagnostic `check.json`: `{"check": "swap-preflight", "reason": "image not in local docker: sha256:0000...0000"}` ✓
- vLLM /v1/models: `200 OK`, `qwen3.6-35b-a3b` still served ✓
- emmy-serve container: unchanged ✓

### Evidence directory tree

```
runs/phase4-sc4/
├── exit5-case1-nonexistent-path/
│   ├── stdout.log
│   ├── stderr.log            # "ERROR (schema): file not found"
│   └── boot-failures/<iso>-swap-preflight-failure/
│       ├── check.json        # {"check": "swap-preflight", "reason": "..."}
│       ├── env.json
│       └── profile.json      # {"path": "profiles/does-not-exist/v99"}
├── exit5-case2-corrupted-digest/
│   ├── stdout.log
│   ├── stderr.log
│   └── boot-failures/<iso>-swap-preflight-failure/
│       ├── check.json        # {"check": "swap-preflight", "reason": "image not in local docker: sha256:0000..."}
│       ├── env.json
│       └── profile.json
└── walkthrough.md            # this file
```

---

## Exit-6 Cases (post-stop rollback) — CAPTURED

Exit-6 evidence was **captured incidentally but decisively** during the SC-1 Qwen→Gemma 4 swap attempts (`runs/phase4-sc1/`). The Gemma 4 profile failed at vLLM boot in two separate runs (first on tool-parser name, then on Transformers architecture recognition — see `runs/phase4-sc1/walkthrough.md` for full diagnosis). Both failures exercised the **exact exit-6 path** that SC-4 demands.

### Case 3 — original Gemma 4 v1 bundle (`tool_call_parser: gemma4` rejected by vLLM 0.17.1)

**Command:**
```bash
uv run emmy swap-profile \
  --from profiles/qwen3.6-35b-a3b/v3.1 \
  --to   profiles/gemma-4-26b-a4b-it/v1 \
  --port 8002 \
  --run-dir runs/phase4-sc1/swap-qwen-to-gemma
```

**Result:**
- Exit code: **6** ✓
- Preflight passed (v1 bundle is schema-valid; digest/image/render all OK)
- Forward path: 4 progress phases emitted verbatim (`stopping vLLM` → `loading weights 0/50/90` → `warmup`)
- vLLM container started with Gemma 4 config → immediately crashed on `KeyError: invalid tool call parser: gemma4`
- Probe waited 300 s for `/v1/models`; `Connection refused` throughout → timeout triggers rollback
- Rollback: `rollback: stopping failed engine` → `rollback: restarting prior profile` → swap primitive re-entered with `--no-rollback` flag
- 4 progress phases fire again in reverse direction as Qwen rolls back in
- `ready` at 16:29:13; post-rollback smoke `tok/s=9.92 tokens_out=100` ✓
- Final envelope: `{"rolled_back": true, "rollback_succeeded": true}` ✓
- Qwen3.6 back on :8002 ✓
- Diagnostic bundle with complete failed-container docker logs at `runs/phase4-sc1/swap-qwen-to-gemma/boot-failures/20260423T162723Z-swap-postboot-failure/`

### Case 4 — hotfix bundle (`tool_call_parser: functiongemma` — rejected at model-class layer)

**Command:**
```bash
# Bundle copied to /tmp with tool_call_parser patched to functiongemma, hash recomputed
uv run emmy swap-profile \
  --from profiles/qwen3.6-35b-a3b/v3.1 \
  --to   /tmp/gemma-4-26b-a4b-it-fix-parser \
  --port 8002 \
  --run-dir runs/phase4-sc1/swap-qwen-to-gemma-fixed
```

**Result:**
- Exit code: **6** ✓
- Preflight passed
- Forward 4 progress phases verbatim
- vLLM start failed one layer deeper: `pydantic ValidationError: The checkpoint you are trying to load has model type gemma4 but Transformers does not recognize this architecture`
- Probe timeout → rollback → 4 progress phases again → Qwen `ready` at 16:39:00; smoke `tok/s=10.06 tokens_out=100` ✓
- Final envelope: `{"rolled_back": true, "rollback_succeeded": true}` ✓

### What Exit-6 Runs Proved

1. **`no_rollback=True` recursion guard works.** Rollback re-enters the primitive with the flag set; no infinite loop. (Also covered by `test_rollback_of_rollback_prevented`, but now live-verified.)
2. **Prior engine restored cleanly end-to-end.** Both rollback cycles include probe → smoke pass. Qwen is not just "container started" — it's responding to chat requests.
3. **Forward path does not leak into rollback state.** `rolled_back: true` + `rollback_succeeded: true` envelope correctly distinguishes the two outcomes.
4. **Diagnostic bundle captures the failed container's docker logs** before the orchestrator removes the container — critical for debugging because the failing container is ephemeral.
5. **Progress phases fire 2× per exit-6 swap** (forward + rollback) with the same four-label contract.

---

## SC-4 Verdict

**`sc4 phase4 green`** — all 4 failure-mode cases verified (2 × exit-5 preflight-fail + 2 × exit-6 post-stop-rollback).

**Invariants proven (end-to-end on live DGX Spark hardware):**
- D-05 LOCKED (validate-first-then-stop): preflight catches pre-swap failures without any `docker stop` invocation. Container uptime unchanged across exit-5 cases.
- D-04 LOCKED ("prior model still loaded"): post-stop failures trigger rollback via the same primitive; prior engine is reloaded cleanly and re-verified via smoke test before returning.
- Clear error messages on both failure classes (stderr for exit-5, structured diagnostic bundle + rollback envelope for exit-6).
- JSON progress stream is stable across forward + rollback paths with identical label contract (D-02).

**Evidence integrity at time of verdict:**
- `docker ps | grep emmy-serve` shows `Up 3 minutes` (post-rollback Qwen) ✓
- `curl http://127.0.0.1:8002/v1/models` returns `qwen3.6-35b-a3b` ✓
- No stale Gemma 4 container artifacts (`docker ps -a` clean) ✓

**Exit-6 follow-up:** scheduled later in this session — see above.
