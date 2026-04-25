# Emmy runbook

Day-to-day operations. For first-time setup + quickstart, see top-level `README.md`.

---

## Log locations

| What | Where | Notes |
|------|-------|-------|
| emmy-serve boot log | `runs/<iso>-<rand>/boot.log` | each `start_emmy.sh` run creates a fresh run-dir |
| emmy-serve smoke test | `runs/<iso>-<rand>/smoke.log` | tok/s + assertion passes |
| vLLM container stderr | `docker logs emmy-serve` | live server log |
| pi-emmy session transcript | `<cwd>/runs/phase2-sc3-capture/session-<iso>.jsonl` | one file per pi-emmy invocation; Plan 02-04 B2 always-on |
| Emmy telemetry (JSONL) | `<cwd>/runs/<iso>-<prompt-sha>/events.jsonl` | per-session event stream; profile-stamped per Plan 03-02 |
| Feedback corpus | `~/.emmy/telemetry/feedback.jsonl` | Alt-style thumbs-up/down rows; 13-field schema |
| Langfuse traces | http://localhost:3000 → Traces | requires LANGFUSE_*_KEY in `observability/langfuse/.env` |
| SearxNG query log | `docker logs searxng-searxng-1` | each `tool.web_search` fires one query |
| Walkthrough evidence | `.planning/phases/<phase>/runs/` | per-plan operator evidence, committed to git |

---

## Common error messages + resolutions

### `400 "context length is only 131072 tokens, maximum input length 114688"`

Live auto-compaction didn't fire. Quick escapes:
- Inside TUI: `/clear` (resets session) or `/compact` (pi built-in; compacts in place)
- From another terminal: `pkill -f pi-emmy` then re-launch

Root-cause investigation: confirm you're on v3.1 (`pi-emmy --print-environment` shows `profile=qwen3.6-35b-a3b@v3.1`). v2 has no compaction. If on v3.1 and compaction still didn't fire, file against `.planning/phases/03.1-.../runs/phase3.1-01/` — this was the exact bug 03.1-01 fixed.

### `ERROR (digest): local image not found`

`start_emmy.sh` expects the vLLM container image (digest-pinned in `profiles/*/serving.yaml`) to be present locally. Pull once per machine:

```bash
docker pull nvcr.io/nvidia/vllm:26.03.post1-py3
```

### `Profile validation failed: hash mismatch`

Profile file was edited in place. D-02 immutability requires a sibling version. Recover:

```bash
# Option A: revert
git restore profiles/qwen3.6-35b-a3b/v3.1/

# Option B: clone to a new version
cp -r profiles/qwen3.6-35b-a3b/v3.1/ profiles/qwen3.6-35b-a3b/v3.2/
# edit v3.2 only
uv run emmy profile hash --write profiles/qwen3.6-35b-a3b/v3.2/
uv run emmy profile validate profiles/qwen3.6-35b-a3b/v3.2/
```

### `[emmy] Langfuse keys not set (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY) - running JSONL-only`

Expected when Langfuse isn't provisioned. Fix by either (a) starting Langfuse + creating API keys in the UI, or (b) ignoring it — JSONL telemetry at `runs/<iso>-<sha>/events.jsonl` still works.

### `Warning: Extension command '/compact' conflicts with built-in interactive command. Skipping in autocomplete.`

Was present until Phase 3.1 Plan 03-03 cleanup. If you see it: pull latest.

---

## RAM tuning

DGX Spark's 128 GB is unified (GPU + CPU share the pool). vLLM's `--gpu-memory-utilization` directly steals from system RAM.

| Setting | Effect | Where |
|---------|--------|-------|
| `gpu_memory_utilization: 0.55` (v3.1 default) | ~50-70 GB emmy-serve footprint; ≥40 GB system headroom | `profiles/qwen3.6-35b-a3b/v3.1/serving.yaml` |
| `0.65` | +10 GB to KV reserve; tighter headroom | tune if running many concurrent agent turns |
| `0.50` | ~40 GB emmy-serve; generous headroom for heavy browser / other workloads | tune if multi-tenant box |
| `0.88` (old v3 default) | **swap thrashing** — DO NOT use on UMA | was the Phase 1 KV-finder result; CLAUDE.md Pitfall #3 |

To change: edit the target v3.x `serving.yaml`, recompute the hash (`uv run emmy profile hash --write`), restart emmy-serve with the new profile.

