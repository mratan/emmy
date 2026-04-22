// eval/phase3/sc2-fixture-builder.test.ts
//
// Phase 3 Plan 03-03 Task 3 — fixture determinism + threshold-crossing tests.

import { describe, expect, test } from "bun:test";

import {
	cumulativeTokens,
	DEFAULT_SC2_OPTS,
	fixtureHash,
	generateSc2Fixture,
} from "./sc2-fixture-builder";

describe("generateSc2Fixture — deterministic 200-turn SC-2 synthesizer", () => {
	test("produces exactly totalTurns entries", () => {
		const fixture = generateSc2Fixture();
		expect(fixture).toHaveLength(DEFAULT_SC2_OPTS.totalTurns);
	});

	test("hash-stable across runs (same seed → same sha256)", () => {
		const a = generateSc2Fixture();
		const b = generateSc2Fixture();
		expect(fixtureHash(a)).toBe(fixtureHash(b));
		// Hash is 64 hex chars.
		expect(fixtureHash(a)).toMatch(/^[0-9a-f]{64}$/);
	});

	test("first entry is structural-core system prompt; second is goal", () => {
		const fixture = generateSc2Fixture();
		expect(fixture[0]!.role).toBe("system");
		expect(String(fixture[0]!.content)).toContain("prompt_sha256:");
		expect(String(fixture[0]!.content)).toContain("# Tools available");
		expect(fixture[1]!.role).toBe("user");
		expect(String(fixture[1]!.content)).toContain("refactor");
	});

	test("error-flagged tool results appear at every 20th index with ~4KB stacktrace bodies", () => {
		const fixture = generateSc2Fixture();
		const errorEntries = fixture.filter((e) => e.role === "tool" && e.isError === true);
		// Turns 20, 40, 60, 80, 100, 120, 140, 160, 180 → 9 entries in a 200-turn
		// session. Turn 140 collides with the pin landmark → user-role entry
		// overrides → 8 error entries.
		expect(errorEntries.length).toBeGreaterThanOrEqual(8);
		for (const e of errorEntries) {
			const len = String(e.content).length;
			expect(len).toBeGreaterThan(3800);
			expect(len).toBeLessThan(5200);
			expect(String(e.content)).toMatch(/Error: synthetic failure/);
		}
	});

	test("file pins @file:… appear at turns 90 and 140 in user-role content", () => {
		const fixture = generateSc2Fixture();
		const pins = fixture.filter((e) => e.role === "user" && /@file:\S+/.test(String(e.content)));
		expect(pins.length).toBeGreaterThanOrEqual(2);
		expect(pins.map((p) => p.uuid)).toContain("pin-90");
		expect(pins.map((p) => p.uuid)).toContain("pin-140");
	});

	test("TODO-state write lands at turn 50 with PLAN.md body", () => {
		const fixture = generateSc2Fixture();
		const todo = fixture.find((e) => e.uuid === "todo-50");
		expect(todo).toBeDefined();
		expect(todo!.role).toBe("tool");
		expect(String(todo!.content)).toContain("PLAN.md");
	});

	test("cumulative tokens cross 0.75 × 114688 = 86016 by turn ~130", () => {
		const fixture = generateSc2Fixture();
		const cum = cumulativeTokens(fixture);
		const threshold = 0.75 * 114688; // 86016
		const crossing = cum.findIndex((t) => t >= threshold);
		expect(crossing).toBeGreaterThan(100);
		expect(crossing).toBeLessThan(180);
	});

	test("every entry has uuid, role, content parseable from JSON.stringify", () => {
		const fixture = generateSc2Fixture();
		for (const e of fixture) {
			const round = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
			expect(typeof round.uuid).toBe("string");
			expect(typeof round.role).toBe("string");
			expect(typeof round.content).toBe("string");
		}
	});
});
