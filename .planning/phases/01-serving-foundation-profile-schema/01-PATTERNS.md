# Phase 1: Serving Foundation + Profile Schema — Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 26 new files (emmy is greenfield — no in-repo analogs)
**Analogs found:** 14 / 26 (prior-repo at `/data/projects/setup_local_opencode/`)

## Executive summary

Emmy is greenfield. No in-repo analogs exist. Every pattern assignment below references either the prior-repo `setup_local_opencode/` (the approved "shape to steal" per CONTEXT.md §Code Context and ARCHITECTURE.md §2) or RESEARCH.md §sections (for greenfield-with-guidance cases). Plans **copy the shape, not the code** — emmy is a clean rebuild per PROJECT.md.

Two dominant patterns inherit from the prior repo:
1. **Typed-YAML loader with `_reject_unknown_keys` + frozen dataclasses** (`dgx_stack/config.py`, `dgx_stack/providers/config.py`) → emmy rewrites this as pydantic v2 with `ConfigDict(extra='forbid', frozen=True)` (same shape, modern library; see RESEARCH.md §6).
2. **Atomic writer + run-layout for event streams** (`dgx_stack/runs/write.py`, `dgx_stack/runs/layout.py`, `dgx_stack/runs/ids.py`) → emmy copies `write_json_atomic` / `write_text_atomic` + `append_jsonl_atomic` verbatim in shape for D-06 diagnostic bundles, the KV-finder iteration log, and the thermal sampler log.

Files with **NO prior analog** are genuinely new and take their shape from RESEARCH.md prescriptive sections.

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `emmy_serve/profile/loader.py` | loader | file-I/O, transform | `dgx_stack/config.py` + `dgx_stack/providers/config.py` | exact (shape) |
| `emmy_serve/profile/schema.py` | schema | transform | `dgx_stack/config.py` (dataclass shape) + RESEARCH.md §2/§3 | role-match (pydantic v2 instead of frozen dataclass) |
| `emmy_serve/profile/hasher.py` | hasher | file-I/O, transform | NONE (RESEARCH.md §4 prescribes) | no analog |
| `emmy_serve/profile/immutability.py` | validator | file-I/O | NONE (new invariant; shape in RESEARCH.md §5 Layer 1) | no analog |
| `emmy_serve/cli.py` | CLI entrypoint | request-response | `dgx_stack/cli/app.py` | role-match (argparse subcommands) |
| `scripts/validate_profile.py` | CLI shim | file-I/O | `dgx_stack/cli/app.py` (thin argparse shim idiom) | partial |
| `scripts/hash_profile.py` | CLI shim | file-I/O | same as above | partial |
| `emmy_serve/canary/sp_ok.py` | canary library | request-response (HTTP) | NONE (D-07 is new; shape in RESEARCH.md §7.2) | no analog |
| `emmy_serve/canary/tool_call.py` | canary library | request-response (HTTP) | NONE (D-08; shape in RESEARCH.md §7.3) | no analog |
| `emmy_serve/canary/generate.py` | canary library | request-response (HTTP) | NONE (RESEARCH.md §7.4) | no analog |
| `emmy_serve/canary/logging.py` | log format | event-driven, append | `dgx_stack/runs/write.py` (atomic append) | role-match |
| `emmy_serve/canary/replay.py` | replay driver | request-response (HTTP) | NONE (D-11; shape in RESEARCH.md §10.3) | no analog |
| `emmy_serve/boot/probe.py` | HTTP prober | request-response | NONE (RESEARCH.md §7.1) | no analog |
| `emmy_serve/boot/runner.py` | orchestrator | subprocess, transform | `scripts/start_unified.sh` (docker-run builder shape) | partial |
| `emmy_serve/diagnostics/bundle.py` | writer | file-I/O, append | `dgx_stack/runs/write.py` + `dgx_stack/runs/layout.py` | exact (shape) |
| `emmy_serve/diagnostics/atomic.py` | utility | file-I/O | `dgx_stack/runs/write.py` | exact (shape) |
| `emmy_serve/kv_finder/bisect.py` | algorithm | batch, transform | NONE (D-13; shape in RESEARCH.md §8) | no analog |
| `emmy_serve/kv_finder/metrics.py` | prometheus parser | HTTP pull | NONE (RESEARCH.md §8 + "Code Examples") | no analog |
| `emmy_serve/kv_finder/load_driver.py` | load driver | request-response (HTTP) | `validation/eval_tasks.py` (prompt corpus shape) | partial |
| `emmy_serve/thermal/replay.py` | loop harness | event-driven | NONE (D-14; shape in RESEARCH.md §9.6) | no analog |
| `emmy_serve/thermal/sampler.py` | metrics sampler | streaming, append | `dgx_stack/runs/write.py` (append_jsonl_atomic) | role-match |
| `emmy_serve/thermal/audit.py` | characterizer | batch, transform | NONE (D-14; shape in RESEARCH.md §9.2–§9.5) | no analog |
| `scripts/start_emmy.sh` | orchestrator | subprocess | `scripts/start_unified.sh` | role-match (bash docker-run orchestrator) |
| `scripts/find_kv_budget.py` | CLI wrapper | subprocess | `dgx_stack/cli/app.py` (thin wrapper shape) | partial |
| `scripts/thermal_replay.py` | CLI wrapper | subprocess | same | partial |
| `scripts/smoke_test.py` | CLI wrapper | subprocess | same | partial |
| `scripts/airgap_probe.py` | assertion CLI | subprocess, transform | NONE (D-12; shape in RESEARCH.md §10.4) | no analog |
| `air_gap/session.jsonl` | fixture (data) | static | NONE (D-11; shape in RESEARCH.md §10.3) | no analog |
| `profiles/qwen3.6-35b-a3b/v1/profile.yaml` | config | static | RESEARCH.md §4 (canonical manifest format) | prescribed |
| `profiles/qwen3.6-35b-a3b/v1/serving.yaml` | config | static | ARCHITECTURE.md §2 + RESEARCH.md §2 | prescribed |
| `profiles/qwen3.6-35b-a3b/v1/harness.yaml` | config | static | ARCHITECTURE.md §2 + RESEARCH.md §3 | prescribed |
| `profiles/qwen3.6-35b-a3b/v1/prompts/system.md` | fixture | static | RESEARCH.md §7.2 (SP_OK prompt template verbatim) | prescribed |
| `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` | doc | static | RESEARCH.md §5 (frontmatter + markdown template) | prescribed |
| `.github/workflows/airgap.yml` | CI config | event-driven | NONE (prior repo has no `.github/workflows/`) — RESEARCH.md §10.2 | no analog |
| `tests/conftest.py` | test fixture | transform | NONE — RESEARCH.md §11 "Wave 0" | no analog |
| Wave 0 `tests/unit/*` test stubs | tests | request-response | partial for schema/hasher (mirror `dgx_stack` shape); otherwise new | partial |

