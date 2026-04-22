// packages/emmy-ux/test/runtime-tui.test.ts
//
// Plan 03-08 Task 1 (RED) — unit test for buildRealPiRuntimeTui.
//
// This test mocks pi 0.68's `createAgentSessionRuntime` + `InteractiveMode`
// (top-level exports verified in dist/index.d.ts lines 15+22) and asserts that
// `createEmmySession({mode: "tui", ...})` returns a runtime whose `runTui()`:
//
//   1. exists as a function (NOT undefined — today's bail at pi-emmy.ts:337).
//   2. constructs pi's AgentSessionRuntime via createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager}).
//   3. the `factory` argument passes emmy's customTools + emmyExtension +
//      authStorage + modelRegistry to createAgentSessionServices +
//      createAgentSessionFromServices — IDENTICAL resource-loader args as the
//      current --print path (session.ts:236-247).
//   4. constructs `new InteractiveMode(agentSessionRuntime, {verbose: false})`.
//   5. awaits `interactiveMode.run()` — resolves when pi's TUI loop exits.
//
// RED expectation at commit time: `buildRealPiRuntimeTui` doesn't exist yet;
// createEmmySession({mode: "tui", ...}) currently calls buildRealPiRuntime which
// returns a PiRuntime with runTui=undefined. Test fails because runtime.runTui
// is not a function.
//
// Mock scope discipline (Plan 03-02 Pattern F hazard avoidance): we mock
// @mariozechner/pi-coding-agent's createAgentSessionRuntime + InteractiveMode
// at the module level. To avoid process-global mock pollution of OTHER tests
// in the same bun test process, the mock is constrained to this test file's
// describe block with explicit afterEach resets, and we do NOT mock the
// emitEvent / @emmy/telemetry surfaces that session.mcp-poison / session.boot
// share.

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Record constructor calls to InteractiveMode + createAgentSessionRuntime.
interface InteractiveModeCall {
	runtimeArg: unknown;
	optionsArg: unknown;
	runCalled: boolean;
	runResolver?: () => void;
}
interface RuntimeCall {
	createRuntimeFactory: unknown;
	options: {
		cwd: string;
		agentDir: string;
		sessionManager: unknown;
		sessionStartEvent?: unknown;
	};
	factoryInvocationResult?: unknown;
}

const interactiveCalls: InteractiveModeCall[] = [];
const runtimeCalls: RuntimeCall[] = [];
const servicesCalls: Array<{ args: unknown }> = [];
const agentSessionFromServicesCalls: Array<{ args: unknown }> = [];

// Minimal stub objects that pi's runtime methods return. The real types carry
// enormous surface area; the adapter only uses `session`, `services`,
// `diagnostics`, and the `dispose` lifecycle — all testable as no-ops.
function makeStubSession(): unknown {
	const subscribers: Array<(event: unknown) => void> = [];
	return {
		subscribe: (h: (event: unknown) => void) => {
			subscribers.push(h);
			return () => {
				const i = subscribers.indexOf(h);
				if (i >= 0) subscribers.splice(i, 1);
			};
		},
		emit: (event: unknown) => {
			for (const s of subscribers) s(event);
		},
		prompt: async () => undefined,
	};
}

function makeStubServices(): unknown {
	return { diagnostics: [] };
}

