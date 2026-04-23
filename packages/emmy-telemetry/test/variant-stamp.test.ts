// packages/emmy-telemetry/test/variant-stamp.test.ts
//
// Phase 4 Plan 04-04 Task 2j — OTel variant/role attribute stamping tests.
// Asserts:
//   1. Full turn-role-context → span carries emmy.profile.variant +
//      emmy.profile.variant_hash + emmy.role AND the base
//      emmy.profile.{id,version,hash}.
//   2. Partial context (role only) → only the populated keys stamped.
//   3. After clearCurrentTurnRoleContext(), spans revert to base-only attrs.

import { afterEach, describe, expect, test } from "bun:test";

import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { EmmyProfileStampProcessor } from "../src/profile-stamp-processor";
import {
	clearCurrentTurnRoleContext,
	setCurrentTurnRoleContext,
} from "../src/turn-role-context";

/**
 * Build a provider + memory exporter pair and return a tracer sourced from
 * this specific provider (NOT the global `trace.getTracer()` which caches
 * across calls and binds to whichever provider was set first in the
 * process). Each test gets its own pipeline so spans never leak between
 * tests.
 */
function newHarness() {
	const memExporter = new InMemorySpanExporter();
	const provider = new BasicTracerProvider({
		spanProcessors: [
			new EmmyProfileStampProcessor({
				id: "qwen3.6-35b-a3b",
				version: "v3.1",
				hash: "sha256:basebasebase",
			}),
			new SimpleSpanProcessor(memExporter),
		],
	});
	return {
		memExporter,
		tracer: provider.getTracer("emmy-test"),
	};
}

afterEach(() => {
	// Belt-and-suspenders: ensure module-level state never leaks between tests.
	clearCurrentTurnRoleContext();
});

describe("EmmyProfileStampProcessor — variant + role stamping (Plan 04-04 D-12)", () => {
	test("stamps emmy.profile.variant + emmy.profile.variant_hash + emmy.role when context is set", () => {
		const { memExporter, tracer } = newHarness();
		setCurrentTurnRoleContext({
			variant: "v3.1-reason",
			variantHash: "sha256:deadbeef",
			role: "plan",
		});
		const span = tracer.startSpan("variant-stamp-test");
		span.end();

		const finished = memExporter.getFinishedSpans();
		expect(finished.length).toBe(1);
		const attrs = finished[0]!.attributes;
		expect(attrs["emmy.profile.id"]).toBe("qwen3.6-35b-a3b");
		expect(attrs["emmy.profile.version"]).toBe("v3.1");
		expect(attrs["emmy.profile.hash"]).toBe("sha256:basebasebase");
		expect(attrs["emmy.profile.variant"]).toBe("v3.1-reason");
		expect(attrs["emmy.profile.variant_hash"]).toBe("sha256:deadbeef");
		expect(attrs["emmy.role"]).toBe("plan");
	});

	test("stamps only the populated subset of the turn context", () => {
		const { memExporter, tracer } = newHarness();
		// Only role populated — variant + variantHash omitted.
		setCurrentTurnRoleContext({ role: "edit" });
		const span = tracer.startSpan("partial-ctx");
		span.end();

		const attrs = memExporter.getFinishedSpans()[0]!.attributes;
		expect(attrs["emmy.role"]).toBe("edit");
		// variant + variant_hash are ABSENT (not stamped when undefined).
		expect("emmy.profile.variant" in attrs).toBe(false);
		expect("emmy.profile.variant_hash" in attrs).toBe(false);
	});

	test("clearCurrentTurnRoleContext() makes subsequent spans drop variant/role attrs", () => {
		const { memExporter, tracer } = newHarness();
		setCurrentTurnRoleContext({
			variant: "v3.1-precise",
			variantHash: "sha256:feed",
			role: "edit",
		});
		const spanA = tracer.startSpan("with-ctx");
		spanA.end();

		clearCurrentTurnRoleContext();
		const spanB = tracer.startSpan("post-clear");
		spanB.end();

		const [attrsA, attrsB] = memExporter.getFinishedSpans().map((s) => s.attributes);
		// Span A carries variant attrs.
		expect(attrsA!["emmy.profile.variant"]).toBe("v3.1-precise");
		expect(attrsA!["emmy.role"]).toBe("edit");
		// Span B does NOT carry them (context cleared between spans).
		expect("emmy.profile.variant" in attrsB!).toBe(false);
		expect("emmy.role" in attrsB!).toBe(false);
		// But the base profile stamp still fires on span B.
		expect(attrsB!["emmy.profile.id"]).toBe("qwen3.6-35b-a3b");
	});
});
