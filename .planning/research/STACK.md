# Stack Research

**Domain:** Fully-local coding agent on a single NVIDIA DGX Spark (GB10, 128 GB unified memory)
**Researched:** 2026-04-20
**Confidence:** HIGH overall (key recommendations cross-verified against vendor docs, NVIDIA developer forums, community benchmarks, and the prior `setup_local_opencode` repo)

> Two architecturally separate parts:
> - **Part 1 (Serving):** vLLM 0.19.x via per-slot pinned containers — Qwen3.6-35B-A3B-FP8 + Qwen3-Coder-Next-80B-A3B-FP8 on NGC `nvcr.io/nvidia/vllm:26.03.post1-py3`; Gemma-4-26B-A4B-it on upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` (Day-1 Gemma 4 release; NGC's 26.03 ships vLLM 0.17.1 + Transformers 4.57.x which pre-date `Gemma4ForCausalLM` — verified 2026-04-23). All served FP8 runtime quant, with XGrammar structured output, EAGLE-3 / Qwen3-MTP speculative decoding, prefix caching + chunked prefill.
> - **Part 2 (Harness):** `@mariozechner/pi-coding-agent` (the "pi.dev" project — `pi-mono` monorepo by Mario Zechner) at v0.68.0 as the runtime SDK, wrapped with custom `pi.registerProvider` for local vLLM endpoints, custom tools, and event-hook observability piped to a self-hosted Langfuse v3 backend over OTLP.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **vLLM** | 0.19.0 / 0.19.1 (April 2026) | Inference engine | First release with full Gemma 4 support (E2B/E4B/26B-A4B/31B), async scheduler on by default, GPU NGram speculative decoding, Model Runner V2. Supersedes 0.13 used in the prior repo. |
| **NGC vLLM Docker image** | `nvcr.io/nvidia/vllm:26.03.post1-py3` | DGX Spark-tuned container | NVIDIA's purpose-built image for GB10 (CUDA 13.1, cuDNN 9.17, FlashInfer kernels, SM121 NVFP4 fixes). Avoids the SM120/SM121 kernel issues seen on plain upstream wheels. Falls back to `26.01-py3` (vLLM 0.13) only if a regression appears. |
| **Qwen3.6-35B-A3B-FP8** | Released 2026-04-16 | Primary general coding/agent model | 35B total / **3B active** MoE, native 262K context (extensible to 1M), Apache 2.0. FP8 fine-grained block-128 quantization gives ~near-original quality. ~75-78 tok/s decode on DGX Spark per NVIDIA forum benchmarks. Successor to the Qwen3-Next-80B winner from the prior repo's eval (8.5/10). |
| **Qwen3-Coder-Next-80B-A3B-FP8** | Released Feb 2026 | Long-horizon agentic coding model | 80B/3B-active MoE, 256K native context, RL-trained on 800K executable tasks for tool use & error recovery. ~30-43 tok/s on single Spark, 75 GB on disk + ~18 GB KV cache. Designed for agentic CLI/IDE scaffolds. |
| **Gemma-4-26B-A4B-it** | Released 2026-04-02 | Second model family (per project requirement: "Gemma 4 first-class") | 26B total / 4B active MoE, 256K context, Apache 2.0, 77.1% LiveCodeBench v6. Achieves ~52 tok/s on DGX Spark with NVFP4 / ~38-40 tok/s FP8 (vs only 6.9 tok/s for the 31B *dense* variant which is bandwidth-bound on GB10). Native function-calling format. |
| **`@mariozechner/pi-coding-agent`** | 0.68.0 (April 2026) | Agent harness / runtime SDK | This **is** "pi.dev" — Mario Zechner's `pi-mono` monorepo. TypeScript/Node.js. SDK-first design exposes every surface the project requires: `registerProvider` (custom local providers), `registerTool` (custom or replace-builtin), `pi.on("tool_call", ...)` event hooks (observability), settings layering (global `~/.pi/agent/`, project `.pi/`), JSONL session persistence with branch/`/tree`. Domain `pi.dev` redirects to the project. MIT license. |
| **`@mariozechner/pi-agent-core`** | 0.68.0 | Underlying agent loop primitives | What `pi-coding-agent` is built on; exposed for direct use if the coding-agent CLI shell is too high-level. Use this if emmy needs to build its own agent loop wholesale. |
| **`@mariozechner/pi-ai`** | 0.68.0 | Unified provider abstraction | The streaming/format layer; emmy's custom vLLM provider plugs in here via `api: "openai-completions"` with optional `streamSimple` override for non-standard fields. |
| **XGrammar** | bundled with vLLM 0.19 (default backend) | Grammar-constrained / structured output | vLLM's default since the JSON-schema rewrite. ~3.5x faster than Outlines, near-zero overhead with grammar caching, vocabulary partitioning gives up to 100x throughput on hot grammars. C++/Rust core. Critical for "weaker models always emit parseable tool calls". |
| **Langfuse** | v3 (self-hosted via Docker Compose) | Observability backend | Open-source (MIT), self-hostable on the Spark itself, OTLP endpoint at `/api/public/otel`, ClickHouse-backed analytics. Emmy's `pi.on("tool_call")` hooks emit OTel GenAI semconv spans → Langfuse. No cloud dependency. (Note: ClickHouse acquired Langfuse Jan 2026 but the OSS project remains MIT and self-hostable.) |
| **OpenTelemetry GenAI semantic conventions** | Experimental but stable enough for 2026 | Trace standard | Standardized in 2026 — same span shapes work against Langfuse, Phoenix, Jaeger, Datadog interchangeably. Decouples instrumentation from backend. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **fastsafetensors** | latest pip | Parallel weight loader | Always set `VLLM_LOAD_FORMAT=fastsafetensors` — 3.25x startup speedup (10 min → 3 min) confirmed in prior repo. Auto-installed in NGC container by start scripts. |
| **FlashInfer** | bundled with NGC vLLM | Attention kernels | DGX Spark requires `VLLM_FLASHINFER_MOE_BACKEND=latency` (the throughput backend has SM120 kernel issues on SM12.1). vLLM bundles its own — do **not** install upstream `flash-attn`. |
| **Speculators** (`vllm-project/speculators`) | latest | Speculative decoding library | Use when wiring EAGLE-3 draft models. RedHatAI publishes pretrained EAGLE-3 speculators for Qwen3 and Gemma 4 31B. For Qwen3.6/Qwen3-Coder-Next, use the model's built-in MTP (Multi-Token Prediction) instead via `--speculative-config '{"method":"qwen3_next_mtp","num_speculative_tokens":2}'`. |
| **Outlines** | (do not install) | Alternative structured output | Skip. XGrammar is faster and is the vLLM default. Only consider if a use case needs Outlines-specific regex features that XGrammar cannot express. |
| **LiteLLM** | optional | Provider abstraction layer | If emmy ever needs to point pi at non-vLLM endpoints (Ollama, llama.cpp) without writing more providers, LiteLLM proxy can sit in front and Langfuse already integrates with it. **Not** in the v1 critical path — pi's own provider system is enough. |
| **terminal-bench** (`tb` CLI) | 2.0 | Primary eval harness | 89 curated Docker-sandboxed terminal tasks with rigorous solvability verification. Local-model-friendly (`tb run --agent terminus --model <local>`). Most reproducible 2026 coding-agent eval. **Use as emmy's primary scoreboard.** |
| **SWE-bench Verified / Pro** | 2026 versions | Secondary eval | 500-task human-filtered (`Verified`) or 1,865-task multi-file (`Pro`) — gold standard for production coding agents but heavier to run. Use mini-swe-agent with vLLM at `http://localhost:8000/v1` for local inference. |
| **LiveCodeBench v6** | 2026 | Algorithm/reasoning eval | Continuously updated competitive-programming problems post-training-cutoff. Lighter to run than SWE-bench; useful sanity check. Gemma 4 31B scores 80%, Qwen3.6 should score similarly. |
| **Aider polyglot** | 2026 | Cross-language sanity check | 225 Exercism exercises across C++/Go/Java/JS/Python/Rust. Optional — use only if multi-language coverage matters. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Docker** + NGC login | vLLM container runtime | Already in prior repo's setup. Use NVIDIA's NGC images, not upstream pip wheels, for DGX Spark. |
| **Node.js 20+** | pi runtime | TypeScript ecosystem; `npm install -g @mariozechner/pi-coding-agent`. |
| **Bun** (optional) | Faster pi extension dev | pi-mono is built with TypeScript — Bun gives faster iteration on extension code. |
| **uv** | Python env mgmt for evals | Standard 2026 Python tool for SWE-bench / terminal-bench harnesses. |
| **direnv + `.envrc`** | Pin per-project env vars | `VLLM_LOAD_FORMAT`, `VLLM_FLASHINFER_MOE_BACKEND`, model paths. |

