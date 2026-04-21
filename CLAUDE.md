# Emmy — CLAUDE.md

> Fully local coding agent on NVIDIA DGX Spark. Two architecturally separate parts:
> 1. **Specialized vLLM serving** for Gemma 4 + Qwen 3.6 (coding-tuned sampling, grammar-constrained tool output, long-context optimization, speculative decoding)
> 2. **pi.dev (`pi-mono`) based harness** exposing all 8 customization surfaces opinionated harnesses hide

**Done bar:** daily-driver replacement for Claude Code AND research-grade reproducible artifact. **No cloud dependency anywhere in the loop.**

## Planning Documents

Always read these before substantive work — they define what we're building and why.

- `.planning/PROJECT.md` — project context, core value, key decisions
- `.planning/REQUIREMENTS.md` — 66 v1 requirements (SERVE/PROFILE/HARNESS/TOOLS/CONTEXT/EVAL/TELEM/UX/REPRO) + v2 + Out-of-Scope
- `.planning/ROADMAP.md` — 7-phase plan with success criteria and traceability
- `.planning/STATE.md` — current phase + project memory
- `.planning/research/SUMMARY.md` — research synthesis with phase recommendations
- `.planning/research/STACK.md` — pinned tech stack (vLLM, models, libraries, versions)
- `.planning/research/FEATURES.md` — feature taxonomy (table-stakes / differentiators / anti-features)
- `.planning/research/ARCHITECTURE.md` — component boundaries, profile schema, deployment topology
- `.planning/research/PITFALLS.md` — 20 pitfalls (8 critical) with prevention strategies
- `.planning/config.json` — workflow preferences (YOLO mode, Standard granularity, parallel execution, opus profile)

## Pinned Tech Stack

- **Serving container:** `nvcr.io/nvidia/vllm:26.03.post1-py3` — never upstream PyPI wheels on Spark (SM121 kernel failures)
- **Primary model:** `Qwen/Qwen3.6-35B-A3B-FP8` (~75 tok/s, MoE, 3B active)
- **Heavy-agent slot:** `Qwen/Qwen3-Coder-Next-80B-A3B-FP8` (RL-trained for tools, ~30–43 tok/s)
- **Gemma slot:** `google/gemma-4-26B-A4B-it` MoE — **NOT** the 31B dense (bandwidth-bound at 6.9 tok/s)
- **Quantization:** FP8 only. NVFP4 is *slower* than FP16 on GB10 UMA (-23.6% at 32K context); ModelOpt 0.42.0 has a NaN bug.
- **Boot:** `VLLM_LOAD_FORMAT=fastsafetensors` (~3× cold-start speedup, proven in prior repo)
- **Telemetry off:** `VLLM_NO_USAGE_STATS=1` always; air-gap test gates every release
- **Harness substrate:** `@mariozechner/pi-coding-agent` v0.68.0 (pi-mono by Mario Zechner) — TypeScript/Node, MIT
- **Structured output:** XGrammar (vLLM 0.19 default) — 3.5–100× faster than Outlines
- **Speculative decoding:** Qwen3-MTP for Qwen models, EAGLE-3 (RedHatAI speculators) for Gemma
- **Observability:** Self-hosted Langfuse v3 + OTel GenAI semconv (Docker Compose locally)
- **Eval:** terminal-bench 2.0 (primary) + SWE-bench Verified (milestone) + LiveCodeBench (rolling, contamination-resistant) + prior repo's Phase 1 prompts (continuity)

## Keystone Abstraction: Versioned Model Profiles

Profiles are the **only shared contract** between serving and harness. Treat them as load-bearing.

```
profiles/<name>/v<N>/
  serving.yaml        # vLLM engine args, sampling defaults, spec config — restart for engine fields
  harness.yaml        # prompts, tool format, per-tool sampling, retry, compaction — hot-reloadable
  prompts/            # system prompt + edit examples + tool descriptions (.md)
  tool_schemas/       # JSON schemas in the format the model parses best
  grammars/           # XGrammar .lark files
  PROFILE_NOTES.md    # provenance for every default ("source: Qwen team blog 2026-04-16")
```

**Rules:**
- Profiles are immutable. Any field change → new version directory.
- Every observability event and every benchmark result embeds `{profile.id, profile.version, profile.hash}`.
- **Anti-pattern:** model-shaped logic in code (e.g. `if "qwen" in name: use_hermes_parser`). All such logic lives in the profile.

## Critical Pitfalls — Design Against From Day One

