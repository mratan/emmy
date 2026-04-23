"""Rollback by recursion into swap_profile with no_rollback=True.

D-04 LOCKED: rollback goes through the SAME primitive, not a special case.
D-04 LOCKED: on swap failure the user must see a clear error AND the prior
model must still be loaded.

The rollback() entry point:
  1. Stops the failed engine (best-effort; it may already be down)
  2. Calls swap_profile(failed_new, prior_old, port, run_dir, no_rollback=True)
     which runs pre-flight on prior_old and restarts it via the primitive.
  3. Emits a final JSON envelope {"rolled_back": true, "rollback_succeeded": bool}
     on stdout for the TS parent to parse.
  4. Always returns 6.

The ``no_rollback=True`` flag on the recursive call is the infinite-loop
guard — if the inner swap also fails, it returns 6 without trying to
rollback again. T-04-02-02 in the threat model.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .progress import emit


def rollback(
    failed_new: Path,
    prior_old: Path,
    port: int,
    run_dir: Path,
) -> int:
    """Rollback from a failed new profile to the previously-loaded one.

    Args:
        failed_new: the profile whose swap attempt just failed (informational;
            used only for the progress log).
        prior_old: the profile that WAS running before the swap attempt — this
            is what we restart.
        port: the loopback port (unchanged across swap + rollback).
        run_dir: directory for diagnostic bundles produced during rollback.

    Returns:
        Always 6. The final JSON envelope on stdout conveys rollback outcome
        via ``rollback_succeeded``.
    """
    # Local import avoids a circular import between orchestrator ↔ rollback.
    from .orchestrator import swap_profile

    emit("rollback: stopping failed engine")
    subprocess.run(
        ["docker", "stop", "--time", "15", "emmy-serve"],
        check=False,
        capture_output=True,
    )
    subprocess.run(
        ["docker", "rm", "emmy-serve"],
        check=False,
        capture_output=True,
    )

    emit("rollback: restarting prior profile")
    # Recursion with no_rollback=True prevents infinite rollback-of-rollback
    # (T-04-02-02). If this inner swap fails, exit 6 is returned immediately.
    rc = swap_profile(
        failed_new,
        prior_old,
        port,
        run_dir,
        no_rollback=True,
    )

    envelope = {
        "rolled_back": True,
        "rollback_succeeded": rc == 0,
    }
    print(json.dumps(envelope), flush=True)
    return 6


__all__ = ["rollback"]
