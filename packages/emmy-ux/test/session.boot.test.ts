// packages/emmy-ux/test/session.boot.test.ts
//
// Plan 03-01 Task 1 (RED) — Wave-1 session boot regression asserting that the
// pi-session wire-through has actually flipped from NO-OP (Phase 2) to real
// (Phase 3). These tests use a stub piFactory that exposes an `introspect()`
// snapshot of the adapter's internal registrations so we can verify:
//
//   Test 1: customTools length === NATIVE_TOOL_NAMES.length (+ 0 MCP tools in
//           default fixture).
//   Test 2: the adapter's registerProvider is NOT a NO-OP — it records a
//           {name, impl} entry, with name matching the `emmy:<id>@<version>`
//           shape that @emmy/provider emits.
//   Test 3: runPrint exercises @emmy/provider's chat closure (NOT pi-ai's
//           built-in openai-completions stream). Asserted via a sentinel
//           mutation inside the provider's registered impl.
//
// RED expectation at commit time:
//   - Test 1 fails because session.ts line 156 still passes `customTools: []`.
//   - Test 2 fails because the adapter's registerProvider at session.ts
//     lines 225-231 is a NO-OP.
//   - Test 3 cannot be exercised yet (runPrint currently routes through pi-ai's
//     built-in stream); fails with "sentinel flag not flipped".

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Telemetry mock BEFORE import so session.ts + prompt-assembly.ts pick it up.
const emitted: unknown[] = [];
mock.module("@emmy/telemetry", () => ({
	emitEvent: (r: unknown) => {
		emitted.push(r);
	},
}));

import { createEmmySession, type ProfileSnapshot } from "@emmy/ux";
import { NATIVE_TOOL_NAMES } from "@emmy/tools";

function makeProfile(path: string): ProfileSnapshot {
	return {
		ref: { id: "qwen3.6-35b-a3b", version: "v2", hash: "sha256:abc", path },
		serving: {
			engine: { served_model_name: "qwen3.6-35b-a3b", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.2, top_p: 0.95, max_tokens: 8192, stop: [] },
			quirks: { strip_thinking_tags: false, promote_reasoning_to_content: false, buffer_tool_streams: false },
		},
		harness: {
			tools: { format: "openai", grammar: null, per_tool_sampling: {} },
			agent_loop: { retry_on_unparseable_tool_call: 2 },
		},
	};
}

// Introspectable stub runtime — the adapter body Task 2 produces must route
// registerProvider + customTools collection through these arrays.
interface IntrospectableRuntime {
	registerProvider: (name: string, impl: unknown) => void;
	registerTool: (spec: unknown) => void;
	on: (event: string, handler: (...args: unknown[]) => void) => void;
	runPrint: (prompt: string, opts?: { mode: "text" | "json" }) => Promise<{ text: string; messages: unknown[] }>;
	introspect: () => {
		registeredProviders: Array<{ name: string; impl: unknown }>;
		registeredCustomTools: Array<{ name: string }>;
	};
}

function makeIntrospectableStubPiFactory(opts: {
	customTools: Array<{ name: string }>;
	sentinelFlag: { value: boolean };
}): () => IntrospectableRuntime {
	return () => {
		const providers: Array<{ name: string; impl: unknown }> = [];
		return {
			registerProvider: (name: string, impl: unknown) => {
				providers.push({ name, impl });
			},
			registerTool: (_spec: unknown) => {
				// customTools path is the new wire; back-compat registerTool stays
				// as a no-op pass-through (adapter still records pi.registerTool
				// calls for introspection).
			},
			on: (_event: string, _handler: (...args: unknown[]) => void) => {
				// transcript wiring exercised elsewhere
			},
			runPrint: async (_prompt: string, _opts?: { mode: "text" | "json" }) => {
				// Task 2 MUST wire this so @emmy/provider's chat closure fires.
				// For Task 1 RED we mimic a provider-dispatched call by invoking
				// the first registered provider's chat() if present — this flips
				// the sentinel when the adapter forwards correctly.
				const first = providers[0];
				if (first && typeof (first.impl as { chat?: unknown })?.chat === "function") {
					await (first.impl as { chat: (req: unknown, signal?: AbortSignal) => Promise<unknown> }).chat(
						{ model: "qwen", messages: [] },
						undefined,
					);
				}
				return { text: "stub-done", messages: [] };
			},
			introspect: () => ({
				registeredProviders: providers.slice(),
				registeredCustomTools: opts.customTools.slice(),
			}),
		};
	};
}

