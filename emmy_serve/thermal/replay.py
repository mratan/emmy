"""2-hour thermal replay harness per RESEARCH.md §9.6 + §9.7.

Pitfall #7 discipline (CLAUDE.md): thermal throttling is silent and quietly
fatal on long sessions. The mechanism: short benchmarks show ~2.8 GHz; at
the 2-hour mark the chip throttles to ~2 GHz, decode throughput drops,
and p1 latency spikes. Phase 1's job is to detect this (not prevent it)
by measuring hour-2 floors on the committed profile and asserting those
floors hold on every subsequent re-run.

Workflow:
    first-run:  measures hour-2 floors, writes them into PROFILE_NOTES.md
                measured_values, recomputes profile.yaml.hash
    re-run:     measures hour-2 floors, compares to recorded (hard gates
                on preemptions/OOM; 5% tolerance on clock p5, 7% on decode p50,
                10% on p1)

The harness assumes vLLM is ALREADY running at ``base_url`` (the operator
starts emmy via ./scripts/start_emmy.sh before invoking the replay). Pre-
replay canary gate (§9.6 line 1470) runs all three canaries before the
2-hour loop; any canary failure aborts.
"""
from __future__ import annotations

import argparse
import itertools
import json
import subprocess
import sys
import time
from pathlib import Path

import httpx
import yaml

from ..canary import (
    load_default_tool_schema,
    run_generate,
    run_sp_ok,
    run_tool_call,
)
from ..diagnostics.atomic import (
    append_jsonl_atomic,
    write_json_atomic,
    write_text_atomic,
)
from ..diagnostics.layout import EmmyRunLayout, new_run_id
from ..profile.loader import load_profile
from .audit import audit_corpus
from .corpus import ALL_THERMAL_PROMPTS
from .sampler import GpuSampler, VllmMetricsSampler


# --- §9.7 re-run tolerances (load-bearing constants) --------------------------
CLOCK_P5_TOLERANCE = 0.95  # computed_p5 >= recorded_p5 * 0.95  (5% drop allowed)
DECODE_P50_TOLERANCE = 0.93  # 7% drop allowed
DECODE_P1_TOLERANCE = 0.90  # 10% drop allowed (p1 is noisier)


def _percentile(sorted_values: list[float], p: float) -> float:
    """Compute the p-th percentile of an already-sorted list. Empty → 0.0."""
    if not sorted_values:
        return 0.0
    idx = max(0, min(len(sorted_values) - 1, int(len(sorted_values) * p / 100)))
    return float(sorted_values[idx])


def _load_jsonl(path: Path) -> list[dict]:
    """Load a JSONL file; empty/missing files yield []."""
    if not path.exists():
        return []
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            # Skip corrupt lines — the fsync pattern should make this rare.
            continue
    return rows


