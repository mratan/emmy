"""Canary event logging — RESEARCH.md §7.6.

``CanaryResult`` is the 8-field dataclass every later phase logs for every
canary invocation (boot-time smoke, Phase-5 eval rows, Phase-3 observability
bus). ``log_canary_event`` writes one JSON line via append_jsonl_atomic so a
crash mid-run still preserves every completed canary.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

from ..diagnostics.atomic import append_jsonl_atomic


@dataclass(frozen=True)
class CanaryResult:
    """8 required fields + 1 optional excerpt per RESEARCH.md §7.6.

    Fields:
      check              — short id ("sp_ok", "tool_call", "generate", ...)
      ok                 — boolean pass/fail
      elapsed_ms         — wall-clock for the canary call
      profile_id         — ProfileRef.id
      profile_version    — ProfileRef.version
      profile_hash       — ProfileRef.hash ("sha256:<64-hex>")
      served_model_name  — engine.served_model_name
      ts                 — ISO8601 UTC ("YYYY-MM-DDTHH:MM:SSZ")
      response_excerpt   — optional (≤ 200 chars) slice of the model output
    """

    check: str
    ok: bool
    elapsed_ms: int
    profile_id: str
    profile_version: str
    profile_hash: str
    served_model_name: str
    ts: str
    response_excerpt: str = ""


def log_canary_event(jsonl_path: Path, result: CanaryResult) -> None:
    """Append a single CanaryResult as one JSON line."""
    append_jsonl_atomic(jsonl_path, asdict(result))
