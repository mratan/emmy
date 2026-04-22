// @emmy/telemetry — Phase 3 Plan 03-02 dual-sink body (D-06).
//
// emitEvent's signature is signature-stable from the Phase 2 Wave-0 stub
// (Phase 2 D-01: "empty telemetry stub now > telemetry-retrofit-workspace
// later"). Every existing call site in @emmy/provider, @emmy/tools, and
// @emmy/ux keeps compiling unchanged.
//
// Dual-sink contract (RESEARCH §Pattern 3):
//   - JSONL authoritative (appendJsonlAtomic; for records > PIPE_BUF fall
//     back to writeJsonAtomic tempfile+rename shape per Pattern A risk note).
//     JSONL write never propagates fs errors upward — logs to stderr and
//     continues so the agent loop is not blocked on disk IO.
//   - OTLP best-effort (tracer.startSpan + setAttribute + end). OTLP failure
//     never propagates; JSONL remains authoritative. Exceptions during the
//     tracer path are swallowed per D-06.
//
// Profile stamp semantics:
//   Every record's top-level `profile` key (if present) is flattened into
//   emmy.profile.* span attributes AT emitEvent time. Additionally, the
//   EmmyProfileStampProcessor installed in otel-sdk.ts auto-stamps those
//   same attrs on EVERY span started via the global Tracer (including spans
//   created by downstream code paths that do not go through emitEvent). The
//   two mechanisms are redundant by design — per-event stamping keeps the
//   JSONL record self-describing; processor stamping catches spans created
//   outside the emitEvent path (e.g. HARNESS-09 chat spans in Plan 03-03).

import { appendJsonlAtomic, writeJsonAtomic } from "./atomic-append";
import { getTelemetryContext } from "./session-context";

export interface TelemetryRecord {
	event: string;
	ts: string;
	profile?: { id: string; version: string; hash: string };
	[k: string]: unknown;
}

// Linux PIPE_BUF. Writes up to this size are atomic with respect to
// concurrent appenders sharing the fd; past this size we fall back to
// writeJsonAtomic (tempfile + rename).
const PIPE_BUF = 4096;

export function emitEvent(record: TelemetryRecord): void {
	const ctx = getTelemetryContext();
	if (!ctx.enabled) return;

	// --- JSONL authoritative (D-06) ---
	if (ctx.jsonlPath) {
		try {
			const serialized = JSON.stringify(record);
			if (serialized.length + 1 > PIPE_BUF) {
				writeJsonAtomic(ctx.jsonlPath, record);
			} else {
				appendJsonlAtomic(ctx.jsonlPath, record);
			}
		} catch (err) {
			// JSONL write failure must never block the agent loop; log to stderr
			// so the operator has a surface for diagnosing lost events (same
			// contract as Phase 1 diagnostic bundle best-effort writes).
			console.error(
				`[emmy/telemetry] JSONL append failed - event lost: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// --- OTLP best-effort (D-06) ---
	if (ctx.tracer) {
		try {
			const spanName = spanNameFor(record.event);
			const span = ctx.tracer.startSpan(spanName);
			try {
				for (const [k, v] of Object.entries(record)) {
					if (k === "event" || k === "ts") continue;
					if (k === "profile" && v && typeof v === "object") {
						for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
							span.setAttribute(`emmy.profile.${pk}`, coerceAttr(pv));
						}
						continue;
					}
					span.setAttribute(`emmy.${k}`, coerceAttr(v));
				}
			} finally {
				span.end();
			}
		} catch {
			// OTLP failure accepted as best-effort (D-06). No console noise —
			// the boot banner already surfaced "JSONL-only" if Langfuse is
			// unreachable. Per-event failures in the happy path are rare and
			// would spam stderr if logged here.
		}
	}
}

/**
 * Map emitEvent's `event` string (e.g. "session.sp_ok.pass") to an OTel span
 * name in the emmy.* namespace. Keeps span names structurally parallel to
 * JSONL event names so a Langfuse-UI reader and a JSONL grep return identical
 * result sets.
 */
function spanNameFor(event: string): string {
	return `emmy.${event}`;
}

/**
 * Coerce a TelemetryRecord attribute value to an OTel span attribute value.
 * OTel attrs accept string | number | boolean | array-thereof; we narrow to
 * the scalars and JSON-stringify anything else. Null / undefined -> "".
 */
function coerceAttr(v: unknown): string | number | boolean {
	if (v == null) return "";
	if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

// Re-exports so downstream callers don't need to know the internal module
// layout. pi-emmy.ts uses: initOtel + shutdownOtel + resolveTelemetryEnabled +
// configureTelemetry. Tests additionally use resetTelemetryContext.
export { configureTelemetry, getTelemetryContext, resetTelemetryContext } from "./session-context";
export { appendJsonlAtomic, writeJsonAtomic } from "./atomic-append";
export { initOtel, shutdownOtel, resolveTelemetryEnabled } from "./otel-sdk";
export { EmmyProfileStampProcessor } from "./profile-stamp-processor";

export const PACKAGE_VERSION = "0.1.0";
