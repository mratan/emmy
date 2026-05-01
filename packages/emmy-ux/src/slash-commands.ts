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
// Plan 04.4-08 — telemetry emission for /compact and /clear (V5).
import { emitEvent } from "@emmy/telemetry";

import type { ProfileIndex } from "./profile-index";
import type { SwapResult } from "./profile-swap-runner";
import type { SidecarStatus } from "./sidecar-status-client";

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
	opts: {
		compactPromptText: string | null;
		/** Plan 04.4-08 — optional session-id getter for emmy.compaction.trigger. */
		getSessionId?: () => string;
	},
): void {
	pi.registerCommand("compact", {
		description:
			"Manually trigger compaction. Optional args are appended to the profile compaction prompt.",
		handler: async (args: string, ctx: unknown) => {
			const cmdCtx = ctx as CompactCmdCtx;
			const trimmed = args.trim();

			// Plan 04.4-08 — emit emmy.compaction.trigger BEFORE the round-trip
			// so post-mortem traces include the attempt even if compact() throws.
			// Args preview truncated to 80 chars to avoid bloating OTel payload.
			const argsPreview =
				trimmed.length > 80 ? trimmed.slice(0, 80) + "…" : trimmed;
			try {
				emitEvent({
					event: "emmy.compaction.trigger",
					ts: new Date().toISOString(),
					trigger_kind: "manual",
					args_preview: argsPreview,
					session_id: opts.getSessionId
						? opts.getSessionId()
						: "unknown",
				});
			} catch {
				// Best-effort. Telemetry hiccups never block /compact.
			}

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
export function registerClearCommand(
	pi: ExtensionAPI,
	opts?: {
		/** Plan 04.4-08 — optional getter for emmy.session.cleared.session_id_prior. */
		getPriorSessionId?: () => string;
	},
): void {
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

			// Plan 04.4-08 — emit emmy.session.cleared BEFORE abort so the
			// trace captures the prior session_id even if abort or newSession
			// throws partway through. Best-effort emit; never blocks /clear.
			try {
				emitEvent({
					event: "emmy.session.cleared",
					ts: new Date().toISOString(),
					session_id_prior: opts?.getPriorSessionId
						? opts.getPriorSessionId()
						: "unknown",
				});
			} catch {
				// Telemetry hiccups never block /clear.
			}

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

			// Phase 04.2 follow-up — capture the LAST error: progress so the
			// failure notify can include actionable detail. The HTTP dispatcher
			// emits "error: HTTP 4xx: <detail>" for sidecar-rejected requests
			// (e.g. 409 "swap requires state=ready, currently=stopped" — telling
			// the operator they need /start first).
			let lastErrorDetail: string | null = null;
			const { exit, envelope } = await opts.runSwap({
				from: opts.profileDir,
				to: target,
				port: opts.port,
				onProgress: (phase, pct) => {
					cmdCtx.ui.setStatus("emmy.swap", renderProgress(phase, pct));
					if (phase.startsWith("error")) {
						lastErrorDetail = phase;
					}
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
			if (lastErrorDetail !== null) {
				cmdCtx.ui.notify(
					`swap failed (exit ${exit}) — ${lastErrorDetail}`,
					"error",
				);
			} else {
				cmdCtx.ui.notify(
					`swap failed (exit ${exit}); see runs/boot-failures/`,
					"error",
				);
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Plan 04.2-04 Task 1 — /start, /stop, /status sidecar control commands.
// These work regardless of opts.profileDir (the sidecar is the source of
// truth for valid profiles + lifecycle state).
//
// /start <profileId>[@<variant>] — D-02 LOCKED: same syntax as /profile.
//   - Idempotent on same variant (sidecar short-circuits with state=ready).
//   - Cold-start when sidecar reports state=stopped.
//   - Cross-variant when sidecar reports state=ready with different variant.
//
// /stop — D-01 LOCKED: graceful drain (30s + SIGTERM + 5s SIGKILL).
//   - Streams draining N requests SSE event into the footer.
//   - Confirm dialog protects against accidental Ctrl+S typo.
//
// /status — D-03 LOCKED: GET-only (no SSE). Renders sidecar /status JSON
// as a one-line summary via ctx.ui.notify(text, "info"). No isIdle guard
// because the call is read-only.
// ---------------------------------------------------------------------------

/**
 * Minimal ctx shape for /start and /stop. Mirrors ProfileCmdCtx — both
 * commands need isIdle gating (long-running sidecar lifecycle ops) and the
 * ui.{confirm, notify, setStatus} surface.
 */
interface SidecarCmdCtx {
	isIdle: () => boolean;
	ui: {
		confirm: (title: string, message: string) => Promise<boolean>;
		notify: (message: string, type?: "info" | "warning" | "error") => void;
		setStatus: (key: string, text: string | undefined) => void;
	};
}

/**
 * Minimal ctx shape for /status — read-only, so no isIdle / confirm / setStatus
 * is required. Just ui.notify for the one-line summary.
 */
interface StatusCmdCtx {
	ui: {
		notify: (message: string, type?: "info" | "warning" | "error") => void;
		// Optional D-22 footer-row channel. Used by /ask-claude (Plan 04.6-04
		// followup) to render a "Asking Claude (Ns)…" elapsed-time indicator
		// while the sidecar round-trip is in flight (~10-30s typical).
		// Optional because /start, /stop, /status don't surface progress
		// through this channel — they stream SSE phases via their own paths.
		setStatus?: (key: string, text: string | undefined) => void;
	};
}

export interface RegisterStartCommandOpts {
	/**
	 * Shell out to the sidecar /start endpoint over HTTP+SSE; returns the
	 * same {exit, envelope?} shape runSwap returns. The default impl in
	 * pi-emmy-extension.ts wires this to runSidecarStartHttp from
	 * sidecar-lifecycle-client.ts.
	 */
	runStart: (args: {
		profile_id: string;
		variant?: string;
		onProgress: (phase: string, pct?: number) => void;
	}) => Promise<SwapResult>;
	/**
	 * Phase 04.2 follow-up — sidecar /status fetcher used by the swap-guard
	 * pre-check. /start refuses to swap to a different profile/variant when
	 * vLLM is already running a different one (operator should use /profile
	 * instead — that path also reloads the harness state, which /start does
	 * NOT). Production wires this to getSidecarStatus from
	 * sidecar-status-client.ts; tests inject a fake.
	 */
	getStatus: () => Promise<{
		state: string;
		profile_id: string | null;
		profile_variant: string | null;
		vllm_up: boolean;
	}>;
}

export interface RegisterStopCommandOpts {
	/**
	 * Shell out to the sidecar /stop endpoint over HTTP+SSE; returns the
	 * post-drain exit code. The default impl wires this to runSidecarStopHttp.
	 */
	runStop: (args: {
		onProgress: (phase: string, pct?: number) => void;
	}) => Promise<{ exit: number }>;
}

export interface RegisterStatusCommandOpts {
	/**
	 * GET the sidecar /status endpoint and return parsed SidecarStatus. The
	 * default impl wires this to getSidecarStatus from sidecar-status-client.ts.
	 */
	getStatus: () => Promise<SidecarStatus>;
}

/**
 * Render SidecarStatus as a one-line summary for ctx.ui.notify. Omits null
 * fields so a stopped sidecar doesn't smear "vllm=null kv=null …" across the
 * TUI.
 *
 * Format: "sidecar: state=ready vllm=gemma-4-26b-a4b-it@v3.1-default kv=34% temp=64°C in_flight=2"
 *
 * T-04.2-S2 mitigation: last_error.msg is sliced to 40 chars to prevent a
 * malicious / long error string from line-wrapping the TUI. Math.round on
 * numerics — kv_used_pct + gpu_temp_c are checked at JSON.parse time by the
 * controller's Pydantic schema (no NaN injection surface here).
 */
export function renderSidecarStatus(s: SidecarStatus): string {
	const parts: string[] = [`state=${s.state}`];
	if (s.profile_id !== null && s.profile_variant !== null) {
		parts.push(`vllm=${s.profile_id}@${s.profile_variant}`);
	} else if (s.vllm_up) {
		parts.push("vllm=up");
	}
	if (s.kv_used_pct !== null && Number.isFinite(s.kv_used_pct)) {
		parts.push(`kv=${Math.round(s.kv_used_pct * 100)}%`);
	}
	if (s.gpu_temp_c !== null && Number.isFinite(s.gpu_temp_c)) {
		parts.push(`temp=${Math.round(s.gpu_temp_c)}°C`);
	}
	if (s.in_flight !== null && s.in_flight > 0) {
		parts.push(`in_flight=${s.in_flight}`);
	}
	if (s.last_error !== null) {
		// Slice to 40 chars before composing — T-04.2-S2 line-wrap guard.
		parts.push(`error=${s.last_error.msg.slice(0, 40)}`);
	}
	return `sidecar: ${parts.join(" ")}`;
}

/**
 * Register /start via pi.registerCommand. Handler:
 *   1. isIdle() guard — defer if a request is in flight.
 *   2. Parse `<profileId>[@<variant>]` (same syntax as /profile).
 *   3. Call opts.runStart({profile_id, variant, onProgress}); relay onProgress
 *      to ctx.ui.setStatus("emmy.swap", renderProgress(phase, pct?)).
 *   4. Clear emmy.swap status, then notify success/failure based on exit code.
 */
export function registerStartCommand(
	pi: ExtensionAPI,
	opts: RegisterStartCommandOpts,
): void {
	pi.registerCommand("start", {
		description:
			"Start the local LLM. /start <profileId>[@<variant>] — same variant syntax as /profile.",
		handler: async (args: string, ctx: unknown) => {
			const cmdCtx = ctx as SidecarCmdCtx;
			if (!cmdCtx.isIdle()) {
				cmdCtx.ui.notify(
					"start deferred — request in flight, finish or Ctrl+C first",
					"warning",
				);
				return;
			}
			const trimmed = args.trim();
			if (trimmed.length === 0) {
				cmdCtx.ui.notify(
					"usage: /start <profileId>[@<variant>]",
					"error",
				);
				return;
			}
			const atIdx = trimmed.indexOf("@");
			const profile_id = atIdx >= 0 ? trimmed.slice(0, atIdx) : trimmed;
			const variant = atIdx >= 0 ? trimmed.slice(atIdx + 1) : undefined;

			// Phase 04.2 follow-up — variant is required by the sidecar
			// (WARNING #10: no silent fallback to bare 'v1'). Surface a clear
			// client-side message instead of letting the round-trip return a
			// useless "exit 1" via the lifecycle client's HTTP-error path.
			if (variant === undefined || variant.length === 0) {
				cmdCtx.ui.notify(
					`/start requires <profileId>@<variant>. ` +
						`Try: /start ${profile_id}@v2.1 ` +
						`(or look in profiles/${profile_id}/ for available variants).`,
					"error",
				);
				return;
			}

			// Phase 04.2 follow-up — swap-guard. /start is for "bring vLLM up"
			// not "switch to a different model". If vLLM is already running a
			// different profile/variant, /start would trigger a swap on the
			// sidecar but the harness state wouldn't update — the next
			// inference request would 404 because the model field in the
			// chat-completions POST still references the old profile's
			// served_model_name. Defer the user to /profile, which atomically
			// updates BOTH layers.
			//
			// Probe sidecar status; if it errors, fall through to runStart
			// (the underlying call will produce the real error). Only block
			// when we have a CONFIDENT mismatch.
			let pre: Awaited<ReturnType<typeof opts.getStatus>> | null = null;
			try {
				pre = await opts.getStatus();
			} catch {
				// Sidecar unreachable — let runStart surface the network
				// error rather than failing here with a misleading message.
			}
			if (
				pre !== null &&
				pre.state === "ready" &&
				pre.vllm_up === true &&
				pre.profile_id !== null &&
				(pre.profile_id !== profile_id ||
					(variant !== undefined && pre.profile_variant !== variant))
			) {
				const currentLabel =
					pre.profile_variant !== null
						? `${pre.profile_id}@${pre.profile_variant}`
						: pre.profile_id;
				cmdCtx.ui.notify(
					`/start refused: vLLM is already running ${currentLabel}. ` +
						`To switch models, use /profile ${trimmed} — it atomically swaps ` +
						`both vLLM AND the harness state. /start only brings vLLM up.`,
					"error",
				);
				return;
			}

			// Phase 04.2 follow-up — capture the LAST error: progress message
			// so the failure notify can include actionable detail rather than
			// just "exit N". The lifecycle client emits "error: HTTP 4xx: <detail>"
			// for sidecar-rejected requests (variant-required, state-guard 409, etc).
			let lastErrorDetail: string | null = null;
			const { exit } = await opts.runStart({
				profile_id,
				variant,
				onProgress: (phase, pct) => {
					cmdCtx.ui.setStatus("emmy.swap", renderProgress(phase, pct));
					if (phase.startsWith("error")) {
						lastErrorDetail = phase;
					}
				},
			});
			cmdCtx.ui.setStatus("emmy.swap", undefined);
			if (exit === 0) {
				cmdCtx.ui.notify(`started ${trimmed}`, "info");
			} else if (lastErrorDetail !== null) {
				cmdCtx.ui.notify(
					`start failed (exit ${exit}) — ${lastErrorDetail}`,
					"error",
				);
			} else {
				cmdCtx.ui.notify(`start failed (exit ${exit})`, "error");
			}
		},
	});
}

/**
 * Register /stop via pi.registerCommand. Handler:
 *   1. isIdle() guard — defer if a request is in flight.
 *   2. ctx.ui.confirm — protect against accidental keystrokes.
 *   3. Call opts.runStop({onProgress}); relay onProgress to ctx.ui.setStatus.
 *   4. Clear emmy.swap status, then notify success/failure.
 */
export function registerStopCommand(
	pi: ExtensionAPI,
	opts: RegisterStopCommandOpts,
): void {
	pi.registerCommand("stop", {
		description:
			"Stop the local LLM (graceful 30s drain + SIGTERM). vLLM container exits; sidecar stays up.",
		handler: async (_args: string, ctx: unknown) => {
			const cmdCtx = ctx as SidecarCmdCtx;
			if (!cmdCtx.isIdle()) {
				cmdCtx.ui.notify(
					"stop deferred — request in flight, finish or Ctrl+C first",
					"warning",
				);
				return;
			}
			const confirmed = await cmdCtx.ui.confirm(
				"Stop emmy-serve",
				"Stop the local LLM? In-flight requests get up to 30 s to drain, then SIGTERM. Sidecar stays up; restart vLLM with /start.",
			);
			if (!confirmed) return;

			const { exit } = await opts.runStop({
				onProgress: (phase, pct) => {
					cmdCtx.ui.setStatus("emmy.swap", renderProgress(phase, pct));
				},
			});
			cmdCtx.ui.setStatus("emmy.swap", undefined);
			if (exit === 0) {
				cmdCtx.ui.notify("emmy-serve stopped", "info");
			} else {
				cmdCtx.ui.notify(`stop failed (exit ${exit})`, "error");
			}
		},
	});
}

/**
 * Register /status via pi.registerCommand. Read-only — no isIdle gate, no
 * confirm. Calls opts.getStatus and renders the result via ctx.ui.notify.
 * On error (sidecar unreachable etc.) emits an error notify with a hint at
 * the systemctl debug command.
 */
export function registerStatusCommand(
	pi: ExtensionAPI,
	opts: RegisterStatusCommandOpts,
): void {
	pi.registerCommand("status", {
		description:
			"Show emmy-sidecar + vLLM status (state, profile, KV, temp, in-flight).",
		handler: async (_args: string, ctx: unknown) => {
			const cmdCtx = ctx as StatusCmdCtx;
			try {
				const status = await opts.getStatus();
				cmdCtx.ui.notify(renderSidecarStatus(status), "info");
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				cmdCtx.ui.notify(
					`sidecar unreachable: ${msg} — check: systemctl --user status emmy-sidecar`,
					"error",
				);
			}
		},
	});
}

/**
 * Phase 04.2 follow-up — operator escape hatch.
 *
 * Force-resets the sidecar's state machine to STOPPED and kills any orphan
 * orchestrator subprocesses. Use this when /start or /profile/swap returns
 * 409 with "currently=starting" or "currently=swapping" — the SSE consumer
 * disconnect bug leaves the state machine stuck mid-transition; /reset
 * is the recovery primitive.
 *
 * SAFETY: does NOT touch the running vLLM container. Only resets sidecar
 * bookkeeping. After /reset, /status shows state=stopped + vllm_up=true if
 * vLLM is still serving externally.
 */
export interface RegisterResetCommandOpts {
	/** POST /reset on the sidecar; returns the prior state + killed PIDs. */
	runReset: () => Promise<{
		ok: boolean;
		prior_state: string;
		current_state: string;
		killed_orchestrator_pids: number[];
	}>;
}

export function registerResetCommand(
	pi: ExtensionAPI,
	opts: RegisterResetCommandOpts,
): void {
	pi.registerCommand("reset", {
		description:
			"Force-reset sidecar state to stopped (recovery for stuck STARTING/SWAPPING). Doesn't touch vLLM.",
		handler: async (_args: string, ctx: unknown) => {
			const cmdCtx = ctx as StatusCmdCtx;
			try {
				const result = await opts.runReset();
				const killedSuffix =
					result.killed_orchestrator_pids.length > 0
						? ` (killed ${result.killed_orchestrator_pids.length} orphan orchestrator subprocess${result.killed_orchestrator_pids.length === 1 ? "" : "es"})`
						: "";
				cmdCtx.ui.notify(
					`sidecar reset: ${result.prior_state} → ${result.current_state}${killedSuffix}`,
					"info",
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				cmdCtx.ui.notify(`reset failed: ${msg}`, "error");
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Plan 04.6-04 Task 2 — /ask-claude <question> operator slash command.
//
// D-05 LOCKED: slash command bypasses model-side per-turn rate-limit. When
// the operator explicitly types `/ask-claude <q>`, that's a trust signal —
// the only gating that applies is the sidecar's GLOBAL rate-limit (concurrent
// + min-gap + 30/hr), enforced server-side by Plan 04.6-01's controller.
//
// D-14 LOCKED: identical UX between pi-emmy (Spark loopback) and emmy
// (Mac tailnet). The dispatcher routes through `callAskClaude` injected at
// factory wire-up; baseUrl is resolved at the wire-up site via
// EMMY_SERVE_URL precedence (env > literal default 127.0.0.1:8003 — same
// pattern /start /stop /status use). NO hardcoded endpoint URLs in this
// module; the test seam is the `callAskClaude` callback, not env mocking.
//
// Read-only ctx — no isIdle gate (the sidecar accepts /ask-claude in any
// state because vLLM doesn't need to be running for Claude escalation; the
// two are independent). No confirm dialog: the operator already typed the
// command + question, that's the explicit gesture.
// ---------------------------------------------------------------------------

/**
 * Mirror of AskClaudeResponse from ask-claude-client.ts. Re-declared here
 * to keep slash-commands.ts free of cross-module imports for the response
 * type — handler only needs the shape, not the network call. The runtime
 * value is supplied by the caller via opts.callAskClaude.
 */
export interface AskClaudeResponse {
	response: string;
	duration_ms: number;
	rate_limit_remaining_hour: number;
}

/**
 * Callback shape for the sidecar HTTP call. Production wiring (in
 * pi-emmy-extension.ts) injects `callAskClaude({baseUrl, prompt})` from
 * ./ask-claude-client; tests inject a fake that returns canned responses
 * or throws structured AskClaudeError instances.
 */
export type CallAskClaudeFn = (prompt: string) => Promise<AskClaudeResponse>;

export interface RegisterAskClaudeCommandOpts {
	/** Sidecar HTTP call. See ./ask-claude-client.ts for the production impl. */
	callAskClaude: CallAskClaudeFn;
}

/**
 * Register /ask-claude <question> via pi.registerCommand. Handler:
 *   1. Trim args; reject empty/whitespace-only with notify(error).
 *   2. Call opts.callAskClaude(prompt); on success render via notify(info)
 *      with response + duration + remaining-quota in one line.
 *   3. On error, switch on err.reason and render a reason-specific
 *      operator-actionable message:
 *        - env_disabled         → hint to set EMMY_ASK_CLAUDE=on
 *        - claude_cli_not_found → hint to install Claude Code on Spark
 *        - scrubber_blocked     → name the matched pattern_class
 *        - rate_limited_*       → name which limit fired (concurrent / min-gap / hourly)
 *        - subprocess_failed    → name the subprocess context + detail
 *        - timeout              → name "timeout" + detail
 *        - unknown / other      → fall through to err.message
 *
 * Read-only ctx: no isIdle gate (independent of vLLM lifecycle), no confirm
 * (operator-typed command + question is the gesture).
 */
export function registerAskClaudeCommand(
	pi: ExtensionAPI,
	opts: RegisterAskClaudeCommandOpts,
): void {
	pi.registerCommand("ask-claude", {
		description:
			"Ask Claude (via Spark-side OAuth) a focused question — operator-invoked. Bypasses model-side rate-limits.",
		handler: async (rawArg: string, ctx: unknown) => {
			const cmdCtx = ctx as StatusCmdCtx;
			const prompt = rawArg.trim();
			if (prompt.length === 0) {
				cmdCtx.ui.notify(
					"/ask-claude requires a question. Try: /ask-claude how do I…",
					"error",
				);
				return;
			}
			// Plan 04.6-04 followup — elapsed-time progress indicator.
			// Without this, the operator sees an empty TUI for ~10-30s while
			// the sidecar round-trip is in flight (no streaming in v1, sync
			// POST→JSON only). Operator UX feedback after live SC-1 walkthrough
			// reported it felt frozen. The status updates every 1s with the
			// elapsed seconds; cleared in `finally` regardless of outcome.
			//
			// setStatus is optional on the StatusCmdCtx; degrades silently to
			// no-progress when the host runtime doesn't expose the channel
			// (matches the legacy pre-followup behavior — never worse).
			const setStatus = cmdCtx.ui.setStatus;
			const startMs = Date.now();
			let elapsedTicker: ReturnType<typeof setInterval> | null = null;
			if (setStatus) {
				setStatus("emmy.ask_claude", "Asking Claude…");
				elapsedTicker = setInterval(() => {
					const sec = Math.floor((Date.now() - startMs) / 1000);
					setStatus("emmy.ask_claude", `Asking Claude (${sec}s)…`);
				}, 1000);
			}
			try {
				const r = await opts.callAskClaude(prompt);
				// Plan 04.6-04 followup A — echo the operator's prompt at the
				// top of the notify so the conversation log is self-documenting.
				// pi-mono clears the input box on slash command submit so the
				// question would otherwise vanish; without echo the response
				// reads as decontextualized.
				//
				// Single-line summary: response + elapsed + remaining-quota.
				// "calls left this hour" is the sidecar's hourly rolling
				// counter (Plan 04.6-01 D-07): operator sees the budget at
				// a glance after every successful call. Newlines before
				// the response let multi-line answers render legibly.
				cmdCtx.ui.notify(
					`> /ask-claude ${prompt}\n\nClaude (${r.duration_ms}ms, ${r.rate_limit_remaining_hour} calls left this hour):\n\n${r.response}`,
					"info",
				);
			} catch (err) {
				const e = err as Error & {
					reason?: string;
					pattern_class?: string;
					detail?: string;
				};
				const reason: string = e?.reason ?? "unknown";
				const pattern: string | undefined = e?.pattern_class;
				const detail: string | undefined = e?.detail;
				switch (reason) {
					case "env_disabled":
						cmdCtx.ui.notify(
							"/ask-claude is disabled on this Spark. " +
								"Set EMMY_ASK_CLAUDE=on in the sidecar env to enable " +
								"(see Plan 04.6-07 OPERATOR-PROTOCOLS for the privacy pre-flight checklist).",
							"error",
						);
						break;
					case "claude_cli_not_found":
						cmdCtx.ui.notify(
							"/ask-claude: claude CLI not found on Spark PATH. " +
								"Install Claude Code on the Spark first (https://code.claude.com/docs/en/install).",
							"error",
						);
						break;
					case "scrubber_blocked":
						cmdCtx.ui.notify(
							`/ask-claude: prompt blocked by scrubber (${pattern ?? "secret pattern"}). ` +
								"Remove the matched content and retry.",
							"error",
						);
						break;
					case "rate_limited_concurrent":
						cmdCtx.ui.notify(
							"/ask-claude: rate-limited (concurrent — another /ask-claude is in flight). Wait and retry.",
							"error",
						);
						break;
					case "rate_limited_min_gap":
						cmdCtx.ui.notify(
							"/ask-claude: rate-limited (min-gap — too soon after the last call). Wait a few seconds and retry.",
							"error",
						);
						break;
					case "rate_limited_hourly":
						cmdCtx.ui.notify(
							"/ask-claude: rate-limited (hourly — 30/hr ceiling reached). Wait until the rolling window clears.",
							"error",
						);
						break;
					case "subprocess_failed":
						cmdCtx.ui.notify(
							`/ask-claude: claude subprocess invocation failed${detail ? ` (${detail})` : ""}.`,
							"error",
						);
						break;
					case "timeout":
						cmdCtx.ui.notify(
							`/ask-claude: timeout waiting for claude${detail ? ` (${detail})` : ""}. Retry, or shorten the prompt.`,
							"error",
						);
						break;
					default: {
						const msg = e?.message ?? "unknown";
						cmdCtx.ui.notify(`/ask-claude: error — ${msg}`, "error");
					}
				}
			} finally {
				// Clear the elapsed-time progress indicator regardless of
				// success/failure. setInterval handle is null when setStatus
				// wasn't available — guard against double-clear.
				if (elapsedTicker !== null) clearInterval(elapsedTicker);
				if (setStatus) setStatus("emmy.ask_claude", undefined);
			}
		},
	});
}
