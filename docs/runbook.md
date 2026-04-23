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

## Reference: where phase deferrals live

- Phase 1 operator-gated items → `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md § Deferrals`
- Phase 3 operator-gated items → `.planning/phases/03-observability-agent-loop-hardening-lived-experience/03-HUMAN-UAT.md`
- Phase 3.1 close + carry-forward → `.planning/phases/03.1-operational-polish-minimal-ram-profile-live-auto-compaction-/03.1-CLOSEOUT.md`

`/gsd-audit-uat` surfaces all currently-open UAT items across phases.
