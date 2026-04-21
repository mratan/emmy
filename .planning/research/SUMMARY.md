# Project Research Summary

**Project:** Emmy
**Domain:** Local-first coding agent (vLLM serving + pi.dev harness on NVIDIA DGX Spark)
**Researched:** 2026-04-20
**Confidence:** HIGH

## Executive Summary

Emmy is a personal-scale, research-grade coding agent in two architecturally distinct layers on a single DGX Spark: a specialized vLLM serving framework (grammar-constrained tool output, speculative decoding, coding-tuned sampling) and a pi.dev harness exposing every surface the off-the-shelf agents hide. Two equal mandates — daily-driver replacement for Claude Code, and a reproducible research artifact verifiable by any Spark owner. Research across all four dimensions converges on a single keystone abstraction: **versioned model profiles as first-class artifacts shared by both layers**. This is what makes both mandates achievable without framework sprawl.

Primary model: `Qwen/Qwen3.6-35B-A3B-FP8` (~75 tok/s, 3B-active MoE, released 2026-04-16) running in NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3`. Second model family: `google/gemma-4-26B-A4B-it` (MoE, 38–52 tok/s FP8 runtime quant — *not* the 31B dense, which is bandwidth-bound at 6.9 tok/s on Spark). Heavy-agent-loop slot: `Qwen/Qwen3-Coder-Next-80B-A3B-FP8`. Harness: `@mariozechner/pi-coding-agent` v0.68.0 (the "pi.dev" the project author meant — pi-mono by Mario Zechner, MIT, TypeScript/Node). The single highest-leverage engineering move confirmed by all four dimensions: adopt **hash-anchored edits** as the default edit format (documented 6.7% → 68.3% on 180 tasks for weaker models) and build the profile system before everything else.

Four critical risks to design against from day one: (1) the **"more prompting" trap** — prior repo's Qwen3 went 8.5 → 6.8 by adding prompt rules; Phase 2 must always run the full eval suite, never subsets; (2) **silent system-prompt delivery failure** — prior Phase 3 produced 0/5 task success with no warning; an `[SP_OK]` canary token must gate every benchmark loop; (3) **KV cache budget set from theory on UMA** — harness + vLLM + CPU all share Spark DRAM; start at `gpu_memory_utilization=0.75` and validate with 30-min sustained load; (4) **hidden cloud dependencies** — vLLM telemetry on by default, HF gated-model auth, pip mirrors; verify with explicit air-gap test before any reproducibility claim.

## Key Findings

### Recommended Stack

vLLM 0.19.x in NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3` (never upstream PyPI wheels on DGX Spark — SM121 kernel failures). XGrammar (vLLM 0.19 default, 3.5–100× faster than Outlines) for structured tool-call output. Qwen3-MTP for speculative decoding on Qwen models; EAGLE-3 (RedHatAI publishes pretrained speculators) for Gemma 4. Self-hosted Langfuse v3 (Docker Compose) + OpenTelemetry GenAI semconv for observability. Primary eval: terminal-bench 2.0; gold-standard milestone: SWE-bench Verified; rolling contamination-resistant: LiveCodeBench. FP8 everywhere on DGX Spark — NVFP4 is *slower* than FP16 on GB10 UMA (-23.6% at 32K context) and ModelOpt 0.42.0 has a NaN bug.

**Core technologies:**

