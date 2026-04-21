"""RED skeleton — REPRO-03 self-hosted air-gap workflow.

Plan 05 ships `.github/workflows/airgap.yml` with:
- `runs-on: [self-hosted, dgx-spark]`
- `concurrency: { group: airgap-${{ github.ref }}, cancel-in-progress: true }`
- `on.pull_request.paths: [emmy-serve/**, profiles/**, scripts/start_emmy.sh, air_gap/**]`
"""
from __future__ import annotations
from pathlib import Path
import pytest

yaml = pytest.importorskip("yaml")

WORKFLOW_PATH = (
    Path(__file__).parent.parent.parent / ".github" / "workflows" / "airgap.yml"
)


def _skip_if_no_workflow() -> Path:
    if not WORKFLOW_PATH.exists():
        pytest.skip(f"{WORKFLOW_PATH} not yet created (Plan 05)")
    return WORKFLOW_PATH


def _load_workflow() -> dict:
    return yaml.safe_load(_skip_if_no_workflow().read_text(encoding="utf-8"))


def test_airgap_yml_present():
    """REPRO-03: .github/workflows/airgap.yml exists and YAML-parses."""
    wf = _load_workflow()
    assert isinstance(wf, dict)


def test_runs_on_self_hosted_dgx_spark():
    """REPRO-03 / D-10: at least one job targets [self-hosted, dgx-spark]."""
    wf = _load_workflow()
    jobs = wf.get("jobs", {}) or {}
    hits = []
    for job_name, job in jobs.items():
        runs_on = job.get("runs-on")
        # Accept list or string forms
        if isinstance(runs_on, list) and "self-hosted" in runs_on and "dgx-spark" in runs_on:
            hits.append(job_name)
    assert hits, f"no job with runs-on: [self-hosted, dgx-spark] in {list(jobs)}"


def test_concurrency_group_set():
    """D-10: concurrency group names 'airgap' + cancel-in-progress true."""
    wf = _load_workflow()
    # Concurrency may be at top-level or per-job
    top = wf.get("concurrency")
    jobs = wf.get("jobs", {}) or {}
    candidates = [top] + [j.get("concurrency") for j in jobs.values()]
    candidates = [c for c in candidates if c]
    assert candidates, "no concurrency block on workflow or any job"

    ok = False
    for c in candidates:
        group = c.get("group") if isinstance(c, dict) else None
        cancel = c.get("cancel-in-progress") if isinstance(c, dict) else None
        if group and "airgap" in str(group) and cancel is True:
            ok = True
            break
    assert ok, f"no concurrency group containing 'airgap' with cancel-in-progress: true; got {candidates}"


def test_paths_filter_includes_profile_dir():
    """D-10: on.pull_request.paths covers emmy-serve, profiles, start script, air_gap."""
    wf = _load_workflow()
    # YAML `on:` is loaded as `True` by PyYAML (it's the "on" bool alias); handle both keys
    on_block = wf.get("on") or wf.get(True)
    assert on_block is not None, "workflow missing 'on' block"
    pr = on_block.get("pull_request") if isinstance(on_block, dict) else None
    assert pr is not None, "workflow missing on.pull_request"
    paths = pr.get("paths", []) if isinstance(pr, dict) else []
    required_substrings = ["profiles/**", "emmy-serve/**", "scripts/start_emmy.sh", "air_gap/**"]
    for sub in required_substrings:
        assert any(sub in p for p in paths), (
            f"on.pull_request.paths missing {sub!r}; got {paths}"
        )
