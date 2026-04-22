// packages/emmy-telemetry/src/session-context.ts
//
// Phase 3 Plan 03-02 Task 3 (GREEN) — module-level telemetry context so that
// every existing emitEvent(record) call site (grammar-retry.ts, native-tools.ts,
// mcp-bridge.ts, session.ts, prompt-assembly.ts) continues to compile + work
// unchanged. The context carries the JSONL sink path and the OTel tracer
// handle; pi-emmy.ts calls configureTelemetry(...) exactly once per session
// AFTER initOtel(...) returns.
//
// Signature-stability invariant: emitEvent MUST accept `(record)` alone — no
// ctx arg threading through every call site — because Phase 2 stamped a NO-OP
// stub with that exact shape (Phase 2 D-01 "signature stable, body replaced").

import type { Tracer } from "@opentelemetry/api";
import { trace } from "@opentelemetry/api";

export interface TelemetryContext {
	jsonlPath: string | null;
	tracer: Tracer | null;
	enabled: boolean;
}

let _ctx: TelemetryContext = {
	jsonlPath: null,
	tracer: null,
	enabled: false,
};

/**
 * Set (or partially update) the module-level telemetry context.
 *
 * Called by pi-emmy.ts after initOtel() returns. When `enabled: true` and no
 * explicit tracer is given, defaults to trace.getTracer("emmy", "0.1.0") so
 * OTLP export routes through whatever TracerProvider initOtel installed on
 * the global OTel API.
 */
export function configureTelemetry(cfg: Partial<TelemetryContext>): void {
	_ctx = { ..._ctx, ...cfg };
	if (_ctx.enabled && _ctx.tracer === null) {
		_ctx.tracer = trace.getTracer("emmy", "0.1.0");
	}
}

export function getTelemetryContext(): TelemetryContext {
	return _ctx;
}

/**
 * Reset the module-level context to its initial state. Test-only helper.
 * Production callers should never need this — the session lifetime equals the
 * process lifetime for single-user pi-emmy.
 */
export function resetTelemetryContext(): void {
	_ctx = { jsonlPath: null, tracer: null, enabled: false };
}
