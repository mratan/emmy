// packages/emmy-context/test/compaction-live-wiring.test.ts
//
// Phase 3.1 Plan 03.1-01 Task 1 — RED tests for the live compaction wire
// through pi 0.68's ExtensionContext.compact({customInstructions}) surface.
//
// D-30 locks: the turn_start handler in pi-emmy-extension.ts invokes
// ctx.compact() DIRECTLY when emmyCompactionTrigger returns a directive with
// shouldCompact=true. The (now-deprecated) engine.summarize injection point
// stays around for stub-mode tests only; the live production path never
// touches it.
//
// Test coverage (all D-XX references from 03.1-CONTEXT.md + 03-CONTEXT.md):
//   Test 1: soft threshold crossed → directive populated with correct fields
//   Test 2: below threshold → directive.shouldCompact === false, no call planned
//   Test 3: runTurnStartCompaction calls ctx.compact with profile prompt contents
//   Test 4: missing profile prompt file → D-16 fallback event + directive with ""
//   Test 5: D-12 over-ceiling BEFORE compaction → SessionTooFullError; ctx.compact NOT called

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProfileSnapshot } from "@emmy/provider";
import {
	emmyCompactionTrigger,
	SessionTooFullError,
	type EmmyCompactionContext,
	type SessionEntry,
} from "../src";

// ----------------------------------------------------------------------------
// Fixture builders
// ----------------------------------------------------------------------------

function buildProfile(bundlePath: string, compactionBlock: unknown = {
	soft_threshold_pct: 0.75,
	preserve_recent_turns: 5,
	summarization_prompt_path: "prompts/compact.md",
	preserve_tool_results: "error_only",
}): ProfileSnapshot {
	return {
		ref: {
			id: "test-profile",
			version: "v3.1",
			hash: "sha256:dead",
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
				compaction: compactionBlock,
			},
		} as unknown as ProfileSnapshot["harness"],
	};
}

function buildFixture(totalTurns: number): SessionEntry[] {
	const entries: SessionEntry[] = [];
	entries.push({ uuid: "sys-0", role: "system", content: "SP\nprompt_sha256:abc" });
	entries.push({ uuid: "u-1", role: "user", content: "goal: refactor multi-file" });
	for (let i = 2; i < totalTurns; i++) {
		const role = i % 2 === 0 ? "assistant" : "tool";
		entries.push({
			uuid: `t-${i}`,
			role,
			content: "x".repeat(2000),
			isError: false,
			toolName: role === "tool" ? "bash" : undefined,
		});
	}
	return entries;
}

function withTempProfile(
	work: (ctx: { dir: string; profile: ProfileSnapshot }) => Promise<void>,
	opts?: { writePrompt?: boolean; compactionBlock?: unknown; promptContents?: string },
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "emmy-ctx-live-"));
	try {
		if (opts?.writePrompt !== false) {
			const promptDir = join(dir, "prompts");
			mkdirSync(promptDir, { recursive: true });
			writeFileSync(
				join(promptDir, "compact.md"),
				opts?.promptContents ?? "PROFILE COMPACT PROMPT: preserve errors + file pins + TODO state; drop chatter.",
			);
		}
		const profile = buildProfile(dir, opts?.compactionBlock ?? undefined);
		return work({ dir, profile }).finally(() => {
			rmSync(dir, { recursive: true, force: true });
		});
	} catch (err) {
		rmSync(dir, { recursive: true, force: true });
		throw err;
	}
}

// ----------------------------------------------------------------------------
// Test 1 — directive populated when soft threshold crossed
// ----------------------------------------------------------------------------

