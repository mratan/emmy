# Postmortem — Sidecar OOM cascade during Gemma 26B MoE swap (2026-04-28)

**Date:** 2026-04-28 (UTC) / 2026-04-27 22:46 (local PDT)
**Trigger:** `/start gemma-4-26b-a4b-it@v2` issued by autonomous Claude during the V-protocol matrix completion run.
**Symptom:** During the swap, `emmy_serve.swap.controller` python process (PID 154403, listening on 127.0.0.1:8003) disappeared. vLLM came up cleanly at 127.0.0.1:8002 and the harness ran 25 sessions normally, but `curl http://127.0.0.1:8003/status` returned connection-refused for the rest of the session and `pgrep -fa emmy_serve` showed no controller running.
**Severity:** Low — vLLM was unaffected; pi-emmy bypasses the sidecar and talks directly to vLLM via `--base-url`. Slash-commands `/start`, `/stop`, `/status` (Phase 04.2 features) would be unavailable until the sidecar is manually re-armed.

## What actually happened

The kernel global OOM killer fired and victimized 8+ user-slice processes including emmy-sidecar.

Forensic chain from `/var/log/kern.log` (via `journalctl -k`):

```
22:46:23  bowtie2-align-s invoked oom-killer (constraint=CONSTRAINT_NONE, global_oom)
22:46:23  Killed process 154403 (python3, emmy-sidecar.service)         oom_score_adj=200
22:46:24  Killed process 154351 (node,   obsidian-sync.service)          oom_score_adj=200
22:46:31  Killed process 154365 (wireplumber, session.slice)             oom_score_adj=200
22:46:31  Killed process 154363 (pipewire,    session.slice)             oom_score_adj=200
22:46:31  Killed process 154366 (pipewire-pulse)                         oom_score_adj=200
22:46:31  Killed process 154362 (dbus-daemon)                            oom_score_adj=200
22:46:31  Killed process 1097726 (uv, orchestrator wrapper)              oom_score_adj=200
22:46:31  Killed process 1566419 (systemd, user@1000.service manager)    oom_score_adj=100  ← critical
22:46:42  Killed process 3458746 (python, bowtie2/samtools child)        oom_score_adj=0
22:48:54  Killed process 1104837 (python, bowtie2/samtools child)        oom_score_adj=0   anon_rss=5.0 GiB
```

**Memory pressure triggers:**
- Bio-informatics pipeline (bowtie2-align-s + samtools, separate from emmy) was actively using ~25 GiB UMA via `/data/projects/misc_analysis/2024_hugerth/pipeline/scripts/phase3_refine_subject.sh`.
- Gemma 26B MoE at `gpu_memory_utilization=0.86` was reserving ~103 GiB of the same 128 GiB UMA pool during weight-load + warmup.
- 16 GiB swap was already 100% used (`Swap: 15Gi 15Gi 530Mi` from earlier `free -h`).

128 GiB UMA + 16 GiB swap was insufficient for both workloads simultaneously. The kernel started reaping pages.

**Why emmy-sidecar got picked first** despite its tiny footprint (anon-rss only 20 MiB):

The kernel's OOM scoring is roughly `rss × (1 + oom_score_adj/1000)` clamped, but with score_adj=200 the multiplier is high enough that a 20 MiB process at score 200 outscores a 5 GiB process at score 0. The systemd default for user-slice `app.slice` services (where emmy-sidecar lives) is `oom_score_adj=200` — a "preferred to die" hint. The kernel scanned the user slice, found a cluster of small score-200 processes, and reaped them all before getting to the actual memory hogs.

**Why vLLM survived** despite using >70 GiB:

vLLM runs in a docker container (`emmy-serve`) which lives in `system.slice/docker-<id>.scope` — a separate cgroup with default `oom_score_adj=0`. Its weighted score (huge RSS × low score_adj) was actually lower than the cluster of small high-score-adj user processes the kernel killed first. By the time the kernel got to vLLM-class candidates, enough memory had been freed by the small-process massacre.

**Why systemd user-manager (PID 1566419) dying matters:**

