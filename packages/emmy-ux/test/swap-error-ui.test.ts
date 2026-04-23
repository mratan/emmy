// packages/emmy-ux/test/swap-error-ui.test.ts
//
// Plan 04-03 Task 2 — error-UX branches of registerProfileCommand handler.
//
// Covers D-04 failure contract: distinct user-visible notify messages for
// every orchestrator exit code that isn't 0. reloadHarnessProfile() MUST
// NOT fire on any non-zero exit code.

import { describe, expect, test } from "bun:test";

import {
	registerProfileCommand,
	type RegisterProfileCommandOpts,
} from "../src/slash-commands";
import type { ProfileIndex } from "../src/profile-index";

type Handler = (args: string, ctx: unknown) => Promise<void>;

function capturePi(): {
	pi: unknown;
	registered: Array<{ handler: Handler }>;
} {
	const registered: Array<{ handler: Handler }> = [];
	const pi = {
		registerCommand: (
			_name: string,
			options: { handler: Handler },
		) => {
			registered.push({ handler: options.handler });
		},
	};
	return { pi, registered };
}

function makeIndex(target: string | null = "/tgt"): ProfileIndex {
	return {
		complete: () => [],
		resolve: () => target,
	};
}

function makeCtx(): {
	ctx: unknown;
	notifies: Array<[string, string | undefined]>;
	setStatuses: Array<[string, string | undefined]>;
} {
	const notifies: Array<[string, string | undefined]> = [];
	const setStatuses: Array<[string, string | undefined]> = [];
	const ctx = {
		isIdle: () => true,
		ui: {
			confirm: async () => true,
			notify: (msg: string, type?: string) => {
				notifies.push([msg, type]);
			},
			setStatus: (key: string, text: string | undefined) => {
				setStatuses.push([key, text]);
			},
		},
	};
	return { ctx, notifies, setStatuses };
}

function makeOpts(
	overrides: Partial<RegisterProfileCommandOpts>,
): RegisterProfileCommandOpts {
	return {
		profileDir: "/p",
		port: 8002,
		profileIndex: makeIndex(),
		runSwap: async () => ({ exit: 0 }),
		reloadHarnessProfile: async () => {},
		...overrides,
	};
}

describe("swap-error-ui — exit-code branches", () => {
	test("exit 5 (pre-flight fail): user sees 'prior model still serving' notify; reload NOT called", async () => {
		const { pi, registered } = capturePi();
		let reloadCalled = false;
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async () => ({ exit: 5 }),
				reloadHarnessProfile: async () => {
					reloadCalled = true;
				},
			}),
		);
		const { ctx, notifies } = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		expect(reloadCalled).toBe(false);
		expect(notifies.length).toBe(1);
		expect(notifies[0]![0]).toBe(
			"swap pre-flight failed (prior model still serving)",
		);
		expect(notifies[0]![1]).toBe("error");
	});

	test("exit 6 + rollback_succeeded=true: 'rollback succeeded' notify; reload NOT called", async () => {
		const { pi, registered } = capturePi();
		let reloadCalled = false;
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async () => ({
					exit: 6,
					envelope: { rolled_back: true, rollback_succeeded: true },
				}),
				reloadHarnessProfile: async () => {
					reloadCalled = true;
				},
			}),
		);
		const { ctx, notifies } = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		expect(reloadCalled).toBe(false);
		expect(notifies.length).toBe(1);
		expect(notifies[0]![0]).toBe("swap failed; rollback succeeded");
		expect(notifies[0]![1]).toBe("error");
	});

	test("exit 6 + rollback_succeeded=false: 'rollback FAILED' notify with operator action hint", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async () => ({
					exit: 6,
					envelope: { rolled_back: true, rollback_succeeded: false },
				}),
			}),
		);
		const { ctx, notifies } = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		expect(notifies.length).toBe(1);
		expect(notifies[0]![0]).toMatch(/rollback FAILED/);
		expect(notifies[0]![0]).toMatch(/start_emmy\.sh/);
		expect(notifies[0]![1]).toBe("error");
	});

	test("exit 6 + absent envelope: treated as rollback-failed (safer default)", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async () => ({ exit: 6 }),
			}),
		);
		const { ctx, notifies } = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		expect(notifies.length).toBe(1);
		// Missing envelope is treated as the pessimistic branch (operator must
		// manually revive).
		expect(notifies[0]![0]).toMatch(/rollback FAILED/);
	});

	test("exit 2 (generic failure): 'swap failed (exit 2)' notify", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async () => ({ exit: 2 }),
			}),
		);
		const { ctx, notifies } = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		expect(notifies.length).toBe(1);
		expect(notifies[0]![0]).toMatch(/swap failed \(exit 2\)/);
		expect(notifies[0]![0]).toMatch(/runs\/boot-failures\//);
		expect(notifies[0]![1]).toBe("error");
	});

	test("exit 1 (catch-all): 'swap failed (exit 1)' notify", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async () => ({ exit: 1 }),
			}),
		);
		const { ctx, notifies } = makeCtx();
		await registered[0]!.handler("tgt", ctx);
		expect(notifies[0]![0]).toMatch(/swap failed \(exit 1\)/);
	});

	test("exit 0 clears the progress row via setStatus('emmy.swap', undefined)", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async (a) => {
					a.onProgress("stopping vLLM");
					return { exit: 0 };
				},
			}),
		);
		const { ctx, setStatuses } = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		// There should be at least one clear call where text=undefined.
		const clears = setStatuses.filter(
			([k, v]) => k === "emmy.swap" && v === undefined,
		);
		expect(clears.length).toBeGreaterThanOrEqual(1);
	});

	test("non-zero exit also clears the progress row (no lingering 90% pct after failure)", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(
			pi as never,
			makeOpts({
				runSwap: async (a) => {
					a.onProgress("loading weights", 90);
					return { exit: 5 };
				},
			}),
		);
		const { ctx, setStatuses } = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		const clears = setStatuses.filter(
			([k, v]) => k === "emmy.swap" && v === undefined,
		);
		expect(clears.length).toBeGreaterThanOrEqual(1);
	});
});
