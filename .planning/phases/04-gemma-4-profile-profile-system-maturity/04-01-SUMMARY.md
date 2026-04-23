---
phase: 04-gemma-4-profile-profile-system-maturity
plan: 01
subsystem: profile
tags: [gemma-4, profile, serving, fp8, vllm, pydantic, schema, moe]

# Dependency graph
requires:
  - phase: 01-serving-foundation-profile-schema
    provides: EngineConfig + ProfileManifest pydantic schema, validator CLI (emmy profile validate/hash), content-hash canonicalization, profile bundle shape (5 files + 3 subdirs)
  - phase: 02-pi-harness-mvp-daily-driver-baseline
    provides: GrammarConfig nested shape (D-11 reactive mode), tool_schemas JSON shapes for 9 native tools, Hashline edit_format prompt
  - phase: 03-observability-agent-loop-hardening-lived-experience
    provides: CompactionConfig + WebFetchConfig in ContextConfig/ToolsConfig (backward-compat via Optional)
provides:
  - Second first-class model profile bundle at profiles/gemma-4-26b-a4b-it/v1/ (SERVE-03, PROFILE-07)
  - EngineConfig schema extension with Optional reasoning_parser + max_num_seqs fields (backward-compat; all Qwen v1/v2/v3/v3.1 profiles unchanged)
  - PROFILE_NOTES.md citation discipline template for per-knob provenance (SC-5 / D-16)
  - D-17 RESEARCH resolution: tool_call_parser=gemma4, reasoning_parser=gemma4, known parser bugs #39392/#39468 documented with reactive-grammar mitigation
  - Gemma 4 native function-call Lark grammar (<|tool_call>call:NAME{...}<tool_call|>) for reactive XGrammar backstop
  - Content-hash-stamped immutable v1 bundle: sha256:6d2884fbca4ddb610657dde58429c430f5465ca540c427c18c68e9d742384450
affects:
  - 04-02 (emmy profile swap primitive — uses this bundle as swap target)
  - 04-03 (/profile slash command — uses this bundle in profile index)
  - 04-04 (routes.yaml — may add Gemma variants later)
  - 04-05 (no-model-conditionals audit — validates no harness/serve code references Gemma by name)
  - 04-06 (operator-gated KV finder + 2-hour thermal replay on DGX Spark — overwrites measured_values frontmatter)
  - 05-* (eval suite will exercise this profile alongside Qwen)

# Tech tracking
tech-stack:
  added:
    - vLLM gemma4 tool_call_parser + reasoning_parser (already in vLLM 0.19.x; this plan wires them into a profile)
    - max_num_seqs Optional schema field (new pydantic knob)
  patterns:
    - Profile bundle as versioned keystone abstraction (extended from Phase 1 to second family)
    - Per-knob community-source citation in PROFILE_NOTES.md (SC-5 discipline; parity with Qwen v3.1 leader)
    - Model-agnostic prompt reuse (system.md / edit_format.md / tool_descriptions.md / compact.md byte-identical to Qwen v3.1; model-shape lives only in grammar + engine parsers)
    - Backward-compatible schema extension via Optional[...] = None (zero regression on prior profiles)

