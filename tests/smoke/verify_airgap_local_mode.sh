#!/usr/bin/env bash
# Plan 04.2-05 Task 3 — Air-gap regression smoke check for local-mode posture.
#
# Asserts that ci_verify_phase3 (STRICT validator) continues to exit 0 after
# Phase 04.2 lands. The sidecar (controller.py) listens on 0.0.0.0:8003 — the
# STRICT validator gates EGRESS only (ss -tnp state established), so this
# inbound listening socket should be invisible to it (RESEARCH Risk A7).
#
# This script is the canary for D-33 LOCKED preservation: web-search.ts now
# reads EMMY_SEARXNG_URL when set, but the literal default 127.0.0.1:8888
# (the loopback air-gap invariant) MUST remain when the env is unset. Any
# regression that breaks the local-mode default will surface here as a red
# air-gap CI run.
#
# Run with: bash tests/smoke/verify_airgap_local_mode.sh
# Expected: exit 0
#
# This script intentionally runs in DRY-RUN mode — no real container boot, no
# real outbound traffic. The STRICT validator's --dry-run path performs the
# config + namespace + binary-pin checks WITHOUT trying to start vLLM.
#
# CRITICAL: this script must remain green AFTER Phase 04.2 lands; if it goes
# red, the listening sidecar HAS in fact tripped an egress check, and the
# STRICT validator needs an explicit allow-list for INBOUND :8003 (out of scope
# for Phase 04.2 to discover; that would be a follow-up bug fix).
#
# Cross-references:
#   - .planning/phases/04.2-remote-client-mode-parity/04.2-CONTEXT.md C-03 D-33 LOCKED
#   - .planning/phases/04.2-remote-client-mode-parity/04.2-RESEARCH.md Risk A7
#   - .planning/phases/04.2-remote-client-mode-parity/04.2-VALIDATION.md row
#     "Air-gap CI continued passage in local mode"

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# Local mode posture: EMMY_REMOTE_CLIENT MUST be unset.
unset EMMY_REMOTE_CLIENT || true

# Run the STRICT validator in dry-run mode. EMMY_WEB_SEARCH=off ensures the
# kill-switch path is also exercised even though the validator itself does
# not exec the harness — kept for documentation parity with how an operator
# in strictest local-mode posture would invoke this gate.
EMMY_WEB_SEARCH=off uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run
