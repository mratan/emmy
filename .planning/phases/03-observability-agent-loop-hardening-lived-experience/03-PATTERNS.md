# Phase 3: Observability + Agent-Loop Hardening + Lived-Experience — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 41 (22 new source + 6 modified + 8 test + 5 infra/scripts)
**Analogs found:** 37 / 41 (rich Phase 1 + Phase 2 analogs; 4 genuinely new — OTel SDK init, pi-extension registration, Langfuse compose, HF parquet export)

## Executive summary

Phase 3 is **mostly integration work, not greenfield.** Every new TypeScript file has a strong analog in Phase 1 (Python reference for atomic I/O + subprocess samplers + Prometheus scraping) or Phase 2 (TS reference for pi-registration + profile-ref stamping + fail-loud discipline + fsync-append). Four files are genuinely new:

1. **`packages/emmy-telemetry/src/otel-sdk.ts`** — NodeSDK + OTLPTraceExporter + SpanProcessor init (no prior OTel code anywhere in repo; RESEARCH §Ex 2 is the prescription).
2. **`packages/emmy-ux/src/pi-emmy-extension.ts`** — pi 0.68 `ExtensionFactory` registering `before_provider_request` / `input` / `setFooter` / `registerShortcut` (no prior pi-extension anywhere; RESEARCH §Pattern 4 + §Ex 1/3/4 prescribe).
3. **`observability/langfuse/docker-compose.yaml`** — Langfuse v3 stack (new infra; Phase 1's `nvcr.io/nvidia/vllm` digest-pin is the shape to steal).
4. **`packages/emmy-telemetry/src/hf-export.ts`** — HF `datasets`-loadable artifact (no prior file export; MVP uses JSONL pass-through per RESEARCH §Open Questions #3).

Three dominant patterns carry forward from Phase 1/2 and apply across most new files:

- **Pattern A — Atomic fsync-then-rename JSONL append** (`emmy_serve/diagnostics/atomic.py:append_jsonl_atomic` → `packages/emmy-ux/src/session-transcript.ts:appendSessionTurn` — TS port already exists). Applies to `events.jsonl`, `feedback.jsonl`, every compaction/rating/audit event write.
- **Pattern B — Fail-loud boot rejection** (Phase 1 D-06 → `packages/emmy-ux/src/sp-ok-canary.ts` + `packages/emmy-ux/src/session.ts` SP_OK gate). Applies to OTel SDK init failure on a fatal config error, compaction hard-ceiling `SessionTooFullError` (D-12), and `EMMY_TELEMETRY=off` boot-banner discipline.
- **Pattern C — `profile: profileRef` stamping on every emitted event** (Phase 2 `packages/emmy-tools/src/native-tools.ts:invoke` wrapper + `packages/emmy-provider/src/grammar-retry.ts` every `emitEvent` call). Applies to every Phase-3 span via `SpanProcessor.onStart` (RESEARCH §Pattern 2).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/emmy-telemetry/src/atomic-append.ts` | atomic-io utility | file-I/O, append | `emmy_serve/diagnostics/atomic.py:append_jsonl_atomic` + `packages/emmy-ux/src/session-transcript.ts:appendSessionTurn` | **exact** (TS sibling already exists) |
| `packages/emmy-telemetry/src/otel-sdk.ts` | sdk-integration | event-driven | RESEARCH §Ex 2 (NodeSDK + OTLPTraceExporter prescription) | no in-repo analog (new stack) |
| `packages/emmy-telemetry/src/span-factory.ts` (or `span-attributes.ts`) | sdk-integration | transform | `packages/emmy-provider/src/grammar-retry.ts` emitEvent pattern | role-match |
| `packages/emmy-telemetry/src/profile-stamp-processor.ts` | sdk-integration | event-driven | RESEARCH §Pattern 2 (`SpanProcessor.onStart` auto-stamp) | no in-repo analog |
| `packages/emmy-telemetry/src/index.ts` (MODIFIED — body replaced) | dual-sink emitter | event-driven, append | Existing stub signature; Pattern A + RESEARCH §Pattern 3 | **exact** (signature stable, body replaced) |
| `packages/emmy-telemetry/src/feedback.ts` | atomic-io | append | `packages/emmy-ux/src/session-transcript.ts:appendSessionTurn` (pattern verbatim) | **exact** |
| `packages/emmy-telemetry/src/export-hf.ts` | CLI subcommand | transform, file-I/O | `packages/emmy-ux/bin/pi-emmy.ts` flag dispatch + `scripts/validate_profile.py` shape | role-match |
| `packages/emmy-telemetry/src/offline-audit.ts` | config-schema validation | transform | `packages/emmy-tools/src/mcp-poison-check.ts:assertNoPoison` (per-item boolean check + named error) | role-match |
| `packages/emmy-context/src/compaction.ts` (or inside `@emmy/ux`) | extension-registration | event-driven, request-response | `packages/emmy-provider/src/grammar-retry.ts:callWithReactiveGrammar` (profile-driven retry-wrapper with emitEvent fan-out) | role-match |
| `packages/emmy-context/src/preservation.ts` | pure-function filter | transform | `packages/emmy-tools/src/mcp-poison-check.ts:assertNoPoison` (per-entry classifier) | role-match |
| `packages/emmy-ux/src/pi-emmy-extension.ts` | extension-registration | event-driven | RESEARCH §Ex 1/3/4 (pi 0.68 extension factory — no in-repo analog) | no analog (new) |
| `packages/emmy-ux/src/footer.ts` | ui-component | pub-sub (cached metrics) | RESEARCH §Ex 3 (`ctx.ui.setStatus` / `setFooter`) | no in-repo analog |
| `packages/emmy-ux/src/nvidia-smi.ts` | subprocess-wrapper | streaming, pub-sub | `emmy_serve/thermal/sampler.py:GpuSampler._sample` (Python reference) | **exact** (shape port) |
| `packages/emmy-ux/src/vllm-metrics.ts` | http-parser | request-response (HTTP GET) | `emmy_serve/thermal/sampler.py:VllmMetricsSampler` + `emmy_serve/kv_finder/metrics.py:scrape_metrics` | role-match (TS port with rate-calc twist — Pitfall #6) |
| `packages/emmy-ux/src/offline-badge.ts` | ui-component | pub-sub | `packages/emmy-tools/src/mcp-poison-check.ts` (pure classifier with named error) + RESEARCH §Ex 5 | role-match |
| `packages/emmy-ux/src/feedback-ui.ts` | ui-component | request-response | RESEARCH §Ex 4 (`ctx.ui.input` modal prompt) | no in-repo analog |
| `packages/emmy-ux/src/session.ts` (MODIFIED — W2 → real wire-through) | extension-registration | event-driven | Current file at lines 225-244 (NO-OP adapter block — flips to real) | **exact** (same file, body flipped) |
| `packages/emmy-provider/src/before-request-hook.ts` | extension-registration | request-response | `packages/emmy-provider/src/index.ts:registerEmmyProvider` (shape) + RESEARCH §Ex 1 (payload-mutation idiom) | role-match |
| `packages/emmy-provider/src/index.ts` (MODIFIED — streamSimple bind) | extension-registration | request-response | Current `registerEmmyProvider` at lines 33-66 | **exact** (same file, adapter bind target changes) |
| `profiles/qwen3.6-35b-a3b/v3/harness.yaml` | config-schema | static | `profiles/qwen3.6-35b-a3b/v2/harness.yaml` (add `context.compaction` + `tools.web_fetch.allowlist` blocks) | **exact** |
| `profiles/qwen3.6-35b-a3b/v3/PROFILE_NOTES.md` | doc | static | `profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md` (extend with v3 provenance table + validation_runs) | **exact** |
| `profiles/qwen3.6-35b-a3b/v3/prompts/compact.md` | fixture (prompt) | static | `profiles/qwen3.6-35b-a3b/v2/prompts/system.md` (one-file markdown prompt pattern) | role-match |
| `observability/langfuse/docker-compose.yaml` | docker-compose | static | `scripts/start_emmy.sh` image-digest pinning discipline (shape-only; no prior compose) | partial |
| `observability/langfuse/.env.example` | config template | static | No in-repo analog (new infra) | no analog |
| `observability/langfuse/README.md` | doc | static | `profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md` header format (optional) | partial |
| `scripts/start_observability.sh` | shell-script | subprocess | `scripts/start_emmy.sh` (fail-loud prereq-check + health-gate structure) | **exact** (shape) |
| `scripts/stop_observability.sh` | shell-script | subprocess | `scripts/start_emmy.sh` (shape of teardown section) | role-match |
| `scripts/sc1_trace_walkthrough.sh` | shell-script | subprocess | Phase 2 `/tmp/emmy-sc1-walkthrough/` fixture runner pattern | partial |
| `scripts/sc2_200turn_compaction.sh` | shell-script | subprocess | `scripts/thermal_replay.py` (long-replay driver shape) | role-match |
| `scripts/sc5_offline_badge.sh` | shell-script | subprocess | `scripts/airgap_probe.py` shape | partial |
| `scripts/phase3_close_walkthrough.sh` | shell-script | subprocess | Phase 2 closeout walkthrough runner | partial |
| `scripts/footer_parity_check.sh` | shell-script | subprocess | `emmy_serve/thermal/sampler.py` sampler-parity audit | partial |
| `.github/workflows/airgap-phase3.yml` | CI config | event-driven | Existing Phase 1/2 `airgap.yml` (extend, don't replace) | **exact** |
| `packages/emmy-telemetry/src/atomic-append.test.ts` | test | transform | `packages/emmy-ux/test/*.test.ts` pattern (bun test + mocked fs) | role-match |
| `packages/emmy-telemetry/src/otlp-exporter.test.ts` | test | integration | `packages/emmy-provider/src/grammar-retry.test.ts` (fetch-mock + emitEvent capture) | role-match |
| `packages/emmy-telemetry/src/span-attributes.test.ts` | test | unit | `packages/emmy-tools/src/mcp-poison-check.test.ts` (assert throws/classifies) | role-match |
| `packages/emmy-telemetry/src/dual-sink.test.ts` | test | integration | `packages/emmy-ux/test/session.test.ts` (stub pi runtime + assert emitted events) | role-match |
| `packages/emmy-telemetry/src/killswitch.test.ts` | test | unit | `packages/emmy-ux/test/pi-emmy-cli.test.ts` env-var short-circuit pattern (`EMMY_SKIP_PROFILE_VALIDATE`) | **exact** (shape) |
| `packages/emmy-telemetry/src/feedback-append.test.ts` | test | unit | `packages/emmy-ux/test/session-transcript.test.ts` (already exists as analog) | **exact** |
| `packages/emmy-telemetry/src/export-hf.test.ts` | test | integration | Phase 2 SC-5 runner shape (bun test + fs assertions + HF datasets subprocess) | partial |
| `packages/emmy-telemetry/src/feedback-idempotent.test.ts` | test | unit | same as feedback-append | **exact** |
| `packages/emmy-context/src/compaction-schema.test.ts` | test | unit | `packages/emmy-ux/src/profile-loader.test.ts` shape | role-match |
| `packages/emmy-context/src/preservation.test.ts` | test | unit | `packages/emmy-tools/src/mcp-poison-check.test.ts` (pure-function classifier) | role-match |
| `packages/emmy-context/src/trigger.test.ts` | test | integration | `packages/emmy-provider/src/grammar-retry.test.ts` (trigger-budget assertion) | role-match |
| `packages/emmy-context/src/hard-ceiling.test.ts` | test | unit | `packages/emmy-ux/src/sp-ok-canary.test.ts` (fail-loud error-type assertion) | role-match |
| `packages/emmy-context/src/summarize-fallback.integration.test.ts` | test | integration | `packages/emmy-provider/src/grammar-retry.test.ts` reactive-fallback shape | role-match |
| `packages/emmy-ux/src/session.boot.test.ts` | test | integration | `packages/emmy-ux/test/session.test.ts` (already exists; extend) | **exact** |
| `packages/emmy-ux/src/footer.test.ts` | test | unit | `packages/emmy-ux/test/*.test.ts` pattern + `vllm-metrics-parser.test.ts` | role-match |
| `packages/emmy-ux/src/nvidia-smi.test.ts` | test | unit | `emmy_serve/thermal/tests/test_sampler.py` (Python analog — N/A parsing fixtures) | role-match |
| `packages/emmy-ux/src/vllm-metrics-parser.test.ts` | test | unit | `emmy_serve/kv_finder/tests/test_metrics.py` (Python analog for metric-line regex) | role-match |
| `packages/emmy-ux/src/footer-degrade.test.ts` | test | unit | same as footer; focus on 3-fail-then-blank behavior | role-match |
| `packages/emmy-ux/src/keybind-capture.test.ts` | test | unit | `packages/emmy-ux/test/pi-emmy-cli.test.ts` (env-driven test-only stub) | role-match |
| `packages/emmy-ux/src/feedback-flow.integration.test.ts` | test | integration | `packages/emmy-ux/test/session.test.ts` (stub pi runtime) | role-match |
| `packages/emmy-ux/src/boot-banner.test.ts` | test | unit | `packages/emmy-ux/test/pi-emmy-cli.test.ts` (stderr assertion) | **exact** |
| `packages/emmy-ux/src/offline-audit.test.ts` | test | unit | `packages/emmy-tools/src/mcp-poison-check.test.ts` (per-case allowed/rejected table) | role-match |
| `packages/emmy-ux/src/sp-ok-canary.integration.test.ts` | test | integration | `packages/emmy-ux/test/sp-ok-canary.test.ts` (already exists; extend with post-wire-through regression) | **exact** |
| `packages/emmy-provider/src/hook.test.ts` | test | integration | `packages/emmy-provider/src/grammar-retry.test.ts` (payload-shape assertion) | role-match |
| `packages/emmy-tools/src/web-fetch-enforcement.integration.test.ts` | test | integration | `packages/emmy-tools/src/web-fetch.ts` (runtime URL allowlist check at call site) | role-match |

---

## Pattern Assignments

### Pattern A — Atomic JSONL Append (TS port — in-tree TS sibling already exists)

**Source file:** `/data/projects/emmy/packages/emmy-ux/src/session-transcript.ts` lines 47-62
**Python reference:** `/data/projects/emmy/emmy_serve/diagnostics/atomic.py` lines 62-75

**Apply to:** `packages/emmy-telemetry/src/atomic-append.ts` (verbatim port, generalized for arbitrary records); `packages/emmy-telemetry/src/feedback.ts` (identical pattern); `packages/emmy-telemetry/src/index.ts` `emitEvent` body (JSONL authoritative sink).

**Imports pattern** (session-transcript.ts lines 17-25):
```typescript
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
```

**Core atomic-append pattern** (session-transcript.ts lines 47-62):
```typescript
export function appendSessionTurn(path: string, turn: SessionTurn): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record: SessionTurn = {
    ts: turn.ts ?? new Date().toISOString(),
    ...turn,
  };
  const line = `${JSON.stringify(record)}\n`;
  const fd = openSync(path, "a");
  try {
    writeFileSync(fd, line, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
```

**Python reference for invariant cross-check** (`atomic.py` lines 62-75):
```python
def append_jsonl_atomic(path: str | Path, obj: dict) -> None:
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n"
    with open(dest, "a", encoding="utf-8") as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())
```

**What changes in the new file:**
- Generalize `SessionTurn` to `TelemetryRecord` (from the existing `emmy-telemetry/src/index.ts` stub at line 5).
- Keep the `sort_keys` / `separators=(",", ":")` determinism discipline by using `JSON.stringify(obj)` with a stable key-order helper (the Python version uses `sort_keys=True`; TS has no native equivalent, so emit a `canonicalize()` helper if canonical form matters for hashing/diff stability — NOT required for event streams, but required for `--export-hf` manifest).
- Per RESEARCH §Pattern 3: `appendFile` after `open("a")` is preferred over `writeFile(fd,...)` because it is atomic at ≤4096B on Linux.

**Risk notes (DGX Spark / Bun):**
- Bun's `fs.fsyncSync` is a synchronous wrapper around POSIX `fsync(2)`; blocks the event loop for ~1ms per line on NVMe. Acceptable for 1-event-per-turn cadence but NOT for 1-Hz footer polling — the footer writes to `events.jsonl` only on resize/visibility changes (emit sparingly, not per-sample).
- `openSync("a")` with O_APPEND guarantees atomic append for writes ≤ `PIPE_BUF` (4096B on Linux). Feedback rows with long `model_response` fields may exceed this — Assumption A4 in RESEARCH. Mitigation: for `feedback.jsonl` rows >4KB, use `atomic.py:write_bytes_atomic` shape (tempfile + fsync + rename) — `emmy_serve/diagnostics/atomic.py` lines 23-48 is the exact shape to port.

---

### Pattern B — OTel SDK Init + SpanProcessor auto-stamp

**Source:** No in-repo analog. **Prescription:** RESEARCH.md §"Code Examples — Ex 2" (lines 722-777) + RESEARCH.md §"Pattern 2: OTel Span Attributes via SpanProcessor.onStart" (lines 435-461).

**Apply to:** `packages/emmy-telemetry/src/otel-sdk.ts` (init), `packages/emmy-telemetry/src/profile-stamp-processor.ts` (SpanProcessor implementation).

**Prescription excerpt (RESEARCH lines 735-777, verbatim):**
```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ATTR_GEN_AI_SYSTEM } from "@opentelemetry/semantic-conventions/incubating";

export async function initOtel(opts: {
  langfusePublicKey: string;
  langfuseSecretKey: string;
  profile: { id: string; version: string; hash: string };
  enabled: boolean;
}): Promise<NodeSDK | null> {
  if (!opts.enabled) {
    console.log("[emmy] OBSERVABILITY: OFF (EMMY_TELEMETRY=off or --no-telemetry)");
    return null;
  }
  const auth = Buffer.from(`${opts.langfusePublicKey}:${opts.langfuseSecretKey}`).toString("base64");
  const exporter = new OTLPTraceExporter({
    url: "http://127.0.0.1:3000/api/public/otel/v1/traces",
    headers: {
      Authorization: `Basic ${auth}`,
      "x-langfuse-ingestion-version": "4",
    },
  });
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "emmy",
      [ATTR_GEN_AI_SYSTEM]: "vllm",
    }),
    spanProcessors: [
      new EmmyProfileStampProcessor(opts.profile),
      new BatchSpanProcessor(exporter),
    ],
  });
  sdk.start();
  try {
    const r = await fetch("http://127.0.0.1:3000/", { method: "HEAD" });
    console.log(`[emmy] OBSERVABILITY: ON — JSONL + Langfuse OTLP (status=${r.status})`);
  } catch {
    console.warn("[emmy] OBSERVABILITY: JSONL-only (Langfuse unreachable at localhost:3000)");
  }
  return sdk;
}
```

**SpanProcessor auto-stamp (RESEARCH lines 443-459):**
```typescript
import { SpanProcessor, ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";

class EmmyProfileStampProcessor implements SpanProcessor {
  constructor(private profile: { id: string; version: string; hash: string }) {}
  onStart(span: Span): void {
    span.setAttributes({
      "emmy.profile.id": this.profile.id,
      "emmy.profile.version": this.profile.version,
      "emmy.profile.hash": this.profile.hash,
    });
  }
  onEnd(_span: ReadableSpan): void {}
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}
```

**What changes vs. the prescription:**
- `profile` parameter comes from `ProfileSnapshot.ref` (Phase 2 shape at `packages/emmy-provider/src/types.ts` lines 14-19) — already has `{id, version, hash}`; wire verbatim.
- Boot-banner text should match Phase 2's stderr banner format (lines 196-198 of `packages/emmy-ux/bin/pi-emmy.ts`): `pi-emmy starting (profile=...@..., base_url=...)`. Extend with `telemetry=JSONL+Langfuse` or `telemetry=JSONL-only` or `telemetry=OFF` suffix.
- `enabled` arg comes from `!process.env.EMMY_TELEMETRY || process.env.EMMY_TELEMETRY !== "off"` + `--no-telemetry` CLI flag (D-08). Mirror the `EMMY_SKIP_PROFILE_VALIDATE` env-var short-circuit pattern at `packages/emmy-ux/bin/pi-emmy.ts` lines 163-185.

**Risk notes:**
- **OTel init order (RESEARCH Pitfall #2).** Bun's ESM hoisting can load `@emmy/provider` (which emits spans) before `otel-sdk.ts` runs. Fix: make `initOtel()` the FIRST `await` in `pi-emmy.ts main()` — before `loadProfile()`, before `createEmmySession()`. Add an "is-sdk-initialized" sentinel in `emitEvent` that skips OTLP emit (but still writes JSONL) until init completes.
- **SP_OK canary exemption (RESEARCH Pitfall #7).** The canary MUST run on its own raw `postChat` path (Phase 2 `sp-ok-canary.ts` line 28), NOT through pi's streamSimple — the `before_provider_request` hook would otherwise inject `enable_thinking:false` on the canary and interact with chat-template handling. Preserve Phase 2's non-pi-routed canary call at `session.ts` line 255.

---

### Pattern C — Dual-Sink `emitEvent` (JSONL authoritative + OTLP best-effort)

**Source:** RESEARCH.md §"Pattern 3: Dual-Sink Atomic Emit" (lines 463-505) + Phase 2 `packages/emmy-telemetry/src/index.ts` (signature stable) + Phase 2 `packages/emmy-provider/src/grammar-retry.ts` lines 64-72, 78-86, 120-127, 130-137 (every call site stamping `profile: profileRef`).

**Apply to:** `packages/emmy-telemetry/src/index.ts` (replace the NO-OP body at lines 12-16 with the dual-sink implementation).

**Existing signature (DO NOT CHANGE) — `packages/emmy-telemetry/src/index.ts` lines 5-16:**
```typescript
export interface TelemetryRecord {
  event: string;
  ts: string;
  profile?: { id: string; version: string; hash: string };
  [k: string]: unknown;
}

export function emitEvent(record: TelemetryRecord): void {
  // Wave 0: no-op. Phase 3 replaces body with atomic JSONL append
  // mirroring emmy_serve/diagnostics/atomic.py:append_jsonl_atomic.
  void record;
}
```

**Replacement body pattern (RESEARCH §Pattern 3):**
```typescript
export function emitEvent(record: TelemetryRecord, ctx?: { tracer?: Tracer; jsonlPath?: string }): void {
  // 1. JSONL authoritative (D-06)
  if (ctx?.jsonlPath) {
    appendJsonlAtomic(ctx.jsonlPath, record).catch(err =>
      console.error(`[emmy/telemetry] JSONL append failed — data lost: ${err}`),
    );
  }
  // 2. OTLP best-effort (D-06)
  if (ctx?.tracer) {
    const span = ctx.tracer.startSpan(record.event);
    for (const [k, v] of Object.entries(record)) {
      if (k !== "event" && k !== "ts") span.setAttribute(k, v as string);
    }
    span.end();
  }
}
```

**Existing call-site evidence (grep `emitEvent(` in repo) — these sites are already stamping `profile: profileRef`:**
- `packages/emmy-provider/src/grammar-retry.ts:65-72` — `grammar.retry` trigger
- `packages/emmy-provider/src/grammar-retry.ts:78-85` — `grammar.retry.exhausted`
- `packages/emmy-provider/src/grammar-retry.ts:120-127, 130-137` — retry.exhausted + retry.success
- `packages/emmy-tools/src/native-tools.ts:72-91` — `tool.invoke` (outcome + latency_ms + error)
- `packages/emmy-tools/src/mcp-bridge.ts:91-97, 116-122` — `mcp.tool.rejected`, `mcp.tool.registered`
- `packages/emmy-ux/src/session.ts:257-261, 384-395` — `session.sp_ok.pass`, `session.tools.registered`, `session.transcript.open`
- `packages/emmy-ux/src/prompt-assembly.ts` — `prompt.assembled` (called from assemblePrompt)

**What changes:**
- Body flips from NO-OP to dual-sink; **signature and call sites stay exactly as they are** (this is the dividend of Phase 2 D-01's stub-first discipline).
- Add global state: JSONL path resolved at `initOtel()` via `runs/<session_id>/events.jsonl` — pass via module-level singleton or initialization context (pattern: `let _ctx: Context | null = null; export function configure(ctx) {...}`; call sites stay `emitEvent(record)`).
- Add per-record span-name mapping: events whose `event` field starts with `session.` / `tool.` / `grammar.` / `compaction.` / `feedback.` each map to a semconv span name (`gen_ai.execute_tool`, custom `emmy.*` for the rest) — extract to a small `spanNameFor(event)` helper.

**Risk notes:**
- Pitfall #5 (RESEARCH): silent OTLP failure masks telemetry loss. Mitigation: print boot banner with telemetry mode (JSONL+Langfuse vs JSONL-only vs OFF); see Pattern B.
- Grammar-retry's `emitEvent` calls pass `turn_id` as a conditional spread (grammar-retry.ts lines 71, 84, 126, 136). Phase 3 should preserve this shape — don't break existing call sites.

---

### Pattern D — Pi 0.68 Extension Registration (provider + tools + MCP wire-through)

**Source:** `packages/emmy-ux/src/session.ts:buildRealPiRuntime` lines 102-244 (existing W2 adapter — flips from NO-OP at lines 225-236 to real in Phase 3) + RESEARCH §Ex 1 (before_provider_request hook) + RESEARCH §Ex 3 (setStatus/setFooter) + RESEARCH §Ex 4 (input event handler).

**Apply to:**
- `packages/emmy-ux/src/session.ts` — MODIFY `buildRealPiRuntime` to (a) pass `customTools: [...emmyTools, ...mcpTools]` to `createAgentSessionFromServices` (currently passes `customTools: []` at line 156), (b) remove the `<think>` strip at lines 195-208 (a17f4a9 stopgap), (c) install the `before_provider_request` extension-factory.
- `packages/emmy-ux/src/pi-emmy-extension.ts` — NEW — pi `ExtensionFactory` registering the hooks.
- `packages/emmy-provider/src/before-request-hook.ts` — NEW — the injected handler body.

**Current NO-OP wire-through site (session.ts lines 225-236):**
```typescript
const adapter: PiRuntime = {
  registerProvider: (_name: string, _impl: unknown) => {
    // Phase 2 surface: emmy-provider's reactive grammar retry library is
    // available; pi's built-in openai-completions stream is the wire path
    // for SC-1. Binding the reactive retry through pi's BeforeProviderRequestEvent
    // is Phase 3 extension-runner work.
  },
  registerTool: (_spec: unknown) => {
    // Phase 2 surface: emmy-tools native + hash-anchored-edit + MCP libraries
    // are available; pi's built-in tools drive SC-1. Swapping in emmy's
    // hash-anchored edit via customTools is a Phase 3 extension-runner binding.
  },
  // ...
};
```

**Current `<think>` stopgap to remove (session.ts lines 195-208):**
```typescript
// Strip Qwen3.6 <think>...</think> blocks. pi-ai's built-in
// openai-completions stream only sends enable_thinking:false
// when model.reasoning is true AND thinkingLevel maps to a
// falsy reasoningEffort, which pi's default thinkingLevel
// ("medium") does not produce. Wiring @emmy/provider (which
// correctly sets chat_template_kwargs.enable_thinking:false
// at the request level) through pi's streamSimple hook is
// a Phase 3 extension-runner binding. Strip-at-render is
// the Phase-2 stopgap for clean --print output.
text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
```

**Replacement — before_provider_request hook (RESEARCH §Ex 1, lines 680-719):**
```typescript
pi.on("before_provider_request", (event, ctx) => {
  const p = event.payload as {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    extra_body?: Record<string, unknown>;
    chat_template_kwargs?: Record<string, unknown>;
  };
  // (a) D-02a: enable_thinking:false at request level (removes a17f4a9)
  p.chat_template_kwargs = {
    ...(p.chat_template_kwargs ?? {}),
    enable_thinking: false,
  };
  // (b) D-02b: reactive grammar injection (from @emmy/provider's retry state)
  if (ctx.signal && getRetryState(ctx.signal)?.wantsGrammar) {
    p.extra_body = {
      ...(p.extra_body ?? {}),
      guided_decoding: { grammar_str: profile.grammar.toolCallLark },
    };
  }
  // (c) D-02c: overwrite system message with emmy's 3-layer assembled prompt
  const assembled = getAssembledPrompt(profile, ctx.cwd);
  const idx = p.messages.findIndex(m => m.role === "system");
  if (idx >= 0) {
    p.messages[idx] = { role: "system", content: assembled.text };
  } else {
    p.messages.unshift({ role: "system", content: assembled.text });
  }
  // Stamp prompt SHA on current span
  const span = trace.getActiveSpan();
  if (span) span.setAttribute("emmy.prompt.sha256", assembled.sha256);
});
```

**customTools wire-through (session.ts line 156 — flip):**
```typescript
// BEFORE (current):
customTools: [],

// AFTER (Phase 3):
customTools: [
  ...emmyNativeToolDefs(emmyToolsContext),        // read/write/edit/bash/grep/find/ls/web_fetch (packages/emmy-tools:NATIVE_TOOL_NAMES shape)
  ...emmyMcpToolDefs(mcpBridgeContext),           // MCP-discovered tools (packages/emmy-tools/src/mcp-bridge.ts:registerMcpServers returns)
],
```

**What changes:**
- `registerEmmyProvider` call site at `session.ts:321-330` stops being a NO-OP wrapper (the adapter's `registerProvider` impl flips from comment-only to actually delegating). Keep the call-shape; change the adapter body.
- `registerNativeTools` at `session.ts:332-335` flips from NO-OP collector to real `customTools` producer (emit ToolDefinition array, pass via the `createAgentSessionFromServices` call).
- `registerMcpServers` at `session.ts:340-350` flips the same way. Poison-gate behavior (Phase 2 `mcp-bridge.ts` line 89) is preserved verbatim.
- Remove `.replace(/<think>[\s\S]*?<\/think>\s*/g, "")` at line 207 in a dedicated commit citing `a17f4a9` + `02-CLOSEOUT.md § SC-1 findings`.

**Risk notes:**
- **Pitfall #7 — SP_OK canary regression** (RESEARCH). Keep `runSpOk` at `session.ts:255` BEFORE `buildRealPiRuntime` runs; the canary must never route through the pi-session's `before_provider_request` hook. Belt-and-suspenders: add `payload.emmy.is_sp_ok_canary === true` check in the hook that exempts the canary.
- **Pitfall #3 — compaction mid-stream**: only call `shouldCompact()` in `turn_start` handler, never in `message_update`. Guard in `pi-emmy-extension.ts` with a `eventType === "turn_start"` check.

---

### Pattern E — Compaction Trigger Wrapping Pi's Engine

**Source:** RESEARCH §"Pattern 1: Re-use pi's Compaction Engine + Layered Preservation" (lines 355-432); `packages/emmy-provider/src/grammar-retry.ts:callWithReactiveGrammar` as the shape-analog (conditional-wrapper + emitEvent fan-out + fallback path).

**Apply to:** `packages/emmy-context/src/compaction.ts` (OR in `packages/emmy-ux/src/` — planner's call per D-01 atomic-wave scoping).

**Shape analog — `grammar-retry.ts:callWithReactiveGrammar` (lines 48-139, condensed):**
```typescript
export async function callWithReactiveGrammar(
  baseUrl: string,
  req: ChatRequest,
  profile: ProfileSnapshot,
  opts: { turnId?: string } = {},
): Promise<{ response: ChatResponse; retried: boolean; reason?: string }> {
  // 1. First attempt — unconstrained
  const firstResp = await postChat(baseUrl, req);
  const parseFailure = firstBadArgument(firstResp.choices[0]?.message?.tool_calls ?? []);
  if (!parseFailure) return { response: firstResp, retried: false };

  // 2. Emit trigger event with profile stamp
  emitEvent({
    event: "grammar.retry",
    ts: new Date().toISOString(),
    profile: profile.ref,
    reason: "parse_failure",
    attempt: 1,
    ...(opts.turnId !== undefined ? { turn_id: opts.turnId } : {}),
  });

  // 3. Disabled / missing → fail-loud ProviderError
  const grammarConfig = profile.harness.tools.grammar;
  if (grammarConfig === null || grammarConfig.mode === "disabled") {
    emitEvent({ event: "grammar.retry.exhausted", ... });
    throw new ProviderError("grammar.retry", "...");
  }

  // 4. Retry with config-loaded resource
  const grammarText = readFileSync(join(profile.ref.path, grammarConfig.path), "utf8");
  const retryResp = await postChat(baseUrl, { ...req, extra_body: { ...req.extra_body, guided_decoding: { grammar: grammarText } } });

  // 5. Emit success/exhausted event (same profile-stamp shape)
  emitEvent({ event: "grammar.retry.success", ... });
  return { response: retryResp, retried: true, reason: "parse_failure" };
}
```

**Compaction analog prescription (RESEARCH §Pattern 1):**
```typescript
import {
  DEFAULT_COMPACTION_SETTINGS,
  shouldCompact,
  prepareCompaction,
  compact,
  type CompactionSettings,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";

function emmyCompactionTrigger(
  entries: SessionEntry[],
  contextTokens: number,
  contextWindow: number,
  profileCompaction: EmmyCompactionConfig,
): Promise<void> | null {
  const softThreshold = profileCompaction.soft_threshold_pct;
  if (contextTokens / contextWindow < softThreshold) return null;

  // D-14 preservation as pre-filter
  const preserved = markPreserved(entries, {
    structuralCore: true,
    errorPayloadsVerbatim: true,
    activeGoal: true,
    recentTurns: profileCompaction.preserve_recent_turns,
    filePins: true,
    todoState: true,
  });

  const summarizable = entries.filter(e => !preserved.has(e.uuid));
  const prep = prepareCompaction(summarizable, DEFAULT_COMPACTION_SETTINGS);
  if (!prep) return null;

  const customInstructions = readFileSync(
    join(profileRef.path, profileCompaction.summarization_prompt_path),
    "utf8",
  );

  ctx.ui.setStatus("emmy.compacting", `compacting ${prep.messagesToSummarize.length} turns…`);

  return compact(prep, model, apiKey, undefined, customInstructions)
    .then(result => {
      ctx.ui.setStatus("emmy.compacting", undefined);
      emitEvent({
        event: "session.compaction.complete",
        ts: new Date().toISOString(),
        profile: profileRef,
        turns_elided: prep.messagesToSummarize.length,
        turns_preserved: preserved.size,
      });
    })
    .catch(err => {
      // D-16 fallback
      emitEvent({ event: "session.compaction.fallback", ts: ..., error: String(err) });
      structuredPruneFallback(entries, preserved);
    });
}
```

**What to copy from `grammar-retry.ts`:**
- **Profile config loading idiom** (line 76-94): read `profile.harness.tools.grammar` into a local variable; fail-loud with a dotted-path ProviderError if `null` or `mode === "disabled"`. For compaction: read `profile.harness.context.compaction` the same way; throw `SessionTooFullError` (D-12) if post-compaction tokens still exceed `max_input_tokens`.
- **emitEvent profile-stamp shape** (lines 64-72): every event gets `profile: profile.ref` + optional `turn_id` via conditional spread.
- **Conditional file-resource loading** (lines 96-107): `readFileSync(join(profile.ref.path, config.path), "utf8")` with `ProviderError` named-error on FS failure.

**What changes for compaction:**
- Trigger is based on token-count vs. `max_input_tokens`, not on parse-failure.
- Resource loaded from profile path is the compaction prompt (`prompts/compact.md`), not a grammar.
- Emits 3 events: `compaction.trigger`, `compaction.complete`, `compaction.fallback` (per D-16).
- Integrates pi's pure-function exports (`shouldCompact`, `prepareCompaction`, `compact`, `DEFAULT_COMPACTION_SETTINGS`) — these are the Don't-Hand-Roll entries per RESEARCH §"Don't Hand-Roll".

**Preservation filter** (`packages/emmy-context/src/preservation.ts`) shape is a direct analog of `packages/emmy-tools/src/mcp-poison-check.ts:assertNoPoison` — a pure classifier over an input set, with named-error if any entry violates. For compaction, it returns a `Set<uuid>` of preserved entries instead of throwing.

**Risk notes:**
- **Pitfall #4 (RESEARCH) — tool-result truncation dropping stacktrace.** Preservation pre-filter pins `tool_result.isError === true` entries into the preserved set BEFORE pi's `serializeConversation` runs. SC-2 fixture must include a 50KB error stacktrace at index 30 of a 60-turn session.
- **Pitfall #3 — mid-stream compaction.** Only trigger in `turn_start` handler. Guarded at the extension registration site, not inside `emmyCompactionTrigger`.

---

### Pattern F — nvidia-smi Subprocess Wrapper (TS port of Python GpuSampler)

**Source:** `/data/projects/emmy/emmy_serve/thermal/sampler.py:GpuSampler._sample` lines 105-155, with the N/A-per-field parsing fix (Plan 01-07 commit `b510d1b`, lines 39-56).

**Apply to:** `packages/emmy-ux/src/nvidia-smi.ts`.

**Python reference (sampler.py lines 124-155):**
```python
try:
    out = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-gpu=timestamp,utilization.gpu,"
            "clocks.current.graphics,temperature.gpu,memory.used",
            "--format=csv,noheader,nounits",
        ],
        timeout=5,
        text=True,
        stderr=subprocess.DEVNULL,
    )
