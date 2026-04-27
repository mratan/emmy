// Phase 04.5 Plan 05 Task 2 — SubagentBlock pure-text renderer regression suite.
//
// NOTE on deviation from PLAN.md: the plan called for a TSX Ink component +
// ink-testing-library. Since @emmy/ux has zero React/Ink footprint, the
// implementation is a pure TypeScript renderer (subagent-block.ts) returning
// SubagentLine[]; tests assert on that line data directly. The wiring/JSX
// concern is captured as a TODO marker in subagent-block.ts and deferred to
// Plan 04.5-07.

import { describe, expect, test } from "bun:test";
import {
	renderSubagentBlock,
	renderSubagentBlockText,
	SUBAGENT_GLYPHS,
} from "../../src/components/subagent-block";
import type { ChildEventSnapshot } from "../../src/components/subagent-event-bridge";

const RUNNING_SNAPSHOT: ChildEventSnapshot = {
	persona: "research",
	promptPreview: "find usages",
	turns: [
		{
			toolName: "grep",
			argsPreview: "{\"pattern\":\"customTools\"}",
			resultPreview: "",
			status: "running",
		},
	],
	done: false,
};

const DONE_SNAPSHOT: ChildEventSnapshot = {
	persona: "research",
	promptPreview: "find usages",
	turns: [
		{
			toolName: "grep",
			argsPreview: "{\"pattern\":\"customTools\"}",
			resultPreview: "src/foo.ts:42 customTools = [...]",
			status: "ok",
		},
	],
	done: true,
	finalText: "Found 3 usages in src/foo.ts at lines 42, 88, 120.",
};

describe("renderSubagentBlock — pure-text renderer", () => {
	test("Test 1 (COLLAPSED DEFAULT) — only header line; turn details omitted", () => {
		const lines = renderSubagentBlock(RUNNING_SNAPSHOT);
		expect(lines.length).toBe(1);
		expect(lines[0].text).toContain(SUBAGENT_GLYPHS.collapsed);
		expect(lines[0].text).toContain("Agent: research");
		expect(lines[0].text).toContain('"find usages"');
		// Turn details NOT in collapsed render.
		expect(lines.some((l) => l.text.includes("grep"))).toBe(false);
	});

	test("Test 2 (EXPANDED) — header uses ▼ + body shows each turn", () => {
		const lines = renderSubagentBlock(RUNNING_SNAPSHOT, { collapsed: false });
		expect(lines.length).toBeGreaterThan(1);
		expect(lines[0].text).toContain(SUBAGENT_GLYPHS.expanded);
		expect(lines.some((l) => l.text.includes("grep"))).toBe(true);
	});

	test("Test 3 (DONE STATE) — header uses ■ glyph", () => {
		const lines = renderSubagentBlock(DONE_SNAPSHOT, { collapsed: false });
		expect(lines[0].text).toContain(SUBAGENT_GLYPHS.done);
		// final text line included
		expect(lines.some((l) => l.text.startsWith("final:"))).toBe(true);
	});

	test("Test 4 (RUNNING INDICATOR) — running turn carries cyan color hint + … glyph", () => {
		const lines = renderSubagentBlock(RUNNING_SNAPSHOT, { collapsed: false });
		const turnLine = lines.find((l) => l.text.includes("grep"));
		expect(turnLine).toBeDefined();
		expect(turnLine!.color).toBe("cyan");
		expect(turnLine!.text).toContain(SUBAGENT_GLYPHS.statusRunning);
	});

	test("Test 5 (ERROR INDICATOR) — error turn carries red color hint + ✗ glyph", () => {
		const errorSnap: ChildEventSnapshot = {
			...RUNNING_SNAPSHOT,
			turns: [
				{
					toolName: "read",
					argsPreview: "{\"path\":\"/missing\"}",
					resultPreview: "ENOENT",
					status: "error",
				},
			],
		};
		const lines = renderSubagentBlock(errorSnap, { collapsed: false });
		const turnLine = lines.find((l) => l.text.includes("read"));
		expect(turnLine!.color).toBe("red");
		expect(turnLine!.text).toContain(SUBAGENT_GLYPHS.statusError);
	});

	test("Test 6 (TRUNCATION) — argsPreview ending with the LOCKED ellipsis renders intact", () => {
		const truncated = "x".repeat(79) + "…";
		const snap: ChildEventSnapshot = {
			persona: "research",
			promptPreview: "p",
			turns: [
				{
					toolName: "grep",
					argsPreview: truncated,
					resultPreview: "",
					status: "running",
				},
			],
			done: false,
		};
		const lines = renderSubagentBlock(snap, { collapsed: false });
		const turnLine = lines.find((l) => l.text.includes("grep"));
		// Renderer MUST not double-truncate (no extra ellipsis added).
		expect(turnLine!.text).toContain(truncated);
	});

	test("Test 7 — renderSubagentBlockText joins with newlines and applies indent", () => {
		const out = renderSubagentBlockText(DONE_SNAPSHOT, { collapsed: false });
		const linesArr = out.split("\n");
		// Header has indent 0; body has indent 1 (2-space prefix).
		expect(linesArr[0].startsWith(SUBAGENT_GLYPHS.done)).toBe(true);
		expect(linesArr.slice(1).every((l) => l.startsWith("  "))).toBe(true);
	});
});
