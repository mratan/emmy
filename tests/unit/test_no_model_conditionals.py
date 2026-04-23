# tests/unit/test_no_model_conditionals.py
#
# D-19 LOCKED audit. Two modes:
#   1. Self-test: target the fixture file, REQUIRE the audit to fire.
#   2. Real mode: walk the Python source tree ex. fixture/allowlist, REQUIRE zero hits.
#
# If either mode flips to the wrong outcome, the audit is broken.
#
# This test enforces Phase 4 SC-2 verbatim: "neither profile contains
# model-name-conditional code paths in the harness or serve layers — all
# model-shaped behavior is in YAML." It is a COMMITTED test (not a lint rule)
# that runs on every `uv run pytest tests/unit/` CI pass.
#
# Allowlist discipline (documented here VERBATIM per the plan's key_links):
#   Directory names (matched as path components anywhere in the walk — catches
#   nested .venv / node_modules inside .claude/worktrees/*/, etc.):
#       profiles/          — YAML/MD content NAMES models; it's data, not code
#       tests/fixtures/    — deliberate positives; caught by self-test only
#       .venv              — third-party Python deps
#       node_modules       — third-party JS/TS deps
#       runs               — evidence/outputs; may contain model names in JSON logs
#       .planning          — markdown docs name models by design
#       docs               — markdown docs
#       dist               — build output
#       build              — build output
#       .git               — git internals
#       .pytest_cache      — test runner cache
#       __pycache__        — Python bytecode cache
#       .claude            — agent tooling + parallel worktrees (each has nested .venv)
#       .mypy_cache        — type-checker cache
#       .ruff_cache        — linter cache
#
#   Explicit file allowlist (absolute paths):
#       tests/unit/test_no_model_conditionals.py  — this file itself contains the regex
from __future__ import annotations

import re
from pathlib import Path

import pytest

# Case-insensitive; matches conditional keyword + model name on the SAME LINE.
# Intentionally strict about the conditional boundary — we don't flag names that
# appear in comments (handled by _find_hits's comment skip) or in non-conditional
# contexts. Keywords cover Python (if/elif/else/match/case), plus common
# cross-language forms (switch/when) so the same pattern is usable in log
# messages and future codebases.
PATTERN = re.compile(
    r"(?i)\b(if|elif|else|switch|when|match|case)\b.*\b(qwen|gemma|hermes|llama)\b"
)

REPO_ROOT = Path(__file__).resolve().parents[2]

# Directory names walked OUT — matched as path components anywhere in the tree.
# Using component matching (not absolute paths) lets us correctly skip nested
# dep dirs (e.g., .claude/worktrees/agent-xxx/.venv/ or packages/*/node_modules/).
ALLOWLIST_DIR_NAMES = frozenset(
    {
        "profiles",
        "fixtures",        # tests/fixtures — deliberate positives; self-test reads explicitly
        ".venv",
        "node_modules",
        "runs",
        ".planning",
        "docs",
        "dist",
        "build",
        ".git",
        ".pytest_cache",
        "__pycache__",
        ".claude",
        ".mypy_cache",
        ".ruff_cache",
    }
)

ALLOWLIST_FILES = frozenset(
    {
        REPO_ROOT / "tests" / "unit" / "test_no_model_conditionals.py",
    }
)

FIXTURE_POSITIVE = REPO_ROOT / "tests" / "fixtures" / "no_model_conditionals_positive.py"


def _is_allowlisted(path: Path) -> bool:
    """True if path is the audit test itself or lives under an allowlisted dir.

    Directory check compares PATH COMPONENTS to ALLOWLIST_DIR_NAMES, which
    correctly skips nested .venv / node_modules / .claude / __pycache__ etc.
    that appear anywhere in the tree (not just at REPO_ROOT).
    """
    if path in ALLOWLIST_FILES:
        return True
    try:
        rel = path.relative_to(REPO_ROOT)
    except ValueError:
        # Path outside repo — skip conservatively
        return True
    for part in rel.parts:
        if part in ALLOWLIST_DIR_NAMES:
            return True
    return False


def _iter_py_files():
    for p in REPO_ROOT.rglob("*.py"):
        if _is_allowlisted(p):
            continue
        yield p


def _find_hits(path: Path) -> list[tuple[int, str]]:
    hits: list[tuple[int, str]] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return hits
    for i, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if PATTERN.search(line):
            hits.append((i, line))
    return hits


def test_audit_catches_fixture():
    """Self-test: deliberate-positive fixture MUST trigger audit.

    If this test fails, the PATTERN regex has been weakened and no longer
    detects the intended violations — revert whatever commit broke it.
    """
    assert FIXTURE_POSITIVE.exists(), f"positive fixture missing: {FIXTURE_POSITIVE}"
    hits = _find_hits(FIXTURE_POSITIVE)
    assert len(hits) >= 2, (
        f"audit failed to detect fixture — regex weakened. "
        f"Expected >=2 hits in {FIXTURE_POSITIVE}; got {len(hits)}. "
        f"First 5 raw lines: "
        f"{FIXTURE_POSITIVE.read_text(encoding='utf-8').splitlines()[:5]}"
    )


def test_no_model_conditionals_in_python_sources():
    """Real mode: full Python tree ex. fixtures/allowlist must have ZERO hits.

    If this test fails, a production Python file has introduced a
    model-name-conditional code path (SC-2 violation). Refactor the
    model-shaped behavior into the profile YAML before merging.
    """
    violations: list[tuple[Path, list[tuple[int, str]]]] = []
    for p in _iter_py_files():
        hits = _find_hits(p)
        if hits:
            violations.append((p, hits))
    if violations:
        msg_lines = ["model-name conditional(s) found in Python source (SC-2 violation):"]
        for path, hits in violations:
            rel = path.relative_to(REPO_ROOT)
            for line_no, text in hits:
                msg_lines.append(f"  {rel}:{line_no}: {text.rstrip()}")
        pytest.fail("\n".join(msg_lines))
