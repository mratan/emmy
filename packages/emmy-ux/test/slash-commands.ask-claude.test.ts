// packages/emmy-ux/test/slash-commands.ask-claude.test.ts
//
// Plan 04.6-04 Task 1 — Bun unit tests for the /ask-claude operator slash
// command (D-05 LOCKED: slash bypasses model-side gating; sidecar global
// rate-limit still applies). D-14 LOCKED: identical UX between pi-emmy
// (Spark loopback) and emmy (Mac tailnet) — both routes resolve through
// EMMY_SERVE_URL precedence in the sidecar HTTP client; this layer just
// dispatches through `callAskClaude` injected at factory wire-up.
//
// Strategy: build a fake `pi: ExtensionAPI` that captures registered
// commands by name (same makeFakePi shape used by
// slash-commands.start-stop-status.test.ts), then drive the handler with
// fake CmdCtx objects. Assert handler behavior covers:
//
//   - Registration: /ask-claude command name + description present
//   - Empty prompt → notify error, callAskClaude NOT called
//   - Happy path → callAskClaude with trimmed prompt, response rendered via
//     ctx.ui.notify(info)
//   - Sidecar 503 env_disabled → notify error with EMMY_ASK_CLAUDE hint
//   - Sidecar 503 claude_cli_not_found → notify error with install hint
//   - Sidecar 400 scrubber_blocked → notify error with pattern_class
//   - Sidecar 429 rate_limited_* (concurrent / min_gap / hourly) → notify
//     error mentioning "rate" and the specific reason
//   - Sidecar 504 timeout / 500 subprocess_failed → notify error with detail

import { describe, expect, test } from "bun:test";

// Helper to build a fake pi.registerCommand spy. Mirrors the shape used by
// slash-commands.start-stop-status.test.ts so the testing pattern is uniform
// across the three slash-command test files (start/stop/status, profile,
// ask-claude).
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

// Minimal ctx shape for /ask-claude — read-only, no isIdle gate, no
// confirm. Mirrors StatusCmdCtx (the read-only pattern).
function makeAskClaudeCtx(): {
	ctx: unknown;
	notifyCalls: Array<[string, string]>;
} {
	const notifyCalls: Array<[string, string]> = [];
	const ctx = {
		ui: {
			notify: (msg: string, type?: "info" | "warning" | "error") => {
				notifyCalls.push([type ?? "info", msg]);
			},
		},
	};
	return { ctx, notifyCalls };
}

// ============================================================================
// registerAskClaudeCommand
// ============================================================================

