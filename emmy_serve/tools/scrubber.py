"""Pre-send scrubber for ask_claude (Plan 04.6-02 / D-06 / T-01).

Reject-don't-redact: caller gets a structured error on match, not a
silently-modified prompt. Pattern config is loaded once at import; reload
requires sidecar restart (intentional — config drift would be a bug source).

False positives are tolerable; false negatives are NOT (T-01 data exfil).

Public API surface (frozen for downstream consumers — Plan 04.6-01):

    scrub(prompt: str) -> ScrubResult

    ScrubResult.clean: bool
    ScrubResult.matched_class: str | None
    ScrubResult.matched_excerpt: str | None
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

__all__ = ["ScrubResult", "scrub"]


@dataclass(frozen=True)
class ScrubResult:
    """Result of a single scrub call.

    - ``clean``: True iff no pattern matched.
    - ``matched_class``: name of the first matched pattern class, or None.
    - ``matched_excerpt``: short snippet (≤ 40 chars + ellipsis) of what
      triggered the match — for audit messages without leaking the full
      prompt context. None when ``clean`` is True.
    """

    clean: bool
    matched_class: str | None = None
    matched_excerpt: str | None = None


# Compiled patterns; class -> compiled regex. Order is preserved per
# scrubber_config.yaml insertion order; first match wins.
_PATTERNS: dict[str, re.Pattern[str]] = {}


def _load_config() -> None:
    cfg_path = Path(__file__).parent / "scrubber_config.yaml"
    raw = yaml.safe_load(cfg_path.read_text())
    for cls_name, pattern_str in raw["patterns"].items():
        _PATTERNS[cls_name] = re.compile(pattern_str)


_load_config()

# Excerpt cap — keep audit trails informative without echoing full secrets
# or full surrounding context to JSONL events.
_EXCERPT_MAX = 40


def scrub(prompt: str) -> ScrubResult:
    """Return a ScrubResult for ``prompt``.

    Walks the configured patterns in order; returns on the first match
    (deterministic, ordered by ``scrubber_config.yaml``). Returns a clean
    result when no pattern matches.
    """
    for cls_name, pat in _PATTERNS.items():
        m = pat.search(prompt)
        if m:
            excerpt = m.group(0)
            if len(excerpt) > _EXCERPT_MAX:
                excerpt = excerpt[:_EXCERPT_MAX] + "…"
            return ScrubResult(
                clean=False,
                matched_class=cls_name,
                matched_excerpt=excerpt,
            )
    return ScrubResult(clean=True)
