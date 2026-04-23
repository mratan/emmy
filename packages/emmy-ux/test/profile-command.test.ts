// packages/emmy-ux/test/profile-command.test.ts
//
// Plan 04-03 Task 2 — unit tests for registerProfileCommand.
//
// Strategy (mirrors test/slash-commands.test.ts):
//   - Capture the handler + getArgumentCompletions off a minimal pi stub.
//   - Drive the captured handler with fake ExtensionCommandContext objects.
//   - Inject opts.runSwap + opts.reloadHarnessProfile as mock callbacks so no
//     real child_process spawn or filesystem work occurs.
//
// Covers D-06 guard + arg parsing + profileIndex.resolve null-handling +
// confirm cancellation + runSwap happy-path + @variant parsing + tab
// completion delegation.

import { describe, expect, test } from "bun:test";

import {
	registerProfileCommand,
	type RegisterProfileCommandOpts,
} from "../src/slash-commands";
import type { ProfileIndex } from "../src/profile-index";
import type { SwapResult } from "../src/profile-swap-runner";

type Handler = (args: string, ctx: unknown) => Promise<void>;
type GetArgCompletions = (prefix: string) =>
	| Awaited<ReturnType<Exclude<Parameters<typeof registerProfileCommand>[0]["registerCommand"], undefined> extends (...a: infer _A) => infer _R ? never : never>>
	| unknown;

interface RegisteredCapture {
	name: string;
	description?: string;
	handler: Handler;
	getArgumentCompletions?: (
		prefix: string,
	) => unknown;
}

function capturePi(): { pi: unknown; registered: RegisteredCapture[] } {
	const registered: RegisteredCapture[] = [];
	const pi = {
		registerCommand: (
			name: string,
			options: {
				description?: string;
				handler: Handler;
				getArgumentCompletions?: (prefix: string) => unknown;
			},
		) => {
			registered.push({
				name,
				description: options.description,
				handler: options.handler,
				getArgumentCompletions: options.getArgumentCompletions,
			});
		},
	};
	return { pi, registered };
}

function makeIndex(
	resolveMap: Record<string, string | null> = {},
	completeMap: Record<string, string[]> = {},
): ProfileIndex {
	return {
		complete: (prefix: string) => completeMap[prefix] ?? [],
		resolve: (name: string, variant?: string) => {
			const key = variant ? `${name}@${variant}` : name;
			return key in resolveMap ? resolveMap[key]! : null;
		},
	};
}

interface CtxSpy {
	isIdle: () => boolean;
	ui: {
		confirm: (title: string, message: string) => Promise<boolean>;
		notify: (msg: string, type?: "info" | "warning" | "error") => void;
		setStatus: (key: string, text: string | undefined) => void;
	};
	notifies: Array<[string, string | undefined]>;
	setStatuses: Array<[string, string | undefined]>;
	confirmCalls: Array<[string, string]>;
}

function makeCtx(opts?: {
	idle?: boolean;
	confirmReturn?: boolean;
}): CtxSpy {
	const notifies: CtxSpy["notifies"] = [];
	const setStatuses: CtxSpy["setStatuses"] = [];
	const confirmCalls: CtxSpy["confirmCalls"] = [];
	return {
		notifies,
		setStatuses,
		confirmCalls,
		isIdle: () => opts?.idle ?? true,
		ui: {
			confirm: async (title, message) => {
				confirmCalls.push([title, message]);
				return opts?.confirmReturn ?? true;
			},
			notify: (msg, type) => notifies.push([msg, type]),
			setStatus: (key, text) => setStatuses.push([key, text]),
		},
	};
}

