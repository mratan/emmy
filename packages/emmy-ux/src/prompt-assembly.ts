// packages/emmy-ux/src/prompt-assembly.ts
//
// 3-layer prompt assembly for Phase 2's session start. Layer order is LOCKED
// (CONTEXT-04): system.md → AGENTS.md → tool_defs → user. Reordering is a
// semantic regression — the SHA-256 of the assembled text is the stable
// identifier used by HARNESS-06 / SC-5 regression tests.
//
// Token approximation: Math.ceil(layer_text.length / 4). This is a
// deliberately cheap heuristic — the prompt budget accounting is for
// observability, not tokenizer-accurate accounting. If we ever need the
// real tokenizer's count, plumb it through the profile's tokenizer config.
//
// Side effects on every call:
//   1. Writes `prompt.assembled sha256=<64-hex>\n` to process.stderr (HARNESS-06
//      log line). This gives daily-driver users a visible audit trail.
//   2. emitEvent({event: "prompt.assembled", sha256, layers, ts}) via the
//      @emmy/telemetry stub so Phase 3's observability bus captures the event
//      structure without retrofitting the call-graph.

import { createHash } from "node:crypto";

import { emitEvent } from "@emmy/telemetry";

import type { AssembledPrompt, AssembledPromptLayer } from "./types";

export function assemblePrompt(opts: {
	profileSystemMd: string;
	agentsMd: string | null;
	agentsMdPath: string | null;
	toolDefsText: string;
	userPrompt?: string;
}): AssembledPrompt {
	const systemText = opts.profileSystemMd;
	const agentsText = opts.agentsMd ?? "";
	const toolDefsText = opts.toolDefsText;
	const userText = opts.userPrompt ?? "";

	const layers: AssembledPromptLayer[] = [
		{
			name: "system.md",
			tokens_approx: Math.ceil(systemText.length / 4),
			present: systemText.length > 0,
		},
		{
			name: "AGENTS.md",
			tokens_approx: opts.agentsMd === null ? 0 : Math.ceil(agentsText.length / 4),
			present: opts.agentsMd !== null,
		},
		{
			name: "tool_defs",
			tokens_approx: Math.ceil(toolDefsText.length / 4),
			present: toolDefsText.length > 0,
		},
		{
			name: "user",
			tokens_approx: Math.ceil(userText.length / 4),
			present: userText.length > 0,
		},
	];

	// CONTEXT-04 locked order: system.md → AGENTS.md → tool_defs → user.
	const parts: string[] = [systemText];
	if (opts.agentsMd !== null) parts.push(agentsText);
	parts.push(toolDefsText);
	if (userText.length > 0) parts.push(userText);
	const text = parts.join("\n\n");

	const sha256 = createHash("sha256").update(text).digest("hex");

	// Stderr log (HARNESS-06).
	process.stderr.write(`prompt.assembled sha256=${sha256}\n`);

	// emitEvent for Phase 3 observability bus.
	emitEvent({
		event: "prompt.assembled",
		ts: new Date().toISOString(),
		sha256,
		layers,
		...(opts.agentsMdPath !== null ? { agents_md_path: opts.agentsMdPath } : {}),
	});

	const result: AssembledPrompt = { text, sha256, layers };
	if (opts.agentsMdPath !== null && opts.agentsMd !== null) {
		result.agents_md_path = opts.agentsMdPath;
	}
	return result;
}
