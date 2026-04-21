import { describe, expect, test } from "bun:test";
import { isBinary } from "../src/text-binary-detect";

describe("isBinary (D-08 fallback trigger: NUL-byte scan + UTF-8 round-trip)", () => {
	test("empty buffer → false", () => {
		expect(isBinary(Buffer.alloc(0))).toBe(false);
	});

	test("plain ASCII text → false", () => {
		expect(isBinary(Buffer.from("hello world\n", "utf8"))).toBe(false);
	});

	test("UTF-8 text with emoji → false", () => {
		expect(isBinary(Buffer.from("café 😀 naïve\n", "utf8"))).toBe(false);
	});

	test("multi-line UTF-8 including high-plane code points → false", () => {
		const text = "a\nb\n日本語\n" + "😀"; // emoji (surrogate pair)
		expect(isBinary(Buffer.from(text, "utf8"))).toBe(false);
	});

	test("buffer containing NUL byte → true", () => {
		expect(isBinary(Buffer.from([0x48, 0x00, 0x49]))).toBe(true);
	});

	test("NUL within first 8192 bytes → true", () => {
		const buf = Buffer.alloc(4096, 0x41); // 'A' * 4096
		buf[2048] = 0x00;
		expect(isBinary(buf)).toBe(true);
	});

	test("non-UTF-8 byte sequence → true", () => {
		// 0xFF 0xFE 0x48 — not valid UTF-8 on its own (BOM-like, but decoded + re-encoded differs)
		expect(isBinary(Buffer.from([0xff, 0xfe, 0x48]))).toBe(true);
	});

	test("isolated continuation byte (0x80) → true", () => {
		expect(isBinary(Buffer.from([0x80]))).toBe(true);
	});

	test("PNG signature (0x89 0x50 0x4E 0x47) → true", () => {
		expect(isBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
	});
});