---

## Pattern Assignments

### Pattern A — Typed-YAML loader (shared by schema + loader + profile.yaml consumers)

**Analog 1:** `/data/projects/setup_local_opencode/dgx_stack/config.py`
**Analog 2:** `/data/projects/setup_local_opencode/dgx_stack/providers/config.py`

**What to copy (shape):**
- `_reject_unknown_keys(d, *, allowed, at)` typo-safety helper
- `_require_str`, `_require_int`, `_require_dict` type-assert helpers that raise a domain error tagged with a dotted path (`at="root.models"`)
- `ConfigError` / `ProviderConfigError` domain-specific exception classes (emmy should mint `ProfileConfigError`)
- `@dataclass(frozen=True)` for all nested config objects
- Precedence chain: `defaults < repo < user < env < CLI` (the four `load_*_config()` functions in `providers/config.py` — Layer reading)

**What to diverge on:**
- Use **pydantic v2** `BaseModel` with `ConfigDict(extra='forbid', frozen=True)` instead of frozen dataclasses + manual `_require_*` helpers (RESEARCH.md §6). Pydantic v2 gives `extra='forbid'` for free, better error messages, and JSON-Schema export for future IDE/TS integration. The `_reject_unknown_keys` behavior is built-in via `extra='forbid'`.
- Still mint `ProfileConfigError` as the single domain error class so callers can `except` against a stable type.

**Concrete analog excerpt (shape-to-copy), `dgx_stack/config.py` lines 72-94:**

```python
def _require_dict(value: Any, *, at: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{at} must be a mapping")
    return value

def _require_str(value: Any, *, at: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{at} must be a non-empty string")
    return value

def _reject_unknown_keys(d: dict[str, Any], *, allowed: set[str], at: str) -> None:
    unknown = sorted(set(d.keys()) - allowed)
    if unknown:
        raise ConfigError(f"{at} has unknown keys: {', '.join(unknown)}")
```

**Concrete analog excerpt (dotted-path error reporting idiom), `dgx_stack/config.py` lines 109-139:**

```python
def _parse_model(model_key: str, raw: Any) -> ModelSpec:
    at = f"models.{model_key}"
    d = _require_dict(raw, at=at)
    _reject_unknown_keys(
        d, allowed={"repo_id", "local_path", "served_model_name"}, at=at
    )

    repo_id = d.get("repo_id")
    local_path = d.get("local_path")
    served_model_name = d.get("served_model_name")

    if repo_id is not None:
        repo_id = _require_str(repo_id, at=f"{at}.repo_id")
    ...
```

Invariant to preserve in emmy: every validation error carries the exact dotted YAML path (`engine.gpu_memory_utilization`, `env.HF_HUB_OFFLINE`) so the D-06 diagnostic bundle and the `emmy profile validate` output point the developer at the offending field. Pydantic v2's default error format already emits `.loc` as a tuple — map it to dotted-path strings in the error-reporting layer.

**Applies to:**
- `emmy_serve/profile/loader.py` — YAML → pydantic call, with file discovery (walk `profile_dir / *.yaml`, look up `profile.yaml`, `serving.yaml`, `harness.yaml`).
- `emmy_serve/profile/schema.py` — all pydantic models (`ServingConfig`, `HarnessConfig`, `ProfileManifest`). Every nested `BaseModel` gets `model_config = ConfigDict(extra='forbid', frozen=True)`. Match the field list in RESEARCH.md §2 (`serving.yaml`) and §3 (`harness.yaml`) exactly — those sections specify required vs. optional, types, and validators.

**Deviations from analog:**
- No env-var overlay in Phase 1 — profiles are file-resident and don't take CLI overrides. The `providers/config.py` `set_cli_overrides` / `load_env_config` pattern is **out of scope**; re-examine in Phase 4 when multiple profiles exist.
- No XDG_CONFIG_HOME discovery — profile paths are explicit CLI args.

---

### Pattern B — Atomic file writes for event streams

**Analog:** `/data/projects/setup_local_opencode/dgx_stack/runs/write.py` (entire file)

**What to copy (shape, essentially verbatim):**

