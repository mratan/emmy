// packages/emmy-ux/src/pi-emmy-extension.ts
//
// Plan 03-01 Task 2 (GREEN) — pi 0.68 ExtensionFactory that installs
// Emmy's before_provider_request payload mutator on every chat request
// flowing through a pi AgentSession.
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
			handleBeforeProviderRequest({
				payload,
				profile,
				assembledPrompt: assembledPromptProvider(),
				retryState,
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
