"""Airgap validator CLI — runs D-12 layered assertions against a running
container (post-boot) or checks the profile's env policy before boot.

Used by:

- `.github/workflows/airgap.yml` — the `airgap-replay` job's two steps
  (pre-boot + post-boot).
- `scripts/airgap_probe.py` — hand-invokable shim for local proofs.

Exit codes:
    0 — all layers pass (post-boot) or policy passes (pre-boot)
    1 — any layer / policy failure
    2 — argparse / internal error (standard argparse behavior)

JSON report shape (post-boot):
    {"ts": "...", "container": "emmy-serve", "passes": true|false,
     "failures": ["layer (a) ... FAILED: ..."],
     "layers": [{"layer": "a", "name": "...", "passed": true, ...}, ...]}
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from ..diagnostics.atomic import write_json_atomic
from .probe import (
    LayerResult,
    layer_a_network_devices,
    layer_b_dns_audit,
    layer_c_telemetry_env,
    layer_d_hf_offline_env,
)


@dataclass(frozen=True)
class AirGapReport:
    """Aggregate of all four D-12 layer results."""

    ts: str
    container: str
    layers: list[LayerResult]
    passes: bool
    failures: list[str]


def run_airgap_probe(container: str = "emmy-serve") -> AirGapReport:
    """Run all four D-12 layers against ``container`` and return an aggregate report."""
    results = [
        layer_a_network_devices(container),
        layer_b_dns_audit(container),
        layer_c_telemetry_env(container),
        layer_d_hf_offline_env(container),
    ]
    failures = [
        f"layer ({r.layer}) {r.name} FAILED: {r.detail}"
        for r in results
        if not r.passed
    ]
    return AirGapReport(
        ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        container=container,
        layers=results,
        passes=not failures,
        failures=failures,
    )


# ---------------------------------------------------------------------------
# pre-boot: static policy check of the profile's env block
# ---------------------------------------------------------------------------


def _cmd_pre_boot(args: argparse.Namespace) -> int:
    """Assert serving.yaml's env section satisfies D-12 (c) / (d).

    Does NOT require a running container — invoked before `docker run`.
    Complements the immutability validator (which also enforces
    VLLM_NO_USAGE_STATS=1 and HF_HUB_OFFLINE=1 via the cross-field policy
    gate) by additionally requiring DO_NOT_TRACK=1 and TRANSFORMERS_OFFLINE=1,
    both of which are schema-required but not policy-gated.
    """
    # Late import to keep `python -m emmy_serve.airgap` cheap when probe is used alone.
    from ..profile.loader import load_serving
    from ..profile.schema import ProfileConfigError

    profile_dir = Path(args.profile)
    try:
        serving = load_serving(profile_dir / "serving.yaml")
    except ProfileConfigError as e:
        print(f"pre-boot FAIL: {e}", file=sys.stderr)
        return 1

    env = serving.env
    problems: list[str] = []
    for attr, expected in (
        ("VLLM_NO_USAGE_STATS", "1"),
        ("DO_NOT_TRACK", "1"),
        ("HF_HUB_OFFLINE", "1"),
        ("TRANSFORMERS_OFFLINE", "1"),
    ):
        got = getattr(env, attr, None)
        if got != expected:
            problems.append(f"env.{attr}={got!r} (expected {expected!r})")

    if problems:
        for p in problems:
            print(f"pre-boot FAIL: {p}", file=sys.stderr)
        return 1
    print(
        "pre-boot OK: serving.yaml env section passes D-12 (c)/(d) policy "
        f"(profile={profile_dir})"
    )
    return 0


# ---------------------------------------------------------------------------
# post-boot: invoke the 4 layers against a running container
# ---------------------------------------------------------------------------


def _layer_dict(r: LayerResult) -> dict:
    """LayerResult -> JSON-serializable dict (dataclass asdict)."""
    return asdict(r)


def _dump_report(report: AirGapReport, out_path: Path | None) -> None:
    serializable = {
        "ts": report.ts,
        "container": report.container,
        "passes": report.passes,
        "failures": report.failures,
        "layers": [_layer_dict(r) for r in report.layers],
    }
    if out_path is not None:
        write_json_atomic(out_path, serializable)
    print(json.dumps(serializable, indent=2))


def _cmd_post_boot(args: argparse.Namespace) -> int:
    report = run_airgap_probe(container=args.container)
    out_path = Path(args.out) if args.out else None
    _dump_report(report, out_path)
    if not report.passes:
        for f in report.failures:
            print(f, file=sys.stderr)
        return 1
    return 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="airgap_probe",
        description="Layered D-12 air-gap validation (Phase 1, Plan 05).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    pre = sub.add_parser(
        "pre-boot",
        help="validate serving.yaml env policy without a running container",
    )
    pre.add_argument(
        "--profile",
        required=True,
        help="path to profiles/<name>/v<N>/",
    )
    pre.set_defaults(_handler=_cmd_pre_boot)

    post = sub.add_parser(
        "post-boot",
        help="run 4 D-12 layer probes against a running container",
    )
    post.add_argument(
        "--container",
        default="emmy-serve",
        help="container name (default: emmy-serve)",
    )
    post.add_argument(
        "--out",
        default=None,
        help="optional JSON report path",
    )
    post.set_defaults(_handler=_cmd_post_boot)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args._handler(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
