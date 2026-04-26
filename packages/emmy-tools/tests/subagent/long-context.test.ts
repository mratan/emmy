// Phase 04.5 Plan 04 Task 2 — V6 long-context serialization regression.
//
// When parentInputTokens > longContextSerializeThresholdTokens, two parallel
// dispatches MUST serialize (not run in parallel) and emit
// agent.dispatch.serialized. Counter-test: under-threshold runs in parallel.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const emittedEvents: any[] = [];
const emitEventSpy = mock((record: any) => {
	emittedEvents.push(record);
});
mock.module("@emmy/telemetry", () => ({
	emitEvent: emitEventSpy,
}));

import {
	AuthStorage,
	createAgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import { createSubAgentTool, createConcurrencyGovernor } from "../../src/subagent";
import type { SubAgentSpec } from "../../src/subagent/types";

beforeEach(() => {
	emittedEvents.length = 0;
	emitEventSpy.mockClear();
});

async function setupTool(parentInputTokens: number) {
	const apiId = `lc-${Math.random().toString(36).slice(2)}`;
	const reg = registerFauxProvider({
		api: apiId,
		provider: apiId,
		models: [{ id: "test-model", contextWindow: 4096, maxTokens: 1024 }],
	});
	// Each response delays ~50ms to differentiate parallel vs serialized wall-time.
	reg.setResponses(
		Array(8).fill((async () => {
			await new Promise((r) => setTimeout(r, 50));
			return fauxAssistantMessage("LC_OK", { stopReason: "stop" });
		}) as any),
	);

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(apiId, "fake-key");

	const parentCwd = mkdtempSync(join(tmpdir(), "emmy-04.5-04-lc-"));
	const parentServices = await createAgentSessionServices({ cwd: parentCwd, authStorage });

	const persona: SubAgentSpec = {
		name: "lean",
		description: "x",
		pattern: "lean",
		toolAllowlist: [],
		maxTurns: 1,
	};

	const governor = createConcurrencyGovernor({
		maxConcurrent: 2,
		longContextSerializeThresholdTokens: 40000,
		rejectOverCap: false, // queue mode — important for parallel non-rejection on test 2
	});

	const tool = createSubAgentTool({
		parentServices,
		parentCwd,
		personas: { lean: persona },
		modelResolver: () => reg.getModel(),
		parentInputTokens: () => parentInputTokens,
		governor,
	});
	return { tool, reg };
}

describe("V6 — long-context serialization", () => {
	test("Above threshold (50000 vs 40000) — parallel dispatches serialize + emit serialized event", async () => {
		const { tool, reg } = await setupTool(50000);
		const t0 = performance.now();
		await Promise.all([
			tool.execute("c1", { subagent_type: "lean", description: "d", prompt: "p1" } as any, undefined, undefined, {} as any),
			tool.execute("c2", { subagent_type: "lean", description: "d", prompt: "p2" } as any, undefined, undefined, {} as any),
		]);
		const wall = performance.now() - t0;
		// Both calls take ~50ms each; serialized → ≥ 90ms total. Parallel would be ~50ms.
		expect(wall).toBeGreaterThan(90);
		const serialized = emittedEvents.filter((e) => e.event === "agent.dispatch.serialized");
		expect(serialized.length).toBeGreaterThanOrEqual(1);
		expect(serialized[0].parent_input_tokens).toBe(50000);
		expect(serialized[0].threshold).toBe(40000);
		reg.unregister();
	});

	test("Under threshold (1000 vs 40000) — parallel dispatches stay parallel", async () => {
		const { tool, reg } = await setupTool(1000);
		const t0 = performance.now();
		await Promise.all([
			tool.execute("c1", { subagent_type: "lean", description: "d", prompt: "p1" } as any, undefined, undefined, {} as any),
			tool.execute("c2", { subagent_type: "lean", description: "d", prompt: "p2" } as any, undefined, undefined, {} as any),
		]);
		const wall = performance.now() - t0;
		// Parallel → ~50ms; allow some scheduling overhead but well under serialization threshold.
		expect(wall).toBeLessThan(150);
		const serialized = emittedEvents.filter((e) => e.event === "agent.dispatch.serialized");
		expect(serialized.length).toBe(0);
		reg.unregister();
	});
});
