// Phase 04.5 Plan 06 Task 2 — sidecar JSONL index regression suite.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AuthStorage,
	createAgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import { writeSidecarEntry, type SidecarEntry } from "../../src/subagent/jsonl";
import { dispatchSubAgent } from "../../src/subagent";
import type { SubAgentSpec } from "../../src/subagent/types";

function readSidecarLines(path: string): SidecarEntry[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.trim()
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as SidecarEntry);
}

describe("writeSidecarEntry — pure function", () => {
	test("Test 1 — appends a single JSONL line to session-<id>.subagents.jsonl", () => {
		const dir = mkdtempSync(join(tmpdir(), "emmy-04.5-06-sidecar-"));
		const entry: SidecarEntry = {
			parent_span_id: "abcd1234",
			child_session_id: "child-1",
			persona: "research",
			pattern: "lean",
			started_at: new Date().toISOString(),
			ended_at: new Date().toISOString(),
			trace_id: "trace-xyz",
			ok: true,
		};
		writeSidecarEntry(dir, "parent-99", entry);
		const lines = readSidecarLines(join(dir, "session-parent-99.subagents.jsonl"));
		expect(lines.length).toBe(1);
		expect(lines[0]).toMatchObject(entry);
	});

	test("Test 2 — NO-OP when parentSessionDir or parentSessionId undefined", () => {
		const entry: SidecarEntry = {
			parent_span_id: "x",
			child_session_id: "y",
			persona: "research",
			pattern: "lean",
			started_at: new Date().toISOString(),
			trace_id: "t",
		};
		// Should not throw.
		writeSidecarEntry(undefined, "parent-99", entry);
		writeSidecarEntry("/some/dir", undefined, entry);
		writeSidecarEntry(undefined, undefined, entry);
	});

	test("Multiple appends — each writes a separate line", () => {
		const dir = mkdtempSync(join(tmpdir(), "emmy-04.5-06-sidecar-multi-"));
		for (let i = 0; i < 3; i++) {
			writeSidecarEntry(dir, "p-1", {
				parent_span_id: `s-${i}`,
				child_session_id: `c-${i}`,
				persona: "research",
				pattern: "lean",
				started_at: new Date().toISOString(),
				trace_id: `t-${i}`,
				ok: true,
			});
		}
		const lines = readSidecarLines(join(dir, "session-p-1.subagents.jsonl"));
		expect(lines.length).toBe(3);
		expect(lines.map((l) => l.child_session_id)).toEqual(["c-0", "c-1", "c-2"]);
	});
});

