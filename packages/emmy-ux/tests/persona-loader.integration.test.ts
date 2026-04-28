// Phase 04.5 Plan 02 Task 3 — integration test against the real shipped profiles.
//
// Catches yaml typos, persona_dir drift, and AGENTS.md missing across the
// shipped profiles in one shot. Asserts the LOCKED toolAllowlist values + B2
// agentsContent pre-loading invariants for Pattern B personas.
// 2026-04-28: Qwen 35B-A3B MoE dropped from active stack per V-RESULTS-v8;
// this matrix shrank 4 → 5 entries (Gemma MoE v2 + v2.1 audit/operational
// pair + Qwen 27B dense v1.1 + Gemma 31B dense v1.1 + v1.2).

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadPersonaConfig } from "../src/persona-loader";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

const PROFILES = [
	{ name: "gemma-4-26b-a4b-it", version: "v2" },     // KV-bisection audit
	{ name: "gemma-4-26b-a4b-it", version: "v2.1" },   // operational daily-driver
	{ name: "qwen3.6-27b", version: "v1.1" },          // dense Qwen sibling
	{ name: "gemma-4-31b-it", version: "v1.1" },       // dense Gemma 128K
	{ name: "gemma-4-31b-it", version: "v1.2" },       // dense Gemma 256K
] as const;

describe("loadPersonaConfig — integration over shipped profiles", () => {
	for (const profile of PROFILES) {
		const profilePath = resolve(REPO_ROOT, "profiles", profile.name, profile.version);

		test(`${profile.name}@${profile.version} — has 3 expected personas`, async () => {
			const personas = await loadPersonaConfig(profilePath);
			expect(Object.keys(personas).sort()).toEqual([
				"bash_runner",
				"code_reviewer",
				"research",
			]);
		});

		test(`${profile.name}@${profile.version} — research is Pattern B with personaDir + agentsContent (B2)`, async () => {
			const personas = await loadPersonaConfig(profilePath);
			const research = personas.research!;
			expect(research.pattern).toBe("persona");
			expect(research.personaDir).toBeDefined();
			expect(research.personaDir).toContain("subagents/research");
			expect(research.agentsContent).toBeDefined();
			expect(research.agentsContent!.length).toBeGreaterThan(50);
			expect(research.toolAllowlist).toEqual(["read", "grep", "find", "ls"]);
		});

		test(`${profile.name}@${profile.version} — code_reviewer is Pattern B with personaDir + agentsContent (B2)`, async () => {
			const personas = await loadPersonaConfig(profilePath);
			const reviewer = personas.code_reviewer!;
			expect(reviewer.pattern).toBe("persona");
			expect(reviewer.personaDir).toBeDefined();
			expect(reviewer.personaDir).toContain("subagents/code-reviewer");
			expect(reviewer.agentsContent).toBeDefined();
			expect(reviewer.toolAllowlist).toEqual(["read", "grep"]);
		});

		test(`${profile.name}@${profile.version} — bash_runner is Pattern A (lean) with no personaDir/agentsContent`, async () => {
			const personas = await loadPersonaConfig(profilePath);
			const bash = personas.bash_runner!;
			expect(bash.pattern).toBe("lean");
			expect(bash.personaDir).toBeUndefined();
			expect(bash.agentsContent).toBeUndefined();
			expect(bash.toolAllowlist).toEqual(["bash", "read"]);
		});

		test(`${profile.name}@${profile.version} — all personas carry the YAML key as name`, async () => {
			const personas = await loadPersonaConfig(profilePath);
			expect(personas.research?.name).toBe("research");
			expect(personas.code_reviewer?.name).toBe("code_reviewer");
			expect(personas.bash_runner?.name).toBe("bash_runner");
		});
	}
});
