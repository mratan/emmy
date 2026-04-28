# Emmy

Fully-local coding agent on NVIDIA DGX Spark. Two architecturally separate parts:
1. **Specialized vLLM serving** (`emmy-serve`) for Gemma 4 (daily driver — switched from Qwen on 2026-04-28; see `.planning/phases/04.4-…/runs/V-RESULTS-v8-matrix-complete.md`) and Qwen 3.6 (alternate) in digest-pinned containers — coding-tuned sampling, grammar-constrained tool output, long-context optimization.
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
  - Gemma 4 26B-A4B-it (daily driver since 2026-04-28, MoE) → `/models/gemma-4-26B-A4B-it` (≈52 GB BF16; vLLM runtime-quants to FP8 on boot).
  - Qwen 3.6-35B-A3B-FP8 (alternate MoE — faster but with documented compliance gap, MoE) → `/models/Qwen3.6-35B-A3B-FP8` (≈35 GB).
  - Qwen 3.6-27B-FP8 (Phase 4.1 dense sibling, opt-in) → `/models/Qwen3.6-27B-FP8` (≈29 GB).
  - Gemma 4 31B-it (Phase 4.1 dense sibling, opt-in) → `/models/gemma-4-31B-it` (≈61 GB BF16; runtime FP8 quant).
- **vLLM containers** (digest pinned in `profiles/*/serving.yaml` — never upstream PyPI):
  - **Qwen (both MoE + dense)** → `nvcr.io/nvidia/vllm:26.03.post1-py3` (NGC, fastsafetensors loader, ~3 min cold start).
  - **Gemma 4 (both MoE + dense)** → `vllm/vllm-openai:gemma4-0409-arm64-cu130` (upstream, vLLM 0.19.1.dev6 + Transformers 5.5.0; Day-1 Gemma 4 support that NGC 26.03.post1 predates). Plain safetensors loader only — ~8 min cold start.

---

## Quickstart

Three stacks boot independently:

