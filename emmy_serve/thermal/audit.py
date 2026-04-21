"""D-14 representativeness audit — RESEARCH.md §9.5 thresholds.

Runs at plan time (Task 1 of Plan 01-04): computes the 4 static thresholds
from the committed corpus (§9.5 threshold 4 — duty cycle — is a runtime
measurement gathered during the 2-hour replay, not an audit-time property).

Invocable as a module: ``uv run python -m emmy_serve.thermal.audit`` exits
0 on PASS, 1 on FAIL. CI (Plan 05's airgap workflow) greps the committed
THERMAL-AUDIT.md for ``PASSES: True`` as a belt-and-suspenders proof the
audit was actually run.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass

from .corpus import ALL_THERMAL_PROMPTS, ThermalPrompt


# --- §9.5 thresholds (load-bearing constants) ---------------------------------
# Static thresholds (computed at audit time from the corpus).
MIN_RATIO = 0.5  # prefill:decode ratio floor  (decode-heavy OK but capped at 1:2)
MAX_RATIO = 2.0  # prefill:decode ratio ceiling (prefill-heavy capped at 2:1)
MIN_PCT_10K_PREFILL = 0.30  # >= 30% of prompts must exercise >=10K prefill
MIN_PCT_TOOL_CALL = 0.20  # >= 20% must be tool-call shape
MAX_SINGLE_PROMPT_SHARE = 0.15  # no single prompt > 15% of total token mass

# Dynamic threshold (documented in THERMAL-AUDIT.md; measured at replay time).
MIN_DUTY_CYCLE = 0.80  # GPU busy-time / wall-time — first thermal run reports.


@dataclass(frozen=True)
class AuditReport:
    """Machine-readable audit result.

    Consumed by ``scripts/thermal_replay.py`` (pre-replay gate) and by
    CI workflows. The dataclass shape is what gets serialised via
    ``--format json`` for programmatic consumers.
    """

    total_prompts: int
    total_prefill_tokens: int
    total_decode_tokens: int
    prefill_to_decode_ratio: float
    pct_prefill_gte_10k: float
    pct_includes_tool_call: float
    max_single_prompt_share: float
    max_share_task_id: str
    passes: bool
    failures: list[str]


def audit_corpus(prompts: list[ThermalPrompt] | None = None) -> AuditReport:
    """Compute the §9.5 thresholds over a prompt corpus.

    Defaults to the committed ``ALL_THERMAL_PROMPTS``. Callers can pass a
    subset for what-if analysis (e.g. dropping tool-sequence prompts to
    confirm the audit correctly fails).
    """
    if prompts is None:
        prompts = ALL_THERMAL_PROMPTS
    if not prompts:
        return AuditReport(
            total_prompts=0,
            total_prefill_tokens=0,
            total_decode_tokens=0,
            prefill_to_decode_ratio=0.0,
            pct_prefill_gte_10k=0.0,
            pct_includes_tool_call=0.0,
            max_single_prompt_share=0.0,
            max_share_task_id="",
            passes=False,
            failures=["corpus is empty"],
        )

    total = len(prompts)
    total_prefill = sum(p.expected_prefill_tokens for p in prompts)
    total_decode = sum(p.expected_decode_tokens for p in prompts)
    total_tokens = total_prefill + total_decode

    ratio = total_prefill / max(total_decode, 1)
    pct_10k = sum(1 for p in prompts if p.expected_prefill_tokens >= 10000) / total
    pct_tool = sum(1 for p in prompts if p.includes_tool_call) / total

    # Max share computed over prefill+decode token mass.
    def _mass(p: ThermalPrompt) -> int:
        return p.expected_prefill_tokens + p.expected_decode_tokens

    biggest = max(prompts, key=_mass)
    max_share = _mass(biggest) / max(total_tokens, 1)

    failures: list[str] = []
    if not (MIN_RATIO <= ratio <= MAX_RATIO):
        failures.append(
            f"prefill:decode ratio {ratio:.2f} outside [{MIN_RATIO}, {MAX_RATIO}] per §9.5"
        )
    if pct_10k < MIN_PCT_10K_PREFILL:
        failures.append(
            f"only {pct_10k:.0%} of prompts have prefill >= 10K tokens "
            f"(need >= {MIN_PCT_10K_PREFILL:.0%}) per §9.5"
        )
    if pct_tool < MIN_PCT_TOOL_CALL:
        failures.append(
            f"only {pct_tool:.0%} of prompts include tool-call shapes "
            f"(need >= {MIN_PCT_TOOL_CALL:.0%}) per §9.5"
        )
    if max_share > MAX_SINGLE_PROMPT_SHARE:
        failures.append(
            f"single prompt '{biggest.task_id}' at {max_share:.0%} share "
            f"(cap: {MAX_SINGLE_PROMPT_SHARE:.0%}) per §9.5"
        )

    return AuditReport(
        total_prompts=total,
        total_prefill_tokens=total_prefill,
        total_decode_tokens=total_decode,
        prefill_to_decode_ratio=round(ratio, 4),
        pct_prefill_gte_10k=round(pct_10k, 4),
        pct_includes_tool_call=round(pct_tool, 4),
        max_single_prompt_share=round(max_share, 4),
        max_share_task_id=biggest.task_id,
        passes=(len(failures) == 0),
        failures=failures,
    )


def _print_text(report: AuditReport) -> None:
    print(f"Total prompts: {report.total_prompts}")
    print(f"Total prefill tokens: {report.total_prefill_tokens}")
    print(f"Total decode tokens:  {report.total_decode_tokens}")
    print(
        f"prefill:decode ratio: {report.prefill_to_decode_ratio:.2f} "
        f"(must be in [{MIN_RATIO}, {MAX_RATIO}])"
    )
    print(
        f"% prefill >= 10K: {report.pct_prefill_gte_10k:.0%} "
        f"(must be >= {MIN_PCT_10K_PREFILL:.0%})"
    )
    print(
        f"% tool-call shape: {report.pct_includes_tool_call:.0%} "
        f"(must be >= {MIN_PCT_TOOL_CALL:.0%})"
    )
    print(
        f"max single prompt share: {report.max_single_prompt_share:.0%} "
        f"({report.max_share_task_id}) (cap {MAX_SINGLE_PROMPT_SHARE:.0%})"
    )
    print(f"PASSES: {report.passes}")
    for f in report.failures:
        print(f"  FAIL: {f}")


def main(argv: list[str] | None = None) -> int:
    """CLI entry: `python -m emmy_serve.thermal.audit [--format text|json]`.

    Exit codes:
      0 — corpus passes §9.5 thresholds
      1 — one or more thresholds fail (see stdout for which)
    """
    ap = argparse.ArgumentParser(
        description="D-14 thermal workload audit (RESEARCH.md §9.5 thresholds).",
    )
    ap.add_argument("--format", choices=["text", "json"], default="text")
    args = ap.parse_args(argv)
    report = audit_corpus()
    if args.format == "json":
        print(json.dumps(asdict(report), indent=2, sort_keys=True))
    else:
        _print_text(report)
    return 0 if report.passes else 1


if __name__ == "__main__":
    sys.exit(main())
