#!/usr/bin/env python3
"""Shim: runs `python -m emmy_serve.airgap.validator` with forwarded args.

Used by the air-gap CI workflow (`.github/workflows/airgap.yml`) and by
hand during the Phase 1 local proof (see `docs/profile-immutability.md`).

Usage:
    scripts/airgap_probe.py pre-boot --profile profiles/gemma-4-26b-a4b-it/v2
    scripts/airgap_probe.py post-boot --container emmy-serve --out report.json

Exit codes match emmy_serve.airgap.validator.main:
    0 — pass
    1 — any layer / policy failure
"""
from __future__ import annotations

import sys

from emmy_serve.airgap.validator import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