### Debug: check current RAM pressure

```bash
free -h               # MemAvailable should be ≥40 GiB
docker stats --no-stream emmy-serve | tail -1
nvidia-smi --query-gpu=memory.used,memory.free --format=csv
```

### Debug: what's vLLM actually using?

```bash
ps auxww | grep '[v]llm serve' | head -1 | grep -oE '(max-model-len|gpu-memory-utilization|max-num-batched-tokens) [0-9.]+'
```

---

## SearxNG: engine management + rate-limit mitigation

SearxNG aggregates Google + DDG + Brave + Bing + Startpage. Engines rotate automatically; if one rate-limits (Google commonly does at ~100 queries), SearxNG falls back to the others.

### Disable an engine

Edit `observability/searxng/settings.yml` → find the engine → `disabled: true`. Restart:

```bash
bash scripts/stop_searxng.sh && bash scripts/start_searxng.sh
```

### Adjust engine priority (make Google rarer)

Same file. Engine entries have an implicit equal weight; add `weight: 0.1` to Google and `weight: 2.0` to DDG to shift rotation.

### Test a specific engine directly

```bash
# Google only
curl -s 'http://127.0.0.1:8888/search?q=bun+runtime&format=json&engines=google' | jq '.results[0]'

# DDG only
curl -s 'http://127.0.0.1:8888/search?q=bun+runtime&format=json&engines=duckduckgo' | jq '.results[0]'
```

### Complete disable (stricter posture)

```bash
bash scripts/stop_searxng.sh
# OR in-session:
EMMY_WEB_SEARCH=off pi-emmy
# OR set in profile: profiles/qwen3.6-35b-a3b/v3.1/harness.yaml → tools.web_search.enabled: false
```

---

## Langfuse: API-key rotation

Tokens in `observability/langfuse/.env` are session-scoped per Langfuse project. To rotate:

1. Langfuse UI → project → Settings → API Keys → "Revoke" old key
2. "Create new" → copy `pk-lf-...` + `sk-lf-...`
3. Update `observability/langfuse/.env`:
   ```
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   ```
4. Restart pi-emmy (env reloaded on next boot)

---

## /compact and /clear — when to use

Both land in Phase 3.1 Plan 03.1-01 as manual escape valves for the rare case auto-compaction doesn't catch up in time.

| | `/compact` | `/clear` |
|---|---|---|
| What | Summarize history, preserving system prompt + first user message + last N turns | Drop ALL history; keep only boot context |
| When | Context getting long (~70K tokens), want to keep the task thread alive | Starting a fundamentally new task; want a fresh session |
| Optional arg | `/compact focus on the key design decisions` — appended to profile's `prompts/compact.md` | none |
| SP_OK re-fires | no (same session, just summarized) | yes (fresh AgentSession via `ctx.newSession`) |
| Backed by | pi 0.68 built-in → `session.compact()` | emmy extension → `ctx.newSession()` |

**Note:** emmy's `/compact` registration was removed in Phase 3.1 Plan 03.1-03 (pi's built-in is functionally equivalent); manual `/compact` uses pi's default prompt, not emmy's profile prompt. Auto-compaction on turn_start DOES use emmy's profile prompt.

---

## Air-gap CI (pre-publication smoke gates)

Phase 3.1 split air-gap CI into two levels:

| Validator | Gate | Usage |
|-----------|------|-------|
| `emmy_serve.airgap.ci_verify_phase3` | STRICT — zero outbound allowed | `uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run` — asserts loopback-only inference posture |
| `emmy_serve.airgap.ci_verify_research_egress` | PERMISSIVE — SearxNG outbound OK | `uv run python -m emmy_serve.airgap.ci_verify_research_egress --dry-run` — asserts no inference-API egress (blocks api.openai.com, api.anthropic.com, Bedrock, etc.) |

Full (non-dry-run) validators require a self-hosted runner with tcpdump + sustained-load capture; deferred per Phase 1 Plan 01-08 carry-forward.

### pi-coding-agent's startup network calls

