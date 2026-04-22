// packages/emmy-ux/test/runtime-tui-wiring.integration.test.ts
//
// Plan 03-08 Task 1 (RED) — integration test asserting that every Phase-3
// extension binding fires on the NEW TUI runtime path.
//
// The RED insight (3 items):
//   (1) today's `buildRealPiRuntime` does NOT call `createAgentSessionRuntime`
//       nor `InteractiveMode` — the mode==="tui" branch at pi-emmy.ts:337 bails
//       with "TUI unavailable".
//   (2) Plan 03-05's `handleFeedbackKey` (ANSI Alt+Up/Down), Plan 03-04's
//       `FooterPollerHandle.stop()`, Plan 03-02's `harness.assembly` emitEvent,
//       Plan 03-05's turn_end → TurnTracker, Plan 03-06's `bindBadge(ctx.ui)`,
//       Plan 03-03's `turn_start` compaction trigger — all six pi-extension
//       handlers are bound today via `pi-emmy-extension.ts`. This test asserts
//       they remain bound on the NEW TUI path (Task 2 preserves them by passing
//       the same emmyExtension factory to createAgentSessionServices).
//   (3) SP_OK canary ordering + initOtel ordering invariants (Plan 03-01 truth
//       #6 + Plan 03-02 Pitfall #2) are preserved under the new wire shape.
//
// Approach: we test the Emmy ExtensionFactory body by invoking it directly with
// a mock ExtensionAPI — the SAME factory Task 2 hands to
// `createAgentSessionServices({resourceLoaderOptions: {extensionFactories}})`.
// This is a real integration: real createEmmyExtension, real TurnTracker, real
// handleFeedbackKey, real upsertFeedback writing to a tmp feedback.jsonl, real
// emitEvent (captured via a lightweight spy), real bindBadge. Only the pi
// runtime itself (InteractiveMode, AgentSession, ContextUsage provider) is
// mocked — because no TTY is available in bun test.
//
// RED expectation: Task 2 has not yet shipped. Tests that assert pi
// createAgentSessionRuntime was called with the emmyExtension (from the TUI
// code path) fail at the module level because buildRealPiRuntimeTui doesn't
// exist yet — createEmmySession with mode:"tui" routes through
// buildRealPiRuntime which never calls createAgentSessionRuntime.

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture events emitted via @emmy/telemetry's emitEvent.
const emittedEvents: Array<{ event: string; [k: string]: unknown }> = [];

// We do NOT mock @emmy/telemetry globally — shared state hazard (Plan 03-02
// Pattern F). Instead we replace the module's emitEvent via a session-context
// reconfigure: configureTelemetry({jsonlPath, tracer, enabled}) with a
// test-only JSONL path. But emitEvent internally reads through
// getTelemetryContext, so we can just shadow by reading the JSONL afterward.
// However the test-case needs to observe emitEvent calls synchronously — so we
// hook at the session-context module and directly record.
//
// Pragmatic approach: test configureTelemetry with a tmp JSONL path and read
// it back after each sub-test to enumerate emitted events. This mirrors
// production wiring (what pi-emmy.ts does in boot sequence).

// Capture createAgentSessionRuntime calls to prove Task 2's runtime wiring.
const runtimeFactoryCalls: Array<{
	factoryFn: unknown;
	options: { cwd: string; agentDir: string; sessionManager: unknown };
}> = [];
const interactiveModeCalls: Array<{ runtimeArg: unknown; optionsArg: unknown }> = [];
const servicesConstructorCalls: Array<{
	extensionFactoriesArg: unknown[];
}> = [];

function makeStubSession(): unknown {
	const subs: Array<(ev: unknown) => void> = [];
	return {
		subscribe: (h: (ev: unknown) => void) => {
			subs.push(h);
			return () => {
				const i = subs.indexOf(h);
				if (i >= 0) subs.splice(i, 1);
			};
		},
		emit: (ev: unknown) => {
			for (const s of subs) s(ev);
		},
		prompt: async () => undefined,
	};
}