1. **"More prompting" trap** — prior repo's Qwen3 went 8.5→6.8 by adding rules. Always run the *full* eval suite before declaring any change positive. Subset tests hide regressions.
2. **Silent system-prompt delivery failure** — vLLM `/v1/messages` and `/v1/chat/completions` handle system messages differently per chat template. Use `[SP_OK]` canary in every benchmark loop; log the assembled prompt hash.
3. **KV cache budget set from theory** — DGX Spark UMA shares model + KV + harness CPU. Default `gpu_memory_utilization=0.95` causes preemption. Start at 0.75, validate with 30-min sustained load.
4. **DGX Spark thermal throttle** — short benchmarks look fine; 2-hour sessions throttle 2.8→~2 GHz. Run a 2-hour sustained-load thermal validation per profile.
5. **Hidden cloud dependencies** — `VLLM_NO_USAGE_STATS=1` required; HF gated models need auth even offline. Verify with explicit air-gap test.
6. **Grammar fighting the model** — constrained decoding is a correctness backstop, not a quality lever. Parse unconstrained first; retry under grammar on parse failure only. Include a no-grammar baseline in every profile.
7. **Speculative decoding regression** — only wins when draft is cheap, acceptance > 0.5, and workload isn't compute-saturated. Always run paired spec-on/spec-off benchmark.
8. **Test-set contamination** — HumanEval and original SWE-bench likely in 2026 pretraining. Use terminal-bench 2.0, LiveCodeBench, SWE-bench Verified. Include held-out and rephrased contamination controls.

## Design Principles

- **Stand on shoulders, then experiment** — start from community best-practice settings (cite in `PROFILE_NOTES.md`); only run in-house experiments where consensus doesn't exist.
- **Two hard boundaries; the rest soft** — `harness ↔ emmy-serve` over loopback HTTP; both layers ↔ profile registry over disk. Everything else lives in one harness host process. Don't microservice a single-user tool.
- **Eval imports the harness as a library** — never bypass the harness in eval; you measure the agent, not the model.
- **Hash-anchored edits as default** — Hashline pattern (6.7→68.3% on 180 tasks for weak models). Plain string-replace only as fallback.
- **MCP via pi extension, not a fork** — pi has a "no MCP" stance; emmy overrides via extension because MCP became LF-governed infrastructure in late 2025.
- **Bash-first tools** — pi's minimal floor (read/write/edit/bash + grep/find/ls + web_fetch + MCP). Building 20+ specialized tools burns context tokens for no benefit.
- **YOLO defaults + denylist** — pi-mono's correct insight: once an agent has read+write+bash, real isolation is impossible inside the loop. ~40% slowdown for false safety. Use git for undo.

## Workflow

This project uses GSD (`/gsd-*` slash commands):

- `/gsd-progress` — show current state, route to next action
- `/gsd-plan-phase <N>` — decompose phase N into executable plans
- `/gsd-execute-phase <N>` — execute phase N's plans
- `/gsd-verify-work` — UAT after a phase completes

Config (`.planning/config.json`):
- Mode: **YOLO** (auto-approve)
- Granularity: **Standard** (5–8 phases, 3–5 plans each)
- Parallelization: **on**
- Model profile: **Quality** (opus for research/roadmap)
- Workflow agents: research **on**, plan-check **on**, verifier **on**

## Repo Layout (anticipated, will evolve)

```
emmy/
├── CLAUDE.md                  # this file
├── .planning/                 # GSD planning artifacts (committed)
├── profiles/                  # versioned model profiles (the keystone)
│   └── qwen3.6-35b-a3b/v1/
├── emmy-serve/                # vLLM container wrapper, profile loader, hot-reload
├── packages/                  # pi extensions (TypeScript)
│   ├── emmy-provider/         # local vLLM provider for pi
│   ├── emmy-tools/            # hash-anchored edit, web_fetch, MCP bridge
│   ├── emmy-telemetry/        # OTel + Langfuse + lived-experience JSONL
│   └── emmy-ux/               # GPU/KV footer, offline-OK badge
├── eval/                      # benchmark suite (imports harness as library)
└── start_emmy.sh              # one-command boot
```

(Subject to phase planning — this is the working sketch from research.)

## What This Is Not

- Not a hosted SaaS. Single-user, single-machine.
- Not a general assistant. Coding-only.
- Not a fine-tuning project. Stock weights only.
- Not an IDE plugin. TUI-first.
- Not cloud-fallback-enabled. Zero cloud in the critical loop.

See `.planning/REQUIREMENTS.md` Out-of-Scope for the full anti-feature list with reasoning.

---
*Updated 2026-04-20 after project initialization*
