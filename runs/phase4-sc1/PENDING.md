# PENDING — SC-1 `/profile` swap walkthrough (operator-gated)

**Status:** OPERATOR-DEFERRED
**Resume signal:** `"sc1 phase4 green"`
**Phase 1/2/3 precedent:** same shape as `sc1 green` (Phase 2) / `sc1 phase3 green` (Phase 3) — a live-rig author walkthrough cannot be automated.

## What blocks this from being automation-green

SC-1 is the verbatim 4-phase `/profile` swap observation: operator launches `pi-emmy`, runs a turn against Qwen3.6, types `/profile gemma-4-26b-a4b-it`, observes the D-02 LOCKED phases fire **in real time on their TUI status row**, runs a turn against Gemma 4, swaps back, runs a third turn. This requires:

- A real DGX Spark with both profile weights cached (~50 GB Qwen + ~50 GB Gemma)
- The operator's eyes on the TUI to confirm the 4 verbatim phase labels appear in order
- A human judging "turn N lands as expected" on each side of each swap

The plan 04-02 / 04-03 unit + integration tests already cover every code path (swap primitive exit codes 0/5/6, D-02 JSON stream, D-23 harness hot-swap, D-06 in-flight guard). What SC-1 adds is **live end-to-end evidence that all the wired-up pieces behave in concert under a real swap**.

## Prerequisites before running SC-1

- Task 1 (`p4 kv green`) complete — Gemma 4 KV budget measured
- Task 2 (`p4 thermal green`) complete — Gemma 4 thermal floors asserted
- Both profiles validate exit 0 (already green at Phase 4-06 close; operator re-verifies after Task 1+2 hash-write)

## Exact shell commands operator runs

```bash
# Terminal A — cold-boot Qwen v3.1
bash scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1/

# Terminal B — launch pi-emmy in a clean scratch dir
mkdir -p /tmp/phase4-sc1-walkthrough && cd /tmp/phase4-sc1-walkthrough
pi-emmy

# Inside pi-emmy:
# 1. Verify footer shows: profile qwen3.6-35b-a3b@v3.1
# 2. Turn A: "read README.md and report what emmy is"
#    → tool call fires, response returns, latency under 10 s
# 3. Type: /profile gemma-4-26b-a4b-it
#    → Confirm the prompt
#    → OBSERVE the status row cycles VERBATIM:
#      "stopping vLLM"             (~5 s)
#      "loading weights 0%"        ...
#      "loading weights 50%"       ...
#      "loading weights 90%"       (total ~90–160 s per 04-RESEARCH §3.4)
#      "warmup"                    (~10 s)
#      "ready"
#    → Notify: "swapped to gemma-4-26b-a4b-it"
# 4. Turn B: "list files in packages/"
#    → Tool call fires on Gemma 4. Parses via gemma4 parser (or reactive grammar
#      retry if vLLM bug #39392 triggers — document in walkthrough.md if so).
# 5. Type: /profile qwen3.6-35b-a3b
#    → Same 4 phases again; swap back to Qwen.
# 6. Turn C: "what's in package.json root"
#    → Lands on Qwen.
# 7. /quit

# Evidence capture:
# transcript.json comes from pi-emmy session log (~/.emmy/sessions/*.jsonl or
# <cwd>/runs/phase2-sc3-capture/session-<iso>.jsonl per Plan 02-04 B2 always-on)
cp ~/.emmy/sessions/<latest>.jsonl  /data/projects/emmy/runs/phase4-sc1/transcript.json
#  — OR —
cp /tmp/phase4-sc1-walkthrough/runs/phase2-sc3-capture/session-<iso>.jsonl \
   /data/projects/emmy/runs/phase4-sc1/transcript.json

# docker-logs: capture both boots
docker logs emmy-serve > /data/projects/emmy/runs/phase4-sc1/docker-logs.txt 2>&1

# Optional: Langfuse screenshot showing 3 turns with correct emmy.profile.id per turn
# (Plan 03-02 already stamps emmy.profile.id on every span)

# Author walkthrough.md with 4-phase observation log + 3 turn outcomes.
# Verdict at top: "sc1 phase4 green"

git add runs/phase4-sc1/walkthrough.md runs/phase4-sc1/transcript.json runs/phase4-sc1/docker-logs.txt
git commit -m "evidence(04-06): SC-1 phase4 swap walkthrough — sc1 phase4 green"

# Signal Claude: "sc1 phase4 green"
```

