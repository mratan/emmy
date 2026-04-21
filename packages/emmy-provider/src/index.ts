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

import { postChat } from "./http";
import { stripNonStandardFields } from "./openai-compat";
import type { ChatRequest, ChatResponse, ProfileSnapshot } from "./types";

// W1 FIX: package-root re-exports. Plan 04 sp-ok-canary imports `postChat`
// from here; do NOT remove.
export { postChat } from "./http";
export { stripNonStandardFields } from "./openai-compat";
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
			// Task 2 replaces this body with a call to callWithReactiveGrammar.
			// For Task 1, we issue an unconstrained POST only.
			const payload = shapeRequest(req as ChatRequest, profile);
			const resp = await postChat(baseUrl, payload);
			for (const c of resp.choices) {
				stripNonStandardFields(
					c.message as unknown as Record<string, unknown>,
					profile.serving.quirks,
				);
			}
			// opts.turnIdProvider is reserved for Task 2 telemetry wiring; Task 1
			// intentionally does not consume it (unconstrained-only path).
			void opts.turnIdProvider;
			return resp;
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