// Shared mock SP_OK server.
let mockServer: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";
let spOkResponse: string = "[SP_OK]";
let providerChatSentinelFlipped = false;
beforeAll(() => {
	mockServer = Bun.serve({
		port: 0,
		fetch: async (r: Request) => {
			const u = new URL(r.url);
			if (u.pathname.endsWith("/v1/chat/completions")) {
				providerChatSentinelFlipped = true;
				return new Response(
					JSON.stringify({
						choices: [
							{ message: { role: "assistant", content: spOkResponse }, finish_reason: "stop" },
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
	tmp = mkdtempSync(join(tmpdir(), "emmy-boot-"));
	profilePath = join(tmp, "profile");
	cwd = join(tmp, "proj");
	mkdirSync(profilePath, { recursive: true });
	mkdirSync(join(profilePath, "prompts"), { recursive: true });
	writeFileSync(
		join(profilePath, "prompts", "system.md"),
		"You are Emmy. Echo [SP_OK] when the user says 'ping'.\n",
		"utf8",
	);
	mkdirSync(cwd, { recursive: true });
	providerChatSentinelFlipped = false;
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("createEmmySession — Wave 1 wire-through boot contract", () => {
	test("Test 1: registeredCustomTools.length === NATIVE_TOOL_NAMES.length (+0 MCP in default)", async () => {
		spOkResponse = "[SP_OK]";
		// The adapter Task 2 produces will read customTools from the session
		// assembly path (session.ts line 156 flip). The stub factory must
		// therefore receive those customTools at construction time — the real
		// contract Task 2 implements is: createEmmySession computes customTools
		// itself and passes them to a real createAgentSessionFromServices call
		// OR exposes them on the stub factory hook.
		//
		// To keep this test stable against the Task 2 implementation shape, we
		// assert on the RESULTING adapter's introspect() snapshot. The session
		// code must populate `registeredCustomTools` at boot via either the
		// real pi runtime path OR via a test-only hook exported from the adapter.
		const sentinelFlag = { value: false };
		const customToolsForStub: Array<{ name: string }> = [];
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			piFactory: makeIntrospectableStubPiFactory({
				customTools: customToolsForStub,
				sentinelFlag,
			}),
		});
		const introspect = (out.runtime as unknown as IntrospectableRuntime).introspect;
		expect(typeof introspect).toBe("function");
		const snap = introspect();
		// The stub's customTools proxy is populated by the session wire-through
		// (Task 2 populates it by pushing native tool defs into it before the
		// session finishes boot). If Task 2 hasn't landed, this array stays
		// empty and the test fails with 0 !== 8.
		expect(snap.registeredCustomTools.length).toBe(NATIVE_TOOL_NAMES.length);
		const toolNames = snap.registeredCustomTools.map((t) => t.name).sort();
		const expected = [...NATIVE_TOOL_NAMES].sort();
		expect(toolNames).toEqual(expected);
	});

	test("Test 2: registerProvider is not a no-op — impl recorded with emmy:<id>@<version>", async () => {
		spOkResponse = "[SP_OK]";
		const sentinelFlag = { value: false };
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			piFactory: makeIntrospectableStubPiFactory({
				customTools: [],
				sentinelFlag,
			}),
		});
		const snap = (out.runtime as unknown as IntrospectableRuntime).introspect();
		expect(snap.registeredProviders.length).toBe(1);
		expect(snap.registeredProviders[0]!.name).toBe("emmy:qwen3.6-35b-a3b@v2");
		// And the impl has a chat() method (the actual wire path).
		expect(typeof (snap.registeredProviders[0]!.impl as { chat?: unknown }).chat).toBe("function");
	});

	test("Test 3: runPrint routes through @emmy/provider's chat closure (sentinel flips on the provider's http path)", async () => {
		spOkResponse = "[SP_OK]";
		const sentinelFlag = { value: false };
		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "print",
			userPrompt: "list files",
			piFactory: makeIntrospectableStubPiFactory({
				customTools: [],
				sentinelFlag,
			}),
		});
		// Reset the server-side sentinel (the SP_OK canary already fired at boot
		// — we want to observe a second HTTP call triggered by runPrint via the
		// registered provider's chat closure).
		providerChatSentinelFlipped = false;
		await out.runtime.runPrint!("list files", { mode: "text" });
		expect(providerChatSentinelFlipped).toBe(true);
	});
});
