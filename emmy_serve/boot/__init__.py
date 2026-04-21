"""Boot orchestration: health probe + docker-args renderer + SC-1 throughput sweep.

RESEARCH.md §7.1 (wait_for_vllm) and §14 (start_emmy.sh contract).
Plan 01-06 (SC-1 gap closure): throughput sweep library.
"""
from __future__ import annotations

from .probe import wait_for_vllm
from .throughput import (
    SWEEP_CANDIDATES,
    CandidateKnob,
    ThroughputMeasurement,
    decide_winner,
    measure_warm_throughput,
)

__all__ = [
    "wait_for_vllm",
    "CandidateKnob",
    "ThroughputMeasurement",
    "SWEEP_CANDIDATES",
    "measure_warm_throughput",
    "decide_winner",
]
