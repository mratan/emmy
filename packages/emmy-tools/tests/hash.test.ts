import { describe, expect, test } from "bun:test";
import { HasherError, hash8hex, normalizeText } from "../src/hash";

describe("hash8hex (D-06: SHA-256 truncated to 8 hex chars)", () => {
	test("output is 8 lowercase hex chars", () => {
		const h = hash8hex("hello");
		expect(h).toMatch(/^[0-9a-f]{8}$/);
		expect(h.length).toBe(8);
	});

	test("idempotent across calls", () => {
		expect(hash8hex("abc")).toBe(hash8hex("abc"));
		expect(hash8hex("")).toBe(hash8hex(""));
	});

	test("different inputs yield different hashes (small sample)", () => {
		expect(hash8hex("a")).not.toBe(hash8hex("b"));
	});

	test("CRLF → LF normalization applied before hashing", () => {
		const a = hash8hex("a\r\nb");
		const b = hash8hex("a\nb");
		const c = hash8hex("a\rb");
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	test("NFC normalization — composed and decomposed é match", () => {
		// U+00E9 (composed) vs U+0065 U+0301 (decomposed)
		const composed = "café";
		const decomposed = "café";
		expect(hash8hex(composed)).toBe(hash8hex(decomposed));
	});

	test("lone high surrogate throws HasherError with 'lone' + 'surrogate'", () => {
		// U+D800 without a following low surrogate is a lone high surrogate.
		expect(() => hash8hex("\uD800")).toThrow(HasherError);
		try {
			hash8hex("\uD800");
		} catch (e) {
			expect((e as Error).message).toMatch(/lone.*surrogate/i);
		}
	});

	test("lone low surrogate throws HasherError", () => {
		expect(() => hash8hex("\uDC00")).toThrow(HasherError);
	});

	test("valid surrogate pair (emoji U+1F600) hashes without error", () => {
		expect(() => hash8hex("😀")).not.toThrow();
		expect(hash8hex("😀")).toMatch(/^[0-9a-f]{8}$/);
	});
});

describe("normalizeText", () => {
	test("CRLF → LF", () => {
		expect(normalizeText("a\r\nb\r\nc")).toBe("a\nb\nc");
	});

	test("bare CR → LF", () => {
		expect(normalizeText("a\rb")).toBe("a\nb");
	});

	test("NFC canonicalization", () => {
		const decomposed = "café";
		expect(normalizeText(decomposed)).toBe("café");
	});

	test("leaves plain ASCII/LF text unchanged", () => {
		expect(normalizeText("hello\nworld")).toBe("hello\nworld");
	});

	test("lone surrogate rejected", () => {
		expect(() => normalizeText("x\uDC00y")).toThrow(HasherError);
	});
});