- `nvcr.io/nvidia/vllm:26.03.post1-py3`: serving container — only build with GB10-specific FlashInfer patches and Day-0 Gemma 4 support
- `Qwen/Qwen3.6-35B-A3B-FP8`: primary general model — 75–78 tok/s, ~56 GB total (model + KV), direct successor to prior repo's Qwen3-Next winner
- `Qwen/Qwen3-Coder-Next-80B-A3B-FP8`: heavy-agent-loop slot — RL-trained on 800K executable tasks, 30–43 tok/s
- `google/gemma-4-26B-A4B-it`: Gemma 4 first-class slot — MoE, 38–52 tok/s; the 31B dense is unusable on Spark
- `@mariozechner/pi-coding-agent` v0.68.0: harness substrate — TypeScript/Node, MIT, exposes `registerProvider`/`registerTool`/`on()`/`AgentSessionRuntime`
- XGrammar (vLLM 0.19 default): structured output backend
- Qwen3-MTP / EAGLE-3 (RedHatAI): speculative decoding methods
- Self-hosted Langfuse v3 + OTel GenAI semconv: observability
- terminal-bench 2.0 + SWE-bench Verified + LiveCodeBench: eval triad
- prior `setup_local_opencode` Phase 1 prompts: historical baseline (kept for continuity)

### Expected Features

18 verified table-stakes features (~10 already in pi-mono, ~8 are emmy-specific work). 14 differentiators ranked P1/P2/P3. 13 anti-features explicitly rejected with reasoning to prevent re-adding.

**Must have (table stakes):**

- File read / write / edit, bash execution, glob/grep search — pi-mono native
- Sessions with branching, slash commands, compaction, AGENTS.md/SYSTEM.md — pi-mono native
- Multi-provider model registration — pi-mono native
- MCP support (as a pi extension, not a fork — opens 10k+ public servers; LF-governed since Dec 2025)
- Hash-anchored edit format as default — Hashline pattern, 6.7→68.3% on 180 tasks for weaker models
- Web fetch tool — table stakes for 2026 coding agents
- Versioned model-profile abstraction (the keystone)
- Grammar-constrained tool output (XGrammar) — guarantees parseable tool calls for weaker models
- System-prompt-echo (`[SP_OK]`) canary in every benchmark loop

**Should have (competitive):**