## Expected evidence files (once signal fires)

| File | Contents |
|---|---|
| `walkthrough.md` | Operator narrative; timestamps per phase; 4-phase observation log with verbatim labels ticked off; 3 turn outcomes summarized; verdict `sc1 phase4 green` at top. Mirrors `runs/phase2-sc1/walkthrough.md` shape. |
| `transcript.json` | Full pi-emmy session transcript covering all 3 turns across both profiles; from `~/.emmy/sessions/*.jsonl` or the Plan-02-04-B2 always-on capture at `<cwd>/runs/phase2-sc3-capture/session-<iso>.jsonl` |
| `docker-logs.txt` | `docker logs emmy-serve` output spanning BOTH boots — Qwen cold-start + Gemma swap-in + Qwen swap-back-in |
| `langfuse-traces.png` (optional) | Screenshot of Langfuse UI showing 3 turns with `emmy.profile.id` attr per turn |

## Failure modes + escalation

| Observation | Disposition |
|---|---|
| Progress phase labels don't match D-02 verbatim (e.g. "loading model 50%" instead of "loading weights 50%") | BUG in Plan 04-02 or 04-03 code. Fix before continuing — do NOT close SC-1. |
| Swap wall-clock > 5 min | Document as deferral in CLOSEOUT — likely HF cache miss or Spark thermal state. Not a blocker if the 4 phases still fire correctly. |
| Gemma 4 tool call fails with vLLM parser bug #39392 / #39468 | **Acceptable.** Reactive XGrammar retry (Phase 2 D-11) is the designed backstop. Document the parse-failure rate in walkthrough.md + flag as Phase-5-eval-scope item. |
| `/profile <other>` mid-turn rejected with "swap deferred — request in flight, finish or Ctrl+C first" | GOOD — D-06 guard firing. Mention in walkthrough.md as positive signal. |
| Exit 5 (pre-flight fail) or Exit 6 (rollback) on a HAPPY-path attempt | BUG. Both should only fire in SC-4's deliberate-break scenarios. Investigate before closing SC-1. |

## Verdict template

Once the walkthrough lands, replace this PENDING.md with `walkthrough.md`:

```
# SC-1 phase4 — verdict sc1 phase4 green

## Environment
- Host: <hostname>, <iso-date>
- Qwen bundle: profiles/qwen3.6-35b-a3b/v3.1 (sha256:f9dcabd1...)
- Gemma 4 bundle: profiles/gemma-4-26b-a4b-it/v1 (sha256:<current>)

## Turn A — Qwen v3.1
- Prompt: "read README.md and report what emmy is"
- Outcome: <summary>; latency <sec>s
- Footer: profile qwen3.6-35b-a3b@v3.1

## Swap 1 — Qwen → Gemma 4
- Command: /profile gemma-4-26b-a4b-it
- Phase 1 "stopping vLLM":          T+0s  → T+<dur>s
- Phase 2 "loading weights 0/50/90%": T+<s> → T+<s>   (wall-clock: <dur>s)
- Phase 3 "warmup":                  T+<s> → T+<s>
- Phase 4 "ready":                   T+<s>
- Notify: "swapped to gemma-4-26b-a4b-it"

## Turn B — Gemma 4 v1
- Prompt: "list files in packages/"
- Outcome: <summary>
- Parser: gemma4 (did bug #39392 fire? <yes/no>, reactive retry fired? <count>)

## Swap 2 — Gemma 4 → Qwen v3.1
- Command: /profile qwen3.6-35b-a3b
- (same 4-phase log)

## Turn C — Qwen v3.1
- Prompt: "what's in package.json root"
- Outcome: <summary>

## Verdict
sc1 phase4 green.
```
