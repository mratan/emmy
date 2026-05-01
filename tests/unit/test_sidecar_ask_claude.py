"""RED — POST /ask-claude integration tests (Phase 04.6 Plan 01).

Covers Phase 04.6 LOCKED contracts:
    - D-03 — EMMY_ASK_CLAUDE env-gate: unset → 503 'env_disabled', no spawn.
    - D-11 — claude CLI must be on PATH; absent → 503 'claude_cli_not_found'.
    - D-06 — scrubber match → 400 'scrubber_blocked'; subprocess NEVER spawned.
    - D-09 — happy path: argv=['claude','--print','-']; prompt fed via stdin
             (NEVER as command-line arg or via shell).
    - D-07 — rate-limits: 1 in-flight max (429 'rate_limited_concurrent'),
             1-call-per-3s gap (429 'rate_limited_min_gap'),
             30 calls/hour cap (429 'rate_limited_hourly').
    - D-08 — JSONL audit: events carry sha256 + lengths + timing; NEVER
             raw prompt/response unless EMMY_LOG_FULL=on.
    - Subprocess error handling: non-zero exit → 502 'subprocess_failed'
             with audit 'error' event captured.

Modeled after tests/unit/test_sidecar_start.py and test_sidecar_stop.py:
    - autouse _reset_runtime fixture for module-level singleton hygiene
    - TestClient(_ctl.app)
    - asyncio.create_subprocess_exec replaced by a recording spy
    - asyncio.sleep monkeypatched to a no-op for rate-limit gap tests

The subprocess spy NEVER spawns a real `claude` binary. T-04.2-S3 + T-04.6-S3:
no real subprocess in unit tests; the spy records argv, captures stdin via
the proc.communicate() call, and returns canned (stdout, stderr, returncode).
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from emmy_serve.swap import controller as _ctl


# ----------------------------------------------------------------------------
# Spy for asyncio.create_subprocess_exec — no real `claude` binary spawned.
# ----------------------------------------------------------------------------


class _FakeProc:
    """Stand-in for asyncio.subprocess.Process.

    Records the stdin bytes received via .communicate(input=...) and returns
    canned (stdout, stderr) from the spy that constructed it.
    """

    def __init__(
        self,
        spy: "_ClaudeSpy",
        stdout_bytes: bytes,
        stderr_bytes: bytes,
        returncode: int,
        delay_s: float,
    ) -> None:
        self._spy = spy
        self._stdout = stdout_bytes
        self._stderr = stderr_bytes
        self.returncode = returncode
        self._delay_s = delay_s
        self.awaited_wait: bool = False

    async def communicate(self, input: bytes | None = None) -> tuple[bytes, bytes]:
        # Capture the input that the handler piped to "stdin" of `claude --print -`.
        self._spy.last_stdin = input.decode("utf-8") if input is not None else ""
        if self._delay_s > 0:
            import asyncio

            await asyncio.sleep(self._delay_s)
        return self._stdout, self._stderr

    def kill(self) -> None:
        # No-op; tests that drive timeouts assert the handler reaches the
        # finally branch, not that an OS kill fired.
        self._spy.kill_called = True

    async def wait(self) -> int:
        # WR-02 — handler awaits proc.wait() after kill() to reap the zombie.
        # Record the call so the regression test can assert the handler hit
        # this branch (no FDs leaked); return canned returncode immediately.
        self.awaited_wait = True
        self._spy.last_proc = self
        return self.returncode


class _ClaudeSpy:
    """Replace asyncio.create_subprocess_exec inside the controller module.

    Each call records the argv tuple; returns a _FakeProc with canned stdout/
    stderr/returncode/delay configured via setters.
    """

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.last_kwargs: dict = {}
        self.last_stdin: str | None = None
        self.kill_called: bool = False
        self.last_proc: "_FakeProc | None" = None
        self._stdout: bytes = b""
        self._stderr: bytes = b""
        self._returncode: int = 0
        self._delay_s: float = 0.0

    def set_response(self, text: str) -> None:
        self._stdout = text.encode("utf-8")
        self._returncode = 0
        self._stderr = b""

    def set_exit_code(self, rc: int) -> None:
        self._returncode = rc

    def set_stderr(self, text: str) -> None:
        self._stderr = text.encode("utf-8")

    def set_delay_s(self, seconds: float) -> None:
        self._delay_s = seconds

    @property
    def call_count(self) -> int:
        return len(self.calls)

    @property
    def last_argv(self) -> list[str]:
        return self.calls[-1] if self.calls else []

    async def __call__(self, *argv: str, **kwargs):
        self.calls.append(list(argv))
        # 04.6-04 followup C.1 — capture cwd= kwarg so the sandbox-vs-inherit
        # contract can be asserted without re-spawning real subprocesses.
        self.last_kwargs = dict(kwargs)
        proc = _FakeProc(
            self,
            self._stdout,
            self._stderr,
            self._returncode,
            self._delay_s,
        )
        # Track the most recent proc so timeout-path tests can assert
        # awaited_wait was set (WR-02 regression guard).
        self.last_proc = proc
        return proc


# ----------------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_runtime() -> None:
    """Module-level singletons in controller.py persist; clear before each test."""
    _ctl._reset_runtime_for_tests()


@pytest.fixture
def mock_claude(monkeypatch: pytest.MonkeyPatch) -> _ClaudeSpy:
    """Replace asyncio.create_subprocess_exec inside the controller module.

    Also stubs shutil.which('claude') so the D-11 PATH gate accepts the
    binary in tests that aren't specifically exercising the gate itself.
    """
    spy = _ClaudeSpy()
    # Patch the controller module's reference to asyncio.create_subprocess_exec.
    monkeypatch.setattr(
        _ctl.asyncio,
        "create_subprocess_exec",
        spy,
    )
    # Default: claude appears installed (D-11 gate passes). Tests that want
    # to exercise the missing-binary path use a separate fixture or the
    # monkeypatch context to override.
    monkeypatch.setattr(_ctl.shutil, "which", lambda name: f"/usr/local/bin/{name}")
    return spy


@pytest.fixture
def jsonl_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect the audit JSONL output to a per-test tmp_path.

    The controller exposes a module-level helper `_audit_jsonl_path()` that
    the handler uses to discover the events file. We override it via
    monkeypatch so each test gets an isolated audit log.
    """
    out = tmp_path / "ask_claude_events.jsonl"
    monkeypatch.setattr(_ctl, "_audit_jsonl_path", lambda: out)
    return tmp_path


