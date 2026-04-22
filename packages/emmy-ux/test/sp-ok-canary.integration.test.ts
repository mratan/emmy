// packages/emmy-ux/test/sp-ok-canary.integration.test.ts
//
// Plan 03-01 Task 1 (RED) — Test 7: SP_OK canary regression guard.
//
// Asserts that the SP_OK canary fires BEFORE the pi runtime is built (i.e.,
// BEFORE the before_provider_request hook could possibly be installed).
// This is the RESEARCH Pitfall #7 / 03-CONTEXT D-02 SP_OK-canary-regression
// belt-and-suspenders: the canary's raw postChat path must NEVER route through
// the handleBeforeProviderRequest mutator.
//
// Strategy: supply a piFactory that records "factory was invoked at step N".
// The canary fires during createEmmySession step 1; the factory is invoked at
// step 7. We assert factory_invocation_order > sp_ok_invocation_order. The
// server's /v1/chat/completions handler records its own call order so we can
// correlate.

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const emitted: unknown[] = [];
mock.module("@emmy/telemetry", () => ({
	emitEvent: (r: unknown) => {
		emitted.push(r);
	},
}));

import { createEmmySession, type ProfileSnapshot } from "@emmy/ux";

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

let mockServer: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";
let requestLog: Array<{ path: string; ts: number; body: Record<string, unknown> }> = [];
beforeAll(() => {
	mockServer = Bun.serve({
		port: 0,
		fetch: async (r: Request) => {
			const u = new URL(r.url);
			const body = r.method === "POST" ? ((await r.json()) as Record<string, unknown>) : {};
			requestLog.push({ path: u.pathname, ts: Date.now(), body });
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
	tmp = mkdtempSync(join(tmpdir(), "emmy-spok-"));
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
	requestLog = [];
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("SP_OK canary — integration regression", () => {
	test("canary fires via raw postChat BEFORE buildRealPiRuntime / piFactory invocation", async () => {
		const order: Array<{ event: string; ts: number }> = [];
		let factoryInvocationCount = 0;
		// Instrument: which step in createEmmySession called us?
		const stubFactory = () => {
			factoryInvocationCount++;
			order.push({ event: `pi-factory-invoked-${factoryInvocationCount}`, ts: Date.now() });
			return {
				registerProvider: (_n: string, _i: unknown) => {},
				registerTool: (_s: unknown) => {},
				on: (_e: string, _h: (...args: unknown[]) => void) => {},
				runPrint: async () => ({ text: "", messages: [] }),
			};
		};

		const out = await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			piFactory: stubFactory,
		});
		expect(out.spOkOk).toBe(true);

		// Ordering assertion: the SP_OK canary HTTP call (first entry in
		// requestLog pointing at /v1/chat/completions) must have happened
		// BEFORE the pi factory was invoked.
		expect(requestLog.length).toBeGreaterThanOrEqual(1);
		const firstChatCompletion = requestLog[0];
		expect(firstChatCompletion?.path.endsWith("/v1/chat/completions")).toBe(true);
		expect(factoryInvocationCount).toBe(1);
		const factoryTs = order.find((o) => o.event === "pi-factory-invoked-1")?.ts ?? Number.MAX_SAFE_INTEGER;
		expect((firstChatCompletion?.ts ?? Number.MAX_SAFE_INTEGER) <= factoryTs).toBe(true);
	});

	test("canary payload carries `chat_template_kwargs.enable_thinking:false` (the canary is the source of its own thinking-disable; the before_provider_request hook is NOT on the canary path)", async () => {
		const stubFactory = () => ({
			registerProvider: (_n: string, _i: unknown) => {},
			registerTool: (_s: unknown) => {},
			on: (_e: string, _h: (...args: unknown[]) => void) => {},
			runPrint: async () => ({ text: "", messages: [] }),
		});
		await createEmmySession({
			profile: makeProfile(profilePath),
			baseUrl,
			cwd,
			mode: "tui",
			piFactory: stubFactory,
		});
		const first = requestLog[0];
		expect(first).toBeDefined();
		const ctk = (first!.body as { chat_template_kwargs?: { enable_thinking?: boolean } }).chat_template_kwargs;
		expect(ctk?.enable_thinking).toBe(false);
	});
});
