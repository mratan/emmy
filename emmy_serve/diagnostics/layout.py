"""EmmyRunLayout — stable artifact paths for boot-failure / kv-finder / thermal / airgap runs.

Shape adapted from /data/projects/setup_local_opencode/dgx_stack/runs/layout.py
(PATTERNS.md Pattern C). Frozen dataclass with property-based paths — callers use
`layout.summary_path` instead of string-concatenating subpaths.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal


_RUN_ID_TS_FORMAT = "%Y%m%dT%H%M%SZ"  # lexicographically sortable in UTC


def new_run_id(*, now: datetime | None = None, suffix_len: int = 6) -> str:
    """Generate a run id as `{UTC-timestamp}_{hex-suffix}`.

    Sortable alphabetically => sortable chronologically. Shape copied from
    `dgx_stack/runs/ids.py` lines 7-31.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    ts = now.astimezone(timezone.utc).strftime(_RUN_ID_TS_FORMAT)
    nbytes = (suffix_len + 1) // 2
    suffix = secrets.token_hex(nbytes)[:suffix_len]
    return f"{ts}_{suffix}"


RunKind = Literal["boot-failure", "kv-finder", "thermal", "airgap", "phase1-validation"]


@dataclass(frozen=True)
class EmmyRunLayout:
    """Frozen artifact-path layout for Phase 1 run directories.

    Four distinct run shapes (boot-failure / kv-finder / thermal / airgap /
    phase1-validation) share a single class parameterised by `kind`; each property
    returns the path for a shape-specific artifact. Unused properties for a given
    kind are harmless — they simply compute a path that no writer targets.
    """

    base_dir: Path
    run_id: str
    kind: RunKind

    def __post_init__(self) -> None:
        # Allow str in, Path out (mirror of dgx_stack idiom)
        object.__setattr__(self, "base_dir", Path(self.base_dir))
        rid = str(self.run_id).strip()
        if not rid:
            raise ValueError("run_id must be a non-empty string")
        object.__setattr__(self, "run_id", rid)

    @property
    def run_dir(self) -> Path:
        return self.base_dir / f"{self.run_id}-{self.kind}"

    # Shared
    @property
    def summary_path(self) -> Path:
        return self.run_dir / "summary.json"

    # Boot-failure specific (D-06 diagnostic bundle)
    @property
    def check_path(self) -> Path:
        return self.run_dir / "check.json"

    @property
    def profile_snapshot_path(self) -> Path:
        return self.run_dir / "profile.json"

    @property
    def prompt_path(self) -> Path:
        return self.run_dir / "prompt.txt"

    @property
    def response_path(self) -> Path:
        return self.run_dir / "response.txt"

    @property
    def docker_logs_path(self) -> Path:
        return self.run_dir / "docker-logs.txt"

    @property
    def env_path(self) -> Path:
        return self.run_dir / "env.json"

    @property
    def metrics_snapshot_path(self) -> Path:
        return self.run_dir / "metrics-snapshot.txt"

    # KV-finder specific
    @property
    def iterations_path(self) -> Path:
        return self.run_dir / "iterations.jsonl"

    # Thermal specific
    @property
    def gpu_samples_path(self) -> Path:
        return self.run_dir / "gpu_samples.jsonl"

    @property
    def vllm_metrics_path(self) -> Path:
        return self.run_dir / "vllm_metrics.jsonl"

    @property
    def responses_path(self) -> Path:
        return self.run_dir / "responses.jsonl"

    @property
    def prompts_used_path(self) -> Path:
        return self.run_dir / "prompts_used.jsonl"

    @property
    def dmesg_tail_path(self) -> Path:
        return self.run_dir / "dmesg_tail.txt"
