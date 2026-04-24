# Emmy

Fully-local coding agent on NVIDIA DGX Spark. Two architecturally separate parts:
1. **Specialized vLLM serving** (`emmy-serve`) for Qwen 3.6 (daily driver) and Gemma 4 (alternate) in digest-pinned containers — coding-tuned sampling, grammar-constrained tool output, long-context optimization.
2. **pi-mono based harness** (`pi-emmy`) exposing all eight customization surfaces opinionated harnesses hide.

**Done bar:** daily-driver replacement for Claude Code AND research-grade reproducible artifact. **No cloud INFERENCE anywhere in the loop.** Local-first egress via a self-hosted SearxNG instance is the single authorized outbound component; everything else the harness talks to is loopback.

---

## Prerequisites

- **Hardware:** NVIDIA DGX Spark (GB10, 128 GB UMA), or equivalent sm_121-supported GB10/GB200 box.
- **OS:** Ubuntu 24.04+ (kernel 6.14+ tested).
- **Container runtime:** Docker with NVIDIA Container Toolkit; `docker compose v2`.
- **Node/Bun:** Bun 1.3+ for the TS harness (`curl -fsSL https://bun.sh/install | bash`).
- **Python:** 3.11+ via `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`).
- **Model weights:**
  - Qwen 3.6-35B-A3B-FP8 (daily driver) → `/models/Qwen3.6-35B-A3B-FP8` (≈35 GB).
  - Gemma 4 26B-A4B-it (optional alternate model) → `/models/gemma-4-26B-A4B-it` (≈52 GB BF16; vLLM runtime-quants to FP8 on boot).
- **vLLM containers** (digest pinned in `profiles/*/serving.yaml` — never upstream PyPI):
  - **Qwen** → `nvcr.io/nvidia/vllm:26.03.post1-py3` (NGC, fastsafetensors loader, ~3 min cold start).
  - **Gemma 4** → `vllm/vllm-openai:gemma4-0409-arm64-cu130` (upstream, vLLM 0.19.1.dev6 + Transformers 5.5.0; Day-1 Gemma 4 support that NGC 26.03.post1 predates). Plain safetensors loader only — ~7 min cold start.

---

## Quickstart

Three stacks boot independently:

```bash
# 1. Inference server (~2-3 min cold start via fastsafetensors)
bash scripts/start_emmy.sh
# Default profile is v3.1 (daily-driver). Override with --profile profiles/qwen3.6-35b-a3b/v3 for Phase-3-locked
# Ready banner: "emmy-serve ready — profile profiles/qwen3.6-35b-a3b/v3.1 on http://127.0.0.1:8002"

# 2. Observability (Langfuse v3; optional but recommended)
bash scripts/start_observability.sh
# Browse http://localhost:3000 → create account → Settings → API keys
# Paste pk-lf-... + sk-lf-... into observability/langfuse/.env
# pi-emmy then auto-exports OTel GenAI spans to Langfuse

# 3. Web search (SearxNG; enables the web_search tool)
bash scripts/start_searxng.sh
# Self-hosted search aggregator at http://127.0.0.1:8888
# Rotates Google / DuckDuckGo / Brave / Bing / Startpage with automatic rate-limit fallback
# With SearxNG down, web_fetch falls back to the 5-host doc allowlist
```

Use the harness:

