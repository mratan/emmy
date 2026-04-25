"""GREEN — Sidecar lifecycle state machine (Phase 04.2 Plan 01 Task 1).

Covers D-07 LOCKED transition table from CONTEXT.md:
    stopped  → {starting, error}
    starting → {ready, error}
    ready    → {swapping, draining, error}
    swapping → {ready, error}
    draining → {stopped, error}
    error    → {starting}

Test matrix:
    every (from, to) edge in ALLOWED_TRANSITIONS succeeds
    every disallowed transition raises InvalidTransitionError
    any non-ERROR state → ERROR is allowed implicitly
    error → READY raises (recovery requires /start = STARTING only)
    asyncio.Lock prevents concurrent transition races (smoke)

All tests are `async def test_*`; pyproject.toml pins
``asyncio_mode = "auto"`` so no decorators are needed.
"""
from __future__ import annotations

import asyncio
from typing import Iterable

import pytest

from emmy_serve.swap import (
    ALLOWED_TRANSITIONS,
    InvalidTransitionError,
    SidecarState,
    StateMachine,
)


# --- helpers -----------------------------------------------------------------


async def _drive_to(sm: StateMachine, target: SidecarState) -> None:
    """Drive `sm` from STOPPED → ... → `target` along a known-valid path.

    Picks the shortest happy path through the FSM for each target state so the
    parametrised "edge X allowed" tests can position the machine deterministically.
    """
    paths: dict[SidecarState, list[SidecarState]] = {
        SidecarState.STOPPED: [],
        SidecarState.STARTING: [SidecarState.STARTING],
        SidecarState.READY: [SidecarState.STARTING, SidecarState.READY],
        SidecarState.SWAPPING: [SidecarState.STARTING, SidecarState.READY, SidecarState.SWAPPING],
        SidecarState.DRAINING: [SidecarState.STARTING, SidecarState.READY, SidecarState.DRAINING],
        SidecarState.ERROR: [SidecarState.ERROR],  # any-state→ERROR allowed
    }
    for step in paths[target]:
        await sm.transition_to(step)
    assert sm.state == target, f"failed to drive to {target}; ended in {sm.state}"


def _allowed_edges() -> Iterable[tuple[SidecarState, SidecarState]]:
    """Yield each (frm, to) pair declared in ALLOWED_TRANSITIONS."""
    for frm, tos in ALLOWED_TRANSITIONS.items():
        for to in tos:
            yield (frm, to)


# --- happy path: every allowed edge succeeds ---------------------------------


@pytest.mark.parametrize("frm,to", list(_allowed_edges()))
async def test_transitions_allowed(frm: SidecarState, to: SidecarState) -> None:
    """Every (frm, to) in ALLOWED_TRANSITIONS table moves the FSM successfully."""
    sm = StateMachine()
    await _drive_to(sm, frm)
    await sm.transition_to(to)
    assert sm.state == to


# --- disallowed transitions raise -------------------------------------------


async def test_disallowed_raises_invalid_transition() -> None:
    """STOPPED → READY (skipping STARTING) violates D-07 and must raise."""
    sm = StateMachine()
    with pytest.raises(InvalidTransitionError) as exc:
        await sm.transition_to(SidecarState.READY)
    assert exc.value.frm == SidecarState.STOPPED
    assert exc.value.to == SidecarState.READY
    # State must NOT have been mutated by the failed transition.
    assert sm.state == SidecarState.STOPPED


async def test_disallowed_ready_to_stopped_raises() -> None:
    """READY → STOPPED is not allowed (must go through DRAINING first)."""
    sm = StateMachine()
    await _drive_to(sm, SidecarState.READY)
    with pytest.raises(InvalidTransitionError):
        await sm.transition_to(SidecarState.STOPPED)
    assert sm.state == SidecarState.READY