```bash
# 1. Inference server (~8 min cold start; Gemma uses upstream image without fastsafetensors)
bash scripts/start_emmy.sh
# Default profile is gemma-4-26b-a4b-it/v2 (daily-driver since 2026-04-28). Override with
# --profile profiles/qwen3.6-35b-a3b/v3.1 for the faster alternate MoE.
# Ready banner: "emmy-serve ready — profile profiles/gemma-4-26b-a4b-it/v2 on http://127.0.0.1:8002"

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

# Launch with an explicit profile pointer (serving must ALREADY be booted on
# that profile — `pi-emmy --profile` is harness-side only, it does NOT swap
# the vLLM engine). For a live engine swap, use /profile inside the TUI instead.
pi-emmy --profile profiles/qwen3.6-35b-a3b/v3.1   # alternate Qwen MoE

# Run against Qwen 3.6 35B-A3B (alternate MoE — faster but documented
# compliance gap per V-RESULTS-v8) — TWO separate steps:
#   1) swap the serving engine (one of the following)
#      (a) `/profile qwen3.6-35b-a3b` inside an already-running pi-emmy TUI
#          — atomic 4-phase swap, ~3 min cold boot (NGC fastsafetensors)
#      (b) stop + re-start emmy-serve with the Qwen bundle:
#          docker stop emmy-serve
#          bash scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1
#   2) only if you used (b), launch pi-emmy pointed at the Qwen bundle:
#          pi-emmy --profile profiles/qwen3.6-35b-a3b/v3.1
# See docs/runbook.md § "Swapping profiles" for the D-02 progress phases
# and exit-code taxonomy.

# Environment inspection
pi-emmy --print-environment

# Kill-switches (stricter posture)
EMMY_TELEMETRY=off pi-emmy        # disable JSONL + OTLP telemetry (badge OFF)
EMMY_WEB_SEARCH=off pi-emmy       # disable web_search tool (8-tool floor; badge OFFLINE OK regardless of SearxNG)

# Slash commands (inside interactive TUI)
/profile <name>[@variant]         # atomic swap of serving engine + harness state (Phase 4). Emits 4 verbatim progress phases: stopping vLLM → loading weights N% → warmup → ready. Exit codes: 0 ok, 5 pre-flight fail (prior engine alive), 6 post-stop fail with rollback. See docs/runbook.md § "Swapping profiles".
/start <name>[@variant]           # cold-start vLLM via the always-on sidecar (Phase 04.2). Idempotent same-variant short-circuit returns ~1s; cross-variant reuses the /profile swap path.
/stop                             # graceful drain via sidecar (Phase 04.2): D-01 30s grace for in-flight requests, then SIGTERM, then SIGKILL deadline. Footer shows draining {in_flight: N}.
/status                           # poll-only sidecar /status (Phase 04.2): state, vllm_up, profile_id, profile_variant, KV%, GPU temp.
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

### `profiles/qwen3.6-35b-a3b/` (alternate MoE — faster but compliance gap; was daily-driver until 2026-04-28)

| Version | Status | Daily-driver? | Notes |
|---------|--------|---------------|-------|
| v1 | Phase 1 locked | no | Baseline: schema + SP_OK canary + thermal-validated sampling floors. `sha256:b91e747...21913` |
| v2 | Phase 2 locked | no | Harness MVP baseline. Strict web_fetch allowlist (none). `sha256:24be3eea...85d8b` |
| v3 | Phase 3 locked | no | Adds OTel telemetry + compaction policy + offline badge + 5-host doc allowlist. `sha256:2beb99c7...d4d3718` |
| v3.1 | alternate (was daily-driver until 2026-04-28) | no | RAM-tuned + live auto-compaction + web_search + web_fetch returned-URL bypass + 3-state badge. `sha256:f9dcabd1...01fc73`. V-RESULTS-v8: V1 memory adoption 55%, V3 rot 5/5. Phase 4 SC-3 within-model role routing (`profiles/routes.yaml`) only activates when this profile is loaded. |
| v3.2 | Phase 5 A/B candidate | no | Same as v3.1 but `max_num_batched_tokens: 16384` (doubled from v3.1's 8192) — kept for eval comparison. |

v1, v2, v3, v3.1, v3.2 are byte-identical to their commit-of-record; `uv run emmy profile validate profiles/qwen3.6-35b-a3b/<ver>/` exits 0 for all five.

### `profiles/gemma-4-26b-a4b-it/` (primary — daily driver since 2026-04-28)

| Version | Status | Bootable? | Notes |
|---------|--------|-----------|-------|
| v1 | superseded | **no** | Targets NGC `26.03.post1-py3` whose Transformers pre-dates `Gemma4ForCausalLM` — engine won't start. Kept only as historical record. |
| **v2** | **daily-driver since 2026-04-28** | **yes** | Upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` (vLLM 0.19.1.dev6, Transformers 5.5.0). `gpu_memory_utilization=0.86` measured via 11-iter KV bisection on spark-ff85; decode floors (p50 35.9 tok/s, p1 33.3 tok/s) + GPU clock floor (p5 2405 MHz) validated by two consecutive 2-hour thermal replays. **V-RESULTS-v8: V1 memory adoption 100% (20/20), V3 rot 5/5.** Promoted to daily-driver when the matrix showed Qwen MoE plateaued at 55% V1 adoption; throughput trade-off (~36 vs ~48 tok/s) is the operator-accepted cost of higher compliance. `sha256:8f9c23f500...` |

