// packages/emmy-telemetry/src/feedback-schema.ts
//
// Plan 03-05 Task 2 (GREEN) — TELEM-02 lived-experience rating schema.
// 13 fields verbatim from REQUIREMENTS.md TELEM-02 (line 94) — no fewer,
// no more. Emmy owns the turn_id scheme (`${session_id}:${turnIndex}`)
// because pi 0.68's TurnEndEvent exposes only `turnIndex: number` (see
// node_modules/.../dist/core/extensions/types.d.ts line 468-473). The
// idempotent-upsert path keys on turn_id; session_id + turnIndex is
// unique per session so the key is reliable.

export interface FeedbackRow {
	session_id: string;
	turn_id: string;
	profile_id: string;
	profile_version: string;
	profile_hash: string;
	rating: 1 | -1;
	comment: string;
	/** Last-assistant-message concatenated text for the rated turn. */
	model_response: string;
	/** Tool invocations captured during the rated turn. Opaque payload. */
	tool_calls: unknown[];
	latency_ms: number;
	/** GPU/KV cache usage percentage (0-100). */
	kv_used: number;
	tokens_in: number;
	tokens_out: number;
}

/**
 * Required field names — any of these missing triggers FeedbackSchemaError
 * at validateRow time. `comment` is required too; callers pass an empty
 * string for "no comment" rather than undefined (the emmy contract).
 */
const REQUIRED: readonly (keyof FeedbackRow)[] = [
	"session_id",
	"turn_id",
	"profile_id",
	"profile_version",
	"profile_hash",
	"rating",
	"comment",
	"model_response",
	"tool_calls",
	"latency_ms",
	"kv_used",
	"tokens_in",
	"tokens_out",
];

export class FeedbackSchemaError extends Error {
	constructor(public missing: string) {
		super(`feedback row missing or invalid required field: ${missing}`);
		this.name = "FeedbackSchemaError";
	}
}

export class FeedbackNotFoundError extends Error {
	constructor(public turnId: string) {
		super(`no feedback row with turn_id=${turnId}`);
		this.name = "FeedbackNotFoundError";
	}
}

/**
 * Validate a FeedbackRow shape. Throws FeedbackSchemaError on the first
 * missing or structurally-wrong field. Does NOT mutate. `rating` must be
 * exactly 1 or -1 (TELEM-02 contract) — 0, NaN, string "1" all rejected.
 */
export function validateRow(r: Partial<FeedbackRow>): asserts r is FeedbackRow {
	for (const k of REQUIRED) {
		const v = r[k];
		if (v === undefined || v === null) {
			throw new FeedbackSchemaError(k as string);
		}
	}
	if (r.rating !== 1 && r.rating !== -1) {
		throw new FeedbackSchemaError("rating (must be +1 or -1)");
	}
	if (!Array.isArray(r.tool_calls)) {
		throw new FeedbackSchemaError("tool_calls (must be an array)");
	}
}
