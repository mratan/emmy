"""SP_OK canary (D-07) — EXACT payload per RESEARCH.md §7.2.

This canary is shipped in Phase 1 and re-used by every later phase
(EVAL-07). The system prompt + literal ``[SP_OK]`` assertion-token
catches the Pitfall #2 silent-system-prompt-delivery failure mode
(prior-repo Phase 3 incident).
"""
from __future__ import annotations

import httpx

SP_OK_SYSTEM_PROMPT = (
    "When the user says 'ping' you must reply with the exact literal text "
    "[SP_OK] and nothing else."
)
SP_OK_USER_MESSAGE = "ping"
SP_OK_ASSERTION_SUBSTR = "[SP_OK]"


def run_sp_ok(base_url: str, served_model_name: str) -> tuple[bool, str]:
    """Returns (ok, full_response_text)."""
    payload = {
        "model": served_model_name,
        "messages": [
            {"role": "system", "content": SP_OK_SYSTEM_PROMPT},
            {"role": "user", "content": SP_OK_USER_MESSAGE},
        ],
        "temperature": 0.0,
        "max_tokens": 32,
        "stream": False,
    }
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=60.0)
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"] or ""
    return (SP_OK_ASSERTION_SUBSTR in text), text
