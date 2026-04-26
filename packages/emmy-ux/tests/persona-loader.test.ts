// Phase 04.5 Plan 02 Task 1 — persona-loader unit tests.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPersonaConfig, PersonaLoadError } from "../src/persona-loader";

function makeProfile(): string {
	return mkdtempSync(join(tmpdir(), "emmy-04.5-02-profile-"));
}

function writeYaml(profilePath: string, body: string) {
	writeFileSync(join(profilePath, "harness.yaml"), body);
}

const CANONICAL_BLOCK = `
subagents:
  enabled: true
  max_concurrent: 2
  long_context_serialize_threshold_tokens: 40000
  default_memory_scope: "project"
  personas:
    research:
      description: "Investigate a specific question without polluting parent's context."
      pattern: "persona"
      persona_dir: "subagents/research"
      tool_allowlist: ["read", "grep", "find", "ls"]
      model_override: null
      max_turns: 10
      persist_transcript: false
    code_reviewer:
      description: "Review a diff or file for bugs and style."
      pattern: "persona"
      persona_dir: "subagents/code-reviewer"
      tool_allowlist: ["read", "grep"]
      max_turns: 5
      persist_transcript: false
    bash_runner:
      description: "Execute a bash task and return the output."
      pattern: "lean"
      tool_allowlist: ["bash", "read"]
      max_turns: 3
      persist_transcript: false
`;

function setupCanonicalProfile(): string {
	const profilePath = makeProfile();
	writeYaml(profilePath, CANONICAL_BLOCK);
	mkdirSync(join(profilePath, "subagents", "research"), { recursive: true });
	writeFileSync(
		join(profilePath, "subagents", "research", "AGENTS.md"),
		"# research\nRESEARCH_PROMPT_MARKER",
	);
	mkdirSync(join(profilePath, "subagents", "code-reviewer"), { recursive: true });
	writeFileSync(
		join(profilePath, "subagents", "code-reviewer", "AGENTS.md"),
		"# code-reviewer\nREVIEWER_PROMPT_MARKER",
	);
	return profilePath;
}

describe("loadPersonaConfig — happy path", () => {
	test("Test 1 — returns 3 personas with correct keys when block enabled", async () => {
		const profilePath = setupCanonicalProfile();
		const personas = await loadPersonaConfig(profilePath);
		expect(Object.keys(personas).sort()).toEqual(["bash_runner", "code_reviewer", "research"]);
	});

	test("Test 2 — Pattern B personaDir is resolved to absolute path; lean has undefined", async () => {
		const profilePath = setupCanonicalProfile();
		const personas = await loadPersonaConfig(profilePath);
		expect(personas.research?.personaDir).toBeDefined();
		expect(personas.research?.personaDir).toContain("subagents/research");
		expect(personas.code_reviewer?.personaDir).toBeDefined();
		expect(personas.bash_runner?.personaDir).toBeUndefined();
	});

	test("Test 2b (B2) — agentsContent pre-loaded with AGENTS.md byte content for Pattern B", async () => {
		const profilePath = setupCanonicalProfile();
		const personas = await loadPersonaConfig(profilePath);
		expect(personas.research?.agentsContent).toContain("RESEARCH_PROMPT_MARKER");
		expect(personas.code_reviewer?.agentsContent).toContain("REVIEWER_PROMPT_MARKER");
		expect(personas.bash_runner?.agentsContent).toBeUndefined();
	});

	test("Test 6 — returns {} when subagents block is absent", async () => {
		const profilePath = makeProfile();
		writeYaml(profilePath, "model: foo\n");
		const personas = await loadPersonaConfig(profilePath);
		expect(personas).toEqual({});
	});

	test("Test 6b — returns {} when subagents.enabled is false", async () => {
		const profilePath = makeProfile();
		writeYaml(profilePath, "subagents:\n  enabled: false\n  personas:\n    research:\n      description: x\n      pattern: lean\n      tool_allowlist: ['read']\n      max_turns: 1\n");
		const personas = await loadPersonaConfig(profilePath);
		expect(personas).toEqual({});
	});
});