`scripts/start_emmy.sh` and `pi-emmy` both default to `gemma-4-26b-a4b-it/v2`. To opt back into Qwen 3.6 → use `/profile qwen3.6-35b-a3b` inside a running pi-emmy TUI (the atomic 4-phase path that restarts emmy-serve), or pass `--profile profiles/qwen3.6-35b-a3b/v3.1` to both `start_emmy.sh` and `pi-emmy` at launch. First Gemma cold boot is ~8 min because upstream doesn't ship fastsafetensors; subsequent boots are similar (no in-container compile cache yet). `pi-emmy --profile <bundle>` at launch is harness-side only (prompts / tools / sampling) and assumes emmy-serve is already booted on a matching `served_model_name` — it will 404 otherwise; see Quickstart for the full sequence.

### `profiles/qwen3.6-27b/` (Phase 4.1 dense sibling — eval-only, opt-in)

| Version | Status | Bootable? | Notes |
|---------|--------|-----------|-------|
| **v1.1** | Phase 4.1 follow-up — DEFAULT_VARIANT | **yes** | RAM-headroom retune of v1 (gmu 0.86 → 0.55, D-29-equivalent; mirrors Qwen v3 → v3.1 move). Targets ~70 GB emmy-serve footprint, leaves >40 GiB system headroom on 128 GiB UMA. All other fields byte-identical to v1. `sha256:4f08e4e5...` Thermal evidence inherited from v1 (less memory pressure ≯ regress). **This is the variant `/profile qwen3.6-27b` resolves to.** |
| v1 | Phase 4.1 locked — KV-ceiling audit | yes | NGC `26.03.post1-py3` + fastsafetensors (same image as Qwen 35B MoE). `gpu_memory_utilization=0.86` via 11-iter KV bisection (highest-clean 0.91 × 5pt safety) on spark-ff85; 2×2h thermal "All floors pass" with preemptions=0, oom=0; decode p50 7.6 tok/s p1 6.5 tok/s, GPU clock 2476 MHz flat (zero throttle). `sha256:c3ccf1e1...` **Reserves ~110 GiB UMA** — frozen as bisection-result audit artifact, not for daily use. |

### `profiles/gemma-4-31b-it/` (Phase 4.1 dense sibling — eval-only, opt-in)