key-files:
  created:
    - profiles/gemma-4-26b-a4b-it/v1/profile.yaml (manifest + content hash + 5 community_sources)
    - profiles/gemma-4-26b-a4b-it/v1/serving.yaml (vLLM engine config; FP8 runtime quant; gemma4 parsers)
    - profiles/gemma-4-26b-a4b-it/v1/harness.yaml (tools + compaction + web_fetch/web_search; reactive grammar)
    - profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md (citation ledger + known parser bugs + Phase-5 eval candidates)
    - profiles/gemma-4-26b-a4b-it/v1/prompts/{system,edit_format,tool_descriptions,compact}.md (byte-identical to Qwen v3.1)
    - profiles/gemma-4-26b-a4b-it/v1/tool_schemas/*.schema.json (9 files; byte-identical to Qwen v3.1 — schemas are tool-shape, not model-shape)
    - profiles/gemma-4-26b-a4b-it/v1/grammars/tool_call.lark (Gemma 4 native <|tool_call>call:NAME{…}<tool_call|> — rewritten)
    - tests/unit/test_profile_schema_gemma4.py (5 pydantic tests; all green)
  modified:
    - emmy_serve/profile/schema.py (added Optional reasoning_parser + max_num_seqs to EngineConfig)
    - tests/unit/test_schema.py (added test_all_shipped_profiles_validate matrix)

key-decisions:
  - "Shipped D-17 resolution: tool_call_parser=gemma4 + reasoning_parser=gemma4 (vLLM 0.19 native) instead of Hermes fallback — native path is the Google+vLLM documented format; parser bugs #39392 + #39468 are mitigated by reactive grammar (D-11 backstop)"
  - "Seeded gpu_memory_utilization=0.55 (LOW end) rather than theoretical Spark UMA max — per Phase 3.1 UMA lesson that reclaimed ~40 GB of system headroom; operator-gated KV bisection in Plan 04-06 will refine UP"
  - "max_num_seqs=4 per NVIDIA Day-1 DGX Spark recipe; defensive value documented but max_num_seqs=1 flagged as Phase-5 eval candidate if bug #39392 fires empirically"
  - "Schema extension via Optional[str] reasoning_parser and Optional[int] max_num_seqs — backward-compat contract preserves zero-diff validation on all 4 Qwen profiles (v1/v2/v3/v3.1)"
  - "Prompts byte-identical to Qwen v3.1 — system prompt, Hashline edit format, tool descriptions, compaction prompt are all model-agnostic. Model-shape lives ONLY in serving.yaml.engine parsers + the Lark grammar envelope."
  - "temperature=1.5 experiment deferred to Phase 5 eval (NOT shipped today) per Pitfall #1 ('more prompting trap' — validate any change against full eval before adopting)"

patterns-established:
  - "Pattern 1: Backward-compatible schema extension — new vLLM knobs land as Optional[...] = None so prior profiles validate with zero churn"
  - "Pattern 2: Model-agnostic prompt copy — byte-identical prompts for SP_OK, Hashline edits, tool descriptions, compaction; diff only where the model's output actually differs"
  - "Pattern 3: Known-parser-bug ledger in PROFILE_NOTES.md — cites GitHub issue URLs, names the shipped mitigation, records the deferred defensive knob as a Phase-5 eval candidate"
  - "Pattern 4: Seed-then-measure — serving.yaml ships the LOW-end seed (gpu_memory_utilization=0.55) annotated as a placeholder; operator-gated measurement overwrites the measured_values frontmatter in a later plan"
  - "Pattern 5: test_all_shipped_profiles_validate matrix — walks profiles/*/v*/ so every new bundle is auto-covered without adding a per-bundle test"

requirements-completed: [SERVE-03, PROFILE-07]

# Metrics
duration: ~25 min
completed: 2026-04-23
---

# Phase 04 Plan 01: Gemma 4 Profile v1 Summary

**Gemma 4 26B A4B MoE profile v1 shipped as the second first-class model bundle — proving SC-2 (profile abstraction is model-agnostic) with Optional schema extension (reasoning_parser + max_num_seqs) and zero Qwen regression.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-23T08:04:00Z
- **Completed:** 2026-04-23T08:29:13Z
- **Tasks:** 2 (both TDD)
- **Files created:** 19 (18 bundle files + 1 new unit test file)
- **Files modified:** 2 (schema.py, test_schema.py)

## Accomplishments

