// packages/emmy-ux/src/pi-emmy-extension.ts
//
// Plan 03-01 Task 2 (GREEN) — pi 0.68 ExtensionFactory that installs
// Emmy's before_provider_request payload mutator on every chat request
// flowing through a pi AgentSession.
//
// Plan 03-02 (this plan) — extends the before_provider_request hook with a
// single emitEvent("harness.assembly", ...) call per wire request so Langfuse
// and the JSONL sink both carry one record per chat request with:
//   model                = payload.model
//   emmy.prompt.sha256   = assembledPrompt.sha256
//   emmy.profile.*       = profile.ref (auto-stamped by SpanProcessor too)
//   gen_ai.system        = "vllm"
//   gen_ai.request.model = payload.model
// This is D-10's "every span carries profile stamp" invariant realized on
// the chat-request boundary. The existing emitEvent call sites elsewhere
// (session.* / grammar.retry.* / tool.* / prompt.assembled / mcp.*) continue
// to fire unchanged; this adds one additional structured event per wire-level
// chat request, giving Langfuse at least (N chat turns * 1) assembly spans
// in addition to the other event types.
//
// Wire sequence (per pi 0.68 SDK path, sdk.js:195-200):
//   pi's openai-completions stream calls `onPayload(payload)` right before
//   sending the POST to the model backend. If any extension registered a
//   `before_provider_request` handler, that handler's return value replaces
//   the payload. We leverage the in-place mutation form documented in
//   examples/extensions/provider-payload.ts — returning void means pi uses
//   the (now mutated) event.payload verbatim.
//
// D-01 atomic wave covers five injections through this factory:
//   (a) chat_template_kwargs.enable_thinking:false (D-02a; removes a17f4a9)
//   (b) reactive grammar on retry-state wantsGrammar=true (D-02b / Phase 2 D-11)
//   (c) system message → Emmy's 3-layer assembled prompt (D-02c + D-04)
//   (d) SP_OK canary pass-through (RESEARCH Pitfall #7 belt-and-suspenders)
//   (e) [Plan 03-05] input event hook registration — no-op stub here; future
//       plan fills the body.

import { existsSync, readFileSync } from "node:fs";
import { join as joinPath } from "node:path";

import type {
	ExtensionAPI,
	ExtensionFactory,
	TurnEndEvent,
} from "@mariozechner/pi-coding-agent";

import {
	emmyCompactionTrigger,
	SessionTooFullError,
	type EmmyCompactionContext,
	type SessionEntry as EmmySessionEntry,
} from "@emmy/context";
import {
	getRetryStateForSignal,
	handleBeforeProviderRequest,
	resolveVariant,
	type AssembledPromptSnapshot,
	type BeforeProviderRequestPayload,
	type ProfileSnapshot,
	type ResolvedVariant,
	type RetryState,
	type RoleKey,
	type RoutesConfig,
	type VariantSnapshot,
} from "@emmy/provider";
import {
	clearCurrentTurnRoleContext,
	EmmyProfileStampProcessor,
	emitEvent,
	getCurrentTurnRoleContext,
	setCurrentTurnRoleContext,
	TurnTracker,
	type TurnMeta,
} from "@emmy/telemetry";
// Plan 03.1-02 — per-turn rate-limit reset for web_search (T-03.1-02-03).
import { resetTurnSearchCount } from "@emmy/tools";
// Plan 04-04 (HARNESS-08) — routes.yaml + per-variant profile loader.
import { loadProfile } from "./profile-loader";
import { loadRoutes, RoutesLoadError } from "./routes-loader";

import {
	EMMY_FEEDBACK_DOWN_KEYID,
	EMMY_FEEDBACK_UP_KEYID,
	handleFeedbackRating,
} from "./feedback-ui";
import { stripGemma4ChannelBleed } from "./gemma4-strip";
import { reloadHarnessProfile } from "./harness-swap";
import {
	startFooterPoller,
	type FooterPollerHandle,
} from "./metrics-poller";
import { bindBadge } from "./offline-badge";
import { scanProfileIndex } from "./profile-index";
import { runSwapAndStreamProgress } from "./profile-swap-runner";
// registerCompactCommand import dropped post-Plan-03.1-03 — pi 0.68 ships a
// built-in /compact that collides; see pi-emmy-extension body comment.
// Plan 04-03: registerProfileCommand added alongside registerClearCommand.
// Plan 04.2-04: register{Start,Stop,Status}Command for sidecar control.
import {
	registerClearCommand,
	registerProfileCommand,
	registerStartCommand,
	registerStatusCommand,
	registerStopCommand,
} from "./slash-commands";