```python
# dgx_stack/runs/write.py (entire body, 47 lines)
def write_bytes_atomic(path: str | Path, data: bytes) -> None:
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            delete=False,
            dir=str(dest.parent),
            prefix=f".{dest.name}.",
            suffix=".tmp",
        ) as f:
            tmp_path = Path(f.name)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())

        os.replace(tmp_path, dest)
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def write_text_atomic(path: str | Path, text: str, *, encoding: str = "utf-8") -> None:
    if not text.endswith("\n"):
        text = text + "\n"
    write_bytes_atomic(path, text.encode(encoding))


def write_json_atomic(path: str | Path, obj: Any) -> None:
    payload = json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
    write_text_atomic(path, payload)
```

**Key invariants to preserve:**
- Temp file created **in the same directory** as the destination (so `os.replace` is atomic — same filesystem).
- Dot-prefixed temp name (`.{dest.name}.XXX.tmp`) so `ls` hides the temporary files.
- `flush()` **then** `os.fsync()` **then** `os.replace()` — the fsync before rename is what makes the write durable.
- Cleanup in `finally` block — if `os.replace` succeeded, `tmp_path.exists()` returns False and cleanup is a no-op; if it failed, the temp file is removed.
- `write_json_atomic` forces `ensure_ascii=True, sort_keys=True, indent=2` — determinism for hashability.

**What emmy needs to add:**

```python
# emmy_serve/diagnostics/atomic.py — new function, not in analog
def append_jsonl_atomic(path: Path, obj: dict) -> None:
    """Append one JSON line, fsync'd. Used for KV-finder iterations.jsonl,
       thermal sampler's gpu_samples.jsonl / responses.jsonl / vllm_metrics.jsonl."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True, separators=(',', ':')) + '\n'
    with open(path, 'a', buffering=1) as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())
```

Rationale: the prior repo's `runs/write.py` only emits full-file atomic writes. The KV-finder (D-13) and thermal sampler (D-14/15) need **append-once-per-iteration** semantics so a crash mid-run still preserves every completed iteration's data. This is the idiomatic JSONL event-stream pattern — add it alongside the three copied functions.

**Applies to:**
- `emmy_serve/diagnostics/atomic.py` — hosts all four functions (`write_bytes_atomic`, `write_text_atomic`, `write_json_atomic`, `append_jsonl_atomic`).
- `emmy_serve/diagnostics/bundle.py` — D-06 bundle writer uses `write_json_atomic` for `check.json`, `profile.json`, `env.json`, `response.json`; `write_text_atomic` for `prompt.txt`, `response.txt`, `docker-logs.txt`, `metrics-snapshot.txt`.
- `emmy_serve/kv_finder/bisect.py` — uses `append_jsonl_atomic` for `runs/<iso>-kv-finder/iterations.jsonl`; `write_json_atomic` for the final `summary.json`.
- `emmy_serve/thermal/sampler.py` + `emmy_serve/thermal/replay.py` — `append_jsonl_atomic` for all four sampler streams (`gpu_samples.jsonl`, `responses.jsonl`, `vllm_metrics.jsonl`, `prompts_used.jsonl`); `write_json_atomic` for `summary.json`.
- `emmy_serve/canary/logging.py` — `append_jsonl_atomic` for the shared CanaryResult event stream (imported by every later phase per EVAL-07).

---

### Pattern C — Run-layout helper (stable artifact paths)

**Analog:** `/data/projects/setup_local_opencode/dgx_stack/runs/layout.py` (entire file, 83 lines)

**What to copy (shape):**

```python
# dgx_stack/runs/layout.py lines 11-66 — frozen dataclass with property-based paths
@dataclass(frozen=True)
class RunLayout:
    """Build stable run artifact paths under `outputs/<run_id>/...`."""

    base_dir: Path
    run_id: str
    final_format: Literal["json", "txt"] = "json"

    def __post_init__(self) -> None:
        base = Path(self.base_dir)
        object.__setattr__(self, "base_dir", base)

        rid = str(self.run_id).strip()
        if not rid:
            raise ValueError("run_id must be a non-empty string")
        object.__setattr__(self, "run_id", rid)

    @property
    def run_dir(self) -> Path:
        return self.base_dir / self.run_id

    @property
    def inputs_dir(self) -> Path:
        return self.run_dir / "inputs"

    @property
    def logs_dir(self) -> Path:
        return self.run_dir / "logs"

    @property
    def metadata_path(self) -> Path:
        return self.run_dir / "metadata.json"
```

**Run-ID generation, `dgx_stack/runs/ids.py` lines 7-31:**

```python
_RUN_ID_TS_FORMAT = "%Y%m%dT%H%M%SZ"  # lexicographically sortable in UTC

def new_run_id(*, now: datetime | None = None, suffix_len: int = 6) -> str:
    """Generate a run id as `{timestamp}_{suffix}`."""
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    ts = now.astimezone(timezone.utc).strftime(_RUN_ID_TS_FORMAT)
    nbytes = (suffix_len + 1) // 2
    suffix = secrets.token_hex(nbytes)[:suffix_len]
    return f"{ts}_{suffix}"
```

**Key invariants to preserve:**
- Frozen dataclass — a `RunLayout` instance is immutable, safe to pass across threads (the KV-finder and thermal replay both spawn background samplers).
- **Property-based paths**, never string concatenation at call sites — callers use `layout.steps_dir / step_id` instead of `f"{base_dir}/{run_id}/steps/{step_id}"`. This lets us rename a subdir once in one place.
- `__post_init__` validates `run_id` is non-empty.
- Run-ID is a **lexicographically-sortable UTC timestamp + hex suffix** (`20260421T142311Z_a1b2c3`) — sort alphabetically and you get chronological order.

**Emmy adaptation (RESEARCH.md §14 directory layout):**