async def test_disallowed_stopped_to_swapping_raises() -> None:
    """STOPPED → SWAPPING skips two states; must raise."""
    sm = StateMachine()
    with pytest.raises(InvalidTransitionError):
        await sm.transition_to(SidecarState.SWAPPING)
    assert sm.state == SidecarState.STOPPED


# --- any-state → ERROR is implicitly allowed --------------------------------


@pytest.mark.parametrize(
    "frm",
    [
        SidecarState.STOPPED,
        SidecarState.STARTING,
        SidecarState.READY,
        SidecarState.SWAPPING,
        SidecarState.DRAINING,
    ],
)
async def test_any_state_to_error_allowed(frm: SidecarState) -> None:
    """From every non-ERROR state, transitioning to ERROR succeeds (D-07)."""
    sm = StateMachine()
    await _drive_to(sm, frm)
    await sm.transition_to(SidecarState.ERROR)
    assert sm.state == SidecarState.ERROR


# --- error recovery is via STARTING only ------------------------------------


async def test_error_recovery_only_via_starting() -> None:
    """From ERROR: STARTING succeeds; READY, SWAPPING, DRAINING, STOPPED all raise."""
    sm = StateMachine()
    await _drive_to(sm, SidecarState.ERROR)

    # Each disallowed move from ERROR must raise.
    for bad in (SidecarState.READY, SidecarState.SWAPPING, SidecarState.DRAINING, SidecarState.STOPPED):
        sub = StateMachine()
        await _drive_to(sub, SidecarState.ERROR)
        with pytest.raises(InvalidTransitionError):
            await sub.transition_to(bad)
        assert sub.state == SidecarState.ERROR

    # The one allowed move: ERROR → STARTING.
    await sm.transition_to(SidecarState.STARTING)
    assert sm.state == SidecarState.STARTING


async def test_error_to_error_is_allowed() -> None:
    """ERROR → ERROR is allowed (any → ERROR; idempotent error reporting)."""
    sm = StateMachine()
    await _drive_to(sm, SidecarState.ERROR)
    await sm.transition_to(SidecarState.ERROR)
    assert sm.state == SidecarState.ERROR


# --- enum identity / wire format --------------------------------------------


def test_state_values_are_lowercase_strings() -> None:
    """Wire format invariant (D-07 LOCKED): each .value is the lowercase token
    that downstream consumers (Plan 03 TS sidecar-status-client.ts) parse.
    """
    assert SidecarState.STOPPED.value == "stopped"
    assert SidecarState.STARTING.value == "starting"
    assert SidecarState.READY.value == "ready"
    assert SidecarState.SWAPPING.value == "swapping"
    assert SidecarState.DRAINING.value == "draining"
    assert SidecarState.ERROR.value == "error"


def test_initial_state_is_stopped() -> None:
    """A fresh StateMachine starts in STOPPED — sidecar boots with no vLLM."""
    sm = StateMachine()
    assert sm.state == SidecarState.STOPPED


# --- concurrency smoke -------------------------------------------------------


async def test_concurrent_transitions_serialize() -> None:
    """asyncio.Lock-protected transition_to: two concurrent valid moves must
    both eventually succeed without raising or losing intermediate state.

    This is a smoke check, not a stress test — it asserts that asyncio.Lock
    is in place. Without the lock, the bookkeeping could race.
    """
    sm = StateMachine()
    await sm.transition_to(SidecarState.STARTING)
    await sm.transition_to(SidecarState.READY)

    # Two coroutines try to drive READY → SWAPPING → READY back-to-back.
    async def cycle() -> None:
        # If state is READY: SWAPPING then READY.
        if sm.state == SidecarState.READY:
            await sm.transition_to(SidecarState.SWAPPING)
            await sm.transition_to(SidecarState.READY)

    await asyncio.gather(cycle(), cycle())
    # The exact end state depends on interleaving, but it MUST be a valid one.
    assert sm.state in {SidecarState.READY, SidecarState.SWAPPING}