- Shipped `profiles/gemma-4-26b-a4b-it/v1/` — full 18-file bundle (profile.yaml + serving.yaml + harness.yaml + PROFILE_NOTES.md + 4 prompts + 9 tool_schemas + 1 Lark grammar), content hash `sha256:6d2884fbca4ddb610657dde58429c430f5465ca540c427c18c68e9d742384450` stamped via `uv run emmy profile hash --write`.
- Extended pydantic `EngineConfig` with `Optional[str] reasoning_parser` (D-17) and `Optional[int] max_num_seqs` (NVIDIA Day-1 recipe). Backward-compat verified: all 4 Qwen profiles (v1/v2/v3/v3.1) validate unchanged.
- Resolved D-17 (Research flag): `tool_call_parser: gemma4` + `reasoning_parser: gemma4` — vLLM 0.19 native parsers. Documented known bugs #39392 (pad-token leak) and #39468 (format-corruption) with reactive-grammar mitigation (D-11) and `max_num_seqs=1` flagged as Phase-5 eval candidate.
- SC-5 citation discipline: every non-default sampling/engine knob in PROFILE_NOTES.md cites a community URL with retrieved date (≥5 primary sources: Google model card, function-calling docs, vLLM serving recipe, vLLM parser API docs, NVIDIA Day-1 benchmarks).
- Added `test_all_shipped_profiles_validate` matrix test to `tests/unit/test_schema.py` — any future bundle under `profiles/*/v*/` is auto-regression-checked.
- All 173 unit tests pass; 5/5 new Gemma schema tests green; 0 regressions.

## Task Commits

Each task committed atomically:

1. **Task 1: Schema extension + Wave 0 test scaffolds** — `d1279cf` (feat)
   - Added `reasoning_parser: Optional[str] = None` and `max_num_seqs: Optional[int] = Field(default=None, gt=0)` to `EngineConfig`.
   - Created `tests/unit/test_profile_schema_gemma4.py` with 5 tests (RED scaffold: 2 pass, 3 skip until bundle).
   - Extended `tests/unit/test_schema.py` with matrix test for all shipped bundles.
2. **Task 2: Gemma 4 v1 bundle — all 18 files** — `1e3576e` (feat)
   - Created the full `profiles/gemma-4-26b-a4b-it/v1/` directory bundle.
   - Stamped content hash via `uv run emmy profile hash --write`.
   - All 5 Gemma schema tests GREEN; 4 prior Qwen profiles still validate exit 0.

## Files Created/Modified

**Created:**
- `profiles/gemma-4-26b-a4b-it/v1/profile.yaml` — manifest; id + family + community_sources (5 entries)
- `profiles/gemma-4-26b-a4b-it/v1/serving.yaml` — vLLM engine config; FP8 runtime quant; gemma4 parsers; seed KV budget
- `profiles/gemma-4-26b-a4b-it/v1/harness.yaml` — tools + compaction + web_fetch/web_search; reactive grammar path
- `profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md` — per-knob provenance tables + known-parser-bugs ledger + Phase-5 eval candidates
- `profiles/gemma-4-26b-a4b-it/v1/prompts/system.md` — SP_OK canary (byte-identical to Qwen v3.1)
- `profiles/gemma-4-26b-a4b-it/v1/prompts/edit_format.md` — Hashline (byte-identical to Qwen v3.1)
- `profiles/gemma-4-26b-a4b-it/v1/prompts/tool_descriptions.md` — 9 native tools (byte-identical)
- `profiles/gemma-4-26b-a4b-it/v1/prompts/compact.md` — compaction prompt (byte-identical)
- `profiles/gemma-4-26b-a4b-it/v1/tool_schemas/{read,write,edit,bash,grep,find,ls,web_fetch,web_search}.schema.json` — 9 JSON tool schemas (byte-identical to Qwen v3.1)
- `profiles/gemma-4-26b-a4b-it/v1/grammars/tool_call.lark` — Gemma 4 native format Lark grammar (over-accepting backstop per D-11)
- `tests/unit/test_profile_schema_gemma4.py` — 5 pydantic schema + bundle-load tests

**Modified:**
- `emmy_serve/profile/schema.py` — added Optional `reasoning_parser` and `max_num_seqs` fields to `EngineConfig`
- `tests/unit/test_schema.py` — added `test_all_shipped_profiles_validate` matrix that walks `profiles/*/v*/`

## Decisions Made

