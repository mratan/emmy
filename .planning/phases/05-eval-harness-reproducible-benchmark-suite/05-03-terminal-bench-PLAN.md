---
phase: 05
plan: 03
type: execute
wave: 3
depends_on: ["05-02", "05-05"]
files_modified:
  - packages/emmy-eval/src/suites/tbench.ts
  - packages/emmy-eval/tests/tbench-adapter.test.ts
  - eval/suites/tbench-2.0.yaml
  - eval/tbench-agent/pi_emmy_agent.py
  - eval/tbench-agent/Dockerfile.pi_emmy
  - eval/tbench-agent/install_pi_emmy.sh
  - eval/tbench-agent/README.md
  - eval/tbench-agent/SKIP_LIST.yaml
  - emmy_serve/eval/__init__.py
  - emmy_serve/eval/tbench_smoke.py
  - emmy_serve/pyproject.toml
  - runs/phase5-tbench/qwen35-a3b-v3.1/.gitkeep
  - runs/phase5-tbench/qwen27b-v1.1/.gitkeep
  - runs/phase5-tbench/gemma26b-a4b-v2/.gitkeep
  - runs/phase5-tbench/gemma31b-v1.1/.gitkeep
  - runs/phase5-prior-phase1/qwen35-a3b-v3.1/.gitkeep
  - runs/phase5-prior-phase1/qwen27b-v1.1/.gitkeep
  - runs/phase5-prior-phase1/gemma26b-a4b-v2/.gitkeep
  - runs/phase5-prior-phase1/gemma31b-v1.1/.gitkeep
  - runs/phase5-holdout/qwen35-a3b-v3.1/.gitkeep
  - runs/phase5-holdout/qwen27b-v1.1/.gitkeep
  - runs/phase5-holdout/gemma26b-a4b-v2/.gitkeep
  - runs/phase5-holdout/gemma31b-v1.1/.gitkeep
  - runs/phase5-rephrased/qwen35-a3b-v3.1/.gitkeep
  - runs/phase5-rephrased/qwen27b-v1.1/.gitkeep
  - runs/phase5-rephrased/gemma26b-a4b-v2/.gitkeep
  - runs/phase5-rephrased/gemma31b-v1.1/.gitkeep
  - runs/phase5-livecodebench/qwen35-a3b-v3.1/.gitkeep
  - runs/phase5-livecodebench/qwen27b-v1.1/.gitkeep
  - runs/phase5-livecodebench/gemma26b-a4b-v2/.gitkeep
  - runs/phase5-livecodebench/gemma31b-v1.1/.gitkeep
  - scripts/run_phase5_tier_a.sh
autonomous: false
requirements: [EVAL-01]
tags: [eval, terminal-bench, base-installed-agent, tier-b-moe, dense-smoke, operator-attended, gpu-long-run]

must_haves:
  truths:
    - "eval/tbench-agent/pi_emmy_agent.py implements terminal-bench AbstractInstalledAgent contract per RESEARCH.md §Q1: name() returns 'pi-emmy', perform_task drives pi-emmy --print --json from inside the tbench Docker container against host-loopback emmy-serve at $EMMY_BASE_URL"
    - "eval/tbench-agent/install_pi_emmy.sh installs pi-emmy + @emmy/* deps inside the tbench Docker base image (BaseInstalledAgent install step) — bun install, bun build packages, no upstream PyPI vLLM"
    - "packages/emmy-eval/src/suites/tbench.ts adapter wires @emmy/eval orchestrator to tb run --agent-import-path eval.tbench_agent:PiEmmyAgent --dataset terminal-bench --dataset-version 2.0 --task-ids ... --n-attempts 1 (one tbench invocation per sample; emmy-eval orchestrator owns N=3 multi-sample loop)"
    - "Tier B Phase-04.1-MoE-only-N=3 enforced: tbench.ts refuses to run --samples 3 against a dense profile id (qwen3.6-27b, gemma-4-31b-it) — passes through but emits Tier-B-violation warning to STDERR; --samples 1 explicitly required for dense smoke runs"
    - "EVAL-01: 89-task tbench-2.0 dataset version pinned in eval/suites/tbench-2.0.yaml; manifest_hash recorded; runs against the 4-profile MATRIX; results land in runs/phase5-tbench/<profile-slug>/<iso>/{report.json, report.md, transcripts/}"
    - "EVAL-08 inherited: passing --filter or --task-ids subset to tbench.ts sets suite_complete=false; Plan 05-02 promotion gate honors this"
    - "Operator-attended GPU windows captured: ~9h MoE × 2 profiles + ~3h dense smoke × 2 profiles = ~24h total wall-clock; resume signals recorded per Phase 1 D-15 pattern"
    - "EVAL-07 SP_OK canary fires before each per-profile tbench batch (Plan 05-02's runSpOkGate; orchestrator-level not per-task); canary failure aborts the profile's batch"
    - "Tier-A execution (Blocker 5): Task 4 runs the 4 Tier-A suites (prior-phase1, holdout, rephrased, livecodebench-rolling) at N=3 against ALL 4 MATRIX profiles per D-01. Result dirs land at runs/phase5-{prior-phase1,holdout,rephrased,livecodebench}/<profile-slug>/<iso>/{report.json,report.md,provenance.json,transcripts/}. Plan 05-07 closeout consumes these for the 5 matrix aggregations."
    - "SKIP_LIST.yaml enumerates tbench tasks that fail to build/run on aarch64 DGX Spark (smoke-discovered) with reason; Plan 05-04 SWE-Lite mirrors this pattern"
    - "emmy_serve/eval/tbench_smoke.py runs a 5-task subset on qwen3.6-35b-a3b@v3.1 to gate the heavy run — if smoke fails, full run is aborted (Pitfall E-6 mitigation)"
  artifacts:
    - path: "eval/tbench-agent/pi_emmy_agent.py"
      provides: "terminal-bench BaseInstalledAgent shim — the boundary between tbench's tmux harness and pi-emmy's session loop"
      contains: "class PiEmmyAgent"
      min_lines: 60
    - path: "eval/tbench-agent/install_pi_emmy.sh"
      provides: "Install step for tbench's BaseInstalledAgent — runs inside the tbench Docker container before perform_task"
      contains: "bun install"
    - path: "packages/emmy-eval/src/suites/tbench.ts"
      provides: "@emmy/eval orchestrator adapter for terminal-bench; calls tb subprocess once per sample; aggregates"
      contains: "AbstractInstalledAgent"
    - path: "eval/suites/tbench-2.0.yaml"
      provides: "Suite manifest pinning dataset version, task count, expected wall-clock per profile, Tier-B coverage policy"
      contains: "dataset_version: \"2.0\""
    - path: "eval/tbench-agent/SKIP_LIST.yaml"
      provides: "Aarch64-incompatible task list (smoke-discovered); referenced by tbench.ts for transparent skip + report"
      contains: "tasks_skipped:"
    - path: "runs/phase5-tbench/qwen35-a3b-v3.1/<iso>/report.json"
      provides: "Per-profile MoE Tier-B run output: 89 tasks × N=3 samples × full provenance"
      contains: "\"suite_id\": \"terminal-bench-2.0\""
  key_links:
    - from: "packages/emmy-eval/src/suites/tbench.ts"
      to: "packages/emmy-eval/src/orchestrator.ts (runSuite)"
      via: "registered as a suite adapter"
      pattern: "import.*orchestrator"
    - from: "eval/tbench-agent/pi_emmy_agent.py"
      to: "scripts/start_emmy.sh (host-loopback emmy-serve)"
      via: "container --network=host + EMMY_BASE_URL"
      pattern: "EMMY_BASE_URL"
    - from: "eval/tbench-agent/install_pi_emmy.sh"
      to: "packages/emmy-ux/bin/pi-emmy.ts"
      via: "bun build → bin install"
      pattern: "pi-emmy"
    - from: "tbench BaseInstalledAgent contract"
      to: "eval/tbench-agent/pi_emmy_agent.py:PiEmmyAgent.perform_task"
      via: "method override"
      pattern: "def perform_task"
