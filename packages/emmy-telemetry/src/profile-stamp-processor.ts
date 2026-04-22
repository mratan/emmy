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

import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

export interface ProfileStampAttrs {
	id: string;
	version: string;
	hash: string;
}

export class EmmyProfileStampProcessor implements SpanProcessor {
	constructor(private readonly profile: ProfileStampAttrs) {}

	onStart(span: Span): void {
		span.setAttributes({
			"emmy.profile.id": this.profile.id,
			"emmy.profile.version": this.profile.version,
			"emmy.profile.hash": this.profile.hash,
		});
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
