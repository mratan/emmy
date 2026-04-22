// packages/emmy-context/src/compaction.ts
//
// Phase 3 Plan 03-03 — emmyCompactionTrigger.
//
// Task 1 (this file's initial landing): stub shape so the barrel index.ts
// typechecks. Task 2 replaces the body with the D-11..D-17 full implementation
// that wraps pi 0.68's prepareCompaction + compact pure functions.
//
// Intentional surface for Task 2:
//   - EmmyCompactionContext     — ctx passed by the pi extension handler
//   - EmmyCompactionResult      — { ran, elided, preserved }
//   - emmyCompactionTrigger     — MUST fire on turn_start ONLY (Pitfall #3
//                                 guard via IllegalCompactionTimingError)

import type { ProfileSnapshot } from "@emmy/provider";
import { IllegalCompactionTimingError } from "./errors";
import type { SessionEntry } from "./types";

export interface EmmyCompactionContext {
	profile: ProfileSnapshot;
	entries: SessionEntry[];
	contextTokens: number;
	contextWindow: number;
	eventType: "turn_start" | string;
	model: unknown;
	apiKey: string;
	/** Optional pi.ui.setStatus hook for D-17 visible "compacting…" state. */
	setStatus?: (key: string, text: string | undefined) => void;
}

export interface EmmyCompactionResult {
	ran: boolean;
	elided: number;
	preserved: number;
}

/**
 * Stub entry point. Task 2 replaces the body with the live D-11..D-17 trigger
 * that reuses pi 0.68's `prepareCompaction` + `compact` pure functions with a
 * D-14 preservation pre-filter + D-12 hard-ceiling fail-loud + D-16 structured-
 * pruning fallback.
 *
 * The shape is kept stable across Task 1 → Task 2 so downstream call sites in
 * pi-emmy-extension.ts only need to land once.
 */
export async function emmyCompactionTrigger(
	ctx: EmmyCompactionContext,
): Promise<EmmyCompactionResult> {
	// Pitfall #3 guard — stays in Task 1 so the wiring contract is enforceable
	// from day one. Task 2 adds the rest of the body.
	if (ctx.eventType !== "turn_start") {
		throw new IllegalCompactionTimingError(ctx.eventType);
	}
	return { ran: false, elided: 0, preserved: 0 };
}
