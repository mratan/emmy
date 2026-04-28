// packages/emmy-telemetry/test/span-attributes.test.ts
//
// Plan 03-02 Task 2 (RED). Asserts that the EmmyProfileStampProcessor
// auto-stamps emmy.profile.{id,version,hash} on every span via the
// SpanProcessor.onStart hook (D-10 / SC-1 verbatim).
//
// Uses @opentelemetry/sdk-trace-base InMemorySpanExporter as a test harness:
// spans flow through BOTH our EmmyProfileStampProcessor and a SimpleSpanProcessor
// wrapping an InMemorySpanExporter; we read the spans back after .end() to
// assert the stamped attributes survived.

import { describe, expect, test } from "bun:test";

import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";

import { EmmyProfileStampProcessor } from "../src/profile-stamp-processor";

describe("EmmyProfileStampProcessor", () => {
	test("stamps emmy.profile.{id,version,hash} on every started span", () => {
		const memExporter = new InMemorySpanExporter();
		const provider = new BasicTracerProvider({
			spanProcessors: [
				new EmmyProfileStampProcessor({ id: "gemma-4-26b-a4b-it", version: "v2", hash: "sha256:24be3eea" }),
				new SimpleSpanProcessor(memExporter),
			],
		});
		const originalProvider = trace.getTracerProvider();
		trace.setGlobalTracerProvider(provider);
		try {
			const tracer = trace.getTracer("emmy-test");
			const a = tracer.startSpan("a");
			a.end();
			const b = tracer.startSpan("b");
			b.end();
			const c = tracer.startSpan("c");
			c.end();

			const finished = memExporter.getFinishedSpans();
			expect(finished.length).toBe(3);
			for (const span of finished) {
				expect(span.attributes["emmy.profile.id"]).toBe("gemma-4-26b-a4b-it");
				expect(span.attributes["emmy.profile.version"]).toBe("v2");
				expect(span.attributes["emmy.profile.hash"]).toBe("sha256:24be3eea");
			}
		} finally {
			trace.setGlobalTracerProvider(originalProvider);
			memExporter.reset();
		}
	});

	test("onEnd / shutdown / forceFlush are no-ops that never throw", async () => {
		const p = new EmmyProfileStampProcessor({ id: "x", version: "y", hash: "z" });
		// Passing any shape here — onEnd is designed as a no-op body.
		expect(() => p.onEnd({} as never)).not.toThrow();
		await expect(p.shutdown()).resolves.toBeUndefined();
		await expect(p.forceFlush()).resolves.toBeUndefined();
	});
});
