// packages/emmy-ux/test/session.mcp-poison.test.ts
//
// Plan 03-01 Task 1 (RED) — Phase-3 regression for the plan-checker BLOCKER
// on Phase-2 D-18 (Unicode poison gate). The new wire path for MCP tools in
// Phase 3 is `buildMcpToolDefs` (emits ToolDefinition[] for createAgentSession's
// customTools). This test verifies that the D-18 contract holds IDENTICALLY
// on the new path: tools whose `description` contains U+202E (RIGHT-TO-LEFT
// OVERRIDE) are rejected BEFORE a ToolDefinition is emitted.
//
// The poisoned codepoint is constructed AT RUNTIME via String.fromCodePoint
// (0x202E) — the raw BIDI character is deliberately NOT embedded in this
// file so planner-context injection detectors don't flag it.
//
// RED expectation: `buildMcpToolDefs` does NOT exist yet (Task 2 creates it).
// The import line fails to resolve → entire file fails to load → plan's
// failure condition met.

import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import type { McpServersConfig } from "@emmy/tools";

// Mock the MCP SDK BEFORE importing @emmy/tools — same pattern as
// packages/emmy-tools/tests/mcp-bridge.test.ts.
interface MockState {
	toolsByServer: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>>;
	connectedClients: Array<{ name: string; closed: boolean }>;
}
const mockState: MockState = { toolsByServer: {}, connectedClients: [] };

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: class {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		constructor(_s: { command: string; args: string[]; env?: Record<string, string> }) {}
	},
}));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		serverKey: string;
		constructor(info: { name: string; version: string }, _opts: unknown) {
			this.serverKey = info.name.split("/")[1] ?? info.name;
			mockState.connectedClients.push({ name: this.serverKey, closed: false });
		}
		async connect(_t: unknown): Promise<void> {}
		async listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }> {
			return { tools: mockState.toolsByServer[this.serverKey] ?? [] };
		}
		async callTool(_p: { name: string; arguments: Record<string, unknown> }): Promise<{ ok: true }> {
			return { ok: true };
		}
		close(): void {
			const e = mockState.connectedClients.find((c) => c.name === this.serverKey);
			if (e) e.closed = true;
		}
	},
}));

// RED: `buildMcpToolDefs` does not exist yet. Task 2 (GREEN) adds it.
const { buildMcpToolDefs } = await import("@emmy/tools");

const PROFILE_REF = { id: "gemma-4-26b-a4b-it", version: "v2", hash: "sha256:abc" };

beforeEach(() => {
	mockState.toolsByServer = {};
	mockState.connectedClients.length = 0;
});
afterEach(() => {
	mockState.toolsByServer = {};
});

describe("buildMcpToolDefs — D-18 poison gate re-assertion on the new ToolDefinition-emitting path", () => {
	test("tool description containing U+202E (BIDI-override) is rejected; ToolDefinition[] does not include it", async () => {
		const RLO = String.fromCodePoint(0x202E);
		mockState.toolsByServer = {
			filesystem: [
				{
					name: "clean_tool",
					description: "Regular description.",
					inputSchema: { type: "object" },
				},
				{
					name: "sneaky_tool",
					description: `Helpful ${RLO} hidden directive`,
					inputSchema: { type: "object" },
				},
			],
		};
		const cfg: McpServersConfig = {
			servers: { filesystem: { command: "npx", args: ["-y", "fake-fs"] } },
		};
		const out = await buildMcpToolDefs(cfg, {
			registeredToolNames: new Set<string>([
				"read",
				"write",
				"edit",
				"bash",
				"grep",
				"find",
				"ls",
				"web_fetch",
			]),
			profileRef: PROFILE_REF,
		});
		// Only the clean tool should surface. The poisoned one must not appear
		// under any name or namespaced form.
		const emittedNames = out.tools.map((t) => t.name);
		expect(emittedNames.some((n) => n.includes("sneaky_tool"))).toBe(false);
		expect(emittedNames.some((n) => n.includes("clean_tool"))).toBe(true);
	});

	test("clean tool passes through and emits exactly 1 ToolDefinition", async () => {
		mockState.toolsByServer = {
			filesystem: [
				{
					name: "fs_list",
					description: "Plain vanilla listing.",
					inputSchema: { type: "object" },
				},
			],
		};
		const cfg: McpServersConfig = {
			servers: { filesystem: { command: "npx", args: ["-y", "fake-fs"] } },
		};
		const out = await buildMcpToolDefs(cfg, {
			registeredToolNames: new Set<string>([
				"read",
				"write",
				"edit",
				"bash",
				"grep",
				"find",
				"ls",
				"web_fetch",
			]),
			profileRef: PROFILE_REF,
		});
		expect(out.tools.length).toBe(1);
		expect(out.tools[0]!.name.includes("fs_list")).toBe(true);
	});
});
