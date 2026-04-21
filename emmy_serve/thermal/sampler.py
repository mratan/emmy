"""Background samplers for the 2-hour thermal replay (RESEARCH.md §9.6).

Two threads run for the duration of the replay:

- ``GpuSampler`` polls ``nvidia-smi --query-gpu=...`` every ``interval_s``
  seconds and appends each sample to ``gpu_samples.jsonl``.
- ``VllmMetricsSampler`` scrapes ``/metrics`` and appends to ``vllm_metrics.jsonl``.

Both use :func:`emmy_serve.diagnostics.atomic.append_jsonl_atomic` — each
line is fsync'd before the next poll, so a crash mid-run preserves every
sample captured up to that point (the prior-repo pattern; see §9.6 cadence
of 1440 samples per 2h at 5s interval).

nvidia-smi runs on the host, not inside the NGC container (§9.6); the
``GpuSampler`` invokes the host binary via subprocess. If nvidia-smi is
missing or permission-denied, samples are dropped silently — the thermal
floor computation tolerates missing GPU rows (``compute_floors()`` falls
back to decode-throughput floor alone if no GPU samples exist).
"""
from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path

from ..diagnostics.atomic import append_jsonl_atomic
from ..kv_finder.metrics import scrape_metrics


class GpuSampler(threading.Thread):
    """Poll ``nvidia-smi`` every ``interval_s`` seconds.

    Each row of the JSONL output has the shape::

        {"ts": "<nvidia-smi local timestamp>",
         "gpu_util_pct": <float>,
         "gpu_clock_mhz": <float>,
         "gpu_temp_c": <float>,
         "memory_used_mb": <float>,
         "t_elapsed": <float seconds since start>}

    ``t_elapsed`` is the monotonic seconds since ``t_start`` (the replay's
    start time) — ``compute_floors()`` filters to ``t_elapsed >= 3600`` to
    isolate the hour-2 steady-state signal.
    """

    def __init__(
        self,
        jsonl_path: Path,
        interval_s: float = 5.0,
        t_start: float | None = None,
    ) -> None:
        super().__init__(daemon=True)
        self.jsonl_path = Path(jsonl_path)
        self.interval_s = interval_s
        self.t_start = t_start if t_start is not None else time.monotonic()
        self.stop_evt = threading.Event()

    def stop(self) -> None:
        self.stop_evt.set()

    def run(self) -> None:
        while not self.stop_evt.is_set():
            sample = self._sample()
            if sample is not None:
                sample["t_elapsed"] = round(time.monotonic() - self.t_start, 3)
                try:
                    append_jsonl_atomic(self.jsonl_path, sample)
                except OSError:
                    # Disk full / permissions error — drop the sample; never
                    # kill the replay. The summary compute tolerates gaps.
                    pass
            # Use event.wait so stop() interrupts immediately (no 5s lag on shutdown).
            self.stop_evt.wait(self.interval_s)

    @staticmethod
    def _sample() -> dict | None:
        """Return one nvidia-smi sample or None if unavailable.

        Query fields (in order): timestamp, utilization.gpu,
        clocks.current.graphics, temperature.gpu, memory.used.
        """
        try:
            out = subprocess.check_output(
                [
                    "nvidia-smi",
                    "--query-gpu=timestamp,utilization.gpu,"
                    "clocks.current.graphics,temperature.gpu,memory.used",
                    "--format=csv,noheader,nounits",
                ],
                timeout=5,
                text=True,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            return None
        lines = [line.strip() for line in out.strip().splitlines() if line.strip()]
        if not lines:
            return None
        parts = [p.strip() for p in lines[0].split(",")]
        if len(parts) < 5:
            return None
        ts, util, clock, temp, mem = parts
        try:
            return {
                "ts": ts,
                "gpu_util_pct": float(util),
                "gpu_clock_mhz": float(clock),
                "gpu_temp_c": float(temp),
                "memory_used_mb": float(mem),
            }
        except ValueError:
            return None


class VllmMetricsSampler(threading.Thread):
    """Poll vLLM ``/metrics`` every ``interval_s`` seconds.

    Each row has the shape::

        {<metric_name>: <float>, ...,
         "ts": "<ISO 8601 UTC>",
         "t_elapsed": <float>}

    Uses :func:`emmy_serve.kv_finder.metrics.scrape_metrics`. Missing
    metrics (e.g. ``vllm:num_requests_swapped`` on newer vLLM) are simply
    absent from the row — ``compute_floors()`` computes delta only across
    rows where the metric is present.
    """

    def __init__(
        self,
        jsonl_path: Path,
        base_url: str,
        interval_s: float = 5.0,
        t_start: float | None = None,
    ) -> None:
        super().__init__(daemon=True)
        self.jsonl_path = Path(jsonl_path)
        self.base_url = base_url
        self.interval_s = interval_s
        self.t_start = t_start if t_start is not None else time.monotonic()
        self.stop_evt = threading.Event()

    def stop(self) -> None:
        self.stop_evt.set()

    def run(self) -> None:
        while not self.stop_evt.is_set():
            row: dict = {}
            try:
                row = dict(scrape_metrics(self.base_url))
            except Exception:
                # Transient scrape failure — skip this tick.
                self.stop_evt.wait(self.interval_s)
                continue
            row["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            row["t_elapsed"] = round(time.monotonic() - self.t_start, 3)
            try:
                append_jsonl_atomic(self.jsonl_path, row)
            except OSError:
                pass
            self.stop_evt.wait(self.interval_s)


__all__ = ["GpuSampler", "VllmMetricsSampler"]
