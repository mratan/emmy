"""WR-04 (Phase 04.6 review) — concurrent writers MUST NOT interleave.

Linux's atomic-append guarantee for O_APPEND only holds for payloads ≤
PIPE_BUF (typically 4096 bytes). When EMMY_LOG_FULL=on, ask_claude
events can carry a full prompt + response (up to ~200 KiB), and a
sidecar restart-during-in-flight scenario can have two writers active
simultaneously. The advisory exclusive flock around the write +
fflush + fsync window serializes writers within a host so lines cannot
interleave.

Strategy: drive 50 concurrent appends from a ProcessPoolExecutor (real
processes, not threads — flock is enforced per-fd by the kernel and we
need real concurrency). Assert every line parses as valid JSON.
"""
from __future__ import annotations

import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from emmy_serve.diagnostics.atomic import append_jsonl_atomic


# Module-level helper so it's picklable for ProcessPoolExecutor.
def _writer(target: str, idx: int) -> None:
    # Big payload that comfortably exceeds PIPE_BUF (4096) on any sane
    # Linux, so we exercise the flock path rather than relying on the
    # kernel's small-write atomic-append guarantee.
    payload = {
        "idx": idx,
        # ~5000 chars of distinctive text per writer; all-ASCII so JSON
        # encoding is byte-stable.
        "blob": f"writer-{idx:03d}-" * 250,
    }
    append_jsonl_atomic(target, payload)


def test_concurrent_writers_do_not_interleave(tmp_path: Path) -> None:
    target = tmp_path / "concurrent.jsonl"
    n = 50

    with ProcessPoolExecutor(max_workers=8) as pool:
        list(pool.map(_writer, [str(target)] * n, list(range(n))))

    # Every line must parse as JSON; no interleaving.
    text = target.read_text()
    lines = text.splitlines()
    assert len(lines) == n, (
        f"expected {n} lines, got {len(lines)} — concurrent appends interleaved"
    )

    seen_idx: set[int] = set()
    for ln in lines:
        obj = json.loads(ln)  # raises if interleaved
        assert "idx" in obj, ln
        assert "blob" in obj, ln
        # The blob must round-trip cleanly: prefix matches "writer-NNN-"
        # repeated 250×.
        expected_blob = f"writer-{obj['idx']:03d}-" * 250
        assert obj["blob"] == expected_blob, (
            f"blob corruption for idx={obj['idx']}: {obj['blob'][:80]!r}"
        )
        seen_idx.add(obj["idx"])

    assert seen_idx == set(range(n)), (
        f"missing/duplicated indices: {sorted(seen_idx)}"
    )
