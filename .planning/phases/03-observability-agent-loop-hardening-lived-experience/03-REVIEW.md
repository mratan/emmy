---
phase: 03-observability-agent-loop-hardening-lived-experience
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 95
files_reviewed_list:
  - .github/workflows/airgap-phase3.yml
  - .gitignore
  - emmy_serve/airgap/ci_verify_phase3.py
  - emmy_serve/profile/__init__.py
  - emmy_serve/profile/schema.py
  - eval/phase3/sc2-assertions.ts
  - eval/phase3/sc2-fixture-builder.test.ts
  - eval/phase3/sc2-fixture-builder.ts
  - eval/phase3/sc2-runner.ts
  - eval/phase3/think-leak.test.ts
  - observability/langfuse/.env.example
  - observability/langfuse/docker-compose.yaml
  - observability/langfuse/test_stack_healthy.sh
  - packages/emmy-context/src/compaction.ts
  - packages/emmy-context/src/config-loader.ts
  - packages/emmy-context/src/errors.ts
  - packages/emmy-context/src/index.ts
  - packages/emmy-context/src/preservation.ts
  - packages/emmy-context/src/types.ts
  - packages/emmy-context/test/compaction-schema.test.ts
  - packages/emmy-context/test/hard-ceiling.test.ts
  - packages/emmy-context/test/preservation.test.ts
  - packages/emmy-context/test/summarize-fallback.integration.test.ts
  - packages/emmy-context/test/trigger.test.ts
  - packages/emmy-provider/src/before-request-hook.ts
  - packages/emmy-provider/src/grammar-retry.ts
  - packages/emmy-provider/src/grammar-retry.weakmap.test.ts
  - packages/emmy-provider/src/hook.test.ts
  - packages/emmy-provider/src/index.ts
  - packages/emmy-provider/src/types.ts
  - packages/emmy-telemetry/src/atomic-append.ts
  - packages/emmy-telemetry/src/feedback-schema.ts
  - packages/emmy-telemetry/src/feedback.ts
  - packages/emmy-telemetry/src/hf-export.ts
  - packages/emmy-telemetry/src/index.ts
  - packages/emmy-telemetry/src/offline-audit.ts
  - packages/emmy-telemetry/src/otel-sdk.ts
  - packages/emmy-telemetry/src/profile-stamp-processor.ts
  - packages/emmy-telemetry/src/session-context.ts
  - packages/emmy-telemetry/src/span-factory.ts
  - packages/emmy-telemetry/src/turn-tracker.ts
  - packages/emmy-telemetry/test/atomic-append.test.ts
  - packages/emmy-telemetry/test/dual-sink.test.ts
  - packages/emmy-telemetry/test/export-hf.integration.test.ts
  - packages/emmy-telemetry/test/feedback-append.test.ts
  - packages/emmy-telemetry/test/feedback-idempotent.test.ts
  - packages/emmy-telemetry/test/killswitch.test.ts
  - packages/emmy-telemetry/test/offline-audit.test.ts
  - packages/emmy-telemetry/test/otlp-exporter.test.ts
  - packages/emmy-telemetry/test/span-attributes.test.ts
  - packages/emmy-tools/src/index.ts
  - packages/emmy-tools/src/mcp-bridge.ts
  - packages/emmy-tools/src/native-tools.ts
  - packages/emmy-tools/src/tool-definition-adapter.ts
  - packages/emmy-tools/src/types.ts
  - packages/emmy-tools/src/web-fetch-allowlist.ts
  - packages/emmy-tools/src/web-fetch.ts
  - packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts
  - packages/emmy-ux/bin/pi-emmy.ts
  - packages/emmy-ux/src/feedback-ui.ts
  - packages/emmy-ux/src/footer.ts
  - packages/emmy-ux/src/index.ts
  - packages/emmy-ux/src/metrics-poller.ts
  - packages/emmy-ux/src/nvidia-smi.ts
  - packages/emmy-ux/src/offline-badge.ts
  - packages/emmy-ux/src/pi-emmy-extension.ts
  - packages/emmy-ux/src/profile-loader.ts
  - packages/emmy-ux/src/session.ts
  - packages/emmy-ux/src/vllm-metrics.ts
  - packages/emmy-ux/test/boot-banner.test.ts
  - packages/emmy-ux/test/feedback-flow.integration.test.ts
  - packages/emmy-ux/test/footer-degrade.test.ts
  - packages/emmy-ux/test/footer.test.ts
  - packages/emmy-ux/test/keybind-capture.test.ts
  - packages/emmy-ux/test/metrics-poller.test.ts
  - packages/emmy-ux/test/nvidia-smi.test.ts
  - packages/emmy-ux/test/offline-badge.test.ts
  - packages/emmy-ux/test/profile-loader-no-telemetry.test.ts
  - packages/emmy-ux/test/session.boot.test.ts
  - packages/emmy-ux/test/session.mcp-poison.test.ts
  - packages/emmy-ux/test/sp-ok-canary.integration.test.ts
  - profiles/qwen3.6-35b-a3b/v3/harness.yaml
  - profiles/qwen3.6-35b-a3b/v3/profile.yaml
  - profiles/qwen3.6-35b-a3b/v3/serving.yaml
  - scripts/airgap_phase3_replay.sh
  - scripts/footer_parity_check.sh
  - scripts/phase3_close_walkthrough.sh
  - scripts/sc1_trace_walkthrough.sh
  - scripts/sc2_200turn_compaction.sh
  - scripts/sc5_offline_badge.sh
  - scripts/start_observability.sh
  - scripts/stop_observability.sh
  - tests/unit/test_schema.py