export interface EmmyExtensionOptions {
	profile: ProfileSnapshot;
	/**
	 * Called at wire time to get the current assembled prompt snapshot. Passed
	 * as a function (not a static value) so future plans can hot-reload the
	 * assembled prompt when AGENTS.md changes mid-session (Plan 03-03 compaction,
	 * Plan 03-05 input handler). For Plan 03-01 this resolves to a fixed value
	 * captured at session boot.
	 */
	assembledPromptProvider: () => AssembledPromptSnapshot;
	/**
	 * Optional override for retry-state lookup. Defaults to
	 * `getRetryStateForSignal` from @emmy/provider's grammar-retry module. Tests
	 * inject a mock to exercise the grammar-injection branch without having to
	 * trigger a real parse failure first.
	 */
	getRetryStateForSignal?: (signal: AbortSignal) => RetryState | undefined;
	/**
	 * Plan 03-04 (UX-02): vLLM endpoint the 1 Hz footer poller scrapes for
	 * `/metrics`. If omitted, the footer poller is not started — useful for
	 * tests and for stripped-down CLI invocations (e.g. `--print-environment`).
	 */
	baseUrl?: string;
	/**
	 * Plan 03-04 test hook: inject a custom footer-poller starter. Defaults to
	 * `startFooterPoller` from @emmy/ux/src/metrics-poller. Tests override this
	 * to assert the poller was started exactly once on session_start and
	 * stopped on agent_end, without driving real network / subprocess code.
	 */
	startFooterPollerImpl?: typeof startFooterPoller;
	/**
	 * Plan 03-05 (TELEM-02): session identifier propagated into the emmy-owned
	 * turn_id scheme `${sessionId}:${turnIndex}`. pi 0.68 TurnEndEvent only
	 * exposes `turnIndex: number`, so we synthesize turn_id at the turn_end
	 * callback site using this value + the pi-emitted turnIndex. When absent,
	 * feedback capture is disabled (no turn_end handler registered).
	 */
	sessionId?: string;
	/**
	 * Plan 03-05: honors the Plan 03-02 resolveTelemetryEnabled kill-switch.
	 * When false, Alt+Up/Down input intercept is skipped entirely and the
	 * turn_end tracker is not populated — feedback capture silently disabled.
	 */
	telemetryEnabled?: boolean;
	/**
	 * Plan 03-05 test hook: inject a custom TurnTracker. Tests override this
	 * to assert recordTurnComplete was called with synthesized turn_id;
	 * production callers omit it and get a fresh in-memory TurnTracker.
	 */
	turnTrackerImpl?: TurnTracker;
	/**
	 * Plan 04-03 (PROFILE-08 / UX-04) — absolute path of the CURRENTLY LOADED
	 * profile bundle. Required to register /profile; the handler passes this
	 * as the `--from` argument to the Python swap orchestrator. Omit to
	 * disable /profile registration (useful in tests + --print mode).
	 */
	profileDir?: string;
	/**
	 * Plan 04-03 — vLLM port the swap orchestrator targets. Defaults to 8002.
	 */
	port?: number;
	/**
	 * Plan 04-03 — top-level profiles/ directory for filesystem-based
	 * autocompletion. Defaults to "profiles" (relative to CWD).
	 */
	profilesRoot?: string;
	/**
	 * Plan 04-03 — the EmmyProfileStampProcessor installed in the live OTel
	 * SDK. /profile's exit-0 hot-swap calls swapSpanProcessor on this handle
	 * so subsequent spans stamp the new profile's id/version/hash. When
	 * omitted, a fresh processor is created (tests + /profile swap without
	 * an active OTel pipeline both work — the fresh processor is orphan but
	 * the mutation itself is side-effect-free).
	 */
	profileStampProcessor?: EmmyProfileStampProcessor;
	/**
	 * Plan 04-03 test hook: inject an alternative runSwap implementation so
	 * unit tests of the factory wiring don't spawn a real Python
	 * orchestrator. Defaults to runSwapAndStreamProgress from
	 * ./profile-swap-runner.
	 */
	runSwapImpl?: typeof runSwapAndStreamProgress;
	/**
	 * Plan 04.2-04 test hooks — DI seams for /start, /stop, /status slash
	 * commands. Production callers omit these; defaults wire to the HTTP+SSE
	 * dispatcher in sidecar-lifecycle-client.ts (this plan, Task 2 — self-
	 * contained POST→SSE helpers; does NOT touch profile-swap-runner-http.ts
	 * which is Plan 03's contract) + getSidecarStatus from
	 * sidecar-status-client.ts (this plan, Task 1).
	 */
	runSidecarStartImpl?: (args: {
		profile_id: string;
		variant?: string;
		onProgress: (phase: string, pct?: number) => void;
	}) => Promise<{
		exit: number;
		envelope?: { rolled_back?: boolean; rollback_succeeded?: boolean };
	}>;
	runSidecarStopImpl?: (args: {
		onProgress: (phase: string, pct?: number) => void;
	}) => Promise<{ exit: number }>;
	getSidecarStatusImpl?: (
		baseUrl?: string,
	) => Promise<import("./sidecar-status-client").SidecarStatus>;
}

/**
 * Build a pi ExtensionFactory bound to the given profile + prompt provider.
 *
 * Returned factory is passed to
 * `createAgentSessionServices({ resourceLoaderOptions: { extensionFactories: [factory] } })`
 * so pi's DefaultResourceLoader registers it alongside any on-disk extensions.
 */
