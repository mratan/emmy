"""emmy.canary — SP_OK / tool_call / generate canaries + CanaryResult + replay.

EVAL-07: this package is the library every later phase imports. Boot-time
smoke (Phase 1), eval rows (Phase 5), and observability events (Phase 3)
all log ``CanaryResult`` and re-use the three ``run_*`` functions without
re-implementing them.
"""
from __future__ import annotations

from .generate import run_generate
from .logging import CanaryResult, log_canary_event
from .replay import chat_completions, run_replay
from .sp_ok import (
    SP_OK_ASSERTION_SUBSTR,
    SP_OK_SYSTEM_PROMPT,
    SP_OK_USER_MESSAGE,
    run_sp_ok,
)
from .tool_call import (
    TOOL_CALL_SYSTEM_PROMPT,
    TOOL_CALL_USER_MESSAGE,
    load_default_tool_schema,
    run_tool_call,
)

__all__ = [
    "run_sp_ok",
    "run_tool_call",
    "run_generate",
    "run_replay",
    "chat_completions",
    "SP_OK_SYSTEM_PROMPT",
    "SP_OK_USER_MESSAGE",
    "SP_OK_ASSERTION_SUBSTR",
    "TOOL_CALL_SYSTEM_PROMPT",
    "TOOL_CALL_USER_MESSAGE",
    "load_default_tool_schema",
    "CanaryResult",
    "log_canary_event",
]
