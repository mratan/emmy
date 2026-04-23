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

## Exit-6 Case (post-stop rollback)

*Deferred to end of this autonomous session — requires a real vLLM restart cycle (~3 min per attempt). Will be executed after KV bisection + thermal runs on Gemma 4 complete, before restoring the Qwen default. Evidence will be appended below.*

**Planned command:**
```bash
# Construct a profile that passes preflight but fails at vLLM boot —
# e.g., serving.yaml.engine.model pointing at a container-internal path
# whose bind-mount exists but directory is empty.
uv run emmy swap-profile \
  --from profiles/qwen3.6-35b-a3b/v3.1 \
  --to   /tmp/qwen-v3.1-bad-model-path \
  --run-dir runs/phase4-sc4/exit6-case-empty-model-dir
```

**Expected:**
- Exit code: 6
- stdout: 4 progress phases fire verbatim until the `loading weights` phase, then rollback triggers
- Rollback invokes the same primitive with `--no-rollback` to re-boot the prior profile
- Final state: prior Qwen engine back up, observable via `/v1/models`

---

## SC-4 Verdict (exit-5 portion)

**`sc4 phase4 green`** — exit-5 cases ✓ (2/2 cases verified).

**Invariants proven:**
- D-05 LOCKED (validate-first-then-stop): preflight catches both schema and digest failures BEFORE any `docker stop` invocation. Container uptime unchanged across both test runs.
- Clear error messages surface via stderr + structured `check.json` in diagnostic bundle.
- Prior engine remains served on :8002 with zero disruption to the currently active Qwen3.6 session.

**Exit-6 follow-up:** scheduled later in this session — see above.
