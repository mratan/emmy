#!/usr/bin/env python3
"""scripts/throughput_sweep.py — Plan 01-06 SC-1 gap-closure sweep harness.

Iterates ``SWEEP_CANDIDATES`` from ``emmy_serve.boot.throughput``, booting
emmy-serve with each candidate's env overrides / serving.yaml patch,
measuring warm decode throughput + running the full canary suite over
>=3 samples per candidate, and writing results.json under
``runs/<run_id>-phase1-sc1-throughput-sweep/``.

The decision logic (pitfall-#5 gate: throughput >= floor AND all canaries
pass, else NOT a winner) lives in ``emmy_serve.boot.throughput.decide_winner``
and is unit-tested independently of this harness.

Exit 0 regardless of winner/no-winner — the sweep completing IS the success
criterion. Exit 1 only on unrecoverable harness errors (profile can't load,
results.json can't be written).

Runtime: ~10-15 min per candidate (3 min boot + ~3 min measurement + ~3 min
canary + ~3 min teardown) x 5 candidates = 50-75 min total on DGX Spark.

--dry-run:
    Prints the candidate matrix without booting or measuring anything.
    Used by unit tests and the plan's pre-flight check.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import yaml

from emmy_serve.boot.throughput import (
    SWEEP_CANDIDATES,
    CandidateKnob,
    ThroughputMeasurement,
    decide_winner,
    measure_warm_throughput,
)
from emmy_serve.diagnostics.atomic import write_json_atomic, write_text_atomic
from emmy_serve.diagnostics.layout import new_run_id
from emmy_serve.profile.loader import load_profile


# ---------------------------------------------------------------------------
# Container lifecycle (discovered-at-task-2-runtime: exact env-propagation
# mechanism for start_emmy.sh may need adjustment if the current script does
# not forward arbitrary env vars to `docker run -e`. See PROFILE_NOTES.md §SC-1
# bullet 2 for the CUDA_FORWARD_COMPATIBLE mechanism caveat.)
# ---------------------------------------------------------------------------


def _stop_container(name: str = "emmy-serve") -> None:
    """Stop + remove any existing emmy-serve container. Best-effort, never raises."""
    for args in (["docker", "stop", name], ["docker", "rm", name]):
        try:
            subprocess.run(args, capture_output=True, timeout=30)
        except Exception:
            pass


def _boot_with_env(
    profile: Path,
    port: int,
    extra_env: dict[str, str],
    start_script: Path,  # kept for signature compat; unused on this path
    run_dir: Path | None = None,
) -> None:
    """Boot emmy-serve with candidate env vars injected into the container.

    DISCOVERED-AT-TASK-2-RUNTIME (2026-04-21): `start_emmy.sh` + the running
    `render_docker_only_args` (emmy_serve/boot/runner.py:101-148) only forward
    8 named envs from serving.yaml.env into `docker run -e`. Host env vars are
    NOT propagated. To honestly measure env-based candidates (K1, K2) we must
    bypass `start_emmy.sh` and render the docker args directly, then inject
    the candidate env as additional `-e KEY=VAL` pairs before the image ref.

    Serving.yaml-patch candidates (K3, K4) still work via the rendered args
    because render_docker_args rereads serving.yaml at each invocation —
    `_apply_serving_yaml_patch` already mutates the file before this call.
    """
    # 1. Render the complete docker argv via the boot.runner module, but
    #    inject run_dir under the profile-internal "runs" convention.
    if run_dir is None:
        run_dir = Path("runs") / f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-sweep-boot"
    run_dir.mkdir(parents=True, exist_ok=True)

    r = subprocess.run(
        [
            "uv", "run", "python", "-m", "emmy_serve.boot.runner", "render-docker-args",
            "--profile", str(profile),
            "--run-dir", str(run_dir),
            "--port", str(port),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if r.returncode != 0:
        raise RuntimeError(
            f"render-docker-args exited {r.returncode}: {r.stderr.strip()}"
        )
    # 2. Split and inject the candidate env as `-e KEY=VAL` pairs. Prepend so
    #    the extra env lands among the flags (before the image ref / vllm CLI).
    import shlex
    rendered = shlex.split(r.stdout.strip())
    extra_env_flags: list[str] = []
    for k, v in extra_env.items():
        extra_env_flags += ["-e", f"{k}={v}"]
    # 3. Tear down any prior container and launch detached.
    _stop_container()
    argv = ["docker", "run", "--name", "emmy-serve", "--detach"] + extra_env_flags + rendered
    boot_log = run_dir / "docker-run.log"
    with open(boot_log, "wb") as f:
        r2 = subprocess.run(argv, stdout=f, stderr=subprocess.STDOUT, timeout=120)
    if r2.returncode != 0:
        tail = boot_log.read_text(errors="replace")[-2000:]
        raise RuntimeError(
            f"docker run exited {r2.returncode} (candidate env={extra_env}); tail:\n{tail}"
        )


def _wait_for_models(base_url: str, timeout_s: float = 300.0) -> None:
    """Poll /v1/models until 200. Raises if not ready within timeout_s."""
    deadline = time.monotonic() + timeout_s
    last_err: str | None = None
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{base_url.rstrip('/')}/v1/models", timeout=5.0)
            if r.status_code == 200:
                return
            last_err = f"status={r.status_code}"
        except Exception as e:
            last_err = str(e)
        time.sleep(2.0)
    raise RuntimeError(f"/v1/models not ready within {timeout_s}s: {last_err}")


# ---------------------------------------------------------------------------
# serving.yaml patch / restore (K4 only)
# ---------------------------------------------------------------------------


def _apply_serving_yaml_patch(
    profile: Path, patch: dict | None
) -> dict | None:
    """Apply a patch to serving.yaml in-place; return restore-state dict or None.

    K4 (reasoning_parser) is the only candidate that goes through this path.
    The patch is applied shallowly — `patch = {"engine": {"reasoning_parser":
    "qwen3"}}` merges into serving.yaml.engine. After writing the patched YAML,
    we rehash the profile (``emmy profile hash --write``) so `emmy profile
    validate` continues to exit 0 during this candidate's boot.

    On `_restore_serving_yaml`, the original bytes are written back and the
    hash is recomputed — the profile is in the same shape after each candidate
    as before the sweep started.
    """
    if not patch:
        return None
    sp = profile / "serving.yaml"
    original = sp.read_text(encoding="utf-8")
    data = yaml.safe_load(original) or {}
    for section, fields in patch.items():
        existing = data.get(section) or {}
        if not isinstance(existing, dict):
            existing = {}
        existing.update(fields)
        data[section] = existing
    write_text_atomic(sp, yaml.safe_dump(data, sort_keys=False))
    # Rehash so emmy profile validate exits 0 during this candidate's window.
    try:
        subprocess.run(
            ["uv", "run", "emmy", "profile", "hash", str(profile), "--write"],
            capture_output=True,
            timeout=60,
        )
    except Exception:
        # Non-fatal — the sweep continues but the profile hash will be stale.
        # Restored on tear-down via _restore_serving_yaml.
        pass
    return {"path": str(sp), "original": original, "profile_dir": str(profile)}


def _restore_serving_yaml(state: dict | None) -> None:
    """Undo any serving.yaml patch + rehash the profile. Idempotent, never raises."""
    if not state:
        return
    try:
        Path(state["path"]).write_text(state["original"], encoding="utf-8")
    except Exception:
        pass
    try:
        subprocess.run(
            [
                "uv",
                "run",
                "emmy",
                "profile",
                "hash",
                state["profile_dir"],
                "--write",
            ],
            capture_output=True,
            timeout=60,
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Dry-run manifest emitter (unit-tested path)
# ---------------------------------------------------------------------------


def _emit_dry_run(candidates: list[CandidateKnob]) -> None:
    """Print the candidate matrix; NO docker/httpx/rehash side-effects."""
    print("SWEEP_CANDIDATES (Plan 01-06, PROFILE_NOTES.md §'SC-1 throughput gap')")
    print("=" * 78)
    for c in candidates:
        env_str = (
            ",".join(f"{k}={v}" for k, v in c.env_overrides.items())
            if c.env_overrides
            else "(none)"
        )
        patch_str = str(c.serving_yaml_patch) if c.serving_yaml_patch else "(none)"
        print(f"{c.id:28s}  {c.label}")
        print(f"  env: {env_str}")
        print(f"  serving.yaml patch: {patch_str}")
        print(f"  notes: {c.notes[:120]}{'…' if len(c.notes) > 120 else ''}")
        print()


# ---------------------------------------------------------------------------
# Main sweep loop
# ---------------------------------------------------------------------------


def _measure_candidate(
    cand: CandidateKnob,
    *,
    profile: Path,
    port: int,
    base_url: str,
    samples: int,
    max_tokens: int,
    model: str,
    start_script: Path,
) -> ThroughputMeasurement:
    """Boot + measure + teardown one candidate. Always returns a measurement."""
    _stop_container()
    patch_state = _apply_serving_yaml_patch(profile, cand.serving_yaml_patch)
    try:
        _boot_with_env(profile, port, cand.env_overrides, start_script)
        _wait_for_models(base_url)
        return measure_warm_throughput(
            base_url,
            model,
            candidate_id=cand.id,
            n_samples=samples,
            max_tokens=max_tokens,
        )
    except Exception as e:
        return ThroughputMeasurement(
            candidate_id=cand.id,
            samples_tokps=[],
            mean=0.0,
            std=0.0,
            p50=0.0,
            canary_sp_ok=False,
            canary_tool_call=False,
            canary_generate=False,
            error=f"boot/harness error: {str(e)[:300]}",
            hardware_id="unknown",
            ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
    finally:
        _stop_container()
        _restore_serving_yaml(patch_state)


def _format_summary_table(measurements: list[ThroughputMeasurement]) -> str:
    """Render the sweep results as a human-readable markdown-style table."""
    lines = [
        f"{'candidate':30s} {'mean':>8s} {'std':>6s} {'p50':>8s} {'canaries':>10s}  error",
        "-" * 90,
    ]
    for m in measurements:
        canary = (
            ("Y" if m.canary_sp_ok else "N")
            + ("Y" if m.canary_tool_call else "N")
            + ("Y" if m.canary_generate else "N")
        )
        lines.append(
            f"{m.candidate_id:30s} {m.mean:8.2f} {m.std:6.2f} {m.p50:8.2f} {canary:>10s}  {m.error or ''}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="scripts/throughput_sweep.py",
        description="SC-1 throughput-sweep harness (Plan 01-06, SC-1 gap closure)",
    )
    ap.add_argument("--profile", default="profiles/qwen3.6-35b-a3b/v1")
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--max-tokens", type=int, default=500)
    ap.add_argument("--port", type=int, default=8002)
    ap.add_argument("--base-url", default="http://127.0.0.1:8002")
    ap.add_argument("--runs-dir", default="runs")
    ap.add_argument(
        "--start-script",
        default="./scripts/start_emmy.sh",
        help="Boot script invoked per candidate (env-forwarding path)",
    )
    ap.add_argument("--floor-tokps", type=float, default=60.0)
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the candidate manifest + exit; no docker/httpx calls",
    )
    args = ap.parse_args(argv)

    if args.dry_run:
        _emit_dry_run(SWEEP_CANDIDATES)
        return 0

    # Load the profile (so we have the served_model_name + hash for results.json).
    profile = Path(args.profile)
    try:
        serving, _harness, profile_ref = load_profile(profile)
    except Exception as e:
        print(f"ERROR (profile load): {e}", file=sys.stderr)
        return 1
    model = serving.engine.served_model_name

    # Run directory — uses new_run_id() shape so it sorts alphabetically by UTC ts.
    run_id = new_run_id()
    run_dir = Path(args.runs_dir) / f"{run_id}-phase1-sc1-throughput-sweep"
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[sweep] run_dir: {run_dir}", flush=True)

    start_script = Path(args.start_script).resolve()
    if not start_script.exists():
        print(f"ERROR (start_script): {start_script} does not exist", file=sys.stderr)
        return 1

    # Main sweep loop.
    measurements: list[ThroughputMeasurement] = []
    for i, cand in enumerate(SWEEP_CANDIDATES, start=1):
        print(
            f"\n[sweep] {i}/{len(SWEEP_CANDIDATES)} candidate={cand.id} label={cand.label}",
            flush=True,
        )
        m = _measure_candidate(
            cand,
            profile=profile,
            port=args.port,
            base_url=args.base_url,
            samples=args.samples,
            max_tokens=args.max_tokens,
            model=model,
            start_script=start_script,
        )
        measurements.append(m)
        canary_triple = (m.canary_sp_ok, m.canary_tool_call, m.canary_generate)
        print(
            f"[sweep]   mean={m.mean:.2f} std={m.std:.2f} p50={m.p50:.2f} "
            f"canaries={canary_triple} err={m.error}",
            flush=True,
        )

    # Decision.
    winner = decide_winner(measurements, floor_tokps=args.floor_tokps)
    decision = f"closed-by-{winner}" if winner else "accept-architectural"

    results = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "run_id": run_id,
        "profile_id": profile_ref.id,
        "profile_version": profile_ref.version,
        "profile_hash_before": profile_ref.hash,
        "floor_tokps": args.floor_tokps,
        "max_tokens": args.max_tokens,
        "samples_per_candidate": args.samples,
        "prompt": "Count to 100.",
        "winner_id": winner,
        "decision": decision,
        "candidates": [
            {
                "candidate_id": m.candidate_id,
                "samples_tokps": list(m.samples_tokps),
                "mean": m.mean,
                "std": m.std,
                "p50": m.p50,
                "canary_sp_ok": m.canary_sp_ok,
                "canary_tool_call": m.canary_tool_call,
                "canary_generate": m.canary_generate,
                "error": m.error,
                "hardware_id": m.hardware_id,
                "ts": m.ts,
            }
            for m in measurements
        ],
    }
    results_path = run_dir / "results.json"
    try:
        write_json_atomic(results_path, results)
    except Exception as e:
        print(f"ERROR (results.json write): {e}", file=sys.stderr)
        return 1

    print("\n" + _format_summary_table(measurements))
    print(f"\n[sweep] decision: {decision}")
    print(f"[sweep] results:  {results_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
