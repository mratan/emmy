"""Emit swap-progress events as one JSON line per phase to stdout.

The four labels STOPPING/LOADING/WARMUP/READY are D-02 LOCKED verbatim and
are consumed by packages/emmy-ux/src/profile-swap-runner.ts. Changing them
breaks the TS contract.

Schema (single-quoted here so the verbatim literals below are the sole
string occurrence in this file — the unit + grep checks rely on it):
    {ts: <iso-utc>, phase: <phase-string>}
    {ts: <iso-utc>, phase: <phase-string>, pct: <0..100>}  # LOADING only

Rollback sub-phases reuse the same emitter with ad-hoc phase strings
(e.g. rollback: stopping failed engine / rollback: restarting prior profile);
those are informational to the TS parent, not part of the D-02 contract.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

# D-02 LOCKED labels — verbatim. Do not edit without a RESEARCH/PLANNING change.
STOPPING: str = "stopping vLLM"
LOADING: str = "loading weights"
WARMUP: str = "warmup"
READY: str = "ready"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit(phase: str, pct: int | None = None) -> None:
    """Emit one JSON line per phase transition to stdout (flush=True).

    The TS parent (profile-swap-runner.ts) reads line-buffered, so flush=True
    is a correctness requirement — without it Python buffers and the TUI
    footer never advances.
    """
    rec: dict[str, object] = {"ts": _now_iso(), "phase": phase}
    if pct is not None:
        rec["pct"] = pct
    # sort_keys=False keeps ts→phase→pct ordering stable for human eyeballing.
    print(json.dumps(rec, sort_keys=False), flush=True)


__all__ = ["emit", "STOPPING", "LOADING", "WARMUP", "READY"]
