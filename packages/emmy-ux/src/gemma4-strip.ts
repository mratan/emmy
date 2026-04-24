// packages/emmy-ux/src/gemma4-strip.ts
//
// Phase 4 post-close follow-up (2026-04-24): harness-side strip of Gemma 4
// channel-bleed tokens that vLLM 0.19.1.dev6's gemma4 reasoning_parser fails
// to scrub in tool-call continuation paths.
//
// The bleed has TWO observed shapes against gemma-4-26B-A4B-it on
// vllm/vllm-openai:gemma4-0409-arm64-cu130:
//
//   (a) Full literal delimiter leak — the chat endpoint's
//       skip_special_tokens path emits the literal characters:
//         "<|channel>thought\n<channel|>…"
//       when the model's tokenizer decodes those positions as regular UTF-8
//       rather than recognizing them as the special tokens they structurally
//       are. Observed in the stock-market tool-call continuation
//       (runs/phase2-sc3-capture/session-2026-04-24T06-57-37-131Z.jsonl).
//
//   (b) Residual role label — even when the special tokens ARE stripped,
//       the "thought\n" role label inside them leaks as a content prefix:
//         "thought\n...actual content..."
//       The parser's offline _strip_thought_label handles this, but the
//       streaming chat path does not — reproduced with
//       `chat_template_kwargs.enable_thinking=false` + tool_call continuation.
//
// We strip both shapes ONLY when the loaded profile's
// serving.quirks.strip_thinking_tags is true. Qwen leaves them off
// (reasoning_parser works correctly on Qwen's `<think>` tags). Gemma 4 v2
// flips it on after this landing.
//
// Edge cases handled in this file's tests:
//   - No bleed → input unchanged
//   - Bleed at very start → stripped cleanly
//   - Multiple channel blocks in one message → all stripped
//   - Channel block with no `<channel|>` close → best-effort strip to end
//   - Leading whitespace after strip → trimmed
//   - Empty/all-whitespace result → returns empty string

const CHANNEL_BLOCK_RE =
	/<\|channel>thought\s*[\r\n]*([\s\S]*?)(?:<channel\|>|$)/g;
const LEADING_THOUGHT_LABEL_RE = /^\s*thought\s*[\r\n]+/;

/**
 * Strip Gemma 4 channel-thought bleed from a model response content string.
 * Idempotent on inputs that don't contain the bleed. Safe to run on empty
 * strings, long strings with multiple bleeds, and partial-truncation cases.
 */
export function stripGemma4ChannelBleed(text: string): string {
	if (!text || text.length === 0) return text;

	// (a) Strip full `<|channel>thought ... <channel|>` blocks. Non-greedy;
	// matches across newlines. If the close tag is missing (truncation),
	// strip through end-of-string.
	let out = text.replace(CHANNEL_BLOCK_RE, "");

	// (b) Strip residual `thought\n` role-label prefix that remained after
	// the reasoning parser ate the delimiters but left the label.
	out = out.replace(LEADING_THOUGHT_LABEL_RE, "");

	// Collapse the whitespace a stripped block may have left at the start.
	out = out.replace(/^\s+/, "");

	return out;
}
