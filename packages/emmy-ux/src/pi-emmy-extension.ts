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
	getRetryStateForSignal,
	handleBeforeProviderRequest,
	type AssembledPromptSnapshot,
	type BeforeProviderRequestPayload,
	type ProfileSnapshot,
	type RetryState,
} from "@emmy/provider";
import { emitEvent } from "@emmy/telemetry";

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

	return (pi: ExtensionAPI): void => {
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
	};
}
