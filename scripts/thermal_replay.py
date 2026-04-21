#!/usr/bin/env python3
"""Shim: runs `python -m emmy_serve.thermal.replay` with passed args.

Pitfall #7 discipline: 2-hour thermal replay is the only path to recording
per-profile floors (D-15). Phase 1 first-run records the floors + writes
PROFILE_NOTES.md; subsequent runs assert against the recorded floors.

Usage (Phase B on DGX Spark):

    # First run — discover floors (schedule overnight):
    ./scripts/thermal_replay.py --profile profiles/qwen3.6-35b-a3b/v1 \
        --target-wall-time-s 7200 --record-floors

    # Re-run — assert recorded floors:
    ./scripts/thermal_replay.py --profile profiles/qwen3.6-35b-a3b/v1 \
        --target-wall-time-s 7200 --assert-floors

Pre-condition: emmy-serve vLLM already running at http://127.0.0.1:8002
(via ./scripts/start_emmy.sh). The replay does NOT own the container
lifecycle — it drives the live endpoint for 2 hours with background
GPU + vLLM metrics samplers.
"""
from __future__ import annotations

import sys

from emmy_serve.thermal.replay import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
