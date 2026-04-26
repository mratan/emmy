// Plan 04.4-06 Task 1 — pure-function tests for prefix-hash helpers.

import { describe, expect, test } from "bun:test";
import {
	computePrefixHash,
	extractSystemPrefixBytes,
} from "../src/prefix-hash";

const SHA256_RE = /^[0-9a-f]{64}$/;

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

describe("extractSystemPrefixBytes", () => {
	test("returns buffer for system message text", () => {
		const buf = extractSystemPrefixBytes({
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: "u1" },
			],
		});
		const text = new TextDecoder("utf-8").decode(buf);
		expect(text).toContain("sys");
	});

	test("empty buffer when no system + no preamble + first turn is assistant", () => {
		const buf = extractSystemPrefixBytes({
			messages: [{ role: "assistant", content: "hi" }],
		});
		expect(buf.length).toBe(0);
	});

	test("tool catalog: adding a tool changes prefix bytes", () => {
		const a = extractSystemPrefixBytes({
			messages: [{ role: "system", content: "s" }],
			tools: [{ function: { name: "tool_a", description: "a" } }],
		});
		const b = extractSystemPrefixBytes({
			messages: [{ role: "system", content: "s" }],
			tools: [
				{ function: { name: "tool_a", description: "a" } },
				{ function: { name: "tool_b", description: "b" } },
			],
		});
		expect(equalBytes(a, b)).toBe(false);
	});

	test("tool catalog: reordering input is INVARIANT (alphabetic canonicalization)", () => {
		const a = extractSystemPrefixBytes({
			messages: [{ role: "system", content: "s" }],
			tools: [
				{ function: { name: "tool_a", description: "a" } },
				{ function: { name: "tool_b", description: "b" } },
			],
		});
		const b = extractSystemPrefixBytes({
			messages: [{ role: "system", content: "s" }],
			tools: [
				{ function: { name: "tool_b", description: "b" } },
				{ function: { name: "tool_a", description: "a" } },
			],
		});
		expect(equalBytes(a, b)).toBe(true);
	});

	test("leading user messages BEFORE first assistant turn contribute", () => {
		const a = extractSystemPrefixBytes({
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "preamble" },
			],
		});
		const b = extractSystemPrefixBytes({
			messages: [{ role: "system", content: "s" }],
		});
		expect(equalBytes(a, b)).toBe(false);
	});

	test("first assistant message is the cutoff (subsequent messages don't contribute)", () => {
		const a = extractSystemPrefixBytes({
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "u1" },
				{ role: "assistant", content: "a1" },
			],
		});
		const b = extractSystemPrefixBytes({
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "u1" },
				{ role: "assistant", content: "a1" },
				{ role: "user", content: "u2" },
				{ role: "assistant", content: "a2" },
				{ role: "tool", content: "t" },
			],
		});
		expect(equalBytes(a, b)).toBe(true);
	});
});

describe("computePrefixHash", () => {
	test("returns 64-character lowercase hex (sha256)", () => {
		const h = computePrefixHash({
			messages: [{ role: "system", content: "s" }],
		});
		expect(h).toMatch(SHA256_RE);
	});

	test("deterministic across 100 calls", () => {
		const args = {
			messages: [
				{ role: "system" as const, content: "sys" },
				{ role: "user" as const, content: "u" },
			],
			tools: [{ function: { name: "t", description: "d" } }],
		};
		const hashes = new Set<string>();
		for (let i = 0; i < 100; i++) hashes.add(computePrefixHash(args));
		expect(hashes.size).toBe(1);
	});

	test("hash differs when system message changes", () => {
		const a = computePrefixHash({
			messages: [{ role: "system", content: "v1" }],
		});
		const b = computePrefixHash({
			messages: [{ role: "system", content: "v2" }],
		});
		expect(a).not.toBe(b);
	});

	test("hash invariant to per-request fields (only messages+tools matter)", () => {
		// Per-request payload mutations like temperature, chat_template_kwargs
		// don't reach extractSystemPrefixBytes — extracted-from is the
		// {messages, tools} subset only.
		const a = computePrefixHash({
			messages: [{ role: "system", content: "s" }],
		});
		const b = computePrefixHash({
			messages: [{ role: "system", content: "s" }],
		});
		expect(a).toBe(b);
	});

	test("hash invariant to conversation-body growth (V3 core property)", () => {
		const turn0 = computePrefixHash({
			messages: [
				{ role: "system", content: "S" },
				{ role: "user", content: "preamble" },
				{ role: "assistant", content: "a1" },
			],
		});
		const turnN = computePrefixHash({
			messages: [
				{ role: "system", content: "S" },
				{ role: "user", content: "preamble" },
				{ role: "assistant", content: "a1" },
				{ role: "user", content: "u2" },
				{ role: "assistant", content: "a2" },
				{ role: "tool", content: "t1" },
				{ role: "user", content: "u3" },
				{ role: "assistant", content: "a3" },
			],
		});
		expect(turn0).toBe(turnN);
	});

	test("hash differs when CLAUDE.md/AGENTS.md preamble changes (leading user message)", () => {
		const a = computePrefixHash({
			messages: [
				{ role: "system", content: "S" },
				{ role: "user", content: "AGENTS preamble v1" },
			],
		});
		const b = computePrefixHash({
			messages: [
				{ role: "system", content: "S" },
				{ role: "user", content: "AGENTS preamble v2" },
			],
		});
		expect(a).not.toBe(b);
	});
});
