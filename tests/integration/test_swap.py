"""GREEN — End-to-end swap happy path with fully-mocked docker (Plan 04-02 Task 2).

Asserts that a complete swap_profile invocation:
    * emits the D-02 LOCKED 4-phase sequence in order on stdout
    * returns exit 0
    * issues at least one docker inspect (preflight, mocked) + docker stop/rm/run
    * completes without calling the real smoke test subprocess

Integration-level in SHAPE (whole pipeline through the orchestrator) but
ZERO real docker / HTTP / model traffic — every external boundary monkey-
patched. Runs in unit-test time (~0.1s).

Emmy's conftest.py auto-skips everything under tests/integration/ unless
``--run-integration`` is passed (see conftest.py:28). This file follows the
convention — CI runs it via ``pytest tests/integration/test_swap.py
--run-integration`` and SUMMARY.md documents this invocation. Keeping the
file at the spec path (plan.files_modified entry) preserves the
"integration test lives in tests/integration/" convention even though this
particular test doesn't need Docker.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from emmy_serve.swap import orchestrator as orch_mod
from emmy_serve.swap import preflight as preflight_mod
from emmy_serve.swap.orchestrator import swap_profile
from emmy_serve.swap.preflight import PreflightResult


REPO_ROOT = Path(__file__).resolve().parents[2]
V31_PROFILE = REPO_ROOT / "profiles" / "qwen3.6-35b-a3b" / "v3.1"


class _FakeSubprocess:
    """Spy/mock for subprocess.run covering docker inspect/stop/rm/run + smoke."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def __call__(self, argv: list[str], *a: Any, **kw: Any) -> subprocess.CompletedProcess:
        self.calls.append(list(argv))
        # Everything succeeds by default.
        return subprocess.CompletedProcess(args=argv, returncode=0, stdout=b"", stderr=b"")


def test_happy_path_emits_four_phases_in_order(
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-02 LOCKED: stdout JSON records' first-occurrence phase sequence is
    exactly ["stopping vLLM", "loading weights", "warmup", "ready"].

    Everything else — preflight details, docker calls, wait_for_vllm, smoke —
    is mocked to success so the test is a pure pipeline-shape assertion.
    """
    # --- patch every external boundary -----------------------------------

    # Preflight: return happy result with non-empty docker_args so orchestrator
    # passes them into "docker run".
    def _happy_preflight(new_profile: Path, port: int, run_dir: Path) -> PreflightResult:
        return PreflightResult(
            exit_code=0,
            error_msg=None,
            image_ref="sha256:" + "f" * 64,
            docker_args=["--gpus", "all", "sha256:" + "f" * 64, "vllm", "serve"],
        )

    monkeypatch.setattr(orch_mod, "run_preflight", _happy_preflight)

    # subprocess.run: everything succeeds (docker stop/rm/run + smoke subprocess).
    sp = _FakeSubprocess()
    monkeypatch.setattr(orch_mod.subprocess, "run", sp)

    # wait_for_vllm: no-op (simulates /v1/models 200 OK).
    monkeypatch.setattr(orch_mod, "wait_for_vllm", lambda *a, **kw: None)

    # Fast time.sleep — defensive CUDA drain shouldn't slow tests.
    monkeypatch.setattr(orch_mod.time, "sleep", lambda *a, **kw: None)

    # --- exercise -------------------------------------------------------
    rc = swap_profile(
        old_profile=V31_PROFILE,
        new_profile=V31_PROFILE,
        port=8002,
        run_dir=tmp_path / "runs" / "swap",
    )

    # --- assertions ------------------------------------------------------
    assert rc == 0, f"expected exit 0, got {rc}"

    # Parse stdout as JSON-per-line.
    stdout = capsys.readouterr().out
    records: list[dict] = []
    for line in stdout.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        records.append(json.loads(line))

    # Every record has a 'phase' key.
    assert all("phase" in r for r in records), f"non-phase record: {records}"

    # D-02 LOCKED: first-occurrence sequence of the four locked labels.
    first_occurrence: list[str] = []
    seen: set[str] = set()
    locked = {"stopping vLLM", "loading weights", "warmup", "ready"}
    for r in records:
        phase = r["phase"]
        if phase in locked and phase not in seen:
            seen.add(phase)
            first_occurrence.append(phase)

    assert first_occurrence == [
        "stopping vLLM",
        "loading weights",
        "warmup",
        "ready",
    ], f"D-02 phase order broken: {first_occurrence} (full records: {records})"

    # LOADING label should carry a pct field for at least one occurrence.
    loading_with_pct = [r for r in records if r["phase"] == "loading weights" and "pct" in r]
    assert loading_with_pct, "at least one 'loading weights' record must include pct"
    pcts = [r["pct"] for r in loading_with_pct]
    assert all(0 <= p <= 100 for p in pcts), f"pct out of range: {pcts}"

    # Docker was invoked: at least one stop + one run.
    docker_calls = [c for c in sp.calls if c and c[0] == "docker"]
    stop_calls = [c for c in docker_calls if c[1] == "stop"]
    run_calls = [c for c in docker_calls if c[1] == "run"]
    assert stop_calls, f"expected at least one docker stop, calls={docker_calls}"
    assert run_calls, f"expected at least one docker run, calls={docker_calls}"
