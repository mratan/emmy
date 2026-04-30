"""Tests for the pre-send scrubber library (Plan 04.6-02 / D-06 / T-01).

The scrubber is a small, fast, deterministic library that takes a prompt
string and returns whether it matches any operator-configured "do not send"
pattern. Reject-don't-redact policy: caller (sidecar) returns an error to
the model on match.

False positives are tolerable; false negatives are NOT.
"""
from __future__ import annotations

import time

import pytest

from emmy_serve.tools.scrubber import ScrubResult, scrub


# ---------------------------------------------------------------------------
# AWS access keys
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "prompt",
    [
        "use AKIAIOSFODNN7EXAMPLE for the bucket",
        "key=AKIA1234567890ABCDEF",
    ],
)
def test_blocks_aws_access_key_id(prompt: str) -> None:
    r = scrub(prompt)
    assert r.clean is False
    assert r.matched_class == "aws_access_key_id"


# ---------------------------------------------------------------------------
# OpenAI / Anthropic / generic API keys (pattern: "sk-...")
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "prompt",
    [
        "OPENAI_API_KEY=sk-abc123def456ghi789jkl012mno345pq",
        "ANTHROPIC_API_KEY=sk-ant-abc12345abcdef1234567890",
    ],
)
def test_blocks_sk_prefixed_key(prompt: str) -> None:
    r = scrub(prompt)
    assert r.clean is False
    assert r.matched_class == "sk_prefixed_key"


# ---------------------------------------------------------------------------
# Slack tokens
# ---------------------------------------------------------------------------
def test_blocks_slack_token() -> None:
    r = scrub("token=xoxb-1234567890-1234567890-abcdefgh")
    assert r.clean is False
    assert r.matched_class == "slack_token"


# ---------------------------------------------------------------------------
# Private key headers
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "prompt",
    [
        "-----BEGIN RSA PRIVATE KEY-----",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----",
    ],
)
def test_blocks_private_key_header(prompt: str) -> None:
    r = scrub(prompt)
    assert r.clean is False
    assert r.matched_class == "private_key_header"


# ---------------------------------------------------------------------------
# Bearer tokens / JWT-shaped
# ---------------------------------------------------------------------------
def test_blocks_jwt_shaped() -> None:
    # 3 base64-ish segments separated by dots, ≥ 30 chars
    r = scrub(
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ.signature_xyz"
    )
    assert r.clean is False
    assert r.matched_class == "jwt_or_bearer"


# ---------------------------------------------------------------------------
# File path globs (operator might paste contents of secret files inline)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "prompt",
    [
        "see contents of .env.local: API_KEY=...",
        "in secrets/db_password.txt:",
        "cat ~/.ssh/id_rsa shows:",
    ],
)
def test_blocks_secret_file_glob(prompt: str) -> None:
    r = scrub(prompt)
    assert r.clean is False
    assert r.matched_class is not None
    assert r.matched_class.startswith("secret_path")


# ---------------------------------------------------------------------------
# Clean prompts (must NOT match)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "prompt",
    [
        "what is 2+2",
        "explain async/await in Python",
        "review this function: def foo(x): return x*2",
        "the variable name api_key is a placeholder",  # word, not the value
        "skiing in the alps",  # 'sk' prefix on natural word — must not false-positive
        "ask_claude tool description: ...",  # mentions ask_claude (don't recurse-block)
    ],
)
def test_clean_prompts_pass(prompt: str) -> None:
    r = scrub(prompt)
    assert r.clean is True
    assert r.matched_class is None


# ---------------------------------------------------------------------------
# Public API surface — frozen for downstream consumers (Plan 04.6-01)
# ---------------------------------------------------------------------------
def test_scrub_result_fields() -> None:
    """ScrubResult must expose clean / matched_class / matched_excerpt."""
    clean = scrub("hello world")
    assert isinstance(clean, ScrubResult)
    assert clean.clean is True
    assert clean.matched_class is None
    assert clean.matched_excerpt is None

    dirty = scrub("AKIAIOSFODNN7EXAMPLE")
    assert isinstance(dirty, ScrubResult)
    assert dirty.clean is False
    assert dirty.matched_class == "aws_access_key_id"
    assert dirty.matched_excerpt is not None
    assert isinstance(dirty.matched_excerpt, str)


# ---------------------------------------------------------------------------
# Performance: scrubber should be fast on large prompts
# ---------------------------------------------------------------------------
def test_scrubber_perf() -> None:
    big = "lorem ipsum " * 10_000  # ~120K chars
    t0 = time.monotonic()
    for _ in range(100):
        scrub(big)
    elapsed = time.monotonic() - t0
    assert elapsed < 1.0, f"scrubber too slow: {elapsed:.3f}s for 100×120K chars"
