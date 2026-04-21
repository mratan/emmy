"""KV-budget bisection finder (D-13, SERVE-08).

Implements RESEARCH.md §8 lines 1229-1378 directly. Pitfall #1 discipline:
this is the ONLY code path in emmy that writes into
``serving.yaml.engine.gpu_memory_utilization``. Any other mutation is
blocked by the immutability validator (Plan 01-02) + Plan 05's CI check.

Algorithm (§8 lines 1245-1289):
  start = 0.75, step_up = 2%, min_step = 0.5%, safety = 5%, max_iters = 12
  current = start
  while iters < max_iters:
    write current into serving.yaml
    restart vLLM, drive load, scrape preemption delta + dmesg OOM
    if clean:
      ok_value = max(ok_value, current)
      if preempted_at is known: next = (ok + preempted) / 2, bump /= 2  (bisect up)
      else:                     next = current + bump                   (step up)
    else:
      preempted_at = min(preempted_at or 1, current)
      next = (ok + preempted) / 2, bump /= 2                             (bisect down)
    if |next - current| < min_step or next >= 1.0: break
    current = round(next, 3)
  final = max(0.50, ok_value - safety / 100)
  write final; recompute profile.yaml.hash; append PROFILE_NOTES.md block

The finder is INTENDED to run on DGX Spark (it calls ./scripts/start_emmy.sh
between iterations). Unit tests in tests/unit/test_kv_finder.py mock out
subprocess + metrics + drive_load so the bisection math can be validated
without hardware.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from ..diagnostics.atomic import (
    append_jsonl_atomic,
    write_json_atomic,
    write_text_atomic,
)
from ..diagnostics.layout import EmmyRunLayout, new_run_id
from ..profile.loader import load_profile_manifest, load_serving
from .load_driver import drive_load
from .metrics import scrape_metrics


@dataclass
class FinderState:
    """Mutable bisection state. Not frozen — updated each iteration."""

    current_value: float
    ok_value: float  # highest value that ran clean so far
    preempted_at: float | None  # lowest value that preempted so far
    bump_pct: float  # current step-up step (halved on direction change)
    iters: int


def _check_dmesg_oom(since: str = "10 minutes ago") -> list[str]:
    """Return OOM-keyword dmesg lines since ``since``. Graceful on all errors.

    ``dmesg -T --since`` typically needs CAP_SYSLOG; on many Spark setups the
    emmy-ci user has dmesg read access, but we never want a permission-denied
    read to crash a 100-minute finder run. Missing/empty → [] is handled by
    the caller (treated as "no OOM observed", same as a successful-but-empty
    read).
    """
    try:
        out = subprocess.check_output(
            ["dmesg", "-T", "--since", since],
            stderr=subprocess.DEVNULL,
            timeout=30,
        ).decode(errors="replace")
    except Exception:
        return []
    hits = [
        line
        for line in out.splitlines()
        if any(
            pat in line.lower() for pat in ("oom", "out of memory", "killed process")
        )
    ]
    return hits


def _rewrite_gpu_mem_util(serving_path: Path, value: float) -> None:
    """Atomically rewrite ``serving.yaml.engine.gpu_memory_utilization`` in place.

    Rounds to 3 decimals (matches RESEARCH.md §8 line 1281 — finder precision
    is per-percent, not per-basis-point).

    Comment-preserving line rewrite: PyYAML safe_dump strips comments, which
    destroys the prior-repo template provenance AND (worse) changes the
    canonical content hash every iteration, triggering the immutability
    validator on every ``start_emmy.sh`` boot. Instead, we do an in-place
    line substitution against the single ``gpu_memory_utilization:`` line —
    no YAML round-trip, comments preserved, only the target field changes.

    Early-return when the file already carries the target value: emits NO
    write, preserving the profile bytes exactly and keeping profile.yaml.hash
    valid across iterations that don't move the bisection point.
    """
    rounded = round(value, 3)
    text = serving_path.read_text(encoding="utf-8")
    new_text, substitutions = re.subn(
        r"(^\s*gpu_memory_utilization:\s*)([0-9.]+)(.*)$",
        lambda m: f"{m.group(1)}{rounded:g}{m.group(3)}",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if substitutions != 1:
        raise ValueError(
            f"_rewrite_gpu_mem_util: could not locate gpu_memory_utilization "
            f"line in {serving_path} (substitutions={substitutions})"
        )
    if new_text == text:
        return  # value unchanged — no write, no hash churn
    write_text_atomic(serving_path, new_text)


def _recompute_profile_hash(profile_path: Path) -> None:
    """Recompute profile.yaml.hash after a serving.yaml edit.

    Called between bisect iterations so the immutability validator invoked
    by ``./scripts/start_emmy.sh`` sees a self-consistent profile. The final
    canonical hash at end-of-run is whatever the final util produces.
    """
    subprocess.run(
        ["uv", "run", "emmy", "profile", "hash", str(profile_path), "--write"],
        check=True,
        timeout=60,
        stdout=subprocess.DEVNULL,
    )


def _hardware_id() -> str:
    """Record the host that produced the measurements (RESEARCH.md §8 summary.json)."""
    try:
        return subprocess.check_output(
            ["hostname"], text=True, timeout=5
        ).strip() or "unknown"
    except Exception:
        return "unknown"


def _append_profile_notes(
    profile_path: Path, final_val: float, state: FinderState, run_id: str
) -> None:
    """Append a KV-finder result block to PROFILE_NOTES.md.

    The append is a plain text write (the immutability validator runs AFTER
    via ``emmy profile hash --write``). RESEARCH.md §8 line 1365 specifies
    this block as the audit trail — PROFILE_NOTES.md carries the story;
    runs/<id>-kv-finder/ carries the provenance.
    """
    notes = profile_path / "PROFILE_NOTES.md"
    block = (
        f"\n### KV-finder result (run {run_id})\n\n"
        f"| Measurement | Value |\n|---|---|\n"
        f"| `gpu_memory_utilization` (final) | {final_val} |\n"
        f"| First-preemption value | {state.preempted_at} |\n"
        f"| Highest clean value | {state.ok_value} |\n"
        f"| Iterations | {state.iters} |\n"
        f"| Hardware | {_hardware_id()} |\n"
        f"| Run artifact | `runs/{run_id}-kv-finder/` |\n"
    )
    with open(notes, "a", encoding="utf-8") as f:
        f.write(block)


def _restart_vllm(profile_path: Path) -> None:
    """Restart vLLM via ./scripts/start_emmy.sh (handles digest + canary gate).

    Allowed to fail-loud — if start_emmy.sh exits non-zero, the finder
    cannot continue; subprocess.run raises CalledProcessError which
    propagates to the caller. That's correct: we'd rather the finder
    abort than loop on a broken boot.
    """
    subprocess.run(
        ["./scripts/start_emmy.sh", "--profile", str(profile_path)],
        check=True,
        timeout=420,
    )


def _stop_vllm() -> None:
    """Best-effort container stop + rm between iterations.

    Not check=True: a stale (not-running) container or a missing one is
    expected mid-loop; we absolutely don't want a docker-rm failure to
    abort the finder run after 20+ minutes of work.
    """
    subprocess.run(
        ["docker", "stop", "emmy-serve"],
        check=False,
        timeout=60,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["docker", "rm", "emmy-serve"],
        check=False,
        timeout=30,
        stderr=subprocess.DEVNULL,
    )


def _classify_failure(
    pre: dict[str, float], post: dict[str, float], dmesg_hits: list[str]
) -> tuple[str, dict[str, float]]:
    """Return (failure_kind, deltas).

    failure_kind is one of 'none', 'preemption', 'oom'. 'preemption' wins
    over 'oom' if both are true (preemption is a more specific vLLM signal).
    """
    preempt_delta = post.get("vllm:num_preemptions_total", 0.0) - pre.get(
        "vllm:num_preemptions_total", 0.0
    )
    # Legacy spelling fallback (vLLM versions pre-0.17).
    swap_delta = post.get("vllm:num_requests_swapped", 0.0) - pre.get(
        "vllm:num_requests_swapped", 0.0
    )
    deltas = {
        "preemptions_delta": preempt_delta,
        "swapped_delta": swap_delta,
    }
    if preempt_delta > 0 or swap_delta > 0:
        return "preemption", deltas
    if dmesg_hits:
        return "oom", deltas
    return "none", deltas


def run_finder(
    profile_path: Path,
    *,
    initial: float = 0.75,
    safety_margin_pct: float = 5.0,
    step_up_pct: float = 2.0,
    min_step_pct: float = 0.5,
    drive_minutes: int = 10,
    max_iters: int = 12,
    base_url: str = "http://127.0.0.1:8002",
    base_runs_dir: Path = Path("runs"),
) -> Path:
    """Run the bisection. Returns the run_dir.

    Side effects (in order):
      1. Writes intermediate + final gpu_memory_utilization to serving.yaml
      2. Appends to runs/<id>-kv-finder/iterations.jsonl per iter
      3. Restarts vLLM between iterations via scripts/start_emmy.sh
      4. On convergence:
         - writes runs/<id>-kv-finder/summary.json
         - appends measured-values block to PROFILE_NOTES.md
         - recomputes profile.yaml.hash via ``emmy profile hash --write``

    Note: the finder does NOT `docker pull` at any point. It consumes the
    digest already pinned in serving.yaml (Plan 03 operator capture).
    """
    profile_path = Path(profile_path)
    run_id = new_run_id()
    layout = EmmyRunLayout(base_dir=base_runs_dir, run_id=run_id, kind="kv-finder")
    layout.run_dir.mkdir(parents=True, exist_ok=True)

    serving_path = profile_path / "serving.yaml"
    # Load the current serving.yaml for served_model_name. If schema validation
    # fails (e.g. digest placeholder still in file), raise — we cannot proceed.
    serving_cfg = load_serving(serving_path)
    served_model = serving_cfg.engine.served_model_name
    # Load profile.yaml manifest (gives profile id + version for summary).
    manifest = load_profile_manifest(profile_path / "profile.yaml")

    state = FinderState(
        current_value=float(initial),
        ok_value=float(initial),  # assume initial is clean until proven otherwise
        preempted_at=None,
        bump_pct=float(step_up_pct),
        iters=0,
    )
    start_ts = time.time()

    while state.iters < max_iters:
        _rewrite_gpu_mem_util(serving_path, state.current_value)
        # Recompute profile.yaml.hash so the immutability validator invoked by
        # ./scripts/start_emmy.sh sees a self-consistent profile. The final
        # canonical hash at end-of-run is whatever the final util produces.
        _recompute_profile_hash(profile_path)

        # Restart vLLM with the new value.
        _restart_vllm(profile_path)

        # Snapshot metrics pre-drive, drive load, snapshot post-drive.
        # Swallow scrape errors: a momentarily-unresponsive /metrics is not
        # a preemption signal; the delta comparison handles "both zero" fine.
        try:
            pre = scrape_metrics(base_url)
        except Exception:
            pre = {}
        load_stats = drive_load(base_url, served_model, drive_minutes * 60)
        try:
            post = scrape_metrics(base_url)
        except Exception:
            post = {}

        dmesg_hits = _check_dmesg_oom()
        failure, deltas = _classify_failure(pre, post, dmesg_hits)

        append_jsonl_atomic(
            layout.iterations_path,
            {
                "iter": state.iters,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "value": state.current_value,
                "failure": failure,
                "duration_s": load_stats["duration_s"],
                "metrics": {
                    "preemptions_delta": int(deltas["preemptions_delta"]),
                    "swapped_delta": int(deltas["swapped_delta"]),
                    "p50_latency_ms": load_stats["p50_latency_ms"],
                    "p99_latency_ms": load_stats["p99_latency_ms"],
                    "tokens_generated": load_stats["tokens_generated"],
                    "n_requests": load_stats["n_requests"],
                },
                "dmesg_matches": dmesg_hits[:10],  # truncate to keep jsonl small
            },
        )

        _stop_vllm()

        # Update bisection state.
        if failure == "none":
            state.ok_value = max(state.ok_value, state.current_value)
            if state.preempted_at is not None:
                next_val = (state.ok_value + state.preempted_at) / 2
                state.bump_pct = state.bump_pct / 2
            else:
                next_val = state.current_value + state.bump_pct / 100
        else:
            state.preempted_at = min(
                state.preempted_at if state.preempted_at is not None else 1.0,
                state.current_value,
            )
            next_val = (state.ok_value + state.preempted_at) / 2
            state.bump_pct = state.bump_pct / 2

        # Convergence checks.
        if abs(next_val - state.current_value) < min_step_pct / 100:
            break
        if next_val >= 1.0:
            break
        state.current_value = round(next_val, 3)
        state.iters += 1

    # Apply safety margin to the highest-clean value we observed.
    final_val = round(max(0.50, state.ok_value - safety_margin_pct / 100), 3)
    _rewrite_gpu_mem_util(serving_path, final_val)

    # Recompute profile.yaml.hash once, after the final write. Best-effort:
    # if ``emmy profile hash --write`` fails (e.g. schema still rejects the
    # bundle because some OTHER field was edited out-of-band), the finder
    # still writes its summary + PROFILE_NOTES.md — hash drift is the CI
    # gate's problem, not the finder's.
    try:
        subprocess.run(
            ["uv", "run", "emmy", "profile", "hash", str(profile_path), "--write"],
            check=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        pass

    _append_profile_notes(profile_path, final_val, state, run_id)

    summary = {
        "profile_id": manifest.profile.id,
        "profile_version": manifest.profile.version,
        "hardware_id": _hardware_id(),
        "initial_value": float(initial),
        "final_value": final_val,
        "safety_margin_pct": float(safety_margin_pct),
        "first_preemption_at": state.preempted_at,
        "highest_clean_value": state.ok_value,
        "iterations": state.iters,
        "total_duration_s": round(time.time() - start_ts, 1),
        "load_driver": "kv_finder_subset_v1",
        "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start_ts)),
        "finished": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    write_json_atomic(layout.summary_path, summary)
    print(
        f"Finder complete: gpu_memory_utilization = {final_val} "
        f"(ok_value={state.ok_value}, preempted_at={state.preempted_at}, "
        f"iters={state.iters})"
    )
    print(f"  runs: {layout.run_dir}")
    return layout.run_dir


def main(argv: list[str] | None = None) -> int:
    """CLI entry. Returns 0 on success; raises on configuration error.

    Exit codes:
      0  finder completed; final value written to serving.yaml
      1  schema/profile error reading serving.yaml or profile.yaml
      2  hard error from docker/start_emmy.sh (propagated)
    """
    ap = argparse.ArgumentParser(
        description="KV-budget bisection finder (D-13, SERVE-08)",
    )
    ap.add_argument("--profile", required=True, help="profile bundle dir")
    ap.add_argument("--drive-minutes", type=int, default=10)
    ap.add_argument("--max-iters", type=int, default=12)
    ap.add_argument("--initial", type=float, default=0.75)
    ap.add_argument("--safety-margin-pct", type=float, default=5.0)
    ap.add_argument("--step-up-pct", type=float, default=2.0)
    ap.add_argument("--min-step-pct", type=float, default=0.5)
    ap.add_argument("--base-url", default="http://127.0.0.1:8002")
    ap.add_argument(
        "--runs-dir",
        default="runs",
        help="base directory for run artifacts (default: ./runs)",
    )
    args = ap.parse_args(argv)

    run_finder(
        Path(args.profile),
        initial=args.initial,
        safety_margin_pct=args.safety_margin_pct,
        step_up_pct=args.step_up_pct,
        min_step_pct=args.min_step_pct,
        drive_minutes=args.drive_minutes,
        max_iters=args.max_iters,
        base_url=args.base_url,
        base_runs_dir=Path(args.runs_dir),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