describe("dispatcher integration — sidecar entry on success path", () => {
	test("Test 3 (E2E) — successful dispatch writes sidecar entry with parent_span_id + trace_id + child_session_id", async () => {
		const apiId = `sidecar-${Math.random().toString(36).slice(2)}`;
		const reg = registerFauxProvider({
			api: apiId,
			provider: apiId,
			models: [{ id: "test-model", contextWindow: 4096, maxTokens: 1024 }],
		});
		reg.setResponses(Array(8).fill(fauxAssistantMessage("E2E_OK", { stopReason: "stop" })));

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(apiId, "fake-key");

		const parentCwd = mkdtempSync(join(tmpdir(), "emmy-04.5-06-sidecar-e2e-"));
		const parentSessionDir = mkdtempSync(join(tmpdir(), "emmy-04.5-06-parent-session-"));
		const parentServices = await createAgentSessionServices({ cwd: parentCwd, authStorage });

		const persona: SubAgentSpec = {
			name: "research",
			description: "x",
			pattern: "lean",
			toolAllowlist: [],
			maxTurns: 1,
		};
		await dispatchSubAgent(
			{
				parentServices,
				parentCwd,
				personas: { research: persona },
				modelResolver: () => reg.getModel(),
				parentSessionId: "parent-sid",
				parentSessionDir,
			},
			persona,
			{ description: "d", prompt: "ping" },
		);

		const lines = readSidecarLines(join(parentSessionDir, "session-parent-sid.subagents.jsonl"));
		expect(lines.length).toBe(1);
		const entry = lines[0];
		expect(entry.persona).toBe("research");
		expect(entry.pattern).toBe("lean");
		expect(entry.ok).toBe(true);
		expect(entry.started_at).toBeDefined();
		expect(entry.ended_at).toBeDefined();
		// parent_span_id and trace_id are populated (dispatcher reads them off the
		// span context). They may be string-shaped or undefined-shaped depending on
		// whether the test installs a tracer provider — assert defined-ness.
		expect(entry.parent_span_id).toBeDefined();
		expect(entry.trace_id).toBeDefined();
		expect(entry.child_session_id).toBeDefined();
		expect(entry.child_session_id.length).toBeGreaterThan(0);
		reg.unregister();
	});

	test("Test 4 (E2E failure) — dispatch failure writes sidecar with ok:false", async () => {
		// Pattern B with a missing personaDir → dispatchSubAgentInner throws BEFORE
		// child instantiation. This exercises the error-after-acquire branch where
		// child_session_id is empty and the sidecar writes ok:false.
		const apiId = `sidecar-fail-${Math.random().toString(36).slice(2)}`;
		const reg = registerFauxProvider({
			api: apiId,
			provider: apiId,
			models: [{ id: "test-model", contextWindow: 4096, maxTokens: 1024 }],
		});
		reg.setResponses(Array(8).fill(fauxAssistantMessage("ok", { stopReason: "stop" })));

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(apiId, "fake-key");

		const parentCwd = mkdtempSync(join(tmpdir(), "emmy-04.5-06-sidecar-fail-cwd-"));
		const parentSessionDir = mkdtempSync(join(tmpdir(), "emmy-04.5-06-parent-fail-sess-"));
		const parentServices = await createAgentSessionServices({ cwd: parentCwd, authStorage });

		// Pattern B but missing personaDir AND missing agentsContent — dispatcher throws.
		const badPersona: SubAgentSpec = {
			name: "research",
			description: "x",
			pattern: "persona",
			personaDir: undefined,
			agentsContent: undefined,
			toolAllowlist: ["read"],
			maxTurns: 1,
		};
		let threw = false;
		try {
			await dispatchSubAgent(
				{
					parentServices,
					parentCwd,
					personas: { research: badPersona },
					modelResolver: () => reg.getModel(),
					parentSessionId: "parent-fail-sid",
					parentSessionDir,
				},
				badPersona,
				{ description: "d", prompt: "ping" },
			);
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);

		const lines = readSidecarLines(
			join(parentSessionDir, "session-parent-fail-sid.subagents.jsonl"),
		);
		expect(lines.length).toBe(1);
		expect(lines[0].ok).toBe(false);
		expect(lines[0].persona).toBe("research");
		reg.unregister();
	});

	test("Test 5 (CONCURRENCY) — concurrent dispatches → 2 separate sidecar lines, no overwrite", async () => {
		const apiId = `sidecar-concur-${Math.random().toString(36).slice(2)}`;
		const reg = registerFauxProvider({
			api: apiId,
			provider: apiId,
			models: [{ id: "test-model", contextWindow: 4096, maxTokens: 1024 }],
		});
		reg.setResponses(Array(8).fill(fauxAssistantMessage("CONCUR", { stopReason: "stop" })));

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(apiId, "fake-key");

		const parentCwd = mkdtempSync(join(tmpdir(), "emmy-04.5-06-sidecar-concur-cwd-"));
		const parentSessionDir = mkdtempSync(join(tmpdir(), "emmy-04.5-06-parent-concur-"));
		const parentServices = await createAgentSessionServices({ cwd: parentCwd, authStorage });

		const persona: SubAgentSpec = {
			name: "research",
			description: "x",
			pattern: "lean",
			toolAllowlist: [],
			maxTurns: 1,
		};
		await Promise.all([
			dispatchSubAgent(
				{
					parentServices,
					parentCwd,
					personas: { research: persona },
					modelResolver: () => reg.getModel(),
					parentSessionId: "parent-concur",
					parentSessionDir,
				},
				persona,
				{ description: "d", prompt: "p1" },
			),
			dispatchSubAgent(
				{
					parentServices,
					parentCwd,
					personas: { research: persona },
					modelResolver: () => reg.getModel(),
					parentSessionId: "parent-concur",
					parentSessionDir,
				},
				persona,
				{ description: "d", prompt: "p2" },
			),
		]);
		const lines = readSidecarLines(
			join(parentSessionDir, "session-parent-concur.subagents.jsonl"),
		);
		expect(lines.length).toBe(2);
		// Each entry has a non-empty child_session_id; they may be the same ID-shape
		// (sessionId is per-session-instance), but each entry was independently appended.
		expect(lines.every((l) => l.ok === true)).toBe(true);
		reg.unregister();
	});
});
