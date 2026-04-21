// packages/emmy-provider/tests/grammar-retry.test.ts
//
// Task 2 RED tests. Behavior covered:
// - no tool_calls OR well-formed tool_calls -> no retry, no events
// - malformed tool_call arguments -> retry with extra_body.guided_decoding.grammar populated
// - retry success -> {retried: true, reason: "parse_failure"}; two events emitted
// - retry still malformed -> GrammarRetryExhaustedError + grammar.retry.exhausted event
// - profile.harness.tools.grammar === null OR mode === "disabled" -> ProviderError AND
//   both grammar.retry AND grammar.retry.exhausted{reason:"no_grammar_configured"} emitted (I2 fix)
// - Grammar is NEVER sent on the first request
// - events carry profile.ref (id, version, hash) per Shared Pattern 3/4

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the @emmy/telemetry emitEvent BEFORE importing @emmy/provider so the
// provider module picks up the mock on first load.
const events: unknown[] = [];
mock.module("@emmy/telemetry", () => ({
	emitEvent: (r: unknown) => {
		events.push(r);
	},
}));

import {
	callWithReactiveGrammar,
	GrammarRetryExhaustedError,
	ProviderError,
} from "@emmy/provider";
import type { ChatRequest, ProfileSnapshot } from "@emmy/provider";

function scriptServer(responses: unknown[]) {
	let i = 0;
	const requests: unknown[] = [];
	const server = Bun.serve({
		port: 0,
		fetch: async (req: Request) => {
			requests.push(JSON.parse(await req.text()));
			const resp = responses[Math.min(i, responses.length - 1)];
			i++;
			return new Response(JSON.stringify(resp), {
				headers: { "content-type": "application/json" },
			});
		},
	});
	return { server, requests, nextIndex: () => i };
}

// grammarRelPath === null        -> profile.harness.tools.grammar = null
// grammarRelPath === "disabled"  -> profile.harness.tools.grammar = { path, mode:"disabled" } (file created)
// string                          -> profile.harness.tools.grammar = { path, mode:"reactive" } (file created)
function stubProfile(
	tmpDir: string,
	grammarRelPath: string | null | "disabled",
): ProfileSnapshot {
	let grammar: ProfileSnapshot["harness"]["tools"]["grammar"] = null;
	if (grammarRelPath === "disabled") {
		mkdirSync(join(tmpDir, "grammars"), { recursive: true });
		writeFileSync(
			join(tmpDir, "grammars", "disabled.lark"),
			"start: /.+/\n",
		);
		grammar = { path: "grammars/disabled.lark", mode: "disabled" };
	} else if (typeof grammarRelPath === "string") {
		mkdirSync(join(tmpDir, "grammars"), { recursive: true });
		writeFileSync(join(tmpDir, grammarRelPath), "start: /.+/\n");
		grammar = { path: grammarRelPath, mode: "reactive" };
	}
	return {
		ref: {
			id: "qwen3.6-35b-a3b",
			version: "v2",
			hash: "sha256:aaa",
			path: tmpDir,
		},
		serving: {
			engine: {
				served_model_name: "qwen3.6-35b-a3b",
				max_model_len: 131072,
			},
			sampling_defaults: {
				temperature: 0,
				top_p: 0.95,
				max_tokens: 8,
				stop: [],
			},
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: true,
			},
		},
		harness: {
			tools: { format: "openai", grammar, per_tool_sampling: {} },
			agent_loop: { retry_on_unparseable_tool_call: 2 },
		},
	};
}

function stubReq(): ChatRequest {
	return {
		model: "qwen3.6-35b-a3b",
		messages: [{ role: "user", content: "read /tmp/x" }],
		temperature: 0,
		max_tokens: 32,
		tools: [
			{
				type: "function",
				function: {
					name: "read",
					parameters: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
						additionalProperties: false,
					},
				},
			},
		],
	};
}

