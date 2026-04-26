// Phase 04.5 Plan 01 — SubAgent dispatcher.
//
// Pattern A vs B branch — LOCKED in CONTEXT.md §decisions (REVISED 2026-04-26).
//
// Pattern A (lean): child reuses parent's services by reference. ~5 ms instantiation per H8.
//   Used for utility sub-agents (small fetches, one-off greps).
//
// Pattern B (persona): child gets per-persona services with cwd=parentCwd, NOT
//   personaDir. The persona's AGENTS.md is injected via
//   resourceLoaderOptions.agentsFilesOverride so pi's tool default cwd
//   (read/grep/find/ls) operates on the USER'S project. This decouples the
//   persona's prompt source from the tool cwd — the bug we caught in checker B2.
//
// Both patterns: child is dispose()'d in finally. setAutoCompactionEnabled(false)
// is called BEFORE prompt() so children don't compact mid-run (H7 confirmed).
//
// Tool allowlist: pass-through to pi's `tools` option. H2 + spike confirm
// pi rejects disallowed tools AT REGISTRATION TIME (the LOCKED V3 contract).

import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
	type AgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import type { CreateSubAgentToolOpts, SubAgentSpec } from "./types";
import { runOneTurnReturningText } from "./run-one-turn";
import { withSubagentSpan } from "./otel";

// Test-only seam (Plan 04.5-01 dispose suite): when set, replaces the
// real createAgentSessionFromServices call. Production code paths NEVER set
// this — it is exclusively for installing dispose-counting wrappers in
// `tests/subagent/dispose.test.ts`. Restore by passing `undefined`.
type SessionFactory = typeof createAgentSessionFromServices;
let __sessionFactoryOverride: SessionFactory | undefined;

/** @internal — test-only seam, see comment above. */
export function __setSessionFactoryForTests(factory: SessionFactory | undefined): void {
	__sessionFactoryOverride = factory;
}

export interface DispatchSubAgentParams {
	description: string;
	prompt: string;
	model?: string;
	/** Optional abort signal — when aborted, child.abort() is called and dispose() still fires once. (B3 fix) */
	signal?: AbortSignal;
}

export interface DispatchSubAgentResult {
	output: string;
	details: { persona: string; ok: boolean; pattern: "lean" | "persona" };
}

/**
 * Dispatch a single sub-agent turn and return the child's final assistant text.
 *
 * Lifecycle (LOCKED):
 *   1. Resolve services per persona.pattern.
 *   2. Build child via createAgentSessionFromServices with `tools: persona.toolAllowlist`.
 *   3. child.setAutoCompactionEnabled(false) — H7-validated isolation.
 *   4. (Optional) wire abort signal forwarding to child.abort().
 *   5. runOneTurnReturningText(child, prompt) — captures final assistant text.
 *   6. dispose() in finally on every exit path (success, throw, abort).
 */
export async function dispatchSubAgent(
	opts: CreateSubAgentToolOpts,
	persona: SubAgentSpec,
	params: DispatchSubAgentParams,
): Promise<DispatchSubAgentResult> {
	// Plan 04.5-03 — wrap in subagent span (Level 3 of the LOCKED 4-level trace tree).
	return await withSubagentSpan(
		{ name: persona.name, pattern: persona.pattern },
		opts.parentSessionId,
		async (span) => {
			const result = await dispatchSubAgentInner(opts, persona, params);
			span.setAttribute("emmy.subagent.final_text_chars", result.output.length);
			return result;
		},
	);
}

async function dispatchSubAgentInner(
	opts: CreateSubAgentToolOpts,
	persona: SubAgentSpec,
	params: DispatchSubAgentParams,
): Promise<DispatchSubAgentResult> {
	let services: AgentSessionServices;
	if (persona.pattern === "persona") {
		if (!persona.personaDir) {
			throw new Error(`[Agent] persona "${persona.name}" pattern="persona" requires personaDir`);
		}
		const personaAgentsPath = pathResolve(persona.personaDir, "AGENTS.md");
		const personaAgentsContent =
			persona.agentsContent ?? readFileSync(personaAgentsPath, "utf8");

		// Pattern B (LOCKED — CONTEXT.md §decisions revised 2026-04-26):
		//   cwd: opts.parentCwd  ← child's tools operate on user's project (B2 fix)
		//   agentsFilesOverride: append persona AGENTS.md to base set (parent's CLAUDE.md/AGENTS.md preserved)
		services = await createAgentSessionServices({
			cwd: opts.parentCwd, // child operates on user's project
			authStorage: opts.parentServices.authStorage, // SHARED — auth is profile-level
			resourceLoaderOptions: {
				agentsFilesOverride: (base: { agentsFiles: Array<{ path: string; content: string }> }) => ({
					agentsFiles: [
						...base.agentsFiles,
						{ path: personaAgentsPath, content: personaAgentsContent },
					],
				}),
			} as any,
		});
	} else {
		services = opts.parentServices; // SHARED — Pattern A
	}

	const sessionManager = SessionManager.inMemory(opts.parentCwd);

	const modelId = params.model ?? persona.modelOverride ?? "default";
	if (params.model && persona.modelOverride && params.model !== persona.modelOverride) {
		console.warn(
			`[Agent] model override "${params.model}" requested but v1 is single-model; using parent's model`,
		);
	}
	const model = opts.modelResolver(modelId);

	const factory = __sessionFactoryOverride ?? createAgentSessionFromServices;
	const { session: child } = await factory({
		services,
		sessionManager,
		model: model as any,
		tools: persona.toolAllowlist, // V3: pi enforces at registration time
	} as any);

	child.setAutoCompactionEnabled(false);

	// Wire abort forwarding (B3 fix). When the parent's abort signal fires,
	// call child.abort() so the child's prompt() rejection unblocks. dispose()
	// still fires in finally below — exactly once.
	const onAbort = () => {
		try {
			void child.abort?.();
		} catch {
			// abort() is best-effort — even if the SDK rejects, dispose() in finally cleans up.
		}
	};
	if (params.signal) {
		if (params.signal.aborted) onAbort();
		else params.signal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		const finalText = await runOneTurnReturningText(child, params.prompt);
		return {
			output: finalText,
			details: { persona: persona.name, ok: true, pattern: persona.pattern },
		};
	} finally {
		if (params.signal) params.signal.removeEventListener("abort", onAbort);
		child.dispose();
	}
}
