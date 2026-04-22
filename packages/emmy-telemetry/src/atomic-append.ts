// packages/emmy-telemetry/src/atomic-append.ts
//
// Phase 3 Plan 03-02 Task 3 (GREEN) — TypeScript port of
// emmy_serve/diagnostics/atomic.py:append_jsonl_atomic + write_json_atomic.
// Provides the D-06 JSONL-authoritative sink for @emmy/telemetry.emitEvent.
//
// Semantic parity with the Python reference (atomic.py lines 62-75):
//   - open(path, "a") - flag O_APPEND; kernel guarantees atomic writes <=
//     PIPE_BUF bytes on Linux (4096 on all major kernels).
//   - write(line) - single syscall; no buffering on the Node side because we
//     open in append mode without a stream wrapper.
//   - flush() + fsync(fd) - durability; data reaches stable storage before
//     close returns.
//   - closeSync - cleanup.
//
// Canonical JSON: matches Python json.dumps(sort_keys=True, separators=(",", ":"))
// - sort_keys True recursively orders all object keys alphabetically.
// - separators no-space output maximizes byte-determinism across runs.
//
// writeJsonAtomic mirrors atomic.py:write_bytes_atomic (tempfile + fsync +
// rename). Used for records >PIPE_BUF or when the caller needs a complete
// file replacement semantics.

import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Append one JSON line to `path`, fsync'd.
 *
 * Parent directory is auto-created. Record is serialized with canonical JSON
 * (sort_keys + no-space separators). A trailing newline is always written so
 * the file is valid JSONL.
 *
 * @throws on fs errors (caller must decide whether to swallow — emitEvent
 *         swallows and logs to stderr per D-06's JSONL-best-effort exception
 *         invariant).
 */
export function appendJsonlAtomic(path: string, record: Record<string, unknown>): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const line = `${canonicalStringify(record)}\n`;
	const fd = openSync(path, "a");
	try {
		writeFileSync(fd, line, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

/**
 * Atomically write (replace) `path` with the canonical-JSON serialization of
 * `record` via tempfile + fsync + rename. Use for records whose serialization
 * may exceed PIPE_BUF (4096B) — the append path does not guarantee atomicity
 * at that size.
 *
 * Temp file is dot-prefixed in the destination directory so an interrupted
 * write leaves an obvious leftover (next clean-run removes it); rename is
 * always within the same filesystem (so it is atomic on POSIX).
 */
export function writeJsonAtomic(path: string, record: Record<string, unknown>): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
	const fd = openSync(tmp, "w");
	let renamed = false;
	try {
		writeFileSync(fd, `${canonicalStringify(record)}\n`, "utf8");
		fsyncSync(fd);
		closeSync(fd);
		renameSync(tmp, path);
		renamed = true;
	} finally {
		if (!renamed) {
			// Best-effort cleanup on failure; the caller sees the original error.
			try {
				closeSync(fd);
			} catch {
				/* fd may already be closed after the first closeSync above */
			}
			try {
				if (existsSync(tmp)) unlinkSync(tmp);
			} catch {
				/* best-effort */
			}
		}
	}
}

/**
 * Canonical JSON serialization matching Python's
 * `json.dumps(obj, sort_keys=True, separators=(",", ":"))`.
 *
 * JSON.stringify's replacer can return a modified value for each node.
 * We intercept plain objects (not arrays, not primitives, not null) and emit
 * a key-sorted shallow copy; recursion happens because stringify calls the
 * replacer on every node down the tree.
 */
function canonicalStringify(obj: unknown): string {
	return JSON.stringify(obj, (_k, v) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			return sortKeys(v as Record<string, unknown>);
		}
		return v;
	});
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(o).sort()) {
		out[k] = o[k];
	}
	return out;
}
