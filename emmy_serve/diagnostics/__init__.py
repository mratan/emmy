"""Emmy serving-layer diagnostics: atomic writers + run-layout.

Shape copied from the prior repo `dgx_stack/runs/` pattern (PATTERNS.md Pattern B, C).
"""
from __future__ import annotations

from .atomic import (
    append_jsonl_atomic,
    write_bytes_atomic,
    write_json_atomic,
    write_text_atomic,
)
from .layout import EmmyRunLayout, RunKind, new_run_id

__all__ = [
    "append_jsonl_atomic",
    "write_bytes_atomic",
    "write_json_atomic",
    "write_text_atomic",
    "EmmyRunLayout",
    "RunKind",
    "new_run_id",
]
