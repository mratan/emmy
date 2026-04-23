---
profile_id: qwen3.6-35b-a3b
profile_version: v3.1
created: 2026-04-22
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: 0.55   # D-29 — Phase 3.1 RAM headroom; was 0.88 in v3
  gpu_clock_p5_hour2_mhz: 0    # nvidia-smi sampler returned 0 — see Sampler Gap below (carried from v3)
  decode_throughput_p50_hour2_tokps: 48.1   # v3 thermal run value (pre-Phase-3.1); re-validation deferred to Phase 5
  decode_throughput_p1_hour2_tokps: 41.4
  gpu_clock_p50_hour2_mhz: 0   # nvidia-smi sampler returned 0 — see Sampler Gap below (carried from v3)
  cold_start_seconds: 159
  warm_throughput_tokps: 49.9
validation_runs:
- run_id: 20260421T062726Z_dc65a5-kv-finder
  hash: sha256:87f70318eba717e86c548ba538c75bb85df32215c499c29c8250b30e6f048df7
  purpose: KV-bisection finder (10 iterations, values 0.75..0.93 clean, 0.95 boot-timeout)
- run_id: 20260421T092927Z_a1b62b-thermal
  hash: sha256:5a072c14e4ad3684cf5f145cad188b3b55a74c8704bfcb08d722529d202d30fd
  purpose: 2-hour thermal replay (record-floors; zero preemptions, zero OOM)
- run_id: phase2-sc2
  hash: sha256:e26ed4011db54a3bb9251e719bf5a3a299884dd6cfca79edbf9c0fa64cd495b6
  purpose: SC-2 hash-anchored edit regression (5 fixtures; 0 hash-anchored string-not-found failures vs 1 baseline — Hashline disambiguation win proved)
- run_id: phase2-sc3-reactive
  hash: sha256:af3296773dcdb8eed6ffa5da391969425761a06174abeae01f8b0979c3f7756e
  purpose: SC-3 parse-rate (D-12 graduated SLA; 100 turns reactive grammar; syn=1.0 real=1.0 agg=1.0 — production path, verdict=pass)
- run_id: phase2-sc3-disabled
  hash: sha256:66493495f30e7a2fe99a8b0667a5d353f79717a32cea9405de5e3b5ee710d279
  purpose: SC-3 no-grammar baseline (D-14 counterfactual; 100 turns with tools.grammar.mode=disabled; syn=1.0 real=1.0 agg=1.0 — informational, no verdict gate)
