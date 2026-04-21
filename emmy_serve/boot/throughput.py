"""SC-1 throughput sweep library (Plan 01-06, PROFILE_NOTES.md §'SC-1 throughput gap').

This module is unit-testable WITHOUT hardware. `measure_warm_throughput` takes
an already-running ``base_url`` and runs N warm decode samples + the full canary
suite; `SWEEP_CANDIDATES` enumerates the K0 baseline + 4 PROFILE_NOTES.md-documented
knobs; `decide_winner` encodes the pitfall-#5 discipline ("throughput above floor
AND every canary passes, else NOT a winner — a numerical win with a canary
regression is not a win").

The hardware-dependent orchestrator (boot-per-candidate, tear-down-per-candidate,
results.json writer) lives in ``scripts/throughput_sweep.py``; it imports this
module. See 01-06-PLAN.md for the sweep contract.
"""
from __future__ import annotations

import socket
import statistics
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

# Imports from sibling packages must succeed at module load even in unit tests
# (canary module is already green in Plan 01-03).
from ..canary import run_generate, run_sp_ok, run_tool_call
from ..canary.tool_call import load_default_tool_schema


# --- Dataclasses --------------------------------------------------------------


@dataclass(frozen=True)
class CandidateKnob:
    """One entry in the SWEEP_CANDIDATES manifest.

    Either ``env_overrides`` (layered on top of the container env at boot) OR
    ``serving_yaml_patch`` (mutates serving.yaml; forces a profile rehash during
    that candidate's window) is populated — K4 is the only candidate that takes
    the serving_yaml path; the rest are env knobs.
    """

    id: str
    label: str
    env_overrides: dict[str, str] = field(default_factory=dict)
    serving_yaml_patch: dict[str, Any] | None = None
    notes: str = ""


@dataclass(frozen=True)
class ThroughputMeasurement:
    """Per-candidate measurement record — exactly the shape written to results.json.

    samples_tokps is the raw list of per-request tok/s figures; mean/std/p50 are
    derived so downstream consumers (PROFILE_NOTES.md sweep table generator,
    decide_winner gate) don't re-compute them.

    Every measurement embeds the full canary suite triple (pitfall #5
    discipline). ``error`` is None on success, or a truncated string on failure
    (boot timeout, httpx exception, zero completion_tokens, etc.).
    """

    candidate_id: str
    samples_tokps: list[float]
    mean: float
    std: float
    p50: float
    canary_sp_ok: bool
    canary_tool_call: bool
    canary_generate: bool
    error: str | None
    hardware_id: str
    ts: str


# --- SWEEP_CANDIDATES — verbatim from PROFILE_NOTES.md §'SC-1 throughput gap' ----


SWEEP_CANDIDATES: list[CandidateKnob] = [
    CandidateKnob(
        id="k0-baseline",
        label="baseline (no change)",
        notes=(
            "Control — re-measures the profile unchanged. Required by the sweep's "
            "pitfall-#5 methodology: if k0 doesn't reproduce the documented "
            "48-50 tok/s warm number, any candidate delta is measurement noise."
        ),
    ),
    CandidateKnob(
        id="k1-flashinfer-moe",
        label="VLLM_USE_FLASHINFER_MOE_FP8=1",
        env_overrides={"VLLM_USE_FLASHINFER_MOE_FP8": "1"},
        notes=(
            "PROFILE_NOTES.md §'SC-1 throughput gap' bullet 1: force the "
            "FlashInfer MoE FP8 backend instead of the TRITON fallback vLLM "
            "picked despite the existing VLLM_FLASHINFER_MOE_BACKEND=latency."
        ),
    ),
    CandidateKnob(
        id="k2-cuda-native",
        label="CUDA_FORWARD_COMPATIBLE=0",
        env_overrides={"CUDA_FORWARD_COMPATIBLE": "0"},
        notes=(
            "PROFILE_NOTES.md §'SC-1 throughput gap' bullet 2: NGC 26.03 "
            "runs via the CUDA forward-compat shim (driver 595 on kernel 580), "
            "which may add per-kernel-launch overhead. Exact env-var name is "
            "an approximation from PROFILE_NOTES.md; verify at task-2 runtime "
            "via `docker exec emmy-serve python3 -c 'from vllm import envs; "
            "print(envs.__all__)'` and adjust the override if needed. If the "
            "actual mechanism is a docker-run flag rather than an env var, "
            "the sweep script documents the discovery in results.json.notes."
        ),
    ),
    CandidateKnob(
        id="k3-fp8-mamba-prefix",
        label="VLLM_FP8_MAMBA_PREFIX_CACHING=1",
        env_overrides={"VLLM_FP8_MAMBA_PREFIX_CACHING": "1"},
        notes=(
            "PROFILE_NOTES.md §'SC-1 throughput gap' bullet 3: vLLM 0.17.1+"
            "nvinternal flags an experimental FP8+Mamba prefix-caching path. "
            "Exact env var may differ; verify at task-2 runtime via "
            "`docker exec emmy-serve python3 -c 'from vllm import envs; "
            "print([e for e in envs.__all__ if \"MAMBA\" in e or \"FP8\" in e])'`. "
            "The discovered env name lands in results.json for reproducibility."
        ),
    ),
    CandidateKnob(
        id="k4-reasoning-parser",
        label="engine.reasoning_parser=qwen3 (serving.yaml)",
        serving_yaml_patch={"engine": {"reasoning_parser": "qwen3"}},
        notes=(
            "PROFILE_NOTES.md §'SC-1 throughput gap' bullet 4: set "
            "reasoning_parser=qwen3 so Qwen3.6's thinking tokens are extracted "
            "into a separate field and do not consume decode budget. This is a "
            "serving.yaml field change (not env); it bumps the profile hash for "
            "the duration of this candidate's window. The sweep script restores "
            "serving.yaml + rehashes after each iteration regardless of outcome."
        ),
    ),
]


