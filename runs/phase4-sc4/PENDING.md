# PENDING — SC-4 failure + rollback walkthrough (operator-gated)

**Status:** OPERATOR-DEFERRED
**Resume signal:** `"sc4 phase4 green"`
**Phase precedent:** first SC-4 of its kind — exercises Plan 04-02's D-04/D-05 exit codes 5 (preflight fail) + 6 (post-stop rollback) against a real rig.

## What blocks this from being automation-green

SC-4 verifies **two deliberate failure cases** end-to-end:

- **Case A — Exit 5 (pre-flight fail, prior engine still running):** operator hand-edits a Gemma 4 bundle field to an invalid value, triggers `/profile`, observes the swap refuses (exit 5), and confirms the Qwen engine is STILL serving by running a turn.
- **Case B — Exit 6 (post-stop fail + rollback):** operator stages a post-pre-flight-pass failure (e.g. `max_model_len: 999999999` so pre-flight passes but boot fails at KV allocation), triggers `/profile`, observes the 4 phases fire up to `loading weights`, then warmup times out, rollback triggers, and Qwen is restored.

Both cases require:

- A live DGX Spark with Qwen v3.1 running under a real container
- Operator typing `/profile gemma-4-26b-a4b-it` inside pi-emmy
- Operator observing the TUI + issuing restore commands between cases
- RAM pressure + docker lifecycle actually happen — cannot be mocked

The **unit-test coverage** for exit codes 5/6 already landed in Plan 04-02 (`tests/unit/test_swap_preflight_fail.py` + `tests/unit/test_swap_rollback.py`, 13 total). SC-4 is the live-rig complement that proves the primitive + the `/profile` slash-command handler route exit codes through to D-04 user-visible notifies.

## Exact shell commands operator runs

### Case A — pre-flight fail (exit 5)

```bash
# Setup: Qwen v3.1 serving, pi-emmy alive
bash scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1/
pi-emmy

# --- In another terminal (ops side) ---
# 1. Backup current Gemma 4 serving.yaml
cp profiles/gemma-4-26b-a4b-it/v1/serving.yaml \
   profiles/gemma-4-26b-a4b-it/v1/serving.yaml.bak

# 2. Hand-edit the container_image_digest to a guaranteed-missing digest.
#    Do NOT re-run `emmy profile hash --write` — the test is that the validator
#    catches the hash mismatch first.
sed -i 's|^\(  container_image_digest: \)sha256:.*|\1sha256:0000000000000000000000000000000000000000000000000000000000000000|' \
   profiles/gemma-4-26b-a4b-it/v1/serving.yaml

# --- In pi-emmy ---
# 3. /profile gemma-4-26b-a4b-it → Confirm prompt
#    EXPECTED: "swap pre-flight failed (prior model still serving)"
#              orchestrator exit code 5 in any captured JSONL / diagnostic bundle
# 4. Run a turn against Qwen: "what's 2+2" → lands on Qwen (proves engine alive)

# --- Ops side RESTORE ---
mv profiles/gemma-4-26b-a4b-it/v1/serving.yaml.bak \
   profiles/gemma-4-26b-a4b-it/v1/serving.yaml
# Hash should be byte-identical to pre-edit state; validate to confirm:
uv run emmy profile validate profiles/gemma-4-26b-a4b-it/v1/   # exit 0
```

### Case B — post-stop rollback (exit 6)

```bash
# After Case A restore:
# 1. Backup Gemma 4 serving.yaml again
cp profiles/gemma-4-26b-a4b-it/v1/serving.yaml \
   profiles/gemma-4-26b-a4b-it/v1/serving.yaml.bak

# 2. Edit max_model_len to intentionally exceed KV budget (lets pre-flight pass
#    but boot fails at KV allocation during "loading weights")
sed -i 's|^\(  max_model_len: \)[0-9]*|\1999999999|' \
   profiles/gemma-4-26b-a4b-it/v1/serving.yaml

# 3. Re-stamp hash so profile validate passes (hash is in-profile, NOT content-hash
#    integrity — ONE write per resume-signal Phase 1 D-13)
uv run emmy profile hash profiles/gemma-4-26b-a4b-it/v1/ --write

# --- In pi-emmy ---
# 4. /profile gemma-4-26b-a4b-it → Confirm prompt
#    EXPECTED observation in TUI:
#      "stopping vLLM"              — fires
#      "loading weights 0%"         — fires
#      "loading weights 50%"        — fires  (or hangs at 0% then fails)
#      "warmup"                     — hangs, wait_for_vllm TIMES OUT
#      "rollback: stopping failed engine"
#      "rollback: restarting prior profile"
#      NOTIFY: "swap failed; rollback succeeded"
#    orchestrator exit code 6 with envelope `{rolled_back: true, rollback_succeeded: true}`
# 5. Run a turn against Qwen: "what's 3+3" → lands on Qwen (proves rollback worked)

# --- Ops side RESTORE ---
mv profiles/gemma-4-26b-a4b-it/v1/serving.yaml.bak \
   profiles/gemma-4-26b-a4b-it/v1/serving.yaml
uv run emmy profile hash profiles/gemma-4-26b-a4b-it/v1/ --write
uv run emmy profile validate profiles/gemma-4-26b-a4b-it/v1/   # exit 0
git diff profiles/gemma-4-26b-a4b-it/v1/                        # should be empty
```

