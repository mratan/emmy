// packages/emmy-telemetry/src/profile-stamp-processor.ts
//
// Phase 3 Plan 03-02 Task 3 (GREEN) — SpanProcessor that auto-stamps every
// started span with emmy.profile.{id,version,hash} attributes.
//
// D-10 / SC-1 literally reads: "every span carries profile.id, profile.version,
// profile.hash attributes". Without this processor, we would need to modify
// every span-creation call site — not scalable. Installing this processor as
// the FIRST processor in the SDK's pipeline guarantees the stamp is applied
// before BatchSpanProcessor(OTLPExporter) fans out.
//
// Reference: RESEARCH.md §Pattern 2 (verbatim).
//
// Plan 04-03 D-23 extension — harness hot-swap support:
//   The @opentelemetry/sdk-node 0.205 + sdk-trace-base 2.1 pinned here do NOT
//   expose a public addSpanProcessor/removeSpanProcessor on the tracer provider.
//   Rather than tearing down + rebuilding the entire SDK on every /profile
//   swap, this processor now holds a MUTABLE profile reference — setProfile()
//   atomically replaces it so subsequent onStart calls stamp the new attrs.
//   The same processor instance lives through the swap; only its internal
//   profile pointer moves. See swapSpanProcessor() in otel-sdk.ts.

import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

import { getCurrentTurnRoleContext } from "./turn-role-context";

export interface ProfileStampAttrs {
	id: string;
	version: string;
	hash: string;
}

export class EmmyProfileStampProcessor implements SpanProcessor {
	// NOT readonly — Plan 04-03 D-23 uses setProfile() to hot-swap the stamp
	// without rebuilding the OTel SDK. All other fields remain internal.
	private profile: ProfileStampAttrs;

	constructor(profile: ProfileStampAttrs) {
		this.profile = profile;
	}

	/**
	 * Plan 04-03 D-23 — replace the current profile reference so subsequent
	 * onStart calls stamp the new profile's id/version/hash. Atomic under the
	 * single-threaded Node event loop: any span started strictly after this
	 * call sees the new attrs; any started strictly before sees the old attrs.
	 * The /profile command guards against concurrent spans via D-06 isIdle().
	 */
	setProfile(profile: ProfileStampAttrs): void {
		this.profile = profile;
	}

	/** Read-only view of the currently stamped profile (introspection + tests). */
	getProfile(): ProfileStampAttrs {
		return this.profile;
	}

	onStart(span: Span): void {
		span.setAttributes({
			"emmy.profile.id": this.profile.id,
			"emmy.profile.version": this.profile.version,
			"emmy.profile.hash": this.profile.hash,
		});
		// Phase 4 Plan 04-04 (D-12) — per-turn variant/role attribution.
		// Absent when no variant-aware turn context exists (pre-Phase-4 wire
		// paths + SP_OK canary + every span fired outside of the before-
		// request → turn_end window). Backward-compat for Plan 03-02
		// span-attribute tests: only stamp KEYS that are populated.
		const turnCtx = getCurrentTurnRoleContext();
		if (turnCtx.variant) {
			span.setAttribute("emmy.profile.variant", turnCtx.variant);
		}
		if (turnCtx.variantHash) {
			span.setAttribute("emmy.profile.variant_hash", turnCtx.variantHash);
		}
		if (turnCtx.role) {
			span.setAttribute("emmy.role", turnCtx.role);
		}
	}

	onEnd(_span: ReadableSpan): void {
		/* no-op: stamping happens at start so every exporter sees the attrs */
	}

	async shutdown(): Promise<void> {
		/* no-op */
	}

	async forceFlush(): Promise<void> {
		/* no-op */
	}
}

/**
 * Plan 04-03 D-23 — hot-swap the profile reference on an existing processor.
 *
 * Pass the SAME processor instance that was installed into the OTel SDK at
 * initOtel() time; this updates its internal profile ref so going-forward
 * spans stamp the new profile. The SDK does not need to be restarted and no
 * processor-add/processor-remove is required (the pinned sdk-trace-base 2.1
 * doesn't expose those mutators publicly).
 */
export function swapSpanProcessor(
	processor: EmmyProfileStampProcessor,
	newProfile: ProfileStampAttrs,
): void {
	processor.setProfile(newProfile);
}
