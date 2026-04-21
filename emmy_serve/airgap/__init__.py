"""D-12 layered air-gap probe package (Phase 1, Plan 05).

Consumed by .github/workflows/airgap.yml and scripts/airgap_probe.py.
Four layers per 01-RESEARCH.md §10.4:

  (a) layer_a_network_devices — container has no non-loopback interface
  (b) layer_b_dns_audit       — DNS unreachable (huggingface.co does NOT resolve)
  (c) layer_c_telemetry_env   — VLLM_NO_USAGE_STATS=1 + DO_NOT_TRACK=1
  (d) layer_d_hf_offline_env  — HF_HUB_OFFLINE=1 + TRANSFORMERS_OFFLINE=1

A failure in any layer fails the CI job with the specific layer identified;
structural (a) + empirical (b/c/d) together give the no-cloud guarantee
called out in CLAUDE.md pitfall #8.
"""
from __future__ import annotations

from .ci_verify import validate_airgap_report
from .probe import (
    LayerResult,
    layer_a_network_devices,
    layer_b_dns_audit,
    layer_c_telemetry_env,
    layer_d_hf_offline_env,
)
from .validator import AirGapReport, main, run_airgap_probe

__all__ = [
    "AirGapReport",
    "LayerResult",
    "layer_a_network_devices",
    "layer_b_dns_audit",
    "layer_c_telemetry_env",
    "layer_d_hf_offline_env",
    "main",
    "run_airgap_probe",
    "validate_airgap_report",
]