pi-coding-agent (the harness library, pinned at 0.68.0) makes two unsolicited outbound calls when the TUI starts: `registry.npmjs.org/.../latest` (the "Update Available" banner) and `pi.dev/install?version=…` (install telemetry, gated on pi's `installTelemetryEnabled` setting). Neither is inference, so neither is in the `ci_verify_phase3` perimeter — but neither is in emmy's documented egress story (SearxNG only) either.

`pi-emmy.ts` sets `PI_SKIP_VERSION_CHECK=1` by default, which silences the banner. The pi.dev install-telemetry call only fires when pi's setting opts in (default off in 0.68.0). Operators wanting a stricter posture can launch with `PI_OFFLINE=1 emmy …` — that gates **all** of pi's startup network ops including its auto-download of `fd`/`rg` binaries (which pi's autocomplete uses; emmy's own `grep`/`find` tools shell out to system binaries and are unaffected). On a Spark box that already has `rg`/`fd` on PATH, `PI_OFFLINE=1` is free; on a fresh laptop in remote-client mode it degrades pi's autocomplete to no-fd. To re-enable the banner (e.g. before a deliberate version bump): `PI_SKIP_VERSION_CHECK= emmy …`.

### Phase 04.2 note

The Phase 04.2 sidecar listens on `0.0.0.0:8003` for the Mac-client control plane (`/start`, `/stop`, `/status`, `/profile/swap`). This is an **inbound listening socket**, not an outbound connection. The STRICT validator (`ci_verify_phase3.py`) gates only outbound `ss -tnp state established` endpoints — listening sockets are invisible to it. Local-mode air-gap posture is unchanged; the gate continues to pass on Spark with `EMMY_REMOTE_CLIENT` unset (verified: `EMMY_WEB_SEARCH=off uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run` → exit 0).

---

## Remote-client posture

> Phase 04.2 — Mac/laptop client controls a Spark-side sidecar over Tailscale.

### When to use

You're running emmy from a Mac or laptop and want `/profile`, `/start`, `/stop`, `/status`, and `web_search` to work as if you were on Spark itself. The sidecar (`emmy_serve.swap.controller`) is a thin process supervisor + HTTP proxy; vLLM stays on-demand on Spark.

### Spark-side one-time setup (every box, once)

```bash
# 1. Install + enable the systemd user unit:
bash scripts/start_emmy.sh --install-sidecar-unit

# 2. Survive logout (operator MUST run this):
loginctl enable-linger $USER

# 3. Tailscale Serve routes (persists across reboot):
tailscale serve --bg --https=8002 http://127.0.0.1:8002    # vLLM (existing)
tailscale serve --bg --https=8003 http://127.0.0.1:8003    # sidecar (NEW)
tailscale serve --bg --https=8888 http://127.0.0.1:8888    # SearxNG (NEW)

# 4. Verify:
systemctl --user status emmy-sidecar
curl -sf http://127.0.0.1:8003/healthz
tailscale serve status
```

### Mac-client environment variables

The wrapper installed by `scripts/install-client.sh` sets these automatically:

| Var | Value | Purpose |
|-----|-------|---------|
| `EMMY_REMOTE_CLIENT` | `1` | Routes `/profile` swap dispatcher through HTTP+SSE to sidecar |
| `EMMY_SERVE_URL` | `https://<spark>.<tailnet>.ts.net:8003` | Sidecar control plane |
| `EMMY_SEARXNG_URL` | `https://<spark>.<tailnet>.ts.net:8888` | Web-search via Spark-hosted SearxNG (replaces previous `EMMY_WEB_SEARCH=off`) |
| `EMMY_SKIP_PROFILE_VALIDATE` | `1` | Mac has no profile bundles by default |

### Air-gap posture (D-33 LOCKED preserved)

In **local mode** (`EMMY_REMOTE_CLIENT` unset on Spark itself), `web-search.ts` defaults its baseUrl to `http://127.0.0.1:8888` — D-33 LOCKED loopback invariant intact. The `EMMY_SEARXNG_URL` override is the **documented escape hatch** for remote-client posture, NOT a profile change. The STRICT validator (`ci_verify_phase3.py`) continues to gate egress in local mode unchanged.

In **remote mode**, the Mac client legitimately reaches Spark over Tailscale. The "no cloud INFERENCE" thesis is unaffected — the LLM is still 100% local; only the control plane and the SearxNG egress hop traverse the tailnet.

### Debugging

```bash
# Live sidecar logs:
journalctl --user -u emmy-sidecar -f

# Restart after a crash:
systemctl --user restart emmy-sidecar

# Disable temporarily (e.g. for maintenance):
systemctl --user stop emmy-sidecar
# Re-enable: systemctl --user start emmy-sidecar
```

If `loginctl enable-linger` was not run, the sidecar dies on logout and `systemctl --user status emmy-sidecar` will show `inactive (dead)` after the SSH session closes. Re-run `loginctl enable-linger $USER` and `systemctl --user enable --now emmy-sidecar`.

---

## Feedback corpus and HF export

Press `Ctrl-Shift-Up` (Phase 3.1 chord; was Alt+Up in earlier docs — pi built-in collision) on the most-recent completed turn:
- Thumbs-up → one-click `rating: 1` row
- `Ctrl-Shift-Down` → opens free-text prompt → `rating: -1 + comment`
- Idempotent — repress on same turn doesn't duplicate
- `EMMY_TELEMETRY=off` suppresses capture

Export the accumulated corpus to a HuggingFace-datasets-loadable shape:

```bash
pi-emmy --export-hf /tmp/emmy-feedback-corpus
# Produces: feedback.jsonl + dataset_card.md + provenance.json
```

Load in Python:

```python
from datasets import load_dataset
ds = load_dataset("json", data_files="/tmp/emmy-feedback-corpus/feedback.jsonl")
```

See `.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-05-SUMMARY.md` for the 13-field schema spec.

---

## Verification

Four-way regression (run before committing anything substantive):

```bash
bun test                                                    # @emmy/* unit + integration tests
bun run typecheck                                           # all 5 workspace packages
uv run pytest tests/unit -q                                 # Python side (emmy_serve + profile schema)
uv run emmy profile validate profiles/qwen3.6-35b-a3b/v3.1  # every profile version you care about
```

---

## Swapping profiles (`/profile`)

Phase 4 shipped atomic `/profile <name>[@<variant>]` as a pi-emmy slash command. The swap tears down the running vLLM container, brings up a new one against the target profile, and rewires harness-side state (profile cache + OTel stamp processor + web_fetch allowlist) — all without leaving pi-emmy or losing the session transcript.

### The four-phase progress contract (D-02 LOCKED)

During a swap the pi-emmy status row (bottom of TUI) cycles through these four strings **verbatim** — if you see different labels, file against Plan 04-02 / 04-03:

1. `stopping vLLM` (~5 s — existing container torn down)
2. `loading weights 0%` → `loading weights 50%` → `loading weights 90%` (~90–160 s for a 26–35B MoE on DGX Spark)
3. `warmup` (~10 s — SP_OK canary + minimal generation smoke)
4. `ready` (swap complete; next turn lands on the new profile)

Behind the scenes the Python primitive (`uv run python -m emmy_serve.swap.orchestrator --from … --to … --port 8002`) emits one JSON-per-line progress record to stdout; the TS `profile-swap-runner` parses each line and calls `ctx.ui.setStatus("emmy.swap", renderProgress(phase, pct?))`. On `ready` the harness reloads the new profile + hot-swaps the OTel stamp processor (D-23) and the status row clears.

### What happens if a swap fires mid-turn

pi-emmy rejects `/profile` with verbatim message **"swap deferred — request in flight, finish or Ctrl+C first"** (D-06 guard). Either wait for the turn to finish, or Ctrl+C the in-flight generation, then re-issue the `/profile` command.

### Exit codes + what they mean

| Exit | Meaning | User sees |
|---|---|---|
| 0 | Swap succeeded end-to-end | `swapped to <new-profile>` |
| 5 | Pre-flight failed — **prior engine still running** (D-05 validate-first-then-stop) | `swap pre-flight failed (prior model still serving)` — your current profile is unchanged; typical cause is a bad `container_image_digest`, missing weights, or schema violation in the target bundle |
| 6 | Post-stop failure **with rollback** — prior engine restored | `swap failed; rollback succeeded` OR `swap failed; rollback FAILED — manual recovery required in runs/boot-failures/…` (read the envelope `rollback_succeeded` field) |
| other non-zero | Unexpected error | `swap failed; see runs/boot-failures/<iso>-…/` — diagnostic bundle captured |

Diagnostic bundles at `runs/boot-failures/<iso>-swap-{preflight,postboot,rollback}-failure/` contain (a) the relevant section of `docker logs`, (b) `profile validate` + `profile hash` output, (c) the rendered `docker run` argv, (d) a `reason.md` narrative.

### Common error messages

| Message | Typical cause | Fix |
|---|---|---|
| `swap pre-flight failed (hash mismatch)` | Target bundle was edited in place without recomputing the content hash | `uv run emmy profile hash <bundle> --write` then retry |
| `swap pre-flight failed (image digest not found locally)` | Target bundle's `container_image_digest` not in local docker | `docker pull nvcr.io/nvidia/vllm:26.03.post1-py3` (or whatever the bundle pins) |
| `swap pre-flight failed (schema validation failed)` | Target bundle has a schema-invalid field (typo, forbidden extra key) | `uv run emmy profile validate <bundle>` → fix the reported error |
| `swap failed; rollback succeeded — see runs/boot-failures/<iso>-swap-postboot-failure/` | New profile's `max_model_len` exceeds KV budget, or HF weights missing post-stop, or similar | Read the diagnostic bundle; common fixes: `max_model_len` too high → reduce; missing HF weights → `huggingface-cli download …` |
| Gemma 4 tool call parse failures on >50% of turns | vLLM upstream bug #39392 or #39468 (pad-token leak / format corruption) | Reactive XGrammar retry (`tools.grammar.mode: reactive`) is the designed backstop; if firing rate >50%, set `engine.max_num_seqs: 1` in the Gemma 4 bundle and re-certify hash |

### Verify a swap actually landed

- **pi-emmy footer** (Phase 3 UX-02): after `ready`, the footer model-name field flips to the new profile
- **Langfuse trace** (Phase 3 HARNESS-09): the next turn's chat-request span carries `emmy.profile.id` + `emmy.profile.version` matching the new profile
- **Runtime API** (Phase 1 D-04): `curl -s http://127.0.0.1:8002/v1/models | jq -r '.data[].id'` returns the new model

### First-time swap to Gemma 4

Gemma 4 lives under `profiles/gemma-4-26b-a4b-it/`. **Always swap to `v2/` — not `v1/`.** `v1/` targets NGC `26.03.post1-py3` whose Transformers library pre-dates `Gemma4ForCausalLM`; engine boot fails at `KeyError: invalid tool call parser: gemma4` followed by `pydantic ValidationError: model type 'gemma4' not recognized`. Kept in-tree only as historical record; do not boot.

`v2/` targets the upstream **`vllm/vllm-openai:gemma4-0409-arm64-cu130`** image (vLLM 0.19.1.dev6 + Transformers 5.5.0 + CUDA 13.0 + aarch64). Three things to know before the first swap:

1. **Pull the image first** (one-time, ~8 GB):
   ```bash
   docker pull vllm/vllm-openai:gemma4-0409-arm64-cu130
   ```
   The digest is pinned in `profiles/gemma-4-26b-a4b-it/v2/serving.yaml` — no re-tagging needed. After the pull, `docker inspect vllm/vllm-openai:gemma4-0409-arm64-cu130 --format '{{.Id}}'` should match `sha256:db59febc6c47...`.

2. **Cold boot is ~7 minutes**, not ~3. The upstream image doesn't bundle fastsafetensors (NGC's loader). Plain `safetensors` weight load is ~4× slower — this is the accepted tradeoff for Day-1 Gemma 4 support, and the probe timeout in `scripts/smoke_test.py` is 900 s (15 min ceiling). If you see `BOOT REJECTED (wait_for_vllm) /v1/models did not respond in 900s`, that's a real hang, not the slow loader.

