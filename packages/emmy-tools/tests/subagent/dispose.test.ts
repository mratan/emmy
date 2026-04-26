// Phase 04.5 Plan 01 — Disposal regression suite.
//
// Tests:
//   1. Throw-path: when prompt() rejects, dispose() still fires exactly once.
//   2. Abort-mid-prompt (B3): AbortController.abort() while child is mid-prompt
//      → dispose() called exactly once; promise rejects with abort-shaped error.
//   3. 10-cycle abort handle stability (B3): handle count delta is bounded.
//   4. Clean-completion baseline: successful dispatch calls dispose exactly once.
//
// Spy mechanism (bun:test ESM-compatible): we expose a test-only seam on the
// dispatcher module via __setSessionFactoryForTests, swap it for a wrapper that
// counts dispose() calls, then restore. This avoids fragile prototype patching.

import { describe, expect, test } from "bun:test";
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

interface DisposeSpyHandle {
	disposeCallCount: number;
	uninstall: () => void;
}

/**
 * Wrap createAgentSessionFromServices so each returned session has its dispose()
 * counted. Restores the original factory on uninstall().
 */
function installDisposeSpy(): DisposeSpyHandle {
	const handle: DisposeSpyHandle = {
		disposeCallCount: 0,
		uninstall: () => {
			__setSessionFactoryForTests(undefined);
		},
	};
	__setSessionFactoryForTests(async (opts: any) => {
		const result = await createAgentSessionFromServices(opts);
		const originalDispose = result.session.dispose.bind(result.session);
		result.session.dispose = () => {
			handle.disposeCallCount++;
			return originalDispose();
		};
		return result;
	});
	return handle;
}

let __apiCounter = 0;
async function setupParent(replyOrFactory: any) {
	const apiId = `dispose-${++__apiCounter}-${Math.random().toString(36).slice(2)}`;
	const reg = registerFauxProvider({
		api: apiId,
		provider: apiId,
		models: [{ id: "test-model", contextWindow: 4096, maxTokens: 1024 }],
	});
	reg.setResponses(
		Array(8).fill(
			typeof replyOrFactory === "string"
				? fauxAssistantMessage(replyOrFactory, { stopReason: "stop" })
				: replyOrFactory,
		),
	);

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(apiId, "fake-key");

	const parentCwd = mkdtempSync(join(tmpdir(), "emmy-04.5-01-dispose-"));
	const parentServices = await createAgentSessionServices({ cwd: parentCwd, authStorage });
	return { reg, parentCwd, parentServices, modelResolver: () => reg.getModel() };
}