findings:
  critical: 1
  warning: 7
  info: 6
  total: 14
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-04-21
**Depth:** standard
**Files Reviewed:** 95
**Status:** issues_found

## Summary

Phase 3 delivered the Track B pi-session wire-through, Langfuse v3 + OTel dual-sink telemetry, per-profile auto-compaction, TUI 1 Hz footer, Alt+Up/Down feedback JSONL, OFFLINE OK badge + web_fetch allowlist, and v3 profile bump. Air-gap invariants (loopback-only OTLP, hostname-exact allowlist with documented CNAME/URL-creds/SSRF guards) are generally well-enforced and heavily tested. D-14 preservation, D-12 fail-loud, D-16 fallback, D-18 Unicode poison, and D-28 warn-and-continue all have visible, exercised surfaces.

The critical finding is a single air-gap regression: the Langfuse compose file binds `langfuse-web` to 0.0.0.0:3000 instead of loopback, contradicting the stated T-03-02-07 mitigation in the same file's docstring and the `ci_verify_phase3.py` config-check (which greps for `127.0.0.1:` presence but never asserts absence of non-loopback binds). On the DGX Spark (single-user, loopback-only thesis), this exposes the Langfuse UI + OTLP ingestion port to the host's LAN.

The remaining findings are correctness/robustness warnings: a stderr-banner race between `tokensInLine` Plan 03-02 `--no-telemetry` path and pi-emmy's non-guarded call (initOtel passes `enabled:false` but still sets `configureTelemetry({enabled:false, ...})` — this is fine in isolation but the banner text is printed twice in some paths), a `feedback.jsonl` append-path that uses non-canonical `JSON.stringify` in the >PIPE_BUF branch diverging from the atomic-append docstring contract, a `read`/`grep` argv-splitting in `native-tools.ts` that allows argument injection via the `flags` tool param, a shell-injection-adjacent behavior in the `bash` tool's `sh -c` (acknowledged YOLO but unbounded stdout capture with a 10MB cap + no stderr separation for grep's error path), a footer-poller reset-on-warmup edge case, and a few smaller issues in the scripts.

## Critical Issues

### CR-01: Langfuse web UI binds to 0.0.0.0:3000, violating T-03-02-07 loopback-only policy

**File:** `observability/langfuse/docker-compose.yaml:93-94`
**Issue:** The file docstring (lines 9-13) and `ci_verify_phase3.py:98-100` both state: _"ALL other services bind to 127.0.0.1 explicitly; no ambient listener outside the Spark"_ and the validator greps for `127.0.0.1:` to be present. However, the `langfuse-web` service publishes port 3000 on all interfaces:

```yaml
  langfuse-web:
    ...
    ports:
      - "3000:3000"          # <-- binds 0.0.0.0:3000
```

All five sibling services (`langfuse-worker`, `clickhouse`, `minio`, `redis`, `postgres`) use the explicit `127.0.0.1:N:N` form. The comment on line 10-12 acknowledges loopback-binding is the goal ("Traffic is loopback-bound because emmy-serve + pi-emmy both run on the same host") but docker-compose does NOT enforce that — a `- "3000:3000"` bind publishes the port on every host interface, including public LAN / VPN. The air-gap thesis (Pitfall #8 — "no cloud anywhere in the loop") depends on no non-loopback listener; this binding also makes the OTLP ingestion endpoint (which carries full prompt content in spans) reachable by anyone who can TCP-connect to the Spark.

The `ci_verify_phase3.py:99-100` check:
```python
if "127.0.0.1:" not in compose_txt:
    reasons.append("docker-compose.yaml has no 127.0.0.1:-bound ports (T-03-02-07)")
```
asserts *presence* of at least one 127.0.0.1 binding but never asserts *absence* of non-loopback binds. The file passes today because the other 5 services carry the 127.0.0.1 prefix; a single leaky service slips through. The 50-turn replay captures `ss -tnp` for non-loopback *outbound* connections only, not inbound listeners.

**Fix:**
```yaml
  langfuse-web:
    ...
    ports:
      - "127.0.0.1:3000:3000"
```
Plus a defense-in-depth check in `ci_verify_phase3.py`:
```python
import re
# Find every `- "PORT:PORT"` or `- "HOST:PORT:PORT"` entry and assert HOST == 127.0.0.1
port_pattern = re.compile(r'-\s*"([^"]+)"')
for m in port_pattern.finditer(compose_txt):
    spec = m.group(1)
    # Format: [HOST:]HOST_PORT:CONTAINER_PORT
    parts = spec.split(":")
    if len(parts) == 2:  # "PORT:PORT" -> binds all interfaces
        reasons.append(f"non-loopback port binding in compose: {spec!r}")
    elif len(parts) == 3 and parts[0] != "127.0.0.1":
        reasons.append(f"non-loopback host in port binding: {spec!r}")
```

## Warnings

### WR-01: `feedback.jsonl` >PIPE_BUF path uses plain `JSON.stringify`, diverges from canonical JSON contract

**File:** `packages/emmy-telemetry/src/feedback.ts:73-81`
**Issue:** `appendFeedback` delegates to `appendJsonlAtomic` (which uses `canonicalStringify` — key-sorted, Python-parity) for rows ≤ PIPE_BUF, but takes a different path for large rows:

```js
const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
const newContent = existing + serialized + "\n";   // serialized = plain JSON.stringify
```

This produces non-canonical key ordering for the big row while every sibling row is canonical. Three downstream hazards:
1. Tests like `feedback-append.test.ts` that round-trip via `JSON.parse` won't catch this, but any future consumer that hashes JSONL lines (e.g. for dedup, or for the Phase 7 publication pipeline) will see identical-content rows hash differently depending on size.
2. The large-row branch also reads the entire existing file into memory and rewrites it, which quietly turns an O(1) append into O(N) per write once any single row exceeds 4KB.
3. The docstring comment on lines 71-75 acknowledges it's "maximally simple" but the silent shape divergence violates principle of least surprise.

**Fix:** Either (a) use `canonicalStringify` on the >PIPE_BUF branch too, OR (b) drop the existing-file-rewrite and just open-append-fsync (Linux's `O_APPEND` does NOT guarantee atomicity >PIPE_BUF, but neither does the current code — the tempfile+rename is only atomic w.r.t. file REPLACEMENT, and the existing content is re-read then re-written, so another concurrent writer's new line is LOST between the read and the rename):

```js
// Option A — minimal change, preserves canonical JSON contract
import { appendJsonlAtomic } from "./atomic-append";
export function appendFeedback(path: string, row: FeedbackRow): void {
  validateRow(row);
  // appendJsonlAtomic handles PIPE_BUF dispatch internally via its callers
  // OR: add a writeJsonAtomic branch that appends instead of replaces.
  appendJsonlAtomic(path, row as unknown as Record<string, unknown>);
}
```
Note: `appendJsonlAtomic` itself doesn't split on PIPE_BUF; `emitEvent` in `src/index.ts` is the one that dispatches to `writeJsonAtomic` for large records. For feedback rows, a simpler fix is to accept that >PIPE_BUF appends may interleave (like events.jsonl does), OR implement a proper flock-guarded append. The current read-all-then-rewrite is strictly worse than either because it LOSES concurrent writes.

### WR-02: `grep` and `find` tools allow argument injection via `flags` and `name` params

**File:** `packages/emmy-tools/src/native-tools.ts:267-273, 302-313`
**Issue:** The `grep` tool splits a user-supplied `flags` string on whitespace and prepends every token as argv, with no validation:

```js
const flagsStr = String(args.flags ?? "-rn");
...
const out = execFileSync(
    "grep",
    [...flagsStr.split(/\s+/).filter(Boolean), pattern, path],
    ...
);
```

A model can pass `flags = "--include=* --exclude-dir=.git /etc/shadow"` and cause grep to read arbitrary files. Similarly, `find` accepts `name` and `type` but both feed directly into argv:
```js
if (args.name) findArgs.push("-name", String(args.name));
if (args.type) findArgs.push("-type", String(args.type));
```
`-name` is fine. But the `path` is the first positional arg with no confinement to `cwd`, so a model can `find /etc/... -name passwd`.

While CLAUDE.md states "YOLO defaults + denylist — once the model has read+write+bash, real isolation is impossible," the other native tools (`read`, `edit`, `write`) at least take a single `path` argument the model must explicitly construct, whereas `grep`/`find` give a free argv injection surface. This matters for:
- a) The offline-audit story: a malicious MCP tool can't reach the network (hostname-exact gate is solid) but CAN exfiltrate files via grep+web_fetch 2-step if the web_fetch allowlist has any upload-capable endpoint.
- b) The `bash` denylist pattern (`BASH_DEFAULT_DENY`) only matches the bash command, not flag-assembled subprocess argv. So a model that abuses `grep` to bypass `bash`'s denylist is a real regression vector — the denylist is one of two compensating controls documented in CLAUDE.md.