describe("emmyCompactionTrigger — live-wire directive", () => {
	test("Test 1: above soft threshold returns directive with shouldCompact=true + prompt text (live-wire, no engine injected)", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(50);
			// Pass pre-computed tokens such that ratio > 0.75 of 131072 = 98304.
			// NOTE: no `engine` injected — this is the LIVE production path.
			// The default engine's summarize() throws "not configured", but the
			// trigger must NOT reach it: when engine is absent, the trigger
			// returns a directive and lets the turn_start handler drive
			// pi's ctx.compact() instead (D-30).
			const events: unknown[] = [];
			const ctx: EmmyCompactionContext = {
				profile,
				entries,
				contextTokens: 100_000, // > 0.75 * 131072
				contextWindow: 131072,
				eventType: "turn_start",
				model: {},
				apiKey: "unused",
				emitEvent: (r) => events.push(r),
			};

			const result = await emmyCompactionTrigger(ctx);
			// The live-wire path returns a directive instead of actually running
			// summarize. ran=false means "we did not compact internally"; the
			// caller (turn_start handler) reads the directive and drives
			// ctx.compact() itself.
			expect(result.directive).toBeDefined();
			expect(result.directive!.shouldCompact).toBe(true);
			expect(result.directive!.reason).toBe("soft_threshold");
			expect(typeof result.directive!.customInstructions).toBe("string");
			expect(result.directive!.customInstructions).toContain("PROFILE COMPACT PROMPT");
			expect(result.directive!.preservation).toBeInstanceOf(Set);
			expect(result.directive!.preservation.size).toBeGreaterThan(0);
			expect(result.directive!.tokensBefore).toBe(100_000);
			// Trigger event must have fired.
			expect(events.some((e) => (e as { event?: string }).event === "session.compaction.trigger")).toBe(true);
			// ran must be false — we did not compact internally.
			expect(result.ran).toBe(false);
		});
	});

	// ------------------------------------------------------------------------
	// Test 2 — below threshold: no directive / shouldCompact false
	// ------------------------------------------------------------------------

	test("Test 2: below soft threshold returns directive.shouldCompact=false with empty instructions", async () => {
		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(10);
			const ctx: EmmyCompactionContext = {
				profile,
				entries,
				contextTokens: 10_000, // well below 0.75 * 131072 = 98304
				contextWindow: 131072,
				eventType: "turn_start",
				model: {},
				apiKey: "unused",
				emitEvent: () => {},
			};

			const result = await emmyCompactionTrigger(ctx);
			// Below threshold: ran=false AND directive either absent or has
			// shouldCompact=false with empty customInstructions. Either shape is
			// acceptable; the caller's check is `result.directive?.shouldCompact`.
			if (result.directive) {
				expect(result.directive.shouldCompact).toBe(false);
				expect(result.directive.customInstructions).toBe("");
			} else {
				expect(result.ran).toBe(false);
			}
		});
	});

	// ------------------------------------------------------------------------
	// Test 3 — runTurnStartCompaction helper calls ctx.compact() on spy
	// ------------------------------------------------------------------------

	test("Test 3: runTurnStartCompaction invokes ctx.compact with profile prompt contents", async () => {
		// Dynamic import to break any module-load ordering between @emmy/context
		// and @emmy/ux. runTurnStartCompaction is exported from emmy-ux per
		// Plan 03.1-01 <action> Step 4.
		const { runTurnStartCompaction } = await import("@emmy/ux");

		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(50);
			const compactCalls: Array<{ customInstructions?: string }> = [];
			const statusCalls: Array<[string, string | undefined]> = [];
			const fakeCtx = {
				getContextUsage: () => ({ tokens: 100_000, contextWindow: 131072, percent: 0.76 }),
				sessionManager: {
					getEntries: () =>
						entries.map((e) => ({
							id: e.uuid,
							type: "message",
							message: {
								role: e.role,
								content: e.content,
								isError: e.isError,
								toolName: e.toolName,
							},
						})),
				},
				model: {},
				ui: {
					setStatus: (k: string, t: string | undefined) => statusCalls.push([k, t]),
				},
				hasUI: true,
				compact: (options?: { customInstructions?: string }) => {
					compactCalls.push(options ?? {});
				},
			};

			await runTurnStartCompaction(fakeCtx as unknown as Parameters<typeof runTurnStartCompaction>[0], profile);

			expect(compactCalls.length).toBe(1);
			expect(compactCalls[0]!.customInstructions).toContain("PROFILE COMPACT PROMPT");
			// Status should have been set to indicate live compaction firing.
			const statusKeys = statusCalls.map(([k]) => k);
			expect(statusKeys).toContain("emmy.last_compaction");
		});
	});

	test("Test 3b: runTurnStartCompaction does NOT call ctx.compact when below threshold", async () => {
		const { runTurnStartCompaction } = await import("@emmy/ux");

		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(10);
			const compactCalls: unknown[] = [];
			const fakeCtx = {
				getContextUsage: () => ({ tokens: 10_000, contextWindow: 131072, percent: 0.08 }),
				sessionManager: {
					getEntries: () => entries.map((e) => ({ id: e.uuid, type: "message", message: { role: e.role, content: e.content } })),
				},
				model: {},
				ui: { setStatus: () => {} },
				hasUI: true,
				compact: (o?: unknown) => {
					compactCalls.push(o);
				},
			};

			await runTurnStartCompaction(fakeCtx as unknown as Parameters<typeof runTurnStartCompaction>[0], profile);
			expect(compactCalls.length).toBe(0);
		});
	});

	// ------------------------------------------------------------------------
	// Test 4 — missing compact.md file → D-16 fallback event + directive
	// ------------------------------------------------------------------------

	test("Test 4: missing profile prompt file emits session.compaction.fallback + directive with empty instructions", async () => {
		await withTempProfile(
			async ({ profile }) => {
				const entries = buildFixture(50);
				const events: unknown[] = [];
				const ctx: EmmyCompactionContext = {
					profile,
					entries,
					contextTokens: 100_000,
					contextWindow: 131072,
					eventType: "turn_start",
					model: {},
					apiKey: "unused",
					emitEvent: (r) => events.push(r),
				};

				const result = await emmyCompactionTrigger(ctx);
				// D-16 fallback event must have fired.
				const fallbackEvent = events.find(
					(e) => (e as { event?: string }).event === "session.compaction.fallback",
				) as { event: string; error?: string } | undefined;
				expect(fallbackEvent).toBeDefined();
				expect(fallbackEvent!.error).toMatch(/compaction prompt missing/i);

				// Directive must still indicate shouldCompact=true (caller should
				// call ctx.compact({}) with empty customInstructions; pi's
				// built-in SUMMARIZATION_SYSTEM_PROMPT takes over).
				expect(result.directive).toBeDefined();
				expect(result.directive!.shouldCompact).toBe(true);
				expect(result.directive!.customInstructions).toBe("");
			},
			{ writePrompt: false },
		);
	});

	// ------------------------------------------------------------------------
	// Test 5 — D-12 pre-ceiling guard: over-ceiling BEFORE compaction throws;
	// ctx.compact NOT called (turn_start handler aborts at the trigger).
	// ------------------------------------------------------------------------

	test("Test 5: D-12 pre-ceiling overflow throws SessionTooFullError; ctx.compact NOT called", async () => {
		const { runTurnStartCompaction } = await import("@emmy/ux");

		await withTempProfile(async ({ profile }) => {
			const entries = buildFixture(500);
			const compactCalls: unknown[] = [];
			// Simulate an already-over-ceiling state: contextTokens > max_input_tokens.
			// The trigger MUST raise SessionTooFullError at entry; ctx.compact never
			// invoked because there's nothing to compact from below.
			const fakeCtx = {
				getContextUsage: () => ({
					tokens: 120_000, // > 114688 max_input_tokens (the D-12 ceiling)
					contextWindow: 131072,
					percent: 0.92,
				}),
				sessionManager: {
					getEntries: () => entries.map((e) => ({ id: e.uuid, type: "message", message: { role: e.role, content: e.content } })),
				},
				model: {},
				ui: { setStatus: () => {} },
				hasUI: true,
				compact: (o?: unknown) => {
					compactCalls.push(o);
				},
			};

			let thrown: unknown = null;
			try {
				await runTurnStartCompaction(
					fakeCtx as unknown as Parameters<typeof runTurnStartCompaction>[0],
					profile,
				);
			} catch (err) {
				thrown = err;
			}

			expect(thrown).toBeInstanceOf(SessionTooFullError);
			expect(compactCalls.length).toBe(0);
		});
	});
});
