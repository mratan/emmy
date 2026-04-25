"""Server-side metric adapters for the sidecar's GET /status payload
(Phase 04.2 Plan 01 Task 2).

Two pieces, both with 1-second TTL caches per CONTEXT D-07 ("cache for 1s
to avoid stampedes" — bounds subprocess + HTTP fire-rate regardless of how
many pollers (Mac footer, scripts, ad-hoc curl) hit /status concurrently):

1. ``fetch_vllm_metrics_cached(base_url)`` — async sibling of
   ``emmy_serve/kv_finder/metrics.scrape_metrics``. Pulls the
   Prometheus-format /metrics endpoint from the loopback vLLM container
   using ``httpx.AsyncClient`` (sync httpx.get would block FastAPI's loop).
   Returns the raw ``{metric_name: value}`` dict; the controller picks out
   ``vllm:gpu_cache_usage_perc`` → ``kv_used_pct`` and
   ``vllm:num_requests_running`` → ``in_flight``.

2. ``sample_gpu_temp_cached()`` — sync subprocess to
   ``nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits``.
   Reuses the ``_NA_SENTINELS`` + ``_parse_float_or_none`` discipline from
   ``emmy_serve/thermal/sampler.py:42-56`` (DGX Spark UMA returns
   ``[N/A]`` for memory.used; same pattern applies if temperature.gpu ever
   degrades).

Test reset hook (``_reset_caches_for_tests``): module-level caches survive
across pytest cases within a session, so tests must clear them before each
case to avoid stale-cache flake. Mirrors web-search.ts
``__resetSearchCountForTests`` discipline.
"""
from __future__ import annotations

import asyncio
import subprocess
import time

import httpx
from prometheus_client.parser import text_string_to_metric_families


# nvidia-smi CSV sentinels — same set as thermal/sampler.py for consistency
# (DGX Spark UMA reports `[N/A]` for memory.used; we treat any of these as
# "value not available, return None").
_NA_SENTINELS = frozenset({"[n/a]", "n/a", "", "nan"})

# 1-second TTL caches per CONTEXT D-07. Module-level so concurrent FastAPI
# handlers share a single cache; asyncio handlers run on one event-loop
# thread, so a plain tuple read/write is race-free without a Lock.
_metrics_cache: tuple[float, dict[str, float]] | None = None
_temp_cache: tuple[float, float | None] | None = None


# --- vLLM /metrics fetcher ---------------------------------------------------


async def fetch_vllm_metrics(
    base_url: str = "http://127.0.0.1:8002",
    timeout_s: float = 2.0,
) -> dict[str, float]:
    """Async fetch + parse of vLLM's Prometheus /metrics endpoint.

    Sibling of the synchronous ``emmy_serve.kv_finder.metrics.scrape_metrics``;
    the async variant is mandatory inside FastAPI handlers (sync httpx.get
    would block the event loop and starve other endpoints during a /status
    burst).

    Raises:
        ``httpx.HTTPError`` (or subclass) on connection refusal, timeout,
        or non-2xx response. The caller (controller.py /status handler)
        catches and treats as ``vllm_up=False``.
    """
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.get(f"{base_url.rstrip('/')}/metrics")
        r.raise_for_status()
    out: dict[str, float] = {}
    for family in text_string_to_metric_families(r.text):
        for sample in family.samples:
            out[sample.name] = float(sample.value)
    return out


async def fetch_vllm_metrics_cached(
    base_url: str = "http://127.0.0.1:8002",
) -> dict[str, float]:
    """1-second TTL wrapper around :func:`fetch_vllm_metrics`.

    First call within any 1-second window issues HTTP; subsequent calls
    return the cached dict. After 1.0s elapses, the next call refreshes.
    Per CONTEXT D-07: bounds /metrics fire-rate regardless of poller count.
    """
    global _metrics_cache
    now = time.monotonic()
    if _metrics_cache is not None and (now - _metrics_cache[0]) < 1.0:
        return _metrics_cache[1]
    val = await fetch_vllm_metrics(base_url)
    _metrics_cache = (now, val)
    return val


# --- nvidia-smi temperature sampler ------------------------------------------


def _parse_float_or_none(raw: str) -> float | None:
    """Parse one nvidia-smi CSV cell; return None on sentinel or ValueError.

    Lifted verbatim from emmy_serve/thermal/sampler.py — kept as a private
    helper here so this module has no inter-package coupling beyond
    httpx + prometheus_client (its declared dependencies).
    """
    s = (raw or "").strip()
    if s.casefold() in _NA_SENTINELS:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def sample_gpu_temp() -> float | None:
    """Subprocess one ``nvidia-smi`` query for the GPU temperature in °C.

    Returns ``None`` on:
        - subprocess timeout / nvidia-smi missing / OS error
        - non-zero return code from nvidia-smi
        - parsed cell is an _NA_SENTINELS value (``[N/A]``, ``N/A``, ``""``, ``nan``)
        - cell isn't a valid float

    Sync (not async) because subprocess.run with capture_output=True is fast
    enough (~30ms on Spark per RESEARCH §7) and FastAPI runs sync handler
    code in a thread pool — wrapping in async would just add ceremony.
    """
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=3.0,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    if r.returncode != 0:
        return None
    line = r.stdout.strip().split("\n")[0]
    return _parse_float_or_none(line)


def sample_gpu_temp_cached() -> float | None:
    """1-second TTL wrapper around :func:`sample_gpu_temp`.

    Same caching discipline as :func:`fetch_vllm_metrics_cached`: bounds the
    nvidia-smi subprocess fire-rate regardless of /status poll cadence.
    """
    global _temp_cache
    now = time.monotonic()
    if _temp_cache is not None and (now - _temp_cache[0]) < 1.0:
        return _temp_cache[1]
    val = sample_gpu_temp()
    _temp_cache = (now, val)
    return val


# --- test-only cache reset --------------------------------------------------


def _reset_caches_for_tests() -> None:
    """Clear both caches; intended for pytest autouse fixtures.

    Public name uses a single-underscore prefix (not a dunder) so pytest's
    autouse fixture can import it cleanly without name-mangling. Tests in
    test_sidecar_status.py import this and call it before each test.
    """
    global _metrics_cache, _temp_cache
    _metrics_cache = None
    _temp_cache = None


__all__ = [
    "fetch_vllm_metrics",
    "fetch_vllm_metrics_cached",
    "sample_gpu_temp",
    "sample_gpu_temp_cached",
    "_reset_caches_for_tests",
]
