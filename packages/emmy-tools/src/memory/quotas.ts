// packages/emmy-tools/src/memory/quotas.ts
//
// Plan 04.4-01 Task 3: per-file + per-scope quota enforcement.
//
// MEMORY-TOOL-SPEC.md §3.2 caps:
//   max_file_bytes = 65536      (default; configurable per profile)
//   max_total_bytes = 10 * 1024^2  (10 MiB default per scope)
//
// Threat: T-04.4-01-04 (DoS via symlink-loop) — walkScopeBytes uses lstatSync
// to detect symlinks and SKIPS them. Threat: T-04.4-01-05 (DoS via
// unbounded growth) — checks run pre-write.

import { readdirSync, lstatSync, statSync } from "node:fs";
import { join } from "node:path";
import { MemoryError } from "./types";

/** Pre-write file-size guard. Throws MemoryError("memory.quota_exceeded") if exceeded. */
export function checkFileQuota(bytes: number, maxFileBytes: number): void {
	if (bytes > maxFileBytes) {
		throw new MemoryError(
			"memory.quota_exceeded",
			`file size ${bytes} bytes exceeds max_file_bytes=${maxFileBytes}`,
			{ bytes, maxFileBytes },
		);
	}
}

/**
 * Recursively sum file bytes under `rootDir`.
 *
 *  - Uses lstatSync first; if entry is a symlink, SKIP (security: no symlink
 *    follow → no DoS via symlink loops, no traversal via deliberate links).
 *  - Errors on individual entries (race condition: file deleted while walking)
 *    are skipped rather than propagated. We are computing a quota estimate.
 *  - If `rootDir` itself does not exist, returns 0 (a fresh scope with no
 *    files yet).
 */
export function walkScopeBytes(rootDir: string): number {
	let total = 0;
	let entries: string[];
	try {
		entries = readdirSync(rootDir);
	} catch {
		return 0;
	}
	for (const name of entries) {
		const full = join(rootDir, name);
		let st;
		try {
			st = lstatSync(full);
		} catch {
			continue;
		}
		if (st.isSymbolicLink()) continue; // SKIP symlinks (security)
		if (st.isDirectory()) {
			total += walkScopeBytes(full);
		} else if (st.isFile()) {
			try {
				total += statSync(full).size;
			} catch {
				// raced; skip
			}
		}
	}
	return total;
}

/**
 * Pre-write scope-total guard. Walks `rootDir`, sums bytes, adds
 * `pendingNewBytes`, throws if the total would exceed `maxTotalBytes`.
 *
 * Convention: callers use `pendingNewBytes = 0` for delete or rename within
 * scope (those don't grow bytes).
 */
export function checkScopeQuota(
	rootDir: string,
	pendingNewBytes: number,
	maxTotalBytes: number,
): void {
	const current = walkScopeBytes(rootDir);
	const projected = current + pendingNewBytes;
	if (projected > maxTotalBytes) {
		throw new MemoryError(
			"memory.quota_exceeded",
			`scope total ${projected} bytes (current ${current} + pending ${pendingNewBytes}) exceeds max_total_bytes=${maxTotalBytes}`,
			{ current, pendingNewBytes, maxTotalBytes },
		);
	}
}
