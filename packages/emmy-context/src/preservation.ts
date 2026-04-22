// packages/emmy-context/src/preservation.ts
//
// Phase 3 Plan 03-03 — D-14 preservation classifier.
//
// Shape analog: `packages/emmy-tools/src/mcp-poison-check.ts:assertNoPoison`
// — a per-entry rule + accumulator pure classifier. The difference is that
// `assertNoPoison` throws on the first violator; `markPreserved` accumulates
// a Set<uuid> of entries that MUST survive a compaction round-trip.
//
// D-14 (four non-negotiable preservation guarantees):
//   1. Structural core — system prompts + tool defs + assembled-prompt hash
//      audit line. Detected heuristically because pi's SessionEntry does not
//      expose a "structural" bit; we match by role === "system" + known
//      markers in content ("# Tools available", "prompt_sha256:").
//   2. Error-payload verbatim — tool_result with isError === true OR content
//      that matches a stacktrace/error-signature heuristic. Pitfall #15
//      (Phase 3 RESEARCH): bottom-of-stacktrace is usually where the actual
//      error lives, so truncating/summarizing the tool_result loses the root
//      cause.
//   3. Active goal + recent N turns — first user message in the session
//      (the "goal") + the last N turns verbatim. The plan's <behavior>
//      spec assumes turn-indexed input — we compute indices from the
//      entries array ordering directly.
//   4. File pins + TODO state — @file pins (CONTEXT-03) and edits/writes
//      targeting TODO.md / PLAN.md (TOOLS-09).
//
// Pure function contract:
//   - Returns a NEW Set<string> of entry uuids.
//   - Never mutates the input array.
//   - Order-preserving: `entries[firstUserIndex]` and `entries.slice(-N)`
//     depend on caller ordering.
//   - Deterministic: same input → same output, regardless of how many times
//     it's called.

import type { PreservationOpts, SessionEntry } from "./types";

// Structural-core markers. Conservative — we only preserve entries whose
// content contains one of these substrings (OR whose role is "system" and
// is the first such entry in the list). Anything ambiguous is left to the
// other rules.
const STRUCTURAL_MARKERS: ReadonlyArray<string> = [
	"# Tools available",
	"prompt_sha256:",
	"AGENTS.md",
];

// Stacktrace / error-signature heuristic. The CASE-SENSITIVE regex matches
// typical stderr shapes across common toolchains:
//   - "Error: " (JS / Python with explicit raise)
//   - "Traceback" (Python)
//   - "Exception" (Java / Python / .NET)
//   - "panic:" (Go / Rust)
//   - "+++ stderr" (diff-style captured stderr in tool_result)
//   - " at <fn> " (JS stack frame)
// Case-INSENSITIVE; per-line matching is not required because tool_result
// bodies are typically whole stderr dumps.
const ERROR_SIGNATURE_RE = /traceback|exception|panic:|Error:\s|\+\+\+ stderr/i;

// File-pin regex — CONTEXT-03 shape. "@file:<path>" where <path> is any
// non-whitespace token. Deliberately permissive on the path side so agent
// output that embeds pins in sentence fragments still gets preserved.
const FILE_PIN_RE = /@file:\S+/;

// TODO-state detection. We look for either:
//   (a) tool_result content referencing "PLAN.md" or "TODO.md" as the
//       target path of a write/edit operation ("wrote PLAN.md:" /
//       "edited TODO.md:" style content), or
//   (b) assistant content that explicitly declares a TODO-file pin.
// The tool-name field (if present) is also consulted — if toolName is
// "edit" or "write" AND content mentions a plan file, the entry is
// preserved.
const TODO_FILE_RE = /\b(?:TODO|PLAN)\.md\b/;

/**
 * Classify `entries` per D-14 and return the Set of uuids that MUST be
 * preserved verbatim across a compaction round-trip.
 *
 * @param entries  ordered session entries (oldest first)
 * @param opts     D-14 preservation knobs
 * @returns        Set<uuid> of preserved entries
 */
