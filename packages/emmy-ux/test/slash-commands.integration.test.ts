// packages/emmy-ux/test/slash-commands.integration.test.ts
//
// Phase 3.1 Plan 03.1-01 Task 2 — integration tests wiring /compact and /clear
// through createEmmyExtension. Plan D: interactive-mode end-to-end; Plan E:
// non-interactive ensures /clear does NOT call newSession.
//
// Strategy: we supply a minimal ExtensionAPI stub that captures registered
// commands; then we invoke createEmmyExtension(opts)(pi) and drive the
// captured handlers with fake ExtensionCommandContext objects. This is
// lighter than spinning up a real pi AgentSession (which doesn't offer a
// simple in-memory ExtensionAPI for test use) while still exercising the
// factory-level wiring that Task 2 Step 2 specifies.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { ProfileSnapshot } from "@emmy/provider";
import { createEmmyExtension } from "../src/pi-emmy-extension";

function buildProfile(bundlePath: string): ProfileSnapshot {
	return {
		ref: {
			id: "test-profile",
			version: "v3.1",
			hash: "sha256:aa",
			path: bundlePath,
		},
		serving: {
			engine: { served_model_name: "t", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.2, top_p: 0.95, max_tokens: 1024 },
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: {
			tools: { format: "openai", grammar: null, per_tool_sampling: {} },
			agent_loop: { retry_on_unparseable_tool_call: 1 },
			context: {
				max_input_tokens: 114688,
				compaction: {
					soft_threshold_pct: 0.75,
					preserve_recent_turns: 5,
					summarization_prompt_path: "prompts/compact.md",
					preserve_tool_results: "error_only",
				},
			},
		} as unknown as ProfileSnapshot["harness"],
	};
}

function withProfileBundle(
	work: (ctx: { dir: string; profile: ProfileSnapshot; promptText: string }) => Promise<void>,
	opts?: { writePrompt?: boolean },
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "emmy-slash-int-"));
	const promptText = "PROFILE COMPACT PROMPT v3.1: preserve pins + errors + TODO.";
	try {
		if (opts?.writePrompt !== false) {
			mkdirSync(join(dir, "prompts"), { recursive: true });
			writeFileSync(join(dir, "prompts", "compact.md"), promptText);
		}
		const profile = buildProfile(dir);
		return work({ dir, profile, promptText }).finally(() => {
			rmSync(dir, { recursive: true, force: true });
		});
	} catch (err) {
		rmSync(dir, { recursive: true, force: true });
		throw err;
	}
}

function captureExtensionCommands() {
	const commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = new Map();
	const shortcuts: Array<[string, unknown]> = [];
	const eventHandlers: Array<[string, unknown]> = [];
	const api = {
		on: (event: string, handler: unknown) => {
			eventHandlers.push([event, handler]);
		},
		registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands.set(name, options);
		},
		registerShortcut: (keyId: string, options: unknown) => {
			shortcuts.push([keyId, options]);
		},
		registerTool: () => {},
		registerFlag: () => {},
		registerMessageRenderer: () => {},
	};
	return { api, commands, shortcuts, eventHandlers };
}

