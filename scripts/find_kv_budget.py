#!/usr/bin/env python3
"""Shim: runs `python -m emmy_serve.kv_finder.bisect` with passed args.

Pitfall #1 discipline: this script is the ONLY committed code path that
writes ``serving.yaml.engine.gpu_memory_utilization``. Every other edit
to that field is blocked by the immutability validator + CI hash check.

Usage (Phase B on DGX Spark):
    ./scripts/find_kv_budget.py --profile profiles/gemma-4-26b-a4b-it/v2 \
        --drive-minutes 10 --max-iters 12

Wall-clock budget per RESEARCH.md §8 "Wall-clock budget estimate":
    ~13.5 min per iteration × 5-8 iterations = 70-110 minutes total.

The script does NOT own the container lifecycle: it calls
``./scripts/start_emmy.sh`` between iterations and ``docker stop emmy-serve``
after each drive. Ensure no stale emmy-serve container is running before
the first invocation.
"""
from __future__ import annotations

import sys

from emmy_serve.kv_finder.bisect import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
