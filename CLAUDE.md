# Emmy — CLAUDE.md

> Fully local coding agent on NVIDIA DGX Spark. Two architecturally separate parts:
> 1. **Specialized vLLM serving** for Gemma 4 + Qwen 3.6 (coding-tuned sampling, grammar-constrained tool output, long-context optimization, speculative decoding)
> 2. **pi.dev (`pi-mono`) based harness** exposing all 8 customization surfaces opinionated harnesses hide

**Done bar:** daily-driver replacement for Claude Code AND research-grade reproducible artifact. **No cloud INFERENCE anywhere in the loop** — the LLM is 100% local, air-gap tested. **Local-first EGRESS** via a self-hosted SearxNG instance is the single authorized outbound component (loopback-bound from the harness's POV; disableable via `EMMY_WEB_SEARCH=off` for stricter posture). See Pitfall #8 + `docs/runbook.md` for the full air-gap posture.

## Planning Documents

Always read these before substantive work — they define what we're building and why.

- `.planning/PROJECT.md` — project context, core value, key decisions
- `.planning/REQUIREMENTS.md` — 68 v1 requirements (SERVE/PROFILE/HARNESS/TOOLS/CONTEXT/EVAL/TELEM/UX/REPRO; +TOOLS-10 web_search + UX-07 3-state badge in Phase 3.1) + v2 + Out-of-Scope
- `.planning/ROADMAP.md` — 7-phase plan with success criteria and traceability
- `.planning/STATE.md` — current phase + project memory
- `.planning/research/SUMMARY.md` — research synthesis with phase recommendations
- `.planning/research/STACK.md` — pinned tech stack (vLLM, models, libraries, versions)
- `.planning/research/FEATURES.md` — feature taxonomy (table-stakes / differentiators / anti-features)
- `.planning/research/ARCHITECTURE.md` — component boundaries, profile schema, deployment topology
- `.planning/research/PITFALLS.md` — 20 pitfalls (8 critical) with prevention strategies
- `.planning/config.json` — workflow preferences (YOLO mode, Standard granularity, parallel execution, opus profile)

## Pinned Tech Stack

- **Serving containers (per-family):** Qwen → `nvcr.io/nvidia/vllm:26.03.post1-py3` (NGC fastsafetensors-derived, ~3 min cold start). Gemma 4 → `vllm/vllm-openai:gemma4-0409-arm64-cu130` (upstream Day-1 image, vLLM 0.19.1.dev6 + Transformers 5.5.0, plain safetensors, ~8 min cold start). Never upstream PyPI wheels on Spark (SM121 kernel failures)
- **Primary model (daily-driver):** `google/gemma-4-26B-A4B-it` **v2.1** (MoE, 4B active, decode p50 ~36 tok/s thermal-validated, 256K native context). **Switched from Qwen 35B-A3B-FP8 v3.1 on 2026-04-28** based on the 4-profile V-protocol matrix in `.planning/phases/04.4-filesystem-memory-tool-append-only-prefix-compaction-polish-/runs/V-RESULTS-v8-matrix-complete.md`: Gemma MoE clears V1 memory adoption at 100% (20/20) vs Qwen MoE 55%; V3 rot protection 5/5 on both. The Qwen-MoE 50-55% V1 ceiling is a Qwen-MoE-specific compliance gap, not architectural — see V-RESULTS-v8 §"What this changes vs v7" for the falsification of the active-params hypothesis. **2026-04-28 same-day follow-up: dropped Qwen 35B-A3B MoE entirely from the active stack** ("if it can't follow directions, I would rather not use it" — operator decision). Profile bundles removed; historical V-RESULTS, postmortems, and phase artifacts preserved as evidence. **v2 → v2.1 follow-up** (sha256:f5c11944...): max_model_len 131072 → 262144 (256K native — Gemma 4 declares max_position_embeddings=262144 with sliding_window=1024, so the bump is architecturally cheap; v2's 128K cap was symmetric-with-Qwen, not a Gemma constraint) + gmu 0.86 → 0.55 RAM-headroom retune (mirrors dense v1→v1.1; trigger was the 2026-04-28 bio-pipeline OOM cascade documented in `.planning/phases/04.2-…/POSTMORTEM-sidecar-oom-cascade-2026-04-28.md`). v2 preserved as the KV-bisection audit artifact.
- **Heavy-context alternate slot:** none currently. Within-model role routing (Phase 4 SC-3 `routes.yaml`) was Qwen-MoE-specific by D-08 design; with Qwen MoE dropped, the routes infrastructure is dormant until Gemma plan/edit/critic siblings are authored (Phase 5+). `routes.yaml` deleted; `routes-loader.ts` falls back to default-only mode per D-08 ENOENT path. Engine byte-identity (D-09) remains a constraint for any future Gemma variants.
- **Heavy-agent slot:** `Qwen/Qwen3-Coder-Next-80B-A3B-FP8` (RL-trained for tools, ~30–43 tok/s)
- **Phase 4.1 dense siblings (eval-only, opt-in via `/profile`, NOT daily-driver):** `Qwen/Qwen3.6-27B-FP8` (dense, decode p50 ~7.6 tok/s) + `google/gemma-4-31B-it` (dense, BF16→runtime FP8, decode p50 ~6.4 tok/s). Both bandwidth-bound by design on GB10 UMA — single-digit tok/s is **expected**, NOT a regression. Acceptance gate is thermal stability (preemptions=0, oom=0), NOT throughput. Each dense family ships sibling-of-siblings: Qwen 27B has **`v1`** (KV-ceiling audit at gmu=0.86) + **`v1.1`** (operational gmu=0.55, the DEFAULT_VARIANT). Gemma 31B has **`v1`** (KV-ceiling audit) + **`v1.1`** (operational gmu=0.55) + **`v1.2`** (operational gmu=0.55 + 256K native context — DEFAULT_VARIANT since 2026-04-28; same architectural sliding-window argument as MoE v2→v2.1). `/profile qwen3.6-27b` resolves to v1.1; `/profile gemma-4-31b-it` resolves to v1.2. Phase 5 evaluates dense-vs-MoE on real coding tasks. Both denses cleared the V1 memory gate (Qwen 27B 100%, Gemma 31B 95%) per V-RESULTS-v8. Note: Qwen 27B dense lives on as the only Qwen profile in the active stack — its compliance was the 100% data point that, alongside Gemma's, falsified the v7 active-params hypothesis.
- **Hardware-level KV ceiling:** all 4 profiles' KV bisection (Qwen 35B MoE v3, Qwen 27B dense v1, Gemma 26B MoE v2, Gemma 31B dense v1) converge to `gpu_memory_utilization=0.86` via `scripts/find_kv_budget.py` on this GB10 / 128 GB UMA box. The ceiling is the box, not the model. v3.1/v1.1 then back off to 0.55 for system-RAM headroom (Pitfall #3 trumps Pitfall #1 for sibling versions that re-target operator comfort, not no-preempt ceiling).
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
- Profiles are immutable. **Behavioral changes** (modify, replace, or remove an existing key value, or change a prompt's bytes, or move a default) → new version directory. **Strictly additive changes** (add an entirely new top-level block whose absence already validates as `None`, leaving every pre-existing key byte-identical) → recompute the bundle hash in place, do NOT cut a new version. Examples of in-place: 04.4-03 added `context.memory:`; 04.5-02 added `subagents:`. Both modify zero pre-existing bytes; eval-replay against the prior version-string remains semantically valid because absent → None handlers exist throughout. The intent of the immutability rule is to prevent silent behavioral drift; an additive block whose absence is already a valid configuration carries no drift risk. **When in doubt, cut a new version** — the failure mode of an unnecessary version cut is paperwork; the failure mode of an in-place behavioral edit is a corrupted observability/eval history.
- Every observability event and every benchmark result embeds `{profile.id, profile.version, profile.hash}`.
- **Anti-pattern:** model-shaped logic in code (e.g. `if "qwen" in name: use_hermes_parser`). All such logic lives in the profile.

## Critical Pitfalls — Design Against From Day One

1. **"More prompting" trap** — prior repo's Qwen3 went 8.5→6.8 by adding rules. Always run the *full* eval suite before declaring any change positive. Subset tests hide regressions.
2. **Silent system-prompt delivery failure** — vLLM `/v1/messages` and `/v1/chat/completions` handle system messages differently per chat template. Use `[SP_OK]` canary in every benchmark loop; log the assembled prompt hash.
3. **KV cache budget set from theory** — DGX Spark UMA shares model + KV + harness CPU. Default `gpu_memory_utilization=0.95` causes preemption. Start at 0.75, validate with 30-min sustained load.
4. **DGX Spark thermal throttle** — short benchmarks look fine; 2-hour sessions throttle 2.8→~2 GHz. Run a 2-hour sustained-load thermal validation per profile.
5. **Hidden cloud dependencies** — `VLLM_NO_USAGE_STATS=1` required; HF gated models need auth even offline. Verify with explicit air-gap test. **Note (Phase 3.1):** SearxNG is NOT a hidden dep — it's the one loopback egress we intentionally ship and document. What makes it acceptable: self-hosted, digest-pinned, disable-able (`EMMY_WEB_SEARCH=off` or stop the container), observable (all queries logged to `tool.web_search` events). Air-gap CI split into two validators: `ci_verify_phase3` (STRICT — zero outbound, for inference-posture gate) and `ci_verify_research_egress` (PERMISSIVE — SearxNG OK, blocks 12 cloud-inference endpoints).
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
- **URL config precedence: env > profile > literal default** — every endpoint URL the harness consumes (SearxNG, sidecar, vLLM base, Langfuse, MCP servers) MUST resolve in this order. Env wins so a wrapper can override per-machine without touching profile bytes (Phase 04.2's Mac client `EMMY_SERVE_URL` / `EMMY_SEARXNG_URL` / `EMMY_REMOTE_CLIENT` are the canonical case). Profile wins next so a self-hosted Spark deployment can pin a non-default URL without env gymnastics. Literal default is the D-33 LOCKED loopback (`127.0.0.1:<port>`) — never a public hostname. **Anti-pattern caught in Phase 04.2-followup:** session.ts read the profile URL eagerly and passed it explicitly into the runtime config, shadowing the env getter inside the tool module — env override silently no-op'd. Resolution helpers (e.g. `resolveSearxngBaseUrl(profileBaseUrl)` in `packages/emmy-ux/src/session.ts`) keep the precedence in one place; new URL config should follow the same pattern.

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
│   └── gemma-4-26b-a4b-it/v2.1/
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
*Updated 2026-04-28 — daily-driver switched from Qwen 35B-A3B v3.1 to Gemma 4 26B-A4B v2.1 per V-RESULTS-v8 4-profile matrix; Qwen 35B-A3B MoE dropped from the active stack same day.*
