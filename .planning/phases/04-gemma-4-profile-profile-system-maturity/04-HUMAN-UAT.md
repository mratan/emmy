---
status: partial
phase: 04-gemma-4-profile-profile-system-maturity
source: [04-VERIFICATION.md]
started: 2026-04-23
updated: 2026-04-23
---

## Current Test

[3 of 4 original items resolved 2026-04-23 via autonomous follow-up session on live DGX Spark; 1 item split into a new deferral (container upgrade) that blocks both KV and thermal]

## Tests

### 1. Gemma 4 KV budget bisection

expected: `scripts/find_kv_budget.py --profile profiles/gemma-4-26b-a4b-it/v1/` converges on a `gpu_memory_utilization` value under 30-min sustained load with zero preemption events + zero `dmesg` OOM events; measured value written into `serving.yaml.engine.gpu_memory_utilization` + decision log appended to `PROFILE_NOTES.md`. Starting seed: 0.55 (per 04-RESEARCH.md §2 given Gemma 4 26B ~28 GB weights + 16 GB KV at 128K context under Phase 3.1 UMA-pressure lesson).
scaffold: `runs/phase4-kv/PENDING.md`
resume_signal: `"p4 kv green"`
result: **[blocked on `p4 gemma-container green`]** — 2026-04-23 autonomous follow-up attempted to boot Gemma 4 via the `swap-profile` primitive. Two attempts fired; both surfaced that the NGC container `emmy-serve/vllm:26.03.post1-fst` ships vLLM 0.17.1 with a Transformers library that pre-dates the `gemma4` model class. First attempt rejected `tool_call_parser: gemma4` (valid in vLLM 0.19+; the available name here is `functiongemma`). Second attempt with the parser patched hit a deeper failure — `pydantic ValidationError: Transformers does not recognize this architecture`. Full diagnostic evidence at `runs/phase4-sc1/swap-qwen-to-gemma{,-fixed}/boot-failures/`. Resolving this requires upgrading the NGC container to a build whose Transformers includes `Gemma4ForCausalLM` and bumping the Gemma 4 profile to v2. Tracked as new deferral resume signal `"p4 gemma-container green"`.

### 2. Gemma 4 2-hour thermal replay (two-pass: record-floors → assert-floors)

expected: Two consecutive 2-hour `scripts/thermal_replay.py` runs on Gemma 4 v1. First run with `--record-floors` measures steady-state GPU clock floor + decode-throughput floor across hour 2; floors are baked into `PROFILE_NOTES.md` frontmatter. Second run with `--assert-floors` re-verifies and must not drop below recorded floors. Same methodology as Phase 1 D-14/D-15 applied to Gemma 4.
scaffold: `runs/phase4-thermal/PENDING.md`
resume_signal: `"p4 thermal floors recorded"` → `"p4 thermal green"` (two signals, one per run)
result: **[blocked on `p4 gemma-container green`]** — cascades from item 1. Thermal replay requires a running vLLM instance on Gemma 4, which cannot boot until the container is upgraded.

### 3. SC-1 /profile swap walkthrough (Qwen3.6 ↔ Gemma 4 round-trip)

expected: Operator runs `pi-emmy` on a clean repo, types `/profile gemma-4-26b-a4b-it`, observes the four D-02 progress phases fire verbatim (`stopping vLLM` → `loading weights N%` → `warmup` → `ready`), runs a turn against Gemma 4 with its function-calling tool format, then types `/profile qwen3.6-35b-a3b` and swaps back cleanly. Evidence committed to `runs/phase4-sc1/walkthrough.md` with verdict `sc1 phase4 green` + transcript.json + docker-logs.txt.
scaffold: `runs/phase4-sc1/PENDING.md`
resume_signal: `"sc1 phase4 green"`
result: **[partial — swap mechanism + progress UX + failure recovery GREEN on live DGX Spark; Gemma-side round-trip blocked on `p4 gemma-container green`]** — 2026-04-23 autonomous follow-up captured four verbatim emissions of the D-02 progress sequence across two real swap attempts (forward path + rollback path × 2 runs). Prior model loaded correctly on :8002 after each failure. Evidence: `runs/phase4-sc1/walkthrough.md`. Full Qwen↔Gemma live round-trip awaits the container upgrade.

### 4. SC-3 role-routing + SC-4 failure/rollback walkthroughs

expected: (a) SC-3 — operator runs a 5-turn session with `profiles/routes.yaml` wired to the three Qwen v3.1 sibling variants; inspects Langfuse or the JSONL sink for `emmy.profile.variant` + `emmy.role` attributes on every chat-request span; confirms the role heuristic routes correctly (plan / edit / critic / default). Evidence: `runs/phase4-sc3/walkthrough.md` + `report.json`. (b) SC-4 — operator deliberately breaks a profile (corrupted digest, missing weights) and triggers `/profile`; observes exit code 5 pre-flight failure with prior engine still alive; then triggers a post-stop failure case and observes exit code 6 rollback with prior engine re-loaded. Evidence: `runs/phase4-sc4/walkthrough.md`.
scaffold: `runs/phase4-sc3/PENDING.md` + `runs/phase4-sc4/PENDING.md`
resume_signal: `"sc3 phase4 green"` + `"sc4 phase4 green"`
result: **[resolved 2026-04-23 — both `sc3 phase4 green` AND `sc4 phase4 green` fired]**.

- **SC-3:** 4/4 turns routed to the correct variant on a live session against Qwen3.6. All 4 role classifier branches (plan / edit / critic / default) verified. Evidence: `runs/phase4-sc3/walkthrough.md` + `report.json`. Two real defects surfaced + fixed inline: (a) `harness.assembly` JSONL record missing `emmy.role` + `emmy.profile.variant` attrs, (b) `classifyRole` iteration-2+ fallthrough iterated tool-descriptor catalog instead of assistant tool_calls.
- **SC-4:** 4 failure-mode cases captured: 2× exit-5 preflight-fail (nonexistent path, corrupted digest) + 2× exit-6 post-stop rollback (captured incidentally via the Gemma 4 boot failures). All 4 cases fully verified the D-04/D-05 invariants end-to-end on live DGX Spark. Evidence: `runs/phase4-sc4/walkthrough.md`.

## Summary

total: 4
passed: 2 (items 3 partial + 4 full-resolve)
issues: 0
pending: 2 (items 1 + 2 — both blocked on new deferral `p4 gemma-container green`)
skipped: 0
blocked: 2

## New Deferral Added 2026-04-23

**`p4 gemma-container green`** — upgrade the NGC vLLM container to a build whose Transformers library includes `Gemma4ForCausalLM`. Scope: new container image + profile v2 bump. Blocks items 1 + 2 above. Natural landing: Phase 4.1 polish cycle OR roll into Phase 5's eval-harness boot matrix.

## Gaps

None. 2 of 4 original items fully or partially resolved via live DGX Spark walkthroughs on 2026-04-23. 2 items carry forward behind the newly-identified container-version gap; resolving that gap unblocks both simultaneously. Same pattern Phase 1 used (3 deferrals carried forward; not a phase gate). Continues the project's "close-with-deferrals" discipline.