describe("loadPersonaConfig — error paths", () => {
	test("Test 3 — path_traversal blocks ../ escape", async () => {
		const profilePath = makeProfile();
		writeYaml(
			profilePath,
			`subagents:
  enabled: true
  personas:
    bad:
      description: "bad persona"
      pattern: "persona"
      persona_dir: "../escape-target"
      tool_allowlist: ["read"]
      max_turns: 1
`,
		);
		try {
			await loadPersonaConfig(profilePath);
			throw new Error("expected PersonaLoadError(path_traversal)");
		} catch (e) {
			expect(e).toBeInstanceOf(PersonaLoadError);
			expect((e as PersonaLoadError).code).toBe("path_traversal");
			expect((e as PersonaLoadError).persona).toBe("bad");
		}
	});

	test("Test 3b — path_traversal blocks symlink escape via realpathSync", async () => {
		const profilePath = makeProfile();
		// Create a real escape target with AGENTS.md OUTSIDE the profile dir.
		const escapeDir = mkdtempSync(join(tmpdir(), "emmy-04.5-02-symlink-target-"));
		writeFileSync(join(escapeDir, "AGENTS.md"), "# evil");
		// Create subagents/<linked> symlink that points to escapeDir.
		mkdirSync(join(profilePath, "subagents"), { recursive: true });
		symlinkSync(escapeDir, join(profilePath, "subagents", "linked"));
		writeYaml(
			profilePath,
			`subagents:
  enabled: true
  personas:
    bad:
      description: "bad symlink"
      pattern: "persona"
      persona_dir: "subagents/linked"
      tool_allowlist: ["read"]
      max_turns: 1
`,
		);
		try {
			await loadPersonaConfig(profilePath);
			throw new Error("expected PersonaLoadError(path_traversal)");
		} catch (e) {
			expect(e).toBeInstanceOf(PersonaLoadError);
			expect((e as PersonaLoadError).code).toBe("path_traversal");
		}
	});

	test("Test 4 — missing_persona_dir when dir doesn't exist", async () => {
		const profilePath = makeProfile();
		writeYaml(
			profilePath,
			`subagents:
  enabled: true
  personas:
    nope:
      description: "missing"
      pattern: "persona"
      persona_dir: "subagents/does-not-exist"
      tool_allowlist: ["read"]
      max_turns: 1
`,
		);
		try {
			await loadPersonaConfig(profilePath);
			throw new Error("expected PersonaLoadError(missing_persona_dir)");
		} catch (e) {
			expect(e).toBeInstanceOf(PersonaLoadError);
			expect((e as PersonaLoadError).code).toBe("missing_persona_dir");
		}
	});

	test("Test 5 — missing_agents_md when persona_dir exists but AGENTS.md is absent", async () => {
		const profilePath = makeProfile();
		mkdirSync(join(profilePath, "subagents", "ghost"), { recursive: true });
		writeYaml(
			profilePath,
			`subagents:
  enabled: true
  personas:
    ghost:
      description: "ghost persona"
      pattern: "persona"
      persona_dir: "subagents/ghost"
      tool_allowlist: ["read"]
      max_turns: 1
`,
		);
		try {
			await loadPersonaConfig(profilePath);
			throw new Error("expected PersonaLoadError(missing_agents_md)");
		} catch (e) {
			expect(e).toBeInstanceOf(PersonaLoadError);
			expect((e as PersonaLoadError).code).toBe("missing_agents_md");
		}
	});

	test("Test 7 — invalid_persona for unknown pattern value", async () => {
		const profilePath = makeProfile();
		writeYaml(
			profilePath,
			`subagents:
  enabled: true
  personas:
    weird:
      description: "weird"
      pattern: "telepathic"
      tool_allowlist: ["read"]
      max_turns: 1
`,
		);
		try {
			await loadPersonaConfig(profilePath);
			throw new Error("expected PersonaLoadError(invalid_persona)");
		} catch (e) {
			expect(e).toBeInstanceOf(PersonaLoadError);
			expect((e as PersonaLoadError).code).toBe("invalid_persona");
		}
	});

	test("Test 8 — invalid_persona for empty tool_allowlist", async () => {
		const profilePath = makeProfile();
		writeYaml(
			profilePath,
			`subagents:
  enabled: true
  personas:
    empty_allow:
      description: "no tools"
      pattern: "lean"
      tool_allowlist: []
      max_turns: 1
`,
		);
		try {
			await loadPersonaConfig(profilePath);
			throw new Error("expected PersonaLoadError(invalid_persona)");
		} catch (e) {
			expect(e).toBeInstanceOf(PersonaLoadError);
			expect((e as PersonaLoadError).code).toBe("invalid_persona");
		}
	});
});
