// Phase 04.5 Plan 05 Task 2 — SubagentBlock pure-text renderer.
//
// TODO(plan 04.5-07): wire SubagentBlock into pi-emmy-extension.ts customRenderer
// hook for tool_call_start("Agent") events, OR wrap renderSubagentBlock() output
// in an Ink Box/Text tree once @emmy/ux gains a React/Ink TSX runtime. Until that
// lands, this component is unreachable from the live TUI and is exercised only
// by unit tests.
//
// Architectural note (deviation from PLAN.md as written): the plan called for
// React + Ink + ink-testing-library. Those deps are NOT currently in @emmy/ux
// (the package has zero React/Ink footprint). Adding them here would introduce
// JSX TypeScript config, TSX test runner, and three runtime deps for code that
// isn't wired into the live TUI yet. Per execute-plan.md Rule 3 (additional
// functionality discovered during execution), we ship this as a pure TypeScript
// renderer returning string lines — same data contract, same default-collapsed
// behavior, same glyph set. Plan 04.5-07's E2E wiring task either:
//   (a) adds the React/Ink deps + wraps these lines in a Box/Text tree, OR
//   (b) emits the lines directly via pi's existing TUI plain-text channel.
// Decision deferred to the wiring step where the pi-emmy-extension hook surface
// is known and the trade-off is evaluable in context.

import type { ChildEventSnapshot, ChildTurnSnapshot } from "./subagent-event-bridge";

export const SUBAGENT_GLYPHS = {
	collapsed: "▶",
	expanded: "▼",
	done: "■",
	statusRunning: "…",
	statusOk: "✓",
	statusError: "✗",
} as const;

const STATUS_GLYPH: Record<ChildTurnSnapshot["status"], string> = {
	running: SUBAGENT_GLYPHS.statusRunning,
	ok: SUBAGENT_GLYPHS.statusOk,
	error: SUBAGENT_GLYPHS.statusError,
};

export interface RenderSubagentBlockOpts {
	/** When true, only the header line is rendered. Default: true (collapsed-by-default — Claude Code parity). */
	collapsed?: boolean;
}

export interface SubagentLine {
	/** Rendered text for this line. */
	text: string;
	/** Indentation depth (0 = header, 1 = body). */
	indent: number;
	/** Optional color hint for the future Ink wrapper (cyan / green / red / dim). */
	color?: "cyan" | "green" | "red" | "dim";
	/** Marks dimmed lines (header trailing prompt, body turn lines). */
	dim?: boolean;
}

/**
 * Pure-data renderer for a sub-agent transcript block. Returns an ordered list
 * of lines with indent + color hints; the Ink wrapper (Plan 04.5-07) consumes
 * these to render with `<Box>` / `<Text>`. Tests can assert on the line data
 * directly without needing a JSX runtime.
 *
 * CHOICE: collapsed-by-default. Rationale — a typical sub-agent dispatch may
 * issue 5-10 internal tool calls; expanded-by-default would dominate the
 * parent's terminal real estate during normal operation. Operators expand on
 * demand. Matches Claude Code's UX. Challenge this when the live TUI shows
 * pain points.
 */
export function renderSubagentBlock(
	snapshot: ChildEventSnapshot,
	opts: RenderSubagentBlockOpts = {},
): SubagentLine[] {
	const collapsed = opts.collapsed ?? true;
	const headerGlyph = snapshot.done
		? SUBAGENT_GLYPHS.done
		: collapsed
			? SUBAGENT_GLYPHS.collapsed
			: SUBAGENT_GLYPHS.expanded;
	const lines: SubagentLine[] = [
		{
			text: `${headerGlyph} Agent: ${snapshot.persona} — "${snapshot.promptPreview}"`,
			indent: 0,
			dim: true,
		},
	];
	if (collapsed) return lines;

	for (const turn of snapshot.turns) {
		const glyph = STATUS_GLYPH[turn.status];
		const tail =
			turn.status === "running"
				? ""
				: ` → ${turn.resultPreview}`;
		const color: SubagentLine["color"] =
			turn.status === "running"
				? "cyan"
				: turn.status === "error"
					? "red"
					: "green";
		lines.push({
			text: `${glyph} ${turn.toolName}(${turn.argsPreview})${tail}`,
			indent: 1,
			color,
			dim: true,
		});
	}
	if (snapshot.done && snapshot.finalText !== undefined) {
		lines.push({
			text: `final: "${snapshot.finalText.slice(0, 200)}"`,
			indent: 1,
			dim: true,
		});
	}
	return lines;
}

/**
 * Convenience: render a snapshot to a single multi-line string suitable for
 * println-style output. The Ink wrapper SHOULD prefer the structured array
 * from renderSubagentBlock() so it can apply per-line color/dim hints.
 */
export function renderSubagentBlockText(
	snapshot: ChildEventSnapshot,
	opts: RenderSubagentBlockOpts = {},
): string {
	return renderSubagentBlock(snapshot, opts)
		.map((l) => "  ".repeat(l.indent) + l.text)
		.join("\n");
}