describe("registerAskClaudeCommand", () => {
	test("registers '/ask-claude' command with description", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => ({
				response: "ok",
				duration_ms: 100,
				rate_limit_remaining_hour: 29,
			}),
		});
		const cmd = registered.find((r) => r.name === "ask-claude");
		expect(cmd).toBeDefined();
		expect(cmd!.options.description).toBeDefined();
		expect(typeof cmd!.options.description).toBe("string");
	});

	test("happy path: dispatches trimmed prompt, prints response via notify(info)", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		const calls: string[] = [];
		registerAskClaudeCommand(pi, {
			callAskClaude: async (prompt: string) => {
				calls.push(prompt);
				return {
					response: "the answer is 4",
					duration_ms: 1234,
					rate_limit_remaining_hour: 29,
				};
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		// Trailing whitespace exercises the trim() — sidecar will see the
		// prompt verbatim, so trimming client-side avoids "  what is 2+2  "
		// counting against scrubber/audit length.
		await cmd.options.handler("  what is 2+2  ", ctx);
		expect(calls).toEqual(["what is 2+2"]);
		expect(notifyCalls.length).toBe(1);
		expect(notifyCalls[0]![0]).toBe("info");
		expect(notifyCalls[0]![1]).toContain("the answer is 4");
		// 04.6-04 followup A — notify echoes the operator's TRIMMED prompt at
		// the top so the conversation log is self-documenting after pi-mono
		// clears the input box on slash-command submit.
		expect(notifyCalls[0]![1]).toContain("> /ask-claude what is 2+2");
		// Echo MUST appear before the response (operator visual scan order).
		const msg = notifyCalls[0]![1];
		expect(msg.indexOf("> /ask-claude")).toBeLessThan(msg.indexOf("the answer is 4"));
	});

	test("empty prompt → notify error, callAskClaude NOT called", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		let callAskCalled = false;
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				callAskCalled = true;
				return {
					response: "",
					duration_ms: 0,
					rate_limit_remaining_hour: 30,
				};
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("", ctx);
		expect(callAskCalled).toBe(false);
		expect(notifyCalls.length).toBe(1);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/requires a question/i);
	});

	test("whitespace-only prompt → notify error, callAskClaude NOT called", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		let callAskCalled = false;
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				callAskCalled = true;
				return {
					response: "",
					duration_ms: 0,
					rate_limit_remaining_hour: 30,
				};
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("   \t\n  ", ctx);
		expect(callAskCalled).toBe(false);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/requires a question/i);
	});

	test("sidecar 503 env_disabled → notify error with EMMY_ASK_CLAUDE hint", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string } = new Error(
					"sidecar HTTP 503",
				);
				err.reason = "env_disabled";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("what is 2+2", ctx);
		expect(notifyCalls.length).toBe(1);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/EMMY_ASK_CLAUDE/);
	});

	test("sidecar 503 claude_cli_not_found → notify error with install hint", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string } = new Error(
					"sidecar HTTP 503",
				);
				err.reason = "claude_cli_not_found";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hello", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/claude.*PATH|claude.*not found|install/i);
	});

	test("sidecar 400 scrubber_blocked → notify error mentioning pattern_class", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & {
					reason?: string;
					pattern_class?: string;
				} = new Error("scrubber blocked");
				err.reason = "scrubber_blocked";
				err.pattern_class = "aws_access_key_id";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("AKIAIOSFODNN7EXAMPLE", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/aws_access_key_id/);
	});

	test("sidecar 400 scrubber_blocked without pattern_class → still notifies error", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string } = new Error(
					"scrubber blocked",
				);
				err.reason = "scrubber_blocked";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hello", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/scrubber|secret pattern/i);
	});

	test("sidecar 429 rate_limited_hourly → notify error mentioning rate-limit", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string } = new Error(
					"rate limited",
				);
				err.reason = "rate_limited_hourly";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hi", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/rate.?limit/i);
		expect(notifyCalls[0]![1]).toMatch(/hourly/i);
	});

	test("sidecar 429 rate_limited_concurrent → notify error mentioning concurrent", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string } = new Error(
					"rate limited",
				);
				err.reason = "rate_limited_concurrent";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hi", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/rate.?limit/i);
		expect(notifyCalls[0]![1]).toMatch(/concurrent/i);
	});

	test("sidecar 429 rate_limited_min_gap → notify error mentioning min-gap", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string } = new Error(
					"rate limited",
				);
				err.reason = "rate_limited_min_gap";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hi", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/rate.?limit/i);
		expect(notifyCalls[0]![1]).toMatch(/min.?gap/i);
	});

	test("sidecar 504 timeout → notify error mentioning timeout", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string } = new Error(
					"timeout",
				);
				err.reason = "timeout";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hi", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/timeout/i);
	});

	test("sidecar 500 subprocess_failed → notify error mentioning subprocess", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				const err: Error & { reason?: string; detail?: string } =
					new Error("subprocess failed");
				err.reason = "subprocess_failed";
				err.detail = "exit_code=2";
				throw err;
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hi", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/subprocess|claude.*invocation/i);
	});

	test("unknown error reason → notify error with err.message fallback", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				throw new Error("network unreachable");
			},
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("hi", ctx);
		expect(notifyCalls[0]![0]).toBe("error");
		expect(notifyCalls[0]![1]).toMatch(/network unreachable|unknown/i);
	});

	test("response notify includes duration_ms + rate_limit_remaining_hour", async () => {
		const { registerAskClaudeCommand } = await import(
			"../src/slash-commands"
		);
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => ({
				response: "42",
				duration_ms: 5678,
				rate_limit_remaining_hour: 17,
			}),
		});
		const cmd = registered.find((r) => r.name === "ask-claude")!;
		const { ctx, notifyCalls } = makeAskClaudeCtx();
		await cmd.options.handler("the meaning?", ctx);
		expect(notifyCalls.length).toBe(1);
		expect(notifyCalls[0]![0]).toBe("info");
		// Operator wants to see the response, the elapsed time, and the
		// remaining quota at a glance — all three appear in the same line.
		expect(notifyCalls[0]![1]).toContain("42");
		expect(notifyCalls[0]![1]).toContain("5678");
		expect(notifyCalls[0]![1]).toContain("17");
	});
});