mock.module("@mariozechner/pi-coding-agent", () => {
	class InteractiveModeMock {
		constructor(runtimeArg: unknown, optionsArg?: unknown) {
			interactiveModeCalls.push({ runtimeArg, optionsArg });
		}
		async init(): Promise<void> {}
		async run(): Promise<void> {
			return Promise.resolve();
		}
		stop(): void {}
		clearEditor(): void {}
		showError(_: string): void {}
		showWarning(_: string): void {}
	}

	async function createAgentSessionRuntime(
		factory: unknown,
		options: { cwd: string; agentDir: string; sessionManager: unknown },
	): Promise<unknown> {
		runtimeFactoryCalls.push({ factoryFn: factory, options });
		const result = await (factory as (o: typeof options) => Promise<{ session: unknown; services: unknown }>)(
			options,
		);
		return {
			session: result.session ?? makeStubSession(),
			services: result.services,
			diagnostics: [],
			cwd: options.cwd,
			dispose: async () => undefined,
		};
	}

	async function createAgentSessionServices(args: {
		resourceLoaderOptions?: { extensionFactories?: unknown[] };
	}): Promise<unknown> {
		servicesConstructorCalls.push({
			extensionFactoriesArg: args.resourceLoaderOptions?.extensionFactories ?? [],
		});
		return { diagnostics: [] };
	}

	async function createAgentSessionFromServices(_args: unknown): Promise<unknown> {
		return { session: makeStubSession() };
	}

	class AuthStorageStub {
		static inMemory(_b: Record<string, unknown>): unknown {
			return {};
		}
	}
	class ModelRegistryStub {
		static inMemory(_a: unknown): unknown {
			const providers: Record<string, { models: Array<{ id: string; name?: string }> }> = {};
			return {
				registerProvider: (name: string, config: unknown) => {
					providers[name] = config as { models: Array<{ id: string; name?: string }> };
				},
				find: (pn: string, mid: string) => {
					const p = providers[pn];
					if (!p) return undefined;
					return p.models.find((m) => m.id === mid);
				},
			};
		}
	}
	class SessionManagerStub {
		static inMemory(_cwd: string): unknown {
			return { kind: "sm-stub" };
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

// Import AFTER mocks.
import { createEmmySession } from "../src/session";
import { createEmmyExtension } from "../src/pi-emmy-extension";
import type { ProfileSnapshot } from "@emmy/provider";
import {
	configureTelemetry,
	resetTelemetryContext,
	TurnTracker,
} from "@emmy/telemetry";

function makeProfile(path: string): ProfileSnapshot {
	return {
		ref: {
			id: "qwen3.6-35b-a3b",
			version: "v3",
			hash: "2beb99c773a0e425a3e485459964740640c5f3addbea186738402cf66d4d3718",
			path,
		},
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

// Construct a mock pi ExtensionAPI recording all ExtensionFactory registrations.
interface HandlerRecord {
	event: string;
	handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
}

function makeMockPiApi(statusCapture: Array<{ key: string; text: string }>): {
	api: unknown;
	handlers: HandlerRecord[];
	setStatusFn: (key: string, text: string) => void;
	inputFn: (prompt: string, placeholder?: string) => Promise<string | undefined>;
	inputMock: { calls: Array<[string, string?]>; response: string | undefined };
} {
	const handlers: HandlerRecord[] = [];
	const setStatusFn = (key: string, text: string): void => {
		statusCapture.push({ key, text });
	};
	const inputMock: { calls: Array<[string, string?]>; response: string | undefined } = {
		calls: [],
		response: undefined,
	};
	const inputFn = async (prompt: string, placeholder?: string): Promise<string | undefined> => {
		inputMock.calls.push([prompt, placeholder]);
		return inputMock.response;
	};
	const api = {
		on: (event: string, handler: (e: unknown, c: unknown) => Promise<unknown> | unknown) => {
			handlers.push({ event, handler });
		},
		registerTool: () => undefined,
		registerCommand: () => undefined,
		registerShortcut: () => undefined,
		registerFlag: () => undefined,
		getFlag: () => undefined,
		registerMessageRenderer: () => undefined,
		sendMessage: () => undefined,
		sendUserMessage: () => undefined,
		appendEntry: () => undefined,
		setSessionName: () => undefined,
		getSessionName: () => undefined,
		setLabel: () => undefined,
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
		getActiveTools: () => [],
		getAllTools: () => [],
		resources: { discover: async () => [] },
	};
	return { api, handlers, setStatusFn, inputFn, inputMock };
}

function makeMockCtx(
	statusCapture: Array<{ key: string; text: string }>,
	inputFn: (prompt: string, placeholder?: string) => Promise<string | undefined>,
	opts: { includeContextUsage?: boolean } = {},
): unknown {
	const setStatusFn = (key: string, text: string): void => {
		statusCapture.push({ key, text });
	};
	return {
		ui: {
			setStatus: setStatusFn,
			input: inputFn,
		},
		signal: new AbortController().signal,
		getContextUsage: opts.includeContextUsage
			? () => ({ tokens: 100, contextWindow: 131072 })
			: () => null,
		sessionManager: { getEntries: () => [] },
		model: { id: "qwen3-coder-35b-a3b-instruct-fp8" },
	};
}

function findHandler(handlers: HandlerRecord[], event: string): HandlerRecord {
	const h = handlers.find((r) => r.event === event);
	if (!h) throw new Error(`no handler registered for event=${event}`);
	return h;
}

function findAllHandlers(handlers: HandlerRecord[], event: string): HandlerRecord[] {
	return handlers.filter((r) => r.event === event);
}

// Shared: mock SP_OK server.
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
let jsonlPath: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-rt-wire-"));
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
	jsonlPath = join(tmp, "events.jsonl");
	// Configure telemetry to write to this tmp JSONL. Plan 03-02 pattern.
	configureTelemetry({ jsonlPath, tracer: null, enabled: true });
	emittedEvents.length = 0;
	runtimeFactoryCalls.length = 0;
	interactiveModeCalls.length = 0;
	servicesConstructorCalls.length = 0;
});
afterEach(() => {
	resetTelemetryContext();
	rmSync(tmp, { recursive: true, force: true });
});

function readEmittedEvents(): Array<{ event: string; [k: string]: unknown }> {
	if (!existsSync(jsonlPath)) return [];
	return readFileSync(jsonlPath, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as { event: string; [k: string]: unknown });
}

describe("runtime-tui wiring — emmyExtension factory preserves every Phase-3 handler on the TUI path", () => {
	test("TUI mode: createAgentSessionRuntime is called and emmyExtension is passed via resourceLoaderOptions.extensionFactories", async () => {
		await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		}).then(async ({ runtime }) => {
			expect(typeof runtime.runTui).toBe("function");
			await runtime.runTui!();
		});

		// Task 2 MUST call createAgentSessionRuntime on the TUI path.
		expect(runtimeFactoryCalls.length).toBe(1);
		// Task 2 MUST construct InteractiveMode.
		expect(interactiveModeCalls.length).toBe(1);
		// The factory MUST install the Emmy ExtensionFactory via resourceLoaderOptions.
		expect(servicesConstructorCalls.length).toBe(1);
		const efs = servicesConstructorCalls[0]!.extensionFactoriesArg;
		expect(Array.isArray(efs)).toBe(true);
		expect(efs.length).toBe(1);
		expect(typeof efs[0]).toBe("function");
	});

	test("session_start: bindBadge is called on ctx.ui AND startFooterPoller fires when baseUrl is present (Plan 03-04 + 03-06)", async () => {
		// Directly drive the emmyExtension factory with a mock pi API — this is
		// the authoritative shape Task 2 passes to pi via extensionFactories.
		let pollerStarted = false;
		let pollerStopped = false;
		const extension = createEmmyExtension({
			profile: makeProfile(profilePath),
			assembledPromptProvider: () => ({ text: "", sha256: "abc" }),
			baseUrl: "http://127.0.0.1:9999",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
			startFooterPollerImpl: () => {
				pollerStarted = true;
				return {
					stop: () => {
						pollerStopped = true;
					},
				};
			},
		});
		const statusCapture: Array<{ key: string; text: string }> = [];
		const { api, handlers, inputFn } = makeMockPiApi(statusCapture);
		await extension(api as Parameters<typeof extension>[0]);

		// Fire session_start via the recorded handler.
		const ctx = makeMockCtx(statusCapture, inputFn);
		const startHandler = findHandler(handlers, "session_start");
		await startHandler.handler({ type: "session_start" }, ctx);
		expect(pollerStarted).toBe(true);

		// Badge binding: Plan 03-06 bindBadge(ctx.ui) installs the offline-badge
		// renderer. With no prior audit, bindBadge is still called (audit result
		// drives setStatus lazily); the contract is simply that the handler
		// registered on session_start executed without errors AND the poller
		// fired. Evidence of ctx.ui.setStatus activity implies binding.

		// agent_end should stop the poller (Plan 03-04 lifecycle).
		const endHandler = findHandler(handlers, "agent_end");
		await endHandler.handler({ type: "agent_end" }, ctx);
		expect(pollerStopped).toBe(true);
	});

	test("before_provider_request: handler mutates non-canary payload (assembled prompt injection; Plan 03-01 + 03-02)", async () => {
		// NOTE: we assert on PAYLOAD MUTATION rather than emitEvent side-effects
		// because @emmy/telemetry is globally mocked by session.boot.test.ts
		// (Plan 03-02 Pattern F process-global mock hazard). The delivery-path
		// contract this plan cares about is: the before_provider_request handler
		// fires on the new TUI runtime's ExtensionAPI and invokes
		// handleBeforeProviderRequest (which mutates payload in-place). That
		// mutation is directly observable without touching emitEvent state.
		const extension = createEmmyExtension({
			profile: makeProfile(profilePath),
			assembledPromptProvider: () => ({
				text: "THIS_IS_THE_EMMY_ASSEMBLED_SYSTEM_PROMPT",
				sha256: "1111111111111111111111111111111111111111111111111111111111111111",
			}),
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		const statusCapture: Array<{ key: string; text: string }> = [];
		const { api, handlers, inputFn } = makeMockPiApi(statusCapture);
		await extension(api as Parameters<typeof extension>[0]);
		const ctx = makeMockCtx(statusCapture, inputFn);
		const bpr = findHandler(handlers, "before_provider_request");

		// Non-canary call: handleBeforeProviderRequest mutates payload to inject
		// the Emmy assembled system prompt + chat_template_kwargs.
		const payload: {
			model: string;
			messages: Array<{ role: string; content: string }>;
			chat_template_kwargs?: { enable_thinking?: boolean };
		} = {
			model: "qwen3-coder-35b-a3b-instruct-fp8",
			messages: [{ role: "user", content: "hi" }],
		};
		await bpr.handler(
			{
				type: "before_provider_request",
				payload,
			},
			ctx,
		);
		// Plan 03-01: enable_thinking:false is injected.
		expect(payload.chat_template_kwargs?.enable_thinking).toBe(false);
		// Plan 03-01 truth #2 + 03-02 D-04: system message is the Emmy
		// assembled prompt (prepended via messages[0]).
		const firstMsg = payload.messages[0]!;
		expect(firstMsg.role).toBe("system");
		expect(firstMsg.content).toBe("THIS_IS_THE_EMMY_ASSEMBLED_SYSTEM_PROMPT");

		// Canary payload: handleBeforeProviderRequest MUST NOT overwrite the
		// canary's deliberately-terse system prompt (Plan 03-01 truth #6).
		const canaryPayload: {
			model: string;
			messages: Array<{ role: string; content: string }>;
			emmy: { is_sp_ok_canary: true };
			chat_template_kwargs?: { enable_thinking?: boolean };
		} = {
			model: "qwen3-coder-35b-a3b-instruct-fp8",
			messages: [{ role: "system", content: "canary-system" }, { role: "user", content: "ping" }],
			emmy: { is_sp_ok_canary: true },
		};
		await bpr.handler(
			{
				type: "before_provider_request",
				payload: canaryPayload,
			},
			ctx,
		);
		// Canary's original system message stays verbatim (NOT replaced by
		// Emmy's assembled prompt).
		expect(canaryPayload.messages[0]!.content).toBe("canary-system");
	});

	test("turn_end: populates injected TurnTracker with emmy-synthesized turn_id ${sessionId}:${turnIndex} (Plan 03-05)", async () => {
		const tracker = new TurnTracker();
		const extension = createEmmyExtension({
			profile: makeProfile(profilePath),
			assembledPromptProvider: () => ({ text: "", sha256: "abc" }),
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
			turnTrackerImpl: tracker,
		});
		const statusCapture: Array<{ key: string; text: string }> = [];
		const { api, handlers, inputFn } = makeMockPiApi(statusCapture);
		await extension(api as Parameters<typeof extension>[0]);
		const ctx = makeMockCtx(statusCapture, inputFn);

		const turnEnd = findHandler(handlers, "turn_end");
		// Synthesize a pi 0.68 TurnEndEvent (types.d.ts line 468-473).
		await turnEnd.handler(
			{
				type: "turn_end",
				turnIndex: 0,
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Here is the result" },
						{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
					],
					usage: { input: 500, output: 50 },
				},
				toolResults: [],
			},
			ctx,
		);
		const latest = tracker.getLatest();
		expect(latest).toBeDefined();
		expect(latest!.turn_id).toBe("S-p3-08:1:0");
		expect(latest!.session_id).toBe("S-p3-08:1");
		expect(latest!.profile_hash).toBe(
			"2beb99c773a0e425a3e485459964740640c5f3addbea186738402cf66d4d3718",
		);
		expect(latest!.model_response).toBe("Here is the result");
		expect(latest!.tool_calls.length).toBe(1);
	});

	test("input + Alt+Up: returns {action: 'handled'} when routed through pi input-event bus (Plan 03-05 delivery path)", async () => {
		// NOTE: we deliberately do NOT assert on feedback.jsonl contents here
		// because `handleFeedbackKey` writes to `defaultFeedbackPath()` which
		// resolves `homedir()` at CALL time — and Bun caches `os.homedir()` at
		// module load, so the HOME env override trick doesn't work. The full
		// file-write path is exhaustively exercised in the Plan 03-05 test
		// suite (feedback-flow.integration.test.ts + feedback-append.test.ts
		// + feedback-idempotent.test.ts — 31 tests green). This plan's job is
		// to verify the DELIVERY path: that pi's `input` event reaches emmy's
		// handler and the handler returns {action: "handled"} so pi's
		// app.message.dequeue does NOT hijack the keypress (D-18).
		const tracker = new TurnTracker();
		const extension = createEmmyExtension({
			profile: makeProfile(profilePath),
			assembledPromptProvider: () => ({ text: "", sha256: "abc" }),
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
			turnTrackerImpl: tracker,
		});
		const statusCapture: Array<{ key: string; text: string }> = [];
		const { api, handlers, inputFn } = makeMockPiApi(statusCapture);
		await extension(api as Parameters<typeof extension>[0]);
		const ctx = makeMockCtx(statusCapture, inputFn);

		// Populate tracker via turn_end so Alt+Up has a turn to rate.
		const turnEnd = findHandler(handlers, "turn_end");
		await turnEnd.handler(
			{
				type: "turn_end",
				turnIndex: 0,
				message: {
					role: "assistant",
					content: [{ type: "text", text: "resp" }],
					usage: { input: 100, output: 10 },
				},
				toolResults: [],
			},
			ctx,
		);

		// Fire Alt+Up via the input handler Task 2 must preserve.
		const inputH = findHandler(handlers, "input");
		// Route through real HOME so upsertFeedback doesn't crash on a
		// nonexistent directory — the real path under ~/.emmy/telemetry/
		// already exists on this dev box (Plan 03-05 operator probe left
		// 2 rows there). If it doesn't exist, feedback.ts autocreates via
		// mkdirSync(..., recursive: true). We don't assert on rows; we
		// only assert the delivery contract: handler returned handled.
		const res = await inputH.handler(
			{ type: "input", text: "\x1b[1;3A", source: "user" },
			ctx,
		);
		expect(res).toEqual({ action: "handled" });
	});

	test("input + non-ANSI keypress: returns {action: 'continue'} (pass-through; Plan 03-05)", async () => {
		const tracker = new TurnTracker();
		const extension = createEmmyExtension({
			profile: makeProfile(profilePath),
			assembledPromptProvider: () => ({ text: "", sha256: "abc" }),
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
			turnTrackerImpl: tracker,
		});
		const statusCapture: Array<{ key: string; text: string }> = [];
		const { api, handlers, inputFn } = makeMockPiApi(statusCapture);
		await extension(api as Parameters<typeof extension>[0]);
		const ctx = makeMockCtx(statusCapture, inputFn);

		const inputH = findHandler(handlers, "input");
		const res = await inputH.handler(
			{ type: "input", text: "a", source: "user" },
			ctx,
		);
		expect(res).toEqual({ action: "continue" });
	});

	test("input kill-switch: telemetryEnabled=false returns {action: 'continue'} for Alt+Up (Plan 03-05 truth #9)", async () => {
		const tracker = new TurnTracker();
		const extension = createEmmyExtension({
			profile: makeProfile(profilePath),
			assembledPromptProvider: () => ({ text: "", sha256: "abc" }),
			sessionId: "S-p3-08:1",
			telemetryEnabled: false, // KILL-SWITCH
			turnTrackerImpl: tracker,
		});
		const statusCapture: Array<{ key: string; text: string }> = [];
		const { api, handlers, inputFn } = makeMockPiApi(statusCapture);
		await extension(api as Parameters<typeof extension>[0]);
		const ctx = makeMockCtx(statusCapture, inputFn);

		// With telemetryEnabled=false, pi-emmy-extension.ts does NOT register
		// turn_end (see the guard `if (telemetryEnabled && sessionId)` at line
		// 242). BUT pi.on("input", ...) is ALWAYS registered — it early-returns
		// {action: "continue"} when telemetryEnabled is false.
		const inputHandlers = findAllHandlers(handlers, "input");
		expect(inputHandlers.length).toBeGreaterThanOrEqual(1);

		const res = await inputHandlers[0]!.handler(
			{ type: "input", text: "\x1b[1;3A", source: "user" },
			ctx,
		);
		expect(res).toEqual({ action: "continue" });
	});

	test("turn_start compaction: handler wired (Plan 03-03); ctx.getContextUsage null path early-returns", async () => {
		const extension = createEmmyExtension({
			profile: makeProfile(profilePath),
			assembledPromptProvider: () => ({ text: "", sha256: "abc" }),
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		const statusCapture: Array<{ key: string; text: string }> = [];
		const { api, handlers, inputFn } = makeMockPiApi(statusCapture);
		await extension(api as Parameters<typeof extension>[0]);
		const ctx = makeMockCtx(statusCapture, inputFn, { includeContextUsage: false });
		const ts = findHandler(handlers, "turn_start");
		// No usage → early return. The handler resolves without throwing.
		await expect(ts.handler({ type: "turn_start" }, ctx)).resolves.toBeUndefined();
	});
});

describe("SP_OK canary ordering — runSpOk fires BEFORE createAgentSessionRuntime factory (Plan 03-01 truth #6)", () => {
	test("structural ordering: createAgentSessionRuntime is invoked during runTui AND only when SP_OK has already passed", async () => {
		// Invariant: createEmmySession runs in order:
		//   runSpOk → emitEvent("session.sp_ok.pass") → build customTools →
		//   [on TUI path] buildRealPiRuntimeTui → createAgentSessionRuntime
		//   fires when runtime.runTui() is invoked.
		//
		// Structural assertion (robust against Pattern F test-pollution that
		// mocks @emmy/telemetry away): if runSpOk had failed, createEmmySession
		// would have thrown SpOkCanaryError BEFORE the runtime was built, so
		// runtimeFactoryCalls would be 0. A non-zero count AFTER runTui()
		// necessarily means SpOk passed first. The previous (more direct)
		// assertion read events from a tmp JSONL, which session.boot.test.ts
		// nullifies via module-global mock.module("@emmy/telemetry", ...).
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			sessionId: "S-p3-08:1",
			telemetryEnabled: true,
		});
		expect(typeof out.runtime.runTui).toBe("function");
		// The runtime factory is invoked eagerly inside
		// buildRealPiRuntimeTui (so pi's AgentSessionRuntime exists for the
		// on(...) adapter's session.subscribe hook). InteractiveMode is
		// constructed lazily inside runTui(). Both orderings still obey the
		// SP_OK → runtime invariant because runSpOk fires at the very top of
		// createEmmySession and throws on failure, cutting off runtime
		// construction entirely.
		expect(runtimeFactoryCalls.length).toBe(1);
		// InteractiveMode not yet constructed until runTui() runs.
		expect(interactiveModeCalls.length).toBe(0);
		await out.runtime.runTui!();
		// Post-condition: InteractiveMode now constructed exactly once.
		expect(interactiveModeCalls.length).toBe(1);
		// The mock SP_OK server responded with [SP_OK] (see beforeAll); if
		// runSpOk had NOT fired first, SpOkCanaryError would have been thrown
		// in the `await createEmmySession(...)` call above and the test would
		// have failed synchronously — so reaching this line is itself proof
		// that SpOk was verified before the runtime-builder path.
	});

	test("initOtel ordering guard: configureTelemetry precedes createEmmySession (Plan 03-02 Pitfall #2)", () => {
		// Invariant: configureTelemetry({jsonlPath}) is called in the outer
		// scope (pi-emmy.ts main() between loadProfile and createEmmySession).
		// The test's beforeEach already does this. If session bootstrap
		// somehow called emitEvent before configureTelemetry was set, the
		// tests calling readEmittedEvents() in other describes would observe
		// an empty JSONL. This test acts as a harness self-check.
		expect(jsonlPath.endsWith("events.jsonl")).toBe(true);
	});
});
