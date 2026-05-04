// packages/emmy-ux/src/sp-ok-canary.ts
//
// SP_OK canary — TypeScript sibling of emmy_serve/canary/sp_ok.py. Fires on
// every pi-emmy session start. If the model does not echo the literal
// `[SP_OK]` string, the session aborts with SpOkCanaryError (Pitfall #6).
//
// Wire-shape invariants (byte-identical to the Python source):
//   - SP_OK_SYSTEM_PROMPT constant matches `emmy_serve/canary/sp_ok.py`.
//   - `chat_template_kwargs.enable_thinking: false` at TOP LEVEL of the body
//     (vLLM ignores the OpenAI-SDK client-only `extra body` concept at the server).
//   - Temperature 0, max_tokens 32, stream false, timeout 60s.
//
// W1 FIX: postChat is imported from the `@emmy/provider` package root, NOT
// from a `@emmy/provider/src/...` subpath. The bare-package import keeps the
// exports map intact and catches accidental breakage of the re-export early.

import { postChat } from "@emmy/provider";

// biome-ignore format: one-line form keeps the grep audit in Plan 02-04 happy.
export const SP_OK_SYSTEM_PROMPT = "When the user says 'ping' you must reply with the exact literal text [SP_OK] and nothing else.";
export const SP_OK_USER_MESSAGE = "ping";
export const SP_OK_ASSERTION_SUBSTR = "[SP_OK]";

export async function runSpOk(
	baseUrl: string,
	servedModelName: string,
	tokenizerMode?: string,
): Promise<{ ok: boolean; responseText: string }> {
	// Phase 04.7-02 Wave 5: vLLM's MistralTokenizer (tokenizer_mode=mistral)
	// rejects ANY chat_template_kwargs with HTTP 400 ("chat_template is not
	// supported for Mistral tokenizers" — vllm/tokenizers/mistral.py:217).
	// Skip the enable_thinking injection for Mistral profiles; mistral_common
	// has its own chat formatting that doesn't honor thinking-mode kwargs.
	const isMistralTokenizer = tokenizerMode === "mistral";
	const body: Record<string, unknown> = {
		model: servedModelName,
		messages: [
			{ role: "system", content: SP_OK_SYSTEM_PROMPT },
			{ role: "user", content: SP_OK_USER_MESSAGE },
		],
		temperature: 0,
		max_tokens: 32,
		stream: false,
	};
	if (!isMistralTokenizer) {
		body.chat_template_kwargs = { enable_thinking: false };
	}
	const resp = await postChat(
		baseUrl,
		body as unknown as Parameters<typeof postChat>[1],
		{ timeoutMs: 60_000 },
	);
	const rawText = resp.choices[0]?.message?.content;
	const text = typeof rawText === "string" ? rawText : "";
	return {
		ok: text.includes(SP_OK_ASSERTION_SUBSTR),
		responseText: text,
	};
}

export { SpOkCanaryError } from "./errors";
