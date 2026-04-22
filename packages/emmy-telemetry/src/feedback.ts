// packages/emmy-telemetry/src/feedback.ts
//
// Plan 03-05 Task 2 (GREEN) — lived-experience rating JSONL persistence.
//
// Path: ~/.emmy/telemetry/feedback.jsonl (TELEM-02 verbatim; D-20).
// Authoritative sink across sessions — this accumulates the corpus that
// Plan 03-05's --export-hf and Phase 7's publication flow ultimately publish.
//
// Atomic semantics:
//   appendFeedback — dispatches to appendJsonlAtomic (PIPE_BUF-safe append +
//     fsync) when serialized record is <= 4KB, otherwise falls back to a
//     tempfile+rename atomic whole-file rewrite (the same pattern Plan 03-02's
//     writeJsonAtomic uses, scoped to a single new-line append).
//   updateFeedback — read-all → locate by turn_id → mutate → atomic rewrite.
//     Used for idempotent Alt+Up/Down rating flow.
//   upsertFeedback — wrapper: if turn_id exists → updateFeedback; else
//     appendFeedback. This is the single entry point feedback-ui.ts calls.
//
// Non-ESM fs access disallowed (plan-checker INFO). We import from "node:fs"
// via ES Modules; no `require(...)` anywhere in this file.

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { appendJsonlAtomic } from "./atomic-append";
import {
	FeedbackNotFoundError,
	FeedbackSchemaError,
	validateRow,
	type FeedbackRow,
} from "./feedback-schema";

/** Global lived-experience corpus path (TELEM-02 verbatim). */
export function defaultFeedbackPath(): string {
	return join(homedir(), ".emmy", "telemetry", "feedback.jsonl");
}

// Linux PIPE_BUF — appends <= this size are atomic with respect to concurrent
// appenders. Mirror Plan 03-02 Pattern A threshold so feedback.jsonl shares
// the same durability invariant as events.jsonl.
const PIPE_BUF = 4096;

/**
 * Append one FeedbackRow to `path`. Dispatches atomic-append for small rows,
 * tempfile+rename for rows that might interleave with other appenders if the
 * write exceeds PIPE_BUF.
 *
 * @throws FeedbackSchemaError when the row is missing required fields or has
 *         an invalid rating value.
 */
export function appendFeedback(path: string, row: FeedbackRow): void {
	validateRow(row);
	const serialized = JSON.stringify(row);
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	if (serialized.length + 1 <= PIPE_BUF) {
		// Fast path: PIPE_BUF-safe append + fsync (Plan 03-02 appendJsonlAtomic).
		appendJsonlAtomic(path, row as unknown as Record<string, unknown>);
		return;
	}

	// Large-row path: read-all + append + tempfile-rename. The canonical
	// serialization (appendJsonlAtomic uses canonicalStringify internally) is
	// not strictly required for feedback rows because we never hash the file
	// as a whole — rows are independent JSONL lines. We use plain
	// JSON.stringify here so the large-row path is maximally simple.
	const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
	const newContent = existing + serialized + "\n";
	const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, newContent, "utf8");
	renameSync(tmp, path);
}

/**
 * Read all rows from `path`. Tolerates trailing newline / empty trailing
 * lines; skips malformed lines silently (caller can't recover anyway and
 * this is a best-effort read surface).
 */
export function readFeedback(path: string): FeedbackRow[] {
	if (!existsSync(path)) return [];
	const text = readFileSync(path, "utf8");
	const rows: FeedbackRow[] = [];
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		try {
			rows.push(JSON.parse(line) as FeedbackRow);
		} catch {
			// Skip corrupt line; a hand-edited feedback.jsonl might contain
			// one. validateRow would catch it on a subsequent upsert.
		}
	}
	return rows;
}

/**
 * In-place update of the row matching `turnId`. Atomic: writes new content
 * to a dot-prefixed tempfile in the same directory, fsync-free (Node's
 * writeFileSync does not fsync by default, but rename(2) is atomic on the
 * same filesystem — we accept the small window where a crash could leave
 * the OLD file or the NEW file but never a partial-rewrite of either).
 *
 * @throws FeedbackNotFoundError when `turnId` is absent from the file.
 * @throws FeedbackSchemaError when the merged row fails validation.
 */
export function updateFeedback(
	path: string,
	turnId: string,
	patch: Partial<FeedbackRow>,
): void {
	const rows = readFeedback(path);
	const idx = rows.findIndex((r) => r.turn_id === turnId);
	if (idx < 0) throw new FeedbackNotFoundError(turnId);
	const merged = { ...rows[idx]!, ...patch } as FeedbackRow;
	validateRow(merged);
	rows[idx] = merged;
	const newContent = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(tmp, newContent, "utf8");
	renameSync(tmp, path);
}

/**
 * Idempotent upsert keyed on row.turn_id. This is the single entry point
 * for rating capture (feedback-ui.ts calls this — never appendFeedback
 * directly — because repeated Alt+Up on the same turn must UPDATE, not
 * duplicate).
 */
export function upsertFeedback(path: string, row: FeedbackRow): void {
	validateRow(row);
	try {
		updateFeedback(path, row.turn_id, row);
	} catch (e) {
		if (e instanceof FeedbackNotFoundError) {
			appendFeedback(path, row);
			return;
		}
		throw e;
	}
}

export { FeedbackNotFoundError, FeedbackSchemaError };
export type { FeedbackRow };