- Lived-experience telemetry as publishable HF dataset (uniquely a local-agent move — cloud agents can't publish due to TOS)
- Multi-model routing (planner / editor / critic across profiles)
- Eval runner that imports the harness as a library (not bypassing it)
- Reproducible benchmark suite extending prior repo's Phase 1 prompts
- A/B comparison of model profiles
- Session replay
- Provenance dump (every benchmark result embeds `{profile.id, profile.version, profile.hash}`)
- TUI footer showing GPU / KV cache / spec-decode acceptance rate

**Defer (v2+):**

- LSP integration / repo map (large complexity; recommend defer unless Phase 1 daily-driving exposes navigation as the dominant pain point)
- IDE plugin
- Dual-model simultaneous loading (RAM-tight on 128 GB; experiment in Phase 6)
- Plugin marketplace

### Architecture Approach

Two hard boundaries, the rest soft. (1) `harness ↔ emmy-serve` over loopback HTTP using OpenAI-compat with `extra_body` for grammar/`chat_template_kwargs` overrides. (2) Both layers `↔` profile registry over the on-disk schema. Everything else (context assembly, model router, tools, observability) lives in a single host process. Splitting further is overkill for a single-user tool and weakens tracing. vLLM runs in NGC Docker container; harness runs on host in a uv-venv (or npm if TS). HTTP loopback overhead is negligible vs the 24–77s/task timings observed in the prior repo.

**Major components:**

1. **Profile registry** (on-disk, content-hashed) — versioned `serving.yaml` + `harness.yaml` + `prompts/` + `tool_schemas/` + `grammars/` + `PROFILE_NOTES.md`; the only shared contract between layers
2. **emmy-serve** — vLLM 0.19.x in NGC container, profile-aware boot, hot-reload for harness fields, restart for engine fields
3. **Harness host process** — pi-mono runtime + custom provider for local vLLM endpoint + tool layer + context assembler + model router + observability bus
4. **Eval runner** — imports the harness as a library, drives `session.run(task)` through the public SDK; never bypasses
5. **Observability stack** — Langfuse v3 + OTel GenAI semconv; spans across vLLM ↔ harness boundary; profile fields embedded in every event
6. **Lived-experience journal** — JSONL append-only, profile-tagged, exportable to HF dataset

### Critical Pitfalls (top 8 of 20)

1. **"More prompting" trap** (Critical) — prior repo's Qwen3 regressed 8.5 → 6.8 by adding rules. Phase 2 must run the *full* eval suite before declaring any prompt change positive. Subset tests hide regression. Prefer positive instructions over negative.
2. **System-prompt delivery silently broken** (Critical) — vLLM `/v1/messages` and `/v1/chat/completions` handle system messages differently per chat template. "Generic 300-char response" looks like model failure, is delivery failure. Mitigation: `[SP_OK]` canary + log assembled prompt hash.
3. **KV cache budget set from theory** (Critical) — DGX Spark UMA shares model weights + KV cache + harness CPU workload. Default `gpu_memory_utilization=0.95` causes preemption. Start at 0.75, validate explicitly. Zero preemption in steady-state is the gate.
4. **DGX Spark thermal throttle** (High) — short benchmarks look fine; 2-hour sessions throttle 2.8 → ~2 GHz. Run a 2-hour sustained-load thermal validation per profile.
5. **Hidden cloud dependencies** (Critical for thesis) — `VLLM_NO_USAGE_STATS=1` required; HF gated models need auth even offline. Verify with air-gap test. "Fully local" is the thesis; leaking it silently is an embarrassment.
6. **Grammar fighting the model** (Critical for Gemma/Qwen-class) — constrained decoding is a correctness backstop, not a quality lever. Parse unconstrained first; retry under grammar on parse failure only. Include a no-grammar baseline in every profile.
7. **Speculative decoding regression** (High) — only wins when draft is cheap, acceptance > 0.5, and workload isn't compute-saturated. Always run spec-on vs spec-off paired benchmark on the actual coding workload.
8. **Test-set contamination** (Critical for research mandate) — HumanEval and original SWE-bench likely in 2026 pretraining. Use terminal-bench 2.0, LiveCodeBench, SWE-bench Verified. Include held-out and rephrased contamination controls.

## Implications for Roadmap

Suggested phase structure (synthesized from all four dimensions; roadmapper may adjust):

### Phase 1: Serving Baseline + Profile Schema

**Rationale:** Profile schema is the keystone abstraction; everything novel depends on it. The serving layer is the foundation everything else points at. NGC container + Qwen3.6-35B-A3B-FP8 + prefix caching + chunked prefill + a v1 `serving.yaml`/`harness.yaml` schema. Includes `[SP_OK]` canary smoke test, telemetry-off + air-gap verification, KV-budget calculation, and quantization compile-rate validation from the start (per critical pitfalls).

**Delivers:** working vLLM endpoint serving one profile end-to-end, with profile schema and registry on disk; reproduces prior repo's Phase 1 baseline against the new stack to confirm parity (or improvement).

**Addresses:** the "stand on shoulders" defaults principle, KV cache pitfall, system-prompt-echo pitfall, hidden-cloud-dependency pitfall.

### Phase 2: Minimal Pi-Harness + Daily-Driver Baseline

**Rationale:** Custom pi provider for the local vLLM endpoint, port the prior repo's compat-proxy lessons (strip `reasoning_content`, etc.), wire 4 minimal tools (read/write/edit/bash with hash-anchored edits as default). Validates the substrate end-to-end and unblocks daily-driving for the author. Hash-anchored edits implemented now, not as an afterthought.

**Delivers:** a usable agent the author can try as daily driver against one profile. Bash-first tool design, layered ReAct stopping conditions, structured tool-result truncation per pitfalls.

**Addresses:** all 8 harness pain-point axes from PROJECT.md; Hashline differentiator; system-prompt scaffolding bloat pitfall.

### Phase 3: Context, Observability, Agent-Loop Hardening

**Rationale:** Three independent modules buildable in parallel after Phase 2. Context assembler (smart pruning, repo-map-style summarization), observability bus (Langfuse v3 + OTel GenAI semconv), agent-loop hardening (retry logic, self-correction, infinite-loop guards). Lived-experience telemetry feedback keybinds also live here.

**Delivers:** rich context management, full observability across vLLM ↔ harness boundary, robust loop semantics; lived-experience JSONL stream tagged with active profile.

**Addresses:** infinite ReAct loop pitfall, tool-result truncation pitfall, sub-agent black box pitfall, daily-driver/research-artifact tension (subjective journal).

### Phase 4: Gemma 4 Profile + Profile System Maturity

**Rationale:** Add the second first-class model. Forces the profile abstraction to actually be model-agnostic. CI-validated profile schema, profile validation smoke test per profile, profile SHA in result files.

**Delivers:** Gemma-4-26B-A4B-it as a working profile; pi `registerProvider` for its quirks; the profile system proven on plurality.

**Addresses:** profile sprawl pitfall, model-shaped logic in code (anti-pattern), local-model weakness asymmetry (per-profile scaffolding).

### Phase 5: Eval Harness + Reproducible Benchmark Suite

**Rationale:** Can start parallel with Phase 3. Imports the harness as a library — never bypasses. terminal-bench 2.0 primary, prior repo's Phase 1 prompts as historical baseline, SWE-bench Verified as milestone scoreboard, LiveCodeBench rolling. Profile version is a first-class eval axis.

**Delivers:** a reproducible benchmark suite anyone with a DGX Spark can re-run; JSON + markdown output; provenance dump.

**Addresses:** test-set contamination pitfall, benchmark variance pitfall (≥3 samples + std), LLM-as-judge bias (paired with executable correctness).

### Phase 6: Speculative Decoding + Latency Polish

**Rationale:** Spec decode is a polish move — only wins under specific conditions. Needs working profiles + eval to measure correctly. Qwen3-MTP for Qwen, EAGLE-3 for Gemma 4 (verify availability for 26B variant). Multi-model routing UX also lands here.

**Delivers:** validated spec-decode configs in each profile; multi-model routing (planner/editor/critic).

**Addresses:** speculative decoding regression pitfall (paired benchmark gate), multi-model routing overhead pitfall.

### Phase 7: Research-Grade Publication

**Rationale:** Polish the artifact. Pin everything to digests, write methodology doc, publish lived-experience HF dataset, write up findings.

**Delivers:** public benchmarks, methodology, dataset, and a README anyone can reproduce from a clean DGX Spark.

**Addresses:** research-artifact mandate completion.

### Phase Ordering Rationale

- **MVP spine is forced sequential:** Profile schema → serving stack → profile-aware vLLM client → minimal harness with 4 tools. This is dependency-forced and not splittable.
- **After Phase 2, Phases 3, 4, and 5 can overlap.** Phase 5 needs only the Phase 2 SDK entry point.
- **Phase 6 (spec decode) requires working profiles + eval.** Sequencing it later avoids measuring it against an unstable baseline.
- **Phase 7 (publication) is last** because it depends on all prior work being stable.
- **Conditional escalation:** if grammar-constrained tool calls turn out to be required for the agent to function at all with Gemma 4, XGrammar moves into the MVP spine (Phase 1) before Phase 2 ships.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2:** Emmy harness language choice — TypeScript (pi SDK directly) or Python (calling pi as subprocess) — affects observability bus implementation
- **Phase 4:** EAGLE-3 speculator availability for Gemma-4-26B-A4B specifically (RedHatAI publishes for 31B); Gemma 4 chat template handling for tool calls (Hermes-style or its own)
- **Phase 5:** SWE-bench Verified + mini-swe-agent API compatibility with vLLM 0.19.x; which SWE-bench-Lite subset is reproducible offline on Spark in a single eval run
- **Phase 6:** Qwen3.6 MTP acceptance rates on coding workloads (most public benchmarks are chat); whether two profiles can co-load on 128 GB UMA for true multi-model routing without container swaps

Phases with standard patterns (skip research-phase):

- **Phase 1:** stack already deeply researched; planning can start from STACK.md directly
- **Phase 7:** publication is process work, not technical research

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | All key choices verified: NGC container, model throughput on Spark (forum #366822, #365814), FP8 vs NVFP4 tradeoff (forum #353069), pi-mono v0.68.0 npm |
| Features | HIGH | Table-stakes cross-verified against 10+ 2026 agent codebases; hash-anchored edit results verified (Hashline writeup); MCP adoption verified (LF governance Jan 2026) |
| Architecture | HIGH on shape, MEDIUM on 2 seams | HTTP boundary, profile registry, in-process harness: strong prior art. Hot-reload semantics and eval concurrency model depend on measurements not yet taken. |
| Pitfalls | HIGH | Most pitfalls cite reproducible incidents with GitHub issue numbers or direct prior-repo data (first-party evidence from `setup_local_opencode` Phase 2 and Phase 3) |

**Overall confidence:** HIGH

### Gaps to Address

- **Harness language (TS vs Python):** Resolve in Phase 2 design. Default lean: TypeScript directly on pi-mono SDK (lowest impedance), with Python eval scripts calling the harness via a small CLI/HTTP shim.
- **Optimal `max_num_batched_tokens` for real coding-agent prefill sizes (10K–40K tokens):** Resolve in Phase 1 profile bring-up via measurement, not theory.
- **`VLLM_FLASHINFER_MOE_BACKEND=latency` necessity on `26.03.post1-py3`:** Verify in Phase 1 execution; documented for older containers.
- **Two-models-loaded-simultaneously on 128 GB UMA:** Defer to Phase 6 experiment; do not gate earlier phases on this.

## Sources

### Primary (HIGH confidence)

- [pi-mono / pi-coding-agent (badlogic) on GitHub](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) — pi.dev identification
- [Pi: The Minimal Agent Within OpenClaw — Armin Ronacher (2026)](https://lucumr.pocoo.org/2026/1/31/pi/) — pi philosophy
- [@mariozechner/pi-coding-agent on npm](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) — version 0.68.0
- [vLLM SamplingParams source](https://github.com/vllm-project/vllm/blob/main/vllm/sampling_params.py) — profile schema reference
- [vLLM Structured Outputs (GuidedDecodingParams)](https://docs.vllm.ai/en/v0.8.2/features/structured_outputs.html)
- [vLLM EAGLE Draft Models](https://docs.vllm.ai/en/latest/features/speculative_decoding/eagle/)
- [P-EAGLE: Parallel Speculative Decoding in vLLM (2026, AWS)](https://aws.amazon.com/blogs/machine-learning/p-eagle-faster-llm-inference-with-parallel-speculative-decoding-in-vllm/)
- [Aider — Advanced model settings](https://aider.chat/docs/config/adv-model-settings.html) — profile prior art
- [LiteLLM Proxy — Configs](https://docs.litellm.ai/docs/proxy/configs) — profile prior art
- [HuggingFace Transformers — Generation (GenerationConfig)](https://huggingface.co/docs/transformers/main_classes/text_generation) — profile prior art

### Secondary (MEDIUM confidence)

- NVIDIA DGX Spark Developer Forum threads (#366822, #365814, #353069) — Spark hardware-specific pitfalls and benchmarks
- Hashline / oh-my-pi writeups — hash-anchored edit performance gains
- Red Hat 2026 vLLM structured-outputs article — XGrammar vs Outlines comparison
- prior `setup_local_opencode/validation/` corpus — first-party Qwen3 / MiniMax / GPT-OSS evaluation data, including the Phase 2 prompt-tuning regression

### Tertiary (LOW confidence)

- 2026 agent feature comparisons (Cursor 3, Continue.dev, Cline, Roo Code, Copilot CLI) — synthesized from blog posts and READMEs; specific numbers may shift

---
*Research completed: 2026-04-20*
*Ready for roadmap: yes*