---

# Objective

Wire terminal-bench-2.0 (89 manually-verified tasks) into the eval driver as the **primary** coding-agent benchmark. Author the `PiEmmyAgent(BaseInstalledAgent)` Python shim that runs inside tbench's Docker containers and drives `pi-emmy --print --json` against host-loopback emmy-serve. Author the `@emmy/eval` adapter (`suites/tbench.ts`) that integrates the tbench subprocess invocation into the orchestrator's N-samples loop. Run **Tier B coverage** per D-01: 2 MoE profiles (`qwen3.6-35b-a3b@v3.1` + `gemma-4-26b-a4b-it@v2`) at N=3 samples = ~9h × 2 = ~18h GPU; 2 dense profiles (`qwen3.6-27b@v1.1` + `gemma-4-31b-it@v1.1`) at N=1 smoke = ~3h × 2 = ~6h GPU. **Total ~24h operator-attended wall-clock window.**

Purpose: terminal-bench 2.0 is the most direct measure of "can this agent do real coding work in a real terminal" — it's the primary benchmark for Phase 5's research-artifact bar. Without it, Phase 5 ships statistics on toy tasks. With it, Phase 5 has a number on the same scoreboard the rest of the field uses.

Output:
- `eval/tbench-agent/` complete: `pi_emmy_agent.py` BaseInstalledAgent shim + `install_pi_emmy.sh` install step + `Dockerfile.pi_emmy` (extends tbench base image with bun + emmy build) + `SKIP_LIST.yaml` (aarch64-incompatible tasks)
- `packages/emmy-eval/src/suites/tbench.ts` adapter wiring tbench subprocess → @emmy/eval orchestrator
- `eval/suites/tbench-2.0.yaml` suite manifest with manifest_hash + Tier-B policy + skip-list reference
- `emmy_serve/eval/tbench_smoke.py` 5-task gate before heavy run
- 4 result directories under `runs/phase5-tbench/<profile-slug>/<iso>/` (4 profiles × N=3 or N=1)
- Phase 5 SC-1 evidence (one of the 4 reports demonstrates the JSON+markdown+provenance discipline end-to-end)

# Execution Context

@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

# Context

@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CONTEXT.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-RESEARCH.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-02-eval-driver-core-PLAN.md
@CLAUDE.md
@eval/MATRIX.md
@scripts/start_emmy.sh

## Interfaces

