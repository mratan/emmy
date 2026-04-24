"""Tool-call smoke (D-08) — RESEARCH.md §7.3.

Minimal one-tool canary: asks the model to call ``read_file(path=...)``
and asserts exactly one ``tool_calls`` entry with parseable ``arguments``
containing ``path``. Catches the Hermes-XML vs OpenAI-format mismatch
without needing XGrammar (whose parse-rate gate lives in Phase 2).
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

TOOL_CALL_SYSTEM_PROMPT = (
    "You have one tool available: read_file(path: string). "
    "When the user asks you to call a tool, call it. Do not explain."
)
TOOL_CALL_USER_MESSAGE = "call the tool read_file with path=/tmp/nothing.txt"


def load_default_tool_schema() -> dict:
    """Load read_file schema from ``emmy_serve/canary/tool_schemas/read_file.json``.

    Option A per RESEARCH.md §7.7: schema lives inside the emmy_serve package
    so the canary stays self-contained across profiles (profile-owned schemas
    arrive in Phase 2 with the harness).
    """
    p = Path(__file__).parent / "tool_schemas" / "read_file.json"
    return json.loads(p.read_text(encoding="utf-8"))


def run_tool_call(
    base_url: str, served_model_name: str, tool_schema: dict
) -> tuple[bool, dict]:
    """Returns (ok, assistant_message). ok requires exactly one parseable read_file call."""
    payload = {
        "model": served_model_name,
        "messages": [
            {"role": "system", "content": TOOL_CALL_SYSTEM_PROMPT},
            {"role": "user", "content": TOOL_CALL_USER_MESSAGE},
        ],
        "tools": [tool_schema],
        "tool_choice": "auto",
        "temperature": 0.0,
        "max_tokens": 2048,
        "stream": False,
    }
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=60.0)
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    tcs = msg.get("tool_calls") or []
    if len(tcs) != 1:
        return False, msg
    tc = tcs[0]
    if tc.get("function", {}).get("name") != "read_file":
        return False, msg
    try:
        args = json.loads(tc["function"]["arguments"])
    except (json.JSONDecodeError, KeyError, TypeError):
        return False, msg
    if "path" not in args:
        return False, msg
    return True, msg
