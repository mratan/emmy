// Phase 04.5 Plan 01 — SubAgentSpec + CreateSubAgentToolOpts contracts.
//
// Profile-owned persona schema mirrored from CONTEXT.md §decisions and
// the harness.yaml `subagents.personas.<name>` block (Plan 04.5-02 owns
// the YAML loader; this is the in-memory shape consumed by
// `createSubAgentTool` (./index.ts)).

import type { AgentSessionServices } from "@mariozechner/pi-coding-agent";

export type SubAgentSpec = {
	/** Persona key, e.g. "research". Doubles as the `subagent_type` literal in the parent's TypeBox schema. */
	name: string;
	/** Human-readable description. Surfaced verbatim in the parent's tool description (W4 fix — persona descriptions reach the parent's model). */
	description: string;
	/** Spawn pattern. LOCKED enum, matches harness.yaml. */
	pattern: "lean" | "persona";
	/** ABSOLUTE path to the persona's bundle directory. Required iff pattern==="persona" — used to resolve AGENTS.md. */
	personaDir?: string;
	/**
	 * Optional pre-loaded AGENTS.md content. Plan 04.5-02 may populate this so the dispatcher
	 * does not re-read the file on each dispatch. When undefined, the dispatcher reads
	 * `path.resolve(personaDir, "AGENTS.md")` lazily.
	 */
	agentsContent?: string;
	/** Allowlist of tool names. Narrows pi's defaults [read, bash, edit, write] (V3 contract). */
	toolAllowlist: string[];
	/** Optional per-persona model override. v1 logs warning + falls back to parent's model (single-model). */
	modelOverride?: string;
	/** Hard cap on child turns. v1 dispatch always runs exactly 1 turn — this is advisory metadata. */
	maxTurns: number;
	/** When true, route the child via SessionManager.create (Plan 04.5-06 wires this). Default false → SessionManager.inMemory. */
	persistTranscript?: boolean;
};

export interface CreateSubAgentToolOpts {
	/** Parent's runtime services. Pattern A reuses these (reference equality) — Pattern B builds new ones with cwd: parentCwd + agentsFilesOverride. */
	parentServices: AgentSessionServices;
	/** Parent's working directory. Pattern B passes this to createAgentSessionServices so the child's tools (read/grep/find/ls) operate on the user's project, NOT the persona bundle (B2 fix). */
	parentCwd: string;
	/** Map keyed by persona.name. Drives both the TypeBox `subagent_type` Union and the dispatch lookup. */
	personas: Record<string, SubAgentSpec>;
	/** Resolves a model id (e.g. "default", or persona.modelOverride) to a Model<any> the child uses. */
	modelResolver: (id: string) => unknown;
	/**
	 * Parent's pi AgentSession id (Plan 04.5-03). Stamped on OTel spans as `gen_ai.conversation.id`
	 * so the trace tree carries the parent's conversation context downstream.
	 */
	parentSessionId?: string;
}
