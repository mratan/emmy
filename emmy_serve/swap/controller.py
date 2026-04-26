"""Sidecar HTTP+SSE control plane (Phase 04.2 Plan 01 Task 3).

The keystone of Phase 04.2 — formalizes the harness↔emmy-serve hard
boundary as HTTP+SSE so the Mac client can speak to Spark over Tailscale.
Wraps the existing Phase-4 swap orchestrator (`emmy_serve.swap.orchestrator`)
as a long-lived FastAPI process; the orchestrator stays per-invocation.

LOCKED contracts:
    D-01 — POST /stop graceful drain: 30s grace + SIGTERM + 5s + SIGKILL,
           emits draining SSE events with in_flight count
    D-02 — POST /start variants: idempotent same-variant short-circuit;
           cold-start argv has no --from; cross-variant runs swap orchestrator
           emitting the same Phase-4 D-02 progress sequence
    D-03 — GET /status is GET-only JSON (NEVER SSE)
    D-06 — FastAPI + uvicorn + sse-starlette + Pydantic v2; bound 127.0.0.1:8003 by default
           (tailnet exposure is opt-in via `tailscale serve --bg --https=8003 http://127.0.0.1:8003`,
            never via direct 0.0.0.0 bind — see CLAUDE.md two-hard-boundaries principle)
    D-07 — Status payload schema (state + 10 nullable fields); 1s metric cache;
           state-machine transitions enforced
    C-05 — Trust-on-tailnet (no auth, no token)
    C-06 — SSE wraps Phase-4 D-02 LOCKED JSON-per-line records verbatim

Security posture:
    - docs_url=None, redoc_url=None — no Swagger / ReDoc surface (RESEARCH §5)
    - Path traversal guards on /start: reject "/" or ".." in profile_id/variant
    - SSE never echoes client request body fields back into the stream (T-04.2-S2)
    - asyncio.create_subprocess_exec (NOT shell=True) — no shell injection (T-04.2-S3)

Run as a uvicorn process:
    uv run python -m emmy_serve.swap.controller
or via the systemd unit (Plan 02): emmy-sidecar.service.
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import time
from datetime import datetime, timezone
from typing import AsyncIterator, Literal

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sse_starlette.sse import EventSourceResponse

from .orchestrator_runner import run_orchestrator_subprocess
from .sidecar_metrics import fetch_vllm_metrics_cached, sample_gpu_temp_cached
from .state import InvalidTransitionError, SidecarState, StateMachine

# ----------------------------------------------------------------------------
# Module-level singletons
# ----------------------------------------------------------------------------

_VERSION = "0.4.2"  # Phase 04.2

# StateMachine singleton — tests reset via state.reset_for_tests().
state = StateMachine()

# Per-process state tracked alongside the FSM. Reset by tests via
# _reset_runtime_for_tests() below.
_current_profile_id: str | None = None
_current_variant: str | None = None
_vllm_pid: int | None = None
_last_error: dict | None = None

# Loopback URL for the vLLM container — overridable for tests.
_VLLM_BASE_URL = os.environ.get("EMMY_VLLM_URL", "http://127.0.0.1:8002")

# Drain config (D-01 LOCKED): 30s grace + SIGTERM + 5s wait + SIGKILL.
_DRAIN_GRACE_S = 30
_SIGKILL_WAIT_S = 5


# ----------------------------------------------------------------------------
# Pydantic schemas (RESEARCH §Key signatures)
# ----------------------------------------------------------------------------


class StartRequest(BaseModel):
    """POST /start body. Variant is required (WARNING #10 fix — no fallback)."""

    profile_id: str
    variant: str | None = None


class StopRequest(BaseModel):
    """POST /stop has no body fields; class exists for symmetry + future extension."""

    pass


class SwapRequest(BaseModel):
    """POST /profile/swap body. Pydantic v2 alias for the Python keyword 'from'."""

    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from")
    to: str
    port: int = 8002


class StatusResponse(BaseModel):
    """GET /status response (D-07 LOCKED schema)."""

    state: Literal["stopped", "starting", "ready", "swapping", "draining", "error"]
    profile_id: str | None
    profile_variant: str | None
    profile_hash: str | None
    vllm_up: bool
    vllm_pid: int | None
    container_digest: str | None
    kv_used_pct: float | None
    gpu_temp_c: float | None
    in_flight: int | None
    last_error: dict | None


# ----------------------------------------------------------------------------
# FastAPI app
# ----------------------------------------------------------------------------

app = FastAPI(
    title="emmy-sidecar",
    version=_VERSION,
    docs_url=None,
    redoc_url=None,
)


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------


def _now_iso() -> str:
    """ISO-8601 UTC timestamp with 'Z' suffix (matches progress.py emit())."""
    return datetime.now(timezone.utc).isoformat()


def _record_error(msg: str) -> None:
    """Update the module-level _last_error dict; surfaced via GET /status."""
    global _last_error
    _last_error = {"ts": _now_iso(), "msg": msg}


def _validate_profile_id_and_variant(profile_id: str, variant: str | None) -> str:
    """Path-traversal guard for T-04.2-S3.

    Returns the validated variant (after the WARNING #10 non-empty check).
    Raises HTTPException(400) on any invalid input.
    """
    if not variant:
        raise HTTPException(
            status_code=400,
            detail=(
                "variant is required (e.g. 'v3.1-default', 'v1.1' — directory "
                "under profiles/<profile_id>/). No silent fallback to bare 'v1' "
                "since no real profile uses that variant name."
            ),
        )
    if "/" in profile_id or ".." in profile_id:
        raise HTTPException(status_code=400, detail="invalid profile_id (no '/' or '..')")
    if "/" in variant or ".." in variant:
        raise HTTPException(status_code=400, detail="invalid variant (no '/' or '..')")
    return variant


def _reset_runtime_for_tests() -> None:
    """Reset module-level state for pytest isolation. Tests should call this."""
    global _current_profile_id, _current_variant, _vllm_pid, _last_error
    state.reset_for_tests()
    _current_profile_id = None
    _current_variant = None
    _vllm_pid = None
    _last_error = None


# ----------------------------------------------------------------------------
# Endpoints — sanity / root
# ----------------------------------------------------------------------------


@app.get("/healthz")
async def healthz() -> dict:
    """Process-up canary; used by Plan 05's install-time smoke check."""
    return {"ok": True, "version": _VERSION}


@app.get("/")
async def root() -> dict:
    """Service-discovery sanity ping — lists known endpoints."""
    return {
        "name": "emmy-sidecar",
        "version": _VERSION,
        "endpoints": ["/healthz", "/status", "/start", "/stop", "/profile/swap"],
    }


# ----------------------------------------------------------------------------
# GET /status — D-03 LOCKED (poll-only) + D-07 LOCKED (payload schema)
# ----------------------------------------------------------------------------


@app.get("/status")
async def get_status() -> StatusResponse:
    """Return the canonical /status payload (D-07 LOCKED).

    D-03 LOCKED: this is a single GET — never SSE. The Mac footer poller
    consumes this on its existing 2s cadence.
    """
    # Probe vLLM /metrics; on any error → vllm_up=False with all metric
    # fields nulled (T-04.2-S2 invariant: never echo client input here, this
    # endpoint takes no body anyway).
    vllm_up = False
    kv_used_pct: float | None = None
    in_flight: int | None = None
    try:
        metrics = await fetch_vllm_metrics_cached(_VLLM_BASE_URL)
        vllm_up = True
        # Phase 04.2 follow-up — metric name renamed in vLLM v0.17:
        #   OLD (v0.16-): vllm:gpu_cache_usage_perc
        #   NEW (v0.17+): vllm:kv_cache_usage_perc
        # Read both for backward/forward compat across containers (NGC's
        # 26.03.post1 ships the v0.17 series; older eval matrices may still
        # be on v0.16 builds).
        if "vllm:kv_cache_usage_perc" in metrics:
            kv_used_pct = float(metrics["vllm:kv_cache_usage_perc"])
        elif "vllm:gpu_cache_usage_perc" in metrics:
            kv_used_pct = float(metrics["vllm:gpu_cache_usage_perc"])
        if "vllm:num_requests_running" in metrics:
            in_flight = int(metrics["vllm:num_requests_running"])
    except Exception:
        # Connection refused / timeout / non-2xx — vllm_up stays False, fields stay None.
        pass

    gpu_temp_c = sample_gpu_temp_cached()

    return StatusResponse(
        state=state.state.value,  # type: ignore[arg-type]  # Literal narrowing
        profile_id=_current_profile_id,
        profile_variant=_current_variant,
        profile_hash=None,  # v1 defer — computing requires bundle read
        vllm_up=vllm_up,
        vllm_pid=_vllm_pid,
        container_digest=None,  # v1 defer — would shell `docker inspect emmy-serve`
        kv_used_pct=kv_used_pct,
        gpu_temp_c=gpu_temp_c,
        in_flight=in_flight,
        last_error=_last_error,
    )


# ----------------------------------------------------------------------------
# POST /start — D-02 LOCKED (idempotent + cold-start + cross-variant)
# ----------------------------------------------------------------------------


@app.post("/start")
async def post_start(req: StartRequest, request: Request) -> EventSourceResponse:
    """Start (cold) or swap (warm) vLLM to the requested profile/variant.

    Three behaviors per D-02 LOCKED:
        - Same variant already loaded → idempotent: single SSE 'ready' frame.
        - State == STOPPED → cold-start: spawn orchestrator with NO --from arg.
        - State == READY w/ different variant → cross-variant swap, with
          orchestrator getting --from <current> --to <new>.

    The variant is REQUIRED (WARNING #10 fix); the path-traversal guard
    rejects '/' or '..' in either field (T-04.2-S3).
    """
    global _current_profile_id, _current_variant

    # WARNING #10 fix + path-traversal guard (must run BEFORE state check
    # so a malformed request is rejected with 400 regardless of state).
    variant = _validate_profile_id_and_variant(req.profile_id, req.variant)

    # State guard. ALLOWED_TRANSITIONS permits ERROR → STARTING so the operator
    # can retry after a transient orchestrator failure (docker port conflict,
    # warmup timeout, etc.) without manually restarting the sidecar systemd
    # unit. The handler maps ERROR to a cold-start path (no _current_*
    # tracking to consult, so from_path stays None below).
    if state.state not in {SidecarState.STOPPED, SidecarState.READY, SidecarState.ERROR}:
        raise HTTPException(
            status_code=409,
            detail=f"start requires state in (stopped,ready,error), currently={state.state.value}",
        )

    # D-02 idempotent same-variant short-circuit (READY + same profile + same
    # variant + vLLM actually alive).
    #
    # Phase 04.2 follow-up — added live vllm_up probe to the gate. Without it,
    # an externally-killed vLLM (e.g. `docker stop emmy-serve`) leaves the
    # sidecar's `state` stuck at READY (the state machine doesn't auto-
    # transition on death). A subsequent /start with the same profile would
    # then short-circuit as "already running" when vLLM is actually dead —
    # operator's next inference 502s.
    #
    # Probe via the same fetch_vllm_metrics_cached path the /status endpoint
    # uses; this is cached (1s TTL) so the cost is negligible.
    if (
        state.state == SidecarState.READY
        and _current_profile_id == req.profile_id
        and _current_variant == variant
    ):
        try:
            await fetch_vllm_metrics_cached(_VLLM_BASE_URL)
            vllm_actually_up = True
        except Exception:
            vllm_actually_up = False

        if vllm_actually_up:
            async def _idempotent_gen() -> AsyncIterator[dict]:
                yield {"data": json.dumps({"state": "ready", "phase": "ready"})}
                # Phase 04.2 follow-up — emit terminal exit frame so the TS lifecycle
                # client (which defaults exit=1 on absence) treats this as success.
                # Without it, an idempotent short-circuit would be misread as failure
                # by any client that fails closed on missing exit.
                yield {"data": json.dumps({"exit": 0})}

            return EventSourceResponse(
                _idempotent_gen(),
                ping=15,
                send_timeout=10,
            )
        # else: fall through — vLLM is dead despite our READY state. Reset
        # bookkeeping and treat as cold-start so the orchestrator recreates
        # the container.
        _current_profile_id = None
        _current_variant = None
        # Force the cold-start branch below by pretending we were STOPPED.
        # We can't transition_to(STOPPED) because READY → STOPPED isn't allowed,
        # and the cold_start flag below already keys on STOPPED|ERROR.
        # Easier: directly reassign the local cold_start bookkeeping after
        # this block (see the next section).

    # Determine paths + cold-vs-cross-variant.
    to_path = f"profiles/{req.profile_id}/{variant}"
    # STOPPED and ERROR map to cold-start (no prior engine to swap from).
    # READY also maps to cold-start IF we just reset _current_* above (the
    # "vLLM died externally" recovery path) — detected by the bookkeeping
    # being None despite state==READY.
    cold_start = (
        state.state in {SidecarState.STOPPED, SidecarState.ERROR}
        or (state.state == SidecarState.READY and _current_profile_id is None)
    )
    if cold_start:
        from_path: str | None = None
        target_state = SidecarState.STARTING  # STOPPED|ERROR → STARTING → READY
    else:
        # READY with different variant → cross-variant swap.
        if _current_profile_id is None or _current_variant is None:
            # Defensive: state==READY but tracking vars not set (shouldn't happen
            # in production; protects test scenarios that pre-position state).
            from_path = None
            cold_start = True
            target_state = SidecarState.STARTING
        else:
            from_path = f"profiles/{_current_profile_id}/{_current_variant}"
            target_state = SidecarState.SWAPPING  # READY → SWAPPING → READY

    async def event_generator() -> AsyncIterator[dict]:
        global _current_profile_id, _current_variant
        try:
            await state.transition_to(target_state)
        except InvalidTransitionError as e:
            _record_error(str(e))
            yield {"data": json.dumps({"phase": "error", "details": {"msg": str(e)}})}
            return

        try:
            exit_rc: int | None = None
            async for rec in run_orchestrator_subprocess(
                from_path=from_path,
                to_path=to_path,
                port=8002,
            ):
                if "_internal_exit" in rec:
                    exit_rc = int(rec["_internal_exit"])
                    yield {"data": json.dumps({"exit": exit_rc})}
                else:
                    yield {"data": json.dumps(rec)}
                if await request.is_disconnected():
                    break

            # Post-subprocess state transition.
            if exit_rc == 0:
                _current_profile_id = req.profile_id
                _current_variant = variant
                await state.transition_to(SidecarState.READY)
            else:
                _record_error(f"orchestrator exit {exit_rc}")
                await state.transition_to(SidecarState.ERROR)
        except asyncio.CancelledError:
            # Phase 04.2 follow-up — SSE consumer disconnected mid-stream
            # (e.g. Mac client Ctrl-C, network drop, Bun fetch timeout).
            # The orchestrator subprocess already gets SIGTERM via the
            # generator's finally (run_orchestrator_subprocess). We must
            # ALSO transition the state machine to ERROR so the next /start
            # can recover (state machine permits ERROR → STARTING).
            # Without this, state stays stuck at STARTING and every
            # subsequent /start returns 409 "currently=starting".
            _record_error("client disconnected mid-stream during /start")
            try:
                await state.transition_to(SidecarState.ERROR)
            except InvalidTransitionError:
                pass
            raise  # CancelledError MUST propagate
        except Exception as e:
            _record_error(f"start handler exception: {e}")
            try:
                await state.transition_to(SidecarState.ERROR)
            except InvalidTransitionError:
                pass
            yield {"data": json.dumps({"phase": "error", "details": {"msg": str(e)}})}
            # Phase 04.2 follow-up — explicit exit frame so the TS client doesn't
            # interpret a bare error frame as success (exit=0 default). Use exit=1
            # for handler-level exceptions; orchestrator-emitted non-zero codes
            # (5/6 for swap pre-flight / post-stop failures) flow through the
            # `exit_rc != 0` branch above unchanged.
            yield {"data": json.dumps({"exit": 1})}

    return EventSourceResponse(
        event_generator(),
        ping=15,
        send_timeout=10,
    )


# ----------------------------------------------------------------------------
# POST /stop — D-01 LOCKED (graceful drain)
# ----------------------------------------------------------------------------


@app.post("/stop")
async def post_stop(req: StopRequest, request: Request) -> EventSourceResponse:
    """Graceful drain of the running vLLM (D-01 LOCKED).

    Flow:
        1. Reject with 409 if state != READY (idempotent guard for /stop
           during DRAINING — T-04.2-S8 mitigation).
        2. Transition READY → DRAINING.
        3. Loop: poll vllm:num_requests_running; emit
           ``{phase: 'draining', details: {in_flight: N}}`` SSE event;
           sleep 1s; break when N == 0 OR elapsed >= 30s.
        4. SIGTERM the vLLM PID; sleep 5s; SIGKILL if still alive.
        5. Transition DRAINING → STOPPED; emit final
           ``{state: 'stopped', exit: 0}`` frame.
    """
    if state.state != SidecarState.READY:
        raise HTTPException(
            status_code=409,
            detail=f"stop requires state=ready, currently={state.state.value}",
        )

    # Capture the PID at request entry (guards against late mutation).
    vllm_pid_at_entry = _vllm_pid

    async def event_generator() -> AsyncIterator[dict]:
        global _vllm_pid
        try:
            await state.transition_to(SidecarState.DRAINING)
        except InvalidTransitionError as e:
            _record_error(str(e))
            yield {"data": json.dumps({"phase": "error", "details": {"msg": str(e)}})}
            return

        try:
            t0 = time.monotonic()
            while True:
                in_flight = 0
                try:
                    metrics = await fetch_vllm_metrics_cached(_VLLM_BASE_URL)
                    in_flight = int(metrics.get("vllm:num_requests_running", 0))
                except Exception:
                    # vLLM unreachable → treat as already drained.
                    in_flight = 0

                yield {
                    "data": json.dumps(
                        {
                            "ts": _now_iso(),
                            "phase": "draining",
                            "details": {"in_flight": in_flight},
                        }
                    )
                }

                if in_flight <= 0:
                    break
                if (time.monotonic() - t0) >= _DRAIN_GRACE_S:
                    break
                await asyncio.sleep(1.0)
                if await request.is_disconnected():
                    break

            # SIGTERM, then 5s wait, then SIGKILL if still alive.
            if vllm_pid_at_entry is not None:
                try:
                    os.kill(vllm_pid_at_entry, signal.SIGTERM)
                except ProcessLookupError:
                    pass  # Already gone — that's fine.

                # Wait up to _SIGKILL_WAIT_S for the process to exit.
                killed = False
                wait_t0 = time.monotonic()
                while (time.monotonic() - wait_t0) < _SIGKILL_WAIT_S:
                    try:
                        # signal 0 = "is the process alive?"
                        os.kill(vllm_pid_at_entry, 0)
                    except ProcessLookupError:
                        killed = True
                        break
                    await asyncio.sleep(0.2)

                if not killed:
                    try:
                        os.kill(vllm_pid_at_entry, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

            _vllm_pid = None
            await state.transition_to(SidecarState.STOPPED)
            yield {"data": json.dumps({"state": "stopped", "exit": 0})}
        except asyncio.CancelledError:
            # Phase 04.2 follow-up — same recovery pattern as /start and
            # /profile/swap. /stop is mid-drain; force ERROR so /reset
            # or another /stop can recover.
            _record_error("client disconnected mid-stream during /stop")
            try:
                await state.transition_to(SidecarState.ERROR)
            except InvalidTransitionError:
                pass
            raise
        except Exception as e:
            _record_error(f"stop handler exception: {e}")
            try:
                await state.transition_to(SidecarState.ERROR)
            except InvalidTransitionError:
                pass
            yield {"data": json.dumps({"phase": "error", "details": {"msg": str(e)}})}

    return EventSourceResponse(
        event_generator(),
        ping=15,
        send_timeout=10,
    )


# ----------------------------------------------------------------------------
# POST /reset — Phase 04.2 follow-up — operator escape hatch.
# ----------------------------------------------------------------------------


@app.post("/reset")
async def post_reset() -> dict:
    """Force-reset the sidecar state machine to STOPPED.

    Recovery hatch for state stuck at STARTING / SWAPPING / DRAINING /
    ERROR due to client disconnect mid-stream OR any other unrecoverable
    condition. Kills any orphan orchestrator subprocesses; clears
    `_last_error`, `_current_profile_id`, `_current_variant`, `_vllm_pid`.

    SAFETY: this does NOT touch the running vLLM container — only resets
    the SIDECAR's state-machine bookkeeping. Use `/stop` (or `docker stop
    emmy-serve` directly) to actually shut down vLLM. After /reset, a
    /status will report `state=stopped` but `vllm_up=true` if vLLM is
    still serving — which is the correct externally-started shape.

    Bypasses ALLOWED_TRANSITIONS by mutating SidecarState directly through
    the StateMachine's `_state` attribute under its asyncio.Lock — this
    is the operator-explicit recovery path; the lock keeps it consistent
    with concurrent handlers.
    """
    global _current_profile_id, _current_variant, _vllm_pid, _last_error

    prior_state = state.state.value

    # Kill any orphan orchestrator subprocesses. Best-effort — there's no
    # central registry, but the orchestrator's argv is distinctive enough
    # to find via pgrep.
    killed_pids: list[int] = []
    try:
        result = await asyncio.create_subprocess_exec(
            "pgrep", "-f", "emmy_serve.swap.orchestrator",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout_bytes, _ = await result.communicate()
        for line in stdout_bytes.decode(errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                pid = int(line)
            except ValueError:
                continue
            try:
                os.kill(pid, signal.SIGTERM)
                killed_pids.append(pid)
            except ProcessLookupError:
                pass
    except FileNotFoundError:
        # pgrep not on PATH; skip orphan cleanup. State reset still happens.
        pass
    except Exception:
        # Best-effort — never let a cleanup error prevent the reset.
        pass

    async with state._lock:  # type: ignore[attr-defined]
        # Direct mutation under the lock — bypasses ALLOWED_TRANSITIONS by
        # design. This is the recovery primitive; the state machine's normal
        # transitions don't permit "any → STOPPED" because that's not a
        # legitimate workflow path, only an operator-explicit recovery.
        state._state = SidecarState.STOPPED  # type: ignore[attr-defined]

    _current_profile_id = None
    _current_variant = None
    _vllm_pid = None
    _last_error = None

    return {
        "ok": True,
        "prior_state": prior_state,
        "current_state": "stopped",
        "killed_orchestrator_pids": killed_pids,
    }


# ----------------------------------------------------------------------------
# POST /profile/swap — C-06 LOCKED (SSE wrapper around Phase-4 D-02)
# ----------------------------------------------------------------------------


@app.post("/profile/swap")
async def profile_swap(req: SwapRequest, request: Request) -> EventSourceResponse:
    """Run the swap orchestrator as a subprocess; re-frame stdout as SSE.

    C-06 LOCKED: each yielded JSON-per-line record is wrapped in
    ``data: {json}\n\n`` framing without reshape. The Phase-4 D-02 phase
    labels ('stopping vLLM', 'loading weights', 'warmup', 'ready') flow
    through verbatim. Final {_internal_exit: rc} becomes data: {exit: rc}.

    Exit codes (per Phase-4 D-02 contract):
        0 → state→READY, current_profile_id/variant updated
        6 → orchestrator already emitted {rolled_back, rollback_succeeded}
            BEFORE _internal_exit; pass through verbatim. State→READY if
            rollback succeeded (old profile still loaded), else ERROR.
        other → state→ERROR; _last_error populated
    """
    global _current_profile_id, _current_variant

    if state.state != SidecarState.READY:
        raise HTTPException(
            status_code=409,
            detail=f"swap requires state=ready, currently={state.state.value}",
        )

    async def event_generator() -> AsyncIterator[dict]:
        global _current_profile_id, _current_variant
        try:
            await state.transition_to(SidecarState.SWAPPING)
        except InvalidTransitionError as e:
            _record_error(str(e))
            yield {"data": json.dumps({"phase": "error", "details": {"msg": str(e)}})}
            return

        try:
            rollback_succeeded: bool | None = None  # tracks the envelope frame
            exit_rc: int | None = None
            async for rec in run_orchestrator_subprocess(
                from_path=req.from_,
                to_path=req.to,
                port=req.port,
            ):
                if "_internal_exit" in rec:
                    exit_rc = int(rec["_internal_exit"])
                    yield {"data": json.dumps({"exit": exit_rc})}
                else:
                    if "rolled_back" in rec:
                        rollback_succeeded = bool(rec.get("rollback_succeeded"))
                    yield {"data": json.dumps(rec)}
                if await request.is_disconnected():
                    break

            # Decide post-subprocess state.
            if exit_rc == 0:
                # Update tracking from to_path: parse profiles/<id>/<variant>/.
                pid, var = _parse_profile_path(req.to)
                if pid is not None and var is not None:
                    _current_profile_id = pid
                    _current_variant = var
                await state.transition_to(SidecarState.READY)
            elif exit_rc == 6 and rollback_succeeded:
                # Old profile still loaded — keep current_profile_id/variant.
                await state.transition_to(SidecarState.READY)
            else:
                _record_error(f"orchestrator exit {exit_rc}")
                await state.transition_to(SidecarState.ERROR)
        except asyncio.CancelledError:
            # Phase 04.2 follow-up — same pattern as /start: client disconnect
            # → cancel state machine recovery so the next swap can run.
            _record_error("client disconnected mid-stream during /profile/swap")
            try:
                await state.transition_to(SidecarState.ERROR)
            except InvalidTransitionError:
                pass
            raise
        except Exception as e:
            _record_error(f"swap handler exception: {e}")
            try:
                await state.transition_to(SidecarState.ERROR)
            except InvalidTransitionError:
                pass
            yield {"data": json.dumps({"phase": "error", "details": {"msg": str(e)}})}

    return EventSourceResponse(
        event_generator(),
        ping=15,
        send_timeout=10,
    )


def _parse_profile_path(path: str) -> tuple[str | None, str | None]:
    """Parse 'profiles/<profile_id>/<variant>/' → (profile_id, variant).

    Used after a successful swap to update _current_profile_id/_current_variant
    from the orchestrator's --to argument. Returns (None, None) if path doesn't
    have the expected shape — the controller leaves tracking unchanged in that
    case (caller may have passed an absolute path during tests).
    """
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    if len(parts) >= 3 and parts[0] == "profiles":
        return parts[1], parts[2]
    return None, None


# ----------------------------------------------------------------------------
# uvicorn entry point
# ----------------------------------------------------------------------------


def run() -> None:
    """Boot uvicorn on 127.0.0.1:8003 (Phase 04.2 Plan 02 wires this to systemd).

    Loopback-only by design: Tailscale Serve (`tailscale serve --bg --https=8003
    http://127.0.0.1:8003`) is the single, explicit tailnet-exposure path. A
    direct 0.0.0.0 bind would shadow the tailscale daemon's per-IP listeners
    and produce EADDRINUSE — and would also violate CLAUDE.md's air-gap thesis
    by exposing the sidecar to whatever non-tailnet interfaces are present.

    Override via EMMY_SIDECAR_HOST / EMMY_SIDECAR_PORT for non-default
    deployments (e.g. a second host bound to a private VLAN where loopback
    isn't the right boundary). Leave both unset for the default Spark layout.
    """
    import uvicorn

    host = os.environ.get("EMMY_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("EMMY_SIDECAR_PORT", "8003"))

    uvicorn.run(
        "emmy_serve.swap.controller:app",
        host=host,
        port=port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":  # pragma: no cover
    run()


__all__ = [
    "app",
    "run",
    "state",
    "StartRequest",
    "StopRequest",
    "SwapRequest",
    "StatusResponse",
]