// Mock pi-coding-agent module-wide. This mock must be registered BEFORE the
// first `import` that reaches createEmmySession (which transitively imports
// from @mariozechner/pi-coding-agent via session.ts). Bun evaluates mock.module
// BEFORE subsequent import statements in the same file.
mock.module("@mariozechner/pi-coding-agent", () => {
	class InteractiveModeMock {
		constructor(runtimeArg: unknown, optionsArg?: unknown) {
			interactiveCalls.push({
				runtimeArg,
				optionsArg,
				runCalled: false,
			});
		}
		async init(): Promise<void> {}
		async run(): Promise<void> {
			const call = interactiveCalls[interactiveCalls.length - 1]!;
			call.runCalled = true;
			// Resolve immediately — "user quits" simulation.
			return Promise.resolve();
		}
		stop(): void {}
		clearEditor(): void {}
		showError(_: string): void {}
		showWarning(_: string): void {}
	}

	async function createAgentSessionRuntime(
		factory: unknown,
		options: {
			cwd: string;
			agentDir: string;
			sessionManager: unknown;
			sessionStartEvent?: unknown;
		},
	): Promise<unknown> {
		// Invoke the factory with the same shape pi's runtime would pass.
		const result = await (factory as (o: typeof options) => Promise<unknown>)({
			cwd: options.cwd,
			agentDir: options.agentDir,
			sessionManager: options.sessionManager,
			...(options.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}),
		});
		runtimeCalls.push({
			createRuntimeFactory: factory,
			options,
			factoryInvocationResult: result,
		});
		// Return an AgentSessionRuntime-shaped stub exposing `session` + `services`.
		const r = result as { session?: unknown; services?: unknown };
		return {
			session: r.session ?? makeStubSession(),
			services: r.services ?? makeStubServices(),
			diagnostics: [],
			get cwd() {
				return options.cwd;
			},
			dispose: async () => undefined,
		};
	}

	async function createAgentSessionServices(args: unknown): Promise<unknown> {
		servicesCalls.push({ args });
		return { diagnostics: [] };
	}

	async function createAgentSessionFromServices(args: unknown): Promise<unknown> {
		agentSessionFromServicesCalls.push({ args });
		return { session: makeStubSession() };
	}

	class AuthStorageStub {
		static inMemory(_backend: Record<string, unknown>): unknown {
			return {};
		}
	}
	class ModelRegistryStub {
		static inMemory(_authStorage: unknown): unknown {
			const providers: Record<string, { models: Array<{ id: string; name?: string }> }> = {};
			return {
				registerProvider: (name: string, config: unknown) => {
					providers[name] = config as { models: Array<{ id: string; name?: string }> };
				},
				find: (providerName: string, modelId: string) => {
					const p = providers[providerName];
					if (!p) return undefined;
					return p.models.find((m) => m.id === modelId);
				},
			};
		}
	}
	class SessionManagerStub {
		static inMemory(_cwd: string): unknown {
			return { kind: "in-memory-stub" };
		}
	}

	return {
		AuthStorage: AuthStorageStub,
		ModelRegistry: ModelRegistryStub,
		SessionManager: SessionManagerStub,
		createAgentSessionRuntime,
		createAgentSessionServices,
		createAgentSessionFromServices,
		InteractiveMode: InteractiveModeMock,
	};
});

// Import AFTER the mock is registered.
import { createEmmySession } from "../src/session";
import type { ProfileSnapshot } from "@emmy/provider";
import { NATIVE_TOOL_NAMES } from "@emmy/tools";

function makeProfile(path: string): ProfileSnapshot {
	return {
		ref: { id: "qwen3.6-35b-a3b", version: "v3", hash: "sha256:2beb99c7mock", path },
		serving: {
			engine: { served_model_name: "qwen3-coder-35b-a3b-instruct-fp8", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.2, top_p: 0.95, max_tokens: 8192, stop: [] },
			quirks: { strip_thinking_tags: false, promote_reasoning_to_content: false, buffer_tool_streams: false },
		},
		harness: {
			tools: { format: "openai", grammar: null, per_tool_sampling: {} },
			agent_loop: { retry_on_unparseable_tool_call: 2 },
		},
	};
}

