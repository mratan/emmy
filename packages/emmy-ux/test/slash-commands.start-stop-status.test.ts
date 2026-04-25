// packages/emmy-ux/test/slash-commands.start-stop-status.test.ts
//
// Plan 04.2-04 Task 1 — Bun unit tests for the 3 new sidecar control
// slash commands and the renderSidecarStatus pure function.
//
// Strategy: build a fake `pi: ExtensionAPI` that captures registered
// commands by name. Drive the handlers with fake CmdCtx objects.
// Assert handler behavior covers:
//   /start arg parsing (id, id@variant, empty, idle gate, exit code routing,
//          onProgress relay)
//   /stop confirm gating + drain progress relay + exit code routing
//   /status getStatus invocation, error handling, render via ctx.ui.notify
//   renderSidecarStatus pure-function field omission and percentage formatting

import { describe, expect, test } from "bun:test";
import type { SidecarStatus } from "../src/sidecar-status-client";

// Helper to build a fake pi.registerCommand spy.
type RegisteredCommand = {
	name: string;
	options: {
		description?: string;
		handler: (args: string, ctx: unknown) => Promise<void>;
	};
};

function makeFakePi(): {
	pi: never;
	registered: RegisteredCommand[];
} {
	const registered: RegisteredCommand[] = [];
	const pi = {
		registerCommand: (
			name: string,
			options: {
				description?: string;
				handler: (args: string, ctx: unknown) => Promise<void>;
			},
		) => {
			registered.push({ name, options });
		},
	};
	return { pi: pi as never, registered };
}

// Helper for the /start and /stop SidecarCmdCtx (isIdle + ui).
function makeSidecarCtx(opts?: { isIdle?: boolean; confirm?: boolean }): {
	ctx: unknown;
	notifyCalls: Array<[string, string | undefined]>;
	statusCalls: Array<[string, string | undefined]>;
	confirmCalls: Array<[string, string]>;
} {
	const notifyCalls: Array<[string, string | undefined]> = [];
	const statusCalls: Array<[string, string | undefined]> = [];
	const confirmCalls: Array<[string, string]> = [];
	const ctx = {
		isIdle: () => opts?.isIdle ?? true,
		ui: {
			confirm: async (title: string, message: string) => {
				confirmCalls.push([title, message]);
				return opts?.confirm ?? true;
			},
			notify: (msg: string, type?: "info" | "warning" | "error") => {
				notifyCalls.push([type ?? "info", msg]);
			},
			setStatus: (key: string, text: string | undefined) => {
				statusCalls.push([key, text]);
			},
		},
	};
	return { ctx, notifyCalls, statusCalls, confirmCalls };
}

// ============================================================================
// renderSidecarStatus — pure function tests
// ============================================================================

