// packages/emmy-telemetry/src/turn-role-context.ts
//
// Phase 4 Plan 04-04 Task 2e (HARNESS-08 / D-12) — module-level per-turn
// context holding {variant, variantHash, role}. Populated by
// pi-emmy-extension.ts's before_provider_request handler at the START of
// every turn; cleared by the turn_end handler.
//
// Consumed by EmmyProfileStampProcessor.onStart (profile-stamp-processor.ts)
// to stamp `emmy.profile.variant`, `emmy.profile.variant_hash`, and
// `emmy.role` on the outgoing OTel span. Stamping is OPT-IN — fields
// present in the context are stamped; absent fields are omitted entirely
// (backward-compat for pre-Phase-4 spans).
//
// Pattern analog: packages/emmy-telemetry/src/session-context.ts — same
// module-level singleton pattern, same threading model (single-user pi
// session; no async-local-storage needed on Spark).

export interface TurnRoleContext {
	variant?: string;
	variantHash?: string;
	role?: string;
}

let _turnCtx: TurnRoleContext = {};

/**
 * Replace the module-level turn context. Called by
 * pi-emmy-extension.ts at the top of each before_provider_request, AFTER
 * resolving the variant but BEFORE handleBeforeProviderRequest fires — so
 * the downstream span processor sees the new context on the first
 * startSpan call of the turn.
 */
export function setCurrentTurnRoleContext(ctx: TurnRoleContext): void {
	_turnCtx = { ...ctx };
}

/**
 * Clear the module-level turn context. Called by pi-emmy-extension.ts's
 * turn_end handler so the NEXT turn starts with a fresh slate (no
 * leftover variant/role attribution from the previous turn).
 */
export function clearCurrentTurnRoleContext(): void {
	_turnCtx = {};
}

/**
 * Snapshot of the current turn context. Reads the module-level state
 * verbatim; callers should not mutate the returned object.
 */
export function getCurrentTurnRoleContext(): TurnRoleContext {
	return _turnCtx;
}
