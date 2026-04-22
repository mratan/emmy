// packages/emmy-ux/test/footer-degrade.test.ts
//
// Plan 03-04 Task 1 (RED). Tests the D-24 graceful-degrade semantics inside
// formatFooter + the degrade state tracker in ../src/footer.
//
// D-24 (plan-checker WARNING resolution): degrade marker `{lastGood}?`
// appears on failures 1..maxFailures (default 3); blank field at
// failCount > maxFailures.

import { describe, expect, test } from "bun:test";

import { formatFooter, type FooterValues } from "../src/footer";

describe("footer degrade rendering (D-24)", () => {
	test("undegraded (success) value has no `?` suffix", () => {
		const v: FooterValues = { gpuPct: 45, kvPct: 34, tokPerS: 38 };
		const out = formatFooter(v);
		expect(out).toContain("GPU 45%");
		expect(out).not.toContain("GPU 45%?");
	});

	test("degraded gpu: `?` suffix appended to last-good value (failure 1)", () => {
		// Degraded=true means most-recent poll failed but we're within maxFailures;
		// render last-good with `?` suffix.
		const v: FooterValues = { gpuPct: 45, gpuDegraded: true, kvPct: 34, tokPerS: 38 };
		const out = formatFooter(v);
		expect(out).toContain("GPU 45%?");
	});

	test("degraded kv: `?` suffix appended to last-good value", () => {
		const v: FooterValues = { gpuPct: 50, kvPct: 28, kvDegraded: true, tokPerS: 40 };
		const out = formatFooter(v);
		expect(out).toContain("KV 28%?");
	});

	test("degraded tok/s: `?` suffix appended to last-good value", () => {
		const v: FooterValues = { gpuPct: 50, kvPct: 28, tokPerS: 40, tokDegraded: true };
		const out = formatFooter(v);
		expect(out).toContain("tok/s 40?");
	});

	test("blanked field (undefined value): no `?`, just `--` placeholder", () => {
		// failCount > maxFailures → value undefined → `--` blank placeholder
		const v: FooterValues = { gpuPct: undefined, kvPct: 34, tokPerS: 38 };
		const out = formatFooter(v);
		expect(out).toContain("GPU --%");
		expect(out).not.toContain("--%?");
	});

	test("mixed degrade: GPU degraded, KV blank, tok/s live", () => {
		const v: FooterValues = {
			gpuPct: 45,
			gpuDegraded: true,
			kvPct: undefined,
			tokPerS: 38,
		};
		const out = formatFooter(v);
		expect(out).toContain("GPU 45%?");
		expect(out).toContain("KV --%");
		expect(out).toContain("tok/s 38");
	});

	test("D-24 threshold semantics (natural-language): degrade marker on failures 1-3, blank at 4+", () => {
		// This test documents the threshold semantics directly — the actual
		// failCount bookkeeping happens in metrics-poller.test.ts (the formatter
		// only reflects the FooterValues fields).

		// Failure 1: degraded=true, lastValue=45 → "GPU 45%?"
		expect(formatFooter({ gpuPct: 45, gpuDegraded: true })).toContain("GPU 45%?");
		// Failure 2: same shape → still "GPU 45%?"
		expect(formatFooter({ gpuPct: 45, gpuDegraded: true })).toContain("GPU 45%?");
		// Failure 3: still degrade marker → "GPU 45%?"
		expect(formatFooter({ gpuPct: 45, gpuDegraded: true })).toContain("GPU 45%?");
		// Failure 4: blank (poller stops showing last-good) → "GPU --%"
		expect(formatFooter({ gpuPct: undefined })).toContain("GPU --%");
	});
});
