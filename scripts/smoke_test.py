#!/usr/bin/env python3
"""Phase 1 smoke-test orchestrator. Invoked by scripts/start_emmy.sh after docker run.

Pipeline:
    1. wait_for_vllm — /v1/models 200 OK (300s timeout)
    2. run_sp_ok       — D-07 SP_OK echo canary
    3. run_tool_call   — D-08 one-tool read_file parse canary
    4. run_generate    — 100-token decode smoke (prints tok/s for ready banner)

On any failure: write a D-06 bundle to runs/boot-failures/<iso>-boot-failure/
via ``write_boot_failure_bundle`` + exit 1. Caller (start_emmy.sh) then runs
``docker stop emmy-serve`` and exits 1.

On success: each canary call appends one CanaryResult row to
``{run-dir}/canary.jsonl`` and the final ``print('smoke ok: tok/s=... tokens_out=...')``
feeds the ready banner.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from emmy_serve.boot.probe import wait_for_vllm
from emmy_serve.canary import (
    CanaryResult,
    load_default_tool_schema,
    log_canary_event,
    run_generate,
    run_sp_ok,
    run_tool_call,
)
from emmy_serve.diagnostics.bundle import write_boot_failure_bundle
from emmy_serve.diagnostics.layout import EmmyRunLayout, new_run_id
from emmy_serve.profile.loader import load_profile


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument(
        "--run-dir", required=True, help="Target dir for canary logs (success case)"
    )
    ap.add_argument(
        "--fail-dir", default="runs", help="Base dir for boot-failure bundle"
    )
    args = ap.parse_args(argv)

    profile_path = Path(args.profile)
    run_dir = Path(args.run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    serving, _, profile_ref = load_profile(profile_path)
    served_model = serving.engine.served_model_name

    def _fail(
        check: str,
        reason: str,
        prompt: str,
        response_text: str,
        response_json: dict | None = None,
    ) -> int:
        run_id = new_run_id()
        layout = EmmyRunLayout(
            base_dir=Path(args.fail_dir) / "boot-failures",
            run_id=run_id,
            kind="boot-failure",
        )
        write_boot_failure_bundle(
            layout,
            profile_ref=profile_ref,
            check=check,
            reason=reason,
            prompt_text=prompt,
            response_text=response_text,
            response_json=response_json,
        )
        print(f"BOOT REJECTED ({check}): {reason}", file=sys.stderr)
        print(f"See: {layout.run_dir}", file=sys.stderr)
        return 1

    # --- 1. wait for /v1/models ---
    try:
        wait_for_vllm(args.base_url, timeout_s=300, interval_s=0.5)
    except TimeoutError as e:
        return _fail("wait_for_vllm", str(e), "", "")

    # --- 2. SP_OK canary (D-07) ---
    t0 = time.monotonic()
    try:
        ok, resp = run_sp_ok(args.base_url, served_model)
    except Exception as e:
        return _fail("sp_ok", f"exception: {e}", "(ping)", str(e))
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    log_canary_event(
        run_dir / "canary.jsonl",
        CanaryResult(
            check="sp_ok",
            ok=ok,
            elapsed_ms=elapsed_ms,
            profile_id=profile_ref.id,
            profile_version=profile_ref.version,
            profile_hash=profile_ref.hash,
            served_model_name=served_model,
            ts=_now_iso(),
            response_excerpt=resp[:200],
        ),
    )
    if not ok:
        return _fail("sp_ok", "[SP_OK] not found in response", "ping", resp)

    # --- 3. tool_call canary (D-08) ---
    t0 = time.monotonic()
    try:
        ok, msg = run_tool_call(
            args.base_url, served_model, load_default_tool_schema()
        )
    except Exception as e:
        return _fail("tool_call", f"exception: {e}", "", str(e))
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    log_canary_event(
        run_dir / "canary.jsonl",
        CanaryResult(
            check="tool_call",
            ok=ok,
            elapsed_ms=elapsed_ms,
            profile_id=profile_ref.id,
            profile_version=profile_ref.version,
            profile_hash=profile_ref.hash,
            served_model_name=served_model,
            ts=_now_iso(),
            response_excerpt=str(msg)[:200],
        ),
    )
    if not ok:
        return _fail(
            "tool_call",
            "tool_call did not parse correctly",
            "",
            str(msg),
            response_json=msg if isinstance(msg, dict) else None,
        )

    # --- 4. 100-token generation ---
    t0 = time.monotonic()
    try:
        ok, data, dur = run_generate(args.base_url, served_model)
    except Exception as e:
        return _fail("generate", f"exception: {e}", "", str(e))
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    content = data["choices"][0]["message"]["content"]
    tokens_out = data.get("usage", {}).get("completion_tokens", 0)
    tok_per_s = tokens_out / dur if dur > 0 else 0.0
    log_canary_event(
        run_dir / "canary.jsonl",
        CanaryResult(
            check="generate",
            ok=ok,
            elapsed_ms=elapsed_ms,
            profile_id=profile_ref.id,
            profile_version=profile_ref.version,
            profile_hash=profile_ref.hash,
            served_model_name=served_model,
            ts=_now_iso(),
            response_excerpt=(
                f"tok/s={tok_per_s:.1f} finish={data['choices'][0].get('finish_reason')}"
            ),
        ),
    )
    if not ok:
        return _fail(
            "generate",
            f"generate not ok (tok/s={tok_per_s:.1f})",
            "Count 1-100",
            content or "",
        )

    # Emit SC-1 throughput signal for start_emmy.sh to surface in the ready banner
    print(f"smoke ok: tok/s={tok_per_s:.2f} tokens_out={tokens_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
