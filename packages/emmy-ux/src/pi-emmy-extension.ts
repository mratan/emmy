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

import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";

import {
	emmyCompactionTrigger,
	SessionTooFullError,
	type EmmyCompactionContext,
	type SessionEntry as EmmySessionEntry,
} from "@emmy/context";
import {
	getRetryStateForSignal,
	handleBeforeProviderRequest,
	type AssembledPromptSnapshot,
	type BeforeProviderRequestPayload,
	type ProfileSnapshot,
	type RetryState,
} from "@emmy/provider";
import { emitEvent } from "@emmy/telemetry";

import {
	startFooterPoller,
	type FooterPollerHandle,
} from "./metrics-poller";

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
}

/**
 * Build a pi ExtensionFactory bound to the given profile + prompt provider.
 *
 * Returned factory is passed to
 * `createAgentSessionServices({ resourceLoaderOptions: { extensionFactories: [factory] } })`
 * so pi's DefaultResourceLoader registers it alongside any on-disk extensions.
 */
export function createEmmyExtension(opts: EmmyExtensionOptions): ExtensionFactory {
	const { profile, assembledPromptProvider } = opts;
	const retryLookup = opts.getRetryStateForSignal ?? getRetryStateForSignal;
	const startPoller = opts.startFooterPollerImpl ?? startFooterPoller;

	// Plan 03-04: footer poller handle lives at factory-closure scope so both
	// session_start (start) and agent_end (stop) handlers can see it.
	let footerHandle: FooterPollerHandle | null = null;

	return (pi: ExtensionAPI): void => {
		// Plan 03-04 UX-02: start the 1 Hz footer poller on session_start and
		// stop it on agent_end. baseUrl is the vLLM endpoint (defaults from
		// opts.baseUrl passed at extension construction by session.ts).
		// EMMY_TELEMETRY=off is honored by startFooterPoller itself (returns a
		// no-op handle if set — matches Plan 03-02's kill-switch discipline).
		pi.on("session_start", (_event, ctx) => {
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

		pi.on("before_provider_request", (event, ctx) => {
			// Cast event.payload (declared as `unknown` in pi 0.68 types) to our
			// structural shape. Pi's onPayload surfaces the OpenAI-compat chat
			// request body; field names match our BeforeProviderRequestPayload.
			const payload = event.payload as BeforeProviderRequestPayload;
			const retryState = ctx.signal ? retryLookup(ctx.signal) ?? null : null;
			const snapshot = assembledPromptProvider();
			handleBeforeProviderRequest({
				payload,
				profile,
				assembledPrompt: snapshot,
				retryState,
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
			emitEvent({
				event: "harness.assembly",
				ts: new Date().toISOString(),
				profile: profile.ref,
				model: modelName,
				"gen_ai.system": "vllm",
				"gen_ai.request.model": modelName,
				"emmy.prompt.sha256": snapshot.sha256,
				...(retryState?.wantsGrammar ? { "emmy.grammar.retry": true } : {}),
			});
		});

		// Plan 03-05 stub — input event placeholder. Registered now so the
		// factory's event topology is stable across waves. Body is "continue"
		// (pi proceeds with unmodified input) until Plan 03-05 wires Alt+Up/Down.
		pi.on("input", (_event, _ctx) => {
			return { action: "continue" };
		});

		// Plan 03-03 — turn_start handler invokes emmyCompactionTrigger per
		// D-11 turn-boundary atomicity (Pitfall #3). The trigger wraps pi's
		// compaction engine with D-14 preservation + D-16 fallback + D-12
		// hard-ceiling fail-loud. Read pi's context usage + session entries
		// via ExtensionContext; convert pi-native entries to emmy-local
		// SessionEntry shape before handing to the classifier.
		//
		// Live wiring notes (Plan 03-07 finalizes):
		//   - ctx.sessionManager.getEntries() returns pi's discriminated union;
		//     we adapt the SessionMessageEntry subset to emmy's simplified shape
		//     (role + content). CompactionEntry / ThinkingLevelChange / etc.
		//     are filtered out because pi already treats them as non-LLM data.
		//   - ctx.getContextUsage() is optional; when null we skip the trigger
		//     because there's no authoritative token count to compare vs
		//     max_input_tokens. D-15 soft threshold is a RATIO, so missing
		//     tokens => ratio unknown => safe to skip.
		//   - SessionTooFullError propagates to the TUI via ctx.ui.setStatus
		//     (D-17 visible status) + re-throw so pi halts the turn.
		pi.on("turn_start", async (_event, ctx) => {
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
			};

			try {
				const result = await emmyCompactionTrigger(triggerCtx);
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
		});
	};
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