3. **Pull weights into `/models/gemma-4-26B-A4B-it`** (~52 GB BF16; vLLM runtime-quants to FP8 on boot):
   ```bash
   huggingface-cli download google/gemma-4-26B-A4B-it --local-dir /models/gemma-4-26B-A4B-it
   ```

Tuned defaults in `v2/`: `gpu_memory_utilization=0.86` (measured via 11-iteration KV bisection on spark-ff85), `max_model_len=131072`, `tool_call_parser=gemma4` (vLLM 0.19 native), `quantization=fp8` (runtime, not pre-quantized). Thermal floors (decode p50 35.9 tok/s, p1 33.3 tok/s, GPU clock p5 2405 MHz) are baked into `PROFILE_NOTES.md` frontmatter and re-checked on any `--assert-floors` replay.

### Available profiles (Phase 4.1)

Four profiles ship in-tree as of Phase 4.1, each with a `DEFAULT_VARIANT` family marker so `/profile <family>` resolves automatically:

| Profile | HF repo | Weights path | Container | Cold boot | gmu | Notes |
|---|---|---|---|---:|---:|---|
| `qwen3.6-35b-a3b@v3.1` (default daily-driver) | `Qwen/Qwen3.6-35B-A3B-FP8` | `/models/Qwen3.6-35B-A3B-FP8` | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` (+ fastsafetensors) | ~3 min | 0.55 | MoE, 3B active |
| `qwen3.6-27b@v1.1` (Phase 4.1 dense — operational, DEFAULT_VARIANT) | `Qwen/Qwen3.6-27B-FP8` | `/models/Qwen3.6-27B-FP8` | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` (+ fastsafetensors) | ~3 min | 0.55 | Dense, bandwidth-bound (~7.6 tok/s); RAM-headroom retune of v1 |
| `qwen3.6-27b@v1` (Phase 4.1 dense — KV-ceiling audit) | `Qwen/Qwen3.6-27B-FP8` | `/models/Qwen3.6-27B-FP8` | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` (+ fastsafetensors) | ~3 min | 0.86 | Dense at the bisection ceiling; ~110 GiB UMA reservation. **Use only for KV-ceiling audit / Phase 5 ceiling studies, not daily use.** |
| `gemma-4-26b-a4b-it@v2` | `google/gemma-4-26B-A4B-it` | `/models/gemma-4-26B-A4B-it` | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | ~8 min | 0.86 | MoE, 4B active |
| `gemma-4-31b-it@v1.1` (Phase 4.1 dense — operational, DEFAULT_VARIANT) | `google/gemma-4-31B-it` | `/models/gemma-4-31B-it` | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | ~8 min | 0.55 | Dense, BF16 weights → runtime FP8 (~6.4 tok/s); RAM-headroom retune of v1 |
| `gemma-4-31b-it@v1` (Phase 4.1 dense — KV-ceiling audit) | `google/gemma-4-31B-it` | `/models/gemma-4-31B-it` | upstream `vllm/vllm-openai:gemma4-0409-arm64-cu130` | ~8 min | 0.86 | Dense at the bisection ceiling; ~110 GiB UMA reservation. Audit-only. |

**Container per family** — Qwen profiles always boot on the NGC fastsafetensors-derived image; Gemma profiles always boot on the upstream Day-1 Gemma 4 image. Don't try to cross-pollinate (NGC's Transformers pre-dates Gemma4ForCausalLM; upstream lacks fastsafetensors). The `serving.yaml.engine.container_image_digest` field pins each.

**Weight downloads** (one-time per profile; HF auth already configured on this host):

```bash
# Qwen 3.6 family — FP8 publisher weights
huggingface-cli download Qwen/Qwen3.6-35B-A3B-FP8 --local-dir /models/Qwen3.6-35B-A3B-FP8
huggingface-cli download Qwen/Qwen3.6-27B-FP8     --local-dir /models/Qwen3.6-27B-FP8

