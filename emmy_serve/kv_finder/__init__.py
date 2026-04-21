"""KV-budget automated finder (D-13, SERVE-08).

Pitfall #1 discipline (CLAUDE.md): the only legitimate way to get a
committed ``gpu_memory_utilization`` number is the automated bisection
finder here — never a formula, never "it ran for 30 seconds without
crashing". A PR that touches ``serving.yaml.engine.gpu_memory_utilization``
without a matching ``runs/<iso>-kv-finder/`` artifact reference is a
code-review red flag (Plan 05 CI catches the hash drift).

Layout (per 01-PATTERNS.md Pattern F):
  metrics.py      — Prometheus text parser (reads /metrics)
  load_driver.py  — mixed-prefill load subset of the thermal corpus
  bisect.py       — the actual bisection algorithm (§8)

The entry point is ``python -m emmy_serve.kv_finder.bisect --profile PATH``
or the shim ``scripts/find_kv_budget.py``. Both are callable on any box
with a live vLLM at http://127.0.0.1:8002/; the finder does NOT own the
container lifecycle by default — it bisects `gpu_memory_utilization` and
calls ``./scripts/start_emmy.sh`` between iterations to restart vLLM.
"""
from __future__ import annotations

from .bisect import FinderState, main, run_finder
from .load_driver import drive_load
from .metrics import parse_preemption_metrics, scrape_metrics

__all__ = [
    "run_finder",
    "main",
    "FinderState",
    "parse_preemption_metrics",
    "scrape_metrics",
    "drive_load",
]