| Version | Status | Bootable? | Notes |
|---------|--------|-----------|-------|
| **v1.1** | Phase 4.1 follow-up — DEFAULT_VARIANT | **yes** | RAM-headroom retune of v1 (gmu 0.86 → 0.55, D-29-equivalent). Targets ~70 GB emmy-serve footprint, leaves >40 GiB system headroom on 128 GiB UMA. All other fields byte-identical to v1 — `container_entrypoint_override=""` + `strip_thinking_tags=true` quirks preserved. `sha256:55d5f8cc...` **This is the variant `/profile gemma-4-31b-it` resolves to.** |
| v1 | Phase 4.1 locked — KV-ceiling audit | yes | Upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` (same image as Gemma 26B MoE v2). `gpu_memory_utilization=0.86` via 11-iter KV bisection on spark-ff85; 2×2h thermal "All floors pass" with preemptions=0, oom=0; decode p50 6.4 tok/s p1 6.2 tok/s (after warm-cache), GPU clock p5/p50 2405/2496 MHz. `sha256:fe9eded6...` BF16 publisher weights → runtime FP8 quant. **Reserves ~110 GiB UMA** — frozen as bisection-result audit artifact. |

**Phase 4.1 dense profiles are additive + opt-in.** Daily-driver default is Gemma 4 26B-A4B v2 (since 2026-04-28); the dense siblings exist for Phase 5 dense-vs-MoE A/B comparison and were both V1-memory cleared in V-RESULTS-v8 (Qwen 27B 100%, Gemma 31B 95%). Per operator directive (saved in user memory), throughput on the dense profiles is **informational only** — NOT an acceptance gate. Phase 5 eval matrix in `eval/MATRIX.md` enumerates all participants. Side finding: all 4 KV-bisected profiles (35B-A3B v3, 27B v1, 26B-A4B v2, 31B v1) converge to gmu=0.86 → that's a hardware-level vLLM allocation ceiling on GB10 / 128 GB UMA, not a model knob. v3.1 / v1.1 back off to gmu=0.55 for system-RAM headroom (Pitfall #3 trumps Pitfall #1 sole-writer for sibling re-targets that prioritize operator comfort).

To swap to a dense profile inside a running pi-emmy TUI: `/profile qwen3.6-27b` or `/profile gemma-4-31b-it` (both have a `DEFAULT_VARIANT=v1` family marker). Each respects its family's container — Qwen lands on the NGC fastsafetensors image, Gemma on the upstream Day-1 image.

### Role routing (Phase 4 + Phase 4.1)

`profiles/routes.yaml` maps role heuristics (plan / edit / critic / default) to Qwen 3.6 v3.1 sibling variants (same engine bytes, different sampling + prompt). Phase 4.1 added an optional `dense:` role that maps to `qwen3.6-27b@v1` for callers that explicitly want dense behavior (no MoE expert routing variance) — opt-in only.

**As of the 2026-04-28 daily-driver switch to Gemma 4 26B-A4B v2, role routing degrades to a no-op on the default path** because Gemma has no role-variant siblings yet — engine byte-identity prevents the Qwen overlays from applying meaningfully to a Gemma engine. Routes still fire when the loaded engine is Qwen (e.g. `pi-emmy --profile profiles/qwen3.6-35b-a3b/v3.1` or `/profile qwen3.6-35b-a3b` from the TUI). Authoring Gemma plan/edit/critic siblings is Phase 5+ work.

---

## What each stack provides

| Stack | Port | Required for | Disable |
|-------|------|--------------|---------|
| `emmy-serve` | 127.0.0.1:8002 | inference (every pi-emmy request) | none — required |
| `emmy-sidecar` | 127.0.0.1:8003 | `/start`, `/stop`, `/status`, `/profile` slash commands; remote-client control plane (Phase 04.2) | `systemctl --user stop emmy-sidecar` (local-mode `/profile` falls back to spawn path) |
| Langfuse | 127.0.0.1:3000 | tracing (optional) | leave `LANGFUSE_*` env empty or `EMMY_TELEMETRY=off` |
| SearxNG | 127.0.0.1:8888 | `web_search` tool (optional) | `bash scripts/stop_searxng.sh` or `EMMY_WEB_SEARCH=off` |

With all four up, the harness talks to four loopback endpoints. SearxNG is the only container with outbound traffic (to search engines). That's the one deliberate egress surface; see `CLAUDE.md § Design Principles` for the rationale. The sidecar (FastAPI on 8003) is also loopback in local mode — it only becomes tailnet-exposed when you opt in via `tailscale serve` (see Remote-client mode below).

---

## Remote-client mode (Mac / laptop ↔ Spark over Tailscale)

You can run the **harness on a client machine** (e.g. a MacBook) and offload **just inference** to Spark over Tailscale. Tools (`bash`, `read`, `edit`, `web_fetch`) execute on the client's filesystem against whatever folder you launch from — so coding sessions act on the laptop's project tree while the model runs on Spark. Air-gap invariant is preserved: emmy-serve still binds loopback on Spark; Tailscale Serve adds a controlled tailnet-only HTTPS endpoint on top.

### One-press client install (recommended)

After completing the Spark-side setup below, on the client machine:

```sh
curl -fsSL https://raw.githubusercontent.com/mratan/emmy/main/scripts/install-client.sh | bash
```

The bootstrap auto-detects Spark's MagicDNS name from your tailnet, installs missing prereqs (bun + git via Homebrew on Mac, or apt/dnf/pacman on Linux), clones the repo to `~/code/emmy`, writes the `emmy` wrapper to `~/.local/bin`, ensures PATH is set, and runs an end-to-end smoke test. Idempotent — re-run any time to update.

To review the script before piping it to a shell:

```sh
curl -fsSL https://raw.githubusercontent.com/mratan/emmy/main/scripts/install-client.sh -o install-client.sh
less install-client.sh
bash install-client.sh
```

Skip to "Caveats" below for what to know about profile swaps, telemetry, and hardening followups. The manual setup that follows is the equivalent unrolled in case you want fine-grained control.

### Spark side (one-time setup)

```sh
# 1. Enable Tailscale Serve on your tailnet — admin console toggle, one click:
#    https://login.tailscale.com/admin/settings/general (tailnet feature flags)