# Gemma 4 family — BF16 publisher weights (vLLM runtime-quants to FP8)
huggingface-cli download google/gemma-4-26B-A4B-it --local-dir /models/gemma-4-26B-A4B-it
huggingface-cli download google/gemma-4-31B-it     --local-dir /models/gemma-4-31B-it
```

**Throughput note (Phase 4.1 dense siblings)** — both dense profiles run at single-digit tok/s (Qwen 27B ~7.6, Gemma 31B ~6.3). This is bandwidth-bound by design on GB10's 128 GB UMA — the dense weights have to be read every decode step. Per operator directive, throughput is NOT an acceptance gate; thermal stability (zero preemptions, zero OOM, recorded floors) is. The dense siblings exist for Phase 5 dense-vs-MoE A/B comparison, not to replace the daily-driver MoE.

**Phase 5 eval matrix** — see `eval/MATRIX.md` for the four-profile participant manifest with hashes, container pins, and KV-bisection results.

---

## Within-model role routing (`routes.yaml`)

Phase 4 Plan 04-04 shipped per-turn role-based variant selection: a single loaded model (e.g. Qwen 3.6-35B-A3B) serves multiple variants that differ only in sampling / prompts / grammar (`harness.yaml` fields), not in engine config. The harness classifies each turn's role on-the-fly and applies the matching variant's overrides.

### routes.yaml schema (LiteLLM-shape)

Location: **`profiles/routes.yaml`** (top-level, not per-profile). Absence = default-only mode (harness falls back to the boot-time profile for every turn).

```yaml
default: qwen3.6-35b-a3b@v3.1-default

