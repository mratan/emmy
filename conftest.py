"""Shared pytest fixtures for Emmy Phase 1 tests."""
from __future__ import annotations
import os
import shutil
import subprocess
from pathlib import Path
from typing import Iterator

import pytest

REPO_ROOT = Path(__file__).parent.resolve()
PROFILE_PATH = REPO_ROOT / "profiles" / "gemma-4-26b-a4b-it" / "v1"


def pytest_addoption(parser):
    parser.addoption("--run-slow", action="store_true", default=False, help="run slow tests")
    parser.addoption("--run-integration", action="store_true", default=False, help="run integration tests (needs Docker)")
    parser.addoption("--run-airgap", action="store_true", default=False, help="run air-gap tests (self-hosted runner only)")


def pytest_collection_modifyitems(config, items):
    skip_slow = pytest.mark.skip(reason="use --run-slow to run")
    skip_integration = pytest.mark.skip(reason="use --run-integration to run (needs Docker)")
    skip_airgap = pytest.mark.skip(reason="use --run-airgap to run (self-hosted runner only)")
    for item in items:
        if "slow" in item.keywords and not config.getoption("--run-slow"):
            item.add_marker(skip_slow)
        if "integration" in item.keywords and not config.getoption("--run-integration"):
            item.add_marker(skip_integration)
        if "airgap" in item.keywords and not config.getoption("--run-airgap"):
            item.add_marker(skip_airgap)


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture(scope="session")
def profile_path() -> Path:
    """Path to the Phase 1 profile bundle. Plan 02 creates the contents."""
    return PROFILE_PATH


@pytest.fixture(scope="session")
def base_url() -> str:
    """vLLM loopback URL. Integration tests assume a running container."""
    return os.environ.get("EMMY_BASE_URL", "http://127.0.0.1:8002")


@pytest.fixture
def tmp_runs_dir(tmp_path: Path) -> Path:
    d = tmp_path / "runs"
    d.mkdir()
    return d


@pytest.fixture(scope="session")
def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        subprocess.run(["docker", "info"], check=True, capture_output=True, timeout=5)
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False
