// packages/emmy-provider/tests/http.test.ts
//
// RED phase tests for Task 1 (Plan 02-02). Covers:
//   - postChat: 2xx parse, 5xx NetworkError, timeout, chat_template_kwargs top-level placement
//   - stripNonStandardFields: deletes reasoning_content + thinking, honors quirks.strip_fields, idempotent, no-op
//   - ProviderError / NetworkError / GrammarRetryExhaustedError: dotted-path message shape
//   - W1 package-root re-export audit: imports come from "@emmy/provider" (bare), not "../src/..."
//
// Tests MUST be hermetic — use Bun.serve on an ephemeral port; never touch emmy-serve.

import { afterEach, describe, expect, test } from "bun:test";
// IMPORTANT (W1 fix): bare-package import. Do NOT reach into ../src/http.
// This doubles as an assertion that @emmy/provider's exports map re-exports postChat.
import {
	GrammarRetryExhaustedError,
	NetworkError,
	ProviderError,
	postChat,
	stripNonStandardFields,
} from "@emmy/provider";

// Track spun-up servers so we always stop them even if a test throws.
const openServers: ReturnType<typeof Bun.serve>[] = [];
function makeServer(fetch: (req: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ port: 0, fetch });
	openServers.push(server);
	return server;
}
afterEach(() => {
	while (openServers.length > 0) {
		const s = openServers.pop();
		try {
			s?.stop(true);
		} catch (_e) {
			/* ignore */
		}
	}
});

describe("postChat", () => {
	test("returns parsed JSON on 2xx", async () => {
		const server = makeServer(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: { role: "assistant", content: "hi" },
								finish_reason: "stop",
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				),
		);
		const resp = await postChat(`http://127.0.0.1:${server.port}`, {
			model: "qwen3.6-35b-a3b",
			messages: [{ role: "user", content: "ping" }],
			temperature: 0,
			max_tokens: 8,
		});
		expect(resp.choices[0]?.message.content).toBe("hi");
	});

	test("throws NetworkError on non-2xx with status in message", async () => {
		const server = makeServer(
			async () => new Response("backend exploded", { status: 500 }),
		);
		const baseUrl = `http://127.0.0.1:${server.port}`;
		try {
			await postChat(baseUrl, {
				model: "m",
				messages: [{ role: "user", content: "x" }],
				temperature: 0,
				max_tokens: 1,
			});
			throw new Error("expected postChat to throw");
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(NetworkError);
			const err = e as NetworkError;
			expect(err.message).toContain("500");
			expect(err.message).toContain(baseUrl);
			expect(err.status).toBe(500);
		}
	});

	test("throws NetworkError on timeout with 'timeout' in detail", async () => {
		// Server that never responds within the client timeout.
		const server = makeServer(
			async () =>
				new Promise<Response>(() => {
					/* never resolve */
				}),
		);
		const baseUrl = `http://127.0.0.1:${server.port}`;
		try {
			await postChat(
				baseUrl,
				{
					model: "m",
					messages: [{ role: "user", content: "x" }],
					temperature: 0,
					max_tokens: 1,
				},
				{ timeoutMs: 50 },
			);
			throw new Error("expected postChat to throw");
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(NetworkError);
			const err = e as NetworkError;
			expect(err.status).toBeNull();
			expect(err.message.toLowerCase()).toContain("timeout");
		}
	});

	test("sends chat_template_kwargs at TOP level of body, not under extra_body", async () => {
		let captured: Record<string, unknown> | null = null;
		const server = makeServer(async (req: Request) => {
			captured = JSON.parse(await req.text()) as Record<string, unknown>;
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
		});
		await postChat(`http://127.0.0.1:${server.port}`, {
			model: "qwen3.6-35b-a3b",
			messages: [{ role: "user", content: "ping" }],
			temperature: 0,
			max_tokens: 8,
			chat_template_kwargs: { enable_thinking: false },
		});
		expect(captured).not.toBeNull();
		const body = captured as Record<string, unknown>;
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
		// Explicitly assert chat_template_kwargs is NOT nested under extra_body.
		const extra = body.extra_body as
			| { chat_template_kwargs?: unknown }
			| undefined;
		expect(extra?.chat_template_kwargs).toBeUndefined();
	});
});

describe("stripNonStandardFields", () => {
	test("deletes reasoning_content and thinking", () => {
		const msg: Record<string, unknown> = {
			role: "assistant",
			content: "x",
			reasoning_content: null,
			thinking: "...",
		};
		stripNonStandardFields(msg);
		expect(msg.reasoning_content).toBeUndefined();
		expect(msg.thinking).toBeUndefined();
		expect(msg.content).toBe("x");
	});

	test("deletes extra keys from quirks.strip_fields", () => {
		const msg: Record<string, unknown> = {
			role: "assistant",
			content: "x",
			foo: 1,
			bar: 2,
			keep: 3,
		};
		stripNonStandardFields(msg, {
			strip_thinking_tags: false,
			promote_reasoning_to_content: false,
			buffer_tool_streams: false,
			strip_fields: ["foo", "bar"],
		});
		expect(msg.foo).toBeUndefined();
		expect(msg.bar).toBeUndefined();
		expect(msg.keep).toBe(3);
	});

	test("is idempotent", () => {
		const msg: Record<string, unknown> = {
			role: "assistant",
			content: "x",
			reasoning_content: "y",
		};
		stripNonStandardFields(msg);
		stripNonStandardFields(msg);
		expect(msg.reasoning_content).toBeUndefined();
		expect(msg.content).toBe("x");
	});

	test("no-op on absent fields", () => {
		const msg: Record<string, unknown> = { role: "assistant", content: "x" };
		expect(() => stripNonStandardFields(msg)).not.toThrow();
		expect(msg.content).toBe("x");
	});
});

describe("error classes", () => {
	test("ProviderError formats as 'provider.<field>: <msg>'", () => {
		const e = new ProviderError("grammar.retry", "test");
		expect(e.message).toBe("provider.grammar.retry: test");
		expect(e.name).toBe("ProviderError");
	});

	test("NetworkError extends ProviderError and carries URL + status", () => {
		const e = new NetworkError("http://x", 500, "boom");
		expect(e).toBeInstanceOf(ProviderError);
		expect(e.url).toBe("http://x");
		expect(e.status).toBe(500);
		expect(e.message).toContain("http://x");
		expect(e.message).toContain("500");
		expect(e.name).toBe("NetworkError");
	});

	test("GrammarRetryExhaustedError carries attempt count + reason", () => {
		const e = new GrammarRetryExhaustedError(2, "parse_failure");
		expect(e).toBeInstanceOf(ProviderError);
		expect(e.message).toContain("2");
		expect(e.message).toContain("parse_failure");
		expect(e.attempts).toBe(2);
	});
});

describe("package-root exports (W1 re-export audit)", () => {
	test("postChat is importable from the bare package name", () => {
		// If this file even compiles and runs, the subpath-free import at the top resolved.
		expect(typeof postChat).toBe("function");
	});

	test("stripNonStandardFields is importable from the bare package name", () => {
		expect(typeof stripNonStandardFields).toBe("function");
	});
});