**Fix:** At minimum, whitelist `grep` flags to a known-safe subset and constrain `path` arguments for both tools to be inside `cwd`:

```js
const SAFE_GREP_FLAGS = new Set(["-r", "-rn", "-n", "-i", "-l", "-v", "-w", "-c", "-E", "-F"]);
const flagsArr = flagsStr.split(/\s+/).filter(Boolean);
for (const f of flagsArr) {
  if (!SAFE_GREP_FLAGS.has(f)) {
    throw new ToolsError("grep.flag_rejected", `unsafe flag: ${f}`);
  }
}
// Path confinement (simplified):
const resolved = resolve(cwd, path);
if (!resolved.startsWith(resolve(cwd) + "/") && resolved !== resolve(cwd)) {
  throw new ToolsError("grep.path_escape", `path outside cwd: ${path}`);
}
```
The YOLO-defaults-plus-denylist contract survives; this just reduces the tool-specific escape hatches a less-sophisticated attack model can exploit.

### WR-03: `buildNativeToolDefs` calls async `registerNativeTools` synchronously and returns before definitions finish collecting

**File:** `packages/emmy-tools/src/native-tools.ts:399-410`
**Issue:** `registerNativeTools` is declared `export function registerNativeTools(...): void`, not `async`, and the inner calls to `pi.registerTool(spec)` are synchronous — the function does populate `collected[]` before returning. So the sync collect-and-map pattern actually works. **However**, the resolved tools each have an async `execute` method that eventually calls `invoke()`, which emits a `tool.invoke` telemetry event. The `invoke` closure captures `profileRef` and `deny` from the registration-time scope. The problem: `deny` is built from `opts.bashDenylist ?? []` and each item is converted via `new RegExp(s)`, with no `try/catch` around the RegExp constructor. A profile (or test) that passes a malformed regex string to `bashDenylist` will throw `SyntaxError` synchronously at registration time. That's actually the right behavior, but it's undocumented and the profile schema does not gate `bashDenylist` — it's accepted as `list[str]` in `NativeToolOpts` and the error surfaces deep in the session-boot stack trace.

