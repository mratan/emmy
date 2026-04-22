// eval/phase3/sc2-assertions.ts
//
// Phase 3 Plan 03-03 Task 3 — pure D-14 preservation-invariant assertions
// exercised by the SC-2 runner after a stub-mode compaction round-trip.
//
// Each assertion returns `{passed, detail}` so the runner can accumulate
// a verdict object and produce a structured `runs/phase3-sc2/report.json`.

import type { SessionEntry } from "@emmy/context";

export interface InvariantResult {
	passed: boolean;
	detail: string;
}

/**
 * D-14 item 3a — the first user-role entry ("the goal") must appear byte-
 * identical in the post-compaction preserved set.
 */
export function assertGoalPreserved(
	pre: SessionEntry[],
	preservedUuids: Set<string>,
): InvariantResult {
	const goal = pre.find((e) => e.role === "user");
	if (!goal) return { passed: false, detail: "no user-role entry in pre" };
	if (!preservedUuids.has(goal.uuid)) {
		return { passed: false, detail: `goal entry ${goal.uuid} NOT preserved` };
	}
	return { passed: true, detail: `goal ${goal.uuid} preserved verbatim` };
}

/**
 * D-14 item 3b — the last N entries must appear byte-identical in the
 * preserved set.
 */
export function assertLastNVerbatim(
	pre: SessionEntry[],
	preservedUuids: Set<string>,
	n: number,
): InvariantResult {
	const tail = pre.slice(-n);
	const missing: string[] = [];
	for (const entry of tail) {
		if (!preservedUuids.has(entry.uuid)) missing.push(entry.uuid);
	}
	if (missing.length > 0) {
		return {
			passed: false,
			detail: `last ${n} turns not all preserved; missing: ${missing.join(", ")}`,
		};
	}
	return { passed: true, detail: `last ${n} turns preserved verbatim` };
}

/**
 * D-14 item 2 — every tool_result with isError === true in pre must appear
 * in the preserved set. Pitfall #15 guard.
 */
export function assertErrorResultsVerbatim(
	pre: SessionEntry[],
	preservedUuids: Set<string>,
): InvariantResult {
	const errors = pre.filter((e) => e.role === "tool" && e.isError === true);
	const missing: string[] = [];
	for (const e of errors) {
		if (!preservedUuids.has(e.uuid)) missing.push(e.uuid);
	}
	if (missing.length > 0) {
		return {
			passed: false,
			detail: `${missing.length}/${errors.length} error-flagged tool results not preserved; missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
		};
	}
	return {
		passed: true,
		detail: `all ${errors.length} error-flagged tool results preserved verbatim`,
	};
}

/**
 * D-14 item 4a — every entry whose content contains an @file pin must appear
 * in the preserved set. CONTEXT-03.
 */
export function assertFilePinsVerbatim(
	pre: SessionEntry[],
	preservedUuids: Set<string>,
): InvariantResult {
	const FILE_PIN_RE = /@file:\S+/;
	const pins = pre.filter((e) => FILE_PIN_RE.test(String(e.content ?? "")));
	const missing: string[] = [];
	for (const p of pins) {
		if (!preservedUuids.has(p.uuid)) missing.push(p.uuid);
	}
	if (missing.length > 0) {
		return {
			passed: false,
			detail: `${missing.length}/${pins.length} file pins not preserved`,
		};
	}
	return { passed: true, detail: `all ${pins.length} file pins preserved verbatim` };
}

/**
 * Telemetry-shape invariant — asserts the post-compaction event stream
 * contains a session.compaction.complete event with a positive turns_elided
 * value (at least `minElided`) and at least one turns_preserved.
 */
export function assertCompactionComplete(
	events: Array<Record<string, unknown>>,
	minElided: number,
): InvariantResult {
	const completes = events.filter((e) => e.event === "session.compaction.complete");
	if (completes.length === 0) {
		return { passed: false, detail: "no session.compaction.complete event in the stream" };
	}
	const c = completes[0]!;
	const elided = typeof c.turns_elided === "number" ? c.turns_elided : 0;
	const preserved = typeof c.turns_preserved === "number" ? c.turns_preserved : 0;
	if (elided < minElided) {
		return {
			passed: false,
			detail: `turns_elided=${elided} < minExpected=${minElided}`,
		};
	}
	if (preserved < 1) {
		return {
			passed: false,
			detail: `turns_preserved=${preserved} < 1 — D-14 violation`,
		};
	}
	return {
		passed: true,
		detail: `compaction.complete: elided=${elided}, preserved=${preserved}`,
	};
}
