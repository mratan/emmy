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

import type { ProfileIndex } from "./profile-index";
import type { SwapResult } from "./profile-swap-runner";

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

// ---------------------------------------------------------------------------
// Plan 04-03 Task 2 — /profile <name>[@<variant>] slash command (D-06 / D-22 /
// D-23). Registers via pi 0.68 pi.registerCommand alongside /clear in the
// createEmmyExtension factory. Handler:
//   1. D-06 isIdle() guard — rejects mid-generation with verbatim message
//      "swap deferred — request in flight, finish or Ctrl+C first".
//   2. Parse args → (name, variant?) → profileIndex.resolve() → unknown-profile
//      notify on null.
//   3. ctx.ui.confirm() — user can cancel destructive action.
//   4. runSwap({from, to, port, onProgress}) — shells out to Plan 04-02's
//      Python orchestrator; onProgress relays each phase to
//      ctx.ui.setStatus("emmy.swap", renderProgress(phase, pct?)).
//   5. Route exit code → user-visible notify:
//      exit 0: reloadHarnessProfile() + clear "emmy.swap" status + "swapped to X"
//      exit 5: "swap pre-flight failed (prior model still serving)"
//      exit 6 + rollback_succeeded=true: "swap failed; rollback succeeded"
//      exit 6 + rollback_succeeded=false: "swap failed; rollback FAILED — ..."
//      other:  "swap failed (exit N); see runs/boot-failures/"
// ---------------------------------------------------------------------------

/**
 * Minimal ctx shape for /profile. Narrowed from ExtensionCommandContext
 * (pi 0.68 types.d.ts:232-262). `isIdle()` is the D-06 guard source of truth
 * (types.d.ts:211); setStatus is the D-22 progress channel (types.d.ts:92+).
 */
interface ProfileCmdCtx {
	isIdle: () => boolean;
	ui: {
		confirm: (title: string, message: string) => Promise<boolean>;
		notify: (message: string, type?: "info" | "warning" | "error") => void;
		setStatus: (key: string, text: string | undefined) => void;
	};
}

/**
 * Render a progress phase string for the TUI footer row (D-22). Percentage
 * rendered only when provided by the orchestrator — the only phase that
 * carries pct is `loading weights`. Kept as a pure function so tests can
 * assert the rendered text without driving pi.
 */
function renderProgress(phase: string, pct?: number): string {
	if (typeof pct === "number" && Number.isFinite(pct)) {
		return `emmy.swap: ${phase} ${Math.round(pct)}%`;
	}
	return `emmy.swap: ${phase}`;
}

/**
 * Options injected at factory construction time. `runSwap` and
 * `reloadHarnessProfile` are passed as callbacks (rather than imported
 * directly) so unit tests can run the handler without the real
 * child_process spawn + filesystem side-effects.
 */
export interface RegisterProfileCommandOpts {
	/** Absolute path of the CURRENTLY LOADED profile bundle (pi-emmy-extension's opts.profileDir). */
	profileDir: string;
	/** vLLM port — usually 8002. */
	port: number;
	/** Filesystem index built once at factory construction from profiles/. */
	profileIndex: ProfileIndex;
	/** Shell out to the Python swap orchestrator; returns {exit, envelope?}. */
	runSwap: (args: {
		from: string;
		to: string;
		port: number;
		onProgress: (phase: string, pct?: number) => void;
	}) => Promise<SwapResult>;
	/** D-23 harness-side hot-swap — called only on orchestrator exit 0. */
	reloadHarnessProfile: (newDir: string) => Promise<void>;
}

/**
 * Register /profile via pi.registerCommand with autocompletion on profile
 * names + variants. The handler enforces D-06 (in-flight-turn guard), parses
 * the argument, confirms destructive action, shells out to the Python swap
 * primitive, streams phase events into the TUI footer, and routes the
 * orchestrator's exit code to distinct user-visible notify messages.
 *
 * See 04-CONTEXT.md D-06 / D-22 / D-23 for the locked behavior; see
 * 04-PATTERNS.md §8 for the pattern source.
 */
export function registerProfileCommand(
	pi: ExtensionAPI,
	opts: RegisterProfileCommandOpts,
): void {
	pi.registerCommand("profile", {
		description: "Swap to a different profile. /profile <name>[@<variant>]",
		// pi 0.68 getArgumentCompletions returns AutocompleteItem[] | null.
		// We map each profileIndex.complete() string to {value, label}.
		getArgumentCompletions: (prefix: string) => {
			const tokens = opts.profileIndex.complete(prefix);
			if (tokens.length === 0) return null;
			return tokens.map((t) => ({ value: t, label: t }));
		},
		handler: async (args: string, ctx: unknown) => {
			const cmdCtx = ctx as ProfileCmdCtx;

			// D-06 LOCKED — in-flight-turn guard.
			if (!cmdCtx.isIdle()) {
				cmdCtx.ui.notify(
					"swap deferred — request in flight, finish or Ctrl+C first",
					"warning",
				);
				return;
			}

			const trimmed = args.trim();
			if (trimmed.length === 0) {
				cmdCtx.ui.notify(
					"usage: /profile <name>[@<variant>]",
					"error",
				);
				return;
			}

			// Parse "<name>" or "<name>@<variant>".
			const atIdx = trimmed.indexOf("@");
			const name = atIdx >= 0 ? trimmed.slice(0, atIdx) : trimmed;
			const variant = atIdx >= 0 ? trimmed.slice(atIdx + 1) : undefined;

			const target = opts.profileIndex.resolve(name, variant);
			if (!target) {
				cmdCtx.ui.notify(`unknown profile: ${trimmed}`, "error");
				return;
			}

			const confirmed = await cmdCtx.ui.confirm(
				"Swap profile",
				`Stop the currently loaded profile and load ${trimmed}? (~2 min; no crash on failure — prior model rolls back.)`,
			);
			if (!confirmed) return;

			const { exit, envelope } = await opts.runSwap({
				from: opts.profileDir,
				to: target,
				port: opts.port,
				onProgress: (phase, pct) => {
					cmdCtx.ui.setStatus("emmy.swap", renderProgress(phase, pct));
				},
			});

			if (exit === 0) {
				// D-23 harness-side hot-swap: re-init profile cache + OTel
				// processor + web_fetch allowlist. Cleared progress row only
				// after the reload completes so the UX doesn't flash-clear
				// before the swap is truly done.
				await opts.reloadHarnessProfile(target);
				cmdCtx.ui.setStatus("emmy.swap", undefined);
				cmdCtx.ui.notify(`swapped to ${trimmed}`, "info");
				return;
			}

			// Non-zero exit paths: clear the progress row so a lingering
			// "loading weights 90%" doesn't confuse the user after failure.
			cmdCtx.ui.setStatus("emmy.swap", undefined);

			if (exit === 5) {
				cmdCtx.ui.notify(
					"swap pre-flight failed (prior model still serving)",
					"error",
				);
				return;
			}
			if (exit === 6) {
				const rolledBack = envelope?.rolled_back === true;
				const rollbackOk = envelope?.rollback_succeeded === true;
				if (rolledBack && rollbackOk) {
					cmdCtx.ui.notify("swap failed; rollback succeeded", "error");
				} else {
					cmdCtx.ui.notify(
						"swap failed; rollback FAILED — run start_emmy.sh manually",
						"error",
					);
				}
				return;
			}
			cmdCtx.ui.notify(
				`swap failed (exit ${exit}); see runs/boot-failures/`,
				"error",
			);
		},
	});
}