// SP_OK mock server (shared pattern from session.boot.test.ts).
let mockServer: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";
beforeAll(() => {
	mockServer = Bun.serve({
		port: 0,
		fetch: async (r: Request) => {
			const u = new URL(r.url);
			if (u.pathname.endsWith("/v1/chat/completions")) {
				return new Response(
					JSON.stringify({
						choices: [
							{ message: { role: "assistant", content: "[SP_OK]" }, finish_reason: "stop" },
						],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return new Response("{}", { headers: { "content-type": "application/json" } });
		},
	});
	baseUrl = `http://127.0.0.1:${mockServer!.port}`;
});
afterAll(() => {
	try {
		mockServer?.stop(true);
	} catch {
		/* ignore */
	}
});

let tmp: string;
let profilePath: string;
let cwd: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-rt-tui-"));
	profilePath = join(tmp, "profile");
	cwd = join(tmp, "proj");
	mkdirSync(profilePath, { recursive: true });
	mkdirSync(join(profilePath, "prompts"), { recursive: true });
	writeFileSync(
		join(profilePath, "prompts", "system.md"),
		"You are Emmy.\n",
		"utf8",
	);
	mkdirSync(cwd, { recursive: true });
	interactiveCalls.length = 0;
	runtimeCalls.length = 0;
	servicesCalls.length = 0;
	agentSessionFromServicesCalls.length = 0;
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("buildRealPiRuntimeTui — runtime.runTui wired via createAgentSessionRuntime + InteractiveMode", () => {
	test("runtime.runTui is a function (NOT undefined — today's TUI unavailable bail is removed)", async () => {
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		expect(typeof out.runtime.runTui).toBe("function");
	});

	test("runtime.runTui() constructs AgentSessionRuntime via createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})", async () => {
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		await out.runtime.runTui!();
		expect(runtimeCalls.length).toBe(1);
		const call = runtimeCalls[0]!;
		expect(call.options.cwd).toBe(cwd);
		expect(typeof call.options.agentDir).toBe("string");
		expect(call.options.agentDir.length).toBeGreaterThan(0);
		// T-03-08-06: agentDir should be under emmy's scope, NOT pi's (~/.pi/agent).
		expect(call.options.agentDir).toContain(".emmy");
		expect(call.options.sessionManager).toBeDefined();
		// factory is callable.
		expect(typeof call.createRuntimeFactory).toBe("function");
	});

	test("the factory passes customTools + emmyExtension + authStorage + modelRegistry to createAgentSessionServices + createAgentSessionFromServices (same args as --print path)", async () => {
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		await out.runtime.runTui!();
		expect(servicesCalls.length).toBe(1);
		const svc = servicesCalls[0]!.args as {
			cwd: string;
			authStorage: unknown;
			modelRegistry: unknown;
			resourceLoaderOptions: {
				extensionFactories: unknown[];
				noExtensions: boolean;
			};
		};
		expect(svc.cwd).toBe(cwd);
		expect(svc.authStorage).toBeDefined();
		expect(svc.modelRegistry).toBeDefined();
		expect(Array.isArray(svc.resourceLoaderOptions.extensionFactories)).toBe(true);
		expect(svc.resourceLoaderOptions.extensionFactories.length).toBe(1);
		expect(typeof svc.resourceLoaderOptions.extensionFactories[0]).toBe("function");
		expect(svc.resourceLoaderOptions.noExtensions).toBe(false);

		expect(agentSessionFromServicesCalls.length).toBe(1);
		const created = agentSessionFromServicesCalls[0]!.args as {
			services: unknown;
			sessionManager: unknown;
			model: unknown;
			customTools: Array<{ name: string }>;
		};
		expect(created.sessionManager).toBeDefined();
		expect(created.model).toBeDefined();
		expect(Array.isArray(created.customTools)).toBe(true);
		// 8 native tools at minimum (no MCP config in this fixture).
		const toolNames = created.customTools.map((t) => t.name).sort();
		const expected = [...NATIVE_TOOL_NAMES].sort();
		expect(toolNames).toEqual(expected);
	});

	test("runtime.runTui() constructs new InteractiveMode(runtime, {verbose: false}) and awaits .run()", async () => {
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		await out.runtime.runTui!();
		expect(interactiveCalls.length).toBe(1);
		const call = interactiveCalls[0]!;
		expect(call.runtimeArg).toBeDefined();
		// The runtime arg is the AgentSessionRuntime stub (has `session` + `services`).
		expect((call.runtimeArg as { session?: unknown }).session).toBeDefined();
		// verbose: false preserves emmy's own stderr boot banner.
		expect(call.optionsArg).toMatchObject({ verbose: false });
		// run() was called.
		expect(call.runCalled).toBe(true);
	});

	test("runtime.runTui() resolves only after InteractiveMode.run() resolves (user quit)", async () => {
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		// Mock's run() resolves immediately; we assert the promise chain resolves
		// (vs. a hung promise or an unhandled rejection).
		const promise = out.runtime.runTui!();
		expect(promise).toBeInstanceOf(Promise);
		await expect(promise).resolves.toBeUndefined();
	});

	test("--print path is NOT rewired through createAgentSessionRuntime (only TUI path uses it)", async () => {
		// Use mode: "print" — the existing buildRealPiRuntime path (Plan 03-07
		// certified). Task 2's diff keeps --print via createAgentSessionFromServices
		// directly — createAgentSessionRuntime MUST NOT be called in this path.
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "print",
			userPrompt: "ping",
			sessionId: "S-p3-08:2",
			telemetryEnabled: true,
		});
		// runTui may be undefined OR defined on the --print path (both acceptable);
		// the essential contract: createAgentSessionRuntime was NOT invoked.
		expect(runtimeCalls.length).toBe(0);
		expect(interactiveCalls.length).toBe(0);
		// runPrint is the --print path's primary surface.
		expect(typeof out.runtime.runPrint).toBe("function");
	});
});
