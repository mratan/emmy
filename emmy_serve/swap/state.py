"""Sidecar lifecycle state machine — D-07 LOCKED transition table (Phase 04.2).

Owns the canonical 6-state model the FastAPI sidecar (`controller.py`) reports
through `/status` and that gates every `/start`, `/stop`, `/profile/swap`
handler entry.

D-07 LOCKED transition table (CONTEXT.md §D-07):
    stopped  → {starting, error}
    starting → {ready, error}
    ready    → {starting, swapping, draining, error}
    swapping → {ready, error}
    draining → {stopped, error}
    error    → {starting}                # recovery from error requires /start

Phase 04.2 follow-up: READY → STARTING added for the "vLLM died externally"
recovery path. Operator may `docker stop emmy-serve` (or container OOM, or
host reboot mid-session) — the sidecar's `state` stays READY until the next
/start, which now detects vllm_up=false and transitions READY → STARTING to
recreate the container. Without this, /start would either short-circuit
(misreporting success) or get stuck on InvalidTransitionError.

Any state → ERROR is implicit (always allowed) — sidecar handlers must be able
to record an error from any in-flight operation without first transitioning
through an "intermediate" state.

Wire-format invariant (C-06): the `.value` strings of `SidecarState` are the
exact lowercase tokens that appear in `/status` JSON `state` field and in SSE
data lines. Renaming an enum value would break the Plan 03 TS-side
`sidecar-status-client.ts` schema mirror.

Concurrency: uvicorn handlers run concurrently inside a single event loop;
StateMachine.transition_to is async + asyncio.Lock-protected so two handlers
cannot race a transition (e.g. /start and /profile/swap both attempting
READY → SWAPPING simultaneously would otherwise produce torn state).
"""
from __future__ import annotations

import asyncio
from enum import Enum


class SidecarState(Enum):
    """Six-state lifecycle of the sidecar process (D-07 LOCKED).

    `.value` tokens are the wire format — see module docstring.
    """

    STOPPED = "stopped"
    STARTING = "starting"
    READY = "ready"
    SWAPPING = "swapping"
    DRAINING = "draining"
    ERROR = "error"


# D-07 LOCKED transition table. Sibling-to-class module-level constant
# mirrors progress.py's STOPPING/LOADING/WARMUP/READY pattern (Phase 4 D-02).
# Any-state → ERROR is allowed implicitly (transition_to checks for it before
# consulting this table).
ALLOWED_TRANSITIONS: dict[SidecarState, set[SidecarState]] = {
    SidecarState.STOPPED:  {SidecarState.STARTING, SidecarState.ERROR},
    SidecarState.STARTING: {SidecarState.READY, SidecarState.ERROR},
    # READY → STARTING: Phase 04.2 follow-up — see module docstring for the
    # "vLLM died externally" recovery rationale.
    SidecarState.READY:    {SidecarState.STARTING, SidecarState.SWAPPING, SidecarState.DRAINING, SidecarState.ERROR},
    SidecarState.SWAPPING: {SidecarState.READY, SidecarState.ERROR},
    SidecarState.DRAINING: {SidecarState.STOPPED, SidecarState.ERROR},
    SidecarState.ERROR:    {SidecarState.STARTING},
}


class InvalidTransitionError(Exception):
    """Raised when a state transition violates the D-07 LOCKED table.

    Carries both `frm` and `to` as attributes so handler-layer error logging
    can include both endpoints of the attempted transition without re-parsing
    the message.
    """

    def __init__(self, frm: SidecarState, to: SidecarState) -> None:
        super().__init__(f"invalid transition: {frm.value} -> {to.value}")
        self.frm = frm
        self.to = to


class StateMachine:
    """Single-process, asyncio-safe lifecycle FSM.

    Initial state: STOPPED. transition_to() raises InvalidTransitionError on
    a disallowed move; any-state → ERROR is always permitted (hardware
    failure / orchestrator crash needs an unconditional escape hatch).
    """

    def __init__(self) -> None:
        self._state: SidecarState = SidecarState.STOPPED
        self._lock = asyncio.Lock()

    @property
    def state(self) -> SidecarState:
        """Current state. Read-only; mutation goes through transition_to()."""
        return self._state

    async def transition_to(self, new: SidecarState) -> None:
        """Attempt to move to `new`. Raises InvalidTransitionError if the move
        is not in ALLOWED_TRANSITIONS[self._state] and `new` != ERROR.
        """
        async with self._lock:
            if new not in ALLOWED_TRANSITIONS[self._state] and new != SidecarState.ERROR:
                raise InvalidTransitionError(self._state, new)
            self._state = new

    def reset_for_tests(self) -> None:
        """Test-only hook to reset the state to STOPPED.

        Module-level singletons in controller.py persist across pytest cases
        within a session; tests that mutate state should call this in their
        teardown / autouse fixture so subsequent tests start clean.
        """
        self._state = SidecarState.STOPPED


__all__ = [
    "SidecarState",
    "ALLOWED_TRANSITIONS",
    "InvalidTransitionError",
    "StateMachine",
]