---

## Installation

```bash
# === Part 1: vLLM serving on DGX Spark ===

# 1. Pull NVIDIA NGC vLLM container (latest April 2026 build)
docker pull nvcr.io/nvidia/vllm:26.03.post1-py3

# 2. Download model weights
huggingface-cli download Qwen/Qwen3.6-35B-A3B-FP8 \
  --local-dir /data/models/Qwen3.6-35B-A3B-FP8
huggingface-cli download Qwen/Qwen3-Coder-Next-FP8 \
  --local-dir /data/models/Qwen3-Coder-Next-FP8
huggingface-cli download google/gemma-4-26B-A4B-it \
  --local-dir /data/models/gemma-4-26B-A4B-it
# (Optional NVFP4 variant for Gemma 4 — 4x smaller, but verify against
#  ModelOpt 0.42.0 NaN bug in weight_scale tensors before using)
# huggingface-cli download nvidia/Gemma-4-31B-IT-NVFP4 ...

# 3. Launch a model (example: Qwen3.6-35B-A3B-FP8)
docker run --gpus all --shm-size=8g \
  -e VLLM_LOAD_FORMAT=fastsafetensors \
  -e VLLM_FLASHINFER_MOE_BACKEND=latency \
  -e VLLM_DISABLE_COMPILE_CACHE=1 \
  -v /data/models:/models \
  -p 8002:8000 \
  nvcr.io/nvidia/vllm:26.03.post1-py3 \
  vllm serve /models/Qwen3.6-35B-A3B-FP8 \
    --max-model-len 262144 \
    --gpu-memory-utilization 0.75 \
    --kv-cache-dtype fp8 \
    --attention-backend flashinfer \
    --enable-prefix-caching \
    --enable-chunked-prefill \
    --max-num-batched-tokens 16384 \
    --reasoning-parser qwen3 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --speculative-config '{"method":"qwen3_next_mtp","num_speculative_tokens":2}'

# === Part 2: pi.dev harness ===

npm install -g @mariozechner/pi-coding-agent@0.68.0
# Or for SDK use in emmy's own code:
npm install @mariozechner/pi-coding-agent @mariozechner/pi-agent-core @mariozechner/pi-ai

# === Observability ===

git clone https://github.com/langfuse/langfuse
cd langfuse && docker compose up -d   # Langfuse Web + Worker + ClickHouse
# Configure pi extension to emit OTel spans to http://localhost:3000/api/public/otel
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **vLLM 0.19.x** (NGC container) | SGLang | If RadixAttention prefix-cache reuse exceeds vLLM's APC for emmy's specific multi-turn workload. SGLang published competitive Qwen3-Coder-Next numbers (60.5 tok/s on 2-node TP=2). Worth a Phase-2 A/B test, **not** a v1 default. |
| **vLLM 0.19.x** | TensorRT-LLM / NVIDIA NIM | Theoretically faster on Blackwell, but NIM has incomplete coverage of Qwen3.6/Gemma 4 on DGX Spark as of April 2026 (per NVIDIA forum complaints). Defer. |
| **vLLM 0.19.x** | llama.cpp / Ollama | Lower memory ceiling, GGUF ecosystem, easier multi-OS, but loses MoE throughput, structured output speed, and speculative decoding control. Use only as a fallback if vLLM fails. |
| **Qwen3.6-35B-A3B-FP8** | Qwen3-Coder-Next-80B-A3B-FP8 | The 80B coder is the right pick for **long-horizon agentic** tasks (RL-trained for tool use + error recovery). Run **both** — 35B for fast turns, 80B for hard agent loops. Use multi-model routing in pi. |
| **Qwen3.6-35B-A3B-FP8** | MiniMax-M2-REAP-162B-A10B | The prior repo's runner-up (8.1/10). 10B active is heavier and slower; only revisit if Qwen3.6 regresses on long-context or specific code idioms. |
| **Gemma-4-26B-A4B-it (MoE)** | Gemma-4-31B-it (Dense) | The 31B *dense* model is **6.9 tok/s on DGX Spark** (memory-bandwidth bound — reads ~31 GB per token). The 26B MoE is **~7x faster at 38-52 tok/s**. Choose 31B dense only if quality gap proves significant and you can tolerate the latency. |
| **Gemma-4-26B-A4B-it FP8 runtime** | Gemma-4-31B NVFP4 | NVFP4 is ~6% faster than FP8 runtime *but* the ModelOpt 0.42.0 NVFP4 checkpoint has scattered FP8 NaN values in weight_scale tensors (39/60 layers affected — produces garbage output). Stick with FP8 runtime quantization until ModelOpt is patched. |
| **XGrammar** | Outlines | Outlines for prototyping or when emmy needs regex-style constraints XGrammar lacks; otherwise XGrammar is the production default and is faster + lower compile-failure rate. |
| **EAGLE-3 / Qwen3-MTP** | n-gram speculative decoding | n-gram (`--speculative-config '{"method":"ngram",...}'`) is zero-setup but lower acceptance rate. Use for Gemma 4 if a quality EAGLE-3 head is unavailable; use MTP for Qwen3.6/3-Coder-Next (built-in). RedHatAI publishes EAGLE-3 speculators for Gemma-4-31B-it (`RedHatAI/gemma-4-31B-it-speculator.eagle3`). |
| **`pi-coding-agent` SDK** | Build directly on `pi-agent-core` | Use `pi-agent-core` if emmy decides the "coding agent" framing is too constraining and wants a totally bespoke loop. Default to `pi-coding-agent` for v1 — fastest path with all tool/session/extension infrastructure already there. |
| **Self-hosted Langfuse** | Arize Phoenix (self-hosted) | Phoenix is also good and owns the OpenInference standard. Choose Langfuse for prompt management + datasets in the same UI; choose Phoenix if emmy will lean on OpenInference auto-instrumentation across many frameworks. Both speak OTLP — switching later is cheap. |
| **terminal-bench 2.0** | SWE-bench Verified | terminal-bench is **easier to set up and reproduces faster** — better fit for daily-driver iteration. Add SWE-bench Verified later as the gold-standard milestone scoreboard. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **vLLM 0.13** (NGC `vllm:26.01-py3`, prior repo default) | Pre-Gemma-4 support, no async scheduler default, no Model Runner V2, missing 2026 structured-output rewrite. | vLLM 0.19.x via `nvcr.io/nvidia/vllm:26.03.post1-py3`. |
| **Upstream `pip install vllm` wheel** on DGX Spark | SM120/SM121 FlashInfer kernel issues; missing NVIDIA's GB10-specific patches. | NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3`. |
| **Pre-quantized FP8 Gemma 4 31B checkpoints** | Known bug: `KeyError: 'layers.0.mlp.down_proj.weight_scale'` (vllm-project/vllm #39407, logit saturation at softcap wall). | Load BF16 weights with `--quantization fp8` for runtime quantization. |
| **NVFP4 / FP4 quantization on DGX Spark** (broadly) | DGX Spark's unified memory means there is no VRAM pressure to amortize dequant cost. NVFP4/turbo3/turbo4 can be **slower than FP16** on GB10 (-23.6% at 32K context). Plus the ModelOpt 0.42.0 NaN bug. | FP8 — sweet spot for DGX Spark. Use BF16 only if FP8 is broken for a specific model. |
| **Gemma-4-31B Dense** for interactive use | 6.9 tok/s — memory-bandwidth-bound on GB10. Unusable for daily-driver coding. | Gemma-4-26B-A4B-it (MoE, 38-52 tok/s). |
| **Llama-3.3-70B / DeepSeek-R1-70B dense** on DGX Spark | ~5 tok/s — same bandwidth bottleneck. Already documented unusable in prior repo. | MoE models with 3-5B active params. |
| **Outlines as the default structured-output backend** | Compilation timeouts on complex schemas (lowest compliance rate in 2026 JSONSchemaBench), 3.5x slower than XGrammar in vLLM. | XGrammar (vLLM default). |
| **Claude Code or opencode as the harness** | Per project requirements: opaque tool format, agent loop, context mgmt, sampling control. The whole reason emmy exists. | `@mariozechner/pi-coding-agent` (pi-mono). |
| **Hosted LangSmith** | Cloud dependency violates the "no cloud in critical path" constraint. | Self-hosted Langfuse v3 or Phoenix. |
| **Skipping `VLLM_LOAD_FORMAT=fastsafetensors`** | Cold start jumps from ~3 min to ~10 min. Already proven in prior repo. | Always set the env var (NGC scripts auto-install if missing). |
| **`stream: true` without proxy field stripping** | vLLM emits `reasoning_content: null` and other non-OpenAI-standard fields that hang `@ai-sdk/openai-compatible` clients. Documented in prior repo's compat proxy. | Either configure pi's `streamSimple` to strip these, or keep a thin compat proxy in front of vLLM. |
| **`--enable-thinking: true` for tool-heavy loops without budget control** | GLM and similar models can spend 30-60s on hidden reasoning before any visible content (prior repo lesson). | Use `chat_template_kwargs: {"reasoning_effort": "low"}` or disable thinking for tool-call turns; enable for plan turns only. |

---

## Stack Patterns by Variant

### If goal is "minimum viable daily driver" (Phase 1)
- One model: **Qwen3.6-35B-A3B-FP8**
- vLLM with prefix caching + chunked prefill + MTP speculative decoding
- pi-coding-agent CLI with built-in tools, no custom extensions yet
- terminal-bench 2.0 for nightly scoring
- No Langfuse yet — use pi's JSONL session logs

### If goal is "first-class plurality" (Phase 2 — explicit project requirement)
- Two backends running, one at a time (128 GB ceiling): swap via container restart
  - Slot A: Qwen3.6-35B-A3B-FP8 (general)
  - Slot B: Gemma-4-26B-A4B-it (Gemma family — also general)
- Optional Slot C: Qwen3-Coder-Next-80B-A3B-FP8 (heavy agentic loops)
- pi extension with `pi.registerProvider` for each, plus a router-style command (`/model qwen35`, `/model gemma`, `/model coder80`) — model profile abstraction lives at the extension layer.

### If goal is "research artifact reproducibility"
- Pin every version: NGC container digest, model commit SHAs, pi-coding-agent version, terminal-bench dataset version.
- Self-hosted Langfuse capturing every trace; export traces as part of the artifact.
- Pinned sampling profiles per model (versioned YAML), surfaced in both vLLM `--override-generation-config` and pi extension.
- Eval suite: terminal-bench 2.0 + Aider polyglot + the prior repo's Phase-1 prompts (per project constraint).

### If a specific tool needs strict JSON
- Use vLLM's `extra_body.guided_json` or `response_format: {"type": "json_schema", ...}` — XGrammar enforces the schema at decode time.
- Define schemas in pi extension alongside the tool definition; pass them through on each tool-call turn.

### If latency is the bottleneck (long agent loops)
- Enable EAGLE-3 (Gemma 4) or MTP (Qwen 3.x) speculative decoding — 2-3x effective tokens/sec with no quality loss.
- Tune `--max-num-batched-tokens` to 8K-16K for low TTFT (interactive feel) vs 32K+ for offline batch evals.
- Set `--async-scheduling` (default in 0.19) and verify chunked prefill is on.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| vLLM 0.19.x | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` | Confirmed loads Nemotron-3-Super-120B-A12B-NVFP4; works for Qwen3.6 and Gemma 4. |
| Qwen3.6-35B-A3B-FP8 | vLLM ≥ 0.19 (best with 0.19.1rc1.dev337+) | Tool-call parser `qwen3_coder`, reasoning parser `qwen3`, MTP via `qwen3_next_mtp`. |
| Qwen3-Coder-Next-FP8 | vLLM 0.15.1+ (transformers 5) **or** vLLM 0.19+ | Community confirmed on `vllm-node-tf5` image; NGC 26.03 also works. |
| Gemma-4-26B-A4B / 31B | vLLM ≥ 0.19.0 only | 0.19.0 (April 2, 2026) shipped Day-0 Gemma 4 support. Earlier versions will not load it. |
| Gemma-4 FP8 | vLLM 0.19+, BF16 weights + `--quantization fp8` | Pre-quantized FP8 checkpoints are buggy (#39049, #39407). Use runtime quant. |
| EAGLE-3 speculators | vLLM 0.19+, `draft_tensor_parallel_size: 1` | EAGLE drafts must run TP=1 even if target uses TP>1. |
| pi-coding-agent 0.68.0 | Node.js ≥ 20 | TypeScript ESM. Provides `createAgentSessionRuntime` and `AgentSessionRuntime` for embedded use. |
| pi extensions | pi-coding-agent ≥ 0.68 | `pi.registerProvider`, `pi.registerTool`, `pi.on(...)` event hooks all stable. |
| Langfuse v3 | OTLP HTTP | `/api/public/otel` endpoint — point pi's OTel exporter here. ClickHouse + Postgres + Redis backing services. |
| terminal-bench 2.0 | Docker + Python 3.11+ | `tb run --agent terminus --model openai/<vllm-model> --base-url http://localhost:8002/v1`. |

### Critical hardware-fit envelope (DGX Spark, 128 GB unified)

| Model | Disk | Loaded VRAM | KV cache @ 256K | Total | Headroom |
|-------|------|-------------|-----------------|-------|----------|
| Qwen3.6-35B-A3B-FP8 | ~35 GB | ~38 GB | ~18 GB | ~56 GB | ✓ Plenty |
| Qwen3-Coder-Next-80B-A3B-FP8 | ~75 GB | ~78 GB | ~18 GB | ~96 GB | ✓ Tight but OK at gpu-mem-util 0.75 |
| Gemma-4-26B-A4B-it FP8 (runtime) | ~52 GB BF16 | ~28 GB FP8 | ~16 GB | ~44 GB | ✓ Plenty |
| Gemma-4-31B-Dense FP8 (runtime) | ~62 GB BF16 | ~32 GB FP8 | ~16 GB | ~48 GB | Memory OK; **bandwidth-bound at 6.9 tok/s — avoid**. |

Single-model-at-a-time rule from prior repo still applies; container swap is the model switch.

---

## Confidence per Recommendation

| Recommendation | Confidence | Why |
|----------------|------------|-----|
| vLLM 0.19.x as serving engine | **HIGH** | Verified via vLLM GitHub releases, NVIDIA NGC catalog, multiple April 2026 forum posts. |
| NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` | **HIGH** | NVIDIA developer forum (mid-April 2026) confirms it loads on DGX Spark. |
| Qwen3.6-35B-A3B-FP8 as primary model | **HIGH** | Released 2026-04-16, Apache 2.0, HF model card + NVIDIA forum benchmarks confirm it works at 75-78 tok/s on DGX Spark. Direct successor to prior repo's winner. |
| Qwen3-Coder-Next-80B for agentic coding | **HIGH** | Multiple DGX Spark deploy guides, official Qwen blog, Unsloth docs. Known-good on Spark at 30-43 tok/s. |
| Gemma-4-26B-A4B-it (MoE, not 31B Dense) | **HIGH** | NVIDIA forum benchmarks: 31B dense = 6.9 tok/s vs 26B MoE = 38-52 tok/s on DGX Spark. Project requires "Gemma 4 first class" — the MoE variant is the only practical Gemma 4 for interactive use here. |
| pi-coding-agent (pi-mono) as harness | **HIGH** | Verified npm version 0.68.0 (April 2026), MIT, repo active, SDK surface (`registerProvider`, `registerTool`, `on()`, `createAgentSessionRuntime`) covers all eight project pain-point axes. |
| XGrammar over Outlines | **HIGH** | vLLM default, multiple 2026 benchmark sources confirm 3-100x faster + higher compliance rate. |
| EAGLE-3 (Gemma) / MTP (Qwen) for spec decode | **HIGH** | RedHatAI publishes EAGLE-3 speculators for Gemma-4-31B-it; Qwen3.6 model card documents MTP setup directly. |
| Self-hosted Langfuse v3 | **MEDIUM-HIGH** | OSS, MIT, Docker-deployable; ClickHouse acquisition Jan 2026 introduces governance risk but the OSS code remains MIT. Acceptable for a personal/research artifact. |
| FP8 over NVFP4 on DGX Spark | **HIGH** | NVIDIA forum thread (197 replies) explicitly recommends FP8/BF16 over NVFP4/FP4 due to dequant overhead exceeding bandwidth savings on GB10 unified memory + ModelOpt NaN bug. |
| terminal-bench 2.0 as primary eval | **MEDIUM-HIGH** | Most reproducible 2026 coding-agent benchmark (Stanford × Laude); Docker-sandboxed; local-model first-class. Lower confidence only because the project explicitly references continuing prior `setup_local_opencode` Phase-1 prompts — those should be **added to**, not replaced by, terminal-bench. |
| Async scheduler + chunked prefill on by default in 0.19 | **HIGH** | vLLM 0.19.0 release notes confirm async scheduler is default; chunked prefill default in V1. |
| `VLLM_FLASHINFER_MOE_BACKEND=latency` | **MEDIUM** | Reported by community (vLLM Forums NVIDIA DGX Spark thread) due to throughput backend SM120 issues; verify on current container before locking in. |

---

## Sources

### Authoritative (HIGH-confidence)
- [vLLM GitHub Releases](https://github.com/vllm-project/vllm/releases) — version history, 0.19.0 release notes
- [vLLM 0.19 / Gemma 4 / gRPC blog post (Fazm, April 2026)](https://fazm.ai/blog/vllm-update-april-2026) — verified version & feature list
- [NVIDIA NGC Catalog: vLLM container](https://catalog.ngc.nvidia.com/orgs/nvidia/containers/vllm) — official DGX Spark container source
- [NVIDIA Developer Forum: Qwen3.6-35B-A3B + FP8 on DGX Spark](https://forums.developer.nvidia.com/t/qwen-qwen3-6-35b-a3b-and-fp8-has-landed/366822) — flags, throughput numbers
- [NVIDIA Developer Forum: Gemma 4 31B FP8 benchmarks on DGX Spark](https://forums.developer.nvidia.com/t/gemma-4-31b-on-dgx-spark-runtime-fp8-benchmarks-single-dual-node-tp-2/365814) — 6.9 tok/s dense baseline
- [NVIDIA Developer Forum: NGC vllm:26.03.post1-py3 release](https://forums.developer.nvidia.com/t/new-nvcr-io-nvidia-vllm-26-03-post1-py3-loads-nemotron-3-super-120b-a12b-nvfp4/366928)
- [NVIDIA Developer Forum: PSA on FP4/NVFP4 state for DGX Spark](https://forums.developer.nvidia.com/t/psa-state-of-fp4-nvfp4-support-for-dgx-spark-in-vllm/353069/197) — recommends FP8/BF16 over FP4 on GB10
- [HuggingFace: Qwen/Qwen3.6-35B-A3B-FP8](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) — model card, sampling defaults, vLLM commands
- [HuggingFace blog: Welcome Gemma 4](https://huggingface.co/blog/gemma4) — official model IDs, performance, license
- [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) — variant lineup
- [vLLM Recipes: Qwen3.5 / Qwen3.6 usage guide](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)
- [vLLM Structured Outputs docs](https://docs.vllm.ai/en/latest/features/structured_outputs/) — XGrammar default
- [vLLM Forums: NVIDIA DGX Spark compatibility](https://discuss.vllm.ai/t/nvidia-dgx-spark-compatibility/1756) — `VLLM_FLASHINFER_MOE_BACKEND=latency`
- [pi-mono GitHub repo (Mario Zechner)](https://github.com/badlogic/pi-mono) — the actual "pi.dev" project
- [pi-coding-agent custom-provider docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md) — `pi.registerProvider` API
- [npm @mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) — verified version 0.68.0
- [Qwen3-Coder-Next blog (qwen.ai)](https://qwen.ai/blog?id=qwen3-coder-next) — Coder-Next release
- [Qwen3-Coder-Next on DGX Spark guide (NVIDIA forum)](https://forums.developer.nvidia.com/t/how-to-run-qwen3-coder-next-on-spark/359571)
- [eugr/spark-vllm-docker recipes](https://github.com/eugr/spark-vllm-docker) — community DGX Spark vLLM configs

### Supporting (MEDIUM-confidence)
- [Red Hat Developer: Speculators / EAGLE-3 production guide](https://developers.redhat.com/articles/2025/11/19/speculators-standardized-production-ready-speculative-decoding)
- [Red Hat Developer: Fly Eagle(3) fly](https://developers.redhat.com/articles/2025/07/01/fly-eagle3-fly-faster-inference-vllm-speculative-decoding)
- [Kaitchup: DFlash for Qwen3.5, EAGLE for Gemma 4](https://kaitchup.substack.com/p/dflash-for-qwen35-eagle-for-gemma)
- [BentoML: Structured Decoding in vLLM](https://www.bentoml.com/blog/structured-decoding-in-vllm-a-gentle-introduction)
- [Terminal-Bench (tbench.ai)](https://www.tbench.ai/) and [GitHub repo](https://github.com/laude-institute/terminal-bench)
- [SWE-bench Verified](https://www.swebench.com/verified.html) and [SWE-bench inference docs](https://www.swebench.com/SWE-bench/reference/inference/)
- [mini-SWE-agent local models docs](https://mini-swe-agent.com/latest/models/local_models/)
- [Langfuse self-hosting docs](https://langfuse.com/self-hosting) and [Langfuse + OTEL guide](https://langfuse.com/integrations/native/opentelemetry)
- [OpenTelemetry GenAI semantic conventions overview (March 2026)](https://earezki.com/ai-news/2026-03-21-opentelemetry-just-standardized-llm-tracing-heres-what-it-actually-looks-like-in-code/)
- [Morph LLM: AI Coding Benchmarks 2026](https://www.morphllm.com/ai-coding-benchmarks-2026)

### Internal / prior work
- `/data/projects/setup_local_opencode/README.md` — prior repo architecture, fastsafetensors, port map, model lineup
- `/data/projects/setup_local_opencode/validation/EXECUTIVE_SUMMARY.md` — Qwen3-Next-80B winner at 8.5/10
- `/data/projects/setup_local_opencode/validation/COMPREHENSIVE_FINAL_ANALYSIS.md` — system prompt delivery + endpoint pitfalls

---

*Stack research for: Fully-local coding agent on DGX Spark (Emmy)*
*Researched: 2026-04-20*
*Author: GSD project researcher (Stack dimension)*