- **D-17 resolution (RESEARCH flag):** ship `tool_call_parser: gemma4` + `reasoning_parser: gemma4` (vLLM 0.19 native) instead of Hermes fallback — Google+vLLM docs both declare this as the canonical path. Known bugs #39392 / #39468 are mitigated by the existing Phase 2 D-11 reactive-grammar backstop; no profile-side workaround required today.
- **Schema extension via `Optional[...] = None`** rather than a new nested model — minimal surface, zero diff on prior profiles, future vLLM knobs follow the same shape. `max_num_seqs` was not in the interfaces comment of the plan but IS required by the Gemma bundle (Rule 2 auto-add — see Deviations).
- **gpu_memory_utilization=0.55 SEED** (not the prior repo's 0.88 or vLLM default 0.95) — per Phase 3.1 UMA lesson documented in `profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md`; operator-gated KV bisection in Plan 04-06 will refine.
- **max_num_seqs=4** per NVIDIA Day-1 DGX Spark recipe; `max_num_seqs=1` flagged in PROFILE_NOTES.md as Phase-5 eval candidate only — we do not pre-emptively disable concurrency without empirical evidence of #39392 firing.
- **Prompts copied byte-identical from Qwen v3.1** — this is the load-bearing evidence that the profile abstraction is truly model-agnostic (SC-2): the only divergences are `serving.yaml.engine.*` (parser selection) and `grammars/tool_call.lark` (envelope shape).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `max_num_seqs` field to EngineConfig**
- **Found during:** Task 1 (Schema extension)
- **Issue:** The plan's `<interfaces>` block listed `max_num_seqs: Optional[int] = None` as already present in `EngineConfig`, but it was not. The Gemma bundle requires `max_num_seqs: 4` in `serving.yaml` per 04-RESEARCH.md §2 and the acceptance criteria, and `EngineConfig` has `extra='forbid'` — so without the field, validation would fail.
- **Fix:** Added `max_num_seqs: Optional[int] = Field(default=None, gt=0)` to `EngineConfig` with explanatory comment tied to D-17 research output. Backward-compat: Qwen profiles that omit the field continue to validate (field defaults None).
- **Files modified:** `emmy_serve/profile/schema.py`
- **Verification:** `test_gemma4_serving_yaml_full_load` asserts `e.max_num_seqs == 4`; all 4 Qwen profiles still validate exit 0 via `uv run emmy profile validate`.
- **Committed in:** `d1279cf` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Installed `lark` as editable-env dependency for acceptance-criteria verification**
- **Found during:** Task 2 (grammar parse check)
- **Issue:** The plan's acceptance criterion `python -c "import lark; lark.Lark(open(...))"` requires the `lark` Python module, but it was not installed in the project venv (lark is used inside the vLLM container, not by the host Python). Without it, the grammar-parses-as-Lark assertion couldn't be run.
- **Fix:** Ran `uv pip install lark` to enable the acceptance check in this sandbox. Confirmed the grammar parses AND a representative Gemma 4 tool-call string (`<|tool_call>call:read{path:<|"|>/tmp/foo.py<|"|>}<tool_call|>`) parses through it. NOTE: this is a dev/verification dep only — lark is not required at runtime because vLLM ships its own copy inside the serving container. No `pyproject.toml` dep addition was committed.
- **Files modified:** None committed (venv-local only).
- **Verification:** Grammar + two representative tool-call strings parse exit 0.
- **Committed in:** n/a (dev-env only)

**3. [Rule N/A - Documentation style] `ai.google.dev` appears 3× in `harness.yaml` (vs. plan's `grep -c` expecting exactly 1)**
- **Found during:** Task 2 acceptance check
- **Issue:** The acceptance criterion is `grep -c "ai.google.dev" harness.yaml` returns 1. My harness.yaml includes two header/inline comments explaining the hostname addition plus the actual allowlist entry — total 3 occurrences.
- **Decision:** Not fixed. The letter of the grep check is violated by documentation comments; the spirit (ai.google.dev is whitelisted for Gemma 4 docs) is fully satisfied. Stripping the explanatory comments would reduce profile-editor ergonomics for zero correctness gain. Flagging as a deviation for transparency.
- **Files modified:** N/A
- **Verification:** `grep "^\s*-\s*ai.google.dev" harness.yaml | wc -l` returns 1 (one actual allowlist entry).
- **Committed in:** `1e3576e` (Task 2 commit)

---

**Total deviations:** 3 (2 Rule 2 critical auto-fixes, 1 documentation-style transparency note)
**Impact on plan:** All deviations necessary for correctness; no scope creep. The schema extension for `max_num_seqs` is required by the Gemma bundle as specified in the plan. The lark install is a dev-env-only workaround that does not touch project deps. The `ai.google.dev` count is a grep-literalism mismatch — the profile is functionally correct.

## Issues Encountered

None — two-task plan executed linearly; TDD discipline held (RED on 3 of 5 Gemma tests during Task 1; GREEN all 5 after Task 2).

## User Setup Required

None — no external service configuration needed. The operator-gated KV bisection + 2-hour thermal replay on DGX Spark (D-15) are deferred to Plan 04-06 and do not block this plan's completion.

## Next Phase Readiness

**Ready for downstream plans:**
- Plan 04-02 (`emmy profile swap` primitive) can use `profiles/gemma-4-26b-a4b-it/v1/` as a swap target; validator exits 0 and hash is stamped.
- Plan 04-03 (`/profile` slash command) can index this bundle (autocompletion `/profile gemma-4-26b-a4b-it` resolves).
- Plan 04-05 (no-model-conditionals audit) has a second profile to run against; the audit should now find ONE permitted data occurrence of "gemma" in profile YAML content and zero in harness/serve code paths.
- Plan 04-06 (operator-gated DGX Spark runs) inherits the seed `gpu_memory_utilization=0.55` and empty `measured_values` placeholders ready to be overwritten.

**Deferred (tracked):**
- Boot-time smoke on DGX Spark (`scripts/smoke_test.py --profile profiles/gemma-4-26b-a4b-it/v1/`) — operator-gated; Plan 04-06.
- KV finder bisection + 2-hour thermal replay — operator-gated; Plan 04-06.
- Gemma variant bundles for routes.yaml within-model routing — Plan 04-04 (plan currently ships Qwen variants only).
- Speculative decoding (EAGLE-3 for Gemma 4 26B) — Phase 6 (speculator availability TBD).

## Threat Flags

None — this plan ships only profile-bundle data (YAML + Markdown + JSON schemas + one Lark grammar). No new network endpoints, auth paths, or file-access patterns. The `web_fetch.allowlist` adds one hostname (`ai.google.dev`) which is a trust-boundary extension explicitly authorized by D-16 citation discipline + D-26 default-deny allowlist posture. The air-gap CI validators (`ci_verify_phase3` STRICT + `ci_verify_research_egress` PERMISSIVE) are unchanged from Phase 3.1.

## Self-Check: PASSED

Verification performed after SUMMARY.md draft:

- `profiles/gemma-4-26b-a4b-it/v1/profile.yaml` exists: FOUND
- `profiles/gemma-4-26b-a4b-it/v1/serving.yaml` exists: FOUND
- `profiles/gemma-4-26b-a4b-it/v1/harness.yaml` exists: FOUND
- `profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md` exists: FOUND
- `profiles/gemma-4-26b-a4b-it/v1/grammars/tool_call.lark` exists: FOUND
- `profiles/gemma-4-26b-a4b-it/v1/prompts/*.md` count == 4: FOUND
- `profiles/gemma-4-26b-a4b-it/v1/tool_schemas/*.json` count == 9: FOUND
- `tests/unit/test_profile_schema_gemma4.py` exists: FOUND
- `emmy_serve/profile/schema.py` contains `reasoning_parser`: FOUND
- `emmy_serve/profile/schema.py` contains `max_num_seqs`: FOUND
- Commit `d1279cf` (Task 1) in history: FOUND
- Commit `1e3576e` (Task 2) in history: FOUND
- `uv run emmy profile validate profiles/gemma-4-26b-a4b-it/v1/` exit 0: FOUND
- `uv run emmy profile validate profiles/qwen3.6-35b-a3b/v1|v2|v3|v3.1/` exit 0: FOUND (all 4)
- `uv run pytest tests/unit/test_profile_schema_gemma4.py` 5 passed: FOUND
- `uv run pytest tests/unit/` 173 passed, 1 skipped (shellcheck-not-installed, pre-existing): FOUND

---
*Phase: 04-gemma-4-profile-profile-system-maturity*
*Plan: 01*
*Completed: 2026-04-23*