def run_replay(
    profile_path: Path,
    *,
    target_wall_time_s: int = 7200,
    inter_request_gap_s: float = 5.0,
    sample_interval_s: float = 5.0,
    base_url: str = "http://127.0.0.1:8002",
    base_runs_dir: Path = Path("runs"),
    require_audit_pass: bool = True,
) -> Path:
    """Run the 2-hour thermal replay. Returns the run dir.

    Pre-replay gates (§9.6 line 1470):
      1. Corpus audit passes §9.5 thresholds (abort if False).
      2. SP_OK canary passes.
      3. tool_call canary passes.
      4. generate canary passes.

    Main loop (§9.6 lines 1471-1485):
      - itertools.cycle(ALL_THERMAL_PROMPTS) with 5s inter-request gap.
      - Background GpuSampler + VllmMetricsSampler at 5s cadence.
      - Per-request: one row in responses.jsonl, one in prompts_used.jsonl.

    Post-loop (§9.6 lines 1482-1485):
      - Stop samplers, dump dmesg tail, compute_floors, write summary.json.
    """
    profile_path = Path(profile_path)
    serving, _harness, profile_ref = load_profile(profile_path)
    served_model = serving.engine.served_model_name

    # Pre-replay gate (1): corpus audit
    if require_audit_pass:
        audit = audit_corpus()
        if not audit.passes:
            raise RuntimeError(
                f"thermal replay aborted: corpus audit FAIL (§9.5): {audit.failures}"
            )

    run_id = new_run_id()
    layout = EmmyRunLayout(base_dir=base_runs_dir, run_id=run_id, kind="thermal")
    layout.run_dir.mkdir(parents=True, exist_ok=True)

    # Pre-replay gates (2-4): canaries
    ok_sp, _sp_text = run_sp_ok(base_url, served_model)
    if not ok_sp:
        raise RuntimeError(
            "thermal replay aborted: SP_OK canary failed before replay (§9.6 gate)"
        )
    ok_tool, _tool_msg = run_tool_call(
        base_url, served_model, load_default_tool_schema()
    )
    if not ok_tool:
        raise RuntimeError(
            "thermal replay aborted: tool_call canary failed before replay "
            "(§9.6 gate)"
        )
    ok_gen, _gen_data, _gen_elapsed = run_generate(base_url, served_model)
    if not ok_gen:
        raise RuntimeError(
            "thermal replay aborted: generate canary failed before replay "
            "(§9.6 gate)"
        )

    # Start background samplers — share the same t_start for consistent
    # ``t_elapsed`` filtering at floor-compute time.
    t_start = time.monotonic()
    gpu_sampler = GpuSampler(
        layout.gpu_samples_path, sample_interval_s, t_start=t_start
    )
    vllm_sampler = VllmMetricsSampler(
        layout.vllm_metrics_path, base_url, sample_interval_s, t_start=t_start
    )
    gpu_sampler.start()
    vllm_sampler.start()

    try:
        corpus_iter = itertools.cycle(ALL_THERMAL_PROMPTS)
        while time.monotonic() - t_start < target_wall_time_s:
            prompt = next(corpus_iter)
            t_req_start = time.monotonic()
            try:
                r = httpx.post(
                    f"{base_url}/v1/chat/completions",
                    json={
                        "model": served_model,
                        "messages": [
                            {"role": "user", "content": prompt.prompt},
                        ],
                        "temperature": 0.2,
                        "max_tokens": prompt.max_tokens,
                        "stream": False,
                        # Consistent with sp_ok/generate — isolate decode
                        # throughput from thinking-mode behavior.
                        "chat_template_kwargs": {"enable_thinking": False},
                    },
                    timeout=600.0,
                )
                r.raise_for_status()
                data = r.json()
                n_tokens = int(
                    data.get("usage", {}).get("completion_tokens", 0)
                )
                prompt_tokens = int(
                    data.get("usage", {}).get("prompt_tokens", 0)
                )
                duration_s = time.monotonic() - t_req_start
                append_jsonl_atomic(
                    layout.responses_path,
                    {
                        "task_id": prompt.task_id,
                        "category": prompt.category,
                        "t_start": round(t_req_start - t_start, 3),
                        "duration_s": round(duration_s, 3),
                        "tokens_out": n_tokens,
                        "prompt_tokens": prompt_tokens,
                        "tokens_per_second": (
                            round(n_tokens / duration_s, 2)
                            if duration_s > 0 and n_tokens > 0
                            else 0.0
                        ),
                    },
                )
                append_jsonl_atomic(
                    layout.prompts_used_path,
                    {
                        "t_elapsed": round(t_req_start - t_start, 3),
                        "task_id": prompt.task_id,
                        "category": prompt.category,
                    },
                )
            except Exception as e:
                append_jsonl_atomic(
                    layout.responses_path,
                    {
                        "task_id": prompt.task_id,
                        "t_start": round(time.monotonic() - t_start, 3),
                        "error": str(e)[:500],
                    },
                )
            time.sleep(inter_request_gap_s)
    finally:
        gpu_sampler.stop()
        vllm_sampler.stop()
        gpu_sampler.join(timeout=10)
        vllm_sampler.join(timeout=10)

    # Snapshot dmesg tail for OOM detection in compute_floors().
    try:
        out = subprocess.check_output(
            ["dmesg", "-T", "--since", "2 hours ago"],
            timeout=30,
            stderr=subprocess.DEVNULL,
        ).decode(errors="replace")
        write_text_atomic(layout.dmesg_tail_path, out)
    except Exception:
        write_text_atomic(layout.dmesg_tail_path, "(dmesg unavailable)\n")

    summary = compute_floors(layout.run_dir)
    summary["profile_id"] = profile_ref.id
    summary["profile_version"] = profile_ref.version
    summary["profile_hash"] = profile_ref.hash
    summary["target_wall_time_s"] = int(target_wall_time_s)
    summary["actual_wall_time_s"] = round(time.monotonic() - t_start, 1)
    summary["run_id"] = run_id
    write_json_atomic(layout.summary_path, summary)
    return layout.run_dir


