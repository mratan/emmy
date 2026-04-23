// packages/emmy-ux/test/slash-commands.test.ts
//
// Phase 3.1 Plan 03.1-01 Task 2 — unit tests for /compact and /clear slash
// commands (D-31, D-32).
//
// Pure-unit tests:
//   A. buildCompactInstructions — pure fn, no I/O.
//   B. registerCompactCommand — spies on pi.registerCommand + ctx.compact.
//   C. registerClearCommand — spies verify confirm → abort → waitForIdle →
//      newSession ordering (D-32).
//
// Integration tests (slash-commands.integration.test.ts):
//   D. createEmmyExtension wires both commands end-to-end.
//   E. /clear in non-interactive mode (hasUI=false) does NOT call newSession.

import { describe, expect, test } from "bun:test";

// ----------------------------------------------------------------------------
// Test A — buildCompactInstructions (pure fn)
// ----------------------------------------------------------------------------

describe("buildCompactInstructions", () => {
	test("empty userArgs returns profile prompt verbatim", async () => {
		const { buildCompactInstructions } = await import("../src/slash-commands");
		const profilePrompt = "PROFILE COMPACT: preserve errors + pins + TODO state.";
		expect(buildCompactInstructions(profilePrompt, "")).toBe(profilePrompt);
	});

	test("non-empty userArgs appends as addendum (D-31 addendum semantics)", async () => {
		const { buildCompactInstructions } = await import("../src/slash-commands");
		const profilePrompt = "PROFILE COMPACT.";
		const userArgs = "focus on design decisions, drop file read detail";
		const out = buildCompactInstructions(profilePrompt, userArgs);
		expect(out).toContain(profilePrompt);
		expect(out).toContain(userArgs);
		expect(out).toContain("Additional operator guidance");
		// Addendum order: profile first, then separator, then user.
		expect(out.indexOf(profilePrompt)).toBeLessThan(out.indexOf(userArgs));
	});

	test("missing profile prompt + empty userArgs returns empty string", async () => {
		const { buildCompactInstructions } = await import("../src/slash-commands");
		expect(buildCompactInstructions(null, "")).toBe("");
	});

	test("missing profile prompt + non-empty userArgs returns userArgs only", async () => {
		const { buildCompactInstructions } = await import("../src/slash-commands");
		expect(buildCompactInstructions(null, "tighten the summary")).toBe("tighten the summary");
	});
});

// ----------------------------------------------------------------------------
// Test B — registerCompactCommand
// ----------------------------------------------------------------------------

describe("registerCompactCommand", () => {
	test("registers handler that calls ctx.compact with buildCompactInstructions", async () => {
		const { registerCompactCommand } = await import("../src/slash-commands");

		const registered: Array<{ name: string; options: { handler: (args: string, ctx: unknown) => Promise<void> } }> = [];
		const pi = {
			registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
				registered.push({ name, options });
			},
		};

		registerCompactCommand(pi as never, { compactPromptText: "PROFILE COMPACT TEXT" });

		expect(registered.length).toBe(1);
		expect(registered[0]!.name).toBe("compact");
		const handler = registered[0]!.options.handler;
		expect(typeof handler).toBe("function");

		// Invoke the handler with a fake ctx; assert ctx.compact received the right instructions.
		const compactCalls: Array<{ customInstructions?: string }> = [];
		const statusCalls: Array<[string, string | undefined]> = [];
		const fakeCtx = {
			compact: (options?: { customInstructions?: string }) => {
				compactCalls.push(options ?? {});
			},
			ui: {
				setStatus: (k: string, t: string | undefined) => statusCalls.push([k, t]),
			},
		};

		await handler("", fakeCtx);
		expect(compactCalls.length).toBe(1);
		expect(compactCalls[0]!.customInstructions).toBe("PROFILE COMPACT TEXT");

		await handler("focus on X", fakeCtx);
		expect(compactCalls.length).toBe(2);
		expect(compactCalls[1]!.customInstructions).toContain("PROFILE COMPACT TEXT");
		expect(compactCalls[1]!.customInstructions).toContain("focus on X");

		// Status line must have been set at least once.
		expect(statusCalls.some(([k]) => k === "emmy.last_compaction")).toBe(true);
	});

	test("null compactPromptText + empty args → ctx.compact called with empty string (D-16 fallback into pi's built-in)", async () => {
		const { registerCompactCommand } = await import("../src/slash-commands");
		const registered: Array<{ options: { handler: (args: string, ctx: unknown) => Promise<void> } }> = [];
		const pi = {
			registerCommand: (_name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
				registered.push({ options });
			},
		};
		registerCompactCommand(pi as never, { compactPromptText: null });

		const compactCalls: Array<{ customInstructions?: string }> = [];
		const fakeCtx = {
			compact: (o?: { customInstructions?: string }) => {
				compactCalls.push(o ?? {});
			},
			ui: { setStatus: () => {} },
		};
		await registered[0]!.options.handler("", fakeCtx);
		expect(compactCalls[0]!.customInstructions).toBe("");
	});
});

