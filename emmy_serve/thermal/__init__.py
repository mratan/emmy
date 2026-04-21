"""Thermal replay + corpus + D-14 audit.

This subpackage owns the 2-hour thermal validation loop (D-14/D-15) and the
corpus that drives it. The corpus is curated + audited against RESEARCH.md
§9.5 thresholds so the thermal run exercises real coding-agent shapes rather
than a naive loop of the prior-repo's 5 functional prompts.

See:
- corpus.py — ThermalPrompt + PRIOR_CODING_TASKS + SYNTHETIC_AGENT_PROMPTS +
  TOOL_CALL_SEQUENCE + ALL_THERMAL_PROMPTS
- audit.py — audit_corpus() per §9.5 thresholds; `python -m emmy_serve.thermal.audit`
- sampler.py — GpuSampler + VllmMetricsSampler background threads
- replay.py — 2-hour replay harness + compute_floors + assert_floors
"""
from __future__ import annotations

from .audit import AuditReport, audit_corpus
from .corpus import (
    ALL_THERMAL_PROMPTS,
    PRIOR_CODING_TASKS,
    SYNTHETIC_AGENT_PROMPTS,
    TOOL_CALL_SEQUENCE,
    ThermalPrompt,
    get_prompt,
)
from .replay import (
    assert_floors,
    compute_floors,
    record_floors_first_run,
    run_replay,
)
from .sampler import GpuSampler, VllmMetricsSampler

__all__ = [
    "ThermalPrompt",
    "PRIOR_CODING_TASKS",
    "SYNTHETIC_AGENT_PROMPTS",
    "TOOL_CALL_SEQUENCE",
    "ALL_THERMAL_PROMPTS",
    "get_prompt",
    "AuditReport",
    "audit_corpus",
    "run_replay",
    "compute_floors",
    "assert_floors",
    "record_floors_first_run",
    "GpuSampler",
    "VllmMetricsSampler",
]