def compute_floors(run_dir: Path) -> dict:
    """Compute the §9.7 hour-2 floor summary from a run dir's JSONL artifacts.

    Returns a dict with the 7 fields from §9.7:
      gpu_clock_p5_hour2_mhz, gpu_clock_p50_hour2_mhz, gpu_temp_p95_hour2_c,
      decode_throughput_p50_hour2_tokps, decode_throughput_p1_hour2_tokps,
      preemptions_hour2, oom_events.
    """
    run_dir = Path(run_dir)
    gpu_samples = [
        s
        for s in _load_jsonl(run_dir / "gpu_samples.jsonl")
        if s.get("t_elapsed", 0) >= 3600
    ]
    responses = [
        r
        for r in _load_jsonl(run_dir / "responses.jsonl")
        if r.get("t_start", 0) >= 3600 and "error" not in r
    ]
    vllm_metrics = _load_jsonl(run_dir / "vllm_metrics.jsonl")

    gpu_clocks = sorted(s["gpu_clock_mhz"] for s in gpu_samples if "gpu_clock_mhz" in s)
    gpu_temps = sorted(s["gpu_temp_c"] for s in gpu_samples if "gpu_temp_c" in s)
    throughputs = sorted(
        r["tokens_per_second"]
        for r in responses
        if r.get("tokens_per_second", 0) > 0
    )

    # Preemption delta over hour 2: last - first vLLM metric row within window.
    h2_metrics = [m for m in vllm_metrics if m.get("t_elapsed", 0) >= 3600]
    preempt_h2 = 0
    if h2_metrics:
        first = h2_metrics[0].get("vllm:num_preemptions_total", 0)
        last = h2_metrics[-1].get("vllm:num_preemptions_total", 0)
        preempt_h2 = int(last - first)

    # OOM lines in the committed dmesg tail.
    oom = 0
    dmesg = run_dir / "dmesg_tail.txt"
    if dmesg.exists():
        text = dmesg.read_text(encoding="utf-8", errors="replace").lower()
        oom = sum(
            1
            for line in text.splitlines()
            if ("oom" in line or "out of memory" in line or "killed process" in line)
        )

    return {
        "gpu_clock_p5_hour2_mhz": round(_percentile(gpu_clocks, 5), 1),
        "gpu_clock_p50_hour2_mhz": round(_percentile(gpu_clocks, 50), 1),
        "gpu_temp_p95_hour2_c": round(_percentile(gpu_temps, 95), 1),
        "decode_throughput_p50_hour2_tokps": round(_percentile(throughputs, 50), 2),
        "decode_throughput_p1_hour2_tokps": round(_percentile(throughputs, 1), 2),
        "preemptions_hour2": preempt_h2,
        "oom_events": oom,
    }


