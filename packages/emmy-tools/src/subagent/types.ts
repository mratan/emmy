// Phase 04.5 Plan 01 — SubAgentSpec + CreateSubAgentToolOpts contracts.
//
// Profile-owned persona schema mirrored from CONTEXT.md §decisions and
// the harness.yaml `subagents.personas.<name>` block (Plan 04.5-02 owns
// the YAML loader; this is the in-memory shape consumed by
// `createSubAgentTool` (./index.ts)).

import type { Context } from "@opentelemetry/api";
import type { AgentSessionServices } from "@mariozechner/pi-coding-agent";
import type { ConcurrencyGovernor } from "./governor";

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
	/**
	 * Plan 04.5-04 — getter for parent's input token count, evaluated per-dispatch.
	 * When the returned value exceeds the governor's `longContextSerializeThresholdTokens`,
	 * concurrency is reduced to 1 (`agent.dispatch.serialized` event fires).
	 */
	parentInputTokens?: () => number;
	/**
	 * Plan 04.5-04 — concurrency governor instance. When undefined, the dispatcher
	 * lazily creates one with LOCKED defaults: maxConcurrent=2,
	 * longContextSerializeThresholdTokens=40000, rejectOverCap=true (I3).
	 */
	governor?: ConcurrencyGovernor;
	/**
	 * Plan 04.5-06 — parent's pi session directory. When provided alongside
	 * `parentSessionId`, the dispatcher appends a sidecar JSONL entry per
	 * dispatch at `<parentSessionDir>/session-<parentSessionId>.subagents.jsonl`.
	 * NO-OP when undefined (testing contexts).
	 */
	parentSessionDir?: string;
	/**
	 * Phase 04.5-followup — explicit parent OTel context provider for the W1
	 * 4-level trace tree (`parent_session → agent.tool.Agent → subagent.<persona> → child`).
	 *
	 * Background: V8 surfaced that AsyncLocalStorage propagation breaks across
	 * pi-coding-agent's HTTP provider boundary in `session.prompt()`. The H5
	 * spike confirmed ALS through pi's IN-PROCESS tool dispatch; H9 explicitly
	 * did not exercise the real-HTTP provider chain (SPIKE-RESULTS.md
	 * § "What was not tested in H9"). When ALS-via-HTTP is unreliable, the
	 * caller can thread the parent context explicitly: capture
	 * `context.active()` from inside the `parent_session` active-span callback,
	 * stash it in a mutable session-scoped holder, and pass a getter as this
	 * field. `withAgentToolSpan` will use this context as the explicit parent
	 * for `agent.tool.Agent` instead of relying on `context.active()`.
	 *
	 * When undefined (faux/test contexts where ALS works fine), the legacy
	 * `context.active()`-based parent resolution is used — keeps unit tests
	 * green without modification.
	 */
	parentContextProvider?: () => Context | undefined;
}