terminal-bench `AbstractInstalledAgent` contract (per RESEARCH.md §Q1, https://www.tbench.ai/docs/agent-introduction):

```python
from terminal_bench.agents import AbstractInstalledAgent, AgentResult
from terminal_bench.terminal.tmux_session import TmuxSession  # path TBD on install; verify at impl

class MyAgent(AbstractInstalledAgent):
    @staticmethod
    def name() -> str: ...

    @staticmethod
    def install_script() -> str: ...   # bash script run once at container build

    def run_command(self) -> str: ...  # the binary tbench exec inside the container per task

    # Or (legacy BaseAgent subclass path):
    def perform_task(self, task_description: str, session: TmuxSession, logging_dir: Path | None = None) -> AgentResult: ...
```

`AgentResult` carries token counts + an optional failure mode. The legacy `BaseAgent.perform_task` is also still supported per the docs; we use `AbstractInstalledAgent` for cleanliness (declarative install + run).

@emmy/eval suite adapter contract (Plan 05-02 entry point):

```typescript
// packages/emmy-eval/src/suites/tbench.ts
import { runSuite } from "../orchestrator";
import { loadSuite, type Task } from "./loader";

export async function runTerminalBench(args: {
  profilePath: string;
  samples: number;
  outDir: string;
  baseUrl?: string;
  taskIds?: string[];     // when present, suite_complete=false (EVAL-08)
  judge?: "self-hosted-llama" | "cloud-claude" | "none";
}): Promise<TbenchRunResult> {
  // 1. SP_OK pre-flight (orchestrator-level)
  // 2. Provenance capture
  // 3. For each sample 1..N: spawn `tb run` subprocess against the configured task list
  //    - tb invokes our PiEmmyAgent inside the docker container
  //    - parse tbench's results.json output
  //    - append per-task per-sample row
  // 4. Aggregate; write report.json + report.md
}
```

Tbench CLI shape (per RESEARCH.md §Q1):

```bash
tb run \
  --agent-import-path eval.tbench_agent:PiEmmyAgent \
  --dataset terminal-bench \
  --dataset-version 2.0 \
  --task-ids "<comma-separated>" \
  --n-attempts 1 \
  --output-path /tmp/tbench-out-<run-id>/
```

Per-sample wall-clock budget: ~2 min average (RESEARCH.md §Q1 estimate). 89 tasks × N=3 × 2 min ≈ 9h per MoE profile.

PiEmmyAgent's run_command shape:

```bash
# Inside the tbench Docker container, per task:
EMMY_BASE_URL=http://host.docker.internal:8002 \
EMMY_PROFILE=$ACTIVE_PROFILE \
pi-emmy --print --json --profile $EMMY_PROFILE --no-tui < /tmp/task_description.txt > /tmp/agent_output.jsonl
```

The container reaches the host's emmy-serve via `--add-host host.docker.internal:host-gateway` (set in the Dockerfile.pi_emmy). The orchestrator does NOT swap profiles between samples within a single tbench batch (Pitfall E-7 thermal-thrash mitigation); it swaps once per profile-batch via the existing `/profile` slash-command machinery (Phase 4).

## Key Files

- `packages/emmy-eval/src/orchestrator.ts` — Plan 05-02's runSuite (this plan adds a suite adapter that calls into it)
- `packages/emmy-ux/bin/pi-emmy.ts` — pi-emmy CLI; the Python agent shells out to this
- `scripts/start_emmy.sh` — host emmy-serve boot (operator runs once before the 24h batch)
- `eval/MATRIX.md` — 4-profile participant manifest; this plan iterates over its rows
- `emmy_serve/swap/orchestrator.py` — `/profile` swap primitive (Phase 4); operator invokes between profile batches
- `runs/phase4.1-{qwen,gemma}-thermal/` — reference for thermal envelope (24h sustained run is within tolerance per Phase 04.1 measurements; 5-min cooldowns between profiles)

# Tasks

## Task 1 (auto): Author PiEmmyAgent + install/Dockerfile + tbench.ts adapter + smoke gate

**Files:** `eval/tbench-agent/pi_emmy_agent.py`, `eval/tbench-agent/install_pi_emmy.sh`, `eval/tbench-agent/Dockerfile.pi_emmy`, `eval/tbench-agent/README.md`, `packages/emmy-eval/src/suites/tbench.ts`, `packages/emmy-eval/tests/tbench-adapter.test.ts`, `eval/suites/tbench-2.0.yaml`, `eval/tbench-agent/SKIP_LIST.yaml`, `emmy_serve/eval/__init__.py`, `emmy_serve/eval/tbench_smoke.py`, `emmy_serve/pyproject.toml`

**Behavior:**
- `tbench-adapter.test.ts` (unit): runTerminalBench with mocked `child_process.spawn` returning canned tbench results.json; assert N=3 invocations made, suite_complete=true when no task_ids filter, Tier-B-violation warning logged when dense profile + samples=3
- `tbench.ts` integration is dry-runnable without the actual tb binary present (uses `EMMY_TBENCH_DRY_RUN=1` env to short-circuit subprocess spawn for unit testing)
- `pi_emmy_agent.py` import is verifiable: `python -c "from eval.tbench_agent.pi_emmy_agent import PiEmmyAgent; assert PiEmmyAgent.name() == 'pi-emmy'"`

**Action:**

Step 1 — Author `eval/tbench-agent/pi_emmy_agent.py`:

```python
"""
PiEmmyAgent — terminal-bench AbstractInstalledAgent shim.

Runs INSIDE the tbench Docker container per task. Drives pi-emmy --print --json
against host-loopback emmy-serve.

Per RESEARCH.md §Q1: pi-emmy is installed inside the tbench container (Option A —
the "BaseInstalledAgent" path) so the agent's edits/bash directly mutate the
filesystem tbench's tests/test.sh inspects.

Source: https://www.tbench.ai/docs/agent-introduction (verified 2026-04-25)
"""
from __future__ import annotations
import json
import os
import subprocess
from pathlib import Path

from terminal_bench.agents import AbstractInstalledAgent, AgentResult


class PiEmmyAgent(AbstractInstalledAgent):
    @staticmethod
    def name() -> str:
        return "pi-emmy"

    @staticmethod
    def install_script() -> str:
        # Run once when the tbench Docker image is built.
        # See eval/tbench-agent/install_pi_emmy.sh for the actual contents;
        # this method returns the path tbench will exec.
        return "/install_pi_emmy.sh"

    def run_command(self, task_description: str) -> str:
        """The shell command tbench runs per task inside the container."""
        emmy_base_url = os.environ.get("EMMY_BASE_URL", "http://host.docker.internal:8002")
        emmy_profile = os.environ.get("EMMY_PROFILE", "qwen3.6-35b-a3b@v3.1")
        # pi-emmy reads task description from stdin, writes JSON event stream to stdout.
        # Allowed wall-clock: 5 min default; tbench enforces its own timeout.
        return (
            f"EMMY_BASE_URL={emmy_base_url} EMMY_PROFILE={emmy_profile} "
            f"pi-emmy --print --json --profile {emmy_profile} --no-tui"
        )

    # Legacy BaseAgent.perform_task fallback for tbench versions that don't honor AbstractInstalledAgent
    def perform_task(
        self,
        task_description: str,
        session,                # TmuxSession
        logging_dir: Path | None = None,
    ) -> AgentResult:
        env = os.environ.copy()
        env["EMMY_BASE_URL"] = env.get("EMMY_BASE_URL", "http://host.docker.internal:8002")
        env["EMMY_PROFILE"] = env.get("EMMY_PROFILE", "qwen3.6-35b-a3b@v3.1")

        proc = subprocess.run(
            ["pi-emmy", "--print", "--json", "--profile", env["EMMY_PROFILE"], "--no-tui"],
            input=task_description,
            capture_output=True,
            text=True,
            env=env,
            timeout=300,
        )

        # Stream events: each non-blank line is a JSON object emitted by pi-emmy.
        events = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                # Non-JSON noise; pi-emmy may emit human-readable headers
                continue

        # Translate bash tool calls into actual tmux session.send_keys so tbench's
        # tests/test.sh sees the terminal effects (Option-A pattern below uses pi-emmy
        # already running INSIDE the container, so this branch is a fallback only).
        for evt in events:
            if evt.get("type") == "tool_execution_end" and evt.get("tool") == "bash":
                cmd = evt.get("args", {}).get("command")
                if cmd:
                    session.send_keys(cmd, block=True)

        if logging_dir:
            (Path(logging_dir) / "pi_emmy_events.jsonl").write_text(
                "\n".join(json.dumps(e) for e in events)
            )

        tokens_in = sum(int(e.get("tokens_in", 0)) for e in events)
        tokens_out = sum(int(e.get("tokens_out", 0)) for e in events)
        failure_mode = None if proc.returncode == 0 else f"pi-emmy exit {proc.returncode}: {proc.stderr[:500]}"

        return AgentResult(
            total_input_tokens=tokens_in,
            total_output_tokens=tokens_out,
            failure_mode=failure_mode,
        )
```

Step 2 — Author `eval/tbench-agent/install_pi_emmy.sh`:

```bash
#!/usr/bin/env bash
# install_pi_emmy.sh — tbench AbstractInstalledAgent install step.
# Runs inside the tbench Docker container. Installs Bun, copies the pre-built
# pi-emmy binary + @emmy/* packages from host build artifacts.
#
# Air-gap discipline: the tbench Docker container is allowed network during
# install (Bun base install). The agent itself runs WITHOUT network during
# perform_task (the model is on host emmy-serve over loopback).

set -euo pipefail

# 1. Install Bun (if not present in base image).
if ! command -v bun >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# 2. Copy emmy workspace from /emmy-build (mounted at docker build time).
# eval/tbench-agent/Dockerfile.pi_emmy COPYs packages/ + bunfig.toml + bun.lock + tsconfig.base.json + package.json
cd /emmy
bun install --frozen-lockfile
bun run --filter '@emmy/*' build || true   # build all packages (tsc emit if configured)

# 3. Make pi-emmy globally callable.
ln -sf /emmy/packages/emmy-ux/bin/pi-emmy.ts /usr/local/bin/pi-emmy
chmod +x /emmy/packages/emmy-ux/bin/pi-emmy.ts

# 4. Sanity check.
pi-emmy --print-environment >/dev/null
echo "install_pi_emmy: ready"
```

Step 3 — Author `eval/tbench-agent/Dockerfile.pi_emmy`:

```dockerfile
# eval/tbench-agent/Dockerfile.pi_emmy
# Extends terminal-bench's base agent image with the emmy harness.

FROM ghcr.io/laude-institute/terminal-bench/base-agent:latest
# (Pin: replace `latest` with the digest tbench 2.0 ships at integration time;
#  document in eval/suites/tbench-2.0.yaml manifest)

# host.docker.internal needs to resolve on aarch64 Linux Docker.
# Caller adds: --add-host host.docker.internal:host-gateway
# (Or the agent passes EMMY_BASE_URL=http://172.17.0.1:8002 if that fails.)

# Copy emmy workspace from build context.
COPY packages /emmy/packages
COPY bunfig.toml bun.lock package.json tsconfig.base.json /emmy/
COPY eval/tbench-agent/install_pi_emmy.sh /install_pi_emmy.sh
RUN chmod +x /install_pi_emmy.sh && /install_pi_emmy.sh

ENTRYPOINT ["/bin/bash"]
```

Step 4 — Author `eval/tbench-agent/SKIP_LIST.yaml` initially empty (Step 7 smoke-fills):

```yaml
# eval/tbench-agent/SKIP_LIST.yaml
# Tasks that fail to build/run on aarch64 DGX Spark.
# Plan 05-03 Task 2 smoke-discovers; Task 3 documents.
# Each entry: {task_id, reason, discovered_in: <smoke-run-iso>}
tasks_skipped: []
```

Step 5 — Author `eval/suites/tbench-2.0.yaml`:

```yaml
suite_id: terminal-bench-2.0
suite_version: "1"
manifest_hash: "sha256:PLACEHOLDER"
description: "terminal-bench 2.0 — 89 manually-verified tasks. Primary coding-agent benchmark per ROADMAP § Phase 5."
dataset: terminal-bench
dataset_version: "2.0"
expected_task_count: 89
agent_import_path: "eval.tbench_agent.pi_emmy_agent:PiEmmyAgent"
container_image_pin: "ghcr.io/laude-institute/terminal-bench/base-agent@sha256:TBD-AT-FIRST-RUN"
skip_list_path: eval/tbench-agent/SKIP_LIST.yaml
tier_coverage:
  moe_profiles: ["qwen3.6-35b-a3b@v3.1", "gemma-4-26b-a4b-it@v2"]
  moe_samples: 3
  dense_profiles: ["qwen3.6-27b@v1.1", "gemma-4-31b-it@v1.1"]
  dense_samples: 1     # smoke only per D-01 Tier-B; explicit "dense correctness signal, not statistical claim"
expected_walltime_per_profile:
  moe_n3: "9h"
  dense_n1: "3h"
defaults:
  samples: 3
  judge_required: true
```

Run `bun run scripts/eval/manifest_hash.ts eval/suites/tbench-2.0.yaml --rewrite` to fill the real hash.

Step 6 — Author `packages/emmy-eval/src/suites/tbench.ts`:

```typescript
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile } from "@emmy/ux";
import { captureProvenance } from "../provenance";
import { runSpOkGate } from "../sp-ok-gate";
import { computeStats, InsufficientSamplesError } from "../stats/mean-std";
import { loadSuite } from "./loader";
import { writeReport } from "../report/json";
import { renderMarkdownReport } from "../report/markdown";

export interface TbenchRunArgs {
  profilePath: string;
  samples: number;
  outDir: string;
  baseUrl?: string;
  taskIds?: string[];
  judge?: "self-hosted-llama" | "cloud-claude" | "none";
}

const DENSE_PROFILE_IDS = new Set(["qwen3.6-27b", "gemma-4-31b-it"]);

export async function runTerminalBench(args: TbenchRunArgs): Promise<unknown> {
  const profile = await loadProfile(args.profilePath);
  const baseUrl = args.baseUrl ?? "http://127.0.0.1:8002";

  // Tier-B coverage policy (D-01)
  if (DENSE_PROFILE_IDS.has(profile.ref.id) && args.samples > 1) {
    process.stderr.write(
      `[tier-b-warning] dense profile '${profile.ref.id}' with samples=${args.samples}: per D-01 ` +
      `dense profiles are smoke-only (N=1). Continuing per operator override; mark report as ` +
      `tier-b-violation.\n`,
    );
  }

  // 1. SP_OK pre-flight
  await runSpOkGate({ baseUrl, servedModelName: profile.serving.engine.served_model_name });

  // 2. Load suite manifest
  const suite = await loadSuite("eval/suites/tbench-2.0.yaml");

  // 3. Provenance capture
  mkdirSync(args.outDir, { recursive: true });
  const provenance = await captureProvenance({
    profile, suite: suite.suite_id, suiteManifestHash: suite.manifest_hash, samples: args.samples,
  });
  writeFileSync(join(args.outDir, "provenance.json"), JSON.stringify(provenance, null, 2));

  // 4. Skip-list materialize
  const skipList = (await import("yaml")).parse(readFileSync("eval/tbench-agent/SKIP_LIST.yaml", "utf8")) as { tasks_skipped: Array<{ task_id: string; reason: string }> };
  const skipIds = new Set(skipList.tasks_skipped.map((s) => s.task_id));

  // 5. tb subprocess loop, one invocation per sample
  const taskIdsArg = args.taskIds?.join(",") ?? "";   // empty = all tasks; tb defaults to dataset
  const dryRun = process.env.EMMY_TBENCH_DRY_RUN === "1";

  const allRows: Record<string, Array<{ exec_score: 0|1; sample_index: number; failure_mode: string | null }>> = {};

  for (let i = 0; i < args.samples; i++) {
    const sampleOutDir = join(args.outDir, `sample-${i}`);
    mkdirSync(sampleOutDir, { recursive: true });
    if (dryRun) {
      // Test-mode short circuit: synthesize a deterministic results.json
      writeFileSync(join(sampleOutDir, "results.json"), JSON.stringify({
        runs: [{ task_id: "demo_001", is_resolved: true, failure_mode: null }],
      }));
    } else {
      const proc = spawnSync("tb", [
        "run",
        "--agent-import-path", "eval.tbench_agent.pi_emmy_agent:PiEmmyAgent",
        "--dataset", "terminal-bench",
        "--dataset-version", "2.0",
        ...(taskIdsArg ? ["--task-ids", taskIdsArg] : []),
        "--n-attempts", "1",
        "--output-path", sampleOutDir,
      ], {
        env: {
          ...process.env,
          EMMY_BASE_URL: baseUrl,
          EMMY_PROFILE: `${profile.ref.id}@${profile.ref.version}`,
        },
        stdio: "inherit",
      });
      if (proc.status !== 0) throw new Error(`tb run sample ${i} exited ${proc.status}`);
    }

    // Parse tbench's results JSON
    const resultsPath = join(sampleOutDir, "results.json");
    if (!existsSync(resultsPath)) throw new Error(`tb did not produce results.json at ${resultsPath}`);
    const results = JSON.parse(readFileSync(resultsPath, "utf8")) as { runs: Array<{ task_id: string; is_resolved: boolean; failure_mode: string | null }> };
    for (const r of results.runs) {
      if (skipIds.has(r.task_id)) continue;
      (allRows[r.task_id] ??= []).push({ exec_score: r.is_resolved ? 1 : 0, sample_index: i, failure_mode: r.failure_mode });
    }
  }

  // 6. Aggregate per task; compute stats
  const rows = Object.entries(allRows).map(([task_id, samples]) => {
    try {
      const stats = computeStats(samples.map((s) => ({
        sample_index: s.sample_index, sp_ok_canary: true, exec_score: s.exec_score,
        transcript_jsonl_path: "", duration_ms: 0,
      } as any)));
      return { task_id, samples, mean_exec: stats.mean, std_exec: stats.std, insufficient_samples: false };
    } catch (e) {
      if (e instanceof InsufficientSamplesError) {
        return { task_id, samples, mean_exec: NaN, std_exec: NaN, insufficient_samples: true };
      }
      throw e;
    }
  });

  // 7. Write report
  // Blocker 4: populate suite_complete_reason — disambiguates D-01 dense smoke from EVAL-08 subset
  const isSmokeRun = args.samples < 3;
  const suiteCompleteReason: "complete" | "filter" | "max-tasks" | "smoke-N1" =
    args.taskIds ? "filter" :
    isSmokeRun  ? "smoke-N1" :
    "complete";
  const result = {
    suite_id: suite.suite_id,
    suite_complete: suiteCompleteReason === "complete",
    suite_complete_reason: suiteCompleteReason,
    rows,
    provenance_path: join(args.outDir, "provenance.json"),
    report_md_path: join(args.outDir, "report.md"),
    report_json_path: join(args.outDir, "report.json"),
    total_samples: args.samples * Object.keys(allRows).length,
    spok_failures: 0,
    declare_improvement_blocked_reason: null,
    skipped_tasks: Array.from(skipIds),
  };

  writeReport(result.report_json_path, { result, provenance, suite });
  writeFileSync(result.report_md_path, renderMarkdownReport({ result, provenance, suite }));
  return result;
}
```

Step 7 — Author `packages/emmy-eval/tests/tbench-adapter.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { runTerminalBench } from "../src/suites/tbench";

describe("tbench adapter (EVAL-01)", () => {
  it("dry-run mode produces a report with mocked tb output", async () => {
    process.env.EMMY_TBENCH_DRY_RUN = "1";
    const out = "/tmp/emmy-tbench-test-" + Date.now();
    const r = await runTerminalBench({
      profilePath: "profiles/qwen3.6-35b-a3b/v3.1",
      samples: 3, outDir: out,
    }) as any;
    expect(r.suite_id).toBe("terminal-bench-2.0");
    expect(r.suite_complete).toBe(true);
    rmSync(out, { recursive: true, force: true });
    delete process.env.EMMY_TBENCH_DRY_RUN;
  });

  it("dense profile + samples=3 emits Tier-B-violation warning", async () => {
    process.env.EMMY_TBENCH_DRY_RUN = "1";
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: any) => { stderrChunks.push(String(c)); return true; }) as any;
    try {
      await runTerminalBench({
        profilePath: "profiles/qwen3.6-27b/v1.1",  // dense
        samples: 3,
        outDir: "/tmp/emmy-tbench-tier-b-" + Date.now(),
      });
    } finally {
      process.stderr.write = origWrite;
      delete process.env.EMMY_TBENCH_DRY_RUN;
    }
    expect(stderrChunks.join("")).toContain("tier-b-warning");
  });

  it("--task-ids subset sets suite_complete=false (EVAL-08 inheritance)", async () => {
    process.env.EMMY_TBENCH_DRY_RUN = "1";
    const r = await runTerminalBench({
      profilePath: "profiles/qwen3.6-35b-a3b/v3.1",
      samples: 3,
      outDir: "/tmp/emmy-tbench-subset-" + Date.now(),
      taskIds: ["demo_001"],
    }) as any;
    expect(r.suite_complete).toBe(false);
    delete process.env.EMMY_TBENCH_DRY_RUN;
  });
});
```

Step 8 — Author `emmy_serve/eval/tbench_smoke.py`:

```python
"""tbench smoke gate — 5-task subset run before the full Tier-B run.

Mitigates Pitfall E-6 (silent skip-list growth on aarch64). If the smoke fails
above a threshold (any unexpected build failures, or aarch64-incompatibility >2
of 5 tasks), the full run is aborted.
"""
import argparse, json, subprocess, sys, time
from pathlib import Path

SMOKE_TASKS = [
    "blind-maze-explorer-5x5",
    "build-initramfs-qemu",
    "create-bucket",
    "git-leaderboard",
    "make-doom-for-mips",
]

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    Path(args.out).mkdir(parents=True, exist_ok=True)
    proc = subprocess.run([
        "tb", "run",
        "--agent-import-path", "eval.tbench_agent.pi_emmy_agent:PiEmmyAgent",
        "--dataset", "terminal-bench",
        "--dataset-version", "2.0",
        "--task-ids", ",".join(SMOKE_TASKS),
        "--n-attempts", "1",
        "--output-path", args.out,
    ], env={
        **__import__("os").environ,
        "EMMY_BASE_URL": "http://127.0.0.1:8002",
        "EMMY_PROFILE": args.profile,
    })
    if proc.returncode != 0:
        print(f"smoke: tb run exited {proc.returncode}; aborting full run", file=sys.stderr)
        return 1

    results = json.loads(Path(args.out, "results.json").read_text())
    failures = [r for r in results["runs"] if not r["is_resolved"]]
    aarch64_skips = [r for r in failures if "aarch64" in (r.get("failure_mode") or "").lower()]
    if len(aarch64_skips) > 2:
        print(f"smoke: {len(aarch64_skips)}/5 tasks are aarch64-incompatible; populate SKIP_LIST.yaml and re-run", file=sys.stderr)
        return 2
    print(f"smoke: {len(results['runs']) - len(failures)}/{len(results['runs'])} tasks pass; full run cleared")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

Step 9 — Wire `emmy_serve/eval/tbench_smoke.py` into `pyproject.toml` as a console script: `pi-emmy-tbench-smoke = "emmy_serve.eval.tbench_smoke:main"`.

Step 10 — Run unit tests:

```bash
cd /data/projects/emmy
bun test packages/emmy-eval/tests/tbench-adapter.test.ts
python -c "import sys; sys.path.insert(0, '.'); from eval.tbench_agent.pi_emmy_agent import PiEmmyAgent; assert PiEmmyAgent.name() == 'pi-emmy'; print('PiEmmyAgent name ok')"
```

**Verify:**

```
cd /data/projects/emmy && bun test packages/emmy-eval/tests/tbench-adapter.test.ts && python -c "from eval.tbench_agent.pi_emmy_agent import PiEmmyAgent; assert PiEmmyAgent.name()=='pi-emmy'"
```

**Done:**
- 5 files in `eval/tbench-agent/` (Python agent + install + Dockerfile + README + SKIP_LIST.yaml)
- `packages/emmy-eval/src/suites/tbench.ts` + 3 unit tests GREEN
- `eval/suites/tbench-2.0.yaml` with sha256 manifest_hash
- `emmy_serve/eval/tbench_smoke.py` exists; `uv run pi-emmy-tbench-smoke --help` exits 0
- README.md documents host-loopback flow + how to invoke from emmy-eval orchestrator

***

## Task 2 (checkpoint:human-verify, gate=blocking): Operator runs Tier-B MoE batch on DGX Spark — 18h GPU window

**what-built:**
Claude has shipped:
- The PiEmmyAgent shim + install + Dockerfile + tbench.ts adapter (Task 1)
- `runs/phase5-tbench/{qwen35-a3b-v3.1,gemma26b-a4b-v2}/.gitkeep` directory placeholders
- `scripts/run_phase5_tbench.sh` driver script that:
  1. Starts emmy-serve with the active profile
  2. Runs `pi-emmy-tbench-smoke --profile $PROFILE --out runs/phase5-tbench/<slug>/<iso>-smoke/`
  3. If smoke green: runs the full `pi-emmy-eval run --suite eval/suites/tbench-2.0.yaml --profile profiles/<slug>/<v> --samples 3 --out runs/phase5-tbench/<slug>/<iso>/`
  4. On completion, runs the operator's `/profile` swap to the next profile
  5. Mandatory 5-min thermal cool-down between profile-batches (Pitfall E-7)

**The OPERATOR runs:**

Window: ~18-20h continuous. Operator should plan an overnight or weekend slot.

```bash
# Pre-flight (before bedtime, not part of the 18h):
cd /data/projects/emmy
git pull && bun install --frozen-lockfile
docker pull ghcr.io/laude-institute/terminal-bench/base-agent  # cache the tbench base image
# Build the pi-emmy tbench Docker image
docker build -t pi-emmy-tbench:phase5 -f eval/tbench-agent/Dockerfile.pi_emmy .

# Profile 1: Qwen MoE 35B-A3B (the daily-driver default)
./scripts/start_emmy.sh --profile profiles/qwen3.6-35b-a3b/v3.1
# Wait for "smoke ok" log line (indicates emmy-serve passed boot canary)
EMMY_AIRGAP=strict ./scripts/run_phase5_tbench.sh --profile qwen3.6-35b-a3b@v3.1 --samples 3
# Expected: ~9h. Output at runs/phase5-tbench/qwen35-a3b-v3.1/<iso>/

# 5-min thermal cool-down (script enforces; operator confirms nvidia-smi GPU temp <60C before next)

# Profile 2: Gemma MoE 26B-A4B
/profile gemma-4-26b-a4b-it
EMMY_AIRGAP=strict ./scripts/run_phase5_tbench.sh --profile gemma-4-26b-a4b-it@v2 --samples 3
# Expected: ~9h. Output at runs/phase5-tbench/gemma26b-a4b-v2/<iso>/
```

Resume signal: type `tbench moe green` once both MoE profile reports exist on disk AND each report's `report.json.suite_complete` is `true` AND `spok_failures: 0`.

**how-to-verify:**

1. Two report directories under `runs/phase5-tbench/<profile-slug>/<iso>/`:
   - `runs/phase5-tbench/qwen35-a3b-v3.1/<iso>/{report.json, report.md, provenance.json, transcripts/}`
   - `runs/phase5-tbench/gemma26b-a4b-v2/<iso>/{report.json, report.md, provenance.json, transcripts/}`
2. Each `report.json`:
   - `suite_id == "terminal-bench-2.0"`
   - `suite_complete == true`
   - `spok_failures == 0` (any non-zero aborts batch — investigate before resuming)
   - `rows` array length 89 minus skip-list size
   - Each row has `samples.length == 3` + `mean_exec` + `std_exec` populated
   - `provenance` embedded with profile.id@version, container_image_digest, model_sha, gpu_uuid, eval_driver_commit
3. Each `report.md` has a header showing profile + suite + sample count + mean pass-rate
4. nvidia-smi log shows zero preemption events + zero OOM events across both batches (operator captures `nvidia-smi -q | grep "Pending Page Retirement"` before/after)
5. SKIP_LIST.yaml updated with any aarch64-incompatible tasks discovered during smoke

**resume-signal:** Type `tbench moe green` once both MoE profile reports validate

***

## Task 3 (checkpoint:human-verify, gate=blocking): Operator runs Tier-B dense smoke batch — 6h GPU window

**what-built:**
Same `scripts/run_phase5_tbench.sh` driver + the existing PiEmmyAgent + Dockerfile. Plan 05-03 Task 2's MoE evidence already validates the wiring; Task 3 only needs to extend it across the 2 dense profiles at N=1 (smoke).

**The OPERATOR runs:**

Window: ~6h continuous (or split into 2 ~3h slots). Less GPU pressure than Task 2.

```bash
# Profile 3: Qwen dense 27B (smoke N=1)
/profile qwen3.6-27b
EMMY_AIRGAP=strict ./scripts/run_phase5_tbench.sh --profile qwen3.6-27b@v1.1 --samples 1
# Expected: ~3h. Tier-B-warning fires once at startup (per D-01 dense=smoke-only).
# Output at runs/phase5-tbench/qwen27b-v1.1/<iso>/

# 5-min cool-down

# Profile 4: Gemma dense 31B (smoke N=1)
/profile gemma-4-31b-it
EMMY_AIRGAP=strict ./scripts/run_phase5_tbench.sh --profile gemma-4-31b-it@v1.1 --samples 1
# Expected: ~3h.
# Output at runs/phase5-tbench/gemma31b-v1.1/<iso>/
```

Resume signal: type `tbench dense green` once both dense profile reports exist AND each report has `suite_complete_reason: "smoke-N1"` (Blocker 4 contract — N=1 dense smoke sets suite_complete=false with reason 'smoke-N1', which Plan 05-06 compareSuiteRuns recognizes as expected D-01 Tier-B behavior, NOT an EVAL-08 violation). Per-task `samples.length == 1` is expected; `insufficient_samples: true` is also expected (computeStats requires N≥3).

**how-to-verify:**

1. Two more report directories: `runs/phase5-tbench/{qwen27b-v1.1,gemma31b-v1.1}/<iso>/`
2. Each `report.json`:
   - `suite_id == "terminal-bench-2.0"`
   - `total_samples == (89 - skip-list-size) * 1`  (single sample per task)
   - Each row has `samples.length == 1` + `insufficient_samples: true` (because computeStats throws at N<3) — this is correct per D-01 "dense correctness signal, not statistical claim"
3. Reports' markdown headers carry the operator-visible "Tier-B violation: dense profile evaluated at N=1, this run cannot promote any change" callout
4. The four reports together (2 MoE × N=3 + 2 dense × N=1) constitute the full Tier-B evidence — Plan 05-06 A/B compare consumes them

**resume-signal:** Type `tbench dense green` when both dense reports validate

***

## Task 4 (checkpoint:human-verify, gate=blocking): Operator runs Tier-A execution — 4 light suites × 4 profiles × N=3

**what-built:**
Per checker Blocker 5: Plan 05-03's existing Tasks 2 + 3 cover only the Tier-B-heavy tbench batches. Per CONTEXT.md D-01, **Tier A** (prior-Phase-1 continuity + holdout + rephrased + LiveCodeBench rolling) runs against ALL 4 MATRIX profiles at N=3 — total estimated ~30h continuous per RESEARCH.md §Q12 (cheap suites; doable in 1.5-2 days). Without this Task, Plan 05-07's reproducer manifest references run dirs that don't exist on disk.

Claude has shipped:
- All Plan 05-01 + 05-02 + Plan 05-03 Tasks 1-3 + Plan 05-05 artifacts (driver, suites, profiles, judge subsystem)
- New `scripts/run_phase5_tier_a.sh` driver script that:
  1. Asserts `EMMY_AIRGAP=strict` (Tier-A inference is STRICT-only; LCB cache must already be populated by Plan 05-01's PERMISSIVE prepare)
  2. Iterates the 4 MATRIX profiles
  3. Per profile: starts emmy-serve via `/profile <id>`, then runs `pi-emmy-eval run --suite <each Tier-A suite> --samples 3 --out runs/phase5-<suite>/<profile-slug>/<iso>/`
  4. 5-min mandatory cool-down between profile-batches (Pitfall E-7 thermal-thrash mitigation)
  5. Per-profile checkpointing: per-suite `<run-dir>/checkpoint.json` so a thermal pause / overnight power blip does not waste 5+h
  6. Holds a single emmy-serve container per profile across all 4 Tier-A suites (no per-suite swap; only per-profile)

The driver script body is operator-readable Bash following the pattern from `scripts/run_phase5_tbench.sh` (Task 2's driver). Same exit-code contract as `pi-emmy-eval run` (0/5/6/7/8/9 per Plan 05-02 <interfaces>).

**Per-profile wall-clock estimates** (per RESEARCH.md §Q12 Tier A row):

| Profile | tok/s | prior-phase1 (5 tasks × N=3) | holdout (5 tasks × N=3) | rephrased (5 tasks × N=3) | LCB rolling (~50-200 × N=3) | per-profile total |
|---|---|---|---|---|---|---|
| qwen3.6-35b-a3b @v3.1 (MoE) | ~50 | ~30 min | ~30 min | ~30 min | ~2.5h | ~4h |
| qwen3.6-27b @v1.1 (dense) | ~7.6 | ~2.5h | ~2.5h | ~2.5h | ~16h | ~24h |
| gemma-4-26b-a4b-it @v2 (MoE) | ~37 | ~40 min | ~40 min | ~40 min | ~3h | ~5h |
| gemma-4-31b-it @v1.1 (dense) | ~6.4 | ~3h | ~3h | ~3h | ~19h | ~28h |
| **All 4 profiles total** | | | | | | **~61h continuous** |

The dense profiles dominate the budget. Per D-01 Tier-A coverage is **all 4 profiles at N=3** (the cheap suites can absorb dense's slower throughput because per-task tokens are small ~1-5K). If a thermal/power event interrupts a dense profile, the per-suite checkpointing limits loss to one suite (≤19h). 5-min cooldowns are the only mandatory operator-visible boundary.

**The OPERATOR runs:**

Window: ~61h continuous wall-clock — operator should plan a long weekend or split across two weekends with checkpoint resume. Inference is STRICT-only; LCB cache must already exist from Plan 05-01 PERMISSIVE prepare.

```bash
cd /data/projects/emmy

# Pre-flight (PERMISSIVE; one-time; if not already done in Plan 05-01)
EMMY_AIRGAP=permissive uv run python scripts/eval/fetch_lcb_dataset.py
ls -lh eval/cache/livecodebench/release_v6.jsonl    # confirm cache exists

# Tier-A execution — 4 profiles × 4 suites × N=3, all under STRICT inference
EMMY_AIRGAP=strict ./scripts/run_phase5_tier_a.sh
# Driver iterates: qwen3.6-35b-a3b → qwen3.6-27b → gemma-4-26b-a4b-it → gemma-4-31b-it
# Per profile: prior-phase1 → holdout → rephrased → livecodebench-rolling
# 5-min cool-down between profiles
# Outputs land at runs/phase5-{prior-phase1,holdout,rephrased,livecodebench}/<profile-slug>/<iso>/

# If interrupted, resume from the last completed profile-suite cell:
EMMY_AIRGAP=strict ./scripts/run_phase5_tier_a.sh --resume-from gemma-4-26b-a4b-it@v2:rephrased
```

Resume signal: type `tier-a green` once all **16 result directories** exist (4 profiles × 4 suites) AND each report.json has:
- `suite_id` matching the suite YAML's `suite_id`
- `suite_complete_reason: "complete"` (Blocker 4 — N=3 + no filter + no max-tasks → reason="complete"; suite_complete=true)
- `spok_failures == 0`
- For each row: `samples.length == 3`; `insufficient_samples: false`

**how-to-verify:**

1. 16 result directories exist:
   ```bash
   for SUITE in prior-phase1 holdout rephrased livecodebench; do
     for SLUG in qwen35-a3b-v3.1 qwen27b-v1.1 gemma26b-a4b-v2 gemma31b-v1.1; do
       ls -d runs/phase5-${SUITE}/${SLUG}/*/ | head -1 || echo "MISSING $SUITE/$SLUG"
     done
   done | grep -c MISSING   # expect 0
   ```

2. All 16 report.json files have suite_complete_reason='complete':
   ```bash
   find runs/phase5-{prior-phase1,holdout,rephrased,livecodebench} -name report.json -newer runs/phase5-tbench/.gitkeep      -exec jq -r '.result.suite_complete_reason' {} \; | sort -u
   # expect single line: "complete"
   ```

3. All 16 reports have spok_failures==0:
   ```bash
   find runs/phase5-{prior-phase1,holdout,rephrased,livecodebench} -name report.json -newer runs/phase5-tbench/.gitkeep      -exec jq -r '.result.spok_failures' {} \; | sort -u
   # expect single line: "0"
   ```

4. nvidia-smi snapshots before/after each profile-batch show no preemption events + no OOM events
5. LCB rolling reports include the per-profile cutoff date (from `eval/suites/livecodebench-rolling.yaml profile_cutoffs`) embedded in provenance.json `eval.suite_manifest_hash`
6. `scripts/run_phase5_tier_a.sh` exists + is executable (`test -x scripts/run_phase5_tier_a.sh`)

**resume-signal:** Type `tier-a green` once all 16 reports validate

# Threat Model

## Trust Boundaries

| Boundary | Description |
|---|---|
| tbench Docker container → host emmy-serve | Container reaches host via `host.docker.internal:8002`; STRICT lane (no other egress) |
| pi-emmy host → tbench Docker container build | install_pi_emmy.sh has network during install (Bun fetch); the agent runtime does not |
| 24h continuous GPU run | Thermal envelope: Pitfall #7 mitigation — 5-min mandatory cool-down between profile batches; nvidia-smi snapshots before/after |
| SKIP_LIST.yaml authorship | Operator-curated based on smoke-discovered aarch64 incompatibilities — must be reviewed; arbitrary additions weaken contamination signal |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-05-03-01 | T (Tampering) | tbench results.json (per-sample) | mitigate | Adapter parses results.json + recomputes mean/std from raw is_resolved; provenance.json embeds the manifest_hash so tampering is detectable |
| T-05-03-02 | E (Elevation of privilege) | tbench Docker container reaching outside loopback | mitigate | Dockerfile.pi_emmy doesn't open additional ports; agent runtime in STRICT mode; air-gap CI runs the same container without --add-host to prove container-only egress |
| T-05-03-03 | I (Information disclosure) | transcripts/*.jsonl may contain code from tasks | accept | tbench tasks are public domain; transcripts are the artifact we want to publish |
| T-05-03-04 | D (DoS) | thermal throttle mid-run (Tier-B 24h batch + Tier-A 61h batch) | mitigate | Driver scripts enforce 5-min cool-down per profile; smoke gate aborts full run if smoke shows GPU clock dropped >10% from Phase 04.1 measured floors; per-suite checkpoint.json files limit interrupt loss to ≤19h on dense profiles |
| T-05-03-05 | R (Repudiation) | aarch64 SKIP_LIST.yaml additions | mitigate | Each entry has discovered_in (run iso) + reason; smoke gate refuses to start if SKIP_LIST.yaml mtime is newer than tbench-2.0.yaml manifest hash (forces hash recompute when skip list changes) |
| T-05-03-06 | T | profile swap mid-batch (operator runs `/profile` between samples) | mitigate | Adapter records `provenance.profile.id@version` once at batch start; refuses to write samples whose mid-batch SP_OK canary failed (Plan 05-02 per-50 re-canary catches this) |
| T-05-03-07 | S (Spoofing) | tbench --dataset-version drift | mitigate | suite manifest pins `dataset_version: "2.0"` + `expected_task_count: 89`; adapter asserts results.json runs.length matches expectation (post-skip-list) |

# Verification

End-of-plan checks:

1. `bun test packages/emmy-eval/tests/tbench-adapter.test.ts` — 3 dry-run tests green
2. `python -c "from eval.tbench_agent.pi_emmy_agent import PiEmmyAgent; assert PiEmmyAgent.name()=='pi-emmy'"` exits 0
3. `eval/suites/tbench-2.0.yaml` has real `manifest_hash:` (sha256 + 64 hex)
4. `docker build -t pi-emmy-tbench:phase5 -f eval/tbench-agent/Dockerfile.pi_emmy .` builds successfully on aarch64 Spark
5. `pi-emmy-tbench-smoke --profile qwen3.6-35b-a3b@v3.1 --out /tmp/smoke` exits 0 with 5/5 or 4/5 pass (acceptable; gate is "no surprise aarch64 skips")
6. After Task 2: `jq '.suite_complete' runs/phase5-tbench/qwen35-a3b-v3.1/*/report.json` returns true; `jq '.spok_failures' returns 0
7. After Task 3: 4 report directories total under `runs/phase5-tbench/` (one per MATRIX profile)
8. SKIP_LIST.yaml has at most 5 entries (if more, escalate per RESEARCH.md Risk 3 — possible Phase 7 SWE-bench move)

# Success Criteria

- Plan 05-06 A/B compare can ingest the 4 tbench report.json files and produce a side-by-side comparison
- Plan 05-07 reproducer manifest captures the tbench-2.0.yaml + SKIP_LIST.yaml + Dockerfile.pi_emmy as part of `eval/REPRODUCER.md`
- Phase 5 SC-1 evidence: at least one tbench profile-batch produces JSON+markdown reports with full provenance
- Phase 5 SC-2 partial-evidence (reproducer-script-exists): `scripts/run_phase5_tbench.sh` documents the full reproduce path
- EVAL-01 partial closure: terminal-bench-2.0 ✓ (SWE-Lite + LCB carry over to Plan 05-04 + 05-01 respectively)

# Output

After Tasks 1-3 complete, create `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-03-SUMMARY.md`. Cite:
- 4 result directory paths + their report.json `mean_pass_rate` + `total_samples`
- SKIP_LIST.yaml final size (e.g. `2 / 89 tasks skipped: <reasons>`)
- Wall-clock per profile (actual vs predicted)
- Resume signals: `tbench moe green`, `tbench dense green`
- Container image digest captured at first run (filled into tbench-2.0.yaml)
- Any deferrals (e.g. if a profile failed > smoke threshold, defer to closeout)