def assert_floors(run_dir: Path, profile_path: Path) -> int:
    """Re-run assertion: compare computed floors to PROFILE_NOTES.md recorded.

    Exit codes:
      0  all floors pass (or recorded floors absent → nothing to assert)
      1  hard gate fail (preempt/OOM) or tolerance violation

    Tolerances (§9.7):
      clock_p5 >= 0.95 × recorded
      decode_p50 >= 0.93 × recorded
      decode_p1 >= 0.90 × recorded
      preemptions_hour2 == 0 (hard gate)
      oom_events == 0 (hard gate)
    """
    run_dir = Path(run_dir)
    profile_path = Path(profile_path)
    computed = compute_floors(run_dir)

    notes_path = profile_path / "PROFILE_NOTES.md"
    if not notes_path.exists():
        print(
            f"PROFILE_NOTES.md not found at {notes_path}; cannot assert floors",
            file=sys.stderr,
        )
        return 1
    notes = notes_path.read_text(encoding="utf-8")
    if not notes.startswith("---"):
        print(
            "PROFILE_NOTES.md has no YAML frontmatter; cannot assert floors",
            file=sys.stderr,
        )
        return 1
    end = notes.find("\n---", 3)
    if end < 0:
        print(
            "PROFILE_NOTES.md frontmatter is not terminated; cannot assert floors",
            file=sys.stderr,
        )
        return 1
    fm = yaml.safe_load(notes[3:end]) or {}
    recorded = fm.get("measured_values", {}) or {}

    failures: list[str] = []
    # Hard gates (always asserted).
    if computed["preemptions_hour2"] != 0:
        failures.append(
            f"preemptions_hour2={computed['preemptions_hour2']} (hard gate: must be 0)"
        )
    if computed["oom_events"] != 0:
        failures.append(
            f"oom_events={computed['oom_events']} (hard gate: must be 0)"
        )

    # Tolerance gates (only if the recorded floor is non-null).
    r_clock = recorded.get("gpu_clock_p5_hour2_mhz")
    if r_clock not in (None, 0, "null") and isinstance(r_clock, (int, float)):
        floor = r_clock * CLOCK_P5_TOLERANCE
        if computed["gpu_clock_p5_hour2_mhz"] < floor:
            failures.append(
                f"gpu_clock_p5 {computed['gpu_clock_p5_hour2_mhz']:.0f} < "
                f"recorded {r_clock:.0f} * {CLOCK_P5_TOLERANCE}"
            )

    r_p50 = recorded.get("decode_throughput_p50_hour2_tokps")
    if r_p50 not in (None, 0, "null") and isinstance(r_p50, (int, float)):
        floor = r_p50 * DECODE_P50_TOLERANCE
        if computed["decode_throughput_p50_hour2_tokps"] < floor:
            failures.append(
                f"decode_p50 {computed['decode_throughput_p50_hour2_tokps']:.1f} < "
                f"recorded {r_p50:.1f} * {DECODE_P50_TOLERANCE}"
            )

    r_p1 = recorded.get("decode_throughput_p1_hour2_tokps")
    if r_p1 not in (None, 0, "null") and isinstance(r_p1, (int, float)):
        floor = r_p1 * DECODE_P1_TOLERANCE
        if computed["decode_throughput_p1_hour2_tokps"] < floor:
            failures.append(
                f"decode_p1 {computed['decode_throughput_p1_hour2_tokps']:.1f} < "
                f"recorded {r_p1:.1f} * {DECODE_P1_TOLERANCE}"
            )

    if failures:
        for f in failures:
            print(f"FLOOR FAIL: {f}", file=sys.stderr)
        return 1
    print("All floors pass", file=sys.stderr)
    return 0


