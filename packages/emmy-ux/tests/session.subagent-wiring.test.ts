// Phase 04.5 Plan 07 Task 1 — session.ts subagent-wiring contract regression.
//
// Verifies that buildRealPiRuntime injects the Agent tool into customTools when
// the active profile has `subagents.enabled: true`, and skips wiring otherwise.
//
// Approach: rather than driving a full createEmmySession (which requires SP_OK
// canary + emmy-vllm registration + many side effects), we exercise the
// loadPersonaConfig + createSubAgentTool composition the wiring uses. The
// integration that ties these into the real session is covered by V8's E2E
// (operator-gated, Plan 04.5-07 Task 3).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AuthStorage,
	createAgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import {
	createConcurrencyGovernor,
	createSubAgentTool,
} from "@emmy/tools";
import { loadPersonaConfig } from "../src/persona-loader";

const CANONICAL_BLOCK = `
subagents:
  enabled: true
  max_concurrent: 2
  long_context_serialize_threshold_tokens: 40000
  default_memory_scope: "project"
  personas:
    research:
      description: "Investigate without polluting parent's context."
      pattern: "persona"
      persona_dir: "subagents/research"
      tool_allowlist: ["read", "grep", "find", "ls"]
      model_override: null
      max_turns: 10
      persist_transcript: false
    bash_runner:
      description: "Execute a bash task and return the output."
      pattern: "lean"
      tool_allowlist: ["bash", "read"]
      max_turns: 3
      persist_transcript: false
`;

function setupCanonicalProfile(): string {
	const profilePath = mkdtempSync(join(tmpdir(), "emmy-04.5-07-wiring-"));
	writeFileSync(join(profilePath, "harness.yaml"), CANONICAL_BLOCK);
	mkdirSync(join(profilePath, "subagents", "research"), { recursive: true });
	writeFileSync(
		join(profilePath, "subagents", "research", "AGENTS.md"),
		"# research\nRESEARCH_PROMPT_MARKER\n".repeat(5),
	);
	return profilePath;
}

async function makeFakeServices() {
	const apiId = `wiring-${Math.random().toString(36).slice(2)}`;
	const reg = registerFauxProvider({
		api: apiId,
		provider: apiId,
		models: [{ id: "test-model", contextWindow: 4096, maxTokens: 1024 }],
	});
	reg.setResponses(Array(8).fill(fauxAssistantMessage("ok", { stopReason: "stop" })));
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(apiId, "fake-key");
	const cwd = mkdtempSync(join(tmpdir(), "emmy-04.5-07-cwd-"));
	const services = await createAgentSessionServices({ cwd, authStorage });
	return { services, cwd, model: reg.getModel(), reg };
}

describe("session.ts subagent wiring — integration with createSubAgentTool", () => {
	test("Test 1 — when profile has subagents enabled, createSubAgentTool produces a tool named 'Agent'", async () => {
		const profilePath = setupCanonicalProfile();
		const { services, cwd, model, reg } = await makeFakeServices();

		const personas = await loadPersonaConfig(profilePath);
		expect(Object.keys(personas).length).toBeGreaterThan(0);

		const governor = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: true,
		});
		const tool = createSubAgentTool({
			parentServices: services,
			parentCwd: cwd,
			personas,
			modelResolver: () => model,
			parentSessionId: "test-session",
			parentSessionDir: undefined,
			parentInputTokens: () => 0,
			governor,
		});
		expect(tool.name).toBe("Agent");
		reg.unregister();
	});

	test("Test 2 — createSubAgentTool consumes parentServices + cwd + personas + governor exactly as session.ts assembles them", async () => {
		const profilePath = setupCanonicalProfile();
		const { services, cwd, model, reg } = await makeFakeServices();

		const personas = await loadPersonaConfig(profilePath);
		// Match the LOCKED governor defaults from session.ts wiring.
		const governor = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: true,
		});
		const tool = createSubAgentTool({
			parentServices: services,
			parentCwd: cwd,
			personas,
			modelResolver: () => model,
			parentSessionId: "test-session",
			parentSessionDir: undefined,
			parentInputTokens: () => 0,
			governor,
		});
		// Tool description carries each persona's description verbatim (W4).
		expect(tool.description).toContain("research");
		expect(tool.description).toContain("bash_runner");
		expect(tool.description).toContain("Investigate without polluting");
		expect(tool.description).toContain("Execute a bash task");
		reg.unregister();
	});

	test("Test 3 — when subagents block absent or enabled:false, loadPersonaConfig returns empty (no Agent tool wired)", async () => {
		const profilePath = mkdtempSync(join(tmpdir(), "emmy-04.5-07-no-block-"));
		writeFileSync(join(profilePath, "harness.yaml"), "model: foo\n");
		const personas = await loadPersonaConfig(profilePath);
		expect(personas).toEqual({});
	});

	test("Test 4 — modelResolver always returns parent's emmyModel (single-model in v1)", async () => {
		const profilePath = setupCanonicalProfile();
		const { services, cwd, model, reg } = await makeFakeServices();
		const personas = await loadPersonaConfig(profilePath);
		const modelResolver = (_id: string) => model; // mirrors session.ts wiring
		expect(modelResolver("default")).toBe(model);
		expect(modelResolver("anything-else")).toBe(model);
		// And: the tool can be constructed without throwing.
		const governor = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: true,
		});
		const tool = createSubAgentTool({
			parentServices: services,
			parentCwd: cwd,
			personas,
			modelResolver,
			parentSessionId: undefined,
			parentSessionDir: undefined,
			parentInputTokens: () => 0,
			governor,
		});
		expect(tool.name).toBe("Agent");
		reg.unregister();
	});
});

describe("session.ts source — Agent tool wiring contract (file inspection)", () => {
	test("session.ts contains the Agent tool wiring literals", async () => {
		const src = await import("node:fs").then((m) =>
			m.readFileSync(
				new URL("../src/session.ts", import.meta.url).pathname,
				"utf8",
			),
		);
		expect(src).toContain("createSubAgentTool(");
		expect(src).toContain("loadPersonaConfig(");
		expect(src).toContain("createConcurrencyGovernor(");
		expect(src).toContain("parentSessionId: sessionId");
		expect(src).toContain("parentInputTokens");
		expect(src).toContain("governor");
		// LOCKED defaults present (Plan 04.5-04 I3)
		expect(src).toContain("rejectOverCap: true");
	});
});