def _read_events(jsonl_dir: Path) -> list[dict]:
    """Read all JSONL events emitted to the test's audit dir."""
    f = jsonl_dir / "ask_claude_events.jsonl"
    if not f.exists():
        return []
    out: list[dict] = []
    for line in f.read_text().splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


@pytest.fixture
def client() -> TestClient:
    return TestClient(_ctl.app)


# ----------------------------------------------------------------------------
# D-03 env gate
# ----------------------------------------------------------------------------


def test_endpoint_returns_503_when_env_unset(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-03 — EMMY_ASK_CLAUDE unset → 503 'env_disabled', no subprocess spawn.

    WR-03 — the handler MUST also emit an `env_gate_denied` audit event so
    forensic analysis can detect operator/attacker env-flap activity. The
    event carries sha256+length only (D-08 default privacy posture).
    """
    monkeypatch.delenv("EMMY_ASK_CLAUDE", raising=False)
    monkeypatch.delenv("EMMY_LOG_FULL", raising=False)

    prompt = "hi"
    r = client.post("/ask-claude", json={"prompt": prompt})
    assert r.status_code == 503, r.text
    body = r.json()
    # Pydantic/HTTPException wraps detail under 'detail'.
    detail = body.get("detail", body)
    assert detail.get("reason") == "env_disabled", body
    assert mock_claude.call_count == 0, "subprocess MUST NOT spawn when env is off"

    # WR-03 — the audit event was emitted with sha256+length; no plaintext.
    events = _read_events(jsonl_dir)
    denied = [
        ev for ev in events if ev.get("event", "").endswith(".env_gate_denied")
    ]
    assert denied, f"expected env_gate_denied audit event, got {events}"
    ev = denied[0]
    expected_sha = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    assert ev.get("prompt_sha256") == expected_sha, ev
    assert ev.get("prompt_len") == len(prompt), ev
    # Default posture: NO raw prompt anywhere.
    assert "prompt_full" not in ev, ev
    for v in ev.values():
        if isinstance(v, str):
            assert v != prompt, f"raw prompt leaked: {ev}"


# ----------------------------------------------------------------------------
# D-11 claude-on-PATH gate
# ----------------------------------------------------------------------------


def test_endpoint_returns_503_when_claude_cli_missing(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-11 — claude not on PATH → 503 'claude_cli_not_found'.

    Note: this test does NOT use the mock_claude fixture (which stubs
    shutil.which). Instead we override shutil.which to return None so the
    gate triggers.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.setattr(_ctl.shutil, "which", lambda name: None)

    # Patch create_subprocess_exec to a poison fixture: if the handler
    # reaches it the test must fail — D-11 gate is upstream of spawn.
    async def _poison(*args, **kwargs):  # pragma: no cover — must NOT be called
        raise AssertionError("handler reached subprocess despite missing CLI")

    monkeypatch.setattr(_ctl.asyncio, "create_subprocess_exec", _poison)

    r = client.post("/ask-claude", json={"prompt": "hi"})
    assert r.status_code == 503, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "claude_cli_not_found", body


# ----------------------------------------------------------------------------
# D-06 scrubber gate
# ----------------------------------------------------------------------------


def test_endpoint_blocks_dirty_prompt(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-06 / T-01 — scrubber blocks AKIA pattern → 400 'scrubber_blocked'.

    Subprocess MUST NOT spawn. Audit event MUST be emitted.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")

    r = client.post(
        "/ask-claude",
        json={"prompt": "use AKIAIOSFODNN7EXAMPLE for the bucket"},
    )
    assert r.status_code == 400, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "scrubber_blocked", body
    assert detail.get("pattern_class") == "aws_access_key_id", body
    assert mock_claude.call_count == 0, "subprocess MUST NOT spawn on scrubber match"

    # An audit event must be written (D-08).
    events = _read_events(jsonl_dir)
    assert any(
        ev.get("event", "").endswith(".scrubber_blocked") for ev in events
    ), f"expected scrubber_blocked audit event, got {events}"


# ----------------------------------------------------------------------------
# D-09 subprocess invocation: argv + stdin, never shell
# ----------------------------------------------------------------------------


def test_endpoint_invokes_claude_argv_stdin(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-09 — happy path: argv=['claude','--print','-']; prompt via stdin."""
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    mock_claude.set_response("4")

    r = client.post("/ask-claude", json={"prompt": "what is 2+2"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("response") == "4", body
    assert "duration_ms" in body
    assert "rate_limit_remaining_hour" in body

    # D-09 invariant: argv is the locked sequence; prompt is data only.
    # 04.6-04 followup B extended the locked sequence with --allowedTools
    # WebSearch so Claude can answer time-sensitive questions instead of
    # caveating against its training cutoff. Stdin still carries the prompt.
    assert mock_claude.call_count == 1
    assert mock_claude.last_argv == [
        "claude", "--print", "--allowedTools", "WebSearch", "-",
    ], mock_claude.last_argv
    assert mock_claude.last_stdin == "what is 2+2"


# ----------------------------------------------------------------------------
# D-07 rate-limit: 1 in-flight concurrent
# ----------------------------------------------------------------------------


def test_endpoint_global_rate_limit_in_flight(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-07 — 1 in-flight max: 2nd concurrent call returns 429 'rate_limited_concurrent'."""
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    # Pre-position the in-flight flag as if a request is already running. The
    # handler MUST observe this under its lock and bail with 429.
    _ctl._ASK_CLAUDE_STATE["in_flight"] = True

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 429, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "rate_limited_concurrent", body
    assert mock_claude.call_count == 0


# ----------------------------------------------------------------------------
# D-07 rate-limit: 30 calls/hour ceiling
# ----------------------------------------------------------------------------


def test_endpoint_global_rate_limit_per_hour(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-07 — 30 calls/hour cap: pre-fill 30 timestamps, next call → 429 'rate_limited_hourly'.

    We sidestep driving 30 real calls by pre-filling the rolling window with
    30 fresh timestamps. The handler MUST prune-then-check and reject with
    'rate_limited_hourly' on the 31st.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    now = time.monotonic()
    _ctl._ASK_CLAUDE_STATE["calls_this_hour"] = [now - 60 for _ in range(30)]
    # Make sure last_call_ts is far enough back that the min-gap doesn't fire first.
    _ctl._ASK_CLAUDE_STATE["last_call_ts"] = now - 3600

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 429, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "rate_limited_hourly", body
    assert mock_claude.call_count == 0


# ----------------------------------------------------------------------------
# D-07 rate-limit: 1-call-per-3s minimum gap
# ----------------------------------------------------------------------------


def test_endpoint_min_gap_3s(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-07 — 1-call-per-3s minimum gap: rapid 2nd call returns 429 'rate_limited_min_gap'.

    Set last_call_ts to "very recent" (now - 0.5s); the handler MUST refuse.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    _ctl._ASK_CLAUDE_STATE["last_call_ts"] = time.monotonic() - 0.5
    _ctl._ASK_CLAUDE_STATE["calls_this_hour"] = []

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 429, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "rate_limited_min_gap", body
    assert mock_claude.call_count == 0


# ----------------------------------------------------------------------------
# D-08 audit log shape — happy path
# ----------------------------------------------------------------------------


def test_endpoint_emits_audit_event_request(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08 — happy-path emits at least one event with sha256s + lengths + timing,
    NEVER raw prompt/response (default privacy posture).
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.delenv("EMMY_LOG_FULL", raising=False)
    mock_claude.set_response("the answer is 4")

    prompt = "what is 2+2"
    r = client.post("/ask-claude", json={"prompt": prompt})
    assert r.status_code == 200, r.text

    events = _read_events(jsonl_dir)
    assert events, "expected at least one audit event"

    # At least one event must carry the request fingerprint.
    expected_prompt_sha = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    matched_request = [
        ev for ev in events
        if ev.get("event", "").endswith(".request")
        and ev.get("prompt_sha256") == expected_prompt_sha
    ]
    assert matched_request, f"expected one .request event with prompt_sha256={expected_prompt_sha[:8]}…, got {events}"
    req_ev = matched_request[0]
    assert req_ev.get("prompt_len") == len(prompt), req_ev

    # At least one event must carry the response fingerprint.
    expected_resp_sha = hashlib.sha256(b"the answer is 4").hexdigest()
    matched_resp = [
        ev for ev in events
        if ev.get("response_sha256") == expected_resp_sha
    ]
    assert matched_resp, f"expected response_sha256={expected_resp_sha[:8]}… in some event, got {events}"
    resp_ev = matched_resp[0]
    assert resp_ev.get("response_len") == len("the answer is 4")
    assert resp_ev.get("duration_ms", -1) >= 0

    # Default privacy: NO raw prompt/response anywhere in the JSONL.
    for ev in events:
        assert "prompt_full" not in ev, f"raw prompt leaked into JSONL: {ev}"
        assert "response_full" not in ev, f"raw response leaked into JSONL: {ev}"
        # Belt-and-suspenders: nothing should equal the literal prompt either.
        for v in ev.values():
            if isinstance(v, str):
                assert v != prompt, f"raw prompt string leaked: {ev}"
                assert v != "the answer is 4", f"raw response string leaked: {ev}"


# ----------------------------------------------------------------------------
# D-08 audit log shape — error path
# ----------------------------------------------------------------------------


def test_endpoint_emits_audit_event_error(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08 — claude exits non-zero → 502 + 'error' audit event captured."""
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    mock_claude.set_exit_code(1)
    mock_claude.set_stderr("authentication required")
    # Stdout could be anything; spy default is empty. Set explicit empty for clarity.
    mock_claude._stdout = b""

    r = client.post("/ask-claude", json={"prompt": "hi"})
    assert r.status_code == 502, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "subprocess_failed", body

    events = _read_events(jsonl_dir)
    error_events = [ev for ev in events if ev.get("event", "").endswith(".error")]
    assert error_events, f"expected an .error audit event, got {events}"
    err = error_events[0]
    # Exit code surfaces in the audit event.
    assert err.get("exit_code") == 1, err


# ----------------------------------------------------------------------------
# CR-01 (Phase 04.6 review) — scrubber-blocked path MUST NOT leak the literal
# matched secret into the JSONL audit or the HTTP error body when the default
# privacy posture is in force (EMMY_LOG_FULL unset). Mirrors the existing
# prompt_full / response_full gating in emit_event_ask_claude (D-08).
# ----------------------------------------------------------------------------


def test_scrubber_blocked_event_does_not_leak_secret(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08 / CR-01 — default privacy posture: NO `matched_excerpt` in audit
    or HTTP body when EMMY_LOG_FULL is not 'on'. The literal AKIA must NEVER
    appear anywhere in the audit JSONL.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.delenv("EMMY_LOG_FULL", raising=False)
    aws_key = "AKIAIOSFODNN7EXAMPLE"

    r = client.post("/ask-claude", json={"prompt": f"use {aws_key} for the bucket"})
    assert r.status_code == 400, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "scrubber_blocked"
    assert detail.get("pattern_class") == "aws_access_key_id"
    # Default posture: HTTP error body must NOT carry matched_excerpt.
    assert "matched_excerpt" not in detail, detail
    # And the literal AKIA token must not appear ANYWHERE in the body string.
    assert aws_key not in r.text, "AWS key literal leaked into HTTP body"

    events = _read_events(jsonl_dir)
    assert events, "expected at least one audit event"
    for ev in events:
        # The literal secret must NEVER appear in any event field, regardless
        # of which key carries it.
        assert "matched_excerpt" not in ev, f"matched_excerpt leaked: {ev}"
        for v in ev.values():
            if isinstance(v, str):
                assert aws_key not in v, f"AWS key literal leaked into audit: {ev}"


def test_scrubber_blocked_event_carries_excerpt_when_log_full_on(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08 / CR-01 — explicit debug gesture: when EMMY_LOG_FULL=on the
    operator has consented to plaintext logging, so matched_excerpt is
    permitted in audit + HTTP body (mirrors prompt_full/response_full).
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.setenv("EMMY_LOG_FULL", "on")
    aws_key = "AKIAIOSFODNN7EXAMPLE"

    r = client.post("/ask-claude", json={"prompt": f"use {aws_key} for the bucket"})
    assert r.status_code == 400, r.text
    body = r.json()
    detail = body.get("detail", body)
    # With EMMY_LOG_FULL=on, the operator-facing diagnostic excerpt is allowed.
    assert detail.get("matched_excerpt") is not None, detail
    assert aws_key in detail["matched_excerpt"], detail

    events = _read_events(jsonl_dir)
    blocked = [
        ev for ev in events if ev.get("event", "").endswith(".scrubber_blocked")
    ]
    assert blocked, f"expected scrubber_blocked event, got {events}"
    # Either matched_excerpt is present (debug-on path) OR the prompt_full
    # field carries the secret — both are acceptable when EMMY_LOG_FULL=on.
    ev = blocked[0]
    assert ev.get("matched_excerpt") is not None, ev


# ----------------------------------------------------------------------------
# WR-02 (Phase 04.6 review) — subprocess timeout MUST reap the zombie. The v1
# handler called proc.kill() but never awaited proc.wait(); asyncio's
# subprocess transport keeps the PID + 3 pipe FDs alive until wait() runs,
# so under sustained timeout pressure the sidecar leaks FDs until it hits
# RLIMIT_NOFILE.
# ----------------------------------------------------------------------------


def test_endpoint_timeout_reaps_zombie(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WR-02 — on TimeoutError the handler MUST: (1) call proc.kill(),
    (2) await proc.wait() to reap. Without (2), FDs leak.

    We drive a timeout by setting the spy's delay > the request's
    timeout_ms, then assert kill_called AND awaited_wait both fired.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    # AskClaudeRequest enforces timeout_ms >= 1000, so we drive the timeout
    # by directly monkeypatching the default constant down to ~5ms and then
    # running the spy at ~50ms delay. Skips the 1-second wall-clock cost.
    monkeypatch.setattr(_ctl, "_ASK_CLAUDE_DEFAULT_TIMEOUT_MS", 5)
    mock_claude.set_delay_s(0.05)

    r = client.post(
        "/ask-claude",
        json={"prompt": "hello"},
    )
    assert r.status_code == 504, r.text
    body = r.json()
    detail = body.get("detail", body)
    assert detail.get("reason") == "timeout"

    # The handler hit BOTH cleanup steps.
    assert mock_claude.kill_called, "handler must call proc.kill() on timeout"
    proc = mock_claude.last_proc
    assert proc is not None, "spy did not record the FakeProc"
    assert proc.awaited_wait, (
        "handler must await proc.wait() after kill() — "
        "without it asyncio's transport leaks the child PID + pipe FDs"
    )


# ----------------------------------------------------------------------------
# Plan 04.6-04 followup C.1 — context sandbox + B WebSearch tool
# ----------------------------------------------------------------------------


def test_sandbox_cwd_is_tmpdir_by_default(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Default mode (no env set): subprocess spawns from a fresh tmpdir so
    Claude Code's auto-discovery (CLAUDE.md, ~/.claude/projects/<cwd>/memory/)
    finds nothing. The audit JSONL accurately reflects the bytes sent to
    Anthropic — no implicit context expansion.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.delenv("EMMY_ASK_CLAUDE_INHERIT_CONTEXT", raising=False)
    mock_claude.set_response("ok")

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 200, r.text

    # cwd= was passed to the subprocess and points at a tmpdir under /tmp
    # (or whatever tempfile.mkdtemp resolves to).
    cwd = mock_claude.last_kwargs.get("cwd")
    assert cwd is not None, "expected sandbox tmpdir, got cwd=None"
    assert "emmy-ask-claude-" in str(cwd), f"unexpected sandbox path: {cwd}"


def test_inherit_cwd_when_env_set(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """EMMY_ASK_CLAUDE_INHERIT_CONTEXT=1 → subprocess spawns from the sidecar's
    WorkingDirectory. Claude Code's auto-discovery picks up CLAUDE.md +
    auto-memory. Operator opt-in for Emmy-specific escalations.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.setenv("EMMY_ASK_CLAUDE_INHERIT_CONTEXT", "1")
    mock_claude.set_response("ok")

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 200, r.text

    # cwd= explicitly None → asyncio.create_subprocess_exec inherits cwd.
    assert "cwd" in mock_claude.last_kwargs
    assert mock_claude.last_kwargs["cwd"] is None


@pytest.mark.parametrize(
    "env_value", ["1", "true", "TRUE", "on", "ON", "yes", "Yes"],
)
def test_inherit_env_accepts_truthy_variants(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    env_value: str,
) -> None:
    """Match the discipline of EMMY_REMOTE_CLIENT and other env gates: accept
    the common truthy spellings, not just literal "1".
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.setenv("EMMY_ASK_CLAUDE_INHERIT_CONTEXT", env_value)
    mock_claude.set_response("ok")

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 200
    assert mock_claude.last_kwargs["cwd"] is None


def test_audit_request_event_carries_cwd_kind_sandbox(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Default mode: every event in the call chain (request, response) carries
    cwd_kind=sandbox so the operator's audit trail accurately reflects what
    was sent to Anthropic. Closes the D-08 gap where implicit context
    expansion was invisible to the audit log.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.delenv("EMMY_ASK_CLAUDE_INHERIT_CONTEXT", raising=False)
    mock_claude.set_response("ok")

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 200

    jsonl_path = jsonl_dir / "ask_claude_events.jsonl"
    events = [json.loads(line) for line in jsonl_path.read_text().strip().splitlines()]
    request_evt = next(e for e in events if e["event"] == "emmy.ask_claude.request")
    response_evt = next(e for e in events if e["event"] == "emmy.ask_claude.response")
    assert request_evt["cwd_kind"] == "sandbox"
    assert response_evt["cwd_kind"] == "sandbox"


def test_audit_request_event_carries_cwd_kind_inherit_when_opted_in(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Inherit mode: events carry cwd_kind=inherit so the operator can audit
    which calls were exposed to auto-discovery context.
    """
    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.setenv("EMMY_ASK_CLAUDE_INHERIT_CONTEXT", "1")
    mock_claude.set_response("ok")

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 200

    jsonl_path = jsonl_dir / "ask_claude_events.jsonl"
    events = [json.loads(line) for line in jsonl_path.read_text().strip().splitlines()]
    request_evt = next(e for e in events if e["event"] == "emmy.ask_claude.request")
    response_evt = next(e for e in events if e["event"] == "emmy.ask_claude.response")
    assert request_evt["cwd_kind"] == "inherit"
    assert response_evt["cwd_kind"] == "inherit"


def test_sandbox_tmpdir_is_cleaned_up_after_call(
    client: TestClient,
    mock_claude: _ClaudeSpy,
    jsonl_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The per-call sandbox tmpdir must not accumulate on disk — finally block
    rmtrees it after each /ask-claude call (success or error path).
    """
    import os as _os

    monkeypatch.setenv("EMMY_ASK_CLAUDE", "on")
    monkeypatch.delenv("EMMY_ASK_CLAUDE_INHERIT_CONTEXT", raising=False)
    mock_claude.set_response("ok")

    r = client.post("/ask-claude", json={"prompt": "hello"})
    assert r.status_code == 200

    sandbox_path = mock_claude.last_kwargs["cwd"]
    assert sandbox_path is not None
    # The tmpdir was created during the call and removed in the finally block.
    assert not _os.path.exists(sandbox_path), (
        f"sandbox tmpdir leaked: {sandbox_path}"
    )