# 2. Set tailscale operator so future serve commands don't need sudo:
sudo tailscale set --operator=$USER

# 3. Expose three Spark services on the tailnet (Phase 04.2 expanded from 1 → 3):
tailscale serve --bg --https=8002 http://127.0.0.1:8002    # vLLM (existing)
tailscale serve --bg --https=8003 http://127.0.0.1:8003    # sidecar (NEW — /start /stop /status /profile)
tailscale serve --bg --https=8888 http://127.0.0.1:8888    # SearxNG (NEW — web_search from Mac)

# 4. Install + enable the always-on sidecar systemd user unit (Phase 04.2):
bash scripts/start_emmy.sh --install-sidecar-unit
systemctl --user enable --now emmy-sidecar

# 5. Survive logout (sidecar persists across SSH disconnect / reboot):
loginctl enable-linger $USER

# 6. Verify:
tailscale serve status
#  https://<spark-hostname>.<tailnet>.ts.net:8002 → http://127.0.0.1:8002  (vLLM)
#  https://<spark-hostname>.<tailnet>.ts.net:8003 → http://127.0.0.1:8003  (sidecar)
#  https://<spark-hostname>.<tailnet>.ts.net:8888 → http://127.0.0.1:8888  (SearxNG)
systemctl --user status emmy-sidecar
```

**Air-gap thesis preserved (D-33 LOCKED):** in **local mode** (Spark with `EMMY_REMOTE_CLIENT` unset), `web_search` defaults to loopback `127.0.0.1:8888`. The remote-client `EMMY_SEARXNG_URL` env override is the documented escape hatch for Mac→Spark posture, NOT a profile change. The STRICT air-gap CI gate (`emmy_serve.airgap.ci_verify_phase3 --dry-run`) continues to pass on Spark in local mode (verified by `tests/smoke/verify_airgap_local_mode.sh`).

### Client side — manual fallback

Use this if the one-press install above doesn't fit your environment (e.g. you want a custom install location or non-default repo URL). Replace `<spark>.<tailnet>.ts.net` with your actual MagicDNS name from `tailscale serve status`.

```sh
# 1. Prerequisites (macOS):
brew install bun git

# 2. Clone the repo somewhere stable on the client:
mkdir -p ~/code && cd ~/code
git clone <emmy-repo-url> emmy
cd emmy && bun install

# 3. Confirm Tailscale + Spark reachability:
curl -sf https://<spark>.<tailnet>.ts.net/v1/models | head -c 200
#   {"object":"list","data":[{"id":"gemma-4-26b-a4b-it",...   (or "qwen3.6-35b-a3b" if Spark is on the alternate)

# 4. One-shot smoke test:
EMMY_SKIP_PROFILE_VALIDATE=1 \
  bun packages/emmy-ux/bin/pi-emmy.ts \
  --base-url https://<spark>.<tailnet>.ts.net \
  --print "Reply with: SP_OK_TEST_PASS"