describe("renderSidecarStatus (pure)", () => {
	test("renders ready state with all fields", async () => {
		const { renderSidecarStatus } = await import("../src/slash-commands");
		const status: SidecarStatus = {
			state: "ready",
			profile_id: "qwen3.6-35b-a3b",
			profile_variant: "v3.1-default",
			profile_hash: "a".repeat(64),
			vllm_up: true,
			vllm_pid: 12345,
			container_digest: "sha256:0123",
			kv_used_pct: 0.34,
			gpu_temp_c: 64.2,
			in_flight: 2,
			last_error: null,
		};
		const text = renderSidecarStatus(status);
		expect(text).toContain("state=ready");
		expect(text).toContain("vllm=qwen3.6-35b-a3b@v3.1-default");
		expect(text).toContain("kv=34%");
		expect(text).toContain("temp=64");
		expect(text).toContain("in_flight=2");
		expect(text.startsWith("sidecar:")).toBe(true);
	});

	test("omits null fields from stopped status", async () => {
		const { renderSidecarStatus } = await import("../src/slash-commands");
		const status: SidecarStatus = {
			state: "stopped",
			profile_id: null,
			profile_variant: null,
			profile_hash: null,
			vllm_up: false,
			vllm_pid: null,
			container_digest: null,
			kv_used_pct: null,
			gpu_temp_c: null,
			in_flight: null,
			last_error: null,
		};
		const text = renderSidecarStatus(status);
		expect(text).toContain("state=stopped");
		expect(text).not.toContain("vllm=");
		expect(text).not.toContain("kv=");
		expect(text).not.toContain("temp=");
		expect(text).not.toContain("in_flight=");
	});

	test("formats kv_used_pct=0.34 → kv=34%", async () => {
		const { renderSidecarStatus } = await import("../src/slash-commands");
		const status: SidecarStatus = {
			state: "ready",
			profile_id: null,
			profile_variant: null,
			profile_hash: null,
			vllm_up: true,
			vllm_pid: null,
			container_digest: null,
			kv_used_pct: 0.34,
			gpu_temp_c: null,
			in_flight: null,
			last_error: null,
		};
		const text = renderSidecarStatus(status);
		expect(text).toContain("kv=34%");
	});

	test("includes vllm=up when vllm_up=true but no profile_id", async () => {
		const { renderSidecarStatus } = await import("../src/slash-commands");
		const status: SidecarStatus = {
			state: "starting",
			profile_id: null,
			profile_variant: null,
			profile_hash: null,
			vllm_up: true,
			vllm_pid: null,
			container_digest: null,
			kv_used_pct: null,
			gpu_temp_c: null,
			in_flight: null,
			last_error: null,
		};
		const text = renderSidecarStatus(status);
		expect(text).toContain("vllm=up");
	});

	test("renders last_error truncated to 40 chars (T-04.2-S2 mitigation)", async () => {
		const { renderSidecarStatus } = await import("../src/slash-commands");
		const longMsg = "x".repeat(200);
		const status: SidecarStatus = {
			state: "error",
			profile_id: null,
			profile_variant: null,
			profile_hash: null,
			vllm_up: false,
			vllm_pid: null,
			container_digest: null,
			kv_used_pct: null,
			gpu_temp_c: null,
			in_flight: null,
			last_error: { ts: "2026-04-25T00:00:00Z", msg: longMsg },
		};
		const text = renderSidecarStatus(status);
		// Should NOT contain the full 200 chars (sliced to 40).
		expect(text).toContain("error=");
		// Find the error= portion and assert its length is bounded.
		const errIdx = text.indexOf("error=");
		const errSegment = text.slice(errIdx + "error=".length);
		expect(errSegment.length).toBeLessThanOrEqual(40);
	});
});

// ============================================================================
// registerStartCommand
// ============================================================================

