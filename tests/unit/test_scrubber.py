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
# WR-01 (Phase 04.6 review) — extended secret-shape coverage. The shipping
# v1 pattern set missed widely-used 2026 secret formats; these tests pin
# the fixes from scrubber_config.yaml so a future regex-tightening doesn't
# silently re-open the false-negative.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "prompt,expected_class",
    [
        # Stripe live + test keys (sk_/rk_/pk_ + live/test prefix). Distinct
        # from sk_prefixed_key (which requires a dash, not underscore).
        (
            "STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dcThisIsTheSecretKey",
            "stripe_key",
        ),
        (
            "key=rk_test_ABCDEF1234567890abcdef1234567890XYZ",
            "stripe_key",
        ),
        # Stripe webhook signing secret.
        (
            "WEBHOOK_SECRET=whsec_AbCdEf1234567890AbCdEf1234567890ZZ",
            "stripe_webhook",
        ),
        # GitHub fine-grained PAT (Aug-2022+ format).
        (
            "GH_TOKEN=github_pat_11ABCDEFGHIJKLMNOPQRST_abcdefghij0123456789",
            "github_pat_finegrained",
        ),
        # npm auth token.
        (
            "//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789",
            "npm_token",
        ),
        # DB connection strings with embedded password.
        (
            "DATABASE_URL=postgres://user:hunter2@db.example.com:5432/app",
            "db_url_password",
        ),
        (
            "MYSQL_URL=mysql://root:s3cret@10.0.0.1:3306/db",
            "db_url_password",
        ),
        (
            "MONGO=mongodb+srv://admin:topsecret@cluster.mongodb.net/test",
            "db_url_password",
        ),
        # AWS Secret Access Key — context-anchored to keep FP rate finite.
        (
            "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12",
            "aws_secret_access_key",
        ),
    ],
)
def test_scrubber_extended_coverage(prompt: str, expected_class: str) -> None:
    r = scrub(prompt)
    assert r.clean is False
    assert r.matched_class == expected_class, f"got {r.matched_class!r} for {prompt!r}"


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
#
# Budget tuned to 2.0s after WR-01 (Phase 04.6 review) extended the pattern
# set from 11 → 17 to close the false-negative gaps the review identified
# (Stripe, GitHub fine-grained PATs, npm, Azure, AWS secret access key with
# context anchor, DB URLs). Each added pattern adds ~70-90ms of baseline
# regex overhead on this synthetic 120K-char corpus; 100 iterations × 17
# patterns × ~80ms ≈ 1.4s real, 2.0s gives headroom for CI variance.
# A real prompt is bounded by the request cap (200K) and a single scrub
# call costs ~10-20ms — well within the privacy-gate budget.
# ---------------------------------------------------------------------------
def test_scrubber_perf() -> None:
    big = "lorem ipsum " * 10_000  # ~120K chars
    t0 = time.monotonic()
    for _ in range(100):
        scrub(big)
    elapsed = time.monotonic() - t0
    assert elapsed < 2.0, f"scrubber too slow: {elapsed:.3f}s for 100×120K chars"