Emmy has four distinct run-dir shapes (boot-failures, kv-finder, thermal, airgap). Rather than four separate classes, define one `RunLayout` with properties for each shape, parameterized by `kind`:

```python
# emmy_serve/diagnostics/layout.py — shape adapted from dgx_stack
@dataclass(frozen=True)
class EmmyRunLayout:
    base_dir: Path                     # repo-root/runs/
    run_id: str                        # e.g. "20260421T142311Z_a1b2c3"
    kind: Literal["boot-failure", "kv-finder", "thermal", "airgap", "phase1-validation"]

    @property
    def run_dir(self) -> Path:
        return self.base_dir / f"{self.run_id}-{self.kind}"

    # Shared
    @property
    def summary_path(self) -> Path: return self.run_dir / "summary.json"

    # Boot-failure specific
    @property
    def check_path(self) -> Path: return self.run_dir / "check.json"
    @property
    def profile_snapshot_path(self) -> Path: return self.run_dir / "profile.json"
    @property
    def prompt_path(self) -> Path: return self.run_dir / "prompt.txt"
    @property
    def response_path(self) -> Path: return self.run_dir / "response.txt"
    @property
    def docker_logs_path(self) -> Path: return self.run_dir / "docker-logs.txt"
    @property
    def env_path(self) -> Path: return self.run_dir / "env.json"
    @property
    def metrics_snapshot_path(self) -> Path: return self.run_dir / "metrics-snapshot.txt"

    # KV-finder specific
    @property
    def iterations_path(self) -> Path: return self.run_dir / "iterations.jsonl"

    # Thermal specific
    @property
    def gpu_samples_path(self) -> Path: return self.run_dir / "gpu_samples.jsonl"
    @property
    def vllm_metrics_path(self) -> Path: return self.run_dir / "vllm_metrics.jsonl"
    @property
    def responses_path(self) -> Path: return self.run_dir / "responses.jsonl"
    @property
    def prompts_used_path(self) -> Path: return self.run_dir / "prompts_used.jsonl"
    @property
    def dmesg_tail_path(self) -> Path: return self.run_dir / "dmesg_tail.txt"
```

Mirror the dgx_stack pattern: `run_id` from a shared helper, all paths via `@property`, frozen dataclass.

**Applies to:**
- `emmy_serve/diagnostics/bundle.py` — instantiates `EmmyRunLayout(kind="boot-failure", ...)` and writes all seven files via the Pattern B atomic helpers.
- `emmy_serve/kv_finder/bisect.py` — uses `kind="kv-finder"`; writes `iterations.jsonl` per iter + `summary.json` on convergence.
- `emmy_serve/thermal/replay.py` — uses `kind="thermal"`; writes all four JSONL streams + `summary.json` + `dmesg_tail.txt`.
- `scripts/airgap_probe.py` — uses `kind="airgap"`; writes `check.json` + layered-assertion results.

---

### Pattern D — `docker run` orchestrator (bash + python render helpers)

**Analog:** `/data/projects/setup_local_opencode/scripts/start_unified.sh` (first 80 lines read)

**What to copy (shape):**

```bash
# scripts/start_unified.sh lines 1-74 — top-level orchestrator structure
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

. scripts/common.sh

# Verify Docker access
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: cannot connect to Docker daemon" >&2
  echo "- run: sudo usermod -aG docker \$USER  (then log out/in)" >&2
  exit 1
fi

SERVER_NAME="guardrailed"
CNAME="$(container_name "$SERVER_NAME")"
IMAGE="$(vllm_docker_image)"

# Stop any existing container
stop_docker_server "$SERVER_NAME"

PY="$(python_bin)"

SERVED_NAME="$("$PY" scripts/resolve_model.py --server guardrailed --print-served-model-name)"
PORT="$("$PY" scripts/resolve_model.py --server guardrailed --print-port)"
MAX_LEN="$("$PY" scripts/resolve_model.py --server guardrailed --print-max-model-len)"
LOCAL_PATH="$("$PY" scripts/resolve_model.py --server guardrailed --print-local-path)"
...
CMD=(
  docker run -d
  --name "$CNAME"
  --gpus all
  --shm-size 8g
  -v "${ROOT_DIR}/models:/models:ro"
  -p "${PORT}:${PORT}"
  "$IMAGE"
  vllm serve "$CONTAINER_MODEL_PATH"
  --host 0.0.0.0 --port "$PORT"
  --max-model-len "$MAX_LEN"
  --served-model-name "$SERVED_NAME"
  --gpu-memory-utilization "$GPU_MEM_UTIL"
  --load-format "$LOAD_FMT"
  --kv-cache-dtype "$KV_DTYPE"
  --enable-prefix-caching
)
```

**Key invariants to preserve:**
- `set -euo pipefail` as the first line after the shebang.
- `ROOT_DIR` computed relative to the script's own location so the script works from any cwd.
- **Python does the YAML parsing**, bash does the orchestration. The script calls `python3 scripts/resolve_model.py --print-*` to extract individual values. Emmy upgrades this: a single `python3 -m emmy_serve.boot.runner render-docker-args --profile PATH` returns the whole flag array, reducing the number of subprocess calls.
- Docker CLI args assembled into a bash array `CMD=(...)` so they round-trip correctly with spaces / empty values.
- Verify prerequisites (`docker info`) **before** doing anything destructive.
- Stop an existing container of the same name before starting a new one (idempotence).