// ============================================================================
// callAskClaude — sidecar HTTP client (separate module: ask-claude-client.ts)
// ============================================================================
//
// Mirrors getSidecarStatus from sidecar-status-client.ts: pure POST→JSON
// wrapper that throws an Error with a `.reason` field on non-2xx so the
// slash command can surface a structured error message.

describe("callAskClaude (sidecar HTTP client)", () => {
	test("POST {prompt} → returns AskClaudeResponse on 200", async () => {
		const { callAskClaude } = await import("../src/ask-claude-client");
		// Inject fake fetch via DI signature.
		const result = await callAskClaude({
			baseUrl: "http://127.0.0.1:8003",
			prompt: "what is 2+2",
			fetchImpl: async (url, init) => {
				expect(url).toBe("http://127.0.0.1:8003/ask-claude");
				expect(init?.method).toBe("POST");
				expect(init?.headers).toMatchObject({
					"content-type": "application/json",
				});
				const body = JSON.parse(init?.body as string) as {
					prompt: string;
				};
				expect(body.prompt).toBe("what is 2+2");
				return new Response(
					JSON.stringify({
						response: "the answer is 4",
						duration_ms: 100,
						rate_limit_remaining_hour: 29,
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});
		expect(result.response).toBe("the answer is 4");
		expect(result.duration_ms).toBe(100);
		expect(result.rate_limit_remaining_hour).toBe(29);
	});

	test("strips trailing slash from baseUrl", async () => {
		const { callAskClaude } = await import("../src/ask-claude-client");
		await callAskClaude({
			baseUrl: "http://127.0.0.1:8003/",
			prompt: "hi",
			fetchImpl: async (url) => {
				expect(url).toBe("http://127.0.0.1:8003/ask-claude");
				return new Response(
					JSON.stringify({
						response: "ok",
						duration_ms: 1,
						rate_limit_remaining_hour: 1,
					}),
					{ status: 200 },
				);
			},
		});
	});

	test("503 env_disabled → throws Error with reason=env_disabled", async () => {
		const { callAskClaude } = await import("../src/ask-claude-client");
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "hi",
				fetchImpl: async () =>
					new Response(JSON.stringify({ detail: { reason: "env_disabled" } }), {
						status: 503,
						headers: { "content-type": "application/json" },
					}),
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect((err as Error & { reason?: string }).reason).toBe("env_disabled");
		}
	});

	test("400 scrubber_blocked with pattern_class → throws with both fields", async () => {
		const { callAskClaude } = await import("../src/ask-claude-client");
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "AKIA...",
				fetchImpl: async () =>
					new Response(
						JSON.stringify({
							detail: {
								reason: "scrubber_blocked",
								pattern_class: "aws_access_key_id",
							},
						}),
						{
							status: 400,
							headers: { "content-type": "application/json" },
						},
					),
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			const e = err as Error & {
				reason?: string;
				pattern_class?: string;
			};
			expect(e.reason).toBe("scrubber_blocked");
			expect(e.pattern_class).toBe("aws_access_key_id");
		}
	});

	test("429 rate_limited_hourly → throws with reason", async () => {
		const { callAskClaude } = await import("../src/ask-claude-client");
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "hi",
				fetchImpl: async () =>
					new Response(
						JSON.stringify({
							detail: { reason: "rate_limited_hourly" },
						}),
						{
							status: 429,
							headers: { "content-type": "application/json" },
						},
					),
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as Error & { reason?: string }).reason).toBe(
				"rate_limited_hourly",
			);
		}
	});

	test("non-JSON body on error → throws with reason='unknown' and statusText in message", async () => {
		const { callAskClaude } = await import("../src/ask-claude-client");
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "hi",
				fetchImpl: async () =>
					new Response("Internal Server Error", {
						status: 500,
						statusText: "Internal Server Error",
					}),
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			const e = err as Error & { reason?: string };
			expect(e.reason).toBe("unknown");
			expect(e.message).toMatch(/500/);
		}
	});

	test("flat body shape (no detail wrapper) is also tolerated", async () => {
		// FastAPI emits {detail: {...}} for HTTPException, but a minimal
		// FastAPI handler that sets response_model directly might emit
		// {reason: "..."} flat. Accept both shapes — slash command should
		// not be tied to FastAPI's specific envelope.
		const { callAskClaude } = await import("../src/ask-claude-client");
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "hi",
				fetchImpl: async () =>
					new Response(JSON.stringify({ reason: "env_disabled" }), {
						status: 503,
						headers: { "content-type": "application/json" },
					}),
			});
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as Error & { reason?: string }).reason).toBe(
				"env_disabled",
			);
		}
	});
});

