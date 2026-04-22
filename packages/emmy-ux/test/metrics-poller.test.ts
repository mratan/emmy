// packages/emmy-ux/test/metrics-poller.test.ts
//
// Plan 03-04 Task 1 (RED). Imports `startFooterPoller` + types from
// ../src/metrics-poller (not yet created — RED).
//
// Covers:
//  - 1 Hz cadence via injected `intervalImpl` (deterministic fake-timer)
//  - D-24 degrade threshold (failures 1..3 show last-good `?`, 4+ blank)
//  - reset-on-success: successful poll clears failCount and updates lastValue
//  - setStatus("emmy.footer", <formatted>) is called once per tick
//  - stop() clears the interval

import { describe, expect, test } from "bun:test";

import {
	startFooterPoller,
	type FooterPollerOpts,
} from "../src/metrics-poller";

type Tick = () => void | Promise<void>;

// Manual timer — we capture the callback and advance it explicitly.
function manualTimer(): {
	intervalImpl: (cb: Tick, _ms: number) => { __tag: "fake" };
	fire: () => Promise<void>;
	fireTimes: (n: number) => Promise<void>;
	cleared: boolean;
} {
	let cb: Tick | null = null;
	let cleared = false;
	const intervalImpl = ((fn: Tick, _ms: number) => {
		cb = fn;
		// Return a sentinel so stop() can detect it; setInterval normally returns
		// a Timer object — we don't need that here.
		return { __tag: "fake" } as const;
	}) as unknown as FooterPollerOpts["intervalImpl"] as unknown as (
		cb: Tick,
		_ms: number,
	) => { __tag: "fake" };

	const state = {
		intervalImpl: intervalImpl as unknown as (cb: Tick, _ms: number) => { __tag: "fake" },
		fire: async () => {
			if (cb) await cb();
		},
		fireTimes: async (n: number) => {
			for (let i = 0; i < n; i++) if (cb) await cb();
		},
		get cleared() { return cleared; },
		set cleared(v: boolean) { cleared = v; },
	};
	return state;
}