- run_id: phase2-sc3-no_per_tool_sampling
  hash: sha256:e7318075d84be772b8fac6ac51cd0ab969ba37ee2e2f0c98a7f82fca3eb2839b
  purpose: SC-3 without per_tool_sampling (W3 / CLAUDE.md Pitfall #5 Before/After; 100 turns with harness.yaml.tools.per_tool_sampling removed; syn=1.0 real=1.0 agg=1.0 — informational)
- run_id: phase2-sc4
  hash: sha256:e0deaeea6299a7752d01a75e62375a182890d1a4c5922a32f47eecd7f601d0a1
  purpose: SC-4 MCP bridge smoke + 4 Unicode poison categories (Cf/Co/Cs/bidi) rejected at registration; in-process test MCP filesystem server exercises flat-name dispatch
- run_id: phase2-sc5
  hash: sha256:f7ae94a0370191d22ba1b9b84ea3b40c634cc26651f42018b20fc31f067e5f35
  purpose: SC-5 prompt.sha256 byte-stability across 3 runs + AGENTS.md verbatim + max_input_tokens consistency (committed=computed=114688)
---

# Qwen3.6-35B-A3B-FP8 — v1 Profile Notes

Phase 1 baseline profile. Qwen3.6-35B-A3B-FP8 (Qwen MoE, 3B active) served in
`nvcr.io/nvidia/vllm:26.03.post1-py3` on a DGX Spark.

## Provenance of defaults (PROFILE-05)

Every non-trivial default in `serving.yaml` and `harness.yaml` is sourced below.

### Engine

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `container_image` | `nvcr.io/nvidia/vllm:26.03.post1-py3` | [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm) | 2026-04-18 |
| `container_image_digest` | sha256:<DIGEST> | `docker inspect` after first pull | 2026-04-20 |
| `load_format: fastsafetensors` | Set | STACK.md + [prior repo README.md "Fast model loading"](/data/projects/setup_local_opencode/README.md) | 2026-04-20 |
| `kv_cache_dtype: fp8` | Set | [vLLM Qwen3.5/3.6 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) | 2026-04-18 |
| `tool_call_parser: qwen3_coder` | Set | [vLLM Qwen3 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) — Qwen3-Coder XML format | 2026-04-18 |
| `attention_backend: flashinfer` | Set | [NVIDIA DGX Spark vLLM thread](https://discuss.vllm.ai/t/nvidia-dgx-spark-compatibility/1756) | 2026-04-18 |
| `enable_prefix_caching: true` | Set | SERVE-07 project requirement + vLLM 0.19 default behavior | — |
| `enable_chunked_prefill: true` | Set | SERVE-07 + vLLM 0.19 V1 default | — |
| `gpu_memory_utilization` | 0.75 (initial) → <FINAL> (post-finder) | D-13 automated finder; see [runs/<iso>-kv-finder](#) | 2026-04-?? |

### Sampling

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `temperature: 0.2` | Set | [Qwen3.6 HF model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) sampling defaults | 2026-04-18 |
| `top_p: 0.95` | Set | Qwen3.6 HF model card | 2026-04-18 |
| `top_k: 40` | Set | Qwen3.6 HF model card | 2026-04-18 |
| `repetition_penalty: 1.05` | Set | Qwen3.6 HF model card | 2026-04-18 |

### Why `speculative: null`

Speculative decoding (Qwen3-MTP) deferred to Phase 6 per ROADMAP.md + PITFALLS.md #4.
Paired spec-on/spec-off benchmark is the gate; we don't have the eval harness until
Phase 5, so measuring correctly isn't possible yet. No-spec baseline is recorded
here as the Phase 1 measured throughput.

## Prefix-order policy (SERVE-07)

Prompts are assembled in this order, never reordered, for maximum KV-cache reuse:

1. System prompt (static across a session)
2. AGENTS.md / project context (static across a session)   ← Phase 2 fills
3. Tool definitions (static across a session)              ← Phase 2 fills
4. Conversation history (grows turn-by-turn)
5. Latest user message

Reordering any of 1-3 busts prefix cache. This rule is a profile contract.

## Measured-values log (D-15, D-16)

| Measurement | Value | Method | Run artifact |
|-------------|-------|--------|--------------|
| `gpu_memory_utilization` (final) | 0.88 | `scripts/find_kv_budget.py` (10 iterations; safety 5% of 0.93) | `runs/20260421T062726Z_dc65a5-kv-finder/iterations.jsonl` |
| GPU clock floor p5 hour 2 | 0 MHz (**sampler gap — see below**) | `scripts/thermal_replay.py` nvidia-smi subprocess | `runs/20260421T092927Z_a1b62b-thermal/` |
| Decode throughput p50 hour 2 | 48.13 tok/s | `scripts/thermal_replay.py` `--record-floors` | `runs/20260421T092927Z_a1b62b-thermal/summary.json` |
| Decode throughput p1 hour 2 | 41.36 tok/s | `scripts/thermal_replay.py` `--record-floors` | `runs/20260421T092927Z_a1b62b-thermal/summary.json` |
| Cold-start (fastsafetensors) | 159 s | `start_emmy.sh` ready banner | `runs/phase-b2-20260421T085621Z/boot.log` |
| Warm 500-token decode throughput | 49.92 tok/s mean (3 runs, post-2hr-thermal) | direct httpx | Phase C measurement |

## SC-1 throughput gap vs. 60 tok/s floor — accept-architectural (2026-04-21)

The gap is closed by documenting it as architectural. The Plan 01-06 sweep
(`runs/20260421T170858Z_bd0e9e-phase1-sc1-throughput-sweep/results.json`) ran
the four PROFILE_NOTES.md candidates + baseline against the Phase C warm-500-token
prompt. No candidate exceeded the 60 tok/s floor without a canary regression.

| Candidate | Mean tok/s | std | Canaries SP/TC/GEN | Disposition |
|---|---|---|---|---|
| k0-baseline | **49.34** | 0.48 | YYY | Reproduces documented 48–50 tok/s (pitfall-#5 control). |
| k1-flashinfer-moe (env `VLLM_USE_FLASHINFER_MOE_FP8=1`) | 0.00 | — | NNN | **Boot failure**: `/v1/models not ready within 300s`. This env breaks vLLM startup in `emmy-serve/vllm:26.03.post1-fst`. Likely conflicts with `VLLM_FLASHINFER_MOE_BACKEND=latency` or with ordering in 0.17.1+nvinternal. Needs upstream investigation. |
| k2-hybrid-kv-cache (env `VLLM_ALLOW_CHUNKED_LOCAL_ATTN_WITH_HYBRID_KV_CACHE=1`) | **50.65** | 0.07 | YYY | +1.3 tok/s over baseline (+2.7%). Well within measurement noise. Not a winner. |
| k3-mamba-cache-mode (serving.yaml `engine.mamba_cache_mode=all`) | 0.00 | — | NNN | Pydantic schema rejects the field (`ServingConfig` has `extra='forbid'`). Not reachable without a schema-extension design decision. |
| k4-reasoning-parser (serving.yaml `engine.reasoning_parser=qwen3`) | 0.00 | — | NNN | Same schema rejection as K3. |

Decision: **accept as architectural gap on GB10 + vLLM 0.17.1+nvinternal +
FP8 + MoE + hybrid-attention Qwen3.6.** Re-evaluate in Phase 2 once real
coding-workload throughput accumulates (the 48–50 tok/s microbench may or may
not matter when the bottleneck under harness use is prompt-processing or
tool-call roundtrips, not pure decode), and again post-vLLM-upgrade. The K3/K4
schema rejections are a separate, useful finding: extending the profile schema
to accept `mamba_cache_mode` or `reasoning_parser` is a design call, not a
microbenchmark knob.

Runtime-discovery notes (Task 2, 2026-04-21):
- `start_emmy.sh` + `render_docker_only_args` only forward 8 named envs from
  `serving.yaml.env` into `docker run -e`. The sweep script bypasses this by
  rendering docker args directly and injecting candidate env as `-e KEY=VAL`
  pairs (commit `aa0cde2`).
- Original K2 hypothesis (`CUDA_FORWARD_COMPATIBLE=0`) was empirically moot:
  `VLLM_ENABLE_CUDA_COMPATIBILITY` defaults False in this build, so the shim is
  already off at the vLLM layer. Replaced with the hybrid-KV-cache env above.
- Original K3 hypothesis (`VLLM_FP8_MAMBA_PREFIX_CACHING=1`) is not in the 232-
  entry `vllm.envs.environment_variables` registry. Replaced with the
  EngineArgs `mamba_cache_mode` knob (which the schema then rejected).

## Sampler gap: GPU clock — fix landed, re-validation deferred to Phase 5

Root cause identified 2026-04-21: `emmy_serve/thermal/sampler.py::GpuSampler._sample`
dropped any nvidia-smi row containing `[N/A]` in ANY field, including the DGX
Spark UMA's `[N/A]` for `memory.used`. Fix committed as `b510d1b` (Plan 01-07
Task 1): per-field parsing tolerates `[N/A]`/`N/A` per column, preserving valid
numeric fields while setting missing ones to `None`. 7 regression unit tests
pin the observed DGX Spark UMA row shape.

Re-validation (second `--record-floors` replay + third `--assert-floors` replay,
originally planned as 01-07 Tasks 2/3) is **deferred to Phase 5 (research-artifact
bar)**. Rationale: the decode-throughput floor (48.1 tok/s p50, 41.4 tok/s p1)
was recorded correctly in the 2026-04-21 run and is the floor `--assert-floors`
actually gates on. GPU-clock percentiles will be recorded during the next
natural thermal re-run (Phase 2 harness-workload replay or Phase 5
re-validation), not as a blocking Phase 1 task.

## Validation runs (D-16)

| Run ID | Date | Purpose | Profile hash |
|--------|------|---------|------|
| `20260421T062726Z_dc65a5-kv-finder` | 2026-04-21 | KV-bisection finder — 10 iterations, util 0.75→0.93 clean, 0.95 boot-timeout; final 0.88 via 5% safety | `sha256:87f70318eba717e86c548ba538c75bb85df32215c499c29c8250b30e6f048df7` |
| `20260421T092927Z_a1b62b-thermal` | 2026-04-21 | 2-hour thermal replay with `--record-floors` — zero preemptions, zero OOM; throughput floors recorded | `sha256:5a072c14e4ad3684cf5f145cad188b3b55a74c8704bfcb08d722529d202d30fd` |

## Deferred / future

- Spec decode (Phase 6); when enabled, bump to v2 with `speculative:` block and paired benchmark recorded here.
- `reasoning_parser` (Phase 2 will decide); if set, bump version.
- Per-tool sampling overrides (Phase 2 fills `harness.yaml.tools.per_tool_sampling`).

### KV-finder result (run 20260421T062726Z_dc65a5)

| Measurement | Value |
|---|---|
| `gpu_memory_utilization` (final) | 0.88 |
| First-preemption value | never observed (boot ceiling hit first) |
| Highest clean value | 0.93 |
| Iterations | 10 (of 12 max) |
| Iteration values walked | 0.75, 0.77, 0.79, 0.81, 0.83, 0.85, 0.87, 0.89, 0.91, 0.93 (step-up 2%) |
| Stop reason | Iteration 11 (value=0.95) `start_emmy.sh` boot-timeout at 300s — likely thermal-throttled cold-start, not preemption |
| Safety margin applied | 5.0% (`0.93 - 0.05 = 0.88`) |
| Hardware | DGX Spark (GB10 GPU) |
| vLLM image | `emmy-serve/vllm:26.03.post1-fst` (NGC 26.03.post1-py3 + fastsafetensors 0.1.14) |
| Run artifact | `runs/20260421T062726Z_dc65a5-kv-finder/iterations.jsonl` |
| Finder bug | Iteration 11's boot-timeout aborted the finder instead of classifying as "too-high → bisect down". Fixed in `fix(01-04): classify start_emmy boot-timeout as preemption-equivalent` commit. |

All 10 recorded iterations completed a 10-minute sustained-load drive with zero preemption and zero dmesg OOM hits, confirming `gpu_memory_utilization=0.88` is a conservative floor. The true ceiling is between 0.93 (last clean) and 0.95 (boot failure); the 5% safety margin absorbs both any preemption ceiling below 0.95 and thermal-throttle cold-start drift.

### Harness (Phase 2)

Phase 2 filled every Phase-2-deferred field in `harness.yaml`. Provenance for
every default value lives in the table below (PROFILE-05 discipline). The
computed `context.max_input_tokens` derivation and the nested
`tools.grammar.{path, mode}` shape both originated in CONTEXT D-11 and CONTEXT-05.

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `serving.engine.max_model_len` | 131072 | Qwen/Qwen3.6-35B-A3B-FP8 native window (128K; well under 262K YaRN) — honest per CONTEXT-05 + `.planning/research/STACK.md`. Qwen3.6 HF model card referenced in CONTEXT.md §source_excerpts. Value unchanged from v1. | 2026-04-21 |
| `context.max_input_tokens` | 114688 | `scripts/compute_max_input_tokens.ts` — `max_input_tokens = max_model_len(131072) - output_reserve_tokens(16384) = 114688` (measured_gpu_memory_utilization=0.88 from `measured_values` frontmatter above) | 2026-04-21 |
| `context.default_pruning` | `head_tail` | Phase 2 planner decision (CONTEXT.md Claude's Discretion — compaction policy not finalized until Phase 3 HARNESS-05) | 2026-04-21 |
| `prompts.edit_format` | `prompts/edit_format.md` | D-05..D-09 hash-anchored Hashline pattern. Usage examples + StaleHashError/HashResolutionError semantics. | 2026-04-21 |
| `prompts.tool_descriptions` | `prompts/tool_descriptions.md` | HARNESS-06 (<2000 char budget; actual 1786 chars). One section per native tool with args + usage norms. | 2026-04-21 |
| `prompts.prepend_system_text` | `""` | CONTEXT-04 locks layering order at runtime in `@emmy/ux/prompt-assembly.ts` (system.md → AGENTS.md → tool_defs → user). Profile-side prepend is therefore empty; any project-global text goes in `AGENTS.md` instead. | 2026-04-21 |
| `tools.format` | `openai` | vLLM 0.19 + `tool_call_parser: qwen3_coder` in serving.yaml emits OpenAI-compatible `tool_calls` after parsing. Confirmed in Plan 02-02 `@emmy/provider` wire tests. | 2026-04-21 |
| `tools.schemas` | `tool_schemas/` | 8 JSON files mirror `registerNativeTools` declarations in `packages/emmy-tools/src/native-tools.ts` (source of truth). | 2026-04-21 |
| `tools.grammar.path` | `grammars/tool_call.lark` | CONTEXT D-11 + vLLM 0.19 `extra_body.guided_decoding.grammar` seam + XGrammar Lark format ([vLLM guided_decoding docs](https://docs.vllm.ai/en/v0.19.0/features/structured_outputs/)). | 2026-04-21 |
| `tools.grammar.mode` | `reactive` | CONTEXT D-11 + CLAUDE.md Pitfall #6 ("grammar is a correctness backstop, not a quality lever"). `disabled` is reserved for the SC-3 no-grammar baseline (Plan 02-08, D-14). | 2026-04-21 |
| `tools.per_tool_sampling.edit.temperature` | 0.0 | CONTEXT.md §Claude's Discretion seed. Qwen team recommendation for structured-output / deterministic edit turns ([Qwen3.6 HF model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8)). | 2026-04-21 |
| `tools.per_tool_sampling.bash.temperature` | 0.0 | CONTEXT.md §Claude's Discretion seed. Qwen team recommendation for code-generation / command-emission turns. | 2026-04-21 |
| `tools.per_tool_sampling.read.temperature` | 0.0 | Emmy project decision — a file-read turn is deterministic, no sampling needed. | 2026-04-21 |
| `agent_loop.max_iterations` | 25 | Unchanged from v1. Tuned on daily-driver observation in Phase 2; revisit at Phase 5 eval. | 2026-04-21 |
| `agent_loop.retry_on_unparseable_tool_call` | 2 | Unchanged from v1. Paired with SC-3 parse-rate gate (Plan 08). D-11 reactive-grammar retry budget. | 2026-04-21 |
| `agent_loop.retry_on_empty_response` | 1 | Unchanged from v1. One retry before surfacing as possible SP-delivery failure (Pitfall #6). | 2026-04-21 |
| `agent_loop.self_correction` | `enabled` | Unchanged from v1. ReAct-style self-correction on parseable tool errors. | 2026-04-21 |
| `advanced_settings_whitelist` | `[reasoning_effort, thinking_budget]` | [Aider model settings guide](https://aider.chat/docs/config/adv-model-settings.html) — Aider allowlist pattern for Qwen-family advanced settings. Only fields that can be set per call without engine restart. | 2026-04-21 |

### Phase-1 schema patch (Phase-2 D-11 discovery)

During Phase 2 planning the checker surfaced that the Phase-1 `HarnessConfig.tools.grammar` model was a bare string, while the Phase-2 CONTEXT D-11 lock requires `{path, mode}`. A dated schema patch landed in `emmy_serve/profile/schema.py` via commit `feat(phase-01-schema-patch): allow nested tools.grammar.{path,mode}; resolves Phase-2 D-11 discovery` (SHA recorded in Plan 02-09 CLOSEOUT.md addendum). Phase 1 unit tests stayed green after the patch (137 pass / 1 skip — unchanged from baseline); v1's `grammar: null` still validates (nested/None is backward-compatible with Optional[str] → Optional[GrammarConfig]).

### Phase 2 validation_runs

Plan 02-08 shipped evidence for SC-2, SC-3, SC-4, SC-5 (SC-1 is the Plan 02-09 human-verify walkthrough). Every artifact carries `started_at`/`ended_at` and the profile ref embedding `{id, version, hash}`. The frontmatter `validation_runs:` list above is the canonical index; the table below is the human-readable companion.

| Run ID | Artifact | SHA-256 |
|--------|----------|---------|
| phase2-sc2 | `runs/phase2-sc2/report.json` | sha256:e26ed4011db54a3bb9251e719bf5a3a299884dd6cfca79edbf9c0fa64cd495b6 |
| phase2-sc3-reactive | `runs/phase2-sc3/report.json` | sha256:af3296773dcdb8eed6ffa5da391969425761a06174abeae01f8b0979c3f7756e |
| phase2-sc3-disabled | `runs/phase2-sc3/baseline.json` | sha256:66493495f30e7a2fe99a8b0667a5d353f79717a32cea9405de5e3b5ee710d279 |
| phase2-sc3-no_per_tool_sampling | `runs/phase2-sc3/no_per_tool_sampling.json` | sha256:e7318075d84be772b8fac6ac51cd0ab969ba37ee2e2f0c98a7f82fca3eb2839b |
| phase2-sc4 | `runs/phase2-sc4/report.json` | sha256:e0deaeea6299a7752d01a75e62375a182890d1a4c5922a32f47eecd7f601d0a1 |
| phase2-sc5 | `runs/phase2-sc5/report.json` | sha256:f7ae94a0370191d22ba1b9b84ea3b40c634cc26651f42018b20fc31f067e5f35 |

**Key findings from Plan 02-08:**

- **SC-3 (grammar reactivity pays off even when never needed):** Qwen3.6-35B-A3B-FP8 emits parseable tool-call arguments on 300/300 first-try attempts across all three variants. The reactive-grammar retry path fired 0 times — confirming D-11's design thesis: grammar is a correctness backstop, not a quality lever. The zero-cost baseline is genuine.
- **SC-3 W3 / Pitfall #5 finding (per_tool_sampling):** removing `tools.per_tool_sampling` from harness.yaml produced IDENTICAL parse-rate (100%) on the same 100-call corpus. In Phase 2's single-turn wire-shape corpus, the per-tool-sampling knobs are unobservable — their effect manifests on tool-specific turns during multi-turn agent-loop sessions (Phase 5 eval territory). Phase 2 keeps the knobs because they cost nothing and document intent.
- **SC-2 (Hashline win):** 0 hash-anchored failures vs 1 baseline failure on sc2_05 (near-duplicate line disambiguation). This is the canonical Hashline regression-solving case.
- **SC-4 (MCP + poison):** In-process fs-server registered 2 tools (`fs_read_file`, `fs_list_dir`) with flat names, both dispatched successfully. All 4 Unicode poison categories (Cf U+200B, Co U+E000, Cs U+D800, bidi U+202E) rejected via PoisonError with the codepoint in hex, while a clean companion tool still registered in the same loop. D-18 blocklist wiring confirmed.
- **SC-5:** prompt.sha256 byte-stable across 3 runs (unique_count=1), AGENTS.md verbatim included (tokens_approx=125 for a 500-byte canonical fixture), max_input_tokens committed=114688=computed (CONTEXT-05 consistency gate GREEN).

## Phase 3 (Observability + Compaction + Lived-Experience)

v3 is a sibling of v2 per Phase 1 D-02 immutability contract: v2 stays
byte-identical at `sha256:24be3eea...85d8b`; v3 is a copy plus two new
per-profile policy blocks. Provenance for every new default:

### context.compaction (D-11..D-17)

| Field | Value | Source |
|-------|-------|--------|
| `soft_threshold_pct` | `0.75` | Industry convergence (Claude Code / Cursor / Cline) for LLM-summarization compaction. Crosses at ~86K of 114K max_input_tokens. |
| `preserve_recent_turns` | `5` | pi 0.68 `DEFAULT_COMPACTION_SETTINGS.keepRecentTokens=20000` ≈ 5 turns at 4K avg. Matches pi's authored default so the emmy preservation layer composes with pi's upstream default without conflict. |
| `summarization_prompt_path` | `prompts/compact.md` | Emmy-authored, ~20 lines. Layers on top of pi's built-in `SUMMARIZATION_SYSTEM_PROMPT` via the `customInstructions` arg of pi's compact() surface (Rule-3 Plan 03-03: emmy's `EmmyCompactionPreparation` + `prepareCompactionLocal()` match the plan shape verbatim since pi's top-level exports are narrower than the plan's `<interfaces>` block assumed). |
| `preserve_tool_results` | `error_only` | Pitfall #15 guardrail — stacktraces and error output carry the actual error signal; truncating them is exactly the wrong thing. `error_only` preserves error-flagged results verbatim (pi 0.68 convention: `isError === true` OR heuristic stacktrace-regex match) while allowing normal tool-call results to be summarized into the compaction summary. |

### tools.web_fetch.allowlist (D-26..D-28)

Default-deny. Hostname-EXACT matching (no suffix match; `docs.python.org.evil.com` blocked when only `docs.python.org` is allowlisted). Per D-27 runtime enforcement via `packages/emmy-tools/src/web-fetch-allowlist.ts` (Plan 03-06). Per D-28 warn-and-continue on allowlist miss (returns `WebFetchToolErrorResult` rather than throwing).

v3 initial allowlist — five documentation hosts, source: CLAUDE.md "web_fetch … documentation reading allowed" + author daily-driver usage pattern:

- `docs.python.org` — Python language + stdlib reference
- `developer.mozilla.org` — Web platform API reference (MDN)
- `docs.vllm.ai` — vLLM engine arg + metrics + recipes reference
- `huggingface.co` — HF model cards + dataset loaders (non-inference)
- `docs.langfuse.com` — Langfuse v3 self-hosting + OTLP ingestion reference

Loopback hosts (`127.0.0.1`, `localhost`, `::1`, `loopback`) are always allowed implicitly; the bind-all quad-zero `0.0.0.0` (INADDR_ANY) is NOT a loopback per the D-26 LOOPBACK_HOSTS.size === 4 invariant (Plan 03-06 plan-checker WARNING guard).

### Validation runs — Phase 3 (full suite ordered by plan)

| Plan | Wave | Purpose | Evidence |
|------|------|---------|----------|
| 03-01 | 1 | SC-1-class Track B wire-through walkthrough (5 wire-throughs atomic wave); 7/7 acceptance criteria green; 6 distinct tools invoked; 0 `<think>` leaks; hash-anchored edit held on real in-place fix | `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/` |
| 03-02 | 2 | Langfuse OTel dual-sink (JSONL authoritative + OTLP best-effort); 6 OTel SDK deps exact-pinned; 6-service compose stack digest-pinned; cases (ii) + (iii) live-verified; case (i) operator-gated | `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w2-walkthrough/` |
| 03-03 | 2 | SC-2 stub-mode compaction matrix; fixture sha256:`26149bfce4...a0a19b` stable; 3 variants (default/alternate/disabled) verdict=pass on stub | `runs/phase3-sc2/`, `runs/phase3-sc2-stub-alternate/`, `runs/phase3-sc2-stub-disabled/` |
| 03-04 | 3 | UX-02 footer parity live-verified on DGX Spark; 3/3 GPU% snapshots within 5% tolerance; KV% degrades correctly when vLLM 0.19 omits `vllm:gpu_cache_usage_perc` at rest | `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w3-walkthrough/03-04-footer-parity.md` |
| 03-05 | 3 | TELEM-02 + TELEM-03 13-field feedback schema + idempotent upsert + `--export-hf` roundtrip (HF-datasets loadable); operator interactive-TUI demo gated | (programmatic tests; interactive operator-gated) |
| 03-06 | 3 | UX-03 OFFLINE OK badge — boot banner live-verified on DGX Spark (green ANSI); web_fetch allowlist enforcement unit-proven (43 new tests); D-26 LOOPBACK_HOSTS.size === 4 asserted | `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w3-walkthrough/03-06-badge.md` + `03-06-boot-banner.log` |
| 03-07 | 4 | Phase 3 CLOSEOUT — v3 profile bump with context.compaction + tools.web_fetch.allowlist; schema patch for new blocks (backward-compat via Optional); air-gap CI extension scaffolded; 8 Phase-3 REQ-IDs + 5 Phase-2 Done† → Done | (this file + 03-07-SUMMARY.md + 03-CLOSEOUT.md) |

### v3 profile hash

`sha256:bc2286957a2b4ff95b60bca25d71c9d762d7c4d8c2bb72bc8460ffdbeeb5b0a9` — computed via `uv run emmy profile hash --write profiles/qwen3.6-35b-a3b/v3/` at Plan 03-07 Task 1 close. Re-recomputed after `prompts/compact.alternate.md` lands in Task 1a (new file in bundle → content hash changes).

## Validation Runs — Phase 3 SC-2 3-Run Matrix (Pitfall #5 guardrail)

Filled in by Plan 03-07 Task 3 Step 10 (SC-2 live gate). All three variants run against the v3 profile with the deterministic 200-turn fixture (sha256 `26149bfce4...a0a19b` — locked at Plan 03-03). Verdicts recorded here before REQ-ID flip in Task 4.

| Variant | Command | Verdict | Invariants (5/5) | Session ID | Date |
|---------|---------|---------|------------------|------------|------|
| default | `bash scripts/sc2_200turn_compaction.sh --mode=stub --variant=default` | pass (stub) | 5/5 green (goal + last-5 + error-verbatim + @file pins + compaction.complete) | runs/phase3-sc2/ | 2026-04-22 |
| alternate | `bash scripts/sc2_200turn_compaction.sh --mode=stub --variant=alternate` | pass (stub) | 5/5 green | runs/phase3-sc2-stub-alternate/ | 2026-04-22 |
| disabled | `bash scripts/sc2_200turn_compaction.sh --mode=stub --variant=disabled` | pass (stub, Observation per Plan 03-03 SUMMARY: fixture ~35K tokens at end ≪ D-12 ceiling 114688, so disabled variant's acceptance condition is `!ran && !d12Thrown`, NOT hard-ceiling throw — the live variant in Plan 03-07 with a larger synthetic workload would exercise the true D-12 path) | n/a (variant-specific: expects `{ran: false}` not compaction.complete) | runs/phase3-sc2-stub-disabled/ | 2026-04-22 |

**Live-mode matrix (--mode=live) — deferred to operator time window.** Requires ~2 hours of GPU + the `engine.summarize()` → live emmy-serve via `@emmy/provider.postChat` wiring that Plan 03-03's stub-mode runner does not exercise. The stub-mode 3-variant matrix above validates the wire-path integrity + invariant coverage of the runner itself; the live matrix is an acceptance lever deferred to Phase 4 or a focused Phase 3 follow-up run. See 03-CLOSEOUT.md § Carry-forward for the deferral record.

**Acceptance per Pitfall #5 (stub-mode gate):** All three variants run against the IDENTICAL fixture (fixture_hash invariant held across variants — proves prompt-change deltas are not confused with fixture-change deltas). The 5-invariant preservation contract passes on default + alternate; the disabled variant's `{ran: false}` outcome is honest documentation of the sub-ceiling fixture scale, not a silent fallthrough.

## Phase 3.1 — Operational Polish (D-29, D-30, D-31, D-32)

v3.1 is a sibling of v3 per Phase 1 D-02 immutability. v3 stays byte-identical
at `sha256:2beb99c773a0e425a3e485459964740640c5f3addbea186738402cf66d4d3718`;
v3.1 is a clone of v3's bundle with two `serving.yaml` fields retuned (D-29)
and a new Phase-3.1 provenance section (this one). `harness.yaml` is
byte-identical to v3 in Plan 03.1-01; Plan 03.1-02 extends it with the
`tools.web_search` block + `tools.web_fetch.search_bypass_ttl_ms` field.

### D-29 — RAM headroom (CLAUDE.md Pitfall #3)

| Field | v3 value | v3.1 value | Source |
|-------|----------|------------|--------|
| `gpu_memory_utilization` | `0.88` | `0.55` | D-29 user lock — Phase 1 KV-finder optimized for "no preempt" but didn't account for OS-side RAM headroom on DGX Spark's 128 GB UMA pool. 0.55 targets emmy-serve footprint ~50-70 GB leaving >40 GB system free. |
| `max_num_batched_tokens` | `16384` | `8192` | D-29 — reduces CUDA workspace footprint; still above the STACK.md "interactive latency" threshold. |
| `max_model_len` | `131072` | `131072` (UNCHANGED) | D-29 user constraint — do NOT reduce model capability. |

### D-30 — Live compaction wire-through

v3 shipped `emmyCompactionTrigger` on `pi.on("turn_start", ...)` (Phase 3 Plan 03-03) with D-11 soft-threshold + D-12 hard-ceiling + D-14 preservation + D-16 fallback. The `engine.summarize()` injection point defaulted to "not configured" throw — live compaction never fired in real sessions. Plan 03.1-01 wires the turn_start handler to invoke pi 0.68's native `ctx.compact({customInstructions})` method (`dist/core/extensions/types.d.ts:224`) when the trigger returns `directive.shouldCompact=true`. The preservation classifier runs BEFORE `ctx.compact` to build the D-14 preservation-annotated `customInstructions`; pi's native compaction engine uses the same active Model (emmy-vllm endpoint), so no new HTTP boundary is introduced.

### D-31 — `/compact` slash command

Registered via `pi.registerCommand("compact", {handler})` in `packages/emmy-ux/src/pi-emmy-extension.ts`. Handler: `async (args, ctx) => ctx.compact({customInstructions: buildCompactInstructions(profile.compactPromptText, args)})`. User-supplied args are ADDENDUMS to the profile-defined `prompts/compact.md` (D-31 locked addendum semantics); the preservation policy from the profile always applies regardless of user args.

### D-32 — `/clear` slash command

Registered via `pi.registerCommand("clear", {handler})`. Handler ordering (Claude's Discretion pin):
1. `ctx.hasUI` check — non-interactive mode: `ctx.ui.notify` with hint, return early (no `newSession` called)
2. `ctx.ui.confirm("Clear session", "This will start a fresh session. …")` — cancel → return
3. `ctx.abort()` — stop any in-flight turn
4. `await ctx.waitForIdle()` — wait for abort to drain
5. `await ctx.newSession({})` — create fresh AgentSession

SP_OK canary re-fires on the new session because pi's `newSession()` triggers a fresh boot-hook sequence (Pitfall #6 preserved).

### Validation Runs — Phase 3.1

| Run ID | Date | Purpose | Evidence |
|--------|------|---------|----------|
| phase3.1-01-walkthrough | pending | Plan 03.1-01 operator walkthrough — D-29 RAM (`free -h` ≥ 40G) + D-30 live compaction + D-31 `/compact` + D-32 `/clear` | `runs/phase3.1-01/walkthrough.md` (appended by Task 3) |