# --- helpers ------------------------------------------------------------------


def _hardware_id() -> str:
    """Best-effort hostname — never raises (falls back to 'unknown')."""
    try:
        return socket.gethostname()
    except Exception:
        return "unknown"


def _now_iso(ts_epoch: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts_epoch))


# --- measurement --------------------------------------------------------------


def measure_warm_throughput(
    base_url: str,
    model: str,
    *,
    candidate_id: str = "k0-baseline",
    n_samples: int = 3,
    max_tokens: int = 500,
    prompt: str = "Count to 100.",
    warmup_discard: int = 1,
    timeout_s: float = 60.0,
) -> ThroughputMeasurement:
    """Measure warm decode tok/s against a live vLLM endpoint + run the canary suite.

    Methodology (matches Phase C warm-500-token measurement + pitfall-#5 discipline):

    1. Run ``warmup_discard`` decode requests and throw the results away (CUDA
       graph warmup + FlashInfer first-call costs dominate cold decodes).
    2. Run ``n_samples`` decode requests, each computing
       ``completion_tokens / elapsed_wall`` via ``time.perf_counter``.
    3. Run run_sp_ok + run_tool_call + run_generate canaries against the same
       endpoint and record booleans. Any canary regression is surfaced in
       ``decide_winner`` as an automatic disqualification.

    The payload shape matches ``tests/integration/test_boot.py::test_throughput_floor``
    verbatim (``temperature=0.0``, ``chat_template_kwargs={"enable_thinking": False}``,
    prompt ``"Count to 100."``) with ``max_tokens=500`` (Phase C warm-500
    measurement, not the 100-token smoke floor).

    On any exception during the measurement loop, returns a
    ``ThroughputMeasurement`` with ``error`` populated and every canary False.
    The sweep harness treats this as a non-fatal candidate failure and keeps
    going.
    """
    ts = _now_iso()
    hw = _hardware_id()
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.0,
        "chat_template_kwargs": {"enable_thinking": False},
    }

    try:
        # Warm-up: discard the first warmup_discard calls (CUDA graph / FlashInfer
        # first-call overhead dominates and would bias the sample mean).
        for _ in range(max(0, warmup_discard)):
            httpx.post(url, json=payload, timeout=timeout_s)

        # Measurement: n_samples real decodes.
        samples: list[float] = []
        for _ in range(n_samples):
            t0 = time.perf_counter()
            r = httpx.post(url, json=payload, timeout=timeout_s)
            elapsed = max(time.perf_counter() - t0, 1e-6)
            r.raise_for_status()
            body = r.json()
            ct = int((body.get("usage") or {}).get("completion_tokens", 0) or 0)
            if ct <= 0:
                raise RuntimeError(
                    f"completion_tokens={ct}; unusable sample (model may be "
                    f"emitting only thinking or refusal tokens)"
                )
            samples.append(ct / elapsed)

        # Canary suite — full triple per pitfall-#5 discipline. Each canary
        # has its own timeout handling; a canary HTTP failure is treated as a
        # canary regression, not a measurement error.
        try:
            ok_sp, _ = run_sp_ok(base_url, model)
        except Exception:
            ok_sp = False
        try:
            ok_tc, _ = run_tool_call(base_url, model, load_default_tool_schema())
        except Exception:
            ok_tc = False
        try:
            ok_gen, _, _ = run_generate(base_url, model)
        except Exception:
            ok_gen = False

        mean = statistics.fmean(samples) if samples else 0.0
        std = statistics.pstdev(samples) if len(samples) >= 2 else 0.0
        sorted_s = sorted(samples)
        p50 = sorted_s[len(sorted_s) // 2] if sorted_s else 0.0

        return ThroughputMeasurement(
            candidate_id=candidate_id,
            samples_tokps=[round(s, 3) for s in samples],
            mean=round(mean, 2),
            std=round(std, 3),
            p50=round(p50, 2),
            canary_sp_ok=bool(ok_sp),
            canary_tool_call=bool(ok_tc),
            canary_generate=bool(ok_gen),
            error=None,
            hardware_id=hw,
            ts=ts,
        )
    except Exception as e:
        return ThroughputMeasurement(
            candidate_id=candidate_id,
            samples_tokps=[],
            mean=0.0,
            std=0.0,
            p50=0.0,
            canary_sp_ok=False,
            canary_tool_call=False,
            canary_generate=False,
            error=str(e)[:500],
            hardware_id=hw,
            ts=ts,
        )


# --- winner gate --------------------------------------------------------------


def decide_winner(
    measurements: list[ThroughputMeasurement],
    *,
    floor_tokps: float = 60.0,
) -> str | None:
    """Return the id of the first non-baseline candidate that (a) errored out
    is False, (b) mean >= floor_tokps, and (c) ALL three canaries passed.

    The pitfall-#5 invariant: a numerical throughput increase with ANY canary
    regression is NOT a win. Encoded here rather than in the sweep script so
    the unit tests can assert this property without running the harness.

    k0-baseline is excluded from winner consideration — it's a control, not a
    candidate. If no non-baseline candidate qualifies, returns None and the
    sweep script writes the 'accept-as-architectural' disposition.
    """
    for m in measurements:
        if m.candidate_id == "k0-baseline":
            continue
        if m.error is not None:
            continue
        if m.mean < floor_tokps:
            continue
        if not (m.canary_sp_ok and m.canary_tool_call and m.canary_generate):
            continue
        return m.candidate_id
    return None


__all__ = [
    "CandidateKnob",
    "ThroughputMeasurement",
    "SWEEP_CANDIDATES",
    "measure_warm_throughput",
    "decide_winner",
]