// ============================================================================
// 04.6-04 followup — elapsed-time progress indicator
//
// User-reported UX gap after the live SC-1 walkthrough: while the sidecar
// round-trip is in flight (~10-30s in v1), the TUI showed nothing. Fix:
// setStatus("emmy.ask_claude", "Asking Claude…") before await, ticker
// updates every 1s with elapsed seconds, cleared in finally.
// ============================================================================

describe("registerAskClaudeCommand — progress indicator (followup)", () => {
	function makeAskClaudeCtxWithSetStatus(): {
		ctx: unknown;
		notifyCalls: Array<[string, string]>;
		statusCalls: Array<[string, string | undefined]>;
	} {
		const notifyCalls: Array<[string, string]> = [];
		const statusCalls: Array<[string, string | undefined]> = [];
		const ctx = {
			ui: {
				notify: (msg: string, type?: "info" | "warning" | "error") => {
					notifyCalls.push([type ?? "info", msg]);
				},
				setStatus: (key: string, text: string | undefined) => {
					statusCalls.push([key, text]);
				},
			},
		};
		return { ctx, notifyCalls, statusCalls };
	}

	test("setStatus fires 'Asking Claude…' before the call and clears after success", async () => {
		const { registerAskClaudeCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => ({
				response: "ok",
				duration_ms: 50,
				rate_limit_remaining_hour: 29,
			}),
		});
		const { ctx, statusCalls } = makeAskClaudeCtxWithSetStatus();
		await registered[0]?.options.handler("hello", ctx);

		// First call: initial "Asking Claude…" status set before the await.
		expect(statusCalls[0]).toEqual(["emmy.ask_claude", "Asking Claude…"]);
		// Last call: cleared (undefined) in the finally block.
		expect(statusCalls[statusCalls.length - 1]).toEqual([
			"emmy.ask_claude",
			undefined,
		]);
	});

	test("setStatus clears in finally even when callAskClaude throws", async () => {
		const { registerAskClaudeCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				throw Object.assign(new Error("boom"), { reason: "subprocess_failed" });
			},
		});
		const { ctx, statusCalls } = makeAskClaudeCtxWithSetStatus();
		await registered[0]?.options.handler("hello", ctx);

		// Initial status was set...
		expect(statusCalls[0]).toEqual(["emmy.ask_claude", "Asking Claude…"]);
		// ...AND the finally cleanup ran on the error path.
		expect(statusCalls[statusCalls.length - 1]).toEqual([
			"emmy.ask_claude",
			undefined,
		]);
	});

	test("graceful degrade when ctx.ui.setStatus is missing (legacy host)", async () => {
		const { registerAskClaudeCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => ({
				response: "ok",
				duration_ms: 50,
				rate_limit_remaining_hour: 29,
			}),
		});
		const { ctx, notifyCalls } = makeAskClaudeCtx(); // no setStatus on this ctx
		// Must not throw even though the handler tries to use setStatus.
		await registered[0]?.options.handler("hello", ctx);
		expect(notifyCalls.length).toBe(1);
		expect(notifyCalls[0]?.[0]).toBe("info");
		expect(notifyCalls[0]?.[1]).toContain("Claude");
	});

	test("setStatus is NOT called for empty-prompt rejection (early return before progress wiring)", async () => {
		const { registerAskClaudeCommand } = await import("../src/slash-commands");
		const { pi, registered } = makeFakePi();
		registerAskClaudeCommand(pi, {
			callAskClaude: async () => {
				throw new Error("should not be called for empty prompt");
			},
		});
		const { ctx, statusCalls, notifyCalls } = makeAskClaudeCtxWithSetStatus();
		await registered[0]?.options.handler("   ", ctx); // whitespace-only

		// Empty-prompt path returns BEFORE the progress wiring is set up.
		expect(statusCalls.length).toBe(0);
		// The error notify still fires.
		expect(notifyCalls[0]?.[0]).toBe("error");
	});
});
