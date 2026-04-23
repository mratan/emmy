# Phase 4: Gemma 4 Profile + Profile System Maturity — Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** ~42 new/modified (profile bundle, Python swap primitive, TS slash command, TS routes resolver, TS progress UX, TS OTel stamp extension, tests, docs, walkthrough evidence)
**Analogs found:** 42 / 42 — every new file has at least a role-match analog in the existing codebase (this is no longer Phase 1 greenfield — three phases of shipped code cover the patterns).

---

## Executive summary

Phase 4 is entirely **additive** on top of Phase 1–3.1 substrate. There is no greenfield territory; every file maps to a concrete shipped analog. Three dominant patterns carry the load:

1. **Profile bundle shape is frozen** — the Gemma 4 `v1/` directory is a byte-for-byte parallel of `profiles/qwen3.6-35b-a3b/v1/` (same 5 files + 3 subdirs + schema accepts verbatim). Sibling variant dirs (`v3.1-default`, `v3.1-reason`, `v3.1-precise`) reuse the same bundle shape with byte-identical `serving.yaml.engine.*` and divergent `harness.yaml.{sampling_defaults,tools.per_tool_sampling,prompts}`.

2. **Python-side swap primitive extends `emmy_serve.boot.runner`** — it reuses `render_image_ref`, `render_docker_args`, `wait_for_vllm`, and `scripts/smoke_test.py` verbatim. The new module `emmy_serve/swap/orchestrator.py` only adds (a) the 4-phase progress event stream on stdout, (b) the pre-flight validation sequence, (c) the rollback-via-same-primitive recursion flag. Exit codes 0–4 match `start_emmy.sh` already; codes 5 + 6 are new (`swap pre-flight failed` / `post-stop failure + rollback`).

3. **TS-side UX extension piggybacks on pi 0.68 ExtensionAPI** — `/profile` slash command registration is a direct copy of `registerClearCommand(pi)` from `slash-commands.ts` with a different handler body; progress UX reuses the `ctx.ui.setStatus` channel already wired for `emmy.footer` (Plan 03-04), just under a different key `emmy.swap`. `EmmyProfileStampProcessor` grows two optional attributes (`emmy.profile.variant` + `emmy.role`) with zero existing-span regression.

Two genuinely-new surfaces have no prior in-repo analog:
- **`routes.yaml` parser + variant resolver** — no existing TS code reads a top-level YAML outside a profile bundle. Closest analog is `profile-loader.ts`'s `js-yaml` + shell-out-to-hash pattern.
- **No-model-conditionals audit test** — no existing grep-based pattern test ships today. Closest analog is the `tests/unit/test_schema.py` + `tests/unit/test_hasher.py` skeleton for the Python side; `packages/emmy-telemetry/test/span-attributes.test.ts` for the TS side. This is a **new pattern's first instance**; the planner documents it so future phases know the shape.

---

## File Classification

Grouped by RESEARCH.md §"Ready for Planning" boundaries (six plan buckets).