**Emmy deviations / additions from RESEARCH.md §14:**
- Pin digest via `sha256:<hash>` embedded in `serving.yaml.engine.container_image_digest`; read it via a `python3 -c "import yaml; ..."` one-liner (RESEARCH.md §12).
- **Fail-loud + roll-back on smoke-test failure** (D-06): after `scripts/smoke_test.py` fails, copy the run dir into `runs/boot-failures/<iso>/`, dump `docker logs emmy-serve`, `docker stop`, `exit 1`.
- Exit codes: 0 (ready), 1 (smoke rejected), 2 (schema invalid), 3 (digest mismatch), 4 (prereq missing) — defined in RESEARCH.md §14 `start_emmy.sh contract`.
- Network-mode argument: `--network host` by default (dev), `--network none` when `AIRGAP=1` env var is set (D-09).

**Applies to:**
- `scripts/start_emmy.sh` — the bash orchestrator; 80–120 lines, shape identical to analog but with digest pinning, profile loading, smoke-test invocation, and the D-06 rollback path.
- `emmy_serve/boot/runner.py` — Python helper that renders `docker run` args from `serving.yaml` (replaces the analog's `resolve_model.py`). Signature: `def render_docker_args(profile_path: Path, run_dir: Path, port: int, airgap: bool = False) -> list[str]`. Returns a list suitable for `subprocess.run([...])` or to be printed space-separated for bash `$(...)` capture.

**Deviation from analog:** the prior repo used `docker run -d` (detached) and polled externally. Emmy also runs detached and polls from `start_emmy.sh` via `scripts/smoke_test.py` — same shape. The difference is that emmy always assigns `--name emmy-serve` (fixed, not parameterized) because Phase 1 only has one profile and one running container at a time.

---

### Pattern E — argparse-subcommand CLI (for `emmy profile validate` / `emmy profile hash`)

**Analog:** `/data/projects/setup_local_opencode/dgx_stack/cli/app.py` (lines 1-80 read)

**What to copy (shape):**

```python
# dgx_stack/cli/app.py — argparse subcommand dispatch
HandlerFn = Callable[[argparse.Namespace], int]

def _add_run_common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--out", default="outputs", help="...")
    p.add_argument("--run-id", help="...")
    ...

def _attach_handler(p: argparse.ArgumentParser, fn: HandlerFn) -> None:
    p.set_defaults(_handler=fn)
```

**Key invariants to preserve:**
- Shared argparse-ancestry helpers (`_add_*_flags`) for cross-subcommand flags.
- Each subparser has a handler bound via `set_defaults(_handler=fn)`; dispatch in `main()` via `args._handler(args)`.
- Every handler returns `int` exit code; `main()` does `sys.exit(handler(args))`.

**Emmy's needed subcommands (RESEARCH.md §5 + §14):**

```
emmy profile validate <path> [--strict] [--fix-hash]
emmy profile hash     <path> [--write] [--check]
```

Exit codes per RESEARCH.md §5 validator CLI behavior spec:
- `validate` — 0 ok, 1 schema error, 2 hash mismatch, 3 canonicalization error, 4 cross-field policy failure.
- `hash` — 0 match, 1 mismatch, 2 canonicalization error.

**Applies to:**
- `emmy_serve/cli.py` — console entrypoint. Register subparsers for `profile validate` and `profile hash`. Use the `dgx_stack/cli/app.py` handler-binding pattern verbatim.
- `scripts/validate_profile.py`, `scripts/hash_profile.py` — **thin shims** — `from emmy_serve.cli import main; main(['profile', 'validate', ...])`. Exist so CI and `start_emmy.sh` can invoke a predictable filesystem path without depending on `console_scripts` entry-point registration.
- `scripts/find_kv_budget.py`, `scripts/thermal_replay.py`, `scripts/smoke_test.py`, `scripts/airgap_probe.py` — same shim idiom, each calls `emmy_serve.kv_finder.bisect.main()` / `.thermal.replay.main()` / `.canary.main()` / a new `emmy_serve.airgap.main()`.

---

### Pattern F — Profile prompt corpus (for thermal replay)

**Analog:** `/data/projects/setup_local_opencode/validation/eval_tasks.py` (309 lines read in full)

**What to copy (shape):**

```python
# validation/eval_tasks.py — dataclass-keyed prompt registry
@dataclass
class EvalTask:
    task_id: str
    category: str           # "coding" or "literature"
    difficulty: str         # "easy", "medium", "hard"
    title: str
    prompt: str
    rubric: str
    execution_mode: str = "api"
    max_tokens: int = 4096
    timeout_seconds: int = 240
    allowed_tools: str = ""

CODE_01 = EvalTask(task_id="code_01", ...)
...
ALL_TASKS: dict[str, EvalTask] = {t.task_id: t for t in [CODE_01, ..., LIT_03]}
CODING_TASKS = [t for t in ALL_TASKS.values() if t.category == "coding"]
```

**What to preserve:**
- Module-level `EvalTask` dataclass with task_id, category, difficulty, prompt, expected rubric/shape, max_tokens, timeout.
- Module-level constants `CODE_01`, `CODE_02`, ... for each task, defined with explicit kwargs (not a dict literal — dataclasses with kwargs auto-document the schema).
- Module-level filtered lists (`CODING_TASKS`, `LITERATURE_TASKS`) and an `ALL_TASKS` dict.
- `get_task(task_id)` / `list_task_ids()` accessor functions.

**Emmy's extension (RESEARCH.md §9.1 and §9.4):**
- Phase 1 uses **only the 5 coding tasks** (CODE_01–CODE_05) as the continuity baseline; the 3 literature tasks are CLI-mode and irrelevant to pure-vLLM thermal stress (RESEARCH.md §9.1).
- Augment with 5 synthetic "agent-shape" prompts (10K/20K/30K context + two extremal-output-length) per RESEARCH.md §9.4.
- Rename fields to match emmy's domain:
  - `category` keeps same semantics.
  - `prompt` stays.
  - Add `expected_prefill_tokens: int` and `expected_decode_tokens: int` so the audit (§9.5) can compute the 1:2–2:1 prefill:decode ratio threshold without running the corpus first.
  - Drop `rubric` (not used — thermal replay doesn't judge correctness, just wire behavior).

**Applies to:**
- `emmy_serve/thermal/corpus.py` — defines `ThermalPrompt` dataclass and `PRIOR_CODING_TASKS` (copies of CODE_01–CODE_05 prompts) + `SYNTHETIC_AGENT_PROMPTS` (the 5 new §9.4 prompts). Exports `ALL_THERMAL_PROMPTS`, `get_prompt(id)`.
- `emmy_serve/thermal/audit.py` — reads the corpus, computes the §9.5 representativeness thresholds, emits a pass/fail decision to stdout.
- `emmy_serve/kv_finder/load_driver.py` — uses a **subset** of the thermal corpus (~20 prompts, planner picks mixed prefill sizes per RESEARCH.md §8 "Load driver during bisection").

**Deviations:** drop the CLI-execution-mode and `allowed_tools` fields — those were for the prior repo's MCP-tool literature tasks; emmy's thermal replay is pure `/v1/chat/completions`.

---

## Shared Patterns

### Shared Pattern 1: Frozen dataclasses + pydantic v2 models — the "configuration/data-record" idiom

**Source:** `dgx_stack/config.py` (frozen dataclasses) + RESEARCH.md §6 (pydantic v2 with `frozen=True`).

**Apply to:** Every structured data object (`ServingConfig`, `HarnessConfig`, `ProfileManifest`, `CanaryResult`, `EmmyRunLayout`, `ThermalPrompt`, `KVFinderIteration`, `ThermalSample`).

**Code to copy (shape):**

```python
# dgx_stack/config.py lines 15-34 — frozen dataclass idiom
@dataclass(frozen=True)
class ModelSpec:
    repo_id: str | None
    local_path: str | None
    served_model_name: str

@dataclass(frozen=True)
class StackConfig:
    models: dict[str, ModelSpec]
    guardrailed: ServerSpec
    bare: ServerSpec
    models_cache_dir: str
```

**Emmy's pydantic v2 equivalent (from RESEARCH.md §Architecture Pattern 1, lines 320-359):**

```python
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal, Optional

class EngineConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    model: str
    served_model_name: str
    max_model_len: int = Field(gt=0)
    gpu_memory_utilization: float = Field(gt=0.0, le=1.0)
    enable_prefix_caching: bool = True
    enable_chunked_prefill: bool = True
    max_num_batched_tokens: int = Field(gt=0)
    kv_cache_dtype: Literal['auto', 'fp8', 'fp16', 'bf16'] = 'fp8'
    load_format: Literal['auto', 'fastsafetensors', 'safetensors'] = 'fastsafetensors'
    tool_call_parser: Optional[str] = None
    container_image: str
    container_image_digest: str
```

Rule: **every configuration-shaped object** in emmy gets `ConfigDict(extra='forbid', frozen=True)`. This mirrors the prior repo's `@dataclass(frozen=True)` choice and gives typo safety for free. Data-bearing records that aren't configuration (e.g. `CanaryResult`, `KVFinderIteration`) can be frozen `@dataclass` without pydantic overhead — use pydantic only where external YAML/JSON hits the boundary.

### Shared Pattern 2: All logs write via atomic writers (no direct `f.write`)

**Source:** `dgx_stack/runs/write.py` lines 1-47.

**Apply to:** D-06 diagnostic bundle, KV-finder iterations.jsonl, thermal gpu_samples.jsonl, thermal responses.jsonl, thermal vllm_metrics.jsonl, canary event log.

Invariant: **no direct `open(path, 'w').write(...)` for a log or artifact anywhere in emmy.** Every write goes through `write_bytes_atomic` / `write_text_atomic` / `write_json_atomic` / `append_jsonl_atomic` — so a crash mid-write never produces a truncated file. Enforced by code review + optionally a grep-lint rule in CI (`pytest tests/unit/test_no_raw_writes.py` scans `emmy_serve/` for `.write(` outside `diagnostics/atomic.py`).

### Shared Pattern 3: Every run / event embeds `profile.id`, `profile.version`, `profile.hash`

**Source:** ARCHITECTURE.md §2 "Two design rules" — "The version and content hash go into every observability event so a run can always be reproduced."

**Apply to:** `CanaryResult`, every KVFinderIteration record, every thermal sample (at least in the `summary.json`), every D-06 `profile.json` snapshot.

Implementation: `emmy_serve/profile/loader.py` exposes a `ProfileRef` frozen dataclass:

```python
@dataclass(frozen=True)
class ProfileRef:
    id: str                  # "qwen3.6-35b-a3b"
    version: str             # "v1"
    hash: str                # "sha256:abc..."
    path: Path
```

Every logger/writer takes a `ProfileRef` and includes its three fields in every emitted record. No exceptions — this is the reproducibility contract baked into Phase 1.

### Shared Pattern 4: Dotted-path YAML error messages

**Source:** `dgx_stack/config.py` — the `at="root.models.X.field"` idiom threaded through every `_require_*` call.

**Apply to:** every validator error from `emmy_serve/profile/schema.py` and `emmy_serve/profile/loader.py`. Pydantic v2's native `ValidationError.errors()` returns `loc` as a tuple of path segments — convert to dotted-path strings (e.g. `"engine.gpu_memory_utilization: must be > 0.0"`) in the error-reporting layer. This gives the D-06 diagnostic bundle and `emmy profile validate` output the same shape as the prior repo's `ConfigError` messages.

### Shared Pattern 5: Pre-flight verification before any mutation

**Source:** `scripts/start_unified.sh` lines 14-18 — `docker info` check before any container ops.

**Apply to:** `scripts/start_emmy.sh` + every `scripts/*.py` wrapper. Before any irreversible action (docker run, file writes under `runs/`, network calls), verify prerequisites: docker daemon reachable, `nvidia-smi` works, model dir exists, HF cache exists, profile path resolves, profile validates. Fail with exit code 4 (prerequisite missing) + a clear remediation hint, same shape as the analog's `"run: sudo usermod -aG docker $USER"` hint.

---

## Files with No Analog

These files are genuinely greenfield — no prior-repo shape to copy. Planner takes the shape from RESEARCH.md per the "source" column.

| File | Role | Shape Source | Key Invariants |
|------|------|--------------|----------------|
| `emmy_serve/profile/hasher.py` | Canonical-manifest content hasher | RESEARCH.md §4 (full algorithm + reference code lines 755-800) | TEXT_EXTS allowlist, Unicode NFC normalization, LF normalization, symlink rejection, `sha256:<64-hex>` prefix, `hash_manifest_version: 1` |
| `emmy_serve/profile/immutability.py` | Recompute-vs-stored hash enforcer | RESEARCH.md §5 "Layer 1" | Exit code 2 on mismatch; error message cites both hashes + the "create v2/" remediation line verbatim |
| `emmy_serve/canary/sp_ok.py` | SP_OK canary | RESEARCH.md §7.2 lines 1034-1058 | `SP_OK_SYSTEM_PROMPT` constant; `SP_OK_ASSERTION_SUBSTR = "[SP_OK]"`; `temperature=0.0`; substring `in` check |
| `emmy_serve/canary/tool_call.py` | One-tool `read_file` canary | RESEARCH.md §7.3 lines 1088-1127 | Exactly one `tool_calls` entry; `name == "read_file"`; `arguments` parses JSON with `path` key |
| `emmy_serve/canary/generate.py` | 100-token decode canary | RESEARCH.md §7.4 lines 1135-1153 | `finish_reason in ('length', 'stop')`; `len(content) > 50` sanity check |
| `emmy_serve/canary/replay.py` | 50-turn session replay (D-11) | RESEARCH.md §10.3 lines 1639-1665 | Measure wire format, not model correctness; `_expected_tool_call` is fuzzy-asserted |
| `emmy_serve/boot/probe.py` | `wait_for_vllm` poller | RESEARCH.md §7.1 lines 1005-1024 | 300s timeout, 500ms interval, TimeoutError with `last_err` on failure |
| `emmy_serve/kv_finder/bisect.py` | KV-budget bisection (D-13) | RESEARCH.md §8 lines 1231-1290 | Start 0.75, step up until preemption, bisect halving step each direction change, back off 5%, min_step 0.5%, max_iters 12 |
| `emmy_serve/kv_finder/metrics.py` | Prometheus parser for `/metrics` | RESEARCH.md §"Code Examples" lines 2048-2061 | `text_string_to_metric_families`; exact metric name verified at plan time (A8/Open-Q-1) |
| `emmy_serve/thermal/replay.py` | 2-hour replay harness (D-14/15) | RESEARCH.md §9.6 lines 1448-1497 | `itertools.cycle(corpus)`; 5s inter-request gap; background GPU sampler + vLLM-metrics sampler at 5s cadence; gate on canary pass before replay |
| `emmy_serve/thermal/sampler.py` | nvidia-smi + `/metrics` sampler | RESEARCH.md §9.6 | Background-thread safe; appends to JSONL; handles `nvidia-smi` subprocess timeouts |
| `emmy_serve/thermal/audit.py` | D-14 representativeness audit | RESEARCH.md §9.2–§9.5 | Thresholds: 1:2–2:1 prefill:decode, 30% ≥10K prefill, 20% tool-call, 80% duty cycle, no prompt > 15% wall-time |
| `scripts/airgap_probe.py` | Layered air-gap assertions | RESEARCH.md §10.4 lines 1670-1682 | Four layers a/b/c/d; each failure identifies the specific layer in the error; emits a JSON report |
| `air_gap/session.jsonl` | 50-turn scripted replay (fixture data) | RESEARCH.md §10.3 table lines 1621-1634 | Exactly 50 turns; mix per table (read/write/edit/bash/grep/find/ls/web_fetch/multi-tool/context-growing); JSONL schema in §10.3 lines 1607-1619 |
| `profiles/qwen3.6-35b-a3b/v1/serving.yaml` | Fully-populated Phase 1 serving config | RESEARCH.md §2 (lines 496-585) | Every field present per §2; `container_image_digest` pinned; `env.VLLM_NO_USAGE_STATS = "1"`, `env.HF_HUB_OFFLINE = "1"`; `speculative: null`; `gpu_memory_utilization: 0.75` placeholder (validator-rejected on final commit per Pitfall 1) |
| `profiles/qwen3.6-35b-a3b/v1/harness.yaml` | Minimal-valid Phase-2-placeholder stub | RESEARCH.md §3 (lines 617-677) | Every required field present per §3; `TODO(Phase-2)` comments on every placeholder value; all paths under `prompts/`, `tool_schemas/`, `grammars/` either null or referencing the `system.md` that exists |
| `profiles/qwen3.6-35b-a3b/v1/profile.yaml` | Profile manifest + computed hash | RESEARCH.md §4 (lines 729-751) | `profile.hash = sha256:<64-hex>`; `hash_algorithm: sha256`; `hash_manifest_version: 1`; `community_sources` has ≥1 entry with `title`/`url`/`retrieved` |
| `profiles/qwen3.6-35b-a3b/v1/prompts/system.md` | SP_OK canary system prompt | RESEARCH.md §7.2 line 1037-1039 verbatim | Exactly: `"When the user says 'ping' you must reply with the exact literal text [SP_OK] and nothing else."` |
| `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` | Provenance + measured values | RESEARCH.md §5 (lines 813-907 template) | YAML frontmatter with `measured_values` + `validation_runs`; markdown provenance tables per §5; cites ≥1 source per non-trivial default (PROFILE-05) |
| `profiles/qwen3.6-35b-a3b/v1/tool_schemas/.gitkeep` | D-01 empty-dir marker | D-01 + .gitkeep convention | Zero bytes; present so the directory is tracked |
| `profiles/qwen3.6-35b-a3b/v1/grammars/.gitkeep` | D-01 empty-dir marker | same | same |
| `.github/workflows/airgap.yml` | Self-hosted-runner air-gap CI | RESEARCH.md §10.2 lines 1587-1602 | `runs-on: [self-hosted, dgx-spark]`; concurrency group `airgap-{ref}` with `cancel-in-progress: true`; triggers on paths `[emmy-serve/**, profiles/**, scripts/start_emmy.sh, scripts/smoke_test.py, air_gap/**]` |
| `tests/conftest.py` | Shared pytest fixtures | RESEARCH.md §11 "Wave 0 Gaps" | Provides `profile_path`, `base_url`, `tmp_runs_dir` fixtures; session-scoped for `base_url` if container is already up |
| `tests/unit/test_schema.py` | pydantic `extra='forbid'` tests | RESEARCH.md §11 mapping for PROFILE-03/04 | Asserts serving.yaml valid, unknown-key rejection, cross-field validation (`env.VLLM_NO_USAGE_STATS == "1"`, `env.HF_HUB_OFFLINE == "1"`) |
| `tests/unit/test_hasher.py` | Canonicalization rules | RESEARCH.md §4 canonicalization points 1-10 + Pitfall 4 | Exclusion list works; symlink raises; non-UTF-8 raises; LF normalization; `.gitkeep` included, other dot-files rejected |
| `tests/unit/test_immutability.py` | Recompute-vs-stored hash | RESEARCH.md §5 Layer 1 | Validator exits 2 on mismatch; error message names both hashes |
| `tests/unit/test_canary.py` | `emmy.canary` import + result schema | RESEARCH.md §7.6 lines 1186-1212 | `CanaryResult` has all 8 fields; `run_sp_ok` returns `(bool, str)`; `log_canary_event` appends JSONL |
| `tests/unit/test_session_jsonl.py` | 50-turn schema + coverage | RESEARCH.md §10.3 | Exactly 50 turns; every tool type in §10.3 table present at least once |
| `tests/integration/test_boot.py` | Container-up smoke | RESEARCH.md §11 mapping for SERVE-02/04/10, PROFILE-09 | `/v1/models` responds; 100-token throughput ≥60 tok/s; `extra_body` accepted; cold-start < 4 min |
| `tests/integration/test_airgap.py` | Env + network assertions | RESEARCH.md §10.4 layers (c), (d) | `printenv VLLM_NO_USAGE_STATS == 1` in container; `ip addr` shows only `lo`; DNS resolution fails |
| `tests/integration/test_offline_hf.py` | REPRO-04 offline load | RESEARCH.md §13 flow + Pitfall 5 | `HF_HUB_OFFLINE=1 HF_HOME=... AutoTokenizer.from_pretrained(...)` succeeds without HTTP |
| `tests/integration/test_kv_budget.py` | 30-min zero-preemption | RESEARCH.md §11 mapping for SERVE-08 | Drives load for 30 min at the finder-selected budget, asserts `vllm:num_preemptions_total` delta == 0 |

---

## Metadata

**Analog search scope:** `/data/projects/setup_local_opencode/` (prior repo — the only sanctioned source of shape-to-copy per CONTEXT.md §Code Context).

**Files scanned directly:**
- `/data/projects/setup_local_opencode/dgx_stack/config.py` (201 lines — full read)
- `/data/projects/setup_local_opencode/dgx_stack/providers/config.py` (322 lines — full read)
- `/data/projects/setup_local_opencode/dgx_stack/runs/layout.py` (83 lines — full read)
- `/data/projects/setup_local_opencode/dgx_stack/runs/write.py` (47 lines — full read)
- `/data/projects/setup_local_opencode/dgx_stack/runs/ids.py` (31 lines — full read)
- `/data/projects/setup_local_opencode/dgx_stack/runs/__init__.py` (30 lines — full read)
- `/data/projects/setup_local_opencode/dgx_stack/cli/app.py` (first 80 lines)
- `/data/projects/setup_local_opencode/scripts/start_unified.sh` (first 80 lines)
- `/data/projects/setup_local_opencode/validation/eval_tasks.py` (309 lines — full read)

**Canonical references (shape for greenfield files):**
- `/data/projects/emmy/.planning/phases/01-serving-foundation-profile-schema/01-CONTEXT.md` — D-01..D-16 locked decisions
- `/data/projects/emmy/.planning/phases/01-serving-foundation-profile-schema/01-RESEARCH.md` §§1-14 — phase-scoped prescriptive design
- `/data/projects/emmy/.planning/research/ARCHITECTURE.md` §2 (profile schema), §4 (deployment topology)
- `/data/projects/emmy/CLAUDE.md` — pinned stack, critical pitfalls, keystone abstraction

**Pattern extraction date:** 2026-04-20
