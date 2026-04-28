// packages/emmy-telemetry/test/variant-stamp-absent.test.ts
//
// Phase 4 Plan 04-04 Task 2k — backward-compat invariant. If no variant-aware
// turn context has been set (e.g. pre-Phase-4 call sites, SP_OK canary path,
// tests that forgot to populate the context), the stamp processor MUST NOT
// emit the variant/role attr keys at all. Plan 03-02's span-attribute tests
// depend on this: they assert "exactly three attrs" and would flap if we
// started stamping empty-string variant/role.

import { beforeEach, describe, expect, test } from "bun:test";

import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { EmmyProfileStampProcessor } from "../src/profile-stamp-processor";
import { clearCurrentTurnRoleContext } from "../src/turn-role-context";

beforeEach(() => {
	// Defensive: never inherit context from a sibling test file.
	clearCurrentTurnRoleContext();
});

describe("EmmyProfileStampProcessor — absent turn context (backward-compat)", () => {
	test("span without any turn context has ONLY base attrs; variant/role keys absent", () => {
		const memExporter = new InMemorySpanExporter();
		const provider = new BasicTracerProvider({
			spanProcessors: [
				new EmmyProfileStampProcessor({
					id: "gemma-4-26b-a4b-it",
					version: "v3.1",
					hash: "sha256:phase3base",
				}),
				new SimpleSpanProcessor(memExporter),
			],
		});
		// Tracer sourced from this specific provider — avoids global-
		// tracer-provider caching across tests/files (see variant-stamp.test.ts
		// newHarness rationale).
		const tracer = provider.getTracer("emmy-test-absent");
		const span = tracer.startSpan("no-ctx");
		span.end();

		const attrs = memExporter.getFinishedSpans()[0]!.attributes;
		// Exactly these 3 base keys:
		expect(attrs["emmy.profile.id"]).toBe("gemma-4-26b-a4b-it");
		expect(attrs["emmy.profile.version"]).toBe("v3.1");
		expect(attrs["emmy.profile.hash"]).toBe("sha256:phase3base");
		// And NONE of the Phase-4 keys.
		expect("emmy.profile.variant" in attrs).toBe(false);
		expect("emmy.profile.variant_hash" in attrs).toBe(false);
		expect("emmy.role" in attrs).toBe(false);
	});
});
