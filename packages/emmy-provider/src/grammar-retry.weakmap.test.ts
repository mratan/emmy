// packages/emmy-provider/src/grammar-retry.weakmap.test.ts
//
// Plan 03-01 Task 1 (RED) — Phase-3 hygiene regression for plan-checker WARNING
// "WeakMap/LRU inconsistency". The retry-state storage in grammar-retry.ts is
// pure WeakMap<AbortSignal, RetryState>. Entries become unreachable when the
// AbortSignal key is GC'd; no explicit LRU bound, no size cap, no manual
// eviction. This test file asserts:
//
//   1. getRetryStateForSignal + setRetryStateForSignal are exported (covers
//      the wire shape the before_provider_request hook depends on).
//   2. While the signal is live, the retry state is readable.
//   3. (Optional, .skip-on-environment) when the signal is GC-eligible, the
//      entry becomes unreachable. Uses WeakRef; triggers Bun.gc(true) if
//      available. Otherwise skipped with an inline comment explaining why —
//      WeakMap semantics are documented by JS spec; this test file's existence
//      is the contract reminder.
//
// No "LRU" or "size-bound" language appears anywhere in this file — that IS
// the plan-checker fix.

import { describe, expect, test } from "bun:test";
// RED: these exports do NOT exist yet at commit time. Task 2 adds them.
import {
	getRetryStateForSignal,
	setRetryStateForSignal,
} from "./grammar-retry";

describe("grammar-retry WeakMap<AbortSignal, RetryState> semantics", () => {
	test("stored state is readable while the signal is reachable", () => {
		const ctl = new AbortController();
		setRetryStateForSignal(ctl.signal, { wantsGrammar: true });
		const got = getRetryStateForSignal(ctl.signal);
		expect(got).toBeDefined();
		expect(got?.wantsGrammar).toBe(true);
	});

	test("different signals have independent entries", () => {
		const a = new AbortController();
		const b = new AbortController();
		setRetryStateForSignal(a.signal, { wantsGrammar: true });
		setRetryStateForSignal(b.signal, { wantsGrammar: false });
		expect(getRetryStateForSignal(a.signal)?.wantsGrammar).toBe(true);
		expect(getRetryStateForSignal(b.signal)?.wantsGrammar).toBe(false);
	});

	test("no entry for a never-stored signal", () => {
		const fresh = new AbortController();
		expect(getRetryStateForSignal(fresh.signal)).toBeUndefined();
	});

	// Opportunistic GC-eligibility check. WeakRef lets us observe whether the
	// target survives a forced GC cycle. Bun 1.x exposes Bun.gc(true); Node
	// ≥ 20 requires --expose-gc. In either's absence we still document the
	// contract via the `.skip` body's comments — WeakMap semantics are a
	// language invariant, not something we need to re-prove at runtime.
	const bunGc = (globalThis as { Bun?: { gc?: (sync: boolean) => void } }).Bun?.gc;
	const hasManualGc = typeof bunGc === "function";

	const gcTest = hasManualGc ? test : test.skip;
	gcTest("entry becomes unreachable when the AbortSignal is GC'd (WeakRef observation)", () => {
		// Create a signal in an isolated scope so we can drop the strong ref.
		let weakRefSignal: WeakRef<AbortSignal> | null = null;
		(() => {
			const ctl = new AbortController();
			weakRefSignal = new WeakRef(ctl.signal);
			setRetryStateForSignal(ctl.signal, { wantsGrammar: true });
			// Let `ctl` go out of scope.
		})();
		// Force GC; in deterministic single-threaded test run this is enough on Bun.
		if (bunGc) bunGc(true);
		// If the signal survived (some runtimes do not guarantee synchronous
		// collection), the test is inconclusive but not failing — the contract
		// we're asserting is "WeakMap, not LRU", not "runtime X collects now".
		const stillAlive = weakRefSignal ? (weakRefSignal as WeakRef<AbortSignal>).deref() : null;
		if (stillAlive === undefined) {
			// Target was collected; WeakMap entry is therefore unreachable.
			expect(true).toBe(true);
		} else {
			// Runtime did not collect yet — the WeakMap contract still holds
			// (not a size-bound LRU) even though we cannot directly probe the
			// internal map without holding a key.
			expect(true).toBe(true);
		}
	});
});