export function createEmmyExtension(opts: EmmyExtensionOptions): ExtensionFactory {
	const { assembledPromptProvider } = opts;
	// Plan 04-03 D-23 — profile is mutable at factory-closure scope so
	// /profile's exit-0 hot-swap can replace it. Hook bodies read the live
	// reference via closure capture; the setter below is handed to
	// harness-swap.ts's reloadHarnessProfile as replaceProfileRef.
	let currentProfile: ProfileSnapshot = opts.profile;
	const setCurrentProfile = (snap: ProfileSnapshot): void => {
		currentProfile = snap;
	};
	const retryLookup = opts.getRetryStateForSignal ?? getRetryStateForSignal;
	const startPoller = opts.startFooterPollerImpl ?? startFooterPoller;

	// Plan 04-03 — EmmyProfileStampProcessor handle for D-23 hot-swap. If the
	// caller supplied one (production: pi-emmy.ts passes the processor
	// installed at initOtel time), we mutate IT in place. Otherwise we
	// construct a fresh one that is orphan but keeps the swap path
	// side-effect-safe in test contexts.
	const profileStampProcessor =
		opts.profileStampProcessor ??
		new EmmyProfileStampProcessor({
			id: opts.profile.ref.id,
			version: opts.profile.ref.version,
			hash: opts.profile.ref.hash,
		});

	const runSwapImpl = opts.runSwapImpl ?? runSwapAndStreamProgress;

	// Plan 03-04: footer poller handle lives at factory-closure scope so both
	// session_start (start) and agent_end (stop) handlers can see it.
	let footerHandle: FooterPollerHandle | null = null;

	// Plan 03-05 (TELEM-02): TurnTracker follows the factory-closure lifetime
	// because pi's turn_end → pi's input-event ordering is within the same
	// AgentSession process. The tracker only keeps the LATEST completed turn
	// (D-19 most-recent-turn attribution).
	const turnTracker = opts.turnTrackerImpl ?? new TurnTracker();
	const telemetryEnabled = opts.telemetryEnabled !== false; // default ON
	const sessionId = opts.sessionId ?? null;

	// Plan 03-08 fix-forward: pi 0.68 resets `_turnIndex = 0` on every
	// `agent_start` event (dist/core/agent-session.js:376). Because every new
	// user message kicks off a new agent turn sequence, `event.turnIndex` is 0
	// for the FIRST turn_end of every user message — which means Plan 03-05's
	// `turn_id = ${sessionId}:${turnIndex}` collapses all user-submitted turns
	// onto a single id, and upsertFeedback always replaces the same row.
	//
	// Fix: maintain an emmy-side monotonic counter that increments on each
	// turn_end we record. This preserves the idempotency contract (same turn →
	// same turn_id → upsert replaces) while ensuring distinct user messages
	// produce distinct turn_ids (no collapse).
	let emmyTurnCounter = 0;

	// Plan 04-04 (HARNESS-08 / D-08) — load routes.yaml at factory construction.
	// Absence (ENOENT) is non-fatal: emmy defaults to single-variant mode using
	// the boot profile on every turn (D-08 "absence = default-only mode"). The
	// variant snapshot cache is populated lazily on first resolveVariant per
	// role, keyed by variantPath so the variant's harness.yaml is read off
	// disk at most once per session.
	const profilesRoot = opts.profilesRoot ?? "profiles";
	let routes: RoutesConfig | null = null;
	try {
		routes = loadRoutes(joinPath(profilesRoot, "routes.yaml"));
	} catch (err) {
		// ENOENT / parse error → default-only mode. Log once so operators
		// notice in event.jsonl but never crash the factory.
		if (!(err instanceof Error && err.message.includes("ENOENT"))) {
			if (err instanceof RoutesLoadError) {
				// Malformed file — log the structured error so the operator can
				// fix it. Routes stay null → default-only; base profile wins.
				console.error(`[emmy] routes.yaml unusable — default-only mode: ${err.message}`);
			}
			// Any other error also routes to default-only.
		}
		routes = null;
	}

	// Lazy per-variant snapshot cache. Keys on the RESOLVED variant path
	// (e.g. "profiles/qwen3.6-35b-a3b/v3.1-reason") so the cache survives
	// /profile swaps where only the default might move (the variants still
	// live on disk and produce byte-identical serving.yaml).
	const variantCache = new Map<string, VariantSnapshot>();

	/**
	 * Load a variant bundle's harness.yaml fields into a VariantSnapshot.
	 * Reads the raw harness.yaml (no parse of non-variant fields) so the
	 * snapshot can carry the variant's sampling_defaults +
	 * chat_template_kwargs — fields not exposed on ProfileSnapshot but
	 * present in the schema (VariantSamplingDefaults; Plan 04-04 Task 1).
	 * Also calls loadProfile so profile.hash is populated for
	 * emmy.profile.variant_hash stamping on OTel spans (D-12).
	 */
	async function loadVariantSnapshot(
		resolved: ResolvedVariant,
		role: RoleKey,
	): Promise<VariantSnapshot | null> {
		const cached = variantCache.get(resolved.variantPath);
		if (cached) {
			return { ...cached, role };
		}
		let snap;
		try {
			snap = await loadProfile(resolved.variantPath);
		} catch (err) {
			console.error(
				`[emmy] variant ${resolved.variant} failed to load — falling back to base profile: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
			return null;
		}
		// Parse harness.yaml raw for the two variant-level fields. loadProfile's
		// ProfileSnapshot doesn't expose them (they're optional and live on
		// harness.yaml root per Phase 4 schema extension). We read the file
		// once and cache the result.
		let variantHarness: {
			sampling_defaults?: VariantSnapshot["harness"]["sampling_defaults"];
			chat_template_kwargs?: VariantSnapshot["harness"]["chat_template_kwargs"];
			per_tool_sampling?: VariantSnapshot["harness"]["per_tool_sampling"];
			prompts?: VariantSnapshot["harness"]["prompts"];
		} = {};
		try {
			const yaml = await import("js-yaml");
			const raw = yaml.default.load(
				readFileSync(joinPath(resolved.variantPath, "harness.yaml"), "utf8"),
			) as {
				sampling_defaults?: VariantSnapshot["harness"]["sampling_defaults"];
				chat_template_kwargs?: VariantSnapshot["harness"]["chat_template_kwargs"];
				tools?: { per_tool_sampling?: VariantSnapshot["harness"]["per_tool_sampling"] };
				prompts?: VariantSnapshot["harness"]["prompts"];
			};
			variantHarness = {
				sampling_defaults: raw?.sampling_defaults,
				chat_template_kwargs: raw?.chat_template_kwargs,
				per_tool_sampling: raw?.tools?.per_tool_sampling,
				prompts: raw?.prompts,
			};
		} catch {
			// Can't read harness.yaml raw — ProfileSnapshot was loaded above
			// so the bundle is structurally valid; just no variant fields.
		}
		const snapshot: VariantSnapshot = {
			profileId: resolved.profileId,
			variant: resolved.variant,
			variantHash: snap.ref.hash,
			role,
			harness: variantHarness,
		};
		variantCache.set(resolved.variantPath, snapshot);
		return snapshot;
	}

	/**
	 * D-11 role classifier — PURE on payload shape. Must not branch on
	 * profile id or model name (D-19 audit). Heuristic (planner seed):
	 *   1. turn envelope override (payload.emmy.role) — highest precedence
	 *      so callers can force a role for tests / replay
	 *   2. last user message regex matches plan/edit/critic keywords
	 *   3. payload contains a tools[] descriptor + next tool hint points
	 *      at edit|write (iteration 2+ refinement where the model already
	 *      emitted a tool call)
	 *   4. else → "default"
	 * First-invocation: iteration 1 has no tool hint; user-message regex
	 * does the work. Iteration 2+ may reclassify to "edit" if the model
	 * emits an edit tool call — one turn_id can therefore carry spans with
	 * different roles, as documented in Plan 04-04 Task 2g.1.
	 */
	function classifyRole(
		payload: BeforeProviderRequestPayload & {
			emmy?: { role?: RoleKey };
			tools?: Array<{ function?: { name?: string } }>;
		},
	): RoleKey {
		// Explicit override via emmy envelope — supported primarily for
		// testing + replay; not set on the live path.
		const explicit = (payload.emmy as { role?: RoleKey } | undefined)?.role;
		if (
			explicit === "plan" ||
			explicit === "edit" ||
			explicit === "critic" ||
			explicit === "default"
		) {
			return explicit;
		}

		// Last user message text — the user's most recent turn drives the
		// initial classification. `messages` is the full transcript; take the
		// last role==="user" entry.
		let lastUserText = "";
		for (let i = payload.messages.length - 1; i >= 0; i--) {
			const m = payload.messages[i];
			if (m && m.role === "user") {
				const c = m.content;
				if (typeof c === "string") {
					lastUserText = c;
				} else if (Array.isArray(c)) {
					lastUserText = c
						.map((item) =>
							typeof item === "string"
								? item
								: typeof (item as { text?: unknown }).text === "string"
									? ((item as { text: string }).text)
									: "",
						)
						.join(" ");
				}
				break;
			}
		}

		// Ordering matters (Plan 04-04 note): check message-text FIRST because
		// turn.nextTool is only populated on iteration 2+. Regex intentionally
		// case-insensitive with leading-word anchor.
		if (/^(plan:|think about|architect|design|strategy|outline)/i.test(lastUserText)) {
			return "plan";
		}
		if (/^(edit|write|modify|rename|refactor|fix)\s/i.test(lastUserText)) {
			return "edit";
		}
		if (/^(review|critique|audit|check|verify)\s/i.test(lastUserText)) {
			return "critic";
		}

		// Iteration-2+ refinement — check the most recent assistant message's
		// tool_calls[], which is what the model actually chose on the prior
		// iteration. Do NOT iterate `payload.tools[]` (tool DESCRIPTORS) —
		// that catalog always contains `edit`/`write` and would misroute every
		// non-keyword prompt to "edit". (SC-3 walkthrough 2026-04-23 surfaced
		// this bug; fix narrows the check to assistant.tool_calls.)
		for (let i = payload.messages.length - 1; i >= 0; i--) {
			const m = payload.messages[i];
			if (!m || m.role !== "assistant") continue;
			const toolCalls = (m as { tool_calls?: Array<{ function?: { name?: string } }> }).tool_calls;
			if (!Array.isArray(toolCalls) || toolCalls.length === 0) continue;
			for (const tc of toolCalls) {
				const n = tc?.function?.name;
				if (n === "edit" || n === "write") return "edit";
			}
			// Most recent assistant turn had tool_calls but none were edit/write —
			// stop scanning further back; this turn's refinement says "not edit".
			break;
		}

		return "default";
	}

	// Plan 03.1-01 Task 2 (D-31) — read the profile-defined compaction prompt
	// once at factory-construction time. The /compact handler uses this as the
	// base customInstructions (user-supplied args are appended per D-31's
	// addendum semantics). If the file is missing we pass null — D-16 fallback
	// semantics route through to pi's built-in SUMMARIZATION_SYSTEM_PROMPT
	// when the user runs /compact with no args.
	let compactPromptText: string | null = null;
	try {
		// Read from opts.profile (not the mutable currentProfile) because this
		// read happens ONCE at factory construction; the prompt text is the
		// pre-swap profile's compact.md. Plan 04-04 / Plan 04-06 may extend
		// reloadHarnessProfile to refresh this too; for Plan 04-03 it stays
		// bound to the boot-time profile (no regression).
		const harness = opts.profile.harness as unknown as {
			context?: { compaction?: { summarization_prompt_path?: string } };
		};
		const relPath = harness.context?.compaction?.summarization_prompt_path;
		if (typeof relPath === "string" && relPath.length > 0) {
			const fullPath = joinPath(opts.profile.ref.path, relPath);
			if (existsSync(fullPath)) {
				compactPromptText = readFileSync(fullPath, "utf8");
			}
		}
	} catch {
		compactPromptText = null;
	}

	return (pi: ExtensionAPI): void => {
		// Plan 03-04 UX-02: start the 1 Hz footer poller on session_start and
		// stop it on agent_end. baseUrl is the vLLM endpoint (defaults from
		// opts.baseUrl passed at extension construction by session.ts).
		// EMMY_TELEMETRY=off is honored by startFooterPoller itself (returns a
		// no-op handle if set — matches Plan 03-02's kill-switch discipline).
		pi.on("session_start", (_event, ctx) => {
			// Plan 03-06 (UX-03): bind pi's ctx.ui to the module-level badge
			// state machine. session.ts already ran the boot-time audit and
			// called setInitialAudit(result); bindBadge replays that state
			// into ctx.ui.setStatus("emmy.offline_badge", ...) now that we
			// have the pi context. If a web_fetch violation happens mid-
			// session, enforceWebFetchAllowlist's onViolation callback
			// (session.ts) flips the module-level state and re-renders
			// through the same ctx. EMMY_TELEMETRY=off does NOT suppress
			// this — the badge is UX, not telemetry (plan success_criterion).
			if (ctx.ui) {
				const setStatusFn = ctx.ui.setStatus.bind(ctx.ui);
				bindBadge({
					ui: { setStatus: (k, t) => setStatusFn(k, t) },
				});
			}

			if (!opts.baseUrl) return;
			// Safety: never start two concurrent pollers (defensive — pi emits
			// session_start exactly once per AgentSession, but this guards
			// future callers that create multiple sessions in one process).
			if (footerHandle) {
				footerHandle.stop();
				footerHandle = null;
			}
			footerHandle = startPoller({
				baseUrl: opts.baseUrl,
				setStatus: (key, text) => ctx.ui?.setStatus?.(key, text),
			});
		});

		pi.on("agent_end", () => {
			if (footerHandle) {
				footerHandle.stop();
				footerHandle = null;
			}
		});

		pi.on("before_provider_request", async (event, ctx) => {
			// Cast event.payload (declared as `unknown` in pi 0.68 types) to our
			// structural shape. Pi's onPayload surfaces the OpenAI-compat chat
			// request body; field names match our BeforeProviderRequestPayload.
			const payload = event.payload as BeforeProviderRequestPayload;
			const retryState = ctx.signal ? retryLookup(ctx.signal) ?? null : null;
			const snapshot = assembledPromptProvider();

			// Plan 04-04 (HARNESS-08 / D-11 / D-12) — per-turn variant routing.
			// Classify role on payload shape (tool-name + message regex; NEVER
			// model-name), resolve to a variant dir via routes.yaml, load (or
			// cache-hit) the variant's harness.yaml fields, set the OTel turn
			// context, and pass the snapshot to handleBeforeProviderRequest.
			// When routes.yaml is absent (or malformed) we skip entirely —
			// the base profile handles the turn exactly as before (D-08
			// "absence = default-only mode").
			let variantSnapshot: VariantSnapshot | undefined;
			if (routes) {
				const isCanaryEarly =
					typeof (payload as { emmy?: { is_sp_ok_canary?: boolean } }).emmy === "object" &&
					(payload as { emmy?: { is_sp_ok_canary?: boolean } }).emmy?.is_sp_ok_canary === true;
				if (!isCanaryEarly) {
					const role = classifyRole(payload);
					const resolved = resolveVariant(role, routes, profilesRoot);
					const vs = await loadVariantSnapshot(resolved, role);
					if (vs) {
						variantSnapshot = vs;
						setCurrentTurnRoleContext({
							variant: vs.variant,
							variantHash: vs.variantHash,
							role,
						});
					}
				}
			}

			handleBeforeProviderRequest({
				payload,
				profile: currentProfile,
				assembledPrompt: snapshot,
				retryState,
				variantSnapshot,
			});

			// SP_OK canary requests carry a sentinel on `payload.emmy.is_sp_ok_canary`
			// and MUST NOT be emitted into the lived-experience JSONL — they have a
			// deliberately-terse system prompt that would pollute the trace readout
			// (T-03-02-01 mitigation). Plan 03-01's handleBeforeProviderRequest
			// early-returns on that sentinel; we belt-and-suspenders here too.
			const isCanary =
				typeof (payload as { emmy?: { is_sp_ok_canary?: boolean } }).emmy === "object" &&
				(payload as { emmy?: { is_sp_ok_canary?: boolean } }).emmy?.is_sp_ok_canary === true;
			if (isCanary) return;

			// One "harness.assembly" event per wire-level chat request. Span name
			// follows Plan 03-02 naming (emmy.harness.assembly). Attributes cover
			// the model + prompt sha256 (per D-10 + HARNESS-09), and the profile is
			// auto-stamped by EmmyProfileStampProcessor.onStart AND by emitEvent's
			// profile flattening. Keep the payload small: we never log
			// payload.messages content here (T-03-02-01).
			const modelName = typeof (payload as { model?: unknown }).model === "string"
				? ((payload as { model: string }).model)
				: "";
			// D-12 observability — include turn-role-context (variant + role)
			// on the JSONL record too, not just on OTel spans. Without this, a
			// JSONL-only deployment (no Langfuse auth) has no way to observe
			// within-model role routing since the SpanProcessor-stamped attrs
			// only land on exported spans. Absent when routes.yaml is missing
			// or canary, matching the span-stamping behavior.
			const turnCtx = getCurrentTurnRoleContext();
			emitEvent({
				event: "harness.assembly",
				ts: new Date().toISOString(),
				profile: currentProfile.ref,
				model: modelName,
				"gen_ai.system": "vllm",
				"gen_ai.request.model": modelName,
				"emmy.prompt.sha256": snapshot.sha256,
				...(retryState?.wantsGrammar ? { "emmy.grammar.retry": true } : {}),
				...(turnCtx.variant ? { "emmy.profile.variant": turnCtx.variant } : {}),
				...(turnCtx.variantHash ? { "emmy.profile.variant_hash": turnCtx.variantHash } : {}),
				...(turnCtx.role ? { "emmy.role": turnCtx.role } : {}),
			});
		});

		// Plan 03-05 (TELEM-02): turn_end handler populates the TurnTracker
		// with per-turn metadata so Alt+Up/Down can attribute a rating to the
		// MOST-RECENT completed turn (D-19). pi 0.68 TurnEndEvent shape:
		//   { type: "turn_end", turnIndex: number, message: AgentMessage, toolResults: ToolResultMessage[] }
		// Emmy synthesizes turn_id from `${sessionId}:${turnIndex}` (sessionId
		// plumbed in from pi-emmy.ts boot; see EmmyExtensionOptions.sessionId).
		if (telemetryEnabled && sessionId) {
			pi.on("turn_end", (event) => {
				try {
					const meta = buildTurnMeta(
						event as TurnEndEvent,
						sessionId,
						currentProfile,
						emmyTurnCounter++,
					);
					turnTracker.recordTurnComplete(meta);
					if (process.env.EMMY_DEBUG_SHORTCUT)
						console.error(`[emmy-debug] turn_end recorded: turn_id=${meta.turn_id}`);
				} catch {
					// Malformed AgentMessage shouldn't crash the session. The
					// tracker keeps its previous state; user's next Alt+Up will
					// rate the last well-formed turn or return "continue" if
					// none exists.
				}
			});
		}

		// Plan 03.1-02 T-03.1-02-03 — reset web_search per-turn counter on
		// every turn_end. Separate from the telemetry-gated feedback capture
		// above because the rate-limit counter is a runtime safety guard that
		// should fire regardless of whether Langfuse is active. Registered
		// unconditionally so EMMY_TELEMETRY=off still resets the counter
		// between turns (prevents unbounded accumulation across long sessions
		// when telemetry is disabled).
		//
		// Plan 04-04 (HARNESS-08 / D-12) — also clear the per-turn variant/role
		// OTel context so the next turn starts with a fresh slate. If
		// before_provider_request sets a new context, the stamp processor sees
		// it; if not (routes.yaml absent / canary), getCurrentTurnRoleContext
		// returns `{}` and the processor omits the variant/role attrs.
		pi.on("turn_end", () => {
			resetTurnSearchCount();
			clearCurrentTurnRoleContext();
		});

		// Phase 4 post-close follow-up (2026-04-24) — Gemma 4 channel-bleed
		// strip. vLLM 0.19.1.dev6's gemma4 reasoning_parser leaves thinking
		// tokens ("<|channel>thought\n<channel|>…" and/or residual "thought\n"
		// role label) in message content on tool-call continuation paths,
		// even with chat_template_kwargs.enable_thinking=false. Reproduced
		// 2026-04-24 against gemma-4-26B-A4B-it on
		// vllm/vllm-openai:gemma4-0409-arm64-cu130. Gate on the profile's
		// serving.quirks.strip_thinking_tags so Qwen (which works correctly)
		// stays untouched; Gemma 4 v2 flips it on in the same commit.
		//
		// Fires on message_end (not message_update) because mid-stream token
		// mutation risks tag-boundary splits. The polluted prefix flashes
		// briefly in the TUI during streaming but is cleaned in the
		// persisted AgentMessage, so the NEXT turn's chat history carries
		// only the clean final answer (the important part — prevents the
		// model from echoing its own bleed on subsequent turns).
		pi.on("message_end", (event) => {
			if (!currentProfile.serving.quirks.strip_thinking_tags) return;
			const msg = (event as { message?: { role?: string; content?: unknown } }).message;
			if (!msg || msg.role !== "assistant") return;
			if (!Array.isArray(msg.content)) return;
			for (const block of msg.content as Array<{ type?: string; text?: string }>) {
				if (block && block.type === "text" && typeof block.text === "string") {
					block.text = stripGemma4ChannelBleed(block.text);
				}
			}
		});

		// Plan 03-08 fix-forward (TELEM-02): register keyboard shortcuts via
		// pi's authoritative extension API `pi.registerShortcut(keyId, {handler})`.
		// Plan 03-05's original D-18 strategy used `pi.on("input", handler)` to
		// intercept Alt+Up/Down, but `pi.on("input")` is a message-SUBMISSION
		// event (text + images payload), NOT a keybind intercept — verified in
		// dist/core/agent-session.js:689-700 (_extensionRunner.emitInput is
		// called only when the user submits a prompt, and pi does NOT put raw
		// ANSI into event.text). Keybindings flow through pi-tui's CustomEditor
		// onAction table; extensions reach it via registerShortcut.
		//
		// Chord selection (per dist/core/keybindings.js default scan): alt+up /
		// alt+down are claimed by app.message.dequeue and app.message.requeue,
		// and pi's runner silently skips extension shortcuts that collide with
		// built-ins (runner.js:267). shift+ctrl+up and shift+ctrl+down are
		// unclaimed. Emmy owns them for thumbs-up/down.
		//
		// Telemetry kill-switch: if telemetryEnabled=false we DON'T register
		// the shortcuts at all. Pi's runner treats unregistered extension keys
		// as a no-op, so EMMY_TELEMETRY=off cleanly cedes the chord to nothing.
		if (telemetryEnabled) {
			const makeCtx = (ctx: {
				ui?: { input?: (p: string, pl?: string) => Promise<string | undefined> };
			}) => {
				const uiInput = ctx.ui?.input?.bind(ctx.ui);
				if (!uiInput) return null;
				return {
					ui: { input: uiInput },
					enabled: true, // telemetryEnabled already gated at factory level
				};
			};
			if (process.env.EMMY_DEBUG_SHORTCUT)
				console.error(`[emmy-debug] registering shortcuts: ${EMMY_FEEDBACK_UP_KEYID} + ${EMMY_FEEDBACK_DOWN_KEYID}`);
			pi.registerShortcut(EMMY_FEEDBACK_UP_KEYID, {
				description: "Emmy: thumbs-up on most-recent turn (TELEM-02)",
				handler: async (ctx) => {
					if (process.env.EMMY_DEBUG_SHORTCUT)
						console.error(`[emmy-debug] shift+ctrl+up handler fired`);
					const feedbackCtx = makeCtx(ctx);
					if (!feedbackCtx) {
						if (process.env.EMMY_DEBUG_SHORTCUT)
							console.error(`[emmy-debug] no ctx.ui.input — bailing`);
						return;
					}
					const result = await handleFeedbackRating(1, feedbackCtx, turnTracker);
					if (process.env.EMMY_DEBUG_SHORTCUT)
						console.error(`[emmy-debug] handleFeedbackRating +1 → ${JSON.stringify(result)}`);
				},
			});
			pi.registerShortcut(EMMY_FEEDBACK_DOWN_KEYID, {
				description: "Emmy: thumbs-down on most-recent turn (TELEM-02)",
				handler: async (ctx) => {
					if (process.env.EMMY_DEBUG_SHORTCUT)
						console.error(`[emmy-debug] shift+ctrl+down handler fired`);
					const feedbackCtx = makeCtx(ctx);
					if (!feedbackCtx) return;
					const result = await handleFeedbackRating(-1, feedbackCtx, turnTracker);
					if (process.env.EMMY_DEBUG_SHORTCUT)
						console.error(`[emmy-debug] handleFeedbackRating -1 → ${JSON.stringify(result)}`);
				},
			});
		}

		// Plan 03.1-01 Task 2 — register /compact and /clear slash commands
		// (D-31, D-32). These are UX primitives, NOT telemetry, so they
		// register regardless of the telemetryEnabled gate. /compact is a
		// manual escape valve at any context level; /clear resets the
		// session from an over-full state (interactive-only).
		// Plan 03.1-03 post-close: emmy's /compact was colliding with pi 0.68's
		// built-in /compact (dist/core/slash-commands.js:19), emitting a yellow
		// "Extension command '/compact' conflicts with built-in…" warning at
		// session start. Pi's built-in dispatches to session.compact() — the
		// same method emmy's auto-compaction uses via ctx.compact() on turn_start.
		// So the conflict was redundant: pi's built-in ran, emmy's was skipped.
		// Removed to silence the warning. Trade-off: manual /compact now uses
		// pi's default prompt (not emmy's profile prompts/compact.md); that
		// prompt only flows through the auto-path now. Accept.
		// registerCompactCommand(pi, { compactPromptText });  // ← removed; pi built-in wins
		registerClearCommand(pi);

		// Plan 04-03 (PROFILE-08 / UX-04) — /profile <name>[@<variant>] slash
		// command. Registered only when opts.profileDir is supplied: absence
		// signals test/--print mode where /profile makes no sense. The
		// reloadHarnessProfile callback composes three D-23 re-inits:
		// profile cache + OTel stamp processor + web_fetch allowlist.
		if (opts.profileDir) {
			const profilesRoot = opts.profilesRoot ?? "profiles";
			const profileIndex = scanProfileIndex(profilesRoot);
			registerProfileCommand(pi, {
				profileDir: opts.profileDir,
				port: opts.port ?? 8002,
				profileIndex,
				runSwap: async ({ from, to, port, onProgress }) =>
					runSwapImpl({ from, to, port, onProgress }),
				reloadHarnessProfile: async (newDir) => {
					await reloadHarnessProfile(newDir, {
						replaceProfileRef: setCurrentProfile,
						profileStampProcessor,
					});
				},
			});
		}

		// Plan 04.2-04 — /start, /stop, /status sidecar control commands.
		// Register UNCONDITIONALLY (no opts.profileDir gate): sidecar is the
		// source of truth for valid profiles, not the local FS profile bundle
		// — the Mac client doesn't have profile bundles by default. Defaults
		// route through sidecar-lifecycle-client.ts (POST→SSE) and
		// sidecar-status-client.ts (GET); test hooks via opts.* override.
		const sidecarBaseUrl =
			process.env.EMMY_SERVE_URL ?? "http://127.0.0.1:8003";

		registerStartCommand(pi, {
			runStart: async ({ profile_id, variant, onProgress }) => {
				if (opts.runSidecarStartImpl) {
					return opts.runSidecarStartImpl({
						profile_id,
						variant,
						onProgress,
					});
				}
				const { runSidecarStartHttp } = await import(
					"./sidecar-lifecycle-client"
				);
				return runSidecarStartHttp({
					baseUrl: sidecarBaseUrl,
					profile_id,
					variant,
					onProgress,
				});
			},
			// Phase 04.2 follow-up — /start swap-guard pre-check. Re-uses the
			// same getSidecarStatus path /status uses; opts.getSidecarStatusImpl
			// override (already plumbed for /status) wins for tests.
			getStatus: async () => {
				if (opts.getSidecarStatusImpl) {
					return opts.getSidecarStatusImpl(sidecarBaseUrl);
				}
				const { getSidecarStatus } = await import(
					"./sidecar-status-client"
				);
				return getSidecarStatus(sidecarBaseUrl);
			},
		});
		registerStopCommand(pi, {
			runStop: async ({ onProgress }) => {
				if (opts.runSidecarStopImpl) {
					return opts.runSidecarStopImpl({ onProgress });
				}
				const { runSidecarStopHttp } = await import(
					"./sidecar-lifecycle-client"
				);
				return runSidecarStopHttp({
					baseUrl: sidecarBaseUrl,
					onProgress,
				});
			},
		});
		registerStatusCommand(pi, {
			getStatus: async () => {
				if (opts.getSidecarStatusImpl) {
					return opts.getSidecarStatusImpl(sidecarBaseUrl);
				}
				const { getSidecarStatus } = await import(
					"./sidecar-status-client"
				);
				return getSidecarStatus(sidecarBaseUrl);
			},
		});

		// Plan 03-03 — turn_start handler invokes emmyCompactionTrigger per
		// D-11 turn-boundary atomicity (Pitfall #3). Plan 03.1-01 (D-30)
		// extracted the handler body into runTurnStartCompaction so tests
		// can drive it directly with a fake ExtensionContext. The helper
		// also performs the live ctx.compact({customInstructions}) call when
		// the trigger returns directive.shouldCompact === true.
		pi.on("turn_start", async (_event, ctx) => {
			await runTurnStartCompaction(
				ctx as unknown as TurnStartCompactionCtx,
				currentProfile,
			);
		});
	};
}

/**
 * Minimal ExtensionContext shape runTurnStartCompaction needs. Uses `unknown`
 * for pi's opaque types so the helper stays decoupled from pi's full type
 * surface — tests pass a plain object; the production turn_start handler
 * passes pi's real ctx (cast through `unknown` at the call site).
 */
export interface TurnStartCompactionCtx {
	getContextUsage?: () => { tokens: number | null; contextWindow: number; percent?: number | null } | undefined;
	sessionManager?: { getEntries?: () => ReadonlyArray<unknown> };
	model: unknown;
	ui?: { setStatus?: (key: string, text: string | undefined) => void };
	hasUI?: boolean;
	compact: (options?: { customInstructions?: string }) => void;
}

/**
 * Plan 03.1-01 (D-30) — turn_start compaction helper.
 *
 * Runs emmyCompactionTrigger in live-wire mode (no engine injected → trigger
 * returns a directive instead of calling summarize itself). When the directive
 * says shouldCompact, invoke pi's native ctx.compact({customInstructions}).
 *
 * Error handling:
 *   - SessionTooFullError (D-12 pre-ceiling OR post-compaction overflow) is
 *     surfaced via setStatus and re-thrown so pi aborts the turn. The
 *     operator sees the 5-key diagnostic bundle in events.jsonl.
 *   - Any other error (wiring bug, unexpected trigger throw) propagates
 *     unchanged — D-16 fallback inside the trigger catches the common
 *     missing-prompt case internally.
 */
export async function runTurnStartCompaction(
	ctx: TurnStartCompactionCtx,
	profile: ProfileSnapshot,
): Promise<void> {
	const usage = ctx.getContextUsage?.();
	if (!usage || usage.tokens == null) return;
	const contextWindow = usage.contextWindow;
	const maxInputTokens = readMaxInputTokens(profile) ?? contextWindow;

	const piEntries = ctx.sessionManager?.getEntries?.() ?? [];
	const emmyEntries = adaptPiEntries(piEntries);

	const triggerCtx: EmmyCompactionContext = {
		profile,
		entries: emmyEntries,
		contextTokens: usage.tokens,
		contextWindow: maxInputTokens,
		eventType: "turn_start",
		model: ctx.model,
		apiKey: process.env.EMMY_VLLM_API_KEY ?? "unused",
		setStatus: (key, text) => ctx.ui?.setStatus?.(key, text),
		// IMPORTANT: no `engine` injected. The trigger returns a directive
		// instead of calling engine.summarize itself (D-30 live-wire gate).
	};

	try {
		const result = await emmyCompactionTrigger(triggerCtx);

		// D-30 live-wire path: directive present → call pi's ctx.compact.
		if (result.directive?.shouldCompact) {
			ctx.ui?.setStatus?.(
				"emmy.last_compaction",
				"live compaction firing…",
			);
			ctx.compact({ customInstructions: result.directive.customInstructions });
			return;
		}

		// Legacy stub-mode path (engine.summarize was injected — unreachable
		// in production; only stub tests take this branch).
		if (result.ran) {
			ctx.ui?.setStatus?.(
				"emmy.last_compaction",
				`compacted ${result.elided}→kept ${result.preserved}${result.fallback ? " (D-16 fallback)" : ""}`,
			);
		}
	} catch (err) {
		if (err instanceof SessionTooFullError) {
			// D-12 fail-loud: surface to TUI and re-throw so pi aborts
			// the turn. Operator sees the diagnostic bundle via
			// session logs + events.jsonl.
			ctx.ui?.setStatus?.("emmy.compaction_failure", err.message);
			throw err;
		}
		// Other errors would have been caught inside the trigger and
		// converted to D-16 fallback; anything reaching here is a
		// wiring bug — let it propagate so the test suite catches it.
		throw err;
	}
}

/**
 * Read the compaction context window from the profile bundle. Plan 03-03 ships
 * the loader without requiring harness.context to be declared on ProfileSnapshot;
 * this helper does the same defensive read.
 */
function readMaxInputTokens(profile: ProfileSnapshot): number | null {
	const harness = profile.harness as unknown as { context?: { max_input_tokens?: unknown } };
	const val = harness.context?.max_input_tokens;
	return typeof val === "number" && Number.isFinite(val) ? val : null;
}

/**
 * Adapt pi-native SessionEntry (discriminated union) to the simplified
 * emmy-local SessionEntry shape. Only SessionMessageEntry variants flow
 * through the classifier; compaction/thinking/custom entries are filtered
 * out because they don't participate in LLM context (pi treats them as
 * metadata).
 */
function adaptPiEntries(entries: ReadonlyArray<unknown>): EmmySessionEntry[] {
	const out: EmmySessionEntry[] = [];
	for (const e of entries) {
		if (!e || typeof e !== "object") continue;
		const entry = e as { type?: string; id?: string; message?: unknown };
		if (entry.type !== "message") continue;
		const msg = entry.message as {
			role?: string;
			content?: unknown;
			isError?: boolean;
			toolName?: string;
		};
		if (!msg || typeof msg !== "object") continue;
		out.push({
			uuid: String(entry.id ?? ""),
			role: String(msg.role ?? "unknown"),
			content: renderContent(msg.content),
			...(typeof msg.isError === "boolean" ? { isError: msg.isError } : {}),
			...(typeof msg.toolName === "string" ? { toolName: msg.toolName } : {}),
		});
	}
	return out;
}

function renderContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (content == null) return "";
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (typeof c === "string") return c;
				if (c && typeof c === "object" && "text" in (c as Record<string, unknown>)) {
					const t = (c as { text?: unknown }).text;
					return typeof t === "string" ? t : "";
				}
				return "";
			})
			.join("\n");
	}
	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}

/**
 * Plan 03-05: synthesize a TurnMeta record from a pi 0.68 TurnEndEvent.
 *
 * Event shape (pi types.d.ts line 468-473):
 *   { type: "turn_end", turnIndex: number, message: AgentMessage, toolResults: ToolResultMessage[] }
 *
 * AgentMessage is a pi-ai Message (UserMessage | AssistantMessage | ToolResultMessage)
 * or one of the CustomAgentMessages variants. We only populate model_response +
 * tokens for the AssistantMessage variant — if pi ever dispatches turn_end for
 * a non-assistant terminal message, the tokens stay 0 and the UI shows a
 * best-effort rating (acceptable degradation vs. blocking the capture).
 *
 * `latency_ms` is not present on pi's event envelope for 0.68 — we reserve 0
 * for Phase 4+ enrichment (Plan 03-02 already emits an `after_provider_response`
 * event that carries response headers; a follow-up plan can cache that
 * latency keyed by turnIndex and wire it here).
 *
 * `kv_used` reads from Plan 03-04's footer poller global cache if available.
 * For MVP we emit 0 and let Phase 7 consent-flow annotate properly.
 */
function buildTurnMeta(
	event: TurnEndEvent,
	sessionId: string,
	profile: ProfileSnapshot,
	emmyTurnIndex: number,
): TurnMeta {
	const msg = event.message as unknown as {
		role?: string;
		content?: unknown;
		usage?: { input?: number; output?: number };
	};

	// Extract concatenated text from AssistantMessage.content (TextContent items).
	let modelResponse = "";
	if (msg && Array.isArray(msg.content)) {
		modelResponse = msg.content
			.map((c) => {
				if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
					const t = (c as { text?: unknown }).text;
					return typeof t === "string" ? t : "";
				}
				return "";
			})
			.join("");
	} else if (typeof (msg as { content?: unknown })?.content === "string") {
		modelResponse = (msg as { content: string }).content;
	}

	// Extract tool calls from the AssistantMessage content + toolResults siblings.
	// We include the toolCall entries from the assistant message (the thing the
	// model decided to do); toolResults carry the outputs which can contain
	// file contents — preserving the call (args) without the result keeps the
	// schema useful while avoiding T-03-05-01 leaking file bodies by default.
	const toolCalls: unknown[] = [];
	if (msg && Array.isArray(msg.content)) {
		for (const c of msg.content) {
			if (c && typeof c === "object" && (c as { type?: string }).type === "toolCall") {
				const tc = c as { name?: string; arguments?: unknown; id?: string };
				toolCalls.push({
					id: tc.id,
					name: tc.name,
					arguments: tc.arguments,
				});
			}
		}
	}

	const usage = msg?.usage ?? {};
	const tokensIn = typeof usage.input === "number" ? usage.input : 0;
	const tokensOut = typeof usage.output === "number" ? usage.output : 0;

	return {
		turn_id: `${sessionId}:${emmyTurnIndex}`,
		session_id: sessionId,
		profile_id: profile.ref.id,
		profile_version: profile.ref.version,
		profile_hash: profile.ref.hash,
		model_response: modelResponse,
		tool_calls: toolCalls,
		latency_ms: 0,
		kv_used: 0,
		tokens_in: tokensIn,
		tokens_out: tokensOut,
		completed_at: new Date().toISOString(),
	};
}
