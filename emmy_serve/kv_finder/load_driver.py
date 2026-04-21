"""KV-finder load driver — RESEARCH.md §8 "Load driver during bisection".

Uses a subset of the thermal corpus biased toward mixed prefill sizes (small
CODE_* + 10K / 20K / 30K agent_* prompts) so each 10-minute finder iteration
actually stresses KV cache. The full thermal corpus is too large to cycle
inside a 10-minute iteration; the subset runs one full pass in ~2-4 minutes
at current throughput (~50 tok/s) so each iteration gets 3-5 complete cycles.

Concurrency: single-request (§8 line 1308 — matches daily-driver shape; KV
pressure comes from history accumulation, not concurrent batching).
"""
from __future__ import annotations

import time

import httpx

from ..thermal.corpus import ALL_THERMAL_PROMPTS, ThermalPrompt


# Finder subset: 5 small-prefill prompts (cache-line exercise) + 3 large-prefill
# prompts (KV stress). Order is not load-bearing — drive_load() iterates in
# declared order and loops until the duration is reached.
_FINDER_SUBSET_IDS = frozenset(
    {
        "code_01",
        "code_02",
        "code_03",
        "code_04",
        "code_05",
        "agent_10k_refactor",
        "agent_20k_multifile",
        "agent_30k_history",
    }
)


def _finder_subset() -> list[ThermalPrompt]:
    """Return the ThermalPrompts the finder drives (mixed prefill sizes)."""
    return [p for p in ALL_THERMAL_PROMPTS if p.task_id in _FINDER_SUBSET_IDS]


def drive_load(
    base_url: str, served_model_name: str, duration_s: int
) -> dict:
    """Loop the finder subset against vLLM until ``duration_s`` elapses.

    Returns a summary dict with p50/p99 latency, throughput, and request
    count — these feed the iteration log (summary-level statistics) and
    the optional p99-latency failure signal (§8 line 1301).

    If ``duration_s == 0`` the function returns a zero-filled summary
    without making any HTTP call (makes the finder unit-testable without
    a live endpoint).
    """
    subset = _finder_subset()
    latencies: list[float] = []
    tokens_out = 0
    n_req = 0
    t_start = time.monotonic()
    if duration_s <= 0 or not subset:
        return {
            "n_requests": 0,
            "tokens_generated": 0,
            "p50_latency_ms": 0,
            "p99_latency_ms": 0,
            "duration_s": 0.0,
        }
    while time.monotonic() - t_start < duration_s:
        for p in subset:
            if time.monotonic() - t_start >= duration_s:
                break
            payload = {
                "model": served_model_name,
                "messages": [
                    {"role": "user", "content": p.prompt},
                ],
                "temperature": 0.2,
                # Cap decode at a sensible budget — the finder cares about
                # prefill pressure + KV churn, not long-output correctness.
                "max_tokens": min(p.max_tokens, p.expected_decode_tokens + 500),
                "stream": False,
                # Disable Qwen3.6 thinking — see sp_ok.py for the rationale.
                "chat_template_kwargs": {"enable_thinking": False},
            }
            t0 = time.monotonic()
            try:
                r = httpx.post(
                    f"{base_url}/v1/chat/completions",
                    json=payload,
                    timeout=300.0,
                )
                r.raise_for_status()
                data = r.json()
                tokens_out += int(data.get("usage", {}).get("completion_tokens", 0))
            except Exception:
                # Failed requests still count toward iteration duration; the
                # finder reads preemption deltas independently. A 5xx here is
                # noise unless it correlates with a preemption delta.
                pass
            latencies.append(time.monotonic() - t0)
            n_req += 1
    latencies.sort()

    def _pct(values: list[float], p: float) -> int:
        if not values:
            return 0
        idx = max(0, min(len(values) - 1, int(len(values) * p / 100)))
        return int(values[idx] * 1000)

    return {
        "n_requests": n_req,
        "tokens_generated": tokens_out,
        "p50_latency_ms": _pct(latencies, 50),
        "p99_latency_ms": _pct(latencies, 99),
        "duration_s": round(time.monotonic() - t_start, 1),
    }


__all__ = ["drive_load", "_finder_subset"]