**Fix:** Validate regex strings at load time with a clear error:
```js
const deny: RegExp[] = [...BASH_DEFAULT_DENY];
for (const pattern of opts.bashDenylist ?? []) {
  try {
    deny.push(new RegExp(pattern));
  } catch (e) {
    throw new ToolsError(
      "bash.denylist_invalid",
      `invalid bash denylist regex ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
```

### WR-04: `metrics-poller.ts` priming tick fires concurrently with first scheduled tick; racy field state updates

**File:** `packages/emmy-ux/src/metrics-poller.ts:171-175`
**Issue:** The poller calls `setInt(tick, intervalMs)` at line 171 and THEN fires `void tick().catch(...)` for priming on line 175. If the interval is small (e.g. test-injected 1000ms, but elsewhere this same implementation is used with 10ms in tests) and `tick()` is still running when the interval fires, two ticks execute concurrently and both mutate the shared `fields.{gpu,kv,tok}` objects. Since `fields` is a plain object and JS is single-threaded, the update itself is safe, but the logical outcome is lost: `failCount` may double-increment when both ticks see a failure, or `lastValue` gets set to the newer-ticks's fetch result by the later write even when the earlier tick observed a more recent timestamp.

The `TokRateTracker.push()` + `.rate()` + `.samplesInWindow()` sequence has the same small-window issue — in the concurrent case you can push a sample, have another tick prune it (because `_windowMs` elapsed relative to the second tick's `nowMs`), then see `samplesInWindow() < 2` in the first tick and mark the field as warmup. In production at 1 Hz this is unlikely; under test (where pollers fire explicitly) it's deterministic but contrived.

**Fix:** Gate concurrent ticks with a simple in-flight guard:
```js
let tickInFlight = false;
const tick = async () => {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    // ... existing body ...
  } finally {
    tickInFlight = false;
  }
};
```

### WR-05: `start_observability.sh` awk-based secret substitution leaks secrets to process argv

**File:** `scripts/start_observability.sh:68-91`
**Issue:** Every generated secret (NEXTAUTH, SALT, ENCRYPTION, CLICKHOUSE_PW, REDIS_PW, POSTGRES_PW, MINIO_PW, three S3 keys) is passed to `awk` via `-v` variables:
```bash
awk -v nextauth="$NEXTAUTH" -v salt_val="$SALT_VAL" ... '<prog>' "$ENV_FILE" > "$TMP_FILE"
```
On Linux, `awk`'s full argv (including `-v nextauth=<64-char-base64>`) is visible in `/proc/<pid>/cmdline` for the lifetime of the awk process — for any user who can read `/proc` (or run `ps -ef`). The generated `.env` file is `chmod 600` (line 92) but the intermediate argv exposure defeats that on any multi-user host.

Even though emmy is single-user per CLAUDE.md, the Spark runs Ubuntu with default process-visibility (Linux's `hidepid` isn't set), so any user who logs in via `ssh` and runs `ps -ef | grep awk` during boot gets all 10 secrets.

**Fix:** Use `awk -v filename=... 'BEGIN{while((getline line < filename) > 0) {...}}'` pattern with the secrets in a temp file (mode 600), OR pipe the secrets via stdin:
```bash
python3 -c '
import os, sys
secrets = {
    "NEXTAUTH_SECRET": os.urandom(32).hex(),
    "SALT": os.urandom(16).hex(),
    ...
}
for line in sys.stdin:
    prefix = line.split("=", 1)[0]
    if prefix in secrets:
        sys.stdout.write(f"{prefix}={secrets[prefix]}\n")
    else:
        sys.stdout.write(line)