def record_floors_first_run(run_dir: Path, profile_path: Path) -> None:
    """First-run helper: write computed floors into PROFILE_NOTES.md measured_values.

    Then recompute profile.yaml.hash via ``emmy profile hash --write`` so the
    manifest stays synchronised (PROFILE-06 / Plan 01-02 invariant).
    """
    run_dir = Path(run_dir)
    profile_path = Path(profile_path)
    computed = compute_floors(run_dir)
    notes_path = profile_path / "PROFILE_NOTES.md"
    text = notes_path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise RuntimeError(
            f"expected YAML frontmatter at top of {notes_path}; refusing to rewrite"
        )
    end = text.find("\n---", 3)
    if end < 0:
        raise RuntimeError(
            f"unterminated YAML frontmatter in {notes_path}"
        )
    fm = yaml.safe_load(text[3:end]) or {}
    mv = fm.setdefault("measured_values", {}) or {}
    mv["gpu_clock_p5_hour2_mhz"] = int(round(computed["gpu_clock_p5_hour2_mhz"]))
    mv["gpu_clock_p50_hour2_mhz"] = int(round(computed["gpu_clock_p50_hour2_mhz"]))
    mv["decode_throughput_p50_hour2_tokps"] = round(
        computed["decode_throughput_p50_hour2_tokps"], 1
    )
    mv["decode_throughput_p1_hour2_tokps"] = round(
        computed["decode_throughput_p1_hour2_tokps"], 1
    )
    fm["measured_values"] = mv

    new_fm = yaml.safe_dump(fm, sort_keys=False).strip()
    body = text[end + len("\n---"):]
    write_text_atomic(notes_path, f"---\n{new_fm}\n---{body}")

    # Recompute profile hash (best-effort — see the analogous rationale in
    # kv_finder/bisect.py; hash drift is CI's problem, not ours).
    try:
        subprocess.run(
            ["uv", "run", "emmy", "profile", "hash", str(profile_path), "--write"],
            check=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        pass


def main(argv: list[str] | None = None) -> int:
    """CLI entry: ``scripts/thermal_replay.py --profile PATH [--target-wall-time-s N]``.

    Flags:
      --profile              required bundle dir
      --target-wall-time-s   default 7200 (2 hours); use smaller for smoke testing
      --record-floors        first-run: write computed floors into PROFILE_NOTES.md
      --assert-floors        compare to recorded floors; fail if violated
      --skip-audit           bypass the §9.5 audit gate (testing only)
      --runs-dir             base dir for run artifacts (default: ./runs)
      --base-url             vLLM loopback URL (default: http://127.0.0.1:8002)

    Exit codes:
      0  replay + requested floor operations succeeded
      1  pre-replay gate failed or --assert-floors violation
    """
    ap = argparse.ArgumentParser(
        description="2-hour thermal replay harness (D-14/D-15)",
    )
    ap.add_argument("--profile", required=True)
    ap.add_argument("--target-wall-time-s", type=int, default=7200)
    ap.add_argument("--inter-request-gap-s", type=float, default=5.0)
    ap.add_argument("--sample-interval-s", type=float, default=5.0)
    ap.add_argument("--base-url", default="http://127.0.0.1:8002")
    ap.add_argument("--runs-dir", default="runs")
    ap.add_argument(
        "--record-floors",
        action="store_true",
        help="first-run: write computed floors into PROFILE_NOTES.md",
    )
    ap.add_argument(
        "--assert-floors",
        action="store_true",
        help="compare measured floors to PROFILE_NOTES.md recorded; fail if violated",
    )
    ap.add_argument(
        "--skip-audit",
        action="store_true",
        help="bypass the pre-replay corpus audit gate (testing only)",
    )
    args = ap.parse_args(argv)

    try:
        run_dir = run_replay(
            Path(args.profile),
            target_wall_time_s=args.target_wall_time_s,
            inter_request_gap_s=args.inter_request_gap_s,
            sample_interval_s=args.sample_interval_s,
            base_url=args.base_url,
            base_runs_dir=Path(args.runs_dir),
            require_audit_pass=not args.skip_audit,
        )
    except RuntimeError as e:
        print(f"thermal replay error: {e}", file=sys.stderr)
        return 1
    print(f"thermal replay complete: {run_dir}")

    if args.record_floors:
        record_floors_first_run(run_dir, Path(args.profile))
        print(
            f"recorded floors in {args.profile}/PROFILE_NOTES.md; hash recomputed"
        )

    if args.assert_floors:
        return assert_floors(run_dir, Path(args.profile))
    return 0


if __name__ == "__main__":
    sys.exit(main())