describe("registerStartCommand", () => {
	test("parses '<id>' (no @) → profile_id=id, variant=undefined", async () => {
		const { registerStartCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		const calls: Array<{ profile_id: string; variant?: string }> = [];
		registerStartCommand(pi, {
			runStart: async ({ profile_id, variant }) => {
				calls.push({ profile_id, variant });
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "start");
		expect(cmd).toBeDefined();
		const { ctx } = makeSidecarCtx();
		await cmd!.options.handler("qwen3.6-35b-a3b", ctx);
		expect(calls.length).toBe(1);
		expect(calls[0]).toEqual({ profile_id: "qwen3.6-35b-a3b", variant: undefined });
	});

	test("parses '<id>@<variant>' → profile_id=id, variant=variant", async () => {
		const { registerStartCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		const calls: Array<{ profile_id: string; variant?: string }> = [];
		registerStartCommand(pi, {
			runStart: async ({ profile_id, variant }) => {
				calls.push({ profile_id, variant });
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "start")!;
		const { ctx } = makeSidecarCtx();
		await cmd.options.handler("qwen3.6-35b-a3b@v3.1-default", ctx);
		expect(calls[0]).toEqual({
			profile_id: "qwen3.6-35b-a3b",
			variant: "v3.1-default",
		});
	});

	test("empty args → notify('usage', 'error'), runStart NOT called", async () => {
		const { registerStartCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		let runStartCalled = false;
		registerStartCommand(pi, {
			runStart: async () => {
				runStartCalled = true;
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "start")!;
		const { ctx, notifyCalls } = makeSidecarCtx();
		await cmd.options.handler("", ctx);
		expect(runStartCalled).toBe(false);
		expect(notifyCalls.some(([t, m]) => t === "error" && /usage/.test(m ?? ""))).toBe(true);
	});

	test("isIdle()===false → notify('deferred', 'warning'), runStart NOT called", async () => {
		const { registerStartCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		let runStartCalled = false;
		registerStartCommand(pi, {
			runStart: async () => {
				runStartCalled = true;
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "start")!;
		const { ctx, notifyCalls } = makeSidecarCtx({ isIdle: false });
		await cmd.options.handler("qwen3.6-35b-a3b", ctx);
		expect(runStartCalled).toBe(false);
		expect(notifyCalls.some(([t, m]) => t === "warning" && /deferred/.test(m ?? ""))).toBe(true);
	});

	test("exit=0 → notify('started ...', 'info') + clears emmy.swap status", async () => {
		const { registerStartCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStartCommand(pi, {
			runStart: async () => ({ exit: 0 }),
		});
		const cmd = registered.find((r) => r.name === "start")!;
		const { ctx, notifyCalls, statusCalls } = makeSidecarCtx();
		await cmd.options.handler("qwen3.6-35b-a3b@v3.1-default", ctx);
		expect(notifyCalls.some(([t, m]) =>
			t === "info" && /started qwen3\.6-35b-a3b@v3\.1-default/.test(m ?? ""),
		)).toBe(true);
		// Final clear of emmy.swap status (undefined value).
		expect(statusCalls.some(([k, t]) => k === "emmy.swap" && t === undefined)).toBe(true);
	});

	test("exit≠0 → notify('start failed', 'error')", async () => {
		const { registerStartCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStartCommand(pi, {
			runStart: async () => ({ exit: 1 }),
		});
		const cmd = registered.find((r) => r.name === "start")!;
		const { ctx, notifyCalls } = makeSidecarCtx();
		await cmd.options.handler("qwen3.6-35b-a3b", ctx);
		expect(notifyCalls.some(([t, m]) =>
			t === "error" && /start failed.*exit 1/.test(m ?? ""),
		)).toBe(true);
	});

	test("onProgress relays to ctx.ui.setStatus('emmy.swap', renderProgress(phase, pct))", async () => {
		const { registerStartCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStartCommand(pi, {
			runStart: async ({ onProgress }) => {
				onProgress("loading weights", 50);
				onProgress("ready");
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "start")!;
		const { ctx, statusCalls } = makeSidecarCtx();
		await cmd.options.handler("x", ctx);
		// Should have at least: 2 progress updates + 1 final clear.
		const swapStatuses = statusCalls.filter(([k]) => k === "emmy.swap");
		expect(swapStatuses.length).toBeGreaterThanOrEqual(3);
		// Inspect mid stream values — should reference phase + percent.
		const loadingMsg = swapStatuses.find(([_, t]) =>
			(t ?? "").includes("loading weights"),
		);
		expect(loadingMsg).toBeDefined();
		expect(loadingMsg![1]).toContain("50");
		const readyMsg = swapStatuses.find(([_, t]) => (t ?? "").includes("ready"));
		expect(readyMsg).toBeDefined();
	});
});

// ============================================================================
// registerStopCommand
// ============================================================================

describe("registerStopCommand", () => {
	test("confirm declined → runStop NOT called", async () => {
		const { registerStopCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		let runStopCalled = false;
		registerStopCommand(pi, {
			runStop: async () => {
				runStopCalled = true;
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "stop")!;
		const { ctx } = makeSidecarCtx({ confirm: false });
		await cmd.options.handler("", ctx);
		expect(runStopCalled).toBe(false);
	});

	test("confirm accepted + exit=0 → notify('emmy-serve stopped', 'info')", async () => {
		const { registerStopCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStopCommand(pi, {
			runStop: async () => ({ exit: 0 }),
		});
		const cmd = registered.find((r) => r.name === "stop")!;
		const { ctx, notifyCalls, confirmCalls } = makeSidecarCtx({ confirm: true });
		await cmd.options.handler("", ctx);
		expect(confirmCalls.length).toBe(1);
		expect(notifyCalls.some(([t, m]) => t === "info" && /stopped/.test(m ?? ""))).toBe(true);
	});

	test("isIdle()===false → notify('deferred', 'warning'), no confirm", async () => {
		const { registerStopCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		let runStopCalled = false;
		registerStopCommand(pi, {
			runStop: async () => {
				runStopCalled = true;
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "stop")!;
		const { ctx, notifyCalls, confirmCalls } = makeSidecarCtx({ isIdle: false });
		await cmd.options.handler("", ctx);
		expect(runStopCalled).toBe(false);
		expect(confirmCalls.length).toBe(0);
		expect(notifyCalls.some(([t, m]) => t === "warning" && /deferred/.test(m ?? ""))).toBe(true);
	});

	test("draining progress relays to setStatus + final clear", async () => {
		const { registerStopCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStopCommand(pi, {
			runStop: async ({ onProgress }) => {
				onProgress("draining");
				return { exit: 0 };
			},
		});
		const cmd = registered.find((r) => r.name === "stop")!;
		const { ctx, statusCalls } = makeSidecarCtx({ confirm: true });
		await cmd.options.handler("", ctx);
		const swapStatuses = statusCalls.filter(([k]) => k === "emmy.swap");
		expect(swapStatuses.some(([_, t]) => (t ?? "").includes("draining"))).toBe(true);
		// Final clear.
		expect(swapStatuses.some(([_, t]) => t === undefined)).toBe(true);
	});

	test("exit≠0 → notify('stop failed', 'error')", async () => {
		const { registerStopCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStopCommand(pi, {
			runStop: async () => ({ exit: 1 }),
		});
		const cmd = registered.find((r) => r.name === "stop")!;
		const { ctx, notifyCalls } = makeSidecarCtx({ confirm: true });
		await cmd.options.handler("", ctx);
		expect(notifyCalls.some(([t, m]) => t === "error" && /stop failed/.test(m ?? ""))).toBe(true);
	});
});

// ============================================================================
// registerStatusCommand
// ============================================================================

describe("registerStatusCommand", () => {
	test("getStatus returns READY → notify(renderSidecarStatus(...), 'info')", async () => {
		const { registerStatusCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		const status: SidecarStatus = {
			state: "ready",
			profile_id: "qwen3.6-35b-a3b",
			profile_variant: "v3.1-default",
			profile_hash: "a".repeat(64),
			vllm_up: true,
			vllm_pid: 1,
			container_digest: null,
			kv_used_pct: 0.5,
			gpu_temp_c: 70,
			in_flight: 0,
			last_error: null,
		};
		registerStatusCommand(pi, {
			getStatus: async () => status,
		});
		const cmd = registered.find((r) => r.name === "status")!;
		const notifyCalls: Array<[string, string | undefined]> = [];
		const ctx = {
			ui: {
				notify: (msg: string, type?: "info" | "warning" | "error") => {
					notifyCalls.push([type ?? "info", msg]);
				},
			},
		};
		await cmd.options.handler("", ctx);
		expect(notifyCalls.length).toBe(1);
		expect(notifyCalls[0]![0]).toBe("info");
		expect(notifyCalls[0]![1]).toContain("state=ready");
		expect(notifyCalls[0]![1]).toContain("kv=50%");
	});

	test("getStatus throws → notify('sidecar unreachable', 'error')", async () => {
		const { registerStatusCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStatusCommand(pi, {
			getStatus: async () => {
				throw new Error("ECONNREFUSED 127.0.0.1:8003");
			},
		});
		const cmd = registered.find((r) => r.name === "status")!;
		const notifyCalls: Array<[string, string | undefined]> = [];
		const ctx = {
			ui: {
				notify: (msg: string, type?: "info" | "warning" | "error") => {
					notifyCalls.push([type ?? "info", msg]);
				},
			},
		};
		await cmd.options.handler("", ctx);
		expect(notifyCalls.length).toBe(1);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toContain("sidecar unreachable");
	});

	test("registers a 'status' command with description", async () => {
		const { registerStatusCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerStatusCommand(pi, {
			getStatus: async () => ({
				state: "stopped",
				profile_id: null,
				profile_variant: null,
				profile_hash: null,
				vllm_up: false,
				vllm_pid: null,
				container_digest: null,
				kv_used_pct: null,
				gpu_temp_c: null,
				in_flight: null,
				last_error: null,
			}),
		});
		const cmd = registered.find((r) => r.name === "status");
		expect(cmd).toBeDefined();
		expect(cmd!.options.description).toBeDefined();
		expect(typeof cmd!.options.description).toBe("string");
	});
});
