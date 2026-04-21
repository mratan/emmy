// packages/emmy-provider/src/openai-compat.ts
//
// Strips non-OpenAI fields vLLM may emit on assistant messages
// (`reasoning_content`, `thinking`) plus any extras the profile declares in
// `serving.yaml.quirks.strip_fields`. This is the TS side of Phase 1's
// `Quirks` pydantic model (see emmy_serve/profile/schema.py lines 116-120).
//
// STACK.md line 145 (lesson from the prior repo): vLLM emits
// `reasoning_content: null` and other non-OpenAI-standard fields that hang
// `@ai-sdk/openai-compatible` clients unless stripped.

import type { ProfileSnapshot } from "./types";

export function stripNonStandardFields(
	message: Record<string, unknown>,
	quirks?: ProfileSnapshot["serving"]["quirks"],
): Record<string, unknown> {
	// Always-stripped: vLLM reasoning emissions that aren't in the OpenAI spec.
	delete message.reasoning_content;
	delete message.thinking;
	// Optional additions declared by the profile.
	if (quirks?.strip_fields) {
		for (const k of quirks.strip_fields) {
			delete message[k];
		}
	}
	return message;
}
