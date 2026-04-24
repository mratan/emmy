// packages/emmy-ux/test/gemma4-strip.test.ts
//
// Coverage for the Gemma 4 channel-bleed strip helper used on tool-call
// continuation paths where vLLM 0.19.1.dev6's gemma4 reasoning_parser leaks
// thinking tokens into message content.

import { describe, expect, test } from "bun:test";
import { stripGemma4ChannelBleed } from "../src/gemma4-strip";

describe("stripGemma4ChannelBleed", () => {
	test("returns input unchanged when no bleed is present", () => {
		const input = "Two plus two equals four.";
		expect(stripGemma4ChannelBleed(input)).toBe(input);
	});

	test("returns empty string when input is empty", () => {
		expect(stripGemma4ChannelBleed("")).toBe("");
	});

	test("strips literal <|channel>thought\\n<channel|> prefix block (shape a)", () => {
		const input =
			"<|channel>thought\n<channel|>To give an accurate answer, I checked the market.\n\nS&P 500 up 1.05%.";
		const out = stripGemma4ChannelBleed(input);
		expect(out).toBe(
			"To give an accurate answer, I checked the market.\n\nS&P 500 up 1.05%.",
		);
	});

	test("strips literal channel block with multiline reasoning content", () => {
		const input =
			"<|channel>thought\nI should search for this.\nLet me call web_search.<channel|>Here is the answer: 42.";
		expect(stripGemma4ChannelBleed(input)).toBe("Here is the answer: 42.");
	});

	test("strips residual 'thought\\n' role-label prefix (shape b — parser ate delimiters)", () => {
		const input =
			"thought\nI do not have real-time data.\n\nTo get current prices, check Yahoo Finance.";
		const out = stripGemma4ChannelBleed(input);
		expect(out).toBe(
			"I do not have real-time data.\n\nTo get current prices, check Yahoo Finance.",
		);
	});

	test("strips multiple channel blocks when model emits more than one", () => {
		const input =
			"<|channel>thought\nFirst thought<channel|>First answer. <|channel>thought\nSecond thought<channel|>Second answer.";
		expect(stripGemma4ChannelBleed(input)).toBe(
			"First answer. Second answer.",
		);
	});

	test("strips an unterminated channel block (truncation / max_tokens hit mid-thought)", () => {
		const input = "<|channel>thought\nI started thinking but got cut off";
		// Non-greedy match with alternate end-anchor: entire tail removed.
		expect(stripGemma4ChannelBleed(input)).toBe("");
	});

	test("strips leading whitespace left behind after block removal", () => {
		const input = "<|channel>thought\n<channel|>\n\n   Hello world.";
		expect(stripGemma4ChannelBleed(input)).toBe("Hello world.");
	});

	test("does not touch 'thought' that isn't a role label (mid-sentence use)", () => {
		const input =
			"I had a thought\nthat was interesting — the NASDAQ moved.";
		// LEADING_THOUGHT_LABEL_RE only matches at ^; the "thought\n" here is
		// preceded by real text so the replacer doesn't fire.
		expect(stripGemma4ChannelBleed(input)).toBe(input);
	});

	test("returns empty when input is ONLY a channel block (no final answer)", () => {
		const input = "<|channel>thought\nAll my reasoning<channel|>";
		expect(stripGemma4ChannelBleed(input)).toBe("");
	});

	test("is idempotent — running twice yields the same output", () => {
		const input =
			"<|channel>thought\n<channel|>Answer. thought\nNot a label in mid-sentence.";
		const once = stripGemma4ChannelBleed(input);
		const twice = stripGemma4ChannelBleed(once);
		expect(twice).toBe(once);
	});

	test("handles the exact shape observed in runs/phase2-sc3-capture stock-market session", () => {
		// Taken verbatim from the stock-market session transcript at 2026-04-24
		// (reduced for brevity; preserves the shape).
		const input =
			"<|channel>thought\n<channel|>To give you an accurate answer, I would need to know which specific market or index...";
		const out = stripGemma4ChannelBleed(input);
		expect(out.startsWith("To give you an accurate answer")).toBe(true);
		expect(out).not.toContain("<|channel>");
		expect(out).not.toContain("<channel|>");
	});
});
