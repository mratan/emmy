// Phase 04.5 Plan 06 Task 1 — resolveChildSessionManager regression suite.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveChildSessionManager } from "../../src/subagent/jsonl";
import type { SubAgentSpec } from "../../src/subagent/types";

function makeCwd(): string {
	return mkdtempSync(join(tmpdir(), "emmy-04.5-06-jsonl-"));
}

describe("resolveChildSessionManager — Pattern × persistTranscript matrix", () => {
	test("Test 1 — lean + persistTranscript=false → inMemory, childJsonlPath undefined", () => {
		const persona: SubAgentSpec = {
			name: "research",
			description: "x",
			pattern: "lean",
			toolAllowlist: ["read"],
			maxTurns: 1,
			persistTranscript: false,
		};
		const cwd = makeCwd();
		const { sm, childJsonlPath } = resolveChildSessionManager(persona, cwd, "abc12345");
		expect(sm).toBeDefined();
		expect(childJsonlPath).toBeUndefined();
		expect(existsSync(join(cwd, ".emmy/subagents"))).toBe(false);
	});

	test("Test 2 — lean + persistTranscript=true → SessionManager.create + childJsonlPath set", () => {
		const persona: SubAgentSpec = {
			name: "research",
			description: "x",
			pattern: "lean",
			toolAllowlist: ["read"],
			maxTurns: 1,
			persistTranscript: true,
		};
		const cwd = makeCwd();
		const { sm, childJsonlPath } = resolveChildSessionManager(persona, cwd, "abc12345");
		expect(sm).toBeDefined();
		expect(childJsonlPath).toBeDefined();
		expect(childJsonlPath!).toContain(".emmy/subagents");
		expect(childJsonlPath!).toContain("research-");
		expect(existsSync(childJsonlPath!)).toBe(true);
	});

	test("Test 3 — persona + persistTranscript=false → inMemory (CONTEXT.md LOCKED rule)", () => {
		const persona: SubAgentSpec = {
			name: "research",
			description: "x",
			pattern: "persona",
			toolAllowlist: ["read"],
			maxTurns: 1,
			persistTranscript: false,
		};
		const cwd = makeCwd();
		const { sm, childJsonlPath } = resolveChildSessionManager(persona, cwd, "abc12345");
		expect(sm).toBeDefined();
		expect(childJsonlPath).toBeUndefined();
	});

	test("Test 4 — persona + persistTranscript=true → SessionManager.create + childJsonlPath set", () => {
		const persona: SubAgentSpec = {
			name: "code_reviewer",
			description: "x",
			pattern: "persona",
			toolAllowlist: ["read"],
			maxTurns: 1,
			persistTranscript: true,
		};
		const cwd = makeCwd();
		const { sm, childJsonlPath } = resolveChildSessionManager(persona, cwd, "deadbeef");
		expect(sm).toBeDefined();
		expect(childJsonlPath).toBeDefined();
		expect(childJsonlPath!).toContain("code_reviewer-");
		expect(existsSync(childJsonlPath!)).toBe(true);
	});

	test("Test 5 — persistTranscript path includes persona name AND timestamp suffix (no collision)", () => {
		const persona: SubAgentSpec = {
			name: "research",
			description: "x",
			pattern: "lean",
			toolAllowlist: ["read"],
			maxTurns: 1,
			persistTranscript: true,
		};
		const cwd = makeCwd();
		const a = resolveChildSessionManager(persona, cwd, "11111111");
		// Sleep to guarantee a different ISO timestamp.
		const sleep = () => new Promise((r) => setTimeout(r, 10));
		return sleep().then(() => {
			const b = resolveChildSessionManager(persona, cwd, "22222222");
			expect(a.childJsonlPath).not.toBe(b.childJsonlPath);
			// Both directories under .emmy/subagents/research-...
			expect(a.childJsonlPath!).toContain("research-");
			expect(b.childJsonlPath!).toContain("research-");
		});
	});

	test("Test 6 — persona name failing sanitization throws", () => {
		const persona: SubAgentSpec = {
			name: "../evil",
			description: "x",
			pattern: "lean",
			toolAllowlist: ["read"],
			maxTurns: 1,
			persistTranscript: true,
		};
		const cwd = makeCwd();
		expect(() => resolveChildSessionManager(persona, cwd, "abc")).toThrow(/sanitization/);
	});
});