# 5. Wrapper in PATH for any-folder use (Phase 04.2 — 3 endpoints, no kill-switch needed):
mkdir -p ~/.local/bin
cat > ~/.local/bin/emmy <<'WRAPPER'
#!/bin/sh
# emmy — remote-client wrapper. Routes inference + sidecar control + web_search to Spark via Tailscale.
# AGENTS.md / per-project context picked up from $PWD at session start.
# Tools (bash/edit/read) execute locally; inference + /start /stop /status /profile + web_search offload to Spark.
exec env \
  EMMY_PROFILE_ROOT="$HOME/code/emmy" \
  EMMY_SKIP_PROFILE_VALIDATE=1 \
  EMMY_REMOTE_CLIENT=1 \
  EMMY_SERVE_URL="https://<spark>.<tailnet>.ts.net:8003" \
  EMMY_SEARXNG_URL="https://<spark>.<tailnet>.ts.net:8888" \
  bun "$HOME/code/emmy/packages/emmy-ux/bin/pi-emmy.ts" \
  --base-url "https://<spark>.<tailnet>.ts.net" \
  "$@"
WRAPPER
chmod +x ~/.local/bin/emmy

# Ensure ~/.local/bin is on PATH (zsh):
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Then from any folder on the client:

```sh
cd ~/some-project
emmy                                # interactive TUI
emmy --print "Summarize this repo"  # one-shot
```

### Why each env var in the wrapper

| Var | Purpose |
|---|---|
| `EMMY_PROFILE_ROOT` | Tells pi-emmy where the cloned repo lives so profile lookup works from arbitrary `$PWD`. |
| `EMMY_SKIP_PROFILE_VALIDATE=1` | The Mac doesn't have the Python `emmy` package; Spark already validated the profile at boot. |
| `EMMY_REMOTE_CLIENT=1` | Phase 04.2 — flips `profile-swap-runner.ts` and `metrics-poller.ts` into HTTP-mode (route through the Spark sidecar instead of `spawn("uv", …)`). |
| `EMMY_SERVE_URL=https://<spark>:8003` | Phase 04.2 — sidecar control-plane endpoint; consumed by `/start`, `/stop`, `/status`, `/profile` slash commands and the footer poller. |
| `EMMY_SEARXNG_URL=https://<spark>:8888` | Phase 04.2 — Spark-side SearxNG over Tailscale; replaces the prior `EMMY_WEB_SEARCH=off` workaround. The local-mode default of `127.0.0.1:8888` (D-33 LOCKED) is preserved when this env is unset. |

### Caveats

