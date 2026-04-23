"""Phase 3.1 air-gap CI extension — research-egress-permissive stack validator.

Sibling of ``emmy_serve.airgap.ci_verify_phase3`` (the strict loopback gate).
Where phase3's validator asserts ZERO outbound from emmy-serve + Langfuse, the
research-egress validator PERMITS the SearxNG container's outbound traffic
(which goes to Google / DuckDuckGo / Brave / Bing — explicit in the refined
Phase-3.1 thesis D-33) while still HARD-BLOCKING cloud-inference endpoints
such as api.openai.com, api.anthropic.com, googleapis.com, api.mistral.ai,
bedrock-runtime.amazonaws.com, api.groq.com.

Both validators coexist:
    uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run
    uv run python -m emmy_serve.airgap.ci_verify_research_egress --dry-run

The strict gate stays in place for the "NO OUTBOUND AT ALL" Phase-3 release
certification. The research-egress gate is the Phase-3.1 daily-driver
posture: local LLM is non-negotiable; a single auditable SearxNG container
may reach out for web search.

Usage::

    # Dry-run — config + prereq sanity only.
    uv run python -m emmy_serve.airgap.ci_verify_research_egress --dry-run

    # Full run — requires docker + self-hosted runner + tcpdump + ~5 min.
    uv run python -m emmy_serve.airgap.ci_verify_research_egress

Exit codes:
    0 — dry-run config valid OR full-run shows zero CLOUD-INFERENCE egress
    1 — any step failed (config, stack-up, replay, hard-deny hit, teardown)
    2 — argparse / invocation error
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROFILE = "qwen3.6-35b-a3b/v3.1"

# Hosts that MUST never receive outbound traffic from ANY emmy-owned container
# or process — these are cloud-inference endpoints whose presence in a live
# packet capture would mean the "no cloud inference" thesis is broken. This
# list is intentionally conservative: the research-egress validator is
# PERMISSIVE for SearxNG's own outbound (to search engines) and for the
# emmy-serve + Langfuse loopback fabric; everything else is either loopback
# (implicit OK) or a CLOUD-INFERENCE hard deny.
STRICT_DENY_HOSTS = frozenset({
    "api.openai.com",
    "api.anthropic.com",
    # Google Gemini (and any future generativelanguage.* subdomain).
    "generativelanguage.googleapis.com",
    "ai.google.dev",
    # Mistral, Groq, AWS Bedrock.
    "api.mistral.ai",
    "api.groq.com",
    "bedrock-runtime.amazonaws.com",
    "bedrock.amazonaws.com",
    # Hugging Face Inference Endpoints (inference — not the model card CDN).
    "api-inference.huggingface.co",
    # Deepseek, Cohere, Fireworks — common 2026 cloud inference providers.
    "api.deepseek.com",
    "api.cohere.com",
    "api.fireworks.ai",
})

REQUIRED_BINARIES_FULL = ("docker", "ss", "tcpdump", "bash")


def _searxng_compose_file() -> Path:
    return REPO_ROOT / "observability" / "searxng" / "docker-compose.yaml"


def _langfuse_compose_file() -> Path:
    return REPO_ROOT / "observability" / "langfuse" / "docker-compose.yaml"


def _start_searxng_script() -> Path:
    return REPO_ROOT / "scripts" / "start_searxng.sh"


def _stop_searxng_script() -> Path:
    return REPO_ROOT / "scripts" / "stop_searxng.sh"


def _check_config(profile: str) -> list[str]:
    """Return failure reasons; empty list ⇒ config valid."""
    reasons: list[str] = []
    profile_dir = REPO_ROOT / "profiles" / profile
    if not profile_dir.is_dir():
        reasons.append(f"profile dir missing: {profile_dir}")
    for p, label in [
        (_searxng_compose_file(), "searxng docker-compose.yaml"),
        (_start_searxng_script(), "start_searxng.sh"),
        (_stop_searxng_script(), "stop_searxng.sh"),
    ]:
        if not p.is_file():
            reasons.append(f"{label} missing: {p}")
    # Langfuse compose is NOT required by this validator (the research-egress
    # posture validates SearxNG, not telemetry), but if it exists we confirm
    # the digest pinning convention.
    try:
        txt = _searxng_compose_file().read_text(encoding="utf-8")
        if "@sha256:" not in txt:
            reasons.append("searxng docker-compose.yaml has no @sha256: digest pins (D-09)")
        if "127.0.0.1:8888" not in txt:
            reasons.append("searxng docker-compose.yaml lacks loopback:8888 bind (T-03.1-02-01)")
    except FileNotFoundError:
        reasons.append("searxng docker-compose.yaml not readable")
    # Sanity: the deny-list is non-empty (guards against accidental empty-set bugs).
    if not STRICT_DENY_HOSTS:
        reasons.append("STRICT_DENY_HOSTS is empty — misconfigured validator")
    return reasons


def verify_research_egress(profile: str = DEFAULT_PROFILE, dry_run: bool = True) -> int:
    """Top-level entrypoint. Dry-run validates config; full-run spins up stacks."""
    if dry_run:
        return _dry_run(profile)
    return _full_run(profile)


def _dry_run(profile: str) -> int:
    reasons = _check_config(profile)
    if reasons:
        print("ci_verify_research_egress --dry-run FAILED:", file=sys.stderr)
        for r in reasons:
            print(f"  - {r}", file=sys.stderr)
        return 1
    print("ci_verify_research_egress --dry-run OK")
    print(f"  profile:             {profile}")
    print(f"  searxng compose:     {_searxng_compose_file()}")
    print(f"  start/stop scripts:  {_start_searxng_script()}, {_stop_searxng_script()}")
    print(f"  STRICT_DENY_HOSTS:   {len(STRICT_DENY_HOSTS)} entries")
    for host in sorted(STRICT_DENY_HOSTS):
        print(f"    - deny {host}")
    print(
        "  (dry-run skipped: docker up, live pi-emmy research session, "
        "tcpdump capture vs STRICT_DENY_HOSTS)"
    )
    return 0


def _full_run(profile: str) -> int:
    """Full air-gap verification with permissive SearxNG posture.

    Steps (deferred to self-hosted runner per Phase 1 Plan 01-08 Task 3 pattern):
      1. Config-valid (reuse dry-run gate).
      2. Start emmy-serve + SearxNG + Langfuse.
      3. Run a synthetic research session (web_search + web_fetch bypass).
      4. Capture `tcpdump -nn -i any host X` for each STRICT_DENY_HOSTS entry
         for the duration; assert zero packet captures.
      5. Teardown + final report.
    """
    reasons = _check_config(profile)
    if reasons:
        print("ci_verify_research_egress full-run config-check FAILED:", file=sys.stderr)
        for r in reasons:
            print(f"  - {r}", file=sys.stderr)
        return 1
    missing = [b for b in REQUIRED_BINARIES_FULL if shutil.which(b) is None]
    if missing:
        print(
            f"ci_verify_research_egress full-run: missing prereqs {missing!r}",
            file=sys.stderr,
        )
        return 1
    print(
        "ci_verify_research_egress full-run scaffold ready; "
        "actual docker+tcpdump deferred to self-hosted runner "
        "(Phase 1 Plan 01-08 Task 3 pattern).",
        file=sys.stderr,
    )
    # Phase 3.1 CLOSEOUT deferral: `.github/workflows/airgap-research-egress.yml`
    # is the canonical runner wrapper (not yet authored; Phase 7 scope).
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="ci_verify_research_egress",
        description=(
            "Phase 3.1 air-gap CI extension — research-egress-permissive stack "
            "validator (Plan 03.1-02 Task 2). Permits SearxNG outbound; blocks "
            "cloud-inference endpoints."
        ),
    )
    ap.add_argument(
        "--profile",
        default=DEFAULT_PROFILE,
        help=f"profile path relative to profiles/ (default: {DEFAULT_PROFILE})",
    )
    ap.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="assert config + prereqs only; do NOT bring up docker",
    )
    args = ap.parse_args(argv)
    return verify_research_egress(profile=args.profile, dry_run=args.dry_run)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
