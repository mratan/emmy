"""Validate an airgap-report.json artifact produced by .github/workflows/airgap.yml.

Plan 01-08 certification helper. Invoked by ``scripts/verify_airgap_ci.sh``.

The artifact shape is defined by ``emmy_serve.airgap.validator._dump_report``::

    {
      "ts": "<ISO>",
      "container": "<name>",
      "passes": true | false,
      "failures": [str, ...],                 # empty iff passes
      "layers": [                             # 4 entries, one per layer a/b/c/d
        {"layer": "a"|"b"|"c"|"d", "name": str, "passed": bool,
         "detail": str, "commands_run": [str, ...]}
      ]
    }

SC-4 certification exits 0 iff ``passes=true`` AND ``failures=[]`` AND every
layer has ``passed=true`` AND the union of layer letters == {a, b, c, d}.
Anything else fails with a human-readable list of reasons.

Threat T-08-01 guard: a report with ``passes=true`` but any layer's
``passed=false`` is a contradiction — always rejected.

Exit codes:
    0 — valid green artifact
    1 — invalid / red artifact
    2 — file-not-found / JSON decode / structural error
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REQUIRED_LAYERS = {"a", "b", "c", "d"}


def validate_airgap_report(report: dict) -> tuple[bool, list[str]]:
    """Return ``(ok, reasons)``. ``ok=True`` iff the report is a green run.

    Reasons are free-form strings suitable for the CI log / operator stderr.
    Layer-specific failures include the layer letter in parentheses so a
    grep/sed pipeline can find them (``"layer (a) ..."``).
    """
    reasons: list[str] = []
    if not isinstance(report, dict):
        return False, ["report is not a dict"]

    if report.get("passes") is not True:
        reasons.append(f"passes={report.get('passes')!r} (expected True)")

    failures = report.get("failures", None)
    if failures is None or failures:
        reasons.append(f"failures is non-empty: {failures!r}")

    layers = report.get("layers")
    if not isinstance(layers, list):
        return False, reasons + [f"layers is not a list: {type(layers).__name__}"]

    present_layers = {
        layer.get("layer")
        for layer in layers
        if isinstance(layer, dict)
    }
    missing = _REQUIRED_LAYERS - present_layers
    if missing:
        reasons.append(f"missing layers: {sorted(missing)}")

    for layer in layers:
        if not isinstance(layer, dict):
            reasons.append(f"non-dict layer entry: {layer!r}")
            continue
        if not layer.get("passed"):
            reasons.append(
                f"layer ({layer.get('layer')}) {layer.get('name')} "
                f"not passed: {layer.get('detail')}"
            )

    return (not reasons), reasons


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="ci_verify",
        description="Validate an airgap-report.json artifact (Plan 01-08).",
    )
    ap.add_argument(
        "--from-file",
        dest="from_file",
        required=True,
        help="path to airgap-report.json downloaded from the workflow artifact",
    )
    args = ap.parse_args(argv)

    path = Path(args.from_file)
    if not path.exists():
        print(f"error: file not found: {path}", file=sys.stderr)
        return 2
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON in {path}: {e}", file=sys.stderr)
        return 2

    ok, reasons = validate_airgap_report(report)
    if ok:
        print(
            "airgap-report OK: passes=True, 4 layers green, failures=[]"
        )
        print(f"  ts: {report.get('ts')}")
        print(f"  container: {report.get('container')}")
        return 0

    print("airgap-report FAILED validation:", file=sys.stderr)
    for r in reasons:
        print(f"  - {r}", file=sys.stderr)
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