The user-slice systemd-manager itself was killed at 22:46:31 (oom_score_adj=100). When that process dies, *no further restarts can happen in that user slice* — the manager that would execute `Restart=on-failure` no longer exists. The journal shows systemd logged `Started emmy-sidecar.service` at 22:46:31 (restart attempt #10), and then nothing — that "Started" log was systemd's last action before being killed itself. The new emmy-sidecar instance never got past Python import.

After this, the user-systemd should respawn on next session login (loginctl `Linger=yes` would auto-restart it; without linger, only on next interactive login). That's why sidecar is currently dead 4+ hours later: no one has logged into a new pts session, and linger may not be set.

## Why this looked like a "quirk"

From outside, the sidecar appeared to die mid-swap while vLLM continued cleanly. That's actually exactly what the cgroup design predicts: vLLM in `system.slice/docker.scope` is isolated from the user-slice OOM-killer rampage, so it survives a global OOM event that wipes out half of `user.slice/user@1000.service`. The "quirk" is that the SIGKILL came from outside the sidecar's normal lifecycle (not the orchestrator-completion path; not a systemd `stop` request) — the kernel just decided it was the cheapest victim.

## Mitigations

Listed by safety/reversibility, lowest-risk first.

### M1 — Add `OOMScoreAdjust=-200` to emmy-sidecar.service (recommended)

```ini
[Service]
OOMScoreAdjust=-200
```

This shifts the controller from "preferred to die" (score 200) to "preferred to survive" (score -200). Net swing of 400 points — equivalent to telling the kernel "kill almost anything else first." The controller is small (~20 MiB RSS); even at score -200 it will get killed in a true total-OOM, but only after the kernel has reaped much larger candidates.

Applies to both `/data/projects/emmy/emmy_serve/systemd/emmy-sidecar.service` (the source-of-truth template) and the installed user copy at `~/.config/systemd/user/emmy-sidecar.service` (after `bash scripts/start_emmy.sh --install-sidecar-unit`).

### M2 — Document the operator drill in `docs/runbook.md`

Add a Phase 04.2 troubleshooting section:

> **Sidecar dies mid-swap (controller process gone but vLLM running):**
> 1. Check `journalctl -k -n 50 | grep oom-kill` for evidence of a recent OOM event.
> 2. Check user-systemd is alive: `systemctl --user status` (if it errors with "Failed to connect to bus", the user-manager died too).
> 3. Re-arm the user-manager: `loginctl enable-linger $USER` (one-time) and re-login, OR `sudo systemctl restart user@$(id -u).service`.
> 4. Then `systemctl --user start emmy-sidecar` to bring the controller back.
> 5. vLLM is unaffected by sidecar death; `pi-emmy --base-url http://127.0.0.1:8002` keeps working through the outage.

### M3 — Pre-flight memory check in the swap orchestrator (deferred Phase 5)

Before issuing `docker run` for a profile that needs >80 GiB UMA, the orchestrator could:
- Read `/proc/meminfo` MemAvailable
- Read currently-running docker containers' memory limits
- Refuse the swap with exit code 6 (new) if total commitment would exceed 90% of UMA.

This is heavier-weight but prevents the kernel from being the arbiter. Defer to Phase 5 unless this recurs.

### M4 — Document that bio-pipeline coexistence is unsupported during Gemma swaps

V-RESULTS-v7 already noted bio-pipeline contention as the reason Gemma MoE was blocked. Reinforce in the runbook: when running concurrent UMA-heavy workloads, swap to Gemma is *expected* to OOM. Either pause the bio-pipeline first, or use a profile with smaller `gpu_memory_utilization` (e.g. cut a `v2.1` sibling at gmu=0.55 mirroring the dense `v1.1` precedents).

## Open questions for follow-up

1. **Should `loginctl enable-linger $USER` be a documented prerequisite?** The current `start_emmy.sh --install-sidecar-unit` warns if linger is off but doesn't enable it. Without linger, this OOM cascade leaves the box without a sidecar until the operator interactively logs in. For a "daily-driver" tool, that's fragile.

2. **Why does `app.slice` default to `oom_score_adj=200`?** This is set by systemd's `user-runtime-dir@.service` and inherited by user services via `app.slice`. The 200 default makes user services easy victims — appropriate for a multi-user time-share box, less appropriate for a single-user dev workstation where the user services *are* the workload. Possible Phase 5 polish: ship a drop-in for `app.slice.d/` setting `OOMScoreAdjust=0`.

3. **Does the orchestrator correctly survive its uv wrapper dying mid-swap?** PID 1097726 (the `uv run python -m emmy_serve.swap.orchestrator` wrapper) was OOM-killed at 22:46:31, but vLLM came up successfully. Either uv had already exec'd into the orchestrator python (no separate uv process to lose), or the orchestrator had already detached the docker run and exited before the kill. Worth verifying via process-tree replay before relying on the "sidecar can die mid-swap and engine still comes up" property.

## Recommendation

Apply M1 (one-line systemd unit edit) and M2 (runbook section) as a small Phase 04.2 follow-up commit. Defer M3/M4 to Phase 5 unless the OOM cascade recurs.

---

*Investigation by autonomous Claude after operator request to "start the investigation into the quirk." Evidence files: `/var/log/kern.log` filtered via `journalctl -k --since "2026-04-27 22:30"`; sidecar journal via `journalctl --user -u emmy-sidecar.service`; live process state via `ss -tnlp` and `pgrep -fa`.*