' < "$ENV_FILE" > "$TMP_FILE"
```
Python receives secrets only in-process; no argv exposure.

### WR-06: `profile-loader.ts` shells out to `uv run emmy profile hash` without input sanitization

**File:** `packages/emmy-ux/src/profile-loader.ts:47`
**Issue:** When `profile.yaml`'s `profile.hash` field is missing or doesn't start with `sha256:`, the loader falls back to:
```js
const out = execFileSync("uv", ["run", "emmy", "profile", "hash", profileDir], { encoding: "utf8" }).trim();
```
This uses `execFileSync` (not shell interpolation), so argv injection through `profileDir` is blocked — good. However:
1. The caller `--profile <path>` argv is `resolve()`'d but not validated to exist before reaching this call path. If a user passes `--profile /etc/passwd`, the loader tries to load YAML from `/etc/passwd/profile.yaml` (would fail on `existsSync` at line 28), but if an attacker owns a writable directory path containing a malicious `profile.yaml` and `serving.yaml`, the hasher subprocess is invoked with that path. This is NOT a vulnerability per se (emmy trusts the profile dir), but the error surface is ugly.
2. More concerning: `execFileSync` without an explicit `timeout` will block indefinitely if `uv run emmy profile hash` hangs (e.g. because `uv` is waiting on a lock). This was fixed in pi-emmy.ts's `probeVllm()` (line 112-128) with a 5s AbortController; the same pattern should be applied here.

**Fix:**
```js
const out = execFileSync("uv", ["run", "emmy", "profile", "hash", profileDir], {
  encoding: "utf8",
  timeout: 30_000, // 30s matches profile validate budget; fail loud on hang
}).trim();
```

### WR-07: `web-fetch.ts` redirect handling does not re-enforce allowlist on redirect targets

**File:** `packages/emmy-tools/src/web-fetch.ts:38-66`
**Issue:** `webFetchWithAllowlist` calls `enforceWebFetchAllowlist(url, enforcement)` once at the top, before `fetch()`. Node's `fetch` follows HTTP redirects by default (max 20), and `resp.url` reflects the final URL after redirects. This means:
1. `enforceWebFetchAllowlist("https://docs.python.org/", { allowlist: ["docs.python.org"] })` passes the pre-check.
2. If `docs.python.org` is compromised and redirects to `https://evil.example.com/exfil?data=...`, fetch follows the 302 automatically.
3. The returned `url: resp.url` field in the response is `https://evil.example.com/exfil?data=...`, but the actual network hit (and any data leak via URL params in the redirect target) has already happened.

