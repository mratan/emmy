// @emmy/telemetry — Wave 0 signature stub (Phase 3 implements body).
// Stable signature so @emmy/provider, @emmy/tools, @emmy/ux can `import { emitEvent }`
// today without Phase 3 touching their call sites.

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

export const PACKAGE_VERSION = "0.1.0";