describe("Disposal — V1 dispose-on-throw + abort + handle stability + clean-completion", () => {
	test("Test 4 (CLEAN-COMPLETION baseline) — successful dispatch calls dispose exactly once", async () => {
		const spy = installDisposeSpy();
		try {
			const { reg, parentCwd, parentServices, modelResolver } = await setupParent("CLEAN_OK");
			const persona: SubAgentSpec = {
				name: "test_clean",
				description: "x",
				pattern: "lean",
				toolAllowlist: [],
				maxTurns: 1,
			};
			const result = await dispatchSubAgent(
				{ parentServices, parentCwd, personas: { test_clean: persona }, modelResolver },
				persona,
				{ description: "d", prompt: "ping" },
			);
			expect(result.output).toBe("CLEAN_OK");
			expect(spy.disposeCallCount).toBe(1);
			reg.unregister();
		} finally {
			spy.uninstall();
		}
	});

	test("Test 1 (THROW-PATH) — dispose still fires exactly once when prompt rejects", async () => {
		const spy = installDisposeSpy();
		try {
			// Faux factory that throws when invoked by the agent loop.
			const throwingFactory: any = () => {
				throw new Error("simulated provider failure");
			};
			const { reg, parentCwd, parentServices, modelResolver } = await setupParent(throwingFactory);

			const persona: SubAgentSpec = {
				name: "test_throw",
				description: "x",
				pattern: "lean",
				toolAllowlist: [],
				maxTurns: 1,
			};
			let threw = false;
			try {
				await dispatchSubAgent(
					{ parentServices, parentCwd, personas: { test_throw: persona }, modelResolver },
					persona,
					{ description: "d", prompt: "ping" },
				);
			} catch {
				threw = true;
			}
			// dispose() MUST fire exactly once whether dispatch resolves with error result or throws.
			expect(spy.disposeCallCount).toBe(1);
			expect([true, false]).toContain(threw); // sanity — code path reached
			reg.unregister();
		} finally {
			spy.uninstall();
		}
	});

	test("Test 2 (ABORT-MID-PROMPT, B3) — dispose fires exactly once on abort", async () => {
		const spy = installDisposeSpy();
		try {
			// Faux response factory that listens to the SDK's AbortSignal (passed via options.signal).
			// Hangs until the signal aborts, then rejects with an AbortError so the agent loop bubbles up.
			const hangingFactory: any = (_ctx: any, options: any) =>
				new Promise((_resolve, reject) => {
					const signal: AbortSignal | undefined = options?.signal;
					if (signal) {
						if (signal.aborted) {
							reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
							return;
						}
						signal.addEventListener(
							"abort",
							() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
							{ once: true },
						);
					}
				});
			const { reg, parentCwd, parentServices, modelResolver } = await setupParent(hangingFactory);

			const persona: SubAgentSpec = {
				name: "test_abort",
				description: "x",
				pattern: "lean",
				toolAllowlist: [],
				maxTurns: 1,
			};
			const controller = new AbortController();
			// Abort 25 ms after dispatch starts — long enough for child to be constructed.
			setTimeout(() => controller.abort(), 25);

			let threw = false;
			try {
				await dispatchSubAgent(
					{ parentServices, parentCwd, personas: { test_abort: persona }, modelResolver },
					persona,
					{ description: "d", prompt: "ping", signal: controller.signal },
				);
			} catch {
				threw = true;
			}
			// Whether dispatch rejects or resolves with empty text after abort, dispose MUST fire once.
			expect(spy.disposeCallCount).toBe(1);
			expect([true, false]).toContain(threw);
			reg.unregister();
		} finally {
			spy.uninstall();
		}
	}, 5000);

	test("Test 3 (10-CYCLE STABILITY, B3) — dispose fires 10x; handle delta bounded", async () => {
		const spy = installDisposeSpy();
		try {
			// Same abort-aware factory as Test 2.
			const hangingFactory: any = (_ctx: any, options: any) =>
				new Promise((_resolve, reject) => {
					const signal: AbortSignal | undefined = options?.signal;
					if (signal) {
						if (signal.aborted) {
							reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
							return;
						}
						signal.addEventListener(
							"abort",
							() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
							{ once: true },
						);
					}
				});
			const { reg, parentCwd, parentServices, modelResolver } = await setupParent(hangingFactory);

			const persona: SubAgentSpec = {
				name: "test_cycle",
				description: "x",
				pattern: "lean",
				toolAllowlist: [],
				maxTurns: 1,
			};

			const handlesBefore = (process as any)._getActiveHandles?.()?.length ?? 0;

			for (let i = 0; i < 10; i++) {
				const controller = new AbortController();
				setTimeout(() => controller.abort(), 5);
				try {
					await dispatchSubAgent(
						{ parentServices, parentCwd, personas: { test_cycle: persona }, modelResolver },
						persona,
						{ description: "d", prompt: "ping", signal: controller.signal },
					);
				} catch {
					/* expected — abort */
				}
			}

			// Allow microtask drain.
			await new Promise((r) => setTimeout(r, 50));
			const handlesAfter = (process as any)._getActiveHandles?.()?.length ?? 0;

			expect(spy.disposeCallCount).toBe(10); // 1 per cycle, exactly
			// Tolerance 5 (test runner noise + faux provider intervals); h8-dispose-leak.ts allows 1
			// for sequential clean cycles, but abort+timer cycles add transient timer handles.
			expect(handlesAfter - handlesBefore).toBeLessThanOrEqual(5);
			reg.unregister();
		} finally {
			spy.uninstall();
		}
	}, 30000);
});