For a pure-documentation reader, the threat is modest (outbound GET only; headers go to final host). But the allowlist's promise is "hostname-EXACT, no CNAME bypass" — an HTTP redirect is precisely a CNAME-equivalent bypass at the application layer.

**Fix:** Pass `redirect: "manual"` to fetch and enforce the allowlist on each hop:
```js
const resp = await fetch(url, {
  signal: ctl.signal,
  redirect: "manual",
  headers: { accept: "text/html, text/markdown, application/json, text/plain, */*" },
});
if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
  const nextUrl = new URL(resp.headers.get("location")!, url).toString();
  enforceWebFetchAllowlist(nextUrl, enforcement);  // re-check hostname
  // either throw or follow manually with depth limit
}
```

## Info

### IN-01: `offline-badge.ts` uses module-level mutable state with test-only reset escape hatch

**File:** `packages/emmy-ux/src/offline-badge.ts:94-139`
**Issue:** `_lastResult` and `_ctx` are module-level `let` bindings mutated by `bindBadge`, `setInitialAudit`, and `flipToViolation`. This creates cross-test pollution (addressed by `__resetBadgeStateForTests`) and means badge state is implicitly process-global — fine for single-user pi-emmy but violates single-responsibility when `createEmmySession` is called multiple times in the same process (e.g. eval corpus running 50 sessions).

**Fix:** Wrap in a factory or class so each session gets an isolated state. Since the plan targets single-session use cases, defer unless Phase 4 eval runs need concurrent sessions.

### IN-02: `ci_verify_phase3.py` `_full_run` path never actually runs the full check

**File:** `emmy_serve/airgap/ci_verify_phase3.py:122-156`
**Issue:** The `_full_run` function docstring describes 7 steps (start emmy-serve, start compose, replay, ss capture, teardown, verdict) but the actual body only runs step 1 (config-check) and step 4 binary-presence check, then prints "scaffold ready" and returns 0. The GitHub Actions workflow at `.github/workflows/airgap-phase3.yml` calls this with `--dry-run` for the Ubuntu job and without `--dry-run` for the self-hosted job — the non-dry-run CALL passes the config check and exits 0 without doing any of the actual work. The surrounding workflow steps do the actual docker compose up / replay / ss capture (workflow lines 76-88), but they use `bash scripts/airgap_phase3_replay.sh --turns 50` which itself is a stub that exits 0 after printing "OK: replay scaffold ready". So the entire "full-run" path is currently a no-op that always returns 0.

This is a documentation/naming issue, not a correctness bug — the CLOSEOUT.md acknowledges the deferral. But naming suggests more work is done than is. Consider renaming `_full_run` to `_prereq_check_full` or adding a prominent `[SKIPPED — scaffold only]` to the printed message so CI logs don't falsely imply a real air-gap gate passed.