export function markPreserved(
	entries: ReadonlyArray<SessionEntry>,
	opts: PreservationOpts,
): Set<string> {
	const preserved = new Set<string>();

	// --- D-14 item 3a: activeGoal ---
	// First role === "user" entry in the list.
	if (opts.activeGoal) {
		const firstUser = entries.find((e) => e.role === "user");
		if (firstUser) preserved.add(firstUser.uuid);
	}

	// --- D-14 item 3b: recentTurns ---
	// Last N entries by index. `recentTurns: 0` preserves nothing via this
	// rule; negative values are clamped to 0 defensively.
	if (opts.recentTurns > 0) {
		const n = Math.min(opts.recentTurns, entries.length);
		for (let i = entries.length - n; i < entries.length; i++) {
			const e = entries[i];
			if (e) preserved.add(e.uuid);
		}
	}

	// Per-entry rules (structural / error / pins / todos).
	for (const entry of entries) {
		// D-14 item 1: structural core.
		if (opts.structuralCore && isStructuralCore(entry)) {
			preserved.add(entry.uuid);
			continue;
		}

		// D-14 item 2: error-payload verbatim.
		if (opts.errorPayloadsVerbatim && isErrorPayload(entry)) {
			preserved.add(entry.uuid);
			continue;
		}

		// D-14 item 4a: file pins.
		if (opts.filePins && hasFilePin(entry)) {
			preserved.add(entry.uuid);
			continue;
		}

		// D-14 item 4b: TODO state.
		if (opts.todoState && isTodoStateEntry(entry)) {
			preserved.add(entry.uuid);
			continue;
		}
	}

	return preserved;
}

/**
 * Structural-core predicate. Matches:
 *   - role === "system" entries (including the assembled 3-layer prompt
 *     emitted by pi-emmy-extension's before_provider_request hook).
 *   - Entries whose content contains a STRUCTURAL_MARKERS substring —
 *     typically the tool-defs block or the `prompt_sha256:` audit line.
 */
function isStructuralCore(entry: SessionEntry): boolean {
	if (entry.role === "system") return true;
	const content = toContentString(entry.content);
	for (const marker of STRUCTURAL_MARKERS) {
		if (content.includes(marker)) return true;
	}
	return false;
}

/**
 * Error-payload predicate. Pitfall #15 + D-14 item 2.
 *
 * Accepts either:
 *   - Explicit `entry.isError === true` on a tool-role entry (pi's native flag).
 *   - tool-role entry whose content body matches ERROR_SIGNATURE_RE (heuristic
 *     for tool servers that don't set isError).
 */
function isErrorPayload(entry: SessionEntry): boolean {
	if (entry.role !== "tool") return false;
	if (entry.isError === true) return true;
	const content = toContentString(entry.content);
	return ERROR_SIGNATURE_RE.test(content);
}

/**
 * File-pin predicate. Matches `@file:<path>` anywhere in the content of any
 * entry role. Intentionally cheap — we preserve any entry with the syntax,
 * even if the path doesn't exist, because the pin itself is the user's
 * expressed intent (CONTEXT-03).
 */
function hasFilePin(entry: SessionEntry): boolean {
	return FILE_PIN_RE.test(toContentString(entry.content));
}

/**
 * TODO-state predicate. Matches tool-role entries whose toolName is "edit"
 * or "write" AND whose content references PLAN.md or TODO.md (path in the
 * rendered output). Also matches any entry explicitly naming those files in
 * content.
 */
function isTodoStateEntry(entry: SessionEntry): boolean {
	const content = toContentString(entry.content);
	if (!TODO_FILE_RE.test(content)) return false;
	// For tool-role entries, additionally require toolName ∈ {edit, write}
	// when the field is present — tightens the rule so random tool_result
	// content that happens to mention TODO.md is not preserved.
	if (entry.role === "tool") {
		if (entry.toolName && entry.toolName !== "edit" && entry.toolName !== "write") {
			return false;
		}
	}
	return true;
}

/**
 * Normalize `content` to a plain string for regex/substring matching. The
 * classifier operates on rendered content — rich content arrays (pi's
 * TextContent / ImageContent union) are flattened to concatenated text
 * before they reach the classifier. This helper tolerates unexpected
 * shapes defensively.
 */
function toContentString(content: unknown): string {
	if (typeof content === "string") return content;
	if (content == null) return "";
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (typeof c === "string") return c;
				if (c && typeof c === "object" && "text" in (c as Record<string, unknown>)) {
					const text = (c as { text?: unknown }).text;
					return typeof text === "string" ? text : "";
				}
				return "";
			})
			.join("\n");
	}
	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}