describe("registerProfileCommand — registration + basic flow", () => {
	test("registers exactly one command named 'profile' with description", () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(pi as never, {
			profileDir: "/tmp/profile",
			port: 8002,
			profileIndex: makeIndex(),
			runSwap: async () => ({ exit: 0 }),
			reloadHarnessProfile: async () => {},
		});
		expect(registered.length).toBe(1);
		expect(registered[0]!.name).toBe("profile");
		expect(registered[0]!.description).toMatch(/Swap to a different profile/);
	});

	test("D-06 guard — handler rejects when ctx.isIdle()=false with verbatim message", async () => {
		const { pi, registered } = capturePi();
		let runSwapCalled = false;
		let reloadCalled = false;
		registerProfileCommand(pi as never, {
			profileDir: "/p",
			port: 8002,
			profileIndex: makeIndex({ "test": "/tgt" }),
			runSwap: async () => {
				runSwapCalled = true;
				return { exit: 0 };
			},
			reloadHarnessProfile: async () => {
				reloadCalled = true;
			},
		});

		const ctx = makeCtx({ idle: false });
		await registered[0]!.handler("test", ctx);

		expect(runSwapCalled).toBe(false);
		expect(reloadCalled).toBe(false);
		// Verbatim D-06 message — must match CONTEXT.md locked text.
		expect(ctx.notifies.length).toBe(1);
		expect(ctx.notifies[0]![0]).toBe(
			"swap deferred — request in flight, finish or Ctrl+C first",
		);
		expect(ctx.notifies[0]![1]).toBe("warning");
	});

	test("empty args → usage notify; runSwap NOT called", async () => {
		const { pi, registered } = capturePi();
		let runSwapCalled = false;
		registerProfileCommand(pi as never, {
			profileDir: "/p",
			port: 8002,
			profileIndex: makeIndex(),
			runSwap: async () => {
				runSwapCalled = true;
				return { exit: 0 };
			},
			reloadHarnessProfile: async () => {},
		});

		const ctx = makeCtx();
		await registered[0]!.handler("   ", ctx);
		expect(runSwapCalled).toBe(false);
		expect(ctx.notifies[0]![0]).toMatch(/usage: \/profile/);
		expect(ctx.notifies[0]![1]).toBe("error");
	});

	test("unknown profile name → 'unknown profile' notify; runSwap NOT called", async () => {
		const { pi, registered } = capturePi();
		let runSwapCalled = false;
		registerProfileCommand(pi as never, {
			profileDir: "/p",
			port: 8002,
			profileIndex: makeIndex({}), // resolve returns null
			runSwap: async () => {
				runSwapCalled = true;
				return { exit: 0 };
			},
			reloadHarnessProfile: async () => {},
		});

		const ctx = makeCtx();
		await registered[0]!.handler("does-not-exist", ctx);
		expect(runSwapCalled).toBe(false);
		expect(ctx.notifies[0]![0]).toMatch(/unknown profile:/);
		expect(ctx.notifies[0]![0]).toMatch(/does-not-exist/);
		expect(ctx.notifies[0]![1]).toBe("error");
	});

	test("user declines ctx.ui.confirm → runSwap NOT called; no error notify", async () => {
		const { pi, registered } = capturePi();
		let runSwapCalled = false;
		let reloadCalled = false;
		registerProfileCommand(pi as never, {
			profileDir: "/p",
			port: 8002,
			profileIndex: makeIndex({ "gemma-4-26b-a4b-it": "/tgt" }),
			runSwap: async () => {
				runSwapCalled = true;
				return { exit: 0 };
			},
			reloadHarnessProfile: async () => {
				reloadCalled = true;
			},
		});

		const ctx = makeCtx({ confirmReturn: false });
		await registered[0]!.handler("gemma-4-26b-a4b-it", ctx);
		expect(ctx.confirmCalls.length).toBe(1);
		expect(runSwapCalled).toBe(false);
		expect(reloadCalled).toBe(false);
		// No error notify on deliberate cancel — silent return is the contract.
		expect(ctx.notifies.length).toBe(0);
	});

	test("happy path (exit 0): runSwap called with correct args; reloadHarnessProfile fires; success notify", async () => {
		const { pi, registered } = capturePi();
		let runSwapCallArgs: unknown = null;
		let reloadArg: string | null = null;
		registerProfileCommand(pi as never, {
			profileDir: "/from/profile",
			port: 8002,
			profileIndex: makeIndex({ "gemma-4-26b-a4b-it": "/to/profile" }),
			runSwap: async (a) => {
				runSwapCallArgs = {
					from: a.from,
					to: a.to,
					port: a.port,
					hasOnProgress: typeof a.onProgress === "function",
				};
				return { exit: 0 };
			},
			reloadHarnessProfile: async (dir) => {
				reloadArg = dir;
			},
		});

		const ctx = makeCtx();
		await registered[0]!.handler("gemma-4-26b-a4b-it", ctx);

		expect(runSwapCallArgs).toEqual({
			from: "/from/profile",
			to: "/to/profile",
			port: 8002,
			hasOnProgress: true,
		});
		expect(reloadArg).toBe("/to/profile");
		// Final notify: "swapped to <args>"
		expect(ctx.notifies.length).toBe(1);
		expect(ctx.notifies[0]![0]).toBe("swapped to gemma-4-26b-a4b-it");
		expect(ctx.notifies[0]![1]).toBe("info");
		// Progress row cleared after reload.
		const clears = ctx.setStatuses.filter(
			([k, v]) => k === "emmy.swap" && v === undefined,
		);
		expect(clears.length).toBeGreaterThanOrEqual(1);
	});

	test("name@variant is parsed and forwarded to profileIndex.resolve(name, variant)", async () => {
		const { pi, registered } = capturePi();
		let resolveArgs: { name?: string; variant?: string } = {};
		const idx: ProfileIndex = {
			complete: () => [],
			resolve: (name, variant) => {
				resolveArgs = { name, variant };
				return "/tgt";
			},
		};
		registerProfileCommand(pi as never, {
			profileDir: "/p",
			port: 8002,
			profileIndex: idx,
			runSwap: async () => ({ exit: 0 }),
			reloadHarnessProfile: async () => {},
		});

		const ctx = makeCtx();
		await registered[0]!.handler("qwen3.6-35b-a3b@v3.1-reason", ctx);
		expect(resolveArgs.name).toBe("qwen3.6-35b-a3b");
		expect(resolveArgs.variant).toBe("v3.1-reason");
	});

	test("getArgumentCompletions delegates to profileIndex.complete → AutocompleteItem[]", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(pi as never, {
			profileDir: "/p",
			port: 8002,
			profileIndex: makeIndex({}, {
				gem: ["gemma-4-26b-a4b-it"],
				"qwen3.6-35b-a3b@v3": [
					"qwen3.6-35b-a3b@v3",
					"qwen3.6-35b-a3b@v3.1",
				],
			}),
			runSwap: async () => ({ exit: 0 }),
			reloadHarnessProfile: async () => {},
		});

		const getAC = registered[0]!.getArgumentCompletions!;

		const gems = (await getAC("gem")) as Array<{ value: string; label: string }>;
		expect(gems).toEqual([
			{ value: "gemma-4-26b-a4b-it", label: "gemma-4-26b-a4b-it" },
		]);

		const variants = (await getAC("qwen3.6-35b-a3b@v3")) as Array<{
			value: string;
			label: string;
		}>;
		expect(variants.length).toBe(2);
		expect(variants.map((v) => v.value)).toEqual([
			"qwen3.6-35b-a3b@v3",
			"qwen3.6-35b-a3b@v3.1",
		]);

		// Empty results → null (pi contract).
		const none = await getAC("nope");
		expect(none).toBeNull();
	});

	test("onProgress callback threads phase events through ctx.ui.setStatus with 'emmy.swap' key", async () => {
		const { pi, registered } = capturePi();
		registerProfileCommand(pi as never, {
			profileDir: "/p",
			port: 8002,
			profileIndex: makeIndex({ "tgt": "/tgt" }),
			runSwap: async (a) => {
				// Simulate the orchestrator firing all four D-02 phases.
				a.onProgress("stopping vLLM");
				a.onProgress("loading weights", 0);
				a.onProgress("loading weights", 90);
				a.onProgress("warmup");
				a.onProgress("ready");
				return { exit: 0 };
			},
			reloadHarnessProfile: async () => {},
		});

		const ctx = makeCtx();
		await registered[0]!.handler("tgt", ctx);

		// Every progress event maps to a setStatus("emmy.swap", <non-undefined>).
		const progressCalls = ctx.setStatuses.filter(
			([k, v]) => k === "emmy.swap" && typeof v === "string",
		);
		expect(progressCalls.length).toBe(5);
		expect(progressCalls[0]![1]).toMatch(/stopping vLLM/);
		expect(progressCalls[1]![1]).toMatch(/loading weights.*0%/);
		expect(progressCalls[2]![1]).toMatch(/loading weights.*90%/);
		expect(progressCalls[3]![1]).toMatch(/warmup/);
		expect(progressCalls[4]![1]).toMatch(/ready/);
	});
});
