#!/usr/bin/env python3
"""Shim: equivalent to `emmy profile hash <path>`.

Exists so CI workflows and start_emmy.sh can invoke a predictable file-path
target without depending on the `emmy` console-script entry being registered
in the current Python environment (01-PATTERNS.md Pattern E).
"""
from __future__ import annotations

import sys

from emmy_serve.cli import main

if __name__ == "__main__":
    sys.exit(main(["profile", "hash", *sys.argv[1:]]))