// ----------------------------------------------------------------------------
// Test C — registerClearCommand (ordering + hasUI gate)
// ----------------------------------------------------------------------------

describe("registerClearCommand", () => {
	test("interactive mode: confirm → abort → waitForIdle → newSession IN ORDER", async () => {
		const { registerClearCommand } = await import("../src/slash-commands");

		const registered: Array<{ options: { handler: (args: string, ctx: unknown) => Promise<void> } }> = [];
		const pi = {
			registerCommand: (_name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
				registered.push({ options });
			},
		};
		registerClearCommand(pi as never);

		expect(registered.length).toBe(1);
		const handler = registered[0]!.options.handler;

		const order: string[] = [];
		const fakeCtx = {
			hasUI: true,
			ui: {
				confirm: async () => {
					order.push("confirm");
					return true;
				},
				notify: () => {
					order.push("notify");
				},
				setStatus: () => {},
			},
			abort: () => order.push("abort"),
			waitForIdle: async () => {
				order.push("waitForIdle");
			},
			newSession: async () => {
				order.push("newSession");
				return { cancelled: false };
			},
		};

		await handler("", fakeCtx);
		expect(order).toEqual(["confirm", "abort", "waitForIdle", "newSession"]);
	});

	test("interactive mode: user declines confirm → newSession NOT called", async () => {
		const { registerClearCommand } = await import("../src/slash-commands");
		const registered: Array<{ options: { handler: (args: string, ctx: unknown) => Promise<void> } }> = [];
		const pi = {
			registerCommand: (_name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
				registered.push({ options });
			},
		};
		registerClearCommand(pi as never);

		let newSessionCalled = false;
		let abortCalled = false;
		const fakeCtx = {
			hasUI: true,
			ui: {
				confirm: async () => false,
				notify: () => {},
				setStatus: () => {},
			},
			abort: () => {
				abortCalled = true;
			},
			waitForIdle: async () => {},
			newSession: async () => {
				newSessionCalled = true;
				return { cancelled: false };
			},
		};
		await registered[0]!.options.handler("", fakeCtx);
		expect(newSessionCalled).toBe(false);
		expect(abortCalled).toBe(false);
	});

	test("non-interactive mode (hasUI=false): ctx.ui.notify hint; newSession NOT called", async () => {
		const { registerClearCommand } = await import("../src/slash-commands");
		const registered: Array<{ options: { handler: (args: string, ctx: unknown) => Promise<void> } }> = [];
		const pi = {
			registerCommand: (_name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
				registered.push({ options });
			},
		};
		registerClearCommand(pi as never);

		let confirmCalled = false;
		let newSessionCalled = false;
		const notifyMessages: string[] = [];
		const fakeCtx = {
			hasUI: false,
			ui: {
				confirm: async () => {
					confirmCalled = true;
					return true;
				},
				notify: (msg: string) => notifyMessages.push(msg),
				setStatus: () => {},
			},
			abort: () => {},
			waitForIdle: async () => {},
			newSession: async () => {
				newSessionCalled = true;
				return { cancelled: false };
			},
		};

		await registered[0]!.options.handler("", fakeCtx);
		expect(confirmCalled).toBe(false);
		expect(newSessionCalled).toBe(false);
		// Notify must include a helpful hint about interactive-only.
		expect(notifyMessages.length).toBeGreaterThan(0);
		expect(notifyMessages[0]).toMatch(/interactive/i);
		expect(notifyMessages[0]).toMatch(/\/clear/);
	});
});
