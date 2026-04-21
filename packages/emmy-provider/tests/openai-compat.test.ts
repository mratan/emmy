// packages/emmy-provider/tests/openai-compat.test.ts
//
// Asserts registerEmmyProvider's request-shaping behavior:
// - user-supplied sampling fields override profile defaults
// - undefined fields fall back to profile sampling_defaults
// - model is ALWAYS forced to profile.serving.engine.served_model_name (prevents
//   wire-to-server model name drift)

import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock @emmy/telemetry before importing the provider (no-op; reactive retry
// path is not exercised here).
mock.module("@emmy/telemetry", () => ({ emitEvent: (_r: unknown) => {} }));

import { registerEmmyProvider } from "@emmy/provider";
import type { ChatRequest, ProfileSnapshot } from "@emmy/provider";

function makeProfile(): ProfileSnapshot {
	return {
		ref: {
			id: "qwen3.6-35b-a3b",
			version: "v1",
			hash: "sha256:abc",
			path: "/tmp/whatever",
		},
		serving: {
			engine: {
				served_model_name: "qwen3.6-35b-a3b",
				max_model_len: 131072,
			},
			sampling_defaults: {
				temperature: 0.2,
				top_p: 0.95,
				max_tokens: 8192,
				stop: [],
			},
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: {
			tools: { format: "openai", grammar: null, per_tool_sampling: {} },
			agent_loop: { retry_on_unparseable_tool_call: 2 },
		},
	};
}

// Capture the wire-shaped request the provider would send by standing up a
// Bun.serve mock and registering a fake `pi` that invokes `chat` directly.
async function captureRequestForInput(req: ChatRequest): Promise<{
	body: Record<string, unknown>;
}> {
	let captured: Record<string, unknown> = {};
	const server = Bun.serve({
		port: 0,
		fetch: async (r: Request) => {
			captured = JSON.parse(await r.text()) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: { role: "assistant", content: "ok" },
							finish_reason: "stop",
						},
					],
				}),
				{ headers: { "content-type": "application/json" } },
			);
		},
	});
	try {
		const baseUrl = `http://127.0.0.1:${server.port}`;
		const registered: {
			name: string;
			chat: (req: unknown) => Promise<unknown>;
		}[] = [];
		const pi = {
			registerProvider: (
				name: string,
				impl: { name: string; chat: (req: unknown) => Promise<unknown> },
			) => {
				registered.push(impl);
				void name;
			},
		};
		registerEmmyProvider(pi, makeProfile(), { baseUrl });
		expect(registered.length).toBe(1);
		const impl = registered[0];
		if (!impl) throw new Error("no provider registered");
		await impl.chat(req);
		return { body: captured };
	} finally {
		server.stop(true);
	}
}

describe("registerEmmyProvider request shaping", () => {
	beforeEach(() => {
		/* no-op */
	});

	test("user-supplied temperature wins over profile default", async () => {
		const { body } = await captureRequestForInput({
			model: "ignored",
			messages: [{ role: "user", content: "x" }],
			temperature: 0.5,
			max_tokens: 16,
		});
		expect(body.temperature).toBe(0.5);
	});

	test("undefined temperature falls back to profile sampling_defaults", async () => {
		// We must omit the field (not send undefined) because JSON.stringify strips
		// undefined. Construct via Partial then cast.
		const partial = {
			model: "ignored",
			messages: [{ role: "user", content: "x" }],
			max_tokens: 16,
		} as unknown as ChatRequest;
		const { body } = await captureRequestForInput(partial);
		expect(body.temperature).toBe(0.2);
	});

	test("model is always forced to profile.serving.engine.served_model_name", async () => {
		const { body } = await captureRequestForInput({
			model: "some-other-model",
			messages: [{ role: "user", content: "x" }],
			temperature: 0.1,
			max_tokens: 16,
		});
		expect(body.model).toBe("qwen3.6-35b-a3b");
	});
});
