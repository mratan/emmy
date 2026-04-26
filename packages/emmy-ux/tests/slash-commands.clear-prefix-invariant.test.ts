// Plan 04.4-08 Task 2 — focused tests for /clear's emmy.session.cleared emission +
// newSession({}) invariant. Prefix-hash purity is owned by plan 04.4-06's
// prefix-hash.test.ts (Tests 9-11) — this file owns the lifecycle-side guarantee.

import { beforeEach, describe, expect, mock, test } from "bun:test";

const events: Array<{ event: string; [k: string]: unknown }> = [];
mock.module("@emmy/telemetry", () => ({
	emitEvent: (rec: { event: string; [k: string]: unknown }) => {
		events.push(rec);
	},
	configureTelemetry: () => undefined,
}));

import { registerClearCommand } from "../src/slash-commands";

interface FakeApi {
	registerCommand: (
		name: string,
		def: { handler: (args: string, ctx: unknown) => Promise<void> | void },
	) => void;
	invoke: (name: string, args: string, ctx: unknown) => Promise<void> | void;
}

function fakeApi(): FakeApi {
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

describe("/clear emits emmy.session.cleared (Plan 04.4-08 Task 2)", () => {
	beforeEach(() => {
		events.length = 0;
	});

	test("hasUI=false → notify error, NO event emitted", async () => {
		const api = fakeApi();
		registerClearCommand(api as never);
		const ctx = {
			hasUI: false,
			ui: { notify: () => undefined, confirm: async () => true },
			abort: () => undefined,
			waitForIdle: async () => undefined,
			newSession: async () => ({ cancelled: false }),
		};
		await api.invoke("clear", "", ctx);
		expect(events.length).toBe(0);
	});

	test("user cancels confirm → NO event emitted", async () => {
		const api = fakeApi();
		registerClearCommand(api as never);
		const ctx = {
			hasUI: true,
			ui: {
				confirm: async () => false,
				notify: () => undefined,
				setStatus: () => undefined,
			},
			abort: () => undefined,
			waitForIdle: async () => undefined,
			newSession: async () => ({ cancelled: false }),
		};
		await api.invoke("clear", "", ctx);
		expect(events.length).toBe(0);
	});

	test("confirm=true → emits cleared event with session_id_prior BEFORE abort", async () => {
		const api = fakeApi();
		registerClearCommand(api as never, {
			getPriorSessionId: () => "SESS-PRIOR",
		});
		let aborted = false;
		const ctx = {
			hasUI: true,
			ui: {
				confirm: async () => true,
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
		expect(events.length).toBe(1);
		expect(events[0].event).toBe("emmy.session.cleared");
		expect(events[0].session_id_prior).toBe("SESS-PRIOR");
		expect(aborted).toBe(true);
	});

	test("Order: confirm → emit → abort → waitForIdle → newSession", async () => {
		const api = fakeApi();
		registerClearCommand(api as never);
		const order: string[] = [];
		const ctx = {
			hasUI: true,
			ui: {
				confirm: async () => {
					order.push("confirm");
					return true;
				},
				notify: () => order.push("notify"),
				setStatus: () => undefined,
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
		await api.invoke("clear", "", ctx);
		expect(order).toEqual([
			"confirm",
			"abort",
			"waitForIdle",
			"newSession",
		]);
	});

	test("newSession is called with EMPTY options object (no parent carryover)", async () => {
		const api = fakeApi();
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
