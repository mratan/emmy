// packages/emmy-ux/src/prefix-hash.ts
//
// Phase 04.4 plan 06 — append-only-prefix invariant (D-3X) telemetry helper.
//
// The "prefix" of a conversation is the byte-stable preamble that vLLM's
// prefix caching can deduplicate across turns. It comprises:
//   1. The system message (messages[0] if role==="system")
//   2. The tool descriptor catalog (alphabetic by name, JSON-canonical)
//   3. Any leading user messages BEFORE the first assistant turn
//      (project preamble: CLAUDE.md / AGENTS.md content)
//
// The cutoff is the FIRST assistant turn — everything after is "conversation
// body" and is allowed to mutate via compaction.
//
// D-3X invariant (COMPACTION-DESIGN.md §2): the prefix hash MUST be byte-equal
// for every request within a single session-id, regardless of compaction events.

import { createHash } from "node:crypto";

interface AnyMessage {
	role: "system" | "user" | "assistant" | "tool" | string;
	content: unknown;
}

interface AnyToolDescriptor {
	function?: { name?: unknown; description?: unknown; parameters?: unknown };
	type?: unknown;
}

export function extractSystemPrefixBytes(args: {
	messages: AnyMessage[];
	tools?: AnyToolDescriptor[];
}): Uint8Array {
	const parts: string[] = [];

	// Find the first assistant turn — that is the cutoff.
	let cutoffIdx = args.messages.length;
	for (let i = 0; i < args.messages.length; i++) {
		if (args.messages[i]?.role === "assistant") {
			cutoffIdx = i;
			break;
		}
	}

	// Gather all messages BEFORE the cutoff (system + leading user/preamble).
	for (let i = 0; i < cutoffIdx; i++) {
		const m = args.messages[i];
		if (!m) continue;
		const text = stringifyContent(m.content);
		parts.push(`<<msg ${m.role}>>\n${text}\n<<end>>\n`);
	}

	// Tool catalog — sort alphabetic by function.name; canonical JSON.
	if (Array.isArray(args.tools) && args.tools.length > 0) {
		const sorted = [...args.tools].sort((a, b) => {
			const an = String(a?.function?.name ?? "");
			const bn = String(b?.function?.name ?? "");
			return an.localeCompare(bn);
		});
		const canonical = sorted.map((t) => ({
			type: (t as { type?: string }).type ?? "function",
			function: {
				name: t.function?.name,
				description: t.function?.description,
				parameters: t.function?.parameters,
			},
		}));
		parts.push(`<<tools>>\n${JSON.stringify(canonical)}\n<<end>>\n`);
	}

	return new TextEncoder().encode(parts.join(""));
}

function stringifyContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (typeof c === "string") return c;
				if (typeof (c as { text?: unknown })?.text === "string") {
					return (c as { text: string }).text;
				}
				return JSON.stringify(c);
			})
			.join("");
	}
	return JSON.stringify(content);
}

/**
 * Compute the canonical sha256 of the system-prompt prefix.
 * Returns a 64-character lowercase hex string. Deterministic and stable.
 */
export function computePrefixHash(args: {
	messages: AnyMessage[];
	tools?: AnyToolDescriptor[];
}): string {
	const bytes = extractSystemPrefixBytes(args);
	return createHash("sha256").update(bytes).digest("hex");
}
