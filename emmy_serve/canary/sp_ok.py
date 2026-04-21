"""SP_OK canary (D-07) — payload per RESEARCH.md §7.2, with thinking disabled.

This canary is shipped in Phase 1 and re-used by every later phase
(EVAL-07). The system prompt + literal ``[SP_OK]`` assertion-token
catches the Pitfall #2 silent-system-prompt-delivery failure mode
(prior-repo Phase 3 incident).

Deviation from §7.2 (documented in 01-03-SUMMARY.md): ``extra_body`` carries
``{"chat_template_kwargs": {"enable_thinking": false}}`` so the 32-token budget
isn't consumed by a reasoning-capable model's CoT before it emits the literal
assertion. Without this, Qwen3.6-A3B's default thinking mode spends the entire
budget on "Thinking Process:" reasoning and never reaches ``[SP_OK]`` —
producing a false-negative canary failure that isn't actually a system-prompt
delivery bug. The canary's purpose is to prove the system prompt reached the
model; disabling thinking isolates that signal from thinking-mode behavior.
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
        # Disable thinking so the 32-token budget isn't spent on CoT. This field
        # lives at the top level of the request body (vLLM ignores ``extra_body``,
        # which is an OpenAI SDK client concept, not a server field). Non-thinking
        # models or vLLM versions without this hook simply ignore it.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=60.0)
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"] or ""
    return (SP_OK_ASSERTION_SUBSTR in text), text
