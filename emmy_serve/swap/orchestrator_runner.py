"""Async subprocess wrapper for ``python -m emmy_serve.swap.orchestrator``
(Phase 04.2 Plan 01 Task 2).

Spawns the existing Phase-4 swap orchestrator as a child process and yields
its JSON-per-line stdout records as Python dicts; emits a final
``{"_internal_exit": rc}`` sentinel so the FastAPI handler in
``controller.py`` can route the exit code into a final SSE ``data:`` frame
(per the C-06 wire-format contract).

D-04 BYTE-STABLE invariant: argv MUST be byte-identical to today's TS
spawn argv at ``packages/emmy-ux/src/profile-swap-runner.ts:80-99``. Plan 03's
TS-side snapshot test will assert on its sibling argv:
    ["run", "python", "-m", "emmy_serve.swap.orchestrator",
     "--from", X, "--to", Y, "--port", "8002"]
Note the TS side does NOT have the leading "uv" — that's the spawnFn binary,
not part of the args array. Here we keep "uv" at argv[0] because
asyncio.create_subprocess_exec takes program + args as one combined list.

C-06 LOCKED contract: each yielded dict is the orchestrator's verbatim
JSON-per-line record — the controller does not reshape these, just wraps
each in ``data: {json}\n\n`` SSE framing. Phase-4 D-02 phase labels
("stopping vLLM", "loading weights", "warmup", "ready") flow through
unchanged.

Malformed-line tolerance (S-3 pattern): json.JSONDecodeError silently
swallowed — matches profile-swap-runner.ts:138-140 ("Non-JSON / malformed
line — ignore per contract"). Without this, a stray container log line
written to the orchestrator's stdout would crash the SSE stream mid-swap.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator


async def run_orchestrator_subprocess(
    *,
    from_path: str | None,
    to_path: str,
    port: int = 8002,
    cwd: str | None = None,
) -> AsyncIterator[dict]:
    """Spawn the swap orchestrator as a subprocess; yield each JSON-per-line
    stdout record as a dict, then a ``{"_internal_exit": rc}`` sentinel.

    Args:
        from_path: profile bundle directory currently loaded (e.g.
            ``"profiles/qwen3.6-35b-a3b/v3.1-default"``). ``None`` for cold
            start (no `--from` arg passed; orchestrator skips the docker
            stop step).
        to_path: profile bundle directory to load.
        port: vLLM container port (default 8002 — matches start_emmy.sh).
        cwd: optional working directory for the subprocess; defaults to the
            current process cwd (the repo root when systemd runs the
            sidecar via WorkingDirectory=%h/code/emmy).

    Yields:
        Each dict from the orchestrator's stdout (Phase-4 D-02 LOCKED
        records: ``{ts, phase, pct?}``), plus a final
        ``{"_internal_exit": rc}`` once the subprocess exits.

    Behavior:
        - Cold start (from_path is None) argv ends with ``--to <path> --port N``.
        - Cross-variant (from_path set) argv extends with ``--from <path>``.
        - Malformed JSON lines are silently dropped (S-3 tolerance).
    """
    # D-04 BYTE-STABLE: this argv literal MUST match today's TS spawn argv at
    # profile-swap-runner.ts:80-99. Plan 03 will snapshot-test the TS sibling.
    argv = ["uv", "run", "python", "-m", "emmy_serve.swap.orchestrator",
            "--to", to_path, "--port", str(port)]
    if from_path is not None:
        argv.extend(["--from", from_path])

    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )
    assert proc.stdout is not None  # PIPE was requested above

    try:
        async for line in proc.stdout:
            text = line.decode(errors="replace").strip()
            if not text:
                continue
            try:
                yield json.loads(text)
            except json.JSONDecodeError:
                # S-3: silently drop non-JSON lines (matches TS-side
                # profile-swap-runner.ts:138-140 "ignore per contract").
                continue
    finally:
        # Phase 04.2 follow-up — actively terminate the subprocess on
        # cancellation. Pre-fix: bare `await proc.wait()` blocked the finally
        # waiting for the orchestrator (which could be mid-warmup, ~3 min away
        # from exiting), and the consumer's CancelledError propagated through
        # an event loop that was blocked. Net effect: SSE consumer disconnect
        # → controller's async for cancelled → generator's GeneratorExit fires
        # → finally's proc.wait() blocks → controller never reaches its
        # post-subprocess state transition → state stuck at STARTING.
        #
        # Post-fix: if the subprocess hasn't exited, send SIGTERM (gives the
        # orchestrator ~10s to clean up — `docker stop --time 15` calls inside
        # need finalization), then SIGKILL on timeout. proc.wait() then returns
        # immediately with the actual exit code (or -SIGTERM/-SIGKILL).
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                # Already exited between the check and terminate; harmless.
                pass
            try:
                rc = await asyncio.wait_for(proc.wait(), timeout=10)
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                rc = await proc.wait()
        else:
            rc = await proc.wait()

    yield {"_internal_exit": rc}


__all__ = ["run_orchestrator_subprocess"]
