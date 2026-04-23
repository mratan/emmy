// packages/emmy-provider/src/index.ts
//
// @emmy/provider — pi-registered provider that speaks OpenAI-compatible
// chat-completions to Phase 1's emmy-serve (loopback). Applies profile-driven
// sampling + quirks, strips non-OpenAI response fields, and (from Task 2)
// routes through the reactive XGrammar retry path (D-11).
//
// W1 FIX (re-export audit): `postChat` + adjacent surface is re-exported at
// the package root so downstream plans (Plan 04 sp-ok-canary, eval runners)
// import via `@emmy/provider` — no `@emmy/provider/src/...` subpaths.

import { callWithReactiveGrammar } from "./grammar-retry";
import { postChat } from "./http";
import { stripNonStandardFields } from "./openai-compat";
import type { ChatRequest, ChatResponse, ProfileSnapshot } from "./types";

// W1 FIX: package-root re-exports. Plan 04 sp-ok-canary imports `postChat`
// from here; Plan 08 eval corpus imports `callWithReactiveGrammar`. Do NOT
// remove — the exports map routes everything through "./src/index.ts".
export {
	callWithReactiveGrammar,
	getRetryStateForSignal,
	setRetryStateForSignal,
} from "./grammar-retry";
export { postChat } from "./http";
export { stripNonStandardFields } from "./openai-compat";
// Phase 3 Plan 03-01: before_provider_request hook — consumed by
// packages/emmy-ux/src/pi-emmy-extension.ts to install the authoritative
// wire path for D-02a/b/c and D-04 on every live chat request.
export {
	handleBeforeProviderRequest,
	type BeforeProviderRequestPayload,
	type AssembledPromptSnapshot,
	type RetryState,
} from "./before-request-hook";
// Phase 4 Plan 04-04 (HARNESS-08) — routes.yaml variant resolver + shared
// RouteRef/RoutesConfig types. Lives here (not @emmy/ux) to break the
// circular dependency with routes-loader.ts (@emmy/ux already imports
// @emmy/provider).
export {
	resolveVariant,
	type RoleKey,
	type RouteRef,
	type RoutesConfig,
	type ResolvedVariant,
} from "./variant-resolver";
export * from "./types";
export * from "./errors";

// pi's ProviderImpl signature is loose in 0.68.0; type only the minimal surface
// we actually call.
interface PiProviderImpl {
	name: string;
	chat(req: unknown, signal?: AbortSignal): Promise<unknown>;
}

export function registerEmmyProvider(
	pi: { registerProvider: (name: string, impl: PiProviderImpl) => void },
	profile: ProfileSnapshot,
	opts: { baseUrl?: string; turnIdProvider?: () => string } = {},
): void {
	const baseUrl = opts.baseUrl ?? "http://127.0.0.1:8002";
	const providerName = `emmy:${profile.ref.id}@${profile.ref.version}`;

	pi.registerProvider(providerName, {
		name: providerName,
		chat: async (req: unknown, _signal?: AbortSignal): Promise<ChatResponse> => {
			// Task 2 wiring: route through reactive XGrammar retry (D-11).
			// First POST is always unconstrained; retry only on tool-call parse
			// failure. postChat is still imported above to keep the module
			// self-contained; the re-export at package root preserves the
			// bare-import contract (W1 fix).
			void postChat;
			const payload = shapeRequest(req as ChatRequest, profile);
			const { response } = await callWithReactiveGrammar(
				baseUrl,
				payload,
				profile,
				{ turnId: opts.turnIdProvider?.() },
			);
			for (const c of response.choices) {
				stripNonStandardFields(
					c.message as unknown as Record<string, unknown>,
					profile.serving.quirks,
				);
			}
			return response;
		},
	});
}

// User-supplied fields win; profile defaults fill in the gaps.
function shapeRequest(req: ChatRequest, profile: ProfileSnapshot): ChatRequest {
	const samp = profile.serving.sampling_defaults;
	return {
		...req,
		model: profile.serving.engine.served_model_name,
		temperature: req.temperature ?? samp.temperature,
		top_p: req.top_p ?? samp.top_p,
		max_tokens: req.max_tokens ?? samp.max_tokens,
		stop: req.stop ?? samp.stop,
	};
}
