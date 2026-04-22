// packages/emmy-ux/test/footer.test.ts
//
// Plan 03-04 Task 1 (RED). Imports `formatFooter` + type `FooterValues`
// from ../src/footer (not yet created — RED).
//
// Output format per UX-02 spec + D-25:
//   `GPU N% • KV N% • spec accept - • tok/s N`
// (spec accept is literal `-` hyphen until Phase 6 wires the metric.)

import { describe, expect, test } from "bun:test";

import { formatFooter, type FooterValues } from "../src/footer";

describe("formatFooter", () => {
	test("renders full footer with all fields populated", () => {
		const v: FooterValues = { gpuPct: 87, kvPct: 34, specAccept: "-", tokPerS: 38 };
		expect(formatFooter(v)).toBe("GPU 87% • KV 34% • spec accept - • tok/s 38");
	});

	test("defaults spec accept to literal `-` when specAccept is undefined (D-25)", () => {
		const v: FooterValues = { gpuPct: 50, kvPct: 25, tokPerS: 30 };
		expect(formatFooter(v)).toBe("GPU 50% • KV 25% • spec accept - • tok/s 30");
	});

	test("missing gpuPct renders `--%` placeholder", () => {
		const v: FooterValues = { kvPct: 34, tokPerS: 38 };
		expect(formatFooter(v)).toBe("GPU --% • KV 34% • spec accept - • tok/s 38");
	});

	test("missing kvPct renders `--%` placeholder", () => {
		const v: FooterValues = { gpuPct: 87, tokPerS: 38 };
		expect(formatFooter(v)).toBe("GPU 87% • KV --% • spec accept - • tok/s 38");
	});

	test("missing tokPerS renders `--` placeholder", () => {
		const v: FooterValues = { gpuPct: 87, kvPct: 34 };
		expect(formatFooter(v)).toBe("GPU 87% • KV 34% • spec accept - • tok/s --");
	});

	test("all fields missing → all placeholders", () => {
		const v: FooterValues = {};
		expect(formatFooter(v)).toBe("GPU --% • KV --% • spec accept - • tok/s --");
	});

	test("rounds percentages via Math.round (87.67 → 88)", () => {
		const v: FooterValues = { gpuPct: 87.67, kvPct: 33.49, tokPerS: 38.4 };
		expect(formatFooter(v)).toBe("GPU 88% • KV 33% • spec accept - • tok/s 38");
	});

	test("spec accept field is literal `-` — never a number (D-25 placeholder until Phase 6)", () => {
		// Explicit assertion that the 'spec accept' field stays `-` in the output.
		const v: FooterValues = { gpuPct: 87, kvPct: 34, specAccept: "-", tokPerS: 38 };
		const out = formatFooter(v);
		expect(out).toContain("spec accept -");
	});
});
