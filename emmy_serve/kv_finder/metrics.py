"""Parse vLLM's Prometheus /metrics endpoint.

References:
- RESEARCH.md §8 lines 1290-1298 (failure detection + metric names)
- RESEARCH.md §"Code Examples" lines 2048-2061 (prometheus_client usage)

Verified at execution time (2026-04-21) against a live vLLM 0.17.1+nvinternal
instance at http://127.0.0.1:8002/metrics; the observed metrics include
``vllm:num_preemptions_total``, ``vllm:kv_cache_usage_perc``,
``vllm:num_requests_running``, ``vllm:num_requests_waiting`` (note: the
older ``vllm:num_requests_swapped`` is not emitted by this vLLM build —
``vllm:num_requests_waiting`` is the live signal for KV-pressure queuing).

The parser is intentionally *permissive*: unknown metrics are dropped,
not raised. That matches the failure-detection philosophy (§8 line 1297:
"any non-zero delta over the iteration") — we sample relative deltas and
compute safety decisions from the deltas, not absolute presence.
"""
from __future__ import annotations

import httpx
from prometheus_client.parser import text_string_to_metric_families


# Metrics we actively consume in the finder / thermal runs. Keep this set tiny
# — every entry has a semantic contract, not a "might be useful someday" hope.
_WATCHED_METRICS = frozenset(
    {
        "vllm:num_preemptions_total",
        "vllm:num_requests_swapped",  # legacy, may be absent in vLLM 0.17+
        "vllm:kv_cache_usage_perc",
        "vllm:num_running_requests",  # legacy spelling
        "vllm:num_requests_running",  # current (vLLM 0.17+)
        "vllm:num_waiting_requests",  # legacy spelling
        "vllm:num_requests_waiting",  # current (vLLM 0.17+)
    }
)


def parse_preemption_metrics(text: str) -> dict[str, float]:
    """Return a ``{metric_name: float}`` dict for the watched KV-relevant metrics.

    Absent metrics are silently omitted. This lets the finder be tolerant of
    vLLM version drift — the bisection logic checks for deltas on whatever
    is present, not "preemption counter missing → abort".
    """
    out: dict[str, float] = {}
    if not text:
        return out
    for fam in text_string_to_metric_families(text):
        for sample in fam.samples:
            if sample.name in _WATCHED_METRICS:
                # If a labelled counter appears multiple times (e.g. one per engine),
                # sum the values — matches the semantics of "total preemptions
                # across the service".
                prev = out.get(sample.name, 0.0)
                out[sample.name] = prev + float(sample.value)
    return out


def scrape_metrics(base_url: str, timeout_s: float = 5.0) -> dict[str, float]:
    """GET ``{base_url}/metrics`` and parse with :func:`parse_preemption_metrics`.

    Raises :class:`httpx.HTTPError` (or a subclass) on network failure;
    the caller decides how to handle — the finder treats scrape failures
    as "unknown" and relies on the preemption delta (observed → 0.0) to
    not blow up.
    """
    r = httpx.get(f"{base_url}/metrics", timeout=timeout_s)
    r.raise_for_status()
    return parse_preemption_metrics(r.text)


__all__ = ["parse_preemption_metrics", "scrape_metrics"]
