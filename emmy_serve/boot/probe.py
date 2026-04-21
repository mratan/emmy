"""Poll /v1/models until 200 OK or timeout. Per RESEARCH.md §7.1.

This is the boot-probe gate: start_emmy.sh invokes wait_for_vllm after
docker run, and the subsequent smoke checks only run once /v1/models
returns 200. A timeout raises TimeoutError with the last error message
for the D-06 diagnostic bundle.
"""
from __future__ import annotations

import time

import httpx


def wait_for_vllm(
    base_url: str, timeout_s: int = 300, interval_s: float = 0.5
) -> dict:
    """Poll /v1/models until 200 OK or timeout. Returns parsed JSON."""
    deadline = time.monotonic() + timeout_s
    last_err: str | None = None
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{base_url}/v1/models", timeout=5.0)
            if r.status_code == 200:
                return r.json()
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except httpx.HTTPError as e:
            last_err = str(e)
        time.sleep(interval_s)
    raise TimeoutError(
        f"/v1/models did not respond in {timeout_s}s; last error: {last_err}"
    )