except Exception:
    return None
lines = [line.strip() for line in out.strip().splitlines() if line.strip()]
if not lines:
    return None
parts = [p.strip() for p in lines[0].split(",")]
if len(parts) < 5:
    return None
ts, util, clock, temp, mem = parts
sample: dict = {"ts": ts}
for key, raw in (
    ("gpu_util_pct", util),
    ("gpu_clock_mhz", clock),
    ("gpu_temp_c", temp),
    ("memory_used_mb", mem),
):
    value = _parse_float_or_none(raw)
    if value is not None:
        sample[key] = value
return sample
```

**N/A-tolerant parser (sampler.py lines 39-56):**
```python
_NA_SENTINELS = frozenset({"[n/a]", "n/a", "", "nan"})

def _parse_float_or_none(raw: str) -> float | None:
    s = (raw or "").strip()
    if s.casefold() in _NA_SENTINELS:
        return None
    try:
        return float(s)
    except ValueError:
        return None
```

**What changes for TS port:**
- `child_process.spawnSync("nvidia-smi", [...args], { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })` (Phase 2 already uses `spawnSync` pattern — `packages/emmy-tools/src/native-tools.ts` lines 233-238 is the bash-tool analog).
- Return shape: `{ ts: string, gpu_util_pct?: number, gpu_clock_mhz?: number, gpu_temp_c?: number, memory_used_mb?: number }` — any field may be missing on DGX Spark UMA (memory.used returns `[N/A]`).
- Caller (footer poller) tolerates missing `memory_used_mb` — already the Plan 01-07 behavior in Python.
- Test fixture: reuse the 7-case DGX Spark UMA row shape from `emmy_serve/thermal/tests/test_sampler.py` (copy the rows, port the assertions).

**Risk notes:**
- **DGX Spark UMA returns `[N/A]` for `memory.used`.** The Plan 01-07 Python fix (lines 39-56 in sampler.py) is the shape to replicate — per-field parse, drop to `None`, don't reject the whole row.
- Subprocess 5s timeout is conservative for a 1-Hz poll; nvidia-smi typically returns in <50ms. Keep timeout at 5s for defensive coverage of rare slow samples.
- **Footer degrade on 3 consecutive failures** (D-24): track `_failCount: number` in module state; reset on success, blank the field when `_failCount >= 3`.

---

### Pattern G — vLLM /metrics HTTP GET + Prometheus-text Parser

**Source:** `emmy_serve/thermal/sampler.py:VllmMetricsSampler.run` lines 190-206 + `emmy_serve/kv_finder/metrics.py:scrape_metrics` (referenced but not read — same shape).

**Apply to:** `packages/emmy-ux/src/vllm-metrics.ts`.

**Python reference (sampler.py lines 190-205):**
```python
def run(self) -> None:
    while not self.stop_evt.is_set():
        row: dict = {}
        try:
            row = dict(scrape_metrics(self.base_url))
        except Exception:
            self.stop_evt.wait(self.interval_s)
            continue
        row["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        row["t_elapsed"] = round(time.monotonic() - self.t_start, 3)
        try:
            append_jsonl_atomic(self.jsonl_path, row)
        except OSError:
            pass
        self.stop_evt.wait(self.interval_s)
```

**Metric-name reference (RESEARCH §Summary #3, verified):**
- `vllm:gpu_cache_usage_perc` — Gauge 0–1 (KV utilization; **NOT** `kv_cache_usage_perc` — CONTEXT D-22 typo)
- `vllm:num_requests_running` — Gauge
- `vllm:generation_tokens_total` — Counter (compute rate client-side)
- `vllm:spec_decode_draft_acceptance_length` — absent until Phase 6 spec-decode is enabled

**Simple Prometheus-text parser (Don't-Hand-Roll note: 30-line parser sufficient):**
```typescript
// Pattern: metric_name{labels} value  OR  metric_name value
const METRIC_LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(.+?)\s*$/;

export async function fetchVllmMetrics(baseUrl: string, timeoutMs = 2000): Promise<Record<string, number>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/metrics`, { signal: ctl.signal });
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    const text = await resp.text();
    const out: Record<string, number> = {};
    for (const line of text.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      const m = METRIC_LINE.exec(line);
      if (m && m[1] && m[2]) {
        const v = parseFloat(m[2]);
        if (!Number.isNaN(v)) out[m[1]] = v;
      }
    }
    return out;
  } finally { clearTimeout(t); }
}
```

**Rate-from-counter pattern (RESEARCH §Ex 3 lines 809-818 + Pitfall #6):**
```typescript
// 5s sliding window — smooths bursty decode rate
let _samples: Array<{ ts: number; tokens: number }> = [];
function computeTokRate(current?: number): number {
  const now = Date.now();
  if (current === undefined) return 0;
  _samples.push({ ts: now, tokens: current });
  _samples = _samples.filter(s => now - s.ts < 5000);
  if (_samples.length < 2) return 0;
  const first = _samples[0]; const last = _samples[_samples.length - 1];
  return (last.tokens - first.tokens) / ((last.ts - first.ts) / 1000);
}
```

**Risk notes:**
- vLLM 0.19 metric names may drift on NGC container updates. Verify by `curl localhost:8002/metrics | grep -E "vllm:(gpu_cache|generation)"` once at Plan execution time.
- vLLM `/metrics` can return 500 under load or during model swap. Caller applies D-24 graceful-degrade (same `_failCount` pattern as nvidia-smi).

---

### Pattern H — Offline-OK Audit (pure classifier with named violation)

**Source:** `packages/emmy-tools/src/mcp-poison-check.ts:assertNoPoison` lines 46-81 (pure per-item classifier with early return on first violation) + RESEARCH §Ex 5 (lines 856-885) as prescriptive.

**Apply to:** `packages/emmy-ux/src/offline-badge.ts`.

**Analog — poison-check classifier (mcp-poison-check.ts lines 46-81):**
```typescript
export function assertNoPoison(text: string, field: "name" | "description"): void {
  // Step 1: surrogate scan
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { /* ... */ }
  }
  // Step 2/3: scalar-value scan
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    for (const r of BIDI_RANGES) {
      if (cp >= r.lo && cp <= r.hi) {
        throw new PoisonError(cp, r.name, field);
      }
    }
    // ...
  }
}
```

**Replacement — offline-audit (RESEARCH §Ex 5 lines 859-878):**
```typescript
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "loopback", "0.0.0.0"]);

export interface OfflineAuditResult {
  offline_ok: boolean;
  violating_tool: string | null;
  violating_host: string | null;
}

export function auditToolRegistry(
  tools: Array<{ name: string; required_hosts: string[] }>,
  webFetchAllowlist: string[],
): OfflineAuditResult {
  const permitted = new Set([...LOOPBACK_HOSTS, ...webFetchAllowlist]);
  for (const t of tools) {
    for (const h of t.required_hosts) {
      if (!permitted.has(h)) return { offline_ok: false, violating_tool: t.name, violating_host: h };
    }
  }
  return { offline_ok: true, violating_tool: null, violating_host: null };
}

export function auditWebFetchUrl(url: string, allowlist: string[]): boolean {
  const hostname = new URL(url).hostname;
  const permitted = new Set([...LOOPBACK_HOSTS, ...allowlist]);
  return permitted.has(hostname);
}
```

**What changes:**
- Classification returns a result object (not a throw) because the badge UX is "warn and continue" (D-28), not "fail-loud abort" like poison.
- Runtime enforcement (`auditWebFetchUrl`) wraps `packages/emmy-tools/src/web-fetch.ts:webFetch` — intercept at line 33 BEFORE the `fetch()` call; if not in allowlist, emit `session.offline_ok.violation` event + flip badge, but still allow the fetch (D-28 warn-and-continue).
- Each tool must declare `required_hosts` at registration — extend `packages/emmy-tools/src/types.ts:PiToolSpec` (or `NativeToolOpts`) with an optional `required_hosts: string[]` field. web_fetch's is `[]` (any URL); native file-I/O tools are `[]` (loopback-always); MCP tools depend on server.

**Risk notes:**
- `packages/emmy-tools/src/web-fetch.ts:NETWORK_REQUIRED_TAG` (line 20) already exists as a marker — the audit consumes this for tool-level classification.
- Allowlist matching is exact-hostname, NOT glob — `docs.python.org` does NOT match `python.org`. Explicit per-host allowlisting is the contract (matches Phase 1 D-12 air-gap discipline).

---

### Pattern I — Profile Config Extension (v2 → v3 coordinated bump)

**Source:** `profiles/qwen3.6-35b-a3b/v2/harness.yaml` (the baseline) + `profiles/qwen3.6-35b-a3b/v2/PROFILE_NOTES.md` (provenance pattern, especially the Phase 2 harness-fill table at lines 194-213) + Phase 1 D-02 content-hash contract.

**Apply to:** `profiles/qwen3.6-35b-a3b/v3/harness.yaml`, `profiles/qwen3.6-35b-a3b/v3/PROFILE_NOTES.md`, `profiles/qwen3.6-35b-a3b/v3/prompts/compact.md`.

**Existing harness.yaml structure (v2 lines 15-19 — the context block being extended):**
```yaml
context:
  max_input_tokens: 114688                       # = max_model_len(131072) - output_reserve(16384)
  include_repo_map: false                        # Phase 3 (Aider-style ranked symbol map)
  repo_map_max_tokens: 0                         # Phase 3
  default_pruning: head_tail                     # Phase 2 default; compaction policy finalized in Phase 3
```

**Additions for v3 (from D-15 verbatim):**
```yaml
context:
  max_input_tokens: 114688
  include_repo_map: false
  repo_map_max_tokens: 0
  default_pruning: head_tail
  compaction:                                    # NEW (Phase 3 D-11..D-17)
    soft_threshold_pct: 0.75                     # D-11 trigger at 0.75 × max_input_tokens (~86K)
    preserve_recent_turns: 5                     # D-14 recent-window preservation
    summarization_prompt_path: prompts/compact.md # D-13 profile-defined summarization prompt
    preserve_tool_results: error_only            # D-14/D-15 {error_only, none, all}

tools:
  format: openai
  schemas: tool_schemas/
  grammar:
    path: grammars/tool_call.lark
    mode: reactive
  web_fetch:                                     # NEW (Phase 3 D-26)
    allowlist: []                                # Empty list = green-loopback-only
  per_tool_sampling: ...                         # unchanged
```

**PROFILE_NOTES.md extension pattern (v2 lines 194-213, table format to replicate):**
```markdown
| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `context.compaction.soft_threshold_pct` | 0.75 | CONTEXT D-11 + RESEARCH §Auto-Compaction (Claude Code/Cursor default 0.7-0.85 range) | 2026-04-21 |
| `context.compaction.preserve_recent_turns` | 5 | CONTEXT D-14 default; profile-overridable | 2026-04-21 |
| `context.compaction.summarization_prompt_path` | `prompts/compact.md` | CONTEXT D-13 profile-defined compaction prompt | 2026-04-21 |
| `context.compaction.preserve_tool_results` | `error_only` | CONTEXT D-14/D-15 (Pitfall #15 guard — error payloads verbatim) | 2026-04-21 |
| `tools.web_fetch.allowlist` | `[]` | CONTEXT D-26 empty default → badge is GREEN unless web_fetch fires on a non-loopback host | 2026-04-21 |
```

**prompts/compact.md shape:** same markdown single-file format as `prompts/system.md`. Add to the frontmatter-less top-of-file a brief instruction template citing pi's `SUMMARIZATION_SYSTEM_PROMPT` (exported by pi 0.68 per RESEARCH §Anti-Patterns) — emmy overrides with profile-specific wording emphasizing D-14 preservation categories.

**What changes (v2 → v3 bump):**
- Copy `profiles/qwen3.6-35b-a3b/v2/` → `profiles/qwen3.6-35b-a3b/v3/`.
- Add `context.compaction` block + `tools.web_fetch.allowlist` field to `harness.yaml`.
- Add `prompts/compact.md` file.
- Update `PROFILE_NOTES.md` `validation_runs` frontmatter with Phase 3 SC-1/2/5 run IDs post-evidence-capture.
- **CRITICAL**: update `profile.yaml.profile.version` from `v2` → `v3` AND recompute `profile.yaml.profile.hash` via `uv run emmy profile hash profiles/qwen3.6-35b-a3b/v3/` (Phase 1 D-02 contract — any field change bumps hash).
- `pi-emmy.ts:defaultProfilePath()` at line 45 updates `"profiles/qwen3.6-35b-a3b/v2"` → `"v3"`.

**Risk notes:**
- v2 must remain byte-identical and passing validation (`uv run emmy profile validate profiles/qwen3.6-35b-a3b/v2/` exit 0). Phase-2-SC-1-green is frozen at v2 hash `sha256:24be3eea...85d8b` and that immutability is a load-bearing part of the repro story.
- Phase 1 schema (`emmy_serve/profile/schema.py`) may need a patch for the new `context.compaction` and `tools.web_fetch.allowlist` shapes — replicate Plan 02-07's `feat(phase-01-schema-patch)` commit (closeout reference SHA `88e48a4`).

---

### Pattern J — Fail-Loud Pre-flight Shell Orchestration

**Source:** `scripts/start_emmy.sh` lines 46-72 (prereq gates + exit-code discipline) + `packages/emmy-ux/bin/pi-emmy.ts` lines 139-185 (fail-loud pre-flight with exit codes 0/1/4).

**Apply to:** `scripts/start_observability.sh`, `scripts/stop_observability.sh`, `scripts/sc1_trace_walkthrough.sh`, `scripts/sc2_200turn_compaction.sh`, `scripts/sc5_offline_badge.sh`, `scripts/phase3_close_walkthrough.sh`, `scripts/footer_parity_check.sh`.

**Shape to copy (start_emmy.sh lines 20-44):**
```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ... arg parsing ...

RUN_ID="$(date -u +'%Y%m%dT%H%M%SZ')-$(head -c 6 /dev/urandom | xxd -p | head -c 6)"
RUN_DIR="runs/${RUN_ID}-boot"
mkdir -p "$RUN_DIR"

echo "emmy: starting ..." >&2

# --- 1. Pre-flight (exit 4 on any missing prereq) ---
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR (prereq): docker not installed" >&2; exit 4
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR (prereq): cannot connect to Docker daemon" >&2; exit 4
fi
```

**What changes per script:**
- `start_observability.sh`: additional prereq `docker compose version`; health-gate on `docker compose ps --filter health=healthy` for all 6 Langfuse services (langfuse-web, langfuse-worker, postgres, redis, clickhouse, minio); initial first-run generates `observability/langfuse/.env` from `.env.example` with secure-random defaults for all CHANGEME fields.
- `stop_observability.sh`: one-liner `docker compose down` + optional `-v` flag to wipe volumes. No prereq gates (teardown always attempts, idempotent).
- SC walkthrough scripts: invoke `start_emmy.sh && start_observability.sh`; `pi-emmy -p "..."` with a known fixture prompt; `curl langfuse/api/public/traces` to verify span count; exit 0/1 on assertions.

**Risk notes:**
- Keep these scripts side-effect-free beyond docker/file operations. No config writes to the repo outside `observability/langfuse/.env` (gitignored).
- Air-gap compatibility (Pitfall #8): `start_observability.sh` pre-pulls digest-pinned images BEFORE invoking `docker compose up -d` so the compose itself never needs registry access at runtime.

---

### Pattern K — CI Workflow Extension

**Source:** Existing `.github/workflows/airgap.yml` (Phase 1 + Phase 2 extension pattern — not read directly in this pass but shape noted in Phase 2 CLOSEOUT as active).

**Apply to:** `.github/workflows/airgap-phase3.yml` OR extend existing `airgap.yml` with a Phase-3 job.

**What to extend:**
- Add a job that runs `start_observability.sh` BEFORE the 50-turn replay.
- Assert zero non-loopback ESTAB packets from the Langfuse compose stack during replay (`ss -tnlp | grep -v 127.0.0.1 | grep -v ::1 | wc -l` == 0).
- Verify OTLP ingestion by querying `http://localhost:3000/api/public/traces` — span count > 0 with expected `emmy.profile.{id,version,hash}` attributes.
- Separate air-gap-observability job (D-09): verify the Langfuse stack itself has zero outbound packets.

**Risk notes:**
- Langfuse's Docker images may emit telemetry to their cloud. Verify via `strace`/`tcpdump` OR by network-namespace isolation in the CI job. D-09 explicitly requires this gate.
- Image digest pinning in `observability/langfuse/docker-compose.yaml` makes image-pull deterministic on CI (Phase 1 NGC pattern).

---

## Shared Patterns (Cross-Cutting)

### Shared Pattern 1 — `profile: profileRef` stamping on every emitted event

**Source:** Phase 2 established this across all packages. See `packages/emmy-provider/src/grammar-retry.ts:65-71` (grammar retry), `packages/emmy-tools/src/native-tools.ts:72-78` (tool invoke), `packages/emmy-tools/src/mcp-bridge.ts:89-97` (mcp rejected), `packages/emmy-ux/src/session.ts:257-261` (session SP_OK).

**Apply to:** EVERY new `emitEvent` call in Phase 3 (compaction.trigger, compaction.complete, compaction.fallback, feedback.rating, offline_ok.audit, offline_ok.violation, footer.sample, keybind.captured, etc.). Additionally — spans via `SpanProcessor.onStart` (Pattern B) auto-stamp `emmy.profile.{id,version,hash}` so manual tracer.startSpan call sites do NOT need to stamp.

**Canonical excerpt:**
```typescript
emitEvent({
  event: "session.compaction.complete",
  ts: new Date().toISOString(),
  profile: profile.ref,         // ALWAYS
  turns_elided: ...,
  turns_preserved: ...,
  ...(opts.turn_id !== undefined ? { turn_id: opts.turn_id } : {}),
});
```

### Shared Pattern 2 — Fail-loud named errors with dotted-path messages

**Source:** `packages/emmy-tools/src/errors.ts` (all error classes), `packages/emmy-ux/src/errors.ts`, `packages/emmy-provider/src/errors.ts`. Phase 1 D-06 is the discipline source.

**Apply to:** Every new named error class in Phase 3:
- `SessionTooFullError` (D-12 post-compaction overflow; `@emmy/context` or `@emmy/ux`)
- `OtelInitError` (OTel SDK init fatal failure, if any)
- `CompactionSummarizationError` (D-16 trigger — caught internally and converted to `session.compaction.fallback` emit, NOT propagated)
- `FeedbackWriteError` (feedback JSONL append I/O failure)

**Canonical shape (`packages/emmy-tools/src/errors.ts` lines 5-13):**
```typescript
export class ToolsError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`tools.${field}: ${message}`);
    this.name = "ToolsError";
  }
}
```

**What changes:** `@emmy/context` gets a `ContextError` base; `SessionTooFullError` extends it with `super("compaction.overflow", "...")`. Message must include: (a) the turn that overflowed, (b) the compaction attempt's turns_elided count, (c) the preservation list size (D-12 diagnostic bundle requirement).

### Shared Pattern 3 — env-var kill-switch with test-only bypass

**Source:** `packages/emmy-ux/bin/pi-emmy.ts` lines 163-185 (`EMMY_SKIP_PROFILE_VALIDATE=1` short-circuit + `EMMY_PROFILE_VALIDATE_BIN` override).

**Apply to:** `EMMY_TELEMETRY=off` (D-08 kill-switch), `--no-telemetry` CLI flag, `EMMY_LANGFUSE_PUBLIC_KEY` / `EMMY_LANGFUSE_SECRET_KEY` (OTLP auth), `EMMY_FEEDBACK_PATH` (test-only override for `~/.emmy/telemetry/feedback.jsonl`).

**Canonical shape (pi-emmy.ts lines 163-168):**
```typescript
if (process.env.EMMY_SKIP_PROFILE_VALIDATE !== "1") {
  const bin = process.env.EMMY_PROFILE_VALIDATE_BIN;
  try {
    if (bin) { /* test path */ }
    else { /* prod path */ }
  } catch (e) { /* fail loud */ }
}
```

**What changes:** Telemetry init at `initOtel(opts: { enabled: !isKillswitched() })`; `isKillswitched()` checks `EMMY_TELEMETRY === "off"` OR `--no-telemetry` flag. Test fixtures use `EMMY_TELEMETRY=off` to bypass OTLP connection attempts.

---

## No Analog Found

Files with no close match in the codebase — planner relies on RESEARCH.md prescriptions verbatim:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/emmy-telemetry/src/otel-sdk.ts` | sdk-integration | event-driven | No prior OTel usage anywhere in repo. RESEARCH §Ex 2 is the full prescription (OTLPTraceExporter + BatchSpanProcessor + NodeSDK.start). |
| `packages/emmy-telemetry/src/profile-stamp-processor.ts` | sdk-integration | event-driven | No prior SpanProcessor usage. RESEARCH §Pattern 2 (lines 435-461) gives the 12-line implementation verbatim. |
| `packages/emmy-ux/src/pi-emmy-extension.ts` | extension-registration | event-driven | No prior pi ExtensionFactory anywhere. RESEARCH §Ex 1/3/4 shows the `before_provider_request`, `setFooter`, `input` hook patterns. |
| `observability/langfuse/docker-compose.yaml` | docker-compose | static | No prior docker-compose in repo. Source: Langfuse's canonical compose at https://raw.githubusercontent.com/langfuse/langfuse/main/docker-compose.yml (verified 2026-04-21 per RESEARCH §Docker images). |
| `packages/emmy-telemetry/src/hf-export.ts` | CLI subcommand | transform | No prior HF export. MVP passes JSONL through (no transform) — per RESEARCH §Open Questions #3 + §Don't Hand-Roll. |
| `packages/emmy-ux/src/feedback-ui.ts` | ui-component | request-response | No prior pi UI-modal invocation. RESEARCH §Ex 4 line 841 shows `ctx.ui.input("Why thumbs-down?", "...").then(comment => ...)` pattern. |

---

## Metadata

**Analog search scope:**
- `/data/projects/emmy/packages/emmy-{provider,tools,ux,telemetry}/src/**/*.ts` (TS source)
- `/data/projects/emmy/emmy_serve/{diagnostics,thermal,canary,profile}/*.py` (Python references)
- `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v2/**` (profile shape)
- `/data/projects/emmy/scripts/*.sh` + `/data/projects/emmy/scripts/*.py` (orchestration shape)
- `/data/projects/emmy/.planning/phases/01-serving-foundation-profile-schema/01-PATTERNS.md` (prior pattern-map shape)

**Files scanned:** 41 candidate new/modified files cross-referenced against 47 existing source files.

**Pattern extraction date:** 2026-04-21

**Key invariants preserved across patterns:**
- Phase 2 `emitEvent` call sites stay unchanged (signature-stable stub dividend).
- SP_OK canary runs on its own raw `postChat` path, NEVER through pi's `before_provider_request` hook (Pitfall #7 regression guard).
- Fail-loud boot rejection only for infrastructure failures (SP_OK, profile-validate, MCP poison, port collision); user-attested network tools are warn-and-continue (D-28).
- Any profile field change bumps `profile.version` AND `profile.hash` per Phase 1 D-02 content-hash contract (v2 → v3 coordinated bump, not v2-mutation).
- Atomic JSONL append uses `fsyncSync` for durability; rows >4KB use tempfile+rename shape instead of in-place append (Pattern A risk note).
- All existing call sites in `packages/emmy-provider/src/grammar-retry.ts`, `packages/emmy-tools/src/native-tools.ts`, `packages/emmy-tools/src/mcp-bridge.ts` that stamp `profile: profileRef` continue to do so unmodified — the `SpanProcessor.onStart` auto-stamp is ADDITIVE for OTel spans, not a replacement for JSONL-stream stamping.