describe("createEmmyExtension — slash commands (Plan 03.1-01 Task 2)", () => {
	// ------------------------------------------------------------------------
	// Test D — /compact invokes ctx.compact with profile prompt
	// ------------------------------------------------------------------------
	test("Test D: /compact invokes ctx.compact with profile compact.md contents", async () => {
		await withProfileBundle(async ({ profile, promptText }) => {
			const { api, commands } = captureExtensionCommands();
			const factory = createEmmyExtension({
				profile,
				assembledPromptProvider: () => ({ sha256: "deadbeef", text: "SP" } as never),
				telemetryEnabled: false, // skip feedback shortcut reg to keep spy sharp
			});
			factory(api as never);

			expect(commands.has("compact")).toBe(true);
			const handler = commands.get("compact")!.handler;

			const compactCalls: Array<{ customInstructions?: string }> = [];
			const fakeCtx = {
				compact: (o?: { customInstructions?: string }) => compactCalls.push(o ?? {}),
				ui: { setStatus: () => {} },
			};

			await handler("", fakeCtx);
			expect(compactCalls.length).toBe(1);
			expect(compactCalls[0]!.customInstructions).toBe(promptText);

			await handler("focus on design decisions", fakeCtx);
			expect(compactCalls.length).toBe(2);
			expect(compactCalls[1]!.customInstructions).toContain(promptText);
			expect(compactCalls[1]!.customInstructions).toContain("focus on design decisions");
		});
	});

	// ------------------------------------------------------------------------
	// Test D-clear — /clear interactive: confirm→abort→waitForIdle→newSession
	// ------------------------------------------------------------------------
	test("Test D-clear: /clear interactive runs confirm → abort → waitForIdle → newSession in order", async () => {
		await withProfileBundle(async ({ profile }) => {
			const { api, commands } = captureExtensionCommands();
			createEmmyExtension({
				profile,
				assembledPromptProvider: () => ({ sha256: "deadbeef", text: "SP" } as never),
				telemetryEnabled: false,
			})(api as never);

			expect(commands.has("clear")).toBe(true);
			const handler = commands.get("clear")!.handler;

			const order: string[] = [];
			const fakeCtx = {
				hasUI: true,
				ui: {
					confirm: async () => {
						order.push("confirm");
						return true;
					},
					notify: () => {},
					setStatus: () => {},
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
			await handler("", fakeCtx);
			expect(order).toEqual(["confirm", "abort", "waitForIdle", "newSession"]);
		});
	});

	// ------------------------------------------------------------------------
	// Test E — /clear non-interactive fails with hint; newSession NOT called
	// ------------------------------------------------------------------------
	test("Test E: /clear non-interactive (hasUI=false) notifies hint; newSession NOT called", async () => {
		await withProfileBundle(async ({ profile }) => {
			const { api, commands } = captureExtensionCommands();
			createEmmyExtension({
				profile,
				assembledPromptProvider: () => ({ sha256: "deadbeef", text: "SP" } as never),
				telemetryEnabled: false,
			})(api as never);
			const handler = commands.get("clear")!.handler;

			let newSessionCalled = false;
			const notifyMessages: string[] = [];
			const fakeCtx = {
				hasUI: false,
				ui: {
					confirm: async () => true,
					notify: (msg: string) => notifyMessages.push(msg),
					setStatus: () => {},
				},
				abort: () => {},
				waitForIdle: async () => {},
				newSession: async () => {
					newSessionCalled = true;
					return { cancelled: false };
				},
			};
			await handler("", fakeCtx);
			expect(newSessionCalled).toBe(false);
			expect(notifyMessages.length).toBeGreaterThan(0);
			expect(notifyMessages[0]).toMatch(/interactive/i);
		});
	});

	// ------------------------------------------------------------------------
	// Test D-missing — when profile compact.md is missing, /compact passes
	// empty customInstructions (D-16 fallback into pi's built-in prompt)
	// ------------------------------------------------------------------------
	test("Test D-missing: /compact with missing profile prompt passes empty customInstructions", async () => {
		await withProfileBundle(
			async ({ profile }) => {
				const { api, commands } = captureExtensionCommands();
				createEmmyExtension({
					profile,
					assembledPromptProvider: () => ({ sha256: "deadbeef", text: "SP" } as never),
					telemetryEnabled: false,
				})(api as never);
				const handler = commands.get("compact")!.handler;

				const compactCalls: Array<{ customInstructions?: string }> = [];
				await handler("", {
					compact: (o?: { customInstructions?: string }) => compactCalls.push(o ?? {}),
					ui: { setStatus: () => {} },
				});
				expect(compactCalls[0]!.customInstructions).toBe("");
			},
			{ writePrompt: false },
		);
	});
});
