"""RED skeleton — REPRO-03 `air_gap/session.jsonl` 50-turn scripted replay.

Plan 05 writes the 50-turn session per 01-RESEARCH.md §10.3.
"""
from __future__ import annotations
import json
from pathlib import Path
import pytest

# Defensive import-guard so the file is always collectible even before deps land.
# Uniform "every unit test file uses importorskip" convention; json is stdlib.
pytest.importorskip("json")  # marker for the convention (see 01-01-PLAN.md)

SESSION_PATH = Path(__file__).parent.parent.parent / "air_gap" / "session.jsonl"


def _skip_if_no_session() -> Path:
    if not SESSION_PATH.exists():
        pytest.skip(f"{SESSION_PATH} not yet created (Plan 05)")
    return SESSION_PATH


def _load_rows() -> list[dict]:
    lines = [
        line
        for line in _skip_if_no_session().read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return [json.loads(line) for line in lines]


def test_all_rows_valid_json():
    """REPRO-03: every non-empty line parses with json.loads."""
    rows = _load_rows()
    assert rows, "session.jsonl has no non-empty rows"


def test_exactly_50_turns():
    """§10.3: exactly 50 non-empty lines (one per turn)."""
    rows = _load_rows()
    assert len(rows) == 50, f"expected 50 turns, got {len(rows)}"


def test_every_tool_type_present():
    """§10.3: union of tool_calls[].name must cover 8 tool types."""
    rows = _load_rows()
    seen: set[str] = set()
    for row in rows:
        for tc in row.get("tool_calls", []) or []:
            name = tc.get("name")
            if name:
                seen.add(name)
        # Also count `_expected_tool_call`, which represents the shape the
        # scripted assistant should emit (§10.3 example)
        exp = row.get("_expected_tool_call")
        if exp and exp.get("name"):
            seen.add(exp["name"])

    required = {"read", "write", "edit", "bash", "grep", "find", "ls", "web_fetch"}
    missing = required - seen
    assert not missing, f"tool types missing from session: {missing}"


def test_context_growing_turns_present():
    """§10.3 'context-growing' rows: at least 5 turns have history length > 10."""
    rows = _load_rows()
    # Approximation: turns 43-50 (§10.3 table pattern) qualify; assert the file
    # contains user-role entries with `history_depth`/`turn` values in that band
    growing = [
        r for r in rows if r.get("role") == "user" and r.get("turn", 0) >= 41
    ]
    assert len(growing) >= 5, f"only {len(growing)} context-growing turns in the upper band"


def test_has_required_fields():
    """Every row must have `turn`, `role`, and one of content / tool_calls / tool_call_id."""
    rows = _load_rows()
    for row in rows:
        assert "turn" in row, f"row missing 'turn': {row}"
        assert "role" in row, f"row missing 'role': {row}"
        has_payload = (
            "content" in row
            or "tool_calls" in row
            or "tool_call_id" in row
        )
        assert has_payload, f"row missing payload (content/tool_calls/tool_call_id): {row}"
