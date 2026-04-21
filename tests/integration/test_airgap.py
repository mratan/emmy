"""RED skeleton — SERVE-09 / D-12 layered air-gap assertions.

Requires a running `emmy-serve` container launched with `--network none`. Mark
both integration and airgap so default `pytest` skips them.
"""
from __future__ import annotations
import subprocess
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.airgap]


def _docker_exec(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", "exec", "emmy-serve", *cmd],
        capture_output=True,
        text=True,
    )


def test_env_usage_stats():
    """D-12 layer (c): VLLM_NO_USAGE_STATS=1 inside the container."""
    r = _docker_exec(["printenv", "VLLM_NO_USAGE_STATS"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "1", f"got: {r.stdout!r}"


def test_env_do_not_track():
    """D-12 belt-and-suspenders: DO_NOT_TRACK=1."""
    r = _docker_exec(["printenv", "DO_NOT_TRACK"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "1", f"got: {r.stdout!r}"


def test_env_hf_hub_offline():
    """D-12 layer (d): HF_HUB_OFFLINE=1."""
    r = _docker_exec(["printenv", "HF_HUB_OFFLINE"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "1", f"got: {r.stdout!r}"


def test_env_transformers_offline():
    """D-12 belt-and-suspenders: TRANSFORMERS_OFFLINE=1."""
    r = _docker_exec(["printenv", "TRANSFORMERS_OFFLINE"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "1", f"got: {r.stdout!r}"


def test_ip_addr_only_loopback():
    """D-12 layer (a): `ip addr` shows only `lo:`; no eth0/ens*."""
    r = _docker_exec(["ip", "addr"])
    assert r.returncode == 0, r.stderr
    assert "lo:" in r.stdout or "lo@" in r.stdout, f"no loopback in: {r.stdout}"
    assert "eth0" not in r.stdout, f"eth0 present (air-gap violated): {r.stdout}"
    assert "ens" not in r.stdout, f"ens* interface present: {r.stdout}"


def test_dns_resolution_fails():
    """D-12 layer (b): DNS lookup of huggingface.co must fail in the container."""
    r = _docker_exec(["getent", "hosts", "huggingface.co"])
    assert r.returncode != 0, (
        f"DNS resolved huggingface.co (air-gap violated): {r.stdout}"
    )