describe("startFooterPoller (1 Hz metrics poller)", () => {
	test("calls setStatus('emmy.footer', <formatted>) on each tick", async () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const timer = manualTimer();

		// Stub fetchMetricsImpl to deliver a valid snapshot.
		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (k, t) => calls.push({ key: k, text: t }),
			intervalMs: 1000,
			intervalImpl: timer.intervalImpl,
			fetchMetricsImpl: async () => ({
				"vllm:gpu_cache_usage_perc": 0.5,
				"vllm:generation_tokens_total": 100,
			}),
			sampleNvidiaSmiImpl: () => ({ ts: "now", gpu_util_pct: 75 }),
		});

		// Priming tick is scheduled via void tick() — call fire() to be explicit
		// about one tick; the poller's implementation may run a priming call too.
		await timer.fire();

		expect(calls.length).toBeGreaterThanOrEqual(1);
		const last = calls[calls.length - 1]!;
		expect(last.key).toBe("emmy.footer");
		expect(last.text ?? "").toContain("GPU ");
		expect(last.text ?? "").toContain("KV ");
		expect(last.text ?? "").toContain("spec accept -");
		expect(last.text ?? "").toContain("tok/s ");

		handle.stop();
	});

	test("stop() clears the interval", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		let clearedHandle: unknown = null;
		const timer = manualTimer();
		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (k, t) => calls.push({ key: k, text: t }),
			intervalImpl: timer.intervalImpl,
			clearIntervalImpl: ((h: unknown) => {
				clearedHandle = h;
			}) as unknown as (h: unknown) => void,
			fetchMetricsImpl: async () => ({}),
			sampleNvidiaSmiImpl: () => null,
		});
		handle.stop();
		// clearIntervalImpl should have been called with the interval handle
		expect(clearedHandle).toEqual({ __tag: "fake" });
	});

	test("D-24 degrade: failure 1-3 renders last-good `?`, failure 4 blanks", async () => {
		// lastGood captured first, then 4 consecutive failures
		const statuses: string[] = [];
		const timer = manualTimer();

		let fetchCallIdx = 0;
		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (_k, t) => statuses.push(t ?? ""),
			intervalMs: 1000,
			maxFailures: 3,
			intervalImpl: timer.intervalImpl,
			fetchMetricsImpl: async () => {
				fetchCallIdx++;
				if (fetchCallIdx === 1) {
					// First call: success — establishes last-good at 50% for KV
					return {
						"vllm:gpu_cache_usage_perc": 0.5,
						"vllm:generation_tokens_total": 100,
					};
				}
				// Subsequent calls: throw (poll failure)
				throw new Error(`mock fetch failure #${fetchCallIdx}`);
			},
			sampleNvidiaSmiImpl: () => null, // GPU always unavailable
		});

		// Tick 1: success (lastValue = 50; failCount = 0)
		await timer.fire();
		// Ticks 2..4: three failures — should render last-good with `?`
		await timer.fire();
		await timer.fire();
		await timer.fire();
		// Tick 5: fourth failure — should blank
		await timer.fire();

		// Find the last 5 statuses corresponding to these ticks (poller may have
		// emitted a priming status too — we just check the relevant ones).
		const kvStatuses = statuses.map((s) => s);
		// The first status should have KV at 50
		expect(kvStatuses.join("\n")).toContain("KV 50%");
		// After 3 failures we still see "KV 50%?"
		const degradeLines = kvStatuses.filter((s) => s.includes("KV 50%?"));
		expect(degradeLines.length).toBeGreaterThanOrEqual(1);
		// Eventually (tick 5, the 4th failure), KV must blank
		const finalStatus = kvStatuses[kvStatuses.length - 1]!;
		expect(finalStatus).toContain("KV --%");

		handle.stop();
	});

	test("reset-on-success: success at any failCount resets failCount", async () => {
		const statuses: string[] = [];
		const timer = manualTimer();

		let fetchCallIdx = 0;
		// Pattern: priming-tick + fires. The poller's priming tick (issued inside
		// startFooterPoller) is call #1. Explicit fires are calls #2..#N.
		// We want: primer=success (establishes lastValue=50), fires 1-2=fail,
		// fire 3=success (resets failCount), fires 4-6=3 failures (degrade
		// marker still visible since <=maxFailures=3).
		const successCalls = new Set([1, 4]); // primer + fire #3
		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (_k, t) => statuses.push(t ?? ""),
			maxFailures: 3,
			intervalImpl: timer.intervalImpl,
			fetchMetricsImpl: async () => {
				fetchCallIdx++;
				if (successCalls.has(fetchCallIdx)) {
					return {
						"vllm:gpu_cache_usage_perc": 0.5,
						"vllm:generation_tokens_total": 100,
					};
				}
				throw new Error("fail");
			},
			sampleNvidiaSmiImpl: () => null,
		});

		// Fire 6 times (calls 2..7 — the 7th call is the 3rd consecutive
		// failure after the reset at call #4). failCount after calls 5,6,7 is
		// 1,2,3 — still <=maxFailures=3, so degrade marker visible.
		for (let i = 0; i < 6; i++) await timer.fire();

		const last = statuses[statuses.length - 1]!;
		expect(last).toContain("KV 50%?");

		handle.stop();
	});

	test("telemetry-off: EMMY_TELEMETRY=off suppresses polling (no setStatus calls, no interval)", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		let intervalCreated = false;
		const intervalImpl = ((_cb: Tick, _ms: number) => {
			intervalCreated = true;
			return { __tag: "fake" };
		}) as unknown as FooterPollerOpts["intervalImpl"];

		const oldEnv = process.env.EMMY_TELEMETRY;
		process.env.EMMY_TELEMETRY = "off";
		try {
			const handle = startFooterPoller({
				baseUrl: "http://127.0.0.1:8002",
				setStatus: (k, t) => calls.push({ key: k, text: t }),
				intervalImpl,
			});
			// Without polling started, handle.stop() should still be safe.
			handle.stop();
		} finally {
			if (oldEnv === undefined) delete process.env.EMMY_TELEMETRY;
			else process.env.EMMY_TELEMETRY = oldEnv;
		}

		expect(intervalCreated).toBe(false);
		expect(calls.length).toBe(0);
	});
});
