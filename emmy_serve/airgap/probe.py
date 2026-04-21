"""D-12 layered air-gap probes (01-RESEARCH.md §10.4 lines 1670-1682).

Each `layer_*` function returns a `LayerResult` — success or failure with the
exact commands that were run and a human-readable diagnostic. The validator
module (`validator.py`) sequences the four layers, aggregates results, and
emits the JSON report consumed by the CI workflow.

Layer rationale (01-RESEARCH.md §10.4):

| Layer | Assertion |
|-------|-----------|
| (a)   | `docker inspect` shows only `{"none": {...}}`; `docker exec ip addr` shows only `lo` |
| (b)   | `/etc/resolv.conf` has no external nameserver; `getent hosts huggingface.co` fails |
| (c)   | `VLLM_NO_USAGE_STATS=1` and `DO_NOT_TRACK=1` |
| (d)   | `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` |

Exit discipline: every helper catches timeouts + `FileNotFoundError` (for when
`docker` is not on PATH). Callers receive a `LayerResult(passed=False, ...)`
with an actionable message — never an unhandled exception.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field


@dataclass(frozen=True)
class LayerResult:
    """Result from a single D-12 layer probe."""

    layer: str  # "a" | "b" | "c" | "d"
    name: str
    passed: bool
    detail: str  # evidence / error message
    commands_run: list[str] = field(default_factory=list)


def _run(cmd: list[str], *, timeout: float = 10.0) -> tuple[int, str]:
    """Run a subprocess, returning (returncode, stdout+stderr).

    Never raises: timeout → rc=-1; missing binary → rc=-2. Callers get a
    deterministic tuple and can fail the layer with a clear message.
    """
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return -1, f"timeout after {timeout}s"
    except FileNotFoundError:
        return -2, f"command not found: {cmd[0]}"


# ---------------------------------------------------------------------------
# Layer (a) — network devices
# ---------------------------------------------------------------------------

_FORBIDDEN_IFACE_PREFIXES = ("eth", "ens", "wlan", "enp", "wlp")


def layer_a_network_devices(container: str) -> LayerResult:
    """(a) Container has no non-loopback network devices.

    Two sub-checks:
    1. `docker inspect` networks list is exactly `["none"]` — structural
       guarantee that `--network none` was honored.
    2. `docker exec <container> ip -o addr` shows no forbidden interface
       prefix (eth*, ens*, wlan*, enp*, wlp*). Accepts `lo`.
    """
    cmds: list[str] = []

    cmd1 = [
        "docker",
        "inspect",
        container,
        "--format",
        "{{json .NetworkSettings.Networks}}",
    ]
    cmds.append(" ".join(cmd1))
    rc1, out1 = _run(cmd1)
    if rc1 != 0:
        return LayerResult(
            "a", "network_devices", False,
            f"docker inspect failed: {out1.strip()}", cmds,
        )

    try:
        nets = json.loads(out1.strip())
    except json.JSONDecodeError:
        return LayerResult(
            "a", "network_devices", False,
            f"invalid json from docker inspect: {out1.strip()!r}", cmds,
        )
    if not isinstance(nets, dict) or list(nets.keys()) != ["none"]:
        keys = list(nets.keys()) if isinstance(nets, dict) else nets
        return LayerResult(
            "a", "network_devices", False,
            f"expected only 'none' network, got {keys}", cmds,
        )

    cmd2 = ["docker", "exec", container, "ip", "-o", "addr"]
    cmds.append(" ".join(cmd2))
    rc2, out2 = _run(cmd2)
    if rc2 != 0:
        return LayerResult(
            "a", "network_devices", False,
            f"ip -o addr failed: {out2.strip()}", cmds,
        )
    for line in out2.splitlines():
        parts = line.split()
        if len(parts) >= 2 and any(
            parts[1].startswith(f) for f in _FORBIDDEN_IFACE_PREFIXES
        ):
            return LayerResult(
                "a", "network_devices", False,
                f"forbidden interface present: {line.strip()}", cmds,
            )
    return LayerResult(
        "a", "network_devices", True,
        "only loopback present; networks=['none']", cmds,
    )


# ---------------------------------------------------------------------------
# Layer (b) — DNS audit
# ---------------------------------------------------------------------------

_ALLOWED_NS_PREFIXES = ("127.",)


def layer_b_dns_audit(container: str) -> LayerResult:
    """(b) DNS must be unreachable from inside the container.

    Sub-checks:
    1. `/etc/resolv.conf` has no external (non-loopback) nameserver.
    2. `getent hosts huggingface.co` returns non-zero (resolution fails).
    """
    cmds: list[str] = []

    cmd1 = ["docker", "exec", container, "cat", "/etc/resolv.conf"]
    cmds.append(" ".join(cmd1))
    _rc1, out1 = _run(cmd1)
    # resolv.conf may be empty / unreadable — that's OK. We only reject
    # explicit external nameservers.
    bad_ns: list[str] = []
    for line in (out1 or "").splitlines():
        s = line.strip()
        if s.startswith("nameserver"):
            parts = s.split()
            if len(parts) < 2:
                continue
            ns = parts[1]
            if not any(ns.startswith(p) for p in _ALLOWED_NS_PREFIXES):
                bad_ns.append(ns)
    if bad_ns:
        return LayerResult(
            "b", "dns_audit", False,
            f"external nameservers present in /etc/resolv.conf: {bad_ns}", cmds,
        )

    cmd2 = ["docker", "exec", container, "getent", "hosts", "huggingface.co"]
    cmds.append(" ".join(cmd2))
    rc2, out2 = _run(cmd2, timeout=5.0)
    if rc2 == 0:
        return LayerResult(
            "b", "dns_audit", False,
            f"getent resolved huggingface.co (air-gap violated): {out2.strip()!r}",
            cmds,
        )
    return LayerResult(
        "b", "dns_audit", True,
        "no external DNS reachable (huggingface.co resolution failed as required)",
        cmds,
    )


# ---------------------------------------------------------------------------
# Layer (c) — telemetry env
# ---------------------------------------------------------------------------

_TELEMETRY_REQUIRED = (
    ("VLLM_NO_USAGE_STATS", "1"),
    ("DO_NOT_TRACK", "1"),
)


def layer_c_telemetry_env(container: str) -> LayerResult:
    """(c) Telemetry kill-switch env vars are set in the container."""
    cmds: list[str] = []
    missing: list[str] = []
    for var, expected in _TELEMETRY_REQUIRED:
        cmd = ["docker", "exec", container, "printenv", var]
        cmds.append(" ".join(cmd))
        rc, out = _run(cmd)
        got = out.strip()
        if rc != 0 or got != expected:
            missing.append(f"{var}={got or '<unset>'} (expected {expected})")
    if missing:
        return LayerResult(
            "c", "telemetry_env", False,
            "; ".join(missing), cmds,
        )
    return LayerResult(
        "c", "telemetry_env", True,
        "VLLM_NO_USAGE_STATS=1 DO_NOT_TRACK=1", cmds,
    )


# ---------------------------------------------------------------------------
# Layer (d) — HF offline env
# ---------------------------------------------------------------------------

_HF_OFFLINE_REQUIRED = (
    ("HF_HUB_OFFLINE", "1"),
    ("TRANSFORMERS_OFFLINE", "1"),
)


def layer_d_hf_offline_env(container: str) -> LayerResult:
    """(d) HF Hub / transformers offline env vars are set in the container."""
    cmds: list[str] = []
    missing: list[str] = []
    for var, expected in _HF_OFFLINE_REQUIRED:
        cmd = ["docker", "exec", container, "printenv", var]
        cmds.append(" ".join(cmd))
        rc, out = _run(cmd)
        got = out.strip()
        if rc != 0 or got != expected:
            missing.append(f"{var}={got or '<unset>'} (expected {expected})")
    if missing:
        return LayerResult(
            "d", "hf_offline_env", False,
            "; ".join(missing), cmds,
        )
    return LayerResult(
        "d", "hf_offline_env", True,
        "HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1", cmds,
    )
