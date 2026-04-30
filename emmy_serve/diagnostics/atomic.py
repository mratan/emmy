"""Atomic writers for event streams and diagnostic artifacts.

Copied VERBATIM in shape from /data/projects/setup_local_opencode/dgx_stack/runs/write.py
(47-line reference impl per 01-PATTERNS.md Pattern B). Emmy adds `append_jsonl_atomic`
for JSONL event streams (KV-finder iterations, thermal samples, canary log).

Invariants preserved from analog:
- Temp file created in the SAME directory as destination (so os.replace is atomic).
- Dot-prefix temp name so `ls` hides the temporary files.
- flush() -> os.fsync() -> os.replace() ordering for durability.
- Cleanup in finally block (no-op when replace succeeded).
- write_json_atomic forces ensure_ascii=True, sort_keys=True, indent=2 for determinism.
"""
from __future__ import annotations

import fcntl
import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_bytes_atomic(path: str | Path, data: bytes) -> None:
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            delete=False,
            dir=str(dest.parent),
            prefix=f".{dest.name}.",
            suffix=".tmp",
        ) as f:
            tmp_path = Path(f.name)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())

        os.replace(tmp_path, dest)
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                # Best-effort cleanup; the destination may have replaced it.
                pass


def write_text_atomic(path: str | Path, text: str, *, encoding: str = "utf-8") -> None:
    if not text.endswith("\n"):
        text = text + "\n"
    write_bytes_atomic(path, text.encode(encoding))


def write_json_atomic(path: str | Path, obj: Any) -> None:
    payload = json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
    write_text_atomic(path, payload)


def append_jsonl_atomic(path: str | Path, obj: dict) -> None:
    """Append one JSON line, fsync'd, under an advisory exclusive flock.

    For event streams (KV-finder iterations, thermal samples, ask_claude
    audit log). Each call appends one line and fsyncs; a crash mid-run
    still preserves every previously-completed iteration.

    WR-04 (Phase 04.6 review) — Linux's atomic-append guarantee for
    O_APPEND writes only holds for payloads ≤ PIPE_BUF (typically 4096
    bytes). When EMMY_LOG_FULL=on, ask_claude events can carry the full
    prompt + response (up to ~200 KiB), and a sidecar restart-during-
    in-flight scenario can have two writers active simultaneously. The
    advisory exclusive flock serializes writers within a host so lines
    cannot interleave; every emmy writer goes through this helper, so
    the convention is enforceable. Flock is per-fd, so a single process
    making nested append_jsonl_atomic calls re-acquires correctly (POSIX
    flock semantics on the same open file description).
    """
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n"
    with open(dest, "a", encoding="utf-8") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.write(line)
            f.flush()
            os.fsync(f.fileno())
        finally:
            # Lock is released automatically on close, but unlocking
            # explicitly keeps the contention window tight if the caller
            # holds the file handle for any reason in the future.
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