**Fix:** Update the stderr message to be unambiguous:
```py
print(
    "ci_verify_phase3: NO-OP full-run (operator-gated, pending self-hosted "
    "runner registration per Phase 1 Plan 01-08 Task 3). Real gate runs in "
    "GitHub Actions self-hosted job; this script asserts config+prereqs only.",
    file=sys.stderr,
)
```

### IN-03: `emmy-telemetry` `coerceAttr` silently truncates complex values via JSON.stringify

**File:** `packages/emmy-telemetry/src/index.ts:108-116`
**Issue:** OTel span attributes support `string | number | boolean | array<same>`; anything else is JSON-stringified. For large nested objects this can produce 100KB+ attribute values. Langfuse's OTLP ingestion has an implicit attribute value size limit (per OTel spec, ~32KB — but enforcement varies); attributes exceeding it are either truncated silently or dropped. No warning surfaces on the pi-emmy side.

**Fix:** Add a defensive size cap:
```js
function coerceAttr(v: unknown): string | number | boolean {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  try {
    const s = JSON.stringify(v);
    const MAX = 8192; // OTel common soft cap
    return s.length > MAX ? s.slice(0, MAX) + `... [truncated ${s.length - MAX}B]` : s;
  } catch {
    return String(v);
  }
}
```

### IN-04: `session.ts` silently catches transcript I/O exceptions with `try/catch { /* ok */ }`

**File:** `packages/emmy-ux/src/session.ts:605-613`
**Issue:** Six consecutive `try { pi.on("...", appendTurn); } catch { /* ok */ }` blocks silently swallow the exception. The pattern is defensive (pi 0.68 event names might change) but the failure mode is "transcript is silently incomplete for that event type" — this is exactly the kind of silent-degradation that Phase 2 CLOSEOUT called out as a D-12 anti-pattern. At minimum log to stderr once.

**Fix:**
```js
const safeOn = (event: string) => {
  try {
    pi.on(event, appendTurn);
  } catch (e) {
    console.error(`[emmy/session] transcript: pi.on(${event}) failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};
safeOn("turn"); safeOn("turn_start"); safeOn("turn_end");
safeOn("tool_call"); safeOn("tool_result"); safeOn("message_end");
```

### IN-05: `pi-emmy.ts` probe timeout logic has dead-code path

**File:** `packages/emmy-ux/bin/pi-emmy.ts:112-128`
**Issue:**
```js
const timeout = setTimeout(() => {
  try {
    ctl.abort(new Error("timeout"));
  } catch {
    ctl.abort();
  }
}, 5000);
```
The `AbortController.abort(reason)` variant accepts an optional reason argument since Node 18 — the try/catch for the 1-arg fallback is defensive against ancient Node. All shipping Node + Bun versions Emmy supports (Node ≥20, Bun ≥1.1) implement the 1-arg form. The try/catch adds noise.

**Fix:** Drop the try/catch or add a comment explaining why the fallback exists.

### IN-06: `grammar-retry.ts` retry writes grammar as `guided_decoding.grammar` but `before-request-hook.ts` writes it as `guided_decoding.grammar_str`

**File:** `packages/emmy-provider/src/grammar-retry.ts:143-149` vs `packages/emmy-provider/src/before-request-hook.ts:84-88`
**Issue:** Two different grammar-injection sites use inconsistent key names:
- `grammar-retry.ts:147`: `guided_decoding: { grammar: grammarText }`
- `before-request-hook.ts:86`: `guided_decoding: { grammar_str: grammarText }`

The hook test (`hook.test.ts:149`) asserts `grammar_str`, the retry test path doesn't check the on-the-wire shape. vLLM's `guided_decoding` accepts either `grammar` (path/shorthand) or `grammar_str` (literal text); the docs are confusing. Today, the `before-request-hook` path is the authoritative live wire path (per `index.ts:72-75`); `callWithReactiveGrammar` is partially superseded. If both paths run simultaneously (future refactor reviving `callWithReactiveGrammar`), they'd emit conflicting keys.

**Fix:** Pick one name (vLLM 0.19 canonical is `grammar` for Lark strings per recent docs; `grammar_str` is legacy). Normalize both files, add a regression test that greps across the package for the chosen name.

---

_Reviewed: 2026-04-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