### Bucket A — Gemma 4 profile v1 bundle (SERVE-03, PROFILE-07)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `profiles/gemma-4-26b-a4b-it/v1/profile.yaml` | config (manifest) | static | `profiles/qwen3.6-35b-a3b/v1/profile.yaml` | exact (schema) |
| `profiles/gemma-4-26b-a4b-it/v1/serving.yaml` | config | static | `profiles/qwen3.6-35b-a3b/v1/serving.yaml` | exact (schema) — values differ |
| `profiles/gemma-4-26b-a4b-it/v1/harness.yaml` | config | static | `profiles/qwen3.6-35b-a3b/v1/harness.yaml` | exact (schema) — values differ |
| `profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md` | doc (citation table + measured floors) | static | `profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md` (current citation discipline leader) | exact (shape) |
| `profiles/gemma-4-26b-a4b-it/v1/prompts/system.md` | prompt fixture | static | `profiles/qwen3.6-35b-a3b/v1/prompts/system.md` (SP_OK canary line) | exact |
| `profiles/gemma-4-26b-a4b-it/v1/prompts/edit_format.md` | prompt fixture | static | `profiles/qwen3.6-35b-a3b/v3.1/prompts/edit_format.md` | exact (Hashline protocol) |
| `profiles/gemma-4-26b-a4b-it/v1/prompts/tool_descriptions.md` | prompt fixture | static | `profiles/qwen3.6-35b-a3b/v3.1/prompts/tool_descriptions.md` | exact (8 native tools) |
| `profiles/gemma-4-26b-a4b-it/v1/prompts/compact.md` | prompt fixture | static | `profiles/qwen3.6-35b-a3b/v3.1/prompts/compact.md` | exact (D-13 compaction prompt) |
| `profiles/gemma-4-26b-a4b-it/v1/tool_schemas/*.schema.json` (×9) | config (JSON schema) | static | `profiles/qwen3.6-35b-a3b/v3.1/tool_schemas/*.schema.json` | exact (1:1 per native tool) |
| `profiles/gemma-4-26b-a4b-it/v1/grammars/tool_call.lark` | config (Lark) | static | `profiles/qwen3.6-35b-a3b/v3.1/grammars/tool_call.lark` | role-match (Gemma 4 format differs from Qwen's XML — grammar rewritten for `<|tool_call>call:NAME{k:<|"|>v<|"|>}<tool_call|>`) |

### Bucket B — Python swap primitive (PROFILE-08 serving side)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `emmy_serve/swap/__init__.py` | package init | static | `emmy_serve/boot/__init__.py` | exact |
| `emmy_serve/swap/orchestrator.py` | orchestrator | subprocess, event-driven (progress stdout) | `scripts/start_emmy.sh` (stop→rm→run→probe→smoke shape) + `emmy_serve/boot/runner.py` (argparse subcommand skeleton) + `scripts/smoke_test.py` (D-06 bundle on failure) | exact shape (composite) |
| `emmy_serve/swap/preflight.py` | validator | file-I/O | `emmy_serve/profile/immutability.py` (layered pre-flight validator) + `emmy_serve/profile/hasher.py` (content-hash check) | role-match |
| `emmy_serve/swap/progress.py` | event emitter | event-driven (JSON lines on stdout) | `emmy_serve/canary/logging.py` (atomic JSONL append) — shape only; progress writes to stdout, not a file | role-match |
| `emmy_serve/swap/rollback.py` | recursive driver | subprocess | `emmy_serve/kv_finder/bisect.py` (iterative driver invoking `start_emmy.sh`) | role-match (single-shot instead of iterative) |
| Extension to `emmy_serve/cli.py` | CLI entrypoint | request-response | existing `_cmd_profile_validate` / `_cmd_profile_hash` in `emmy_serve/cli.py` | exact (argparse subcommand add) |

### Bucket C — TS-side `/profile` slash command + progress UX (PROFILE-08 harness side, UX-04)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| Extension to `packages/emmy-ux/src/slash-commands.ts` (add `registerProfileCommand`) | slash-command registrar | event-driven | existing `registerClearCommand` + `registerCompactCommand` in same file | exact |
| `packages/emmy-ux/src/profile-swap-runner.ts` | subprocess driver + progress parser | streaming, subprocess | `packages/emmy-ux/src/profile-loader.ts` (shells out to `uv run emmy profile hash`) — pattern for invoking Python CLI + parsing structured stdout | role-match (child process stream vs. one-shot execFileSync) |
| `packages/emmy-ux/src/profile-index.ts` | filesystem scanner + autocompletion | file-I/O | `packages/emmy-ux/src/profile-loader.ts` (existsSync + walk + parse) | role-match |
| Extension to `packages/emmy-ux/src/pi-emmy-extension.ts` (register `/profile` + hot-swap harness state) | ExtensionFactory augmentation | event-driven | existing `createEmmyExtension` factory calling `registerClearCommand(pi)` at line 398 | exact (add one more registration + add hot-swap helper) |
| `packages/emmy-ux/src/harness-swap.ts` (hot-swap helper: new ProfileSnapshot + new EmmyProfileStampProcessor + web_fetch re-audit) | state invalidator | transform | D-23 references `profile-loader.ts`, `web-fetch-allowlist.ts`, `EmmyProfileStampProcessor` — no single analog; composes three existing modules | role-match (composition) |
| Extension to `packages/emmy-ux/src/footer.ts` OR new `packages/emmy-ux/src/swap-progress.ts` | UX renderer | transform | existing `formatFooter(v)` in `footer.ts` | role-match (new pure formatter for swap_state) |

### Bucket D — routes.yaml + variant resolver (HARNESS-08)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `profiles/routes.yaml` | config (top-level) | static | None in-repo (first top-level config outside a bundle). Shape cited in RESEARCH.md §4.1 (LiteLLM-shaped) | prescribed (no analog) |
| `packages/emmy-ux/src/routes-loader.ts` | YAML parser + resolver | file-I/O, transform | `packages/emmy-ux/src/profile-loader.ts` (js-yaml + requireStr/requireNum pattern) | role-match |
| `packages/emmy-provider/src/variant-resolver.ts` (turn-role → variant-path lookup) | resolver | transform | `packages/emmy-provider/src/before-request-hook.ts` (reads profile + retryState, mutates payload) | role-match |
| Extension to `packages/emmy-provider/src/before-request-hook.ts` (apply variant sampling/prompts/per_tool when `turn.role` set) | payload mutator | transform | existing hook in same file (lines 58–98) | exact |
| Extension to `packages/emmy-provider/src/types.ts` (add `turn.role?` + `ProfileVariantSnapshot`) | type declaration | static | existing `ProfileSnapshot` definition | exact |
| Extension to `packages/emmy-ux/src/pi-emmy-extension.ts` (set `turn.role` envelope field per heuristic at `before_provider_request`) | event handler | event-driven | existing `pi.on("before_provider_request", ...)` block (lines 238–281) | exact |
| Three sibling Qwen variant bundles `profiles/qwen3.6-35b-a3b/v3.1-default/` + `.../v3.1-reason/` + `.../v3.1-precise/` | config bundles | static | `profiles/qwen3.6-35b-a3b/v3.1/` (base) — variant diffs differ only in `harness.yaml.{sampling_defaults,tools.per_tool_sampling,prompts}` | exact (sibling shape) |

### Bucket E — OTel attribute extension (HARNESS-08 / D-12)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| Extension to `packages/emmy-telemetry/src/profile-stamp-processor.ts` (add `variant?`, `variantHash?`, `role?` fields + per-turn snapshot getter) | SpanProcessor extension | event-driven (onStart) | existing `EmmyProfileStampProcessor` (same file) | exact (field addition, no structural change) |
| `packages/emmy-telemetry/src/turn-role-context.ts` (module-level per-turn `{variant, role}` set by before-request hook, read by processor) | module-level state | transform | `packages/emmy-telemetry/src/session-context.ts` (existing module-level `_ctx` with `configureTelemetry` setter) | exact (pattern copy) |

### Bucket F — Tests (Wave 0 scaffolds + GREEN assertions)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `tests/unit/test_profile_schema_gemma4.py` | unit test | request-response | `tests/unit/test_schema.py` + `tests/unit/test_profile_schema_v3_1.py` | exact |
| `tests/unit/test_swap_preflight_fail.py` | unit test (monkeypatch subprocess) | transform | `tests/unit/test_docker_run_build.py` (monkeypatched docker) + `tests/unit/test_immutability.py` (pre-flight pattern) | role-match |
| `tests/unit/test_swap_rollback.py` | unit test | transform | same as above | role-match |
| `tests/unit/test_variant_engine_byte_identity.py` | unit test (file diff) | file-I/O | `tests/unit/test_profile_layout.py` (per-bundle file checks) | role-match |
| `tests/unit/test_no_model_conditionals.py` | unit test (grep over source tree) | file-I/O, transform | **no existing analog — new pattern first instance**. Closest shape: `tests/unit/test_profile_notes.py` (scans YAML frontmatter across profile dirs) | no analog |
| `tests/fixtures/no_model_conditionals_positive.py` | fixture (deliberate positive) | static | `tests/fixtures/airgap_green.json` / `tests/fixtures/airgap_red_layer_a.json` (deliberate-positive fixture pattern) | role-match |
| `packages/emmy-ux/test/profile-command.test.ts` | unit test (spy on pi.registerCommand) | request-response | `packages/emmy-ux/test/slash-commands.test.ts` (spies on `pi.registerCommand` for `/compact` + `/clear`) | exact |
| `packages/emmy-ux/test/profile-command.integration.test.ts` | integration test | request-response | `packages/emmy-ux/test/slash-commands.integration.test.ts` (createEmmyExtension wiring) | exact |
| `packages/emmy-ux/test/routes-resolver.test.ts` | unit test | transform | `packages/emmy-ux/tests/profile-loader.test.ts` (YAML parse + resolve assertions) | role-match |
| `packages/emmy-ux/test/progress-phases.test.ts` | integration test (streaming stdout parse) | streaming | `packages/emmy-ux/test/metrics-poller.test.ts` (poller + setStatus assertion) | role-match |
| `packages/emmy-ux/test/swap-error-ui.test.ts` | integration test | transform | `packages/emmy-ux/test/offline-badge-3state.test.ts` (error state → ctx.ui.notify) | role-match |
| `packages/emmy-provider/test/variant-sampling.test.ts` | unit test | transform | `packages/emmy-provider/src/hook.test.ts` (payload mutation assertions on before-request hook) | exact |
| `packages/emmy-telemetry/test/variant-stamp.test.ts` | unit test | event-driven | `packages/emmy-telemetry/test/span-attributes.test.ts` (InMemorySpanExporter round-trip) | exact |
| `packages/emmy-telemetry/test/variant-stamp-absent.test.ts` | unit test (backwards-compat) | event-driven | same as above | exact |
| `tests/unit/no-model-conditionals.test.ts` | unit test (TS grep) | file-I/O, transform | **no existing analog — new pattern first instance**. Closest shape: `packages/emmy-ux/test/profile-loader-no-telemetry.test.ts` (walks source files, asserts property) | no analog |

### Bucket G — Operator-gated + SC walkthroughs + docs

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `runs/phase4-sc1/walkthrough.md` + `transcript.json` | evidence | static | `runs/phase2-sc1/walkthrough.md` + `.planning/phases/03-observability.../runs/p3-w1-walkthrough/walkthrough.md` | exact |
| `runs/phase4-sc3/report.json` | evidence | static | `runs/phase3-sc2/report.json` (variant matrix artifact shape) | exact |
| `runs/phase4-sc4/walkthrough.md` | evidence | static | same as SC-1 walkthrough | exact |
| (No new operator scripts — `scripts/find_kv_budget.py` + `scripts/thermal_replay.py` reused verbatim; operator-gated deferrals per Phase 1 D-15 pattern) | - | - | Phase 1 SC-1 / SC-5 deferrals in `01-CLOSEOUT.md` | exact (resume-signal pattern) |
| Extension to `docs/runbook.md` (new §"Swapping profiles" + §"Within-model role routing") | doc | static | existing `docs/runbook.md` §"Common error messages" (table + code-fence shape) | exact |
| Extension to `README.md` (mention two profiles + `/profile` swap) | doc | static | existing `README.md` profile/quickstart section | exact |
| Extension to `.planning/STATE.md` + `.planning/ROADMAP.md` + `.planning/REQUIREMENTS.md` (flip SERVE-03 / PROFILE-07 / PROFILE-08 / HARNESS-08 / UX-04 to Done) | doc | static | existing pattern from Phase 3 CLOSEOUT.md (REQ-ID promotion table) | exact |

---

## Pattern Assignments

### 1. `profiles/gemma-4-26b-a4b-it/v1/profile.yaml` (config manifest)

**Analog:** `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v1/profile.yaml` (full file, 18 lines — no need to Read; schema-locked)

**Pattern (shape only — values must differ):**

```yaml
profile:
  id: gemma-4-26b-a4b-it           # MUST match directory name stem
  version: v1                       # parallel to Qwen v1
  family: gemma-4                   # new family
  base_model: google/gemma-4-26B-A4B-it
  description: "Gemma 4 26B A4B MoE primary coding profile, Phase 4 v1 bundle (D-13..D-18)"
  created: '2026-04-23'
  hash: sha256:<compute via `uv run emmy profile hash --write`>
  hash_algorithm: sha256
  hash_manifest_version: 1
  tags: [coding, dgx-spark, fp8, gemma-4, phase-4]
  community_sources:               # SC-5 citation discipline — every non-default knob
    - title: Google Gemma 4 model card
      url: https://ai.google.dev/gemma/docs/core/model_card_4
      retrieved: '2026-04-23'
    - title: Gemma 4 function calling (native format)
      url: https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4
      retrieved: '2026-04-23'
    # ... at least 4 more per PROFILE_NOTES.md research hits
```

**Divergences from analog:**
- `family: gemma-4` (Qwen is `qwen3.6`)
- `base_model: google/gemma-4-26B-A4B-it` (not HF_ID with `-FP8` suffix — FP8 is RUNTIME quant via `--quantization fp8`, not baked into weights name; STACK.md line 122 / D-13)
- `community_sources` list MUST be ≥4 entries (SC-5 discipline tightens for Gemma 4 because parser choice, chat template, sampling, and KV seed all need independent citations — RESEARCH.md §2.3 table)

**Integration points:** consumed by `emmy_serve.profile.loader.load_profile_manifest` + `packages/emmy-ux/src/profile-loader.ts`.

---

### 2. `profiles/gemma-4-26b-a4b-it/v1/serving.yaml` (vLLM engine config)

**Analog:** `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v3.1/serving.yaml` (most current — v1 Qwen pre-dates KV bisection + Phase 3.1 RAM tuning)

**Engine pattern (shape — Gemma 4 values from RESEARCH.md §§1–2):**

```yaml
engine:
  model: /models/gemma-4-26B-A4B-it            # container-internal path
  model_hf_id: google/gemma-4-26B-A4B-it
  served_model_name: gemma-4-26b-a4b-it
  container_image: emmy-serve/vllm:26.03.post1-fst       # SAME image as Qwen (D-14)
  container_image_digest: sha256:77321e416cf49702ed6f04af9e5d39945726fea48970bb013617fddc659f9486  # SAME digest as Qwen v3.1 — digest not upgraded in Phase 4
  max_model_len: 131072                         # 128K; starting point, may reduce if KV finder shows need
  gpu_memory_utilization: 0.55                  # STARTING seed per RESEARCH §1 bullet 4; operator-gated KV finder bisects up from here (D-15)
  kv_cache_dtype: fp8
  enable_prefix_caching: true
  enable_chunked_prefill: true
  max_num_batched_tokens: 8192                  # Symmetric with Qwen v3.1 (D-29 RAM headroom)
  load_format: fastsafetensors                  # SERVE-10 — unchanged
  quantization: fp8                             # RUNTIME quant (Gemma 4 HF weights are BF16)
  tool_call_parser: gemma4                      # D-17 RESOLVED — RESEARCH §2.1; native parser; bugs #39392/#39468 documented in PROFILE_NOTES.md
  enable_auto_tool_choice: true
  attention_backend: flashinfer                  # SAME as Qwen (GB10 requirement)
  host: 0.0.0.0
  port: 8000

sampling_defaults:
  temperature: 1.0                              # Google-team default; T=1.5 flagged as Phase-5 eval candidate
  top_p: 0.95
  top_k: 64                                     # Gemma 4 card; Qwen uses 40
  repetition_penalty: 1.0                       # NOT set in Gemma 4 card (vs 1.05 for Qwen)
  max_tokens: 8192
  stop: []

speculative: null                                # Phase 6 (EAGLE-3 availability TBD)
guided_decoding:
  default_backend: xgrammar

quirks:
  strip_thinking_tags: false                    # gemma4 reasoning_parser strips; we don't re-strip
  promote_reasoning_to_content: false
  buffer_tool_streams: false                    # gemma4 parser streams natively

env:
  VLLM_NO_USAGE_STATS: "1"                      # D-12 layer c (enforced by schema._airgap_policy)
  DO_NOT_TRACK: "1"
  VLLM_LOAD_FORMAT: fastsafetensors
  VLLM_FLASHINFER_MOE_BACKEND: latency
  VLLM_DISABLE_COMPILE_CACHE: "1"
  HF_HUB_OFFLINE: "1"                           # REPRO-04 (enforced by schema._airgap_policy)
  TRANSFORMERS_OFFLINE: "1"
```

**Divergences from analog:**
- `tool_call_parser: gemma4` (not `qwen3_coder`) — parser choice is the sole model-shaped knob; schema already accepts any string (`schema.py:71`), no schema change needed
- `reasoning_parser: gemma4` NEW FIELD — if schema doesn't accept yet (current schema `reasoning_parser` is absent), add as Optional to `EngineConfig` in Wave 0
- Sampling differs — cite EVERY divergence in PROFILE_NOTES.md (SC-5)
- NO `--moe-backend marlin` (NVFP4-only; we're FP8)
- `chat_template_kwargs.enable_thinking=false` is injected at REQUEST time via `before_provider_request` hook (not in serving.yaml) — same site as Qwen's enable_thinking wiring in `packages/emmy-provider/src/before-request-hook.ts` lines 70–74

**Integration points:** consumed by `emmy_serve.profile.loader.load_serving` → `render_docker_args` → `docker run`. Schema validator at `emmy_serve/profile/schema.py:40` enforces every field.

---

### 3. `profiles/gemma-4-26b-a4b-it/v1/harness.yaml`

**Analog:** `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v3.1/harness.yaml` (current reference — includes compaction + web_fetch + web_search blocks)

**Pattern (shape — Gemma 4 values diverge only where the model does):**

```yaml
prompts:
  system: prompts/system.md
  edit_format: prompts/edit_format.md           # Hashline protocol — same prompt text
  tool_descriptions: prompts/tool_descriptions.md
  use_system_role: true                         # SP_OK canary verifies this at boot (Pitfall #6)
  prepend_system_text: ""

context:
  max_input_tokens: 114688                      # = 131072 - 16384 reserve (same formula as Qwen)
  include_repo_map: false
  repo_map_max_tokens: 0
  default_pruning: head_tail
  compaction:
    soft_threshold_pct: 0.75
    preserve_recent_turns: 5
    summarization_prompt_path: prompts/compact.md
    preserve_tool_results: error_only

tools:
  format: openai                                # gemma4 parser emits OpenAI tool_calls
  schemas: tool_schemas/                        # 9 schema files (8 native + web_search)
  grammar:
    path: grammars/tool_call.lark               # Gemma-4-shaped lark — rewritten for <|tool_call>call:...{}<tool_call|>
    mode: reactive                              # Pitfall #3 / D-11 — backstop only
  per_tool_sampling:
    edit: { temperature: 0.0 }
    bash: { temperature: 0.0 }
    read: { temperature: 0.0 }
  web_fetch:
    allowlist:
      - docs.python.org
      - developer.mozilla.org
      - docs.vllm.ai
      - huggingface.co
      - ai.google.dev                           # NEW for Gemma 4 — its doc hostname
      - docs.langfuse.com
    search_bypass_ttl_ms: 300000
  web_search:
    enabled: true
    base_url: http://127.0.0.1:8888
    max_results_default: 10
    rate_limit_per_turn: 10
    timeout_ms: 10000

agent_loop:
  max_iterations: 25
  retry_on_unparseable_tool_call: 2
  retry_on_empty_response: 1
  self_correction: enabled

advanced_settings_whitelist:
  - reasoning_effort
  - thinking_budget
```

**Divergences from analog:**
- `web_fetch.allowlist` adds `ai.google.dev` (Gemma 4 model card + function-calling docs)
- `tools.grammar.path` points at a Gemma-4-format lark (format is `<|tool_call>call:NAME{k:<|"|>v<|"|>}<tool_call|>`, not Qwen's XML). **Planner note:** the lark file bytes differ; the field name/path shape is unchanged.
- Everything else byte-identical in schema

**Integration points:** consumed by `emmy_serve.profile.loader.load_harness` + `packages/emmy-ux/src/profile-loader.ts` (ProfileSnapshot construction).

---

### 4. `profiles/gemma-4-26b-a4b-it/v1/PROFILE_NOTES.md`

**Analog:** `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md` (38KB — current leader for citation discipline + measured floors frontmatter)

**Pattern (frontmatter + provenance tables + Phase 4 research notes):**

```markdown
---
profile_id: gemma-4-26b-a4b-it
profile_version: v1
created: 2026-04-23
hardware_id: dgx-spark-01
measured_values:
  gpu_memory_utilization: 0.55           # PLACEHOLDER — operator-gated KV finder (D-15) overwrites; resume signal "p4 kv green"
  cold_start_seconds: 0                  # placeholder
  warm_throughput_tokps: 0               # placeholder
  decode_throughput_p50_hour2_tokps: 0   # placeholder — 2-hour thermal replay overwrites (D-15)
  decode_throughput_p1_hour2_tokps: 0
  gpu_clock_p5_hour2_mhz: 0
  gpu_clock_p50_hour2_mhz: 0
validation_runs: []                       # populated post-operator-run via commit
---

# Gemma 4 26B A4B MoE — v1 Profile Notes

## Provenance of defaults (SC-5)

### Engine
| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `tool_call_parser: gemma4` | Set | [vLLM Gemma4 parser docs](https://docs.vllm.ai/en/latest/api/vllm/tool_parsers/gemma4_tool_parser/) | 2026-04-23 |
| `reasoning_parser: gemma4` | Set | [Google function-calling docs](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4) | 2026-04-23 |
| ... (every non-default, per RESEARCH.md §2 tables) |

### Sampling
| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `temperature: 1.0` | Set | [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) | 2026-04-23 |
| `top_p: 0.95` | Set | same | 2026-04-23 |
| `top_k: 64` | Set | same | 2026-04-23 |

## Known parser bugs (D-17 RESEARCH output)
- [#39392](https://github.com/vllm-project/vllm/issues/39392) — pad-token leak under batch=2+
- [#39468](https://github.com/vllm-project/vllm/issues/39468) — format-corruption with <|" JSON wrapping
- Mitigation: reactive-grammar retry (harness.yaml tools.grammar.mode=reactive); optional `max_num_seqs=1` experimental knob documented here

## Phase-5 eval candidates
- `temperature: 1.5` (Unsloth HF discussion #21 community result)
- `max_num_seqs: 1` for zero-risk tool calls (throughput cost)
```

**Divergences from analog:**
- New "Known parser bugs" section (no equivalent in Qwen v3.1 notes — Qwen parser is stable)
- "Phase-5 eval candidates" section preserves community-experiment pointers without shipping them today

**Integration points:** hash-eligible (lives under bundle root); rendered in `profile-loader.ts` only informationally; `scripts/thermal_replay.py --record-floors` overwrites `measured_values:` frontmatter block.

---

### 5. `profiles/qwen3.6-35b-a3b/v3.1-{default,reason,precise}/` (three sibling variant bundles)

**Analog:** `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v3.1/` (entire bundle)

**Shape pattern (each variant is a full bundle with byte-identical engine + divergent harness):**

- `profile.yaml` — `version: v3.1-default` / `v3.1-reason` / `v3.1-precise`; unique hash per variant
- `serving.yaml` — **BYTE-IDENTICAL** to `v3.1/serving.yaml` (CI test enforces diff is empty — `tests/unit/test_variant_engine_byte_identity.py`)
- `harness.yaml` — diverges only in:
  - `tools.per_tool_sampling` (default: temp=0.2; reason: temp=0.6 + enable_thinking=true; precise: temp=0.0 + all tools 0.0)
  - `prompts.*` paths may point at variant-specific prompts (optional — default = reuse base)
  - `advanced_settings_whitelist` (reason adds `reasoning_effort=high`)
- `PROFILE_NOTES.md` — cite community source for each sampling divergence (SC-5)
- `prompts/`, `tool_schemas/`, `grammars/` — may symlink-by-copy to base v3.1 (hasher rejects symlinks per `hasher.py:78` — so literal copies)

**Divergences from analog:** schema does NOT change; `ProfileManifest.version` is a free-form string (`schema.py:325`) — `"v3.1-reason"` validates.

**Integration points:** referenced by `profiles/routes.yaml` (turn-role → variant); loaded by `packages/emmy-ux/src/routes-loader.ts` → `packages/emmy-provider/src/variant-resolver.ts`. Hasher walks each sibling dir in isolation (`hasher.py:94-123` — `EXCLUDE_ROOT_FILES = {"profile.yaml"}` + `compute_manifest` uses `bundle_dir.rglob("*")` with no parent escape).

---

### 6. `emmy_serve/swap/orchestrator.py` (the new swap primitive)

**Analogs:**
- `/data/projects/emmy/scripts/start_emmy.sh` (shape of stop→rm→run→probe→smoke)
- `/data/projects/emmy/emmy_serve/boot/runner.py` (argparse CLI subcommand skeleton + `render_image_ref` / `render_docker_args` — reused VERBATIM)
- `/data/projects/emmy/emmy_serve/boot/probe.py` (`wait_for_vllm` — reused VERBATIM)
- `/data/projects/emmy/scripts/smoke_test.py` (SP_OK + tool-call + generate canary pipeline; D-06 failure bundle — reused VERBATIM)
- `/data/projects/emmy/emmy_serve/diagnostics/bundle.py` (`write_boot_failure_bundle` — reused for rollback D-06 bundle)

**Pipeline pattern (composite shape — not a verbatim copy):**

```python
# emmy_serve/swap/orchestrator.py
#
# Phase 4 D-05 + D-07: validate-first-then-stop + Python-owned engine orchestration.
# Extends boot.runner.render_docker_args + boot.probe.wait_for_vllm + smoke_test
# into a single `uv run emmy-serve swap-profile --from PATH --to PATH --port N` CLI.

from __future__ import annotations
import argparse, json, subprocess, sys, time
from pathlib import Path

from ..profile.loader import load_profile
from ..profile.immutability import validate_bundle
from ..profile.hasher import hash_bundle
from ..boot.runner import render_image_ref, render_docker_args
from ..boot.probe import wait_for_vllm
from ..diagnostics.bundle import write_boot_failure_bundle
from ..diagnostics.layout import EmmyRunLayout, new_run_id


def _emit_progress(phase: str, pct: int | None = None) -> None:
    """Emit one JSON line on stdout per phase transition (D-22 locked labels)."""
    rec = {"ts": _now_iso(), "phase": phase}
    if pct is not None:
        rec["pct"] = pct
    print(json.dumps(rec), flush=True)  # flush: TS parent reads line-buffered


def swap_profile(old_profile: Path, new_profile: Path, port: int, run_dir: Path, *, no_rollback: bool = False) -> int:
    # --- Pre-flight (nothing stopped yet) ---
    try:
        _emit_progress("pre-flight validate")
        rc = validate_bundle(new_profile, fix_hash=False, strict=True)
        if rc != 0:
            return 2  # schema invalid
        # hash recompute + compare
        stored = load_profile(new_profile)[2].hash
        computed = hash_bundle(new_profile)
        if computed != stored:
            return 2  # hash mismatch
        # docker inspect image ref
        image_ref = render_image_ref(new_profile)
        if subprocess.run(["docker", "inspect", image_ref], capture_output=True).returncode != 0:
            return 3  # image missing
        # render docker args (validates serving.yaml more deeply)
        args = render_docker_args(new_profile, run_dir, port, airgap=False)
    except Exception as e:
        # D-04 contract: pre-flight failure = PRIOR ENGINE STILL RUNNING
        write_preflight_failure_bundle(run_dir, str(e))
        return 5  # NEW exit code — swap pre-flight fail, prior engine alive

    # --- Stop old (4-phase progress start) ---
    _emit_progress("stopping vLLM")                     # D-02 locked label 1
    subprocess.run(["docker", "stop", "--time", "15", "emmy-serve"], check=False)
    subprocess.run(["docker", "rm", "emmy-serve"], check=False)
    time.sleep(1)  # defensive — CUDA context drain

    # --- Start new ---
    _emit_progress("loading weights", pct=0)            # D-02 locked label 2
    subprocess.run(["docker", "run", "--name", "emmy-serve", "--detach"] + args, check=True)

    # Poll docker logs for progress, emit pct best-effort
    # ... (loop; emit_progress("loading weights", pct=N))

    _emit_progress("warmup")                            # D-02 locked label 3
    try:
        wait_for_vllm(f"http://127.0.0.1:{port}", timeout_s=300)
    except TimeoutError as e:
        # Post-stop failure → rollback (D-04)
        if not no_rollback:
            return _rollback(new_profile, old_profile, port, run_dir)
        return 6  # rollback failed or disabled

    _emit_progress("ready")                             # D-02 locked label 4

    # --- Smoke (SP_OK + tool_call + generate) ---
    smoke_rc = subprocess.run(
        ["uv", "run", "python", "scripts/smoke_test.py",
         "--base-url", f"http://127.0.0.1:{port}",
         "--profile", str(new_profile),
         "--run-dir", str(run_dir),
         "--fail-dir", "runs"],
    ).returncode
    if smoke_rc != 0:
        if not no_rollback:
            return _rollback(new_profile, old_profile, port, run_dir)
        return 6
    return 0


def _rollback(failed_new: Path, prior_old: Path, port: int, run_dir: Path) -> int:
    _emit_progress("rollback: stopping failed engine")
    subprocess.run(["docker", "stop", "--time", "15", "emmy-serve"], check=False)
    subprocess.run(["docker", "rm", "emmy-serve"], check=False)
    _emit_progress("rollback: restarting prior profile")
    rc = swap_profile(failed_new, prior_old, port, run_dir, no_rollback=True)  # ← no_rollback prevents loop
    envelope = {"rolled_back": True, "rollback_succeeded": rc == 0}
    print(json.dumps(envelope), flush=True)
    return 6


def main(argv: list[str] | None = None) -> int:
    # argparse shape: mirror emmy_serve.boot.runner.main — subcommand-on-same-module
    p = argparse.ArgumentParser(prog="emmy-serve swap-profile")
    p.add_argument("--from", required=True, dest="old_profile")
    p.add_argument("--to", required=True, dest="new_profile")
    p.add_argument("--port", type=int, default=8002)
    p.add_argument("--run-dir", default="runs/swap")
    p.add_argument("--no-rollback", action="store_true")
    args = p.parse_args(argv)
    return swap_profile(
        Path(args.old_profile), Path(args.new_profile),
        args.port, Path(args.run_dir), no_rollback=args.no_rollback,
    )
```

**Divergences from analogs:**
- Bash-level `stop→rm→run→probe→smoke` lifts VERBATIM from `start_emmy.sh` lines 90–123; rewritten in Python because the new caller is the TS child-process spawner (JSON progress on stdout is the TS contract)
- NEW exit codes 5 (pre-flight fail, prior alive) + 6 (post-stop fail + rollback envelope) ON TOP OF existing 0–4 scheme from `start_emmy.sh:8-12`
- Rollback is recursion into the SAME primitive with `--no-rollback` (D-04 "same path for rollback"; no special case)
- Emits progress on stdout — see Pattern 7 below

**Integration points:** spawned as child process by `packages/emmy-ux/src/profile-swap-runner.ts`; exit code + envelope JSON consumed by `/profile` handler.

---

### 7. `emmy_serve/swap/progress.py` (JSON-per-line stdout emitter)

**Analog:** `/data/projects/emmy/emmy_serve/canary/logging.py` (atomic JSONL append) — shape only; Phase 4 writes to stdout, not a file

**Pattern:**

```python
# One function, one contract: emit one JSON line per phase transition to stdout.
# The four required labels are LITERAL CONSTANTS — changing them breaks D-02.

STOPPING   = "stopping vLLM"
LOADING    = "loading weights"
WARMUP     = "warmup"
READY      = "ready"

def emit(phase: str, pct: int | None = None) -> None:
    record = {"ts": _now_iso(), "phase": phase}
    if pct is not None:
        record["pct"] = pct
    print(json.dumps(record), flush=True)
```

**Divergences from analog:** writes to stdout (not JSONL on disk); no file path; no atomicity needed (consumer reads line-buffered).

**Integration points:** called by `orchestrator.py`; parsed by `packages/emmy-ux/src/profile-swap-runner.ts`.

---

### 8. `packages/emmy-ux/src/slash-commands.ts` — add `registerProfileCommand`

**Analog:** `registerClearCommand` (same file, lines 125–162)

**Pattern (direct copy of shape; different body):**

```typescript
// packages/emmy-ux/src/slash-commands.ts (extended)

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface ProfileCmdCtx {
    hasUI?: boolean;
    isIdle: () => boolean;               // D-06 in-flight guard (pi 0.68 types.d.ts:211)
    ui: {
        confirm: (title: string, message: string) => Promise<boolean>;
        notify: (message: string, type?: "info" | "warning" | "error") => void;
        setStatus: (key: string, text: string | undefined) => void;
    };
}

export interface ProfileIndex {
    complete(prefix: string): string[];  // autocompletion
    resolve(name: string, variant?: string): string | null;  // → absolute path
}

export function registerProfileCommand(
    pi: ExtensionAPI,
    opts: {
        profileDir: string;
        port: number;
        profileIndex: ProfileIndex;
        runSwap: (args: { from: string; to: string; port: number; onProgress: (phase: string, pct?: number) => void }) => Promise<{ exit: number; envelope?: { rolled_back?: boolean; rollback_succeeded?: boolean } }>;
        reloadHarnessProfile: (newDir: string) => Promise<void>;
    },
): void {
    pi.registerCommand("profile", {
        description: "Swap to a different profile. /profile <name>[@<variant>]",
        // getArgumentCompletions not shown on existing commands but available per pi 0.68
        getArgumentCompletions: (prefix: string) => opts.profileIndex.complete(prefix),
        handler: async (args: string, ctx: unknown) => {
            const cmdCtx = ctx as ProfileCmdCtx;

            // D-06 in-flight guard
            if (!cmdCtx.isIdle()) {
                cmdCtx.ui.notify("swap deferred — request in flight, finish or Ctrl+C first", "warning");
                return;
            }

            const [name, variant] = args.trim().split("@");
            const target = opts.profileIndex.resolve(name, variant);
            if (!target) { cmdCtx.ui.notify(`unknown profile: ${args}`, "error"); return; }

            const ok = await cmdCtx.ui.confirm("Swap profile", `... ~2 min.  Continue?`);
            if (!ok) return;

            const { exit, envelope } = await opts.runSwap({
                from: opts.profileDir,
                to: target,
                port: opts.port,
                onProgress: (phase, pct) =>
                    cmdCtx.ui.setStatus("emmy.swap", renderProgress(phase, pct)),
            });

            if (exit === 0) {
                await opts.reloadHarnessProfile(target);       // D-23 harness-side hot-swap
                cmdCtx.ui.setStatus("emmy.swap", undefined);   // clear progress row
                cmdCtx.ui.notify(`swapped to ${args}`, "info");
            } else if (exit === 5) {
                cmdCtx.ui.notify("swap pre-flight failed (prior model still serving)", "error");
            } else if (exit === 6) {
                const msg = envelope?.rollback_succeeded
                    ? "swap failed; rollback succeeded"
                    : "swap failed; rollback FAILED — run start_emmy.sh manually";
                cmdCtx.ui.notify(msg, "error");
            } else {
                cmdCtx.ui.notify(`swap failed (exit ${exit}); see runs/boot-failures/`, "error");
            }
        },
    });
}
```

**Divergences from analog:**
- `isIdle()` gate (new; `/clear` does `hasUI` gate only)
- `getArgumentCompletions` used (optional pi 0.68 API; `/clear` doesn't need it)
- Handler has THREE ctx.ui.notify branches for three exit-code classes vs. `/clear`'s single-branch

**Integration points:** called from `createEmmyExtension` factory in `pi-emmy-extension.ts` at the current `registerClearCommand(pi)` line (398). `opts.runSwap` is implemented by `profile-swap-runner.ts`. `opts.reloadHarnessProfile` is implemented by `harness-swap.ts`.

---

### 9. `packages/emmy-ux/src/profile-swap-runner.ts` (child process + progress stream parser)

**Analog:** `packages/emmy-ux/src/profile-loader.ts:47-58` (the `execFileSync("uv", ["run", "emmy", "profile", "hash", profileDir])` pattern — shells out to Python, parses structured stdout)

**Pattern (extended to streaming):**

```typescript
// packages/emmy-ux/src/profile-swap-runner.ts
import { spawn } from "node:child_process";

export interface SwapResult {
    exit: number;
    envelope?: { rolled_back?: boolean; rollback_succeeded?: boolean };
}

export async function runSwapAndStreamProgress(args: {
    from: string;
    to: string;
    port: number;
    onProgress: (phase: string, pct?: number) => void;
    cwd?: string;
}): Promise<SwapResult> {
    return new Promise((resolve, reject) => {
        const p = spawn("uv", [
            "run", "python", "-m", "emmy_serve.swap.orchestrator",
            "--from", args.from, "--to", args.to, "--port", String(args.port),
        ], { cwd: args.cwd ?? process.cwd(), stdio: ["ignore", "pipe", "inherit"] });

        let envelope: SwapResult["envelope"];
        let buf = "";
        p.stdout.on("data", (chunk: Buffer) => {
            buf += chunk.toString("utf8");
            let idx: number;
            while ((idx = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
                if (!line.trim()) continue;
                try {
                    const rec = JSON.parse(line);
                    if (typeof rec.phase === "string") {
                        args.onProgress(rec.phase, typeof rec.pct === "number" ? rec.pct : undefined);
                    } else if ("rolled_back" in rec) {
                        envelope = rec;   // final rollback envelope
                    }
                } catch { /* ignore non-JSON noise */ }
            }
        });
        p.on("exit", (code) => resolve({ exit: code ?? 1, envelope }));
        p.on("error", reject);
    });
}
```

**Divergences from analog:**
- `spawn` + streaming (vs. `execFileSync` one-shot) — progress events are per-phase, not terminal
- Line-buffered JSON parsing — matches Python's `print(json.dumps(...), flush=True)` contract
- Parent inherits stderr (shows boot-failure messages directly) — same as `start_emmy.sh:118`

**Integration points:** called by `registerProfileCommand` handler (`slash-commands.ts`). Uses pi 0.68's `ctx.ui.setStatus("emmy.swap", ...)` channel.

---

### 10. `packages/emmy-ux/src/profile-index.ts` (filesystem scanner + autocompletion)

**Analog:** `profile-loader.ts:27-34` (the `existsSync` + `join` + structured path-walk pattern)

**Pattern (shape):**

```typescript
// Walks profiles/ dir, returns a ProfileIndex supporting complete(prefix) + resolve(name, variant?).
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export function scanProfileIndex(profilesRoot: string): ProfileIndex {
    const entries: Array<{ name: string; variants: string[]; paths: Record<string, string> }> = [];
    for (const dir of readdirSync(profilesRoot)) {
        const full = join(profilesRoot, dir);
        if (!statSync(full).isDirectory()) continue;
        if (dir === "routes.yaml") continue;   // top-level file not a profile dir
        const variants: string[] = [];
        const paths: Record<string, string> = {};
        for (const sub of readdirSync(full)) {
            if (!statSync(join(full, sub)).isDirectory()) continue;
            if (!existsSync(join(full, sub, "profile.yaml"))) continue;
            variants.push(sub);
            paths[sub] = join(full, sub);
        }
        entries.push({ name: dir, variants, paths });
    }
    return {
        complete(prefix: string): string[] {
            // ... autocomplete <name> then <name>@<variant>
        },
        resolve(name: string, variant?: string): string | null {
            const e = entries.find((x) => x.name === name);
            if (!e) return null;
            const v = variant ?? e.variants.find((s) => s.startsWith("v")) ?? e.variants[0];
            return e.paths[v] ?? null;
        },
    };
}
```

**Divergences from analog:** profile-loader.ts works on ONE bundle dir; profile-index.ts walks the PARENT `profiles/` tree.

**Integration points:** constructed once in `pi-emmy-extension.ts` at factory creation; passed to `registerProfileCommand`.

---

### 11. `packages/emmy-ux/src/harness-swap.ts` (D-23 harness hot-swap composition)

**Analogs (composed):**
- `packages/emmy-ux/src/profile-loader.ts:27-213` (`loadProfile` → returns new `ProfileSnapshot`)
- `packages/emmy-telemetry/src/profile-stamp-processor.ts:22-44` (construct new `EmmyProfileStampProcessor`)
- `packages/emmy-tools/src/web-fetch-allowlist.ts` (`setInitialAudit(result)` call per D-23 — confirmed pattern in RESEARCH §5.3)
- `packages/emmy-telemetry/src/session-context.ts:37-42` (`configureTelemetry(cfg)` module-level re-set pattern)

**Pattern:**

```typescript
// packages/emmy-ux/src/harness-swap.ts
import { loadProfile } from "./profile-loader";
import { EmmyProfileStampProcessor } from "@emmy/telemetry";
import { setInitialAudit } from "@emmy/tools";
// ... + web_search re-init if pattern exists

export async function reloadHarnessProfile(newDir: string, handles: {
    replaceProfileRef: (snap: ProfileSnapshot) => void;       // closure setter in pi-emmy-extension
    tracerProvider: BasicTracerProvider;                      // SDK handle from initOtel
    oldProcessor: EmmyProfileStampProcessor;
}): Promise<ProfileSnapshot> {
    const snap = await loadProfile(newDir);                   // (1) ProfileSnapshot cache invalidation
    handles.replaceProfileRef(snap);

    // (2) OTel processor swap
    handles.tracerProvider.addSpanProcessor(new EmmyProfileStampProcessor({
        id: snap.ref.id, version: snap.ref.version, hash: snap.ref.hash,
        // variant/role left undefined; per-turn snapshot populates them later
    }));
    handles.tracerProvider.removeSpanProcessor(handles.oldProcessor);

    // (3) web_fetch re-audit
    if (snap.harness.tools.web_fetch?.allowlist) {
        setInitialAudit({ allowlist: snap.harness.tools.web_fetch.allowlist });
    }

    return snap;
}
```

**Divergences from analogs:** no single analog — this is a composition of three patterns into one orchestration.

**Integration points:** called by `registerProfileCommand` handler on `exit === 0` branch. `pi-emmy-extension.ts` provides the closure setter via `let currentProfile: ProfileSnapshot = opts.profile` and exposes a setter.

---

### 12. `packages/emmy-ux/src/routes-loader.ts` + `packages/emmy-provider/src/variant-resolver.ts`

**Analog:** `packages/emmy-ux/src/profile-loader.ts:249-258` (js-yaml parse + ProfileLoadError wrapping)

**Pattern (routes-loader.ts):**

```typescript
// packages/emmy-ux/src/routes-loader.ts
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export interface RoutesConfig {
    default: { profileId: string; variant: string };
    roles: Record<"plan" | "edit" | "critic", { profileId: string; variant: string }>;
}

export function loadRoutes(path: string): RoutesConfig {
    const raw = yaml.load(readFileSync(path, "utf8")) as {
        default?: string; roles?: Record<string, string>;
    };
    const parseRef = (s: string) => {
        const [pid, variant] = s.split("@");
        if (!pid || !variant) throw new RoutesLoadError(`invalid route ref: ${s}`);
        return { profileId: pid, variant };
    };
    // ... + validation + default fallback if roles missing
}
```

**Pattern (variant-resolver.ts):**

```typescript
// packages/emmy-provider/src/variant-resolver.ts
import type { RoutesConfig } from "@emmy/ux/routes-loader";
import type { ProfileSnapshot } from "./types";

export function resolveVariant(
    role: "plan" | "edit" | "critic" | "default",
    routes: RoutesConfig,
    profilesRoot: string,
): { variantPath: string; profileId: string; variant: string } {
    const ref = role === "default" ? routes.default : routes.roles[role] ?? routes.default;
    return {
        variantPath: `${profilesRoot}/${ref.profileId}/${ref.variant}`,
        profileId: ref.profileId,
        variant: ref.variant,
    };
}
```

**Divergences from analog:**
- routes-loader parses a top-level file (not a bundle); no hash check
- variant-resolver is pure — no I/O; resolves ref → path. Actual loading of variant harness.yaml happens in the before-request hook (cached per-variant)

**Integration points:** loaded once in `pi-emmy-extension.ts` at factory construction; re-read on `/profile` swap if routes.yaml was edited. Variant harness.yaml is loaded by `profile-loader.ts` on first use (cached).

---

### 13. Extension to `packages/emmy-provider/src/before-request-hook.ts` (variant sampling application)

**Analog:** same file, lines 58–98 (existing `handleBeforeProviderRequest` function)

**Pattern (mutation add — before the grammar injection):**

```typescript
// packages/emmy-provider/src/before-request-hook.ts (extended)
export function handleBeforeProviderRequest(args: {
    payload: BeforeProviderRequestPayload;
    profile: ProfileSnapshot;
    assembledPrompt: AssembledPromptSnapshot;
    retryState: RetryState | null;
    variantSnapshot?: VariantSnapshot;        // NEW optional field
}): void {
    const { payload, profile, assembledPrompt, retryState, variantSnapshot } = args;
    if (payload.emmy?.is_sp_ok_canary === true) return;

    // (a) enable_thinking — existing
    payload.chat_template_kwargs = { ...(payload.chat_template_kwargs ?? {}), enable_thinking: false };

    // NEW: (a1) variant sampling override if variant snapshot present
    if (variantSnapshot) {
        // Apply per-tool sampling for the tool about to be invoked (set by harness upstream)
        const role = variantSnapshot.role;
        const harnessOverride = variantSnapshot.harness;
        if (harnessOverride.sampling_defaults) {
            payload.temperature = harnessOverride.sampling_defaults.temperature;
            payload.top_p = harnessOverride.sampling_defaults.top_p;
            // ... top_k, max_tokens, etc.
        }
        // variant-specific chat_template_kwargs (e.g. enable_thinking=true for reason variant)
        if (harnessOverride.chat_template_kwargs) {
            payload.chat_template_kwargs = {
                ...payload.chat_template_kwargs,
                ...harnessOverride.chat_template_kwargs,
            };
        }
        // variant-specific system prompt
        if (harnessOverride.prompts?.system) {
            // replaces assembledPrompt.text reassembly; deferred to @emmy/ux caller
        }
    }

    // (b) grammar injection — existing
    if (retryState?.wantsGrammar === true) { /* ... */ }

    // (c) system message replacement — existing
    const idx = payload.messages.findIndex((m) => m.role === "system");
    // ... existing code
}
```

**Divergences from analog:** new optional `variantSnapshot` arg; additional mutation block; all existing wiring unchanged.

**Integration points:** `pi-emmy-extension.ts` populates `variantSnapshot` by reading the `turn.role` envelope field, looking up via `resolveVariant`, and loading (or cache-hitting) the variant harness.yaml.

---

### 14. Extension to `packages/emmy-telemetry/src/profile-stamp-processor.ts` (add variant + role attrs)

**Analog:** same file, lines 22–44 (existing `EmmyProfileStampProcessor`)

**Pattern (backward-compat additive extension):**

```typescript
// packages/emmy-telemetry/src/profile-stamp-processor.ts (extended)

export interface ProfileStampAttrs {
    id: string;
    version: string;
    hash: string;
    // NEW — absent unless variant-aware turn context is set
    variant?: string;
    variantHash?: string;
    role?: string;
}

import { getCurrentTurnRoleContext } from "./turn-role-context";   // NEW module

export class EmmyProfileStampProcessor implements SpanProcessor {
    constructor(private readonly profile: ProfileStampAttrs) {}

    onStart(span: Span): void {
        span.setAttributes({
            "emmy.profile.id": this.profile.id,
            "emmy.profile.version": this.profile.version,
            "emmy.profile.hash": this.profile.hash,
        });

        // NEW: per-turn attribution read at span-start time (D-12)
        const turnCtx = getCurrentTurnRoleContext();
        if (turnCtx?.variant) {
            span.setAttribute("emmy.profile.variant", turnCtx.variant);
            if (turnCtx.variantHash) {
                span.setAttribute("emmy.profile.variant_hash", turnCtx.variantHash);
            }
        }
        if (turnCtx?.role) {
            span.setAttribute("emmy.role", turnCtx.role);
        }
    }
    // onEnd / shutdown / forceFlush unchanged
}
```

**Divergences from analog:** three new attrs, all optional; absent on spans where no variant-aware turn context exists (backward-compat for cross-phase span comparison).

**Integration points:** `getCurrentTurnRoleContext()` reads module-level state populated by `before_provider_request` hook in `pi-emmy-extension.ts`. Existing Plan 03-02 tests continue to pass because absent fields = pre-Phase-4 behavior.

---

### 15. `packages/emmy-telemetry/src/turn-role-context.ts` (NEW module-level turn context)

**Analog:** `packages/emmy-telemetry/src/session-context.ts` (module-level `_ctx` with setters — exact pattern)

**Pattern (direct copy):**

```typescript
// packages/emmy-telemetry/src/turn-role-context.ts

export interface TurnRoleContext {
    variant?: string;
    variantHash?: string;
    role?: string;
}

let _turnCtx: TurnRoleContext = {};

export function setCurrentTurnRoleContext(ctx: TurnRoleContext): void {
    _turnCtx = { ...ctx };
}

export function clearCurrentTurnRoleContext(): void {
    _turnCtx = {};
}

export function getCurrentTurnRoleContext(): TurnRoleContext {
    return _turnCtx;
}
```

**Divergences from analog:** same exact pattern as `session-context.ts:17-55`, just for a different payload. No divergence.

**Integration points:** set by `pi-emmy-extension.ts` in `before_provider_request` BEFORE calling `handleBeforeProviderRequest`; cleared on `turn_end` (alongside `resetTurnSearchCount` at line 318).

---

### 16. `tests/unit/test_no_model_conditionals.py` — grep audit (NEW PATTERN)

**Analog:** **No direct analog** in this codebase. Closest shape: `tests/unit/test_profile_notes.py` (scans YAML frontmatter across profile dirs; reads source trees + asserts structure).

**Pattern (new first instance — documented for future audits):**

```python
# tests/unit/test_no_model_conditionals.py
#
# D-19 grep-verifiable audit. Two modes:
#   1. Self-test: point at tests/fixtures/no_model_conditionals_positive.py and
#      assert the audit FIRES (proves the audit detects what it should).
#   2. Real mode: point at the full Python source tree, excluding the fixture
#      itself + allowlisted paths, and assert the audit produces NO hits.
from __future__ import annotations
import re
from pathlib import Path
import pytest

# Case-insensitive — flag `if "qwen" in x:` AND `if "Qwen" in x:`
PATTERN = re.compile(
    r"(?i)\b(if|elif|else|switch|when|match|case)\b.*\b(qwen|gemma|hermes|llama)\b",
)

ALLOWLIST_DIRS = {
    Path("profiles"),                    # YAML content is data, not code
    Path("tests/fixtures"),              # deliberate positives
    Path("node_modules"),
    Path(".venv"),
    Path("runs"),
    Path(".planning"),                   # markdown docs name models
    Path("docs"),
}

ALLOWLIST_FILES = {
    Path("tests/unit/test_no_model_conditionals.py"),  # this file's own regex
    Path("CLAUDE.md"), Path("README.md"),
}


def _iter_py_files(root: Path):
    for p in root.rglob("*.py"):
        if any(str(p).startswith(str(root / d) + "/") for d in ALLOWLIST_DIRS):
            continue
        if p.relative_to(root) in ALLOWLIST_FILES:
            continue
        yield p


def _find_hits(path: Path) -> list[tuple[int, str]]:
    hits = []
    for i, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("#"):  # comments ignored
            continue
        if PATTERN.search(line):
            hits.append((i, line))
    return hits


def test_audit_catches_fixture():
    """Self-test: the deliberate positive fixture MUST trigger the audit."""
    fixture = Path("tests/fixtures/no_model_conditionals_positive.py")
    hits = _find_hits(fixture)
    assert len(hits) > 0, "audit failed to detect deliberate positive — regex is broken"


def test_no_model_conditionals_in_sources():
    """Real mode: full tree ex. fixture must have ZERO hits."""
    root = Path(".").resolve()
    violations = []
    for p in _iter_py_files(root):
        hits = _find_hits(p)
        if hits:
            violations.append((p, hits))
    assert not violations, f"model-name conditional leaks found: {violations}"
```

**Divergences from analog:** This is a new pattern. The planner records this as the "first grep audit" in emmy.

**Integration points:** runs in `uv run pytest` (quick + full). Fixture at `tests/fixtures/no_model_conditionals_positive.py`. TS counterpart at `tests/unit/no-model-conditionals.test.ts` runs under `bun test`.

---

### 17. `tests/fixtures/no_model_conditionals_positive.py` (deliberate positive)

**Analog:** `tests/fixtures/airgap_green.json` + `tests/fixtures/airgap_red_layer_a.json` (deliberate-fixture pattern — existing positive/negative airgap fixtures pair with validator tests)

**Pattern (shape — intentionally terse):**

```python
# tests/fixtures/no_model_conditionals_positive.py
#
# Deliberate positive for the no-model-conditionals audit.
# This file MUST be caught by tests/unit/test_no_model_conditionals.py::test_audit_catches_fixture.
# Do NOT add this file to the audit's allowlist — the test verifies the audit
# detects the intended pattern.

def _example_violation(model: str) -> str:
    if "qwen" in model:         # ← MUST trigger the audit
        return "A"
    elif "gemma" in model:      # ← MUST trigger the audit
        return "B"
    return "C"
```

**Divergences from analog:** airgap fixtures are data files; this is Python source. Same role (deliberate-positive test fixture) different medium.

**Integration points:** read by `test_no_model_conditionals.py::test_audit_catches_fixture` in self-test mode.

---

### 18. Walkthrough evidence files (`runs/phase4-sc{1,3,4}/`)

**Analogs (by SC number):**
- SC-1 swap walkthrough — `runs/phase2-sc1/walkthrough.md` + `runs/phase2-sc1/transcript.json`
- SC-3 role-routing walkthrough — `runs/phase3-sc2/report.json` (variant-matrix-shaped artifact)
- SC-4 failure walkthrough — `runs/phase2-sc1/walkthrough.md` shape (narrative + verdict)

**Pattern (SC-1 walkthrough template — phase4-sc1):**

```markdown
# Phase 4 SC-1 Walkthrough — `/profile` swap

**Date:** 2026-04-XX
**Operator:** Matt Ratanapanichkich
**Profiles under test:**
  - `qwen3.6-35b-a3b/v3.1` (hash `sha256:...`)
  - `gemma-4-26b-a4b-it/v1` (hash `sha256:...`)
**Emmy-serve:** 127.0.0.1:8002

## Verdict
sc1 green

## Walkthrough narrative
### Setup
<bash commands — cold-boot Qwen, open pi-emmy TUI>

### The swap
1. Operator types `/profile gemma-4-26b-a4b-it`
2. Observes four progress phases VERBATIM: `stopping vLLM` → `loading weights 0%…92%` → `warmup` → `ready`
3. Runs a turn against Gemma 4 — tool call fires, edit applied
4. Operator types `/profile qwen3.6-35b-a3b` — swap back; four phases verbatim again
5. <second turn to confirm swap took>

## Evidence
- Transcript: `runs/phase4-sc1/transcript.json`
- vLLM container logs: `runs/phase4-sc1/docker-logs.txt`
- OTel spans: (Langfuse screenshot or exported JSONL showing emmy.profile.id + emmy.profile.hash flip)

## Air-gap posture
<ss -tnp check — loopback only>
```

**Divergences from analog:** SC-4 walkthrough has an INTENTIONAL failure injection (bad digest / corrupted weight) to verify the rollback path — the narrative structure is the same but includes a "deliberate break" section.

**Integration points:** committed to git under `runs/phase4-sc{1,3,4}/`. Referenced by `04-CLOSEOUT.md` evidence table. SC-1 + SC-4 + SC-3 are the three UAT gates per `04-VALIDATION.md §Manual-Only Verifications`.

---

## Shared Patterns (cross-cutting)

### Shared Pattern 1: pi 0.68 slash-command registration

**Source:** `packages/emmy-ux/src/slash-commands.ts` (`registerCompactCommand` + `registerClearCommand`)
**Apply to:** All new slash-command registrations (`/profile` in Phase 4; future `/profile list`, `/profile diff` in Phase 5+)

**Shape:**
```typescript
export function registerXxxCommand(pi: ExtensionAPI, opts: ...): void {
    pi.registerCommand("xxx", {
        description: "…",
        // optional: getArgumentCompletions
        handler: async (args: string, ctx: unknown) => {
            const cmdCtx = ctx as XxxCmdCtx;
            // 1. gate (hasUI / isIdle)
            // 2. parse args
            // 3. confirm (destructive ops)
            // 4. do work
            // 5. surface result via ctx.ui.notify
        },
    });
}
```

### Shared Pattern 2: Python argparse subcommand

**Source:** `emmy_serve/cli.py:92-138` (`build_parser()` with `psub.add_parser(...)` + `_attach_handler`)
**Apply to:** `emmy_serve/swap/orchestrator.py::main` (and any future `emmy profile <verb>` subcommand)

### Shared Pattern 3: Profile ref stamping on observability records

**Source:** `packages/emmy-telemetry/src/profile-stamp-processor.ts:25-31` + `packages/emmy-telemetry/src/index.ts:71-80` (emitEvent's per-event profile flattening)
**Apply to:** Every new OTel span / emitEvent call (no action required — factory-wired by `createEmmyExtension`; Phase 4 only adds the variant/role fields which follow the same mechanism via `getCurrentTurnRoleContext()`)

### Shared Pattern 4: Operator-gated DGX Spark tasks with resume signals

**Source:** Phase 1 D-15 pattern — `scripts/find_kv_budget.py` + `scripts/thermal_replay.py` reused VERBATIM on Gemma 4; resume-signal discipline from Phase 1 SC-1 / SC-5 / SC-4 deferrals documented in `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md`
**Apply to:** Phase 4 KV bisection + 2-hr thermal replay on Gemma 4

**Shape:**
- Split each gated task into RED (operator-facing instruction) + GREEN (measured floor committed to PROFILE_NOTES.md frontmatter)
- Register resume signal in `.planning/STATE.md`: `"p4 kv green"`, `"p4 thermal floors recorded"`, `"p4 thermal green"`
- Runs NOT repeated on every CI pass — the measured floor becomes the asserted invariant (via `--assert-floors` on `thermal_replay.py`)

### Shared Pattern 5: Air-gap CI validators (unchanged)

**Source:** `emmy_serve/airgap/ci_verify_phase3.py` (STRICT) + `emmy_serve/airgap/ci_verify_research_egress.py` (PERMISSIVE)
**Apply to:** Gemma 4 profile boot — both validators pass with ZERO code changes (they gate on outbound IPs, not profile content). Confirmed in RESEARCH §1 bullet 10.

### Shared Pattern 6: Diagnostic-bundle on failure (D-06)

**Source:** `emmy_serve/diagnostics/bundle.py::write_boot_failure_bundle`
**Apply to:** Swap primitive's pre-flight-fail path (exit 5) AND rollback-fail path (exit 6). Both surface a `runs/boot-failures/<iso>-swap-failure/` bundle with the 7 artifacts (`check.json` / `profile.json` / `prompt.txt` / ...).

### Shared Pattern 7: Walkthrough evidence directory convention

**Source:** `runs/phase2-sc1/`, `.planning/phases/03-observability-agent-loop-hardening-lived-experience/runs/p3-w1-walkthrough/`, `scripts/phase3_1_02_walkthrough.sh`
**Apply to:** `runs/phase4-sc1/`, `runs/phase4-sc3/`, `runs/phase4-sc4/`. Committed to git; `walkthrough.md` + optional `transcript.json` / `report.json`; operator verdict `scN green` at top.

---

## No Analog Found (genuinely new patterns)

Three files have no close in-repo analog. Planner uses RESEARCH.md as the prescriptive source:

| File | Role | Why New | Planner Reference |
|------|------|---------|-------------------|
| `tests/unit/test_no_model_conditionals.py` + TS twin | grep audit | First grep-over-source audit in emmy | Shape specified verbatim in 04-RESEARCH.md §6.3 dimension (b) + CONTEXT.md D-19 |
| `profiles/routes.yaml` | top-level config (outside any bundle) | First config file outside `profiles/<name>/v*/` | Shape specified verbatim in 04-RESEARCH.md §4.1 + CONTEXT.md D-08 |
| `packages/emmy-telemetry/src/turn-role-context.ts` | module-level state between hooks and span processor | First cross-module per-turn context; mirrors `session-context.ts` pattern but for a different lifetime (per-turn, not per-session) | Shape specified in 04-RESEARCH.md §4.4 last paragraph |

---

## Metadata

**Analog search scope:** `/data/projects/emmy/profiles/`, `/data/projects/emmy/emmy_serve/`, `/data/projects/emmy/packages/`, `/data/projects/emmy/scripts/`, `/data/projects/emmy/tests/`, `/data/projects/emmy/runs/`, `/data/projects/emmy/.planning/phases/`
**Files scanned:** ~120 (everything under `packages/emmy-{ux,telemetry,provider,tools,context}/src/` and all of `emmy_serve/`)
**Pattern extraction date:** 2026-04-23
**Upstream docs read:** 04-CONTEXT.md (locked D-01..D-23), 04-RESEARCH.md (D-17 resolution + full architecture map), 04-VALIDATION.md (test matrix + Wave 0 scaffolds)

**Key invariants preserved across all patterns:**
1. No model-name conditionals in code — enforced by D-19 audit (new test)
2. Profile immutability — variant sibling dirs each have independent hash (`hasher.py` walks bundle dirs in isolation; no changes needed)
3. FP8-only — Gemma 4 serving.yaml uses `quantization: fp8` + `kv_cache_dtype: fp8`; NVFP4 excluded
4. SP_OK canary gates every boot — `scripts/smoke_test.py` reused verbatim on Gemma 4
5. Air-gap posture — both validators unchanged; Gemma 4 profile inherits via `EnvVars._airgap_policy`
6. D-22 progress labels VERBATIM — `stopping vLLM` / `loading weights N%` / `warmup` / `ready`