roles:
  plan:   qwen3.6-35b-a3b@v3.1-reason
  edit:   qwen3.6-35b-a3b@v3.1-precise
  critic: qwen3.6-35b-a3b@v3.1-default
```

- `default:` — the `<profile>@<variant>` route used when the classifier returns "default"
- `roles:` — flat map; `plan`, `edit`, `critic` at minimum. Missing roles silently fall back to `default`.
- Variant resolver picks `v3.1-reason > v3.1-* > first variant` in that preference order (Plan 04-03).

### How the classifier picks a role

Per-turn, in `before_provider_request` (pi 0.68 hook), the harness runs this decision tree (Plan 04-04 commit `7cb2d7b`):

1. **Explicit payload override** — `payload.emmy.role` set by test harness or replay → wins verbatim
2. **User-message-text regex** — the last user message starts with one of:
   - `plan:` / `think about` / `architect` / `design` / `strategy` / `outline` → role `plan`
   - `edit` / `write` / `modify` / `rename` / `refactor` / `fix` → role `edit`
   - `review` / `critique` / `audit` / `check` / `verify` → role `critic`
3. **Tools-hint refinement** — on iteration 2+ of a turn, if `payload.tools[]` contains a function named `edit` or `write` → role `edit` (refines an earlier "default")
4. **Fallback** — role `default`

One turn can carry spans with different `emmy.role` values across iterations (classifier re-fires on each iteration). Scoring convention: a turn is "correctly routed" iff its FINAL chat-request span (the one that produced the tool call that ran) carries the expected role.

### Inspect what role/variant fired on each turn

```bash
# Option 1 — JSONL sink (always on, Phase 3 D-10):
grep -E 'emmy\.profile\.variant|emmy\.role' ~/.emmy/telemetry/*.jsonl | tail -20

# Option 2 — Langfuse UI (if provisioned):
# Open http://127.0.0.1:3000 → drill into the session → inspect chat-request span attrs:
#   emmy.profile.id         = "qwen3.6-35b-a3b"
#   emmy.profile.version    = "v3.1-default"   (the base profile on which /profile was set)
#   emmy.profile.variant    = "v3.1-reason"    (the variant that actually answered this turn)
#   emmy.profile.variant_hash = sha256:705dcb60...   (per 04-04-SUMMARY.md)
#   emmy.role               = "plan"
```

### Temporarily disable role routing

Rename or delete `profiles/routes.yaml`. The harness silently falls back to default-only mode (absence is valid per D-08). Restart pi-emmy to re-read.

### Known variant hashes (Phase 4 close)

| Variant | Content hash | Sampling override | chat_template_kwargs |
|---|---|---|---|
| `v3.1-default` | `sha256:6ff80f620720563652f192d42da47418ecb2bfd96d3eacd6166252c35d65a4cf` | temperature=0.2 (Qwen team coding default) | enable_thinking=false |
| `v3.1-reason` | `sha256:705dcb60bcfc1236d70298c967a20ad3eebbc143a48d0770ae1e2364c3e4836f` | temperature=0.6 (Qwen reasoning guidance) | enable_thinking=true |
| `v3.1-precise` | `sha256:f16edde8cfe273ad9e9f3dd7a2ab3b03a7060a2acbb61e632585ed5ca19a95b2` | temperature=0.0 + every tool 0.0 (hash-anchored edits) | enable_thinking=false |

`serving.yaml` is byte-identical across all three variants (CI-enforced by `tests/unit/test_variant_engine_byte_identity.py`). Switching variants does NOT trigger a vLLM restart — it's a pure harness-state change on the next turn.

---

## Reference: where phase deferrals live

- Phase 1 operator-gated items → `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md § Deferrals`
- Phase 3 operator-gated items → `.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-HUMAN-UAT.md`
- Phase 3.1 close + carry-forward → `.planning/phases/03.1-operational-polish-minimal-ram-profile-live-auto-compaction-/03.1-CLOSEOUT.md`
- **Phase 4 operator-gated items → `.planning/phases/04-gemma-4-profile-profile-system-maturity/04-CLOSEOUT.md § Carry-forward / deferrals`** (KV bisection + thermal replay + SC-1 / SC-3 / SC-4 walkthroughs; scaffolds at `runs/phase4-{kv,thermal,sc1,sc3,sc4}/PENDING.md`)

`/gsd-audit-uat` surfaces all currently-open UAT items across phases.
