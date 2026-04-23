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

# Orchestrator and rollback are NOT eagerly imported — running
# ``python -m emmy_serve.swap.orchestrator`` triggers a "module found in
# sys.modules" RuntimeWarning if __init__ eager-imports the submodule. Users
# can `from emmy_serve.swap.orchestrator import swap_profile` directly, or
# `from emmy_serve.swap import swap_profile` via the lazy __getattr__ below.
from .preflight import PreflightError, PreflightResult, run_preflight
from .progress import LOADING, READY, STOPPING, WARMUP, emit


def __getattr__(name: str):  # PEP 562 lazy attribute access
    if name == "swap_profile":
        from .orchestrator import swap_profile

        return swap_profile
    if name == "rollback":
        from .rollback import rollback

        return rollback
    raise AttributeError(f"module 'emmy_serve.swap' has no attribute {name!r}")


__all__ = [
    "swap_profile",
    "rollback",
    "PreflightError",
    "PreflightResult",
    "run_preflight",
    "emit",
    "STOPPING",
    "LOADING",
    "WARMUP",
    "READY",
]
