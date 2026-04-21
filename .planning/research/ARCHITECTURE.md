# Architecture Research

**Domain:** Local coding agent on single-box GPU (DGX Spark) — vLLM serving + pi.dev-based harness, with a shared first-class profile abstraction
**Researched:** 2026-04-20
**Confidence:** HIGH on shapes (vLLM, pi.dev, prior-art profile systems, prior dgx_stack), MEDIUM on a few specific seam choices (in-process vs HTTP for harness↔vLLM, hot-reload semantics) where the right answer depends on a measurement we have not yet done

> Scope note. This is an opinionated architecture for a personal-tool / research-artifact. It deliberately commits to choices the README leaves open (e.g. HTTP/OpenAI-compat over in-process) so the roadmap has a concrete spine to sequence against. Any "MEDIUM" call below names the experiment that would settle it.

---

## 1. Component architecture

### System overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              User surfaces                                    │
│   shannon-style CLI ── TUI / pi-coding-agent ── editor plugin (later)         │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                  │  (in-process SDK calls)
┌─────────────────────────────────▼────────────────────────────────────────────┐
│                         Emmy Harness (pi.dev runtime)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ Session /    │  │ Context      │  │ Router       │  │ Tool runtime    │   │
│  │ agent loop   │◄─┤ assembler    │  │ (multi-model)│  │ (incl. MCP)     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘   │
│         │                 │                 │                   │            │
│         ▼                 ▼                 ▼                   │            │
│  ┌────────────────────────────────────────────────────┐         │            │
│  │       Profile-aware vLLM client (per request)      │         │            │
│  │  applies sampling, grammar, system prompt, schema  │         │            │
│  └──────────────────────────┬─────────────────────────┘         │            │
│                             │                                   │            │
│  ┌──────────────────────────┴─────────────────────────┐         │            │
│  │              Observability bus                      │◄────────┘            │
│  │   (structured events → JSONL, OTel spans, replay)   │                     │
│  └────────────────────────────┬───────────────────────┘                     │
└─────────────────────────────────┼────────────────────────────────────────────┘
                                  │  HTTP, OpenAI-compatible /v1/* + /v1/messages
                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                emmy-serve  (specialized vLLM wrapper)                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐    │
│  │ vLLM engine  │  │ Coding-tuned     │  │ Compat shim                  │    │
│  │ (one model)  │◄─┤ defaults         │◄─┤ • Hermes/glm/llama3 parsers  │    │
│  │              │  │ + GuidedDecoding │  │ • XML→OAI tool_calls rewrite │    │
│  │              │  │ + spec_config    │  │ • reasoning-content cleanup  │    │
│  └──────┬───────┘  └──────────────────┘  └──────────────────────────────┘    │
│         │                                                                     │
│         ▼                                                                     │
│  KV cache + (optional) prefix-cache disk store                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │  reads at startup
┌─────────────────────────────────┴────────────────────────────────────────────┐
│                  Profile registry  (versioned YAML, content-addressed)        │
│  profiles/qwen3.6-coder-fp8/v1/{serving.yaml, harness.yaml, prompts/, …}      │
│  profiles/gemma4-it-fp8/v1/{serving.yaml, harness.yaml, prompts/, …}          │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │
┌─────────────────────────────────┴────────────────────────────────────────────┐
│  Eval / benchmark harness  (drives real sessions; never bypasses harness)     │
│  Lived-experience telemetry  (in-session journal → same JSONL stream)         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Components and boundaries

| # | Component | Owns | Talks to (interface) | Lives in process |
|---|-----------|------|----------------------|------------------|
| 1 | **Profile registry** | Versioned `serving.yaml` + `harness.yaml` + prompt files per (model, version); profile schema; content hash; resolution precedence | Read by both `emmy-serve` (boot) and harness (per-request) via filesystem; CLI `emmy profile …` for CRUD | Library imported by everyone |
| 2 | **emmy-serve** (vLLM wrapper) | Loading the chosen profile's `serving.yaml`, starting the vLLM engine with coding-tuned defaults, exposing OpenAI-compatible `/v1/chat/completions` and Anthropic-compatible `/v1/messages`, applying compat shims (Hermes XML rewrite, reasoning cleanup), guided-decoding plumbing | Harness via HTTP (loopback); profile registry via file read on boot | Separate process (Docker container) |
| 3 | **Harness runtime** (pi.dev based) | Session lifecycle, agent loop, retry/self-correction, tool dispatch, message accumulation | emmy-serve over HTTP; tool runtime in-process; observability bus in-process | Single host process per session |
| 4 | **Context assembler** | Reading the workspace, building the prompt (file-tree summary, repo map, task instruction, retrieved snippets), pruning to fit `max_input_tokens` from the profile | Filesystem; harness | In-process module of harness |
| 5 | **Router** (multi-model) | Choosing a profile per turn / per tool call from policy (e.g. planning→Qwen, search→cheap profile) | Reads profile registry; called by agent loop | In-process module of harness |
| 6 | **Tool runtime** | Executing local tools (read/write/edit/exec/search) and brokering MCP servers; surfacing tool schemas in the format the active profile expects | Filesystem, subprocess, MCP transport (stdio/HTTP); registered by name | In-process module of harness |
| 7 | **Observability bus** | One structured event stream (profile + sampling + tool calls + outcomes + timings) per session, emitted to JSONL on disk and as OTel spans; supports replay | Everything writes to it; replay reader reconstructs runs | In-process; fan-out to file + (optional) OTLP collector |
| 8 | **Eval / benchmark runner** | Driving canonical tasks through the same harness, scoring with judges, producing per-profile-version reports | Harness via the public SDK entry point (not back-doors); reads/writes `runs/` and `eval/` dirs | Separate CLI process; spawns harness as a library |
| 9 | **Lived-experience telemetry** | A `journal` tool inside the harness so the user can record a 1-line subjective verdict mid-session; same event stream as everything else | Harness tool runtime → observability bus | In-process tool |

**Boundary discipline.** Two boundaries are hard, the rest are soft:

- **Hard boundary 1:** `harness ↔ emmy-serve` via HTTP. Lets us swap inference engines (e.g. a future SGLang or TensorRT-LLM build) without touching the harness, and lets the harness keep running while we restart the serving layer.
- **Hard boundary 2:** Both layers `↔ profile registry` via the on-disk schema. Profiles are the only thing both layers agree on. Anything model-shaped that is not in a profile is a bug.

Everything inside the harness is one Python process — splitting context / router / tool runtime into separate processes is overkill for a single-user tool and would make tracing harder.

---

## 2. Profile-system design (the load-bearing abstraction)

### What problem the profile solves

Today, the same model needs settings in five different places:

- vLLM CLI flags: `--max-model-len`, `--tool-call-parser hermes`, `--reasoning-parser deepseek_r1`, `--gpu-memory-utilization`, `--speculative-config`, `--enable-prefix-caching`
- Per-request `SamplingParams` from the harness: `temperature`, `top_p`, `max_tokens`, `stop`, `guided_decoding`
- Tool-format quirks: Qwen emits Hermes XML, GLM uses `glm47`, Llama uses `llama3_json`, GPT-OSS uses native OpenAI format
- Prompt scaffolds: system prompt layering rules, edit-format examples, repo-map inclusion (per Aider's lessons)
- Retry/decoding policies: how to recover when the model leaks `<tool_call>` or empty `reasoning_content`

A profile is a single, versioned, content-hashed bundle that owns all of this and is consumed by both layers.

### Prior art (verified)

| System | What it gives us | What we steal |
|--------|------------------|----------------|
| **HF `GenerationConfig`** ([docs](https://huggingface.co/docs/transformers/main_classes/text_generation)) | `save_pretrained()` / `from_pretrained()`, multiple named configs per model (`config_file_name=...`), Hub-shareable | Per-task named configs; "save the known-good and let it travel" idiom |
| **vLLM `SamplingParams` + `GuidedDecodingParams`** ([source](https://github.com/vllm-project/vllm/blob/main/vllm/sampling_params.py)) | Concrete, well-typed sampling + structured-output schema (`json` / `regex` / `choice` / `grammar`); XGrammar default with Outlines fallback | The exact field set we serialize; never invent new sampling vocab |
| **vLLM `speculative_config`** ([EAGLE docs](https://docs.vllm.ai/en/latest/features/speculative_decoding/eagle/)) | `{method, model, num_speculative_tokens, draft_tensor_parallel_size, parallel_drafting}` | Pre-built P-EAGLE heads exist for Qwen3-Coder 30B and GPT-OSS — emmy ships them as ready-to-use spec configs in profiles |
| **Aider `.aider.model.settings.yml` + `.aider.model.metadata.json`** ([docs](https://aider.chat/docs/config/adv-model-settings.html)) | The single best precedent for a shared model-profile in OSS coding agents: edit-format, system-prompt support flag, ranked repo-map toggle, accepted advanced-settings whitelist (`reasoning_effort`, `thinking_tokens`), custom thinking-tag name, prepended system text | We adopt the *shape* of this file almost verbatim into `harness.yaml`; we add the serving-side fields Aider doesn't have |
| **LiteLLM `model_list` + `model_info` + `fallbacks`** ([docs](https://docs.litellm.ai/docs/proxy/configs)) | Routing-style config — `model_name` aliases, `model_info.max_input_tokens`, `default_fallbacks`, `context_window_fallbacks` | The router half of the spec; emmy's `routes.yaml` is a slimmed LiteLLM router config |
| **Prior dgx_stack (`config/stack.yaml`, `dgx_stack/providers/config.py`)** | Strict typed-YAML loader with frozen dataclasses, precedence chain `defaults < repo < user < env < CLI`, `_reject_unknown_keys` for typo safety, `served_model_name` derivation | We keep this loader pattern verbatim — it's already ours and it's good |

### Profile layout on disk

```
profiles/
├── qwen3.6-coder-fp8/
│   ├── v1/
│   │   ├── profile.yaml            # top-level manifest + content-hash inputs
│   │   ├── serving.yaml            # consumed by emmy-serve at boot
│   │   ├── harness.yaml            # consumed by harness per request
│   │   ├── prompts/
│   │   │   ├── system.md           # base system prompt
│   │   │   ├── edit_format.md      # edit-format examples (Aider-style)
│   │   │   └── tool_descriptions.md
│   │   ├── tool_schemas/
│   │   │   └── default.json        # tool definitions in the format this model parses best
│   │   ├── grammars/
│   │   │   └── tool_call.lark      # optional: hard guarantee of parseable tool calls
│   │   └── PROFILE_NOTES.md        # provenance: where every default came from + community sources
│   └── v2/  …                      # immutable; bumping a field = new version
├── gemma4-it-fp8/
│   └── v1/ …
└── routes.yaml                     # which profile for which task / role
```

Two design rules:

1. **Profiles are immutable + versioned.** Bumping any field = new directory (`v2`). The version and content hash go into every observability event so a run can always be reproduced. This is the lesson from `setup_local_opencode`'s "Phase 2 regression on aggressive tuning" — once a known-good is captured, you only move off it deliberately.
2. **`serving.yaml` and `harness.yaml` are the only two files either layer reads.** Prompts, grammars, schemas are referenced *by relative path* from those two. Keeps the schema flat, keeps prompt-engineering a file edit instead of a YAML quoting nightmare.

### Schema (concrete)

```yaml
# profiles/qwen3.6-coder-fp8/v1/profile.yaml
profile:
  id: qwen3.6-coder-fp8
  version: v1
  family: qwen3.6
  base_model: Qwen/Qwen3.6-Coder-FP8
  description: "Coding-tuned defaults for Qwen 3.6 Coder, FP8, on DGX Spark"
  tags: [coding, dgx-spark, fp8]
  community_sources:
    - title: "Qwen 3.6 release blog"
      url: "https://qwenlm.github.io/..."
    - title: "vLLM Qwen recipes"
      url: "https://docs.vllm.ai/..."
  hash: sha256:…   # over serving.yaml + harness.yaml + every referenced file
```

```yaml
# profiles/qwen3.6-coder-fp8/v1/serving.yaml
# Consumed by emmy-serve at startup. Mirrors vLLM EngineArgs + SamplingParams.
engine:
  model: Qwen/Qwen3.6-Coder-FP8
  served_model_name: qwen3.6-coder-fp8
  max_model_len: 131072
  gpu_memory_utilization: 0.70
  enable_prefix_caching: true
  kv_cache_dtype: fp8
  load_format: fastsafetensors      # 3x faster boot, lesson from prior repo
  tool_call_parser: hermes          # or glm47, llama3_json, openai
  reasoning_parser: null            # set for thinking models
  enable_lora: false

speculative:
  method: eagle3                    # or null
  model: RedHatAI/Qwen3-Coder-…-eagle3
  num_speculative_tokens: 4
  draft_tensor_parallel_size: 1
  parallel_drafting: true           # P-EAGLE — already exists for Qwen3-Coder 30B

sampling_defaults:                  # used as priors; tasks can override
  temperature: 0.2
  top_p: 0.95
  top_k: 40
  repetition_penalty: 1.05
  max_tokens: 8192
  stop: ["</tool_call>", "<|im_end|>"]

guided_decoding:
  default_backend: xgrammar         # vLLM default, falls back to outlines

quirks:
  strip_thinking_tags: false
  promote_reasoning_to_content: false
  buffer_tool_streams: true         # Hermes XML → SSE tool_calls rewrite
```

```yaml
# profiles/qwen3.6-coder-fp8/v1/harness.yaml
# Consumed by harness per request. Aider-shaped + extra serving knobs.
prompts:
  system: prompts/system.md
  edit_format: prompts/edit_format.md
  tool_descriptions: prompts/tool_descriptions.md
  use_system_role: true             # some models ignore system; Qwen honors it
  prepend_system_text: ""

context:
  max_input_tokens: 120000          # < max_model_len so we leave room for output
  include_repo_map: true            # Aider-style ranked symbol map
  repo_map_max_tokens: 4096
  default_pruning: head_tail        # or recency_window

tools:
  format: openai                    # what the harness sends to the wire
  schemas: tool_schemas/default.json
  grammar: grammars/tool_call.lark  # optional hard guarantee
  per_tool_sampling:
    edit:    { temperature: 0.0 }
    search:  { temperature: 0.4, max_tokens: 1024 }

agent_loop:
  max_iterations: 25
  retry_on_unparseable_tool_call: 2
  retry_on_empty_response: 1
  self_correction: enabled

advanced_settings_whitelist:        # Aider's pattern — only forward what the model accepts
  - reasoning_effort
  - thinking_tokens
```

```yaml
# profiles/routes.yaml
# Which profile for which role. LiteLLM-shaped.
default: qwen3.6-coder-fp8@v1

roles:
  plan:    qwen3.6-coder-fp8@v1
  edit:    qwen3.6-coder-fp8@v1
  search:  gemma4-it-fp8@v1         # cheaper, faster for routine search
  summarize: gemma4-it-fp8@v1

fallbacks:
  qwen3.6-coder-fp8@v1: [gemma4-it-fp8@v1]
context_window_fallbacks:
  qwen3.6-coder-fp8@v1: [qwen3.6-coder-fp8@v1]   # same — there is no longer-context option
```

### Why this split is right

`serving.yaml` is "what gets baked into the engine when the GPU is loaded" — changing it requires restarting vLLM. `harness.yaml` is "what gets sent on each request" — changing it is hot. Keeping the two physically separate makes the hot-reload story (§4) trivial.

---

## 3. Data flow

### The happy path of a single user turn

```
1. User → CLI/TUI:  "fix the failing test in foo.py"
2. CLI → Harness session.run(input)
3. Session emits  event=turn.start  (profile=qwen…, route=edit)
4. Router picks profile (route=edit → qwen3.6-coder-fp8@v1)
5. Context assembler:
     - reads workspace
     - builds repo map (per harness.yaml)
     - assembles messages (system from profile.prompts.system, user input,
       prior turn history pruned to harness.context.max_input_tokens)
6. Tool runtime emits the tool schema in profile.tools.format with the
   profile.tools.grammar attached as guided_decoding.grammar
7. Profile-aware vLLM client builds request:
     POST emmy-serve /v1/chat/completions
     body = { model: served_model_name,
              messages: …,
              tools: …,
              temperature: profile.sampling_defaults.temperature
                            (overridden by per_tool_sampling),
              extra_body: { guided_decoding: { grammar: "…" },
                            chat_template_kwargs: { reasoning_effort: "low" } } }
8. emmy-serve → vLLM engine.  Tokens stream back.  Compat shim cleans
   reasoning_content / rewrites Hermes XML if profile.quirks demands it.
9. SSE stream returns to harness; tool_calls dispatched to tool runtime.
10. Tool runtime executes (Read, Edit, Bash, etc.); appends tool_result message.
11. Loop back to step 7 until model emits no tool calls or
     agent_loop.max_iterations is hit.
12. Session emits  event=turn.end  with full structured trace.
```

### Where each extension point lives

```
User input
   │
   ▼
┌──────────────┐  ◄── EXT: input pre-processors (slash commands, /journal, etc.)
│ session.run  │
└──────┬───────┘
       │
       ▼
┌──────────────┐  ◄── EXT: routing strategy (replace router with policy plugin)
│ Router       │
└──────┬───────┘
       │
       ▼
┌──────────────┐  ◄── EXT: context provider (RAG, repo-map, custom retrievers)
│ Context      │
│ assembler    │
└──────┬───────┘
       │
       ▼
┌──────────────┐  ◄── EXT: tool registration (built-in, plugin, MCP server)
│ Tool runtime │
└──────┬───────┘
       │
       ▼
┌──────────────┐  ◄── EXT: profile (sampling, grammar, prompt scaffold, retry)
│ vLLM client  │
└──────┬───────┘
       │
       ▼
┌──────────────┐  ◄── EXT: response post-processors (judge, citation validator)
│ Response     │
│ handler      │
└──────────────┘
```

Numbered map of the eight pi.dev pain points (from PROJECT.md) → seam:

| Pain point | Seam |
|-----------|------|
| Tool format rigidity | Tool runtime + `harness.tools.format` / `tool_schemas/` / `grammars/` |
| Agent loop opacity | Session loop is plain code, not a config DSL — fork it; hooks at `before_step`, `after_step`, `on_tool_error` |
| Context management | Context assembler — pluggable providers behind a single interface |
| System prompt control | `harness.prompts.*` plus the `prepend_system_text` knob |
| Sampling/decoding | Profile `sampling_defaults` + `per_tool_sampling` overrides |
| Multi-model routing | Router + `routes.yaml` |
| Observability/eval | Observability bus + Eval runner that drives the SDK entry point |
| Tool extensibility | Tool runtime plugin loader + MCP transport |

---

## 4. Deployment topology on DGX Spark

### Two processes, on the same box

```
            ┌───────────────────────────────────────┐
            │  Bare metal: DGX Spark (Linux)        │
            │                                       │
            │  ┌────────────────────────────────┐   │
            │  │ Docker: emmy-serve container   │   │  port 8002 → loopback only
            │  │   • NGC vllm:26.01-py3 image   │   │  (no external bind)
            │  │   • mounts profiles/ ro        │   │
            │  │   • mounts models/ ro          │   │
            │  │   • health: GET /v1/models     │   │
            │  └────────────────┬───────────────┘   │
            │                   │ HTTP loopback     │
            │  ┌────────────────▼───────────────┐   │
            │  │ Host process: emmy harness     │   │
            │  │   • venv/uv-managed            │   │
            │  │   • pi.dev SDK + emmy plugins  │   │
            │  │   • mounts profiles/ rw        │   │
            │  │   • runs/ for traces           │   │
            │  └────────────────────────────────┘   │
            └───────────────────────────────────────┘
```

### The decisions

**Container vs bare metal.** vLLM in **Docker** — NGC ships the GPU stack pre-built and the prior repo confirmed `vllm:26.01-py3` works on Spark. Harness on the **host** in a uv-managed venv — Python-only, fast iteration, no GPU dependencies, easy to attach a debugger.

**Single-process vs multi-process.** Two processes — emmy-serve and harness. We keep them split because:

1. Restarting the harness should not reload weights (Spark cold-start ≈ 3 min even with `fastsafetensors`).
2. The compat shim and rewrites are clearer as middleware in front of vLLM than as harness code.
3. It enforces profile discipline — anything model-shaped has to cross the wire, so it has to be in the profile.

**How the harness calls vLLM.** **HTTP, OpenAI-compatible** (`/v1/chat/completions` + `/v1/messages`). Concretely:

- Pi.dev / pi-coding-agent already speaks provider-portable sessions; OpenAI-compat is the most universal target.
- The grammar / sampling / `chat_template_kwargs` we need all flow through `extra_body` on the OpenAI endpoint.
- HTTP gives us the natural seam to insert the compat shim.
- Tradeoff: ~1–3 ms loopback overhead per turn — negligible against 24–77 s/task observed in prior evals.

**Rejected:** in-process (would force the harness into the vLLM container's CUDA-coupled image and re-couple the two layers); gRPC (no upside over HTTP for one-user loopback).

**Hot-reload of profiles.**

- `harness.yaml` changes are **hot** — re-read on every session start. No restart.
- `serving.yaml` changes that touch `engine` or `speculative` require a vLLM restart (the engine builds CUDA graphs around them).
- `serving.yaml.sampling_defaults` and `quirks` are read by emmy-serve's compat shim per request — also hot.
- Implementation: the profile-aware client computes a per-request hash over the *currently active* profile and stamps it in the trace, so hot edits are visible in observability without ambiguity.

**Single-user, one model loaded.** Spark's 128 GB unified RAM forces this — see prior repo's table. Multi-model routing is implemented as "swap the loaded model when the route changes," not "load both at once." A start-script honors the profile's GPU footprint and refuses to start a second model.

For research scenarios that need two models at once, the prior repo's `start_dual.sh` pattern (split GPU memory) is documented but off the default path.

---

## 5. Build order / dependency graph

The minimum viable spine is short. Everything else is a refinement.

```
       ┌────────────────────┐
       │ 1. Profile schema  │  pure Python, no GPU
       │   + loader (uv)    │
       └─────────┬──────────┘
                 │
       ┌─────────▼──────────┐
       │ 2. emmy-serve      │  vLLM in Docker, OpenAI endpoint up,
       │   (one profile)    │  one profile loaded end-to-end
       └─────────┬──────────┘
                 │
       ┌─────────▼──────────┐
       │ 3. Profile-aware   │  thin OpenAI client that applies
       │    vLLM client     │  sampling + extra_body from profile
       └─────────┬──────────┘
                 │
       ┌─────────▼──────────┐
       │ 4. Minimal harness │  pi.dev session + 4 tools
       │   (Read/Edit/Bash/ │  (Read/Edit/Bash/Grep), no router yet
       │    Grep)           │
       └─────────┬──────────┘
                 │
   ────── MVP shippable here ──────
                 │
       ┌─────────▼──────────┐  ┌────────────────────┐  ┌────────────────────┐
       │ 5. Observability   │  │ 6. Context         │  │ 7. Eval runner     │
       │    bus + JSONL     │  │    assembler       │  │    (drives 4 via   │
       │                    │  │    + repo map      │  │    SDK)            │
       └─────────┬──────────┘  └─────────┬──────────┘  └─────────┬──────────┘
                 │                       │                       │
                 └───────────────────────┼───────────────────────┘
                                         │
                          ┌──────────────▼──────────────┐
                          │ 8. Router + second profile  │
                          │    (Gemma 4)                 │
                          └──────────────┬──────────────┘
                                         │
                          ┌──────────────▼──────────────┐
                          │ 9. Grammar / guided decoding │
                          │    + speculative decoding   │
                          └──────────────┬──────────────┘
                                         │
                          ┌──────────────▼──────────────┐
                          │ 10. Lived-experience telem. │
                          │     (journal tool)          │
                          └─────────────────────────────┘
```

### Parallel-safe groupings

- **Group A (sequential, no parallelism):** 1 → 2 → 3 → 4. This is the spine; nothing else is meaningful without it.
- **Group B (parallel after MVP):** 5, 6, 7 can be built concurrently. The eval runner only needs the SDK entry point that step 4 ships.
- **Group C (parallel):** 8 and 9 each depend only on the spine; either can land first.
- **Group D (small):** 10 is a one-tool addition.

### What changes the order

If grammar-constrained tool calls turn out to be needed to make the spine *work at all* (e.g. Gemma 4 is unparseable without it), step 9 jumps to before step 8 and possibly into step 4. Keep an early "does the spine produce parseable tool calls without grammar?" smoke test as a gate.

---

## 6. Evaluation harness placement

The eval runner is **its own CLI**, but it imports the harness as a library and drives sessions through the same public entry point a user does. Concretely:

```
eval/
├── tasks/                           # extends Phase 1 prompts from setup_local_opencode
├── runner.py                        # for each (task × profile_version × seed):
│                                    #   harness.session.run(task.prompt) → trace
├── judges/                          # LLM-judge or rule-based scorers
└── reports/                         # markdown reports, per-profile-version diffing
```

Three rules:

1. **Never bypass the harness.** No "direct vLLM" path in eval — that was the failure mode of evaluating raw API behaviour and not the agent's behaviour. Anything the eval can do, a real session can do.
2. **Profile version is a first-class axis.** Every eval row is `(task, profile_id, profile_version, seed)`. Bumping `qwen3.6-coder-fp8` from `v1` to `v2` re-runs everything and produces a diff report. This is the only way to keep "stand on shoulders" honest — you can show that the new defaults do or don't beat the old ones.
3. **The journal stream is in the eval too.** Lived-experience entries from real sessions get joined to eval scores at report time. That's how subjective ↔ objective tension gets surfaced.

The eval runner can be parallelised across tasks because each task is one session — but only one model is loaded, so `(profile_id, profile_version)` are the bottleneck. We schedule eval batches per profile, run all tasks for that profile, then swap.

---

## 7. Observability architecture

### One event stream, two sinks

Everything that happens in a session emits a structured event to a single bus. Two sinks:

- **Disk:** `runs/<run_id>/events.jsonl`, one line per event, atomic append. Run layout follows the prior dgx_stack pattern (`runs/layout.py`) — per-step pass directories, atomic JSON via `write_json_atomic`.
- **OTel exporter (optional):** spans named after the same events, with the same attributes.

### Event schema (sketch)

```jsonc
{
  "ts": "2026-04-20T14:23:11.123Z",
  "run_id": "r_2026-04-20_142310_a1b2",
  "session_id": "s_…",
  "turn": 3,
  "event": "model.request",          // or model.response, tool.call, tool.result, etc.
  "profile": {
    "id": "qwen3.6-coder-fp8",
    "version": "v1",
    "hash": "sha256:abcd…"           // content hash of the bundle
  },
  "request": {
    "endpoint": "/v1/chat/completions",
    "model": "qwen3.6-coder-fp8",
    "sampling": { "temperature": 0.0, "top_p": 0.95, … },
    "guided_decoding": { "grammar_ref": "tool_call.lark" },
    "messages_tokens": 14211,
    "tools_count": 7
  },
  "response": {
    "tokens_out": 412,
    "finish_reason": "tool_calls",
    "tool_calls": [{"name":"Edit","args_hash":"…"}],
    "ttft_ms": 312,
    "throughput_toks_per_s": 38.4
  }
}
```

### Trace propagation across the harness ↔ vLLM boundary

The harness generates `run_id`/`turn` and forwards them on the wire as a custom header (`x-emmy-trace-id`, `x-emmy-turn`). emmy-serve echoes them in response headers and logs them. With OTel enabled, standard W3C `traceparent` headers are also propagated so vLLM-side spans (queue time, schedule time, decode time) join the same trace.

### Replay capability

The events.jsonl is sufficient to reconstruct any session:

- `model.request` events contain the exact messages + sampling + grammar.
- `tool.result` events contain stdout/stderr/exit-code (+ a redacted version when `TraceMode` says so — same redact policy as prior dgx_stack).
- A `replay` CLI re-runs the request stream through emmy-serve and diffs token-by-token; non-determinism is logged.

### What we *don't* do at this scale

No SQLite/Postgres for traces — flat JSONL is enough for one user, one box, and grep is your friend. No Grafana dashboards by default — leave OTel exporter as opt-in.

---

## 8. Extensibility seams (one-line per seam)

| Seam | Add a … | By doing |
|------|---------|----------|
| **New tool** | local function tool | Drop a `Tool` subclass into `harness/tools/`, register in `tools/__init__.py`; tool schema auto-published in active profile's format |
| **New MCP tool** | external MCP server | Add to `mcp_servers.yaml`; tool runtime fans them in; same dispatch surface |
| **New model** | profile bundle | Create `profiles/<new>/v1/{profile,serving,harness}.yaml`; `emmy serve --profile <new>@v1` |
| **New prompt scaffold** | system / edit / tool prompt | New `.md` under a profile's `prompts/`, reference from `harness.yaml`, bump version |
| **New grammar** | hard-constrained output | New `.lark` under a profile's `grammars/`, reference from `harness.yaml.tools.grammar` |
| **New routing strategy** | plug-in router | Implement the `Router` interface (one method: `route(turn) → profile_ref`), set it in `routes.yaml` |
| **New context provider** | RAG, retriever, summariser | Implement the `ContextProvider` interface; `harness.yaml.context.providers: [...]` |
| **New compat shim** | parser/quirk | Add to emmy-serve's middleware chain; flag it in `serving.yaml.quirks` |
| **New observability sink** | exporter | Subscribe to the bus; emit elsewhere |
| **New eval task** | benchmark item | Drop YAML into `eval/tasks/`; runner discovers automatically |

### What is **not** a seam (deliberately)

- The agent loop itself. This is plain Python that you fork for now. Pi.dev's philosophy ("minimal harnesses offer maximum flexibility") and the lessons from the prior repo agree: a config-driven loop becomes a config-driven nightmare. Keep it short, keep it readable, edit it directly.
- The on-the-wire format between harness and emmy-serve. It is OpenAI-compat with `extra_body`. Adding new params goes through `extra_body`. We do not version the wire schema.

---

## 9. Concurrency / sessions

### The 80% case (single-user)

One session at a time, one harness process. Sessions are not a server; they're an SDK call. State per session lives in memory + on disk under `runs/<run_id>/`.

### The benchmark case

The eval runner needs to run many sessions per profile. Options, ranked:

1. **Sequential within a profile, parallel across CPU-bound work.** Default. The bottleneck is the model on the GPU, not the harness, so spawning many harness threads just queues at vLLM. We exploit vLLM's continuous batching by submitting the next request while the previous is still streaming, but otherwise keep one-thread-per-task. Simple and matches Spark's reality.
2. **Parallel sessions when profile is the same.** vLLM happily batches concurrent requests; the harness is asyncio-friendly; a `--concurrency N` flag fans out N sessions through the same emmy-serve. Useful for short tasks. Each session writes its own `runs/<run_id>/`, so there's no cross-session state.
3. **Profile-swap between batches.** Each `(profile, version)` batch waits for emmy-serve to finish loading. Wrapped by the runner; user just sees a progress bar.

### What we do *not* do

- Multi-tenant request isolation. Single-user.
- Session migration. Personal tool — restart kills the session and that's fine.
- Distributed: explicitly out of scope (single-box is the thesis).

The architecture cleanly *allows* parallel benchmark runs because every session is self-contained: own `run_id`, own event stream, own working directory if needed. Nothing in the harness holds global mutable state beyond the loaded profile (which is read-only per request). This was a deliberate inheritance from the prior dgx_stack run-layout pattern.

---

## Anti-patterns

### Anti-pattern 1: Putting model-shaped logic in code instead of a profile

**What people do:** Hard-code "if model name contains 'qwen' then use Hermes parser" inside the harness or the serve wrapper.

**Why it's wrong:** Two layers each grow their own model-detection logic; they drift; reproducibility evaporates.

**Do this instead:** All of it goes in a profile field. The code path reads `profile.serving.tool_call_parser` or `profile.harness.tools.format`. Period.

### Anti-pattern 2: Eval that bypasses the harness

**What people do:** Eval scripts call vLLM directly because "it's faster to write."

**Why it's wrong:** You measure the model, not the agent. The whole point of emmy is the harness — the eval has to drive it.

**Do this instead:** Eval imports the harness's public SDK and runs `session.run(task)`. Nothing else.

### Anti-pattern 3: Mutable profiles

**What people do:** Edit `serving.yaml` in place because "it's a small tweak."

**Why it's wrong:** Yesterday's run is now unreproducible. The Phase 2 lesson from the prior repo (heavy tuning regressed Qwen) is invisible unless every config snapshot is preserved.

**Do this instead:** Bump `v1` → `v2`. Edit there. The on-disk `hash` and the trace's `profile.hash` field will tell you what was used.

### Anti-pattern 4: Logging by `print()`

**What people do:** Sprinkle `print("got tool call: ", tc)` for debugging.

**Why it's wrong:** It's not in the event stream so it's not in the replay, and it leaks during tests.

**Do this instead:** Emit a structured event to the bus. The bus has a `dev` sink that pretty-prints to stderr; use that in dev.

### Anti-pattern 5: Splitting the harness into microservices

**What people do:** "Let's run the context assembler as its own service so we can scale it independently."

**Why it's wrong:** Single user, single box. You'd add IPC overhead, worse traces, and a new boundary that has to be in the profile.

**Do this instead:** Stay one process. Split only when measurement says you must — and "must" for a personal tool is a high bar.

---

## Integration points

### External services (zero in critical path, by constraint)

| Service | Used for | Notes |
|---------|----------|-------|
| HuggingFace Hub | Initial model download only | `download_models.py` style, not in inference path |
| (none) | Inference | Hard constraint: no cloud inference |

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Harness ↔ emmy-serve | HTTP (loopback), OpenAI-compatible | Hard boundary; profile-aware client is the only thing that crosses it |
| Harness ↔ MCP servers | stdio or HTTP per MCP | Tool runtime brokers; no profile coupling |
| Harness ↔ Tool runtime | In-process function call | Soft boundary; tools register as Python objects |
| emmy-serve ↔ Profile registry | Filesystem read at boot + on `/admin/reload` (hot fields only) | Read-only mount in the container |
| Harness ↔ Profile registry | Filesystem read per session start | Read-write — `emmy profile new` writes here |
| Eval runner ↔ Harness | Imports harness as a library; calls public SDK | Same code path as a real user |

---

## Sources

- [pi-mono / pi-coding-agent (badlogic) — minimal terminal harness, TS extensions, multi-mode SDK](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
- [Pi: The Minimal Agent Within OpenClaw — Armin Ronacher's deep dive on pi.dev's philosophy](https://lucumr.pocoo.org/2026/1/31/pi/)
- [@mariozechner/pi-coding-agent on npm](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
- [vLLM `SamplingParams` source](https://github.com/vllm-project/vllm/blob/main/vllm/sampling_params.py)
- [vLLM Structured Outputs / GuidedDecodingParams](https://docs.vllm.ai/en/v0.8.2/features/structured_outputs.html)
- [Structured outputs in vLLM (Red Hat) — XGrammar default with Outlines fallback](https://developers.redhat.com/articles/2025/06/03/structured-outputs-vllm-guiding-ai-responses)
- [vLLM Speculative Decoding — EAGLE Draft Models](https://docs.vllm.ai/en/latest/features/speculative_decoding/eagle/)
- [P-EAGLE: Faster LLM inference with Parallel Speculative Decoding in vLLM (2026)](https://aws.amazon.com/blogs/machine-learning/p-eagle-faster-llm-inference-with-parallel-speculative-decoding-in-vllm/)
- [Speculative decoding in vLLM for gpt-oss (2026)](https://developers.redhat.com/articles/2026/04/16/performance-improvements-speculative-decoding-vllm-gpt-oss)
- [Aider — Advanced model settings (model.settings.yml + model.metadata.json)](https://aider.chat/docs/config/adv-model-settings.html)
- [Aider — Model Configuration and Capabilities (DeepWiki)](https://deepwiki.com/Aider-AI/aider/7-model-configuration-and-capabilities)
- [LiteLLM Proxy — Configs (model_list / model_info / fallbacks)](https://docs.litellm.ai/docs/proxy/configs)
- [LiteLLM — Fallbacks](https://docs.litellm.ai/docs/proxy/reliability)
- [HuggingFace Transformers — Generation (GenerationConfig.save_pretrained / from_pretrained)](https://huggingface.co/docs/transformers/main_classes/text_generation)
- Local (read directly): `/data/projects/emmy/.planning/PROJECT.md` — domain constraints and the eight pi.dev pain points
- Local (read directly): `/data/projects/setup_local_opencode/README.md` — measured numbers for Spark startup, throughput, model footprints; existing two-proxy pattern (model_router + vllm_compat_proxy)
- Local (read directly): `/data/projects/setup_local_opencode/dgx_stack/{config.py, providers/{config,registry}.py, tasks/model.py, runs/{layout,write}.py}` — the typed-YAML loader and run-layout patterns we reuse

---

*Architecture research for: local coding agent on DGX Spark with shared model-profile abstraction*
*Researched: 2026-04-20*