### Alternative (if the above staging proves flaky)

Build a purpose-tagged fixture profile at `tests/fixtures/profiles/broken-boot-profile/` with deliberately invalid fields. Still exercises the primitive on the real rig (docker stop + docker run + rollback) without touching Gemma 4. Document this choice in walkthrough.md.

## Expected evidence files (once signal fires)

| File | Contents |
|---|---|
| `walkthrough.md` | Operator narrative for BOTH cases; exact exit codes observed; TUI notify strings captured verbatim; RESTORE confirmations. Verdict `sc4 phase4 green` at top. |
| `transcript.json` | pi-emmy session transcript spanning both cases; shows both the successful post-rollback turn and the negative-path notifies |
| `swap-failure-bundles.txt` | `ls -la runs/boot-failures/` showing the two new `<iso>-swap-{preflight,postboot}-failure/` bundles created; optionally include their diagnostic.json contents |

## Failure modes + escalation

| Observation | Disposition |
|---|---|
| Case A — exit code 4 instead of 5 (pre-flight failed on render_docker_args, not on digest check) | Different code path fired first; not a bug, but re-sequence the test to force the digest path. Document. |
| Case A — engine actually DID stop | BUG in D-05 invariant (validate-first-then-stop). Must fix before closing SC-4. |
| Case B — rollback exits with `{rolled_back: true, rollback_succeeded: false}` | Acceptable — document the rollback-of-rollback-failure sub-case per T-04-02-02. User-visible notify should route to "rollback failed; manual recovery required in runs/boot-failures/". |
| Case B — no 4-phase observed; skipped straight to rollback | Race condition surfaced pre-load; investigate whether pre-flight actually caught the max_model_len issue. Try the alternative staging (fixture profile) instead. |
| Infinite rollback loop | BUG — T-04-02-02 guard failed. Abort immediately (pkill pi-emmy + pkill vllm) and file blocker. |

## Verdict template (for walkthrough.md replacement)

```
# SC-4 phase4 — verdict sc4 phase4 green

## Environment
- Host: <hostname>, <iso-date>
- Qwen base: profiles/qwen3.6-35b-a3b/v3.1
- Gemma 4 target (each case resets): profiles/gemma-4-26b-a4b-it/v1

## Case A — pre-flight fail (exit 5)
- Staging: container_image_digest edited to sha256:0000...
- Trigger: /profile gemma-4-26b-a4b-it
- Observed TUI notify: "<verbatim>"
- Observed orchestrator exit code: 5
- Verified Qwen STILL serving (post-fail turn): <prompt> → <response>
- Restored serving.yaml: yes (git diff empty after restore)

## Case B — post-stop rollback (exit 6)
- Staging: max_model_len = 999999999 (KV allocation failure)
- Trigger: /profile gemma-4-26b-a4b-it
- Observed phase sequence: "stopping vLLM" → "loading weights" → wait_for_vllm TIMEOUT → rollback
- Observed TUI notify: "swap failed; rollback succeeded"
- Observed orchestrator envelope: { rolled_back: true, rollback_succeeded: true }
- Verified Qwen RESTORED (post-rollback turn): <prompt> → <response>
- Restored serving.yaml + hash: yes

## Swap-failure bundles created
- runs/boot-failures/<iso>-swap-preflight-failure/   (Case A)
- runs/boot-failures/<iso>-swap-postboot-failure/    (Case B)

## Verdict
sc4 phase4 green.
D-04 failure contract verified end-to-end: pre-flight catches pre-stop failures
(exit 5 / prior engine alive); post-stop failures route to rollback (exit 6 /
rollback_succeeded=true / prior engine restored).
```
