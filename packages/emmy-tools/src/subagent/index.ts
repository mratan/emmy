// Phase 04.5 Plan 01 — `Agent` tool factory.
//
// Returns a pi-mono ToolDefinition the parent's model can call. Each call
// dispatches a child session per the persona's spawn pattern (see dispatcher.ts)
// and returns ONLY the child's final assistant text. Intermediate tool calls
// do NOT pollute the parent's transcript (LOCKED — Pitfall #18 anti-mitigation
// would be silent leak; we return text-only).
//
// Tool naming: `Agent` (Claude Code naming convention; renamed from `Task` in
// CC v2.1.63). NEVER rename without updating CONTEXT.md §decisions.
//
// Description (W4 fix): the tool's description string is BUILT DYNAMICALLY at
// factory-call time from each persona's description field, so the parent's
// model sees a per-persona bulleted list and can pick the right subagent_type.

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";
import { dispatchSubAgent } from "./dispatcher";
import { withAgentToolSpan } from "./otel";
import type { CreateSubAgentToolOpts } from "./types";

/**
 * Build the `Agent` tool from the parent's services + persona registry.
 *
 * Returned shape mirrors pi's defineTool() output (ToolDefinition compatible
 * with createAgentSessionFromServices({ customTools: [...] })).
 */
export function createSubAgentTool(opts: CreateSubAgentToolOpts) {
	const personaList = Object.values(opts.personas)
		.map((p) => `- ${p.name}: ${p.description}`)
		.join("\n");
	const toolDescription =
		"Agent — Dispatch a focused task to a sub-agent. Returns text-only summary; intermediate tool calls are not surfaced.\n\n" +
		"Available personas:\n" +
		personaList;

	const personaKeys = Object.keys(opts.personas);
	if (personaKeys.length === 0) {
		throw new Error("[Agent] createSubAgentTool requires at least one persona");
	}

	// Build TypeBox `Type.Union(Type.Literal(...))` from persona keys at factory-call time.
	const subagentTypeSchema =
		personaKeys.length === 1
			? Type.Literal(personaKeys[0]!)
			: Type.Union(personaKeys.map((k) => Type.Literal(k)));

	const parameters = Type.Object({
		subagent_type: subagentTypeSchema,
		description: Type.String({ description: "Short label for the dispatch." }),
		prompt: Type.String({ description: "Task for the sub-agent." }),
		model: Type.Optional(
			Type.String({
				description: "Optional model override (single-model in v1; logs warning if used).",
			}),
		),
	});

	return defineTool({
		name: "Agent",
		label: "Agent",
		description: toolDescription,
		parameters,
		execute: async (
			_toolCallId: string,
			rawParams: any,
			signal: AbortSignal | undefined,
		) => {
			const params = rawParams as {
				subagent_type: string;
				description: string;
				prompt: string;
				model?: string;
			};
			const persona = opts.personas[params.subagent_type];
			if (!persona) {
				return {
					content: [
						{ type: "text" as const, text: `[Agent] unknown subagent_type: ${params.subagent_type}` },
					],
					details: {
						ok: false,
						reason: "unknown-subagent-type",
						subagent_type: params.subagent_type,
					},
				};
			}
			try {
				// Plan 04.5-03 (W1) — wrap dispatcher in agent.tool.Agent span (Level 2 of LOCKED 4-level tree).
				// Phase 04.5-followup — parentContextProvider lets the caller thread an
				// explicit OTel parent context across pi-coding-agent's HTTP boundary
				// (AsyncLocalStorage is unreliable there). When undefined, falls back to
				// context.active() (legacy faux-friendly path).
				const explicitParentCtx = opts.parentContextProvider?.();
				const result = await withAgentToolSpan(
					persona.name,
					opts.parentSessionId,
					explicitParentCtx,
					async () =>
						dispatchSubAgent(opts, persona, {
							description: params.description,
							prompt: params.prompt,
							model: params.model,
							signal,
						}),
				);
				return {
					content: [{ type: "text" as const, text: result.output }],
					details: result.details,
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text" as const,
							text: `[Agent] dispatch failed: ${err?.message ?? String(err)}`,
						},
					],
					details: { ok: false, reason: "dispatch-error", error: err?.message ?? String(err) },
				};
			}
		},
	} as any);
}

/** Doc-only re-export for symmetry with native tools (some tests prefer the const form). */
export { createSubAgentTool as subagentTool };

// Re-export dispatcher for tests that want to drive it without going through the tool wrapper.
export { dispatchSubAgent } from "./dispatcher";

// Plan 04.5-04 — concurrency governor.
export {
	createConcurrencyGovernor,
	type ConcurrencyGovernor,
	type ConcurrencyGovernorConfig,
} from "./governor";