```bash
# Interactive TUI (daily-driver)
pi-emmy
# Prints boot banner: "[emmy] OFFLINE OK" (green) or "LOCAL LLM · WEB" (yellow, with SearxNG up)

# One-shot
pi-emmy --print "Summarize the package.json and tell me which package has the most deps"

# Launch against a non-default Qwen profile (serving must ALREADY be booted on
# that profile — `pi-emmy --profile` is harness-side only, it does NOT swap
# the vLLM engine). For a live swap, use /profile inside the TUI instead.
pi-emmy --profile profiles/qwen3.6-35b-a3b/v3

# Run against Gemma 4 26B-A4B-it — TWO separate steps:
#   1) swap the serving engine (one of the following)
#      (a) `/profile gemma-4-26b-a4b-it` inside an already-running pi-emmy TUI
#          — atomic 4-phase swap, ~7 min cold boot (not fastsafetensors)
#      (b) stop + re-start emmy-serve with the Gemma bundle:
#          docker stop emmy-serve
#          bash scripts/start_emmy.sh --profile profiles/gemma-4-26b-a4b-it/v2
#   2) only if you used (b), launch pi-emmy pointed at the Gemma bundle:
#          pi-emmy --profile profiles/gemma-4-26b-a4b-it/v2
# See docs/runbook.md § "Swapping profiles" (+ "First-time swap to Gemma 4")
# for the D-02 progress phases and exit-code taxonomy.

# Environment inspection
pi-emmy --print-environment

# Kill-switches (stricter posture)
EMMY_TELEMETRY=off pi-emmy        # disable JSONL + OTLP telemetry (badge OFF)
EMMY_WEB_SEARCH=off pi-emmy       # disable web_search tool (8-tool floor; badge OFFLINE OK regardless of SearxNG)

# Slash commands (inside interactive TUI)
/profile <name>[@variant]         # atomic swap of serving engine + harness state (Phase 4). Emits 4 verbatim progress phases: stopping vLLM → loading weights N% → warmup → ready. Exit codes: 0 ok, 5 pre-flight fail (prior engine alive), 6 post-stop fail with rollback. See docs/runbook.md § "Swapping profiles".
/compact [optional instructions]  # manually compact session context (pi built-in; auto-fires at 75% of max_input_tokens)
/clear                            # reset session history (keep boot context)
/quit                             # exit pi-emmy
```

Tear-down:

```bash
bash scripts/stop_searxng.sh        # stops SearxNG + its Redis
bash scripts/stop_observability.sh  # stops Langfuse + Postgres + ClickHouse + MinIO + Redis
docker stop emmy-serve              # stops vLLM serving
```

---

## Profile ladder

Every non-trivial knob lives in a profile. Profile bundles are immutable per version (D-02 from Phase 1); operational changes ship as sibling versions.

### `profiles/qwen3.6-35b-a3b/` (primary — daily driver)

