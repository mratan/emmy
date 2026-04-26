// Phase 04.5 Plan 04 Task 1 — ConcurrencyGovernor regression suite.
//
// Tests cover:
//   1. Concurrency cap (queue mode) with FIFO ordering
//   2. Long-context serialization branch (effective cap=1)
//   3. Under-threshold uses normal cap
//   4. agent.dispatch.queued telemetry
//   5. release idempotence
//   6. agent.dispatch.serialized telemetry
//   7. (I3) Over-cap rejection in default mode
//   8. (I3) Default rejectOverCap is true (LOCKED)

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Spy on telemetry events.
const emittedEvents: any[] = [];
const emitEventSpy = mock((record: any) => {
	emittedEvents.push(record);
});

// Replace @emmy/telemetry's emitEvent with our spy. mock.module installs the
// substitute BEFORE the governor module imports it.
mock.module("@emmy/telemetry", () => ({
	emitEvent: emitEventSpy,
}));

import { createConcurrencyGovernor } from "../../src/subagent/governor";

beforeEach(() => {
	emittedEvents.length = 0;
	emitEventSpy.mockClear();
});

describe("ConcurrencyGovernor — semaphore + telemetry", () => {
	test("Test 1 — concurrency cap in queue mode (rejectOverCap=false): 3rd waits", async () => {
		const gov = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: false,
		});
		const a = await gov.acquire({});
		const b = await gov.acquire({});
		// Third acquire MUST wait until a or b releases.
		const cPromise = gov.acquire({});
		// Race: cPromise should not resolve before release.
		const winner = await Promise.race([
			cPromise.then(() => "c"),
			new Promise((r) => setTimeout(() => r("timeout"), 50)),
		]);
		expect(winner).toBe("timeout");
		a.release();
		const c = await cPromise;
		expect(c.waited_ms).toBeGreaterThan(0);
		b.release();
		c.release();
	});

	test("Test 2 — FIFO ordering with cap 1", async () => {
		const gov = createConcurrencyGovernor({
			maxConcurrent: 1,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: false,
		});
		const order: string[] = [];
		const a = await gov.acquire({});
		const bP = gov.acquire({}).then((h) => {
			order.push("B");
			return h;
		});
		const cP = gov.acquire({}).then((h) => {
			order.push("C");
			return h;
		});
		// Allow microtasks to enqueue.
		await new Promise((r) => setTimeout(r, 5));
		a.release();
		const b = await bP;
		expect(order).toEqual(["B"]); // C still waiting
		b.release();
		const c = await cP;
		expect(order).toEqual(["B", "C"]);
		c.release();
	});

	test("Test 3 — long-context serialization branch reduces cap to 1 + emits serialized event", async () => {
		const gov = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: false,
		});
		const a = await gov.acquire({ parentInputTokens: 50000 });
		expect(a.serialized).toBe(true);
		// Second acquire at high context MUST wait.
		const bPromise = gov.acquire({ parentInputTokens: 50000 });
		const winner = await Promise.race([
			bPromise.then(() => "b"),
			new Promise((r) => setTimeout(() => r("timeout"), 50)),
		]);
		expect(winner).toBe("timeout");
		a.release();
		const b = await bPromise;
		b.release();
		// Telemetry: serialized event fired with right payload.
		const serializedEvts = emittedEvents.filter((e) => e.event === "agent.dispatch.serialized");
		expect(serializedEvts.length).toBeGreaterThanOrEqual(1);
		expect(serializedEvts[0].parent_input_tokens).toBe(50000);
		expect(serializedEvts[0].threshold).toBe(40000);
	});

	test("Test 4 — under-threshold uses normal cap (parallel)", async () => {
		const gov = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: false,
		});
		const [a, b] = await Promise.all([
			gov.acquire({ parentInputTokens: 1000 }),
			gov.acquire({ parentInputTokens: 1000 }),
		]);
		expect(a.serialized).toBe(false);
		expect(b.serialized).toBe(false);
		expect(a.waited_ms).toBeLessThan(10);
		expect(b.waited_ms).toBeLessThan(10);
		a.release();
		b.release();
	});

	test("Test 5 — agent.dispatch.queued event fires on wait (queue mode)", async () => {
		const gov = createConcurrencyGovernor({
			maxConcurrent: 1,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: false,
		});
		const a = await gov.acquire({});
		const bP = gov.acquire({});
		await new Promise((r) => setTimeout(r, 20));
		a.release();
		const b = await bP;
		const queuedEvts = emittedEvents.filter((e) => e.event === "agent.dispatch.queued");
		expect(queuedEvts.length).toBeGreaterThanOrEqual(1);
		expect(queuedEvts[0].wait_ms).toBeGreaterThan(0);
		expect(queuedEvts[0].in_flight).toBe(1);
		expect(queuedEvts[0].cap).toBe(1);
		b.release();
	});

	test("Test 6 — release is idempotent (second call no-op)", async () => {
		const gov = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: false,
		});
		const a = await gov.acquire({});
		a.release();
		// Second release should not throw, and should not over-decrement.
		a.release();
		// Verify state is consistent — we should still be able to acquire 2.
		const b = await gov.acquire({});
		const c = await gov.acquire({});
		b.release();
		c.release();
	});

	test("Test 7 (I3) — over-cap rejection emits agent.dispatch.rejected", async () => {
		const gov = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
			rejectOverCap: true,
		});
		const a = await gov.acquire({});
		const b = await gov.acquire({});
		await expect(gov.acquire({})).rejects.toThrow(/concurrent dispatch cap/);
		const rejected = emittedEvents.filter((e) => e.event === "agent.dispatch.rejected");
		expect(rejected.length).toBe(1);
		expect(rejected[0].reason).toBe("over_cap");
		expect(rejected[0].in_flight).toBe(2);
		expect(rejected[0].cap).toBe(2);
		a.release();
		b.release();
	});

	test("Test 8 (I3) — default rejectOverCap is true (LOCKED)", async () => {
		// No rejectOverCap field passed → LOCKED default kicks in.
		const gov = createConcurrencyGovernor({
			maxConcurrent: 2,
			longContextSerializeThresholdTokens: 40000,
		});
		const a = await gov.acquire({});
		const b = await gov.acquire({});
		await expect(gov.acquire({})).rejects.toThrow(/concurrent dispatch cap/);
		a.release();
		b.release();
	});
});