- **Profile swaps (`/profile <name>`)** dispatch to the Spark side via the SDK; the Mac repo just needs to stay `git pull`-fresh so both ends agree on the profile dir layout.
- **Telemetry**: by default JSONL telemetry writes to `~/.emmy/telemetry/feedback.jsonl` on the Mac. To pipe Mac sessions into the Spark-hosted Langfuse instance, expose Langfuse via a second `tailscale serve --bg --https=443 --set-path=/langfuse http://localhost:3000` (or similar) and set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` in the wrapper.
- **Hardening followup** (tracked, not blocking client mode): Docker's `-p 8002:8000` currently binds `0.0.0.0` rather than the loopback `CLAUDE.md § Hidden cloud dependencies` claims. Tailscale ACLs gate access for now; a future tightening to `-p 127.0.0.1:8002:8000` makes Tailscale Serve the *only* tailnet-exposure path.
- **emmy-serve must be running on Spark** for the client to work — `tailscale serve` only proxies; it doesn't auto-start the model server. `bash scripts/start_emmy.sh` on Spark first.

---

## Common troubleshooting

**Agent returns 400 "context length is only 131072 tokens, maximum input length 114688"**
Phase 3.1's live auto-compaction fires at the 75% soft threshold (86016 tokens). If it didn't trigger:
- confirm you're on a profile that has compaction wired (`pi-emmy --print-environment`): Qwen `v3.1`+ or Gemma `v2`+. The Phase 2 Qwen `v2` baseline has no compaction.
- use `/clear` (emmy slash command) or `/compact` (pi built-in) from inside the TUI
- restart: press `Ctrl-D` on empty editor to exit, re-launch

**`free -h` shows <10 GiB available, swap in use**
vLLM `gpu_memory_utilization` is too aggressive for DGX Spark UMA. The shipping daily-driver Gemma `v2` runs at gmu=0.86 (~103 GiB UMA reserve) by design — that's the bisected ceiling. The alternate Qwen `v3.1` runs at gmu=0.55 (~70 GiB) for headroom. If you need extra system RAM under Gemma, either swap to Qwen `v3.1` (`/profile qwen3.6-35b-a3b`) or cut a `gemma-4-26b-a4b-it/v2.1` sibling at gmu=0.55 (mirrors Qwen v3→v3.1 / dense v1→v1.1 precedent). See `docs/runbook.md § RAM tuning`.

**Sidecar at 127.0.0.1:8003 is dead but vLLM still serves**
Recent operating experience surfaced a kernel-OOM cascade where global memory pressure from concurrent workloads kills the sidecar (small RSS, score_adj=200) while vLLM (large RSS, in a separate docker cgroup at score_adj=0) survives. The 2026-04-28 fix added `OOMScoreAdjust=-200` to `emmy-sidecar.service` so the sidecar is reaped last. To recover: `journalctl -k -n 100 \| grep oom-kill` to confirm; if user-systemd itself was killed, `loginctl enable-linger $USER` + re-login (or `sudo systemctl restart user@$(id -u).service`) to bring it back; then `systemctl --user start emmy-sidecar`. vLLM is unaffected — `pi-emmy --base-url http://127.0.0.1:8002` keeps working through the outage. See `.planning/phases/04.2-remote-client-mode-parity/POSTMORTEM-sidecar-oom-cascade-2026-04-28.md`.

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
profiles/gemma-4-26b-a4b-it/v{1,2}/         # Daily-driver Gemma MoE (v2 default since 2026-04-28; v1 historical)
profiles/qwen3.6-35b-a3b/v{1,2,3,3.1,3.2}/  # Alternate Qwen MoE (v3.1 was prior daily-driver; faster but compliance gap)
profiles/qwen3.6-27b/v{1,1.1}/              # Phase 4.1 dense Qwen sibling (opt-in)
profiles/gemma-4-31b-it/v{1,1.1}/           # Phase 4.1 dense Gemma sibling (opt-in)
emmy_serve/                              # vLLM container wrapper, profile loader, air-gap validators
  swap/                                  # FastAPI sidecar (Phase 04.2): /start /stop /status /profile/swap; D-01 graceful drain; SSE progress
  systemd/                               # emmy-sidecar.service user unit (Phase 04.2): always-on control plane
packages/
  emmy-provider/                         # pi provider adapter + @emmy/provider streamSimple wiring
  emmy-tools/                            # 8 native tools + web_search (EMMY_SEARXNG_URL override) + MCP bridge + web_fetch allowlist
  emmy-telemetry/                        # dual-sink JSONL+OTLP telemetry + feedback capture
  emmy-context/                          # compaction trigger (D-14 preservation + D-12 hard-ceiling)
  emmy-ux/                               # prompt assembly + pi-emmy CLI + TUI + slash commands + dual-path dispatcher (D-04 BYTE-STABLE)
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

**From Phase 04.2** (CLOSURE PENDING — 3 SCs need a live Mac+Spark+Tailscale rig; runbook scripts ship reproducible steps):
- `sc1 phase4.2 green` — Mac client one-shot through Tailscale (`emmy --print "Reply with: SP_OK_PHASE4_2_GREEN"` round-trip + optional `web_search` smoke). Promotes TOOLS-10 Done† → Done.
- `sc2 phase4.2 green` — `/start` `/stop` `/status` round-trip with D-01 graceful drain (long-gen interrupt verified). Promotes UX-04 + UX-07 Done† → Done.
- `sc3 phase4.2 green` — `/profile` swap from Mac with C-06 4-phase SSE progress over Tailscale. Promotes UX-04 Done† → Done.

