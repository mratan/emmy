// packages/emmy-tools/src/tool-definition-adapter.ts
//
// Plan 03-01 Task 2 (GREEN) — adapter that converts emmy's existing
// PiToolSpec shape (Phase 2's narrow {name,description,parameters,invoke}
// pi.registerTool payload) to a ToolDefinition-compatible object suitable
// for pi 0.68.0's `createAgentSessionFromServices({ customTools: [...] })`.
//
// Design:
//   - pi's ToolDefinition<TParams extends TSchema> uses TypeBox as the
//     parameter schema type. We keep Emmy's tools describing themselves
//     with plain JSON-Schema (Phase 2 PiToolSpec.parameters: Record<string,
//     unknown>) because pi's tool-definition-wrapper accepts any TypeBox
//     schema — JSON-Schema objects with {type:"object", properties, required}
//     satisfy TypeBox's structural validation well enough for dispatch.
//   - The `execute` method pi calls receives (toolCallId, params, signal,
//     onUpdate, ctx). We forward to the PiToolSpec.invoke(args) closure
//     and wrap the result in pi's AgentToolResult { content, details }.
//
// Why a local type alias (ToolDefinitionLike) instead of importing pi's
// ToolDefinition? Two reasons:
//   1. @emmy/tools must not take a direct type-only dependency on
//      pi-coding-agent — the surface lives at @emmy/ux / @emmy/provider
//      and keeping tools framework-agnostic preserves reusability (eval
//      corpus imports @emmy/tools directly).
//   2. pi's ToolDefinition generic constraint (TSchema) pulls in TypeBox
//      type-level infrastructure. A structural alias avoids the heavy
//      generics while still satisfying pi's runtime checks.

export interface AgentToolResultLike<T = unknown> {
	content: Array<{ type: "text"; text: string } | { type: "image"; [k: string]: unknown }>;
	details: T;
}

export interface ToolDefinitionLike {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: ((partial: AgentToolResultLike) => void) | undefined,
		ctx: unknown,
	): Promise<AgentToolResultLike>;
}

export interface PiToolSpecLike {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	invoke: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Convert a Phase-2 PiToolSpec to a pi 0.68 ToolDefinition-shaped object.
 * The returned object can be used directly in
 * createAgentSessionFromServices({ customTools: [...] }).
 *
 * Label defaults to a Title-cased version of the tool name; override
 * via the second parameter if a specific display label is needed.
 */
export function toolSpecToDefinition(
	spec: PiToolSpecLike,
	opts: { label?: string } = {},
): ToolDefinitionLike {
	const label = opts.label ?? titleCaseFromName(spec.name);
	return {
		name: spec.name,
		label,
		description: spec.description,
		parameters: spec.parameters,
		async execute(
			_toolCallId,
			params,
			_signal,
			_onUpdate,
			_ctx,
		): Promise<AgentToolResultLike> {
			const result = await spec.invoke(params);
			// Normalize: pi expects `content` to be an array of {type,...}
			// entries. We stringify structured results as a single text block
			// so LLMs receive a consistent contract regardless of tool.
			const text = typeof result === "string" ? result : JSON.stringify(result);
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
	};
}

function titleCaseFromName(name: string): string {
	// "web_fetch" -> "Web Fetch"; single words capitalized.
	return name
		.split(/[_\s]+/)
		.filter(Boolean)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ");
}
