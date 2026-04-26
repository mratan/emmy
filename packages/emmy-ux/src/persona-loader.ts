// Phase 04.5 Plan 02 — persona-loader.
//
// Reads `<profilePath>/harness.yaml`, parses the `subagents:` block, validates
// each persona, resolves persona_dir to ABSOLUTE paths under the profile root
// (with symlink-realpath protection against traversal escape), and pre-loads
// each Pattern B persona's AGENTS.md content into SubAgentSpec.agentsContent
// (B2 fix — dispatcher consumes this without re-reading per dispatch).
//
// The output Record<personaSlug, SubAgentSpec> is what `createSubAgentTool`
// from @emmy/tools accepts directly (Plan 04.5-01).
//
// LOCKED conventions (CONTEXT.md §decisions):
//   - YAML keys: snake_case (research / code_reviewer / bash_runner)
//   - On-disk dirs: kebab-case (subagents/research, subagents/code-reviewer, subagents/bash-runner)
//   - persona_dir field carries the kebab-case path AS WRITTEN in yaml.
//   - SubAgentSpec.name = the YAML key (snake_case), preserved through dispatcher and OTel.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve as pathResolve, isAbsolute } from "node:path";
import yaml from "js-yaml";
import type { SubAgentSpec } from "@emmy/tools";

export type PersonaLoadErrorCode =
	| "no_subagents_block"
	| "invalid_persona"
	| "path_traversal"
	| "missing_agents_md"
	| "missing_persona_dir";

export class PersonaLoadError extends Error {
	readonly code: PersonaLoadErrorCode;
	readonly persona?: string;
	constructor(code: PersonaLoadErrorCode, message: string, persona?: string) {
		super(message);
		this.name = "PersonaLoadError";
		this.code = code;
		this.persona = persona;
	}
}

interface RawPersonaEntry {
	description?: unknown;
	pattern?: unknown;
	persona_dir?: unknown;
	tool_allowlist?: unknown;
	model_override?: unknown;
	max_turns?: unknown;
	persist_transcript?: unknown;
}

interface RawSubagentsBlock {
	enabled?: unknown;
	personas?: Record<string, RawPersonaEntry>;
}

/**
 * Parse the profile's harness.yaml `subagents:` block into the spec map
 * the SubAgentTool factory accepts.
 *
 * Returns `{}` (empty record) when the block is missing or `enabled !== true`.
 * Throws `PersonaLoadError` on any validation or path-traversal failure.
 */
export async function loadPersonaConfig(
	profilePath: string,
): Promise<Record<string, SubAgentSpec>> {
	const harnessPath = join(profilePath, "harness.yaml");
	if (!existsSync(harnessPath)) {
		throw new PersonaLoadError(
			"no_subagents_block",
			`harness.yaml not found at ${harnessPath}`,
		);
	}
	const raw = yaml.load(readFileSync(harnessPath, "utf8")) as Record<string, unknown> | null;
	if (!raw || typeof raw !== "object") return {};
	const block = raw["subagents"] as RawSubagentsBlock | undefined;
	if (!block || block.enabled !== true) return {};
	const personasRaw = block.personas;
	if (!personasRaw || typeof personasRaw !== "object") return {};

	const out: Record<string, SubAgentSpec> = {};
	for (const personaSlug of Object.keys(personasRaw)) {
		const entry = personasRaw[personaSlug]!;

		// description must be a non-empty string.
		if (typeof entry.description !== "string" || entry.description.length === 0) {
			throw new PersonaLoadError(
				"invalid_persona",
				`persona "${personaSlug}" missing or invalid description`,
				personaSlug,
			);
		}
		// pattern must be "lean" or "persona".
		if (entry.pattern !== "lean" && entry.pattern !== "persona") {
			throw new PersonaLoadError(
				"invalid_persona",
				`persona "${personaSlug}" pattern must be "lean" or "persona", got ${JSON.stringify(entry.pattern)}`,
				personaSlug,
			);
		}
		// tool_allowlist must be a non-empty string array.
		if (
			!Array.isArray(entry.tool_allowlist) ||
			entry.tool_allowlist.length === 0 ||
			!entry.tool_allowlist.every((t: unknown) => typeof t === "string")
		) {
			throw new PersonaLoadError(
				"invalid_persona",
				`persona "${personaSlug}" tool_allowlist must be a non-empty array of strings`,
				personaSlug,
			);
		}
		// max_turns must be a number.
		if (typeof entry.max_turns !== "number") {
			throw new PersonaLoadError(
				"invalid_persona",
				`persona "${personaSlug}" max_turns must be a number`,
				personaSlug,
			);
		}

		let personaDir: string | undefined;
		let agentsContent: string | undefined;
		if (entry.pattern === "persona") {
			if (typeof entry.persona_dir !== "string" || entry.persona_dir.length === 0) {
				throw new PersonaLoadError(
					"invalid_persona",
					`persona "${personaSlug}" pattern="persona" requires persona_dir`,
					personaSlug,
				);
			}
			// Resolve relative to profilePath; reject absolute paths and traversal escape.
			const resolved = pathResolve(profilePath, entry.persona_dir);
			const rel = relative(profilePath, resolved);
			if (rel.startsWith("..") || isAbsolute(rel)) {
				throw new PersonaLoadError(
					"path_traversal",
					`persona "${personaSlug}" persona_dir escapes profile root: ${entry.persona_dir}`,
					personaSlug,
				);
			}
			// Defense-in-depth: dereference symlinks and re-check invariant.
			let realResolved: string;
			try {
				realResolved = realpathSync(resolved);
			} catch {
				throw new PersonaLoadError(
					"missing_persona_dir",
					`persona "${personaSlug}" persona_dir does not exist: ${resolved}`,
					personaSlug,
				);
			}
			const realRel = relative(profilePath, realResolved);
			if (realRel.startsWith("..") || isAbsolute(realRel)) {
				throw new PersonaLoadError(
					"path_traversal",
					`persona "${personaSlug}" persona_dir realpath escapes profile root: ${realResolved}`,
					personaSlug,
				);
			}
			let stat;
			try {
				stat = statSync(realResolved);
			} catch {
				throw new PersonaLoadError(
					"missing_persona_dir",
					`persona "${personaSlug}" persona_dir does not exist: ${realResolved}`,
					personaSlug,
				);
			}
			if (!stat.isDirectory()) {
				throw new PersonaLoadError(
					"missing_persona_dir",
					`persona "${personaSlug}" persona_dir is not a directory: ${realResolved}`,
					personaSlug,
				);
			}
			const agentsPath = join(realResolved, "AGENTS.md");
			if (!existsSync(agentsPath)) {
				throw new PersonaLoadError(
					"missing_agents_md",
					`persona "${personaSlug}" missing AGENTS.md at ${agentsPath}`,
					personaSlug,
				);
			}
			personaDir = realResolved;
			// B2 fix: pre-load AGENTS.md content into the spec.
			agentsContent = readFileSync(agentsPath, "utf8");
		}

		const spec: SubAgentSpec = {
			name: personaSlug,
			description: entry.description,
			pattern: entry.pattern,
			personaDir,
			agentsContent,
			toolAllowlist: entry.tool_allowlist as string[],
			modelOverride:
				typeof entry.model_override === "string" && entry.model_override.length > 0
					? entry.model_override
					: undefined,
			maxTurns: entry.max_turns,
			persistTranscript: entry.persist_transcript === true,
		};
		out[personaSlug] = spec;
	}
	return out;
}