describe("callWithReactiveGrammar", () => {
	let tmpDir: string;
	const openServers: ReturnType<typeof Bun.serve>[] = [];

	beforeEach(() => {
		events.length = 0;
		tmpDir = mkdtempSync(join(tmpdir(), "emmy-provider-test-"));
	});
	afterEach(() => {
		while (openServers.length > 0) {
			const s = openServers.pop();
			try {
				s?.stop(true);
			} catch (_e) {
				/* ignore */
			}
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("no tool_calls -> no retry", async () => {
		const { server } = scriptServer([
			{
				choices: [
					{
						message: { role: "assistant", content: "hi" },
						finish_reason: "stop",
					},
				],
			},
		]);
		openServers.push(server);
		const profile = stubProfile(tmpDir, "grammars/tool_call.lark");
		const result = await callWithReactiveGrammar(
			`http://127.0.0.1:${server.port}`,
			stubReq(),
			profile,
		);
		expect(result.retried).toBe(false);
		expect(events.length).toBe(0);
	});

	test("well-formed tool_calls -> no retry", async () => {
		const { server } = scriptServer([
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "c1",
									type: "function",
									function: {
										name: "read",
										arguments: '{"path":"/tmp/x"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);
		openServers.push(server);
		const profile = stubProfile(tmpDir, "grammars/tool_call.lark");
		const result = await callWithReactiveGrammar(
			`http://127.0.0.1:${server.port}`,
			stubReq(),
			profile,
		);
		expect(result.retried).toBe(false);
		expect(events.length).toBe(0);
	});

	test("malformed arguments JSON -> retry with grammar (nested-shape path) -> success", async () => {
		const { server, requests } = scriptServer([
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "c1",
									type: "function",
									function: { name: "read", arguments: "NOT_JSON_@#" },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "c2",
									type: "function",
									function: {
										name: "read",
										arguments: '{"path":"/tmp/x"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);
		openServers.push(server);
		const profile = stubProfile(tmpDir, "grammars/tool_call.lark");
		const result = await callWithReactiveGrammar(
			`http://127.0.0.1:${server.port}`,
			stubReq(),
			profile,
		);
		expect(result.retried).toBe(true);
		expect(result.reason).toBe("parse_failure");

		// First request MUST NOT carry the grammar.
		const req0 = requests[0] as { extra_body?: { guided_decoding?: unknown } };
		expect(req0.extra_body?.guided_decoding).toBeUndefined();

		// Retry request MUST set extra_body.guided_decoding.grammar.
		const req1 = requests[1] as {
			extra_body?: { guided_decoding?: { grammar?: string } };
		};
		expect(req1.extra_body?.guided_decoding?.grammar).toContain("start:");

		// Two events: grammar.retry + grammar.retry.success, carrying profile.ref.
		expect(events.length).toBe(2);
		const e0 = events[0] as {
			event: string;
			profile: { id: string; version: string; hash: string };
		};
		const e1 = events[1] as { event: string };
		expect(e0.event).toBe("grammar.retry");
		expect(e1.event).toBe("grammar.retry.success");
		expect(e0.profile.id).toBe("qwen3.6-35b-a3b");
		expect(e0.profile.version).toBe("v2");
		expect(e0.profile.hash).toBe("sha256:aaa");
	});

	test("malformed args -> retry -> still malformed -> exhausted error + event emitted", async () => {
		const { server } = scriptServer([
			{
				choices: [
					{
						message: {
							role: "assistant",
							tool_calls: [
								{
									id: "c",
									type: "function",
									function: { name: "x", arguments: "BAD" },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
			{
				choices: [
					{
						message: {
							role: "assistant",
							tool_calls: [
								{
									id: "c",
									type: "function",
									function: { name: "x", arguments: "STILL_BAD" },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);
		openServers.push(server);
		const profile = stubProfile(tmpDir, "grammars/tool_call.lark");
		await expect(
			callWithReactiveGrammar(
				`http://127.0.0.1:${server.port}`,
				stubReq(),
				profile,
			),
		).rejects.toBeInstanceOf(GrammarRetryExhaustedError);
		expect(
			events.some((e) => (e as { event: string }).event === "grammar.retry.exhausted"),
		).toBe(true);
	});

	test("profile.harness.tools.grammar === null -> retry impossible; throws ProviderError AND emits BOTH grammar.retry + grammar.retry.exhausted(no_grammar_configured) [I2 FIX]", async () => {
		const { server } = scriptServer([
			{
				choices: [
					{
						message: {
							role: "assistant",
							tool_calls: [
								{
									id: "c",
									type: "function",
									function: { name: "x", arguments: "BAD" },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);
		openServers.push(server);
		const profile = stubProfile(tmpDir, null);
		await expect(
			callWithReactiveGrammar(
				`http://127.0.0.1:${server.port}`,
				stubReq(),
				profile,
			),
		).rejects.toBeInstanceOf(ProviderError);

		// I2 FIX: exhausted event emitted with named reason.
		expect(
			events.some(
				(e) =>
					(e as { event: string; reason: string }).event ===
						"grammar.retry.exhausted" &&
					(e as { event: string; reason: string }).reason ===
						"no_grammar_configured",
			),
		).toBe(true);
		// Triggering grammar.retry event is present (audit trail for SC-3 metrics).
		expect(
			events.some(
				(e) => (e as { event: string }).event === "grammar.retry",
			),
		).toBe(true);
	});

	test("profile.harness.tools.grammar.mode === 'disabled' -> same as null path [B3 nested-shape coverage]", async () => {
		const { server } = scriptServer([
			{
				choices: [
					{
						message: {
							role: "assistant",
							tool_calls: [
								{
									id: "c",
									type: "function",
									function: { name: "x", arguments: "BAD" },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);
		openServers.push(server);
		const profile = stubProfile(tmpDir, "disabled");
		await expect(
			callWithReactiveGrammar(
				`http://127.0.0.1:${server.port}`,
				stubReq(),
				profile,
			),
		).rejects.toBeInstanceOf(ProviderError);
		expect(
			events.some(
				(e) =>
					(e as { event: string; reason: string }).event ===
						"grammar.retry.exhausted" &&
					(e as { event: string; reason: string }).reason ===
						"no_grammar_configured",
			),
		).toBe(true);
	});
});