See `docs/runbook.md § Phase 04.2 SC walkthroughs` for the verbatim operator scripts and `.planning/phases/04.2-remote-client-mode-parity/04.2-HUMAN-UAT.md` for the promotion path.

See `.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-HUMAN-UAT.md` + `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md § Deferrals` for details.

---

## Roadmap

Emmy ships in 7 phases across v1 milestones. Cumulative progress: 5/7 base phases complete (1, 2, 3, 4) plus four mid-milestone insertions (3.1, 4.1, 04.2, 04.4). 43/68 v1 REQ-IDs Done; TOOLS-10/UX-04/UX-07 at Done† pending Phase 04.2 SC operator confirmation.

- **Phase 1** (CLOSED): serving foundation + profile schema
- **Phase 2** (CLOSED): pi-harness MVP — daily-driver baseline
- **Phase 3** (CLOSED): observability + agent-loop hardening + lived-experience
- **Phase 3.1** (CLOSED): operational polish — RAM + live compaction + SearxNG + docs
- **Phase 4** (CLOSED): Gemma 4 profile + profile system maturity (all 4 operator carry-forwards resolved 2026-04-24)
- **Phase 4.1** (CLOSED 2026-04-25): dense-variant model profiles — Qwen 3.6-27B-FP8 + Gemma 4 31B-it dense siblings authored, KV-bisected (gmu=0.86 each, identical to MoE ceiling), 2×2h thermal-validated. `eval/MATRIX.md` enumerates the 4-profile Phase 5 participant matrix.
- **Phase 04.2** (CLOSURE PENDING 2026-04-25/26): remote-client mode parity — FastAPI sidecar (`emmy-sidecar` on 8003) + always-on systemd unit + Mac TS dispatcher + `/start /stop /status` slash commands + `install-client.sh` one-press wrapper + `EMMY_SEARXNG_URL` Tailscale override (D-33 LOCKED preserved in local mode). 250 Python + 620 TS tests green; 3 SC walkthroughs deferred. 2026-04-28 follow-up: `OOMScoreAdjust=-200` added to `emmy-sidecar.service` after the OOM-cascade postmortem.
- **Phase 04.4** (EXEC LANDED, CLOSURE PENDING — operator-gated): filesystem-memory tool + append-only-prefix invariant + compaction polish (9 plans across 4 waves; 4 profile bundles updated with `memory:` block; D-3X prefix-hash + telemetry shipped). **2026-04-28 V-protocol matrix complete (V-RESULTS-v8):** 4-profile V1+V3 evidence — Gemma MoE 100%/5/5, Qwen dense 100%/5/5, Gemma dense 95%/5/5, Qwen MoE 55%/5/5. Falsified the v7 active-params hypothesis; **daily-driver switched from Qwen 35B-A3B v3.1 to Gemma 4 26B-A4B v2** based on the matrix. Remaining V2/V8 compaction + V8 memory protocols are operator-time work.
- **Phase 5** (next): eval harness (terminal-bench, SWE-bench Verified, LiveCodeBench) — first phase to A/B-evaluate the new Gemma daily-driver against Qwen.
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

Every profile knob is documented in each bundle's `PROFILE_NOTES.md` (e.g. `profiles/gemma-4-26b-a4b-it/v2/PROFILE_NOTES.md` and `profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md`) with provenance (`Retrieved` date + source URL) per REPRO-02 discipline.

---

## Further reading

- `CLAUDE.md` — project thesis + critical pitfalls + design principles (load-bearing for contributors)
- `.planning/PROJECT.md` — project-level context, core value, key decisions
- `.planning/REQUIREMENTS.md` — 68 v1 requirements with phase traceability
- `.planning/ROADMAP.md` — 7-phase plan with success criteria
- `docs/runbook.md` — day-to-day ops
- `.planning/research/` — Phase 1 research (STACK, FEATURES, ARCHITECTURE, PITFALLS)
