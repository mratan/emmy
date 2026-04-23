// packages/emmy-ux/src/slash-commands.ts
//
// Phase 3.1 Plan 03.1-01 Task 2 — /compact and /clear slash commands (D-31,
// D-32). Registered via pi 0.68 pi.registerCommand in createEmmyExtension.
//
// Separated from pi-emmy-extension.ts for unit-testability — tests in
// packages/emmy-ux/test/slash-commands.test.ts drive the handlers with fake
// ExtensionCommandContext objects; slash-commands.integration.test.ts
// exercises the factory-level wiring.
//
// D-31 (/compact):
//   Handler: async (args, ctx) => ctx.compact({
//     customInstructions: buildCompactInstructions(profile.compactPromptText, args)
//   })
//   Addendum semantics: user args are APPENDED to the profile-defined
//   prompts/compact.md contents. Profile preservation policy always applies.
//
// D-32 (/clear):
//   Handler ordering (Claude's Discretion pin):
//     1. hasUI gate — ctx.ui.notify + return early if non-interactive
//     2. ctx.ui.confirm("Clear session", "...")
//     3. ctx.abort()
//     4. await ctx.waitForIdle()
//     5. await ctx.newSession({})
//   SP_OK canary re-fires because newSession() creates a fresh AgentSession
//   which triggers pi's session-boot hook sequence (Pitfall #6 preserved).

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Minimal ctx shape for /compact. Uses unknown for pi's opaque internals so
 * tests can pass plain objects. Narrowed from ExtensionCommandContext.
 */
interface CompactCmdCtx {
	compact: (options?: { customInstructions?: string }) => void;
	ui?: {
		setStatus?: (key: string, text: string | undefined) => void;
	};
}

/**
 * Minimal ctx shape for /clear. Narrowed from ExtensionCommandContext.
 */
interface ClearCmdCtx {
	hasUI?: boolean;
	ui?: {
		confirm: (title: string, message: string) => Promise<boolean>;
		notify: (message: string, type?: "info" | "warning" | "error") => void;
		setStatus?: (key: string, text: string | undefined) => void;
	};
	abort: () => void;
	waitForIdle: () => Promise<void>;
	newSession: (options?: {
		parentSession?: string;
		setup?: (sessionManager: unknown) => Promise<void>;
	}) => Promise<{ cancelled: boolean }>;
}

/**
 * D-31 addendum semantics (pure fn, no I/O).
 *
 * - `compactPromptText` is the profile-defined prompts/compact.md contents
 *   (null if the file is missing — D-16 fallback path).
 * - `userArgs` is the operator-supplied addendum string (trimmed by caller).
 *
 * Returns:
 *   - both null/empty → ""  (pi's built-in SUMMARIZATION_SYSTEM_PROMPT takes over)
 *   - prompt only → prompt verbatim
 *   - args only → args verbatim
 *   - both → `${prompt}\n\n---\nAdditional operator guidance for this compaction:\n${args}`
 */
export function buildCompactInstructions(
	compactPromptText: string | null,
	userArgs: string,
): string {
	const trimmedArgs = userArgs.trim();
	const profile = compactPromptText ?? "";
	if (!profile && !trimmedArgs) return "";
	if (!profile) return trimmedArgs;
	if (!trimmedArgs) return profile;
	return `${profile}\n\n---\nAdditional operator guidance for this compaction:\n${trimmedArgs}`;
}

/**
 * Register /compact via pi.registerCommand. Handler calls ctx.compact with
 * the profile prompt + operator args; status line shows "manual compaction
 * fired" (with an args preview when args are non-empty).
 *
 * `compactPromptText` is captured at extension-construction time — calling
 * site reads the profile's prompts/compact.md once and passes null if the
 * file is missing (D-16 fallback path).
 */
export function registerCompactCommand(
	pi: ExtensionAPI,
	opts: { compactPromptText: string | null },
): void {
	pi.registerCommand("compact", {
		description:
			"Manually trigger compaction. Optional args are appended to the profile compaction prompt.",
		handler: async (args: string, ctx: unknown) => {
			const cmdCtx = ctx as CompactCmdCtx;
			const trimmed = args.trim();
			const customInstructions = buildCompactInstructions(
				opts.compactPromptText,
				trimmed,
			);
			cmdCtx.compact({ customInstructions });

			// Status line: "manual compaction fired" or, with args, include a
			// short preview so the operator knows their addendum was applied.
			const preview = trimmed.length > 0
				? `manual compaction fired (args: ${trimmed.slice(0, 40)}…)`
				: "manual compaction fired";
			cmdCtx.ui?.setStatus?.("emmy.last_compaction", preview);
		},
	});
}

/**
 * Register /clear via pi.registerCommand. Handler runs the D-32 + Claude's
 * Discretion pin ordering: hasUI gate → confirm → abort → waitForIdle →
 * newSession. SP_OK canary re-fires on the new session because pi's
 * newSession() invokes the session-boot hook sequence.
 */
export function registerClearCommand(pi: ExtensionAPI): void {
	pi.registerCommand("clear", {
		description:
			"Start a fresh session. Transcript stays on disk; agent loses all context.",
		handler: async (_args: string, ctx: unknown) => {
			const cmdCtx = ctx as ClearCmdCtx;

			// 1. hasUI gate — non-interactive mode fails with a clear hint.
			//    Documented as interactive-only in 03.1-CONTEXT.md §Specifics.
			if (cmdCtx.hasUI === false) {
				cmdCtx.ui?.notify(
					"slash command `/clear` requires the interactive TUI — use Ctrl+C and restart pi-emmy for one-shot mode.",
					"error",
				);
				return;
			}

			// 2. Confirm — user can cancel.
			const confirmed = await cmdCtx.ui!.confirm(
				"Clear session",
				"This will start a fresh session. Unsaved work in the transcript will remain on disk but the agent will lose all context. Continue?",
			);
			if (!confirmed) return;

			// 3. Abort any in-flight turn.
			cmdCtx.abort();

			// 4. Wait for abort to drain.
			await cmdCtx.waitForIdle();

			// 5. Start a fresh session. The returned {cancelled} is
			//    respected but not acted on — if pi cancels the switch
			//    (e.g. plugin veto), the current session stays in place
			//    and the user can retry.
			await cmdCtx.newSession({});
		},
	});
}
