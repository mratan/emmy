// packages/emmy-ux/test/profile-command.integration.test.ts
//
// Plan 04-03 Task 2 — integration tests wiring /profile through
// createEmmyExtension. Parallels slash-commands.integration.test.ts's shape.
//
// Strategy: supply a minimal ExtensionAPI stub that captures registered
// commands, then invoke createEmmyExtension({...profileDir, ...runSwapImpl,
// ...})(pi). Assert:
//   - /profile is registered when profileDir is supplied
//   - /profile is NOT registered when profileDir is omitted
//   - /clear is still registered regardless (no displacement)
//   - profilesRoot defaults to "profiles" when omitted
//   - injected runSwapImpl reaches the handler (driven end-to-end)
//
// Real DGX Spark swap execution is deferred to Plan 04-06 (operator-gated).

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

type CapturedHandler = (args: string, ctx: unknown) => Promise<void>;

function captureExtensionCommands() {
	const commands: Map<string, {
		handler: CapturedHandler;
		description?: string;
		getArgumentCompletions?: (prefix: string) => unknown;
	}> = new Map();
	const shortcuts: Array<[string, unknown]> = [];
	const eventHandlers: Array<[string, unknown]> = [];
	const api = {
		on: (event: string, handler: unknown) => {
			eventHandlers.push([event, handler]);
		},
		registerCommand: (
			name: string,
			options: {
				handler: CapturedHandler;
				description?: string;
				getArgumentCompletions?: (prefix: string) => unknown;
			},
		) => {
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

function withProfileBundle(
	work: (ctx: { dir: string; profile: ProfileSnapshot }) => Promise<void>,
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "emmy-profile-int-"));
	try {
		mkdirSync(join(dir, "prompts"), { recursive: true });
		writeFileSync(
			join(dir, "prompts", "compact.md"),
			"PROFILE COMPACT PROMPT.",
		);
		const profile = buildProfile(dir);
		return work({ dir, profile }).finally(() => {
			rmSync(dir, { recursive: true, force: true });
		});
	} catch (err) {
		rmSync(dir, { recursive: true, force: true });
		throw err;
	}
}

describe("createEmmyExtension — /profile wiring (Plan 04-03)", () => {
	test("/profile IS registered when opts.profileDir is supplied", async () => {
		await withProfileBundle(async ({ dir, profile }) => {
			const { api, commands } = captureExtensionCommands();
			createEmmyExtension({
				profile,
				assembledPromptProvider: () =>
					({ sha256: "deadbeef", text: "SP" } as never),
				telemetryEnabled: false,
				profileDir: dir,
				port: 8002,
				profilesRoot: "/tmp/definitely-nonexistent-profiles-root",
				runSwapImpl: async () => ({ exit: 0 }),
			})(api as never);

			expect(commands.has("profile")).toBe(true);
			const entry = commands.get("profile")!;
			expect(entry.description).toMatch(/Swap to a different profile/);
			expect(typeof entry.getArgumentCompletions).toBe("function");
		});
	});

	test("/profile is NOT registered when opts.profileDir is omitted", async () => {
		await withProfileBundle(async ({ profile }) => {
			const { api, commands } = captureExtensionCommands();
			createEmmyExtension({
				profile,
				assembledPromptProvider: () =>
					({ sha256: "deadbeef", text: "SP" } as never),
				telemetryEnabled: false,
				// profileDir intentionally omitted
			})(api as never);

			expect(commands.has("profile")).toBe(false);
			// /clear is still present — no displacement.
			expect(commands.has("clear")).toBe(true);
		});
	});

	test("both /profile AND /clear are registered when profileDir is supplied (no displacement)", async () => {
		await withProfileBundle(async ({ dir, profile }) => {
			const { api, commands } = captureExtensionCommands();
			createEmmyExtension({
				profile,
				assembledPromptProvider: () =>
					({ sha256: "deadbeef", text: "SP" } as never),
				telemetryEnabled: false,
				profileDir: dir,
				profilesRoot: "/tmp/no-profiles-here",
				runSwapImpl: async () => ({ exit: 0 }),
			})(api as never);

			expect(commands.has("profile")).toBe(true);
			expect(commands.has("clear")).toBe(true);
		});
	});

	test("profilesRoot defaults to 'profiles' when omitted (no crash on missing dir)", async () => {
		await withProfileBundle(async ({ dir, profile }) => {
			const { api, commands } = captureExtensionCommands();
			// NO profilesRoot set — factory falls back to "profiles" relative
			// to cwd. Passing an invalid CWD would throw, so we just ensure
			// the factory didn't error during scanProfileIndex's fallback.
			expect(() =>
				createEmmyExtension({
					profile,
					assembledPromptProvider: () =>
						({ sha256: "deadbeef", text: "SP" } as never),
					telemetryEnabled: false,
					profileDir: dir,
					runSwapImpl: async () => ({ exit: 0 }),
				})(api as never),
			).not.toThrow();
			expect(commands.has("profile")).toBe(true);
		});
	});

	test("injected runSwapImpl flows through to /profile handler end-to-end", async () => {
		await withProfileBundle(async ({ dir, profile }) => {
			const { api, commands } = captureExtensionCommands();

			// Build a tiny profiles/ fixture so profileIndex.resolve returns
			// a real path for the /profile handler's argument.
			const profilesRoot = mkdtempSync(join(tmpdir(), "emmy-prof-root-"));
			try {
				mkdirSync(join(profilesRoot, "my-profile", "v1"), {
					recursive: true,
				});
				writeFileSync(
					join(profilesRoot, "my-profile", "v1", "profile.yaml"),
					"profile:\n  id: my-profile\n  version: v1\n",
				);

				let runSwapCalled = false;
				let runSwapArgs: { from?: string; to?: string; port?: number } = {};
				createEmmyExtension({
					profile,
					assembledPromptProvider: () =>
						({ sha256: "deadbeef", text: "SP" } as never),
					telemetryEnabled: false,
					profileDir: dir,
					port: 8002,
					profilesRoot,
					runSwapImpl: async (a) => {
						runSwapCalled = true;
						runSwapArgs = {
							from: a.from,
							to: a.to,
							port: a.port,
						};
						return { exit: 5 }; // pre-flight fail → no reload
					},
				})(api as never);

				const handler = commands.get("profile")!.handler;
				const notifies: Array<[string, string | undefined]> = [];
				const setStatuses: Array<[string, string | undefined]> = [];
				const ctx = {
					isIdle: () => true,
					ui: {
						confirm: async () => true,
						notify: (m: string, t?: string) => notifies.push([m, t]),
						setStatus: (k: string, v: string | undefined) =>
							setStatuses.push([k, v]),
					},
				};
				await handler("my-profile", ctx);

				expect(runSwapCalled).toBe(true);
				expect(runSwapArgs.from).toBe(dir);
				expect(runSwapArgs.to).toBe(
					join(profilesRoot, "my-profile", "v1"),
				);
				expect(runSwapArgs.port).toBe(8002);
				// Exit 5 → pre-flight fail notify
				expect(notifies[0]![0]).toBe(
					"swap pre-flight failed (prior model still serving)",
				);
			} finally {
				rmSync(profilesRoot, { recursive: true, force: true });
			}
		});
	});
});
