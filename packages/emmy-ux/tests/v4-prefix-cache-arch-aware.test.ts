// Plan 04.4-06 Task 3 — V4 architecture-aware prefix-cache gate
// (per CLAUDE.md Pitfall #22 / COMPACTION-DESIGN.md §8 V4).
//
// vLLM's automatic prefix caching is silently 0% hit-rate on Mamba-hybrid
// Qwen 3.6 35B-A3B and Gemma 4 26B-A4B even with enable_prefix_caching: True
// (vLLM marks the layer "experimental" for Mamba). V4 therefore gates per-
// profile family:
//   - attention-only (dense): hard ≥ 80% post-compaction hit rate
//   - mamba-hybrid (MoE A3B/A4B): "measure and acknowledge", no false-fail
//
// This file ships the classifier + gate-logic pure functions. The actual
// /metrics fetch lives in the V8 smoke-test forcing-function (Phase 04.4
// closeout / plan 04.4-09).

import { describe, expect, test } from "bun:test";

type ArchClass = "attention-only" | "mamba-hybrid";

export function classifyArch(profileId: string): ArchClass {
	// CLAUDE.md "Phase 4.1 dense siblings" — both Qwen 3.6 35B-A3B and
	// Gemma 4 26B-A4B are MoE Mamba-hybrid (the A3B/A4B suffixes denote the
	// small active params + Mamba layers per Pitfall #22 spike 2026-04-26).
	if (profileId.startsWith("qwen3.6-35b-a3b")) return "mamba-hybrid";
	if (profileId.startsWith("gemma-4-26b-a4b-it")) return "mamba-hybrid";
	// Dense siblings are pure-attention.
	if (profileId.startsWith("qwen3.6-27b")) return "attention-only";
	if (profileId.startsWith("gemma-4-31b-it")) return "attention-only";
	// Unknown — default to attention-only (more conservative; surfaces issues).
	return "attention-only";
}

export function v4Pass(args: {
	profileId: string;
	hitsBefore: number;
	queriesBefore: number;
	hitsAfter: number;
	queriesAfter: number;
}): { pass: boolean; reason: string; arch: ArchClass } {
	const arch = classifyArch(args.profileId);
	const queryDelta = args.queriesAfter - args.queriesBefore;
	const hitDelta = args.hitsAfter - args.hitsBefore;
	if (queryDelta <= 0) {
		return { pass: false, reason: "no queries after compaction", arch };
	}
	const hitRate = hitDelta / queryDelta;
	if (arch === "attention-only") {
		return {
			pass: hitRate >= 0.8,
			reason: `attention-only profile: hit_rate=${hitRate.toFixed(3)} (gate >= 0.80)`,
			arch,
		};
	}
	// Mamba-hybrid: measure-and-acknowledge — pass regardless, just record.
	return {
		pass: true,
		reason: `mamba-hybrid profile: hit_rate=${hitRate.toFixed(3)} (measure-and-acknowledge per Pitfall #22)`,
		arch,
	};
}

describe("V4 — architecture-aware prefix-cache gate", () => {
	test("classifies the four shipped profiles correctly", () => {
		expect(classifyArch("qwen3.6-35b-a3b")).toBe("mamba-hybrid");
		expect(classifyArch("qwen3.6-27b")).toBe("attention-only");
		expect(classifyArch("gemma-4-26b-a4b-it")).toBe("mamba-hybrid");
		expect(classifyArch("gemma-4-31b-it")).toBe("attention-only");
	});

	test("attention-only profile fails gate when hit_rate < 0.80", () => {
		const r = v4Pass({
			profileId: "qwen3.6-27b",
			hitsBefore: 0,
			queriesBefore: 0,
			hitsAfter: 5,
			queriesAfter: 100,
		});
		expect(r.pass).toBe(false);
		expect(r.arch).toBe("attention-only");
	});

	test("attention-only profile passes gate when hit_rate >= 0.80", () => {
		const r = v4Pass({
			profileId: "qwen3.6-27b",
			hitsBefore: 0,
			queriesBefore: 0,
			hitsAfter: 85,
			queriesAfter: 100,
		});
		expect(r.pass).toBe(true);
	});

	test("mamba-hybrid profile passes regardless of hit_rate (measure-and-acknowledge)", () => {
		const r0 = v4Pass({
			profileId: "qwen3.6-35b-a3b",
			hitsBefore: 0,
			queriesBefore: 0,
			hitsAfter: 0,
			queriesAfter: 100,
		});
		const r80 = v4Pass({
			profileId: "qwen3.6-35b-a3b",
			hitsBefore: 0,
			queriesBefore: 0,
			hitsAfter: 80,
			queriesAfter: 100,
		});
		expect(r0.pass).toBe(true);
		expect(r80.pass).toBe(true);
		expect(r0.reason).toContain("measure-and-acknowledge");
	});

	test("zero queries after compaction always fails (sanity)", () => {
		const r = v4Pass({
			profileId: "qwen3.6-27b",
			hitsBefore: 5,
			queriesBefore: 100,
			hitsAfter: 5,
			queriesAfter: 100,
		});
		expect(r.pass).toBe(false);
		expect(r.reason).toContain("no queries after compaction");
	});

	test("Gemma 4 26B MoE classifies as mamba-hybrid (A4B suffix)", () => {
		const r = v4Pass({
			profileId: "gemma-4-26b-a4b-it",
			hitsBefore: 0,
			queriesBefore: 0,
			hitsAfter: 0,
			queriesAfter: 50,
		});
		expect(r.arch).toBe("mamba-hybrid");
		expect(r.pass).toBe(true);
	});

	test("Gemma 4 31B dense classifies as attention-only", () => {
		const r = v4Pass({
			profileId: "gemma-4-31b-it",
			hitsBefore: 0,
			queriesBefore: 0,
			hitsAfter: 90,
			queriesAfter: 100,
		});
		expect(r.arch).toBe("attention-only");
		expect(r.pass).toBe(true);
	});
});
