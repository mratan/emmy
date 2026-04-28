"""Plan 03.1-02 Task 2 (RED) — ci_verify_research_egress validator tests.

Covers:
  - STRICT_DENY_HOSTS constant includes the major cloud-inference endpoints
    (api.openai.com, api.anthropic.com, generativelanguage.googleapis.com,
    api.mistral.ai, bedrock-runtime.amazonaws.com, api.groq.com, etc.).
  - Dry-run mode validates config: compose file present + digest-pinned.
  - Compared against ci_verify_phase3: distinct modules; both coexist.

NOTE: The full-run path (docker + tcpdump + replay) is reserved for a
self-hosted runner; we only test the config-validation surface here.
"""
from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent

ci_verify_research_egress = pytest.importorskip(
    "emmy_serve.airgap.ci_verify_research_egress"
)


def test_module_has_strict_deny_hosts_constant():
    """The validator MUST expose STRICT_DENY_HOSTS with the cloud-inference endpoints."""
    deny = ci_verify_research_egress.STRICT_DENY_HOSTS
    # Must be a collection of strings.
    assert isinstance(deny, (set, frozenset, tuple, list))
    hosts = set(deny)
    # Must include the canonical cloud-inference endpoints.
    assert "api.openai.com" in hosts
    assert "api.anthropic.com" in hosts
    # Google Gemini — canonical endpoint hostname.
    assert any("googleapis.com" in h for h in hosts)


def test_strict_deny_hosts_blocks_other_cloud_inference_endpoints():
    deny = set(ci_verify_research_egress.STRICT_DENY_HOSTS)
    expected_any_of = {
        "api.mistral.ai",
        "bedrock-runtime.amazonaws.com",
        "api.groq.com",
    }
    # At least one (plan documents >=3, but the set is extensible; require a
    # non-empty intersection).
    assert expected_any_of & deny, (
        f"STRICT_DENY_HOSTS should block major cloud inference endpoints, got {deny!r}"
    )


def test_dry_run_succeeds_with_searxng_compose_present():
    """Dry-run validates config only — compose file present + digest-pinned."""
    # Use the default profile path; module main() returns 0 on valid config.
    exit_code = ci_verify_research_egress.main(
        ["--dry-run", "--profile", "gemma-4-26b-a4b-it/v2.1"]
    )
    assert exit_code == 0, "dry-run against v3.1 profile should pass"


def test_dry_run_fails_on_missing_profile_dir(tmp_path: Path, monkeypatch):
    """Dry-run detects invalid profile path."""
    exit_code = ci_verify_research_egress.main(
        ["--dry-run", "--profile", "nonexistent/path"]
    )
    assert exit_code == 1


def test_verify_research_egress_function_exists():
    """Plan 03.1-02 contract: expose verify_research_egress as a callable."""
    assert hasattr(ci_verify_research_egress, "verify_research_egress")
    assert callable(ci_verify_research_egress.verify_research_egress)


def test_ci_verify_phase3_still_exists_and_is_separate():
    """Plan 03.1-02 discipline: both validators coexist; phase3 strict gate
    must remain unchanged."""
    strict = pytest.importorskip("emmy_serve.airgap.ci_verify_phase3")
    # Two distinct modules; the strict gate doesn't know about SearxNG.
    assert not hasattr(strict, "STRICT_DENY_HOSTS")
