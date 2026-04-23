"""emmy_serve.swap — atomic profile-swap primitive (Phase 4 PROFILE-08).

Exports:
    swap_profile, rollback, emit, run_preflight, PreflightResult

D-04 LOCKED: swap failure ⇒ clear error + prior model still loaded.
D-05 LOCKED: validate-first-then-stop strategy.
D-02 LOCKED: four-phase progress labels emitted verbatim on stdout as
one JSON line per phase transition: "stopping vLLM", "loading weights"
(+ optional pct), "warmup", "ready".

The TS harness (`packages/emmy-ux/src/profile-swap-runner.ts`) parses the
JSON-per-line stdout and surfaces phases to the TUI footer.
"""
from __future__ import annotations

from .preflight import PreflightError, PreflightResult, run_preflight
from .progress import LOADING, READY, STOPPING, WARMUP, emit

__all__ = [
    "PreflightError",
    "PreflightResult",
    "run_preflight",
    "emit",
    "STOPPING",
    "LOADING",
    "WARMUP",
    "READY",
]
