"""50-turn session replay (D-11). Measures wire format round-trips.

Consumed by Plan 05's airgap CI workflow: replay a scripted session of 50
turns exercising every tool type; assert the tool-call round-trip shape
survives the trip (D-12 layer a: zero non-loopback packets is structural
via --network none; this replay validates that the wire format itself is
stable across that boundary).
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx


def chat_completions(
    base_url: str,
    served_model_name: str,
    history: list,
    *,
    tools: list | None = None,
) -> dict:
    """Single /v1/chat/completions call with deterministic sampling."""
    payload = {
        "model": served_model_name,
        "messages": history,
        "temperature": 0.0,
        "max_tokens": 256,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=120.0)
    r.raise_for_status()
    return r.json()


def run_replay(
    base_url: str,
    served_model_name: str,
    session_path: Path,
    tools: list | None = None,
) -> None:
    """Replay ``session.jsonl`` one turn at a time, asserting tool_call turns."""
    history: list[dict] = []
    turns = [
        json.loads(line)
        for line in session_path.read_text().splitlines()
        if line.strip()
    ]
    i = 0
    while i < len(turns):
        turn = turns[i]
        if turn["role"] == "user":
            history.append({"role": "user", "content": turn["content"]})
            resp = chat_completions(base_url, served_model_name, history, tools=tools)
            msg = resp["choices"][0]["message"]
            history.append(msg)
            if turn.get("_expected_tool_call") is not None:
                assert msg.get("tool_calls"), (
                    f"Turn {turn['turn']}: expected tool_call, got {msg}"
                )
            i += 1
        elif turn["role"] == "tool":
            history.append(
                {
                    "role": "tool",
                    "tool_call_id": turn["tool_call_id"],
                    "content": turn["content"],
                }
            )
            i += 1
        else:
            i += 1
