"""100-token generation smoke — RESEARCH.md §7.4.

Exercises decode under load and emits the throughput number
start_emmy.sh prints in the ready banner (SC-1 assertion ≥ 60 tok/s
on DGX Spark).
"""
from __future__ import annotations

import time

import httpx


def run_generate(base_url: str, served_model_name: str) -> tuple[bool, dict, float]:
    """Returns (ok, data, elapsed_seconds).

    ``chat_template_kwargs.enable_thinking=false`` isolates raw decode throughput
    from a reasoning-capable model's CoT emission. Without this, Qwen3.6-class
    models spend the 100-token budget on "Thinking Process:" prose rather than
    the requested count, producing a tok/s reading that measures thinking
    throughput rather than decode throughput. Non-thinking models / vLLM
    versions without this hook ignore the field.
    """
    payload = {
        "model": served_model_name,
        "messages": [
            {"role": "user", "content": "Count from 1 to 100, one number per line."}
        ],
        "temperature": 0.0,
        "max_tokens": 100,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    t0 = time.monotonic()
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=120.0)
    elapsed = time.monotonic() - t0
    r.raise_for_status()
    data = r.json()
    out = data["choices"][0]["message"]["content"] or ""
    finish = data["choices"][0].get("finish_reason")
    ok = bool(out) and finish in ("length", "stop") and len(out) > 50
    return ok, data, elapsed