| Version | Status | Daily-driver? | Notes |
|---------|--------|---------------|-------|
| v1 | Phase 1 locked | no | Baseline: schema + SP_OK canary + thermal-validated sampling floors. `sha256:b91e747...21913` |
| v2 | Phase 2 locked | no | Harness MVP baseline. Strict web_fetch allowlist (none). `sha256:24be3eea...85d8b` |
| v3 | Phase 3 locked | no | Adds OTel telemetry + compaction policy + offline badge + 5-host doc allowlist. `sha256:2beb99c7...d4d3718` |
| **v3.1** | **daily-driver** | **yes (default)** | **RAM-tuned + live auto-compaction + web_search + web_fetch returned-URL bypass + 3-state badge. `sha256:f9dcabd1...01fc73`** |
| v3.2 | Phase 5 A/B candidate | no | Same as v3.1 but `max_num_batched_tokens: 16384` (doubled from v3.1's 8192) — kept for eval comparison. |

v1, v2, v3, v3.1, v3.2 are byte-identical to their commit-of-record; `uv run emmy profile validate profiles/qwen3.6-35b-a3b/<ver>/` exits 0 for all five.

### `profiles/gemma-4-26b-a4b-it/` (alternate — Phase 4)

| Version | Status | Bootable? | Notes |
|---------|--------|-----------|-------|
| v1 | superseded | **no** | Targets NGC `26.03.post1-py3` whose Transformers pre-dates `Gemma4ForCausalLM` — engine won't start. Kept only as historical record. |
| **v2** | Phase 4 locked | **yes** | Upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` (vLLM 0.19.1.dev6, Transformers 5.5.0). `gpu_memory_utilization=0.86` measured via 11-iter KV bisection on spark-ff85; decode floors (p50 35.9 tok/s, p1 33.3 tok/s) + GPU clock floor (p5 2405 MHz) validated by two consecutive 2-hour thermal replays. `sha256:8f9c23f500...` |

To swap from Qwen 3.6 → Gemma 4 v2, use `/profile gemma-4-26b-a4b-it` inside a running pi-emmy TUI — that's the atomic 4-phase path that actually restarts emmy-serve. First cold boot is ~7 min because upstream doesn't ship fastsafetensors; subsequent boots are similar (no in-container compile cache yet). `pi-emmy --profile <bundle>` at launch is harness-side only (prompts / tools / sampling) and assumes emmy-serve is already booted on a matching `served_model_name` — it will 404 otherwise; see Quickstart for the full sequence.

### Role routing (Phase 4, Qwen only)

`profiles/routes.yaml` maps role heuristics (plan / edit / critic / default) to Qwen 3.6 v3.1 sibling variants (same engine bytes, different sampling + prompt). Active whenever the daily-driver profile is Qwen v3.1 — the TUI transparently routes each turn.

---

## What each stack provides

| Stack | Port | Required for | Disable |
|-------|------|--------------|---------|
| `emmy-serve` | 127.0.0.1:8002 | inference (every pi-emmy request) | none — required |
| Langfuse | 127.0.0.1:3000 | tracing (optional) | leave `LANGFUSE_*` env empty or `EMMY_TELEMETRY=off` |
| SearxNG | 127.0.0.1:8888 | `web_search` tool (optional) | `bash scripts/stop_searxng.sh` or `EMMY_WEB_SEARCH=off` |

With all three up, the harness talks to three loopback endpoints. SearxNG is the only container with outbound traffic (to search engines). That's the one deliberate egress surface; see `CLAUDE.md § Design Principles` for the rationale.

---

## Common troubleshooting

**Agent returns 400 "context length is only 131072 tokens, maximum input length 114688"**
Phase 3.1's live auto-compaction fires at the 75% soft threshold (86016 tokens). If it didn't trigger:
- confirm you're on v3.1 (`pi-emmy --print-environment`); v2 has no compaction
- use `/clear` (emmy slash command) or `/compact` (pi built-in) from inside the TUI
- restart: press `Ctrl-D` on empty editor to exit, re-launch

**`free -h` shows <10 GiB available, swap in use**
vLLM `gpu_memory_utilization` is too aggressive for DGX Spark UMA. v3.1 sets it to 0.55 (was 0.88 in v3). If tuning further: edit `profiles/qwen3.6-35b-a3b/v3.1/serving.yaml`, restart emmy-serve. See `docs/runbook.md § RAM tuning`.

**Profile hash mismatch on validate**
Profile was edited in place — D-02 immutability requires a NEW sibling version. Either revert the edit (git restore) or `cp -r profiles/qwen3.6-35b-a3b/v3.1/ profiles/qwen3.6-35b-a3b/v3.2/` and work on v3.2.

**`[emmy] OFFLINE OK` stays green when SearxNG is up**
`web_search` hasn't fired yet — the badge flips to `LOCAL LLM · WEB` (yellow) on first successful search. Try `pi-emmy --print "Use web_search to find the latest Bun version"`.

**"TUI unavailable in this pi 0.68.0 adapter" on interactive pi-emmy**
You're on a pre-Plan-03-08 build. Pull latest and `bun install`.

See `docs/runbook.md` for deeper daily-ops material (log locations, rotation, engine disable, RAM tuning).

---

## Where things live

```
profiles/qwen3.6-35b-a3b/v{1,2,3,3.1}/   # Versioned model profiles (immutable once closed)
emmy_serve/                              # vLLM container wrapper, profile loader, air-gap validators
packages/
  emmy-provider/                         # pi provider adapter + @emmy/provider streamSimple wiring
  emmy-tools/                            # 8 native tools + web_search + MCP bridge + web_fetch allowlist
  emmy-telemetry/                        # dual-sink JSONL+OTLP telemetry + feedback capture
  emmy-context/                          # compaction trigger (D-14 preservation + D-12 hard-ceiling)
  emmy-ux/                               # prompt assembly + pi-emmy CLI + TUI integration + slash commands
observability/
  langfuse/                              # self-hosted v3 compose
  searxng/                               # self-hosted search aggregator compose
eval/                                    # benchmark suite (imports harness as library)
scripts/                                 # start/stop + walkthroughs + air-gap replays
docs/                                    # runbook.md + supporting ops docs
runs/                                    # transcripts + JSONL telemetry + phase walkthrough evidence (gitignored except in .planning/)
.planning/                               # GSD planning artifacts — phases, requirements, roadmap, state
```

---

## Outstanding items (operator-gated)

Some evidence items from earlier phases are operator-gated — they need a browser, long GPU window, or interactive session that automation doesn't cleanly drive:

**From Phase 3:**
- `p3-02 trace green` — live Langfuse UI trace verification (needs browser API-key provisioning)
- `p3-06 badge green` — interactive web_fetch red-flip demo
- `p3-07 sc2 live green` — 200-turn live compaction matrix (~2h GPU)

**From Phase 1:**
- DGX Spark throughput sweep, SC-5 sampler re-validation, SC-4 air-gap CI self-hosted runner — all queued for opportunistic closure.

**Phase 4:** all operator-gated deferrals **resolved 2026-04-24** (KV bisection on Gemma 4 v2 → 0.86, 2×2h thermal replay "All floors pass", Qwen↔Gemma live round-trip confirmed). See `runs/phase4-closeout/` for the close-out evidence.

See `.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-HUMAN-UAT.md` + `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md § Deferrals` for details.

---

## Roadmap

Emmy ships in 7 phases across v1 milestones. Cumulative progress: 4/7 phases complete (Phases 1, 2, 3 + decimal polish 3.1, 4); 43/68 v1 REQ-IDs Done.

- **Phase 1** (CLOSED): serving foundation + profile schema
- **Phase 2** (CLOSED): pi-harness MVP — daily-driver baseline
- **Phase 3** (CLOSED): observability + agent-loop hardening + lived-experience
- **Phase 3.1** (CLOSED): operational polish — RAM + live compaction + SearxNG + docs
- **Phase 4** (CLOSED): Gemma 4 profile + profile system maturity (all 4 operator carry-forwards resolved 2026-04-24)
- **Phase 5** (next): eval harness (terminal-bench, SWE-bench Verified, LiveCodeBench)
- **Phase 6**: speculative decoding (Qwen3-MTP + EAGLE-3)
- **Phase 7**: publication + reproducibility artifact

See `.planning/ROADMAP.md` for per-phase success criteria.

---

## Development

Emmy uses GSD for phase planning (`/gsd-*` slash commands inside Claude Code). Key commands:

- `/gsd-progress` — current state + next action
- `/gsd-plan-phase <N>` — break down phase into plans
- `/gsd-execute-phase <N>` — execute all plans in a phase
- `/gsd-verify-work` — UAT after a phase closes

Every profile knob is documented in `profiles/qwen3.6-35b-a3b/<version>/PROFILE_NOTES.md` with provenance (`Retrieved` date + source URL) per REPRO-02 discipline.

---

## Further reading

- `CLAUDE.md` — project thesis + critical pitfalls + design principles (load-bearing for contributors)
- `.planning/PROJECT.md` — project-level context, core value, key decisions
- `.planning/REQUIREMENTS.md` — 68 v1 requirements with phase traceability
- `.planning/ROADMAP.md` — 7-phase plan with success criteria
- `docs/runbook.md` — day-to-day ops
- `.planning/research/` — Phase 1 research (STACK, FEATURES, ARCHITECTURE, PITFALLS)
