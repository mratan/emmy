// packages/emmy-tools/src/memory/telemetry.ts
//
// Phase 04.4 plan 04 — wires memory ops into @emmy/telemetry's dual-sink.
// Plan 02 left an `onOp` callback seam in the dispatcher; this module
// produces the function that fills it. Profile stamping (emmy.profile.*)
// is automatic via EmmyProfileStampProcessor — we only emit the event.

import type { MemoryOpEvent } from "./types";

export interface MemoryTelemetryCountersSnapshot {
	view: number;
	create: number;
	str_replace: number;
	insert: number;
	delete: number;
	rename: number;
	bytes_read: number;
	bytes_written: number;
}

/** Mutable counter set; harness reads .snapshot() for the headless JSON envelope. */
export class MemoryTelemetryCounters {
	private counters: MemoryTelemetryCountersSnapshot = {
		view: 0,
		create: 0,
		str_replace: 0,
		insert: 0,
		delete: 0,
		rename: 0,
		bytes_read: 0,
		bytes_written: 0,
	};

	record(event: MemoryOpEvent): void {
		const c = event.command as keyof MemoryTelemetryCountersSnapshot;
		if (
			c === "view" ||
			c === "create" ||
			c === "str_replace" ||
			c === "insert" ||
			c === "delete" ||
			c === "rename"
		) {
			this.counters[c] += 1;
		}
		if (event.result === "ok" && typeof event.bytes === "number") {
			if (event.command === "view" || event.command === "str_replace") {
				this.counters.bytes_read += event.bytes;
			}
			if (
				event.command === "create" ||
				event.command === "str_replace" ||
				event.command === "insert"
			) {
				this.counters.bytes_written += event.bytes;
			}
		}
	}

	snapshot(): MemoryTelemetryCountersSnapshot {
		return { ...this.counters };
	}

	reset(): void {
		this.counters = {
			view: 0,
			create: 0,
			str_replace: 0,
			insert: 0,
			delete: 0,
			rename: 0,
			bytes_read: 0,
			bytes_written: 0,
		};
	}
}

/**
 * Redact arguments before they hit telemetry (gen_ai.tool.call.arguments).
 * If the path's basename ends with any blocked_extensions entry, the
 * `file_text`, `old_str`, `new_str`, `insert_text` fields are replaced with
 * a redaction marker. Non-text fields untouched.
 */
export function redactBlockedArgs(
	args: Record<string, unknown>,
	blockedExtensions: string[],
): Record<string, unknown> {
	const path = String(args.path ?? args.old_path ?? "");
	const lower = path.toLowerCase();
	const matchedExt = blockedExtensions.find((ext) =>
		lower.endsWith(ext.toLowerCase()),
	);
	if (!matchedExt) return args;
	const out = { ...args };
	const TEXT_FIELDS = ["file_text", "old_str", "new_str", "insert_text"];
	for (const f of TEXT_FIELDS) {
		if (typeof out[f] === "string") {
			out[f] = `[REDACTED — blocked extension ${matchedExt}]`;
		}
	}
	return out;
}

/**
 * Factory: returns a callback the memoryTool dispatcher passes as `onOp`.
 * `emitEvent` is dependency-injected (production wires @emmy/telemetry's
 * emitEvent; tests pass a recorder).
 */
export function buildMemoryTelemetryHook(args: {
	emitEvent: (record: {
		event: string;
		ts: string;
		[k: string]: unknown;
	}) => void;
	counters?: MemoryTelemetryCounters;
	argsForOp?: () => Record<string, unknown>;
	blockedExtensions: string[];
}): (event: MemoryOpEvent) => void {
	return (event) => {
		args.counters?.record(event);
		const rec: Record<string, unknown> = {
			event: "memory.op",
			ts: new Date().toISOString(),
			"gen_ai.tool.name": "memory",
			"emmy.memory.command": event.command,
			"emmy.memory.scope": event.scope,
			"emmy.memory.path": event.path,
			"emmy.memory.result": event.result,
		};
		if (typeof event.bytes === "number") {
			rec["emmy.memory.bytes"] = event.bytes;
		}
		if (args.argsForOp) {
			const raw = args.argsForOp();
			const safe = redactBlockedArgs(raw, args.blockedExtensions);
			rec["gen_ai.tool.call.arguments"] = JSON.stringify(safe);
		}
		args.emitEvent(
			rec as { event: string; ts: string; [k: string]: unknown },
		);
	};
}
