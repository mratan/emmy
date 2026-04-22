// packages/emmy-telemetry/src/turn-tracker.ts
//
// Plan 03-05 Task 2 (GREEN) — in-memory TurnTracker.
//
// D-19 (REQUIREMENTS.md TELEM-02): Alt+Up/Down rate the MOST-RECENT completed
// agent turn. No transcript-cursor UI; simple tracker that keeps the latest
// turn's metadata and lets feedback-ui.ts pull it at rating time.
//
// pi 0.68 TurnEndEvent shape (VERIFIED 2026-04-21 from types.d.ts line 468-473):
//   { type: "turn_end", turnIndex: number, message: AgentMessage, toolResults: ToolResultMessage[] }
//
// There is NO `turn_id` field on pi's event. Emmy owns the turn_id scheme:
// `${session_id}:${turnIndex}`. pi-emmy-extension.ts synthesizes the turn_id
// AT the turn_end callback and hands a fully-populated TurnMeta to this
// tracker. The idempotent upsert in feedback.ts keys on turn_id — reliable
// because session_id + turnIndex is unique per session.
//
// (Plan 03-07 or pi 0.69+ may add a native turn_id; this module is the
// single place the synthesis happens, so a future swap is a one-file edit.)

export interface TurnMeta {
	turn_id: string;
	session_id: string;
	profile_id: string;
	profile_version: string;
	profile_hash: string;
	model_response: string;
	tool_calls: unknown[];
	latency_ms: number;
	kv_used: number;
	tokens_in: number;
	tokens_out: number;
	completed_at: string;
}

/**
 * Keeps only the latest completed turn's metadata. Not thread-safe (the
 * emmy harness is single-event-loop so there's no contention).
 *
 * Usage (pi-emmy-extension.ts):
 *   const tracker = new TurnTracker();
 *   pi.on("turn_end", (event, ctx) => {
 *     tracker.recordTurnComplete({ turn_id: `${session_id}:${event.turnIndex}`, ... });
 *   });
 */
export class TurnTracker {
	private _latest: TurnMeta | null = null;

	recordTurnComplete(meta: TurnMeta): void {
		this._latest = meta;
	}

	getLatest(): TurnMeta | null {
		return this._latest;
	}

	/** Test-only: forget the latest turn (simulates session start). */
	clear(): void {
		this._latest = null;
	}
}
