"""RED skeleton — SERVE-01/02/04/10 + PROFILE-09 integration boot tests.

Require a running vLLM container on `base_url` (default http://127.0.0.1:8002)
plus the Phase 1 profile bundle present. Mark with @pytest.mark.integration so
default `pytest` runs skip them.
"""
from __future__ import annotations
import subprocess
import time
from pathlib import Path
import pytest

httpx = pytest.importorskip("httpx")
canary = pytest.importorskip("emmy_serve.canary")
probe = pytest.importorskip("emmy_serve.boot.probe")

pytestmark = pytest.mark.integration


def test_models_endpoint(base_url: str):
    """SERVE-02: GET /v1/models returns 200 with qwen3.6-35b-a3b in the body."""
    r = httpx.get(f"{base_url}/v1/models", timeout=10.0)
    assert r.status_code == 200, f"unexpected status: {r.status_code}"
    body = r.text
    assert "qwen3.6-35b-a3b" in body, f"served model name missing in: {body}"


def test_throughput_floor(base_url: str):
    """SERVE-02: 100-token generation completes at >= 60 tok/s measured decode.

    ``enable_thinking=false`` isolates decode throughput from Qwen3.6's CoT
    emission (see emmy_serve/canary/generate.py for rationale).
    """
    payload = {
        "model": "qwen3.6-35b-a3b",
        "messages": [{"role": "user", "content": "Count to 100."}],
        "max_tokens": 100,
        "temperature": 0.0,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    t0 = time.perf_counter()
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=60.0)
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, r.text

    body = r.json()
    usage = body.get("usage", {}) or {}
    completion_tokens = usage.get("completion_tokens", 0)
    tok_per_s = completion_tokens / max(elapsed, 1e-6)
    assert tok_per_s >= 60.0, f"throughput {tok_per_s:.1f} tok/s below 60 floor"


def test_extra_body_passthrough(base_url: str):
    """SERVE-04: /v1/chat/completions with extra_body guided_json must succeed (200)."""
    payload = {
        "model": "qwen3.6-35b-a3b",
        "messages": [{"role": "user", "content": "give me {\"n\": 1}"}],
        "max_tokens": 16,
        "temperature": 0.0,
        "extra_body": {
            "guided_json": {
                "type": "object",
                "properties": {"n": {"type": "integer"}},
                "required": ["n"],
            }
        },
    }
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=30.0)
    assert r.status_code == 200, f"extra_body rejected: {r.status_code} {r.text}"


@pytest.mark.slow
def test_cold_start_time(profile_path: Path):
    """SERVE-10: docker run -> /v1/models 200 in < 240s (fastsafetensors path).

    This test orchestrates a fresh container lifecycle; run manually via
    --run-slow --run-integration on Spark.
    """
    # Stop any existing container
    subprocess.run(["docker", "rm", "-f", "emmy-serve"], capture_output=True)

    runner = pytest.importorskip("emmy_serve.boot.runner")
    args = runner.render_docker_args(
        profile_path=profile_path, run_dir=Path("/tmp"), port=8002, airgap=False
    )
    t0 = time.perf_counter()
    subprocess.run(["docker", "run", "-d", "--name", "emmy-serve", *args], check=True)
    probe.wait_for_vllm("http://127.0.0.1:8002", timeout_s=240, interval_s=0.5)
    elapsed = time.perf_counter() - t0
    assert elapsed < 240.0, f"cold start took {elapsed:.1f}s (>240s ceiling)"


def test_smoke_all_three(base_url: str):
    """PROFILE-09: SP_OK + tool_call_parse + 100-token generation all pass.

    Uses ``canary.tool_call.load_default_tool_schema()`` for the read_file
    OpenAI-formatted schema ({"type": "function", "function": {…}}) rather
    than an ad-hoc inline dict, which vLLM rejects with 400.
    """
    from emmy_serve.canary.tool_call import load_default_tool_schema
    sp_ok, _ = canary.run_sp_ok(base_url, served_model_name="qwen3.6-35b-a3b")
    tool_ok, _ = canary.run_tool_call(
        base_url,
        served_model_name="qwen3.6-35b-a3b",
        tool_schema=load_default_tool_schema(),
    )
    gen_ok, _, _ = canary.run_generate(base_url, served_model_name="qwen3.6-35b-a3b")
    assert sp_ok and tool_ok and gen_ok, (
        f"smoke failed: sp_ok={sp_ok}, tool_ok={tool_ok}, gen_ok={gen_ok}"
    )
