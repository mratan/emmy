# tests/fixtures/no_model_conditionals_positive.py
#
# Deliberate positive for the no-model-conditionals audit (D-19 LOCKED).
# This file MUST be caught by tests/unit/test_no_model_conditionals.py::test_audit_catches_fixture.
# Do NOT add this file to the audit's allowlist — the test verifies the audit
# detects the intended pattern. If the self-test ever goes green by missing this
# fixture, the audit regex has been weakened — revert immediately.
#
# Lives under tests/fixtures/ which IS allowlisted for the real-mode audit, so
# the deliberate violations below are only ever read by the self-test's explicit
# file-targeted assertion — they will never trip the real-mode tree walk.
from __future__ import annotations


def _example_violation(model: str) -> str:
    if "qwen" in model:        # <- MUST trigger the audit (if + qwen on same line)
        return "A"
    elif "gemma" in model:     # <- MUST trigger the audit
        return "B"
    return "C"
