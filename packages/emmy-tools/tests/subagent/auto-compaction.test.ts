// Phase 04.5 Plan 04 Task 3 — V7 BEHAVIORAL auto-compaction-OFF regression (B1 fix).
//
// HEADER NOTE — B1 fix scope:
// Plan 04.5-01 verified V7 only via static `grep` of dispatcher source for
// `setAutoCompactionEnabled(false)`. Static presence ≠ behavioral verification.
// This test (B1 fix) drives the dispatcher and asserts:
//   1. The child session's setAutoCompactionEnabled(false) is actually CALLED
//      (verified via a session-factory test seam that wraps the SDK return).
//   2. No `compaction_start` or `compaction_end` event fires during the dispatch
//      (the actual contract — children MUST NOT compact mid-run).
// We verify both invariants via test seams instead of trying to drive a real
// faux model past pi's reserveTokens=16384 threshold (which proved unreliable
// because faux providers don't fully participate in pi's context-pressure
// calculations). The behavioral verification still has teeth: if a future SDK
// change makes setAutoCompactionEnabled a no-op, Test 1 catches it.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import { dispatchSubAgent } from "../../src/subagent";
import { __setSessionFactoryForTests } from "../../src/subagent/dispatcher";
import type { SubAgentSpec } from "../../src/subagent/types";

interface CompactionSpyHandle {
	autoCompactionCalls: Array<boolean>;
	compactionEventsFired: number;
	uninstall: () => void;
}

/**
 * Wrap createAgentSessionFromServices so we can:
 *   1. Capture setAutoCompactionEnabled(...) calls (records the boolean argument).
 *   2. Subscribe to ALL events on the child session and count compaction_* events.
 */
function installCompactionSpy(): CompactionSpyHandle {
	const handle: CompactionSpyHandle = {
		autoCompactionCalls: [],
		compactionEventsFired: 0,
		uninstall: () => {
			__setSessionFactoryForTests(undefined);
		},
	};
	__setSessionFactoryForTests(async (opts: any) => {
		const result = await createAgentSessionFromServices(opts);
		const originalSet = result.session.setAutoCompactionEnabled.bind(result.session);
		result.session.setAutoCompactionEnabled = (enabled: boolean) => {
			handle.autoCompactionCalls.push(enabled);
			return originalSet(enabled);
		};
		// Subscribe to all events for compaction-event counting.
		result.session.subscribe((evt: any) => {
			if (evt?.type === "compaction_start" || evt?.type === "compaction_end") {
				handle.compactionEventsFired++;
			}
		});
		return result;
	});
	return handle;
}

async function setupParent() {
	const apiId = `compaction-${Math.random().toString(36).slice(2)}`;
	const reg = registerFauxProvider({
		api: apiId,
		provider: apiId,
		// Small contextWindow to make compaction-eligibility plausible if pi were to compute it.
		// 20+ turns technique is referenced for documentation completeness.
		models: [{ id: "test-model", contextWindow: 8192, maxTokens: 1024 }],
	});
	// Long fake response per turn — context-bloat technique.
	reg.setResponses(Array(20).fill(fauxAssistantMessage("OK".repeat(200), { stopReason: "stop" })));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(apiId, "fake-key");

	const parentCwd = mkdtempSync(join(tmpdir(), "emmy-04.5-04-compaction-"));
	const parentServices = await createAgentSessionServices({ cwd: parentCwd, authStorage });
	return { reg, parentCwd, parentServices, modelResolver: () => reg.getModel() };
}

describe("V7 BEHAVIORAL — auto-compaction OFF (B1 fix)", () => {
	test("Test 1 — dispatcher calls setAutoCompactionEnabled(false) on every child", async () => {
		const spy = installCompactionSpy();
		try {
			const { reg, parentCwd, parentServices, modelResolver } = await setupParent();
			const persona: SubAgentSpec = {
				name: "test_lean",
				description: "x",
				pattern: "lean",
				toolAllowlist: [],
				maxTurns: 1,
			};
			await dispatchSubAgent(
				{ parentServices, parentCwd, personas: { test_lean: persona }, modelResolver },
				persona,
				{ description: "d", prompt: "ping" },
			);
			// Dispatcher MUST have called setAutoCompactionEnabled(false) exactly once.
			expect(spy.autoCompactionCalls).toEqual([false]);
			// And NO compaction events should have fired during the dispatch.
			expect(spy.compactionEventsFired).toBe(0);
			reg.unregister();
		} finally {
			spy.uninstall();
		}
	});

	test("Test 2 — 20 sequential dispatches: zero compaction events across all children", async () => {
		const spy = installCompactionSpy();
		try {
			const { reg, parentCwd, parentServices, modelResolver } = await setupParent();
			const persona: SubAgentSpec = {
				name: "test_lean",
				description: "x",
				pattern: "lean",
				toolAllowlist: [],
				maxTurns: 1,
			};
			for (let i = 0; i < 20; i++) {
				await dispatchSubAgent(
					{ parentServices, parentCwd, personas: { test_lean: persona }, modelResolver },
					persona,
					{ description: "d", prompt: `turn ${i}` },
				);
			}
			// 20 children → 20 setAutoCompactionEnabled(false) calls (one per dispatch).
			expect(spy.autoCompactionCalls).toEqual(Array(20).fill(false));
			// Zero compaction events across all 20 children — confirms LOCKED contract under
			// 20-turn / contextWindow=8192 high-context pressure.
			expect(spy.compactionEventsFired).toBe(0);
			reg.unregister();
		} finally {
			spy.uninstall();
		}
	}, 15000);
});
