// Plan 04.4-08 Task 3 — V5 end-to-end test for /compact + /clear.
//
// Implements V5 from COMPACTION-DESIGN.md §8 verbatim.

import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock @emmy/telemetry BEFORE importing slash-commands (the import-time
// capture matters because slash-commands.ts uses module-scope
// `import { emitEvent }`).
const events: Array<{ event: string; [k: string]: unknown }> = [];
mock.module("@emmy/telemetry", () => ({
	emitEvent: (rec: { event: string; [k: string]: unknown }) => {
		events.push(rec);
	},
	configureTelemetry: () => {
		// no-op for tests
	},
}));

import {
	registerClearCommand,
	registerCompactCommand,
} from "../src/slash-commands";

/**
 * V5 scenarios — exported so external eval drivers can re-use them.
 */
export const V5_TEST_SCENARIOS = [
	{
		name: "compact with reason",
		cmd: "compact",
		args: "stuck on auth flow",
		expectedEventName: "emmy.compaction.trigger",
		expectedEventField: "args_preview",
		expectedEventValue: "stuck on auth flow",
	},
	{
		name: "compact without reason",
		cmd: "compact",
		args: "",
		expectedEventName: "emmy.compaction.trigger",
		expectedEventField: "args_preview",
		expectedEventValue: "",
	},
	{
		name: "clear after confirm",
		cmd: "clear",
		args: "",
		expectedEventName: "emmy.session.cleared",
		expectedEventField: "session_id_prior",
	},
];

interface FakeApi {
	registerCommand: (
		name: string,
		def: { handler: (args: string, ctx: unknown) => Promise<void> | void },
	) => void;
	invoke: (name: string, args: string, ctx: unknown) => Promise<void> | void;
}

function fakeExtensionApi(): FakeApi {
	const handlers: Record<
		string,
		(args: string, ctx: unknown) => Promise<void> | void
	> = {};
	return {
		registerCommand: (name, def) => {
			handlers[name] = def.handler;
		},
		invoke: async (name, args, ctx) => handlers[name](args, ctx),
	};
}

const V1_PROMPT_VERBATIM =
	"Summarize the conversation above so a fresh context can resume the work. Preserve: explicit goals, decisions made, errors and their resolutions, files modified and their final state. Drop: dead-end exploration, redundant tool calls, transient state.";

describe("V5 — /compact + /clear end-to-end", () => {
	beforeEach(() => {
		events.length = 0;
	});

	test("/compact passes v1 prompt + Reason addendum to ctx.compact AND emits trigger event", async () => {
		const api = fakeExtensionApi();
		registerCompactCommand(api as never, {
			compactPromptText: V1_PROMPT_VERBATIM,
			getSessionId: () => "S-test-001",
		});
		const compactCalls: Array<{ customInstructions: string }> = [];
		const ctx = {
			compact: (opts: { customInstructions: string }) => {
				compactCalls.push(opts);
			},
			ui: { setStatus: () => undefined },
		};
		await api.invoke("compact", "stuck on auth flow", ctx);

		// Telemetry assertion (event fires BEFORE compact)
		expect(events.length).toBe(1);
		expect(events[0].event).toBe("emmy.compaction.trigger");
		expect(events[0].trigger_kind).toBe("manual");
		expect(events[0].args_preview).toBe("stuck on auth flow");
		expect(events[0].session_id).toBe("S-test-001");

		// customInstructions assertion
		expect(compactCalls.length).toBe(1);
		const ci = compactCalls[0]!.customInstructions;
		expect(ci).toContain("Summarize the conversation above");
		expect(ci).toContain("stuck on auth flow");
	});

	test("/compact with no reason passes v1 prompt verbatim only (no addendum block)", async () => {
		const api = fakeExtensionApi();
		registerCompactCommand(api as never, {
			compactPromptText: V1_PROMPT_VERBATIM,
		});
		const compactCalls: Array<{ customInstructions: string }> = [];
		const ctx = {
			compact: (opts: { customInstructions: string }) => {
				compactCalls.push(opts);
			},
			ui: { setStatus: () => undefined },
		};
		await api.invoke("compact", "", ctx);
		expect(compactCalls[0]!.customInstructions).toBe(V1_PROMPT_VERBATIM);
		expect(events[0].args_preview).toBe("");
	});

	test("/compact with long args truncates preview to 80 chars + ellipsis", async () => {
		const api = fakeExtensionApi();
		registerCompactCommand(api as never, {
			compactPromptText: V1_PROMPT_VERBATIM,
		});
		const longArg = "x".repeat(200);
		await api.invoke("compact", longArg, {
			compact: () => undefined,
			ui: { setStatus: () => undefined },
		});
		const preview = events[0].args_preview as string;
		expect(preview.length).toBe(81); // 80 chars + ellipsis
		expect(preview.endsWith("…")).toBe(true);
	});

	test("/clear emits session.cleared BEFORE abort/waitForIdle/newSession", async () => {
		const api = fakeExtensionApi();
		registerClearCommand(api as never, {
			getPriorSessionId: () => "S-test-001",
		});
		const order: string[] = [];
		const ctx = {
			hasUI: true,
			ui: {
				confirm: async () => {
					order.push("confirm");
					return true;
				},
				notify: () => {
					order.push("notify");
				},
				setStatus: () => undefined,
			},
			abort: () => {
				order.push("abort");
			},
			waitForIdle: async () => {
				order.push("waitForIdle");
			},
			newSession: async () => {
				order.push("newSession");
				return { cancelled: false };
			},
		};
		await api.invoke("clear", "", ctx);

		expect(events[0].event).toBe("emmy.session.cleared");
		expect(events[0].session_id_prior).toBe("S-test-001");
		// Order: confirm → (event emitted) → abort → waitForIdle → newSession
		expect(order).toEqual([
			"confirm",
			"abort",
			"waitForIdle",
			"newSession",
		]);
	});

	test("/clear with hasUI=false notifies error and emits NO event", async () => {
		const api = fakeExtensionApi();
		registerClearCommand(api as never);
		let notified: string | null = null;
		const ctx = {
			hasUI: false,
			ui: {
				notify: (msg: string) => {
					notified = msg;
				},
				confirm: async () => true,
				setStatus: () => undefined,
			},
			abort: () => {
				throw new Error("should not reach");
			},
			waitForIdle: async () => {
				throw new Error("should not reach");
			},
			newSession: async () => {
				throw new Error("should not reach");
			},
		};
		await api.invoke("clear", "", ctx);
		expect(notified).toContain("requires the interactive TUI");
		expect(events.length).toBe(0);
	});

	test("/clear with confirm=false emits NO event and does NOT abort", async () => {
		const api = fakeExtensionApi();
		registerClearCommand(api as never);
		let aborted = false;
		const ctx = {
			hasUI: true,
			ui: {
				confirm: async () => false,
				notify: () => undefined,
				setStatus: () => undefined,
			},
			abort: () => {
				aborted = true;
			},
			waitForIdle: async () => undefined,
			newSession: async () => ({ cancelled: false }),
		};
		await api.invoke("clear", "", ctx);
		expect(aborted).toBe(false);
		expect(events.length).toBe(0);
	});

	test("/clear newSession is called with EMPTY options (no parent carryover)", async () => {
		const api = fakeExtensionApi();
		registerClearCommand(api as never);
		const recorder: Array<unknown> = [];
		const ctx = {
			hasUI: true,
			ui: {
				confirm: async () => true,
				notify: () => undefined,
				setStatus: () => undefined,
			},
			abort: () => undefined,
			waitForIdle: async () => undefined,
			newSession: async (o: unknown) => {
				recorder.push(o);
				return { cancelled: false };
			},
		};
		await api.invoke("clear", "", ctx);
		expect(recorder.length).toBe(1);
		expect(recorder[0]).toEqual({});
	});
});
