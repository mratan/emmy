"""emmy_serve.swap — atomic profile-swap primitive (Phase 4 PROFILE-08) +
sidecar control plane (Phase 04.2).

Exports (eager):
    PreflightError, PreflightResult, run_preflight, emit, STOPPING, LOADING,
    WARMUP, READY

Exports (lazy via PEP 562 __getattr__ — avoids "module found in sys.modules"
RuntimeWarning when running ``python -m emmy_serve.swap.{orchestrator,
controller}``):
    swap_profile, rollback                                         # Phase 4
    StateMachine, SidecarState, ALLOWED_TRANSITIONS,               # Phase 04.2 state.py
        InvalidTransitionError
    fetch_vllm_metrics_cached, sample_gpu_temp_cached              # Phase 04.2 sidecar_metrics.py
    run_orchestrator_subprocess                                    # Phase 04.2 orchestrator_runner.py
    app, run, StartRequest, StopRequest, SwapRequest,              # Phase 04.2 controller.py
        StatusResponse

D-04 LOCKED: swap failure ⇒ clear error + prior model still loaded.
D-05 LOCKED: validate-first-then-stop strategy.
D-02 LOCKED: four-phase progress labels emitted verbatim on stdout as
one JSON line per phase transition: "stopping vLLM", "loading weights"
(+ optional pct), "warmup", "ready".
D-07 LOCKED (Phase 04.2): six-state sidecar FSM gates every handler.

The TS harness (`packages/emmy-ux/src/profile-swap-runner.ts`) parses the
JSON-per-line stdout and surfaces phases to the TUI footer.
"""
from __future__ import annotations

# Orchestrator, rollback, state, controller, orchestrator_runner, sidecar_metrics
# are NOT eagerly imported — running ``python -m emmy_serve.swap.<sub>`` triggers
# a "module found in sys.modules" RuntimeWarning if __init__ eager-imports the
# submodule. Users can `from emmy_serve.swap.<sub> import X` directly, or
# `from emmy_serve.swap import X` via the lazy __getattr__ below.
from .preflight import PreflightError, PreflightResult, run_preflight
from .progress import LOADING, READY, STOPPING, WARMUP, emit


def __getattr__(name: str):  # PEP 562 lazy attribute access
    # Phase 4 (existing).
    if name == "swap_profile":
        from .orchestrator import swap_profile

        return swap_profile
    if name == "rollback":
        from .rollback import rollback

        return rollback
    # Phase 04.2 — state.py.
    if name in {"StateMachine", "SidecarState", "ALLOWED_TRANSITIONS", "InvalidTransitionError"}:
        from .state import (
            ALLOWED_TRANSITIONS,
            InvalidTransitionError,
            SidecarState,
            StateMachine,
        )

        return {
            "StateMachine": StateMachine,
            "SidecarState": SidecarState,
            "ALLOWED_TRANSITIONS": ALLOWED_TRANSITIONS,
            "InvalidTransitionError": InvalidTransitionError,
        }[name]
    raise AttributeError(f"module 'emmy_serve.swap' has no attribute {name!r}")


__all__ = [
    # Eager (Phase 4).
    "PreflightError",
    "PreflightResult",
    "run_preflight",
    "emit",
    "STOPPING",
    "LOADING",
    "WARMUP",
    "READY",
    # Lazy (Phase 4).
    "swap_profile",
    "rollback",
    # Lazy (Phase 04.2 — state.py).
    "StateMachine",
    "SidecarState",
    "ALLOWED_TRANSITIONS",
    "InvalidTransitionError",
]
