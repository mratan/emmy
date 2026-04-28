// packages/emmy-ux/test/metrics-poller.remote.test.ts
//
// Plan 04.2-04 Task 2 — Bun unit tests for the D-09 LOCKED remote-mode branch
// of metrics-poller.ts.
//
// Strategy: drive startFooterPoller with a manualTimer + injected
// getStatusImpl; toggle process.env.EMMY_REMOTE_CLIENT to assert which path
// runs. EMMY_TELEMETRY=off precedence is also checked.
//
// Coverage (≥7 cases):
//   1. EMMY_REMOTE_CLIENT=1 → tick polls /status; vllm + nvidia-smi NOT called
//   2. EMMY_REMOTE_CLIENT unset → tick uses local pollers; /status NOT called
//   3. EMMY_REMOTE_CLIENT=0 → still local path (only literal "1" triggers)
//   4. remote mode kv_used_pct=0.34 → values.kvPct=34
//   5. remote mode kv_used_pct=null → degrade pipeline (kvDegraded eventually)
//   6. remote mode getStatus throws → all fields degrade
//   7. remote mode uses EMMY_SERVE_URL when set
//   8. remote mode default URL is http://127.0.0.1:8003
//   9. EMMY_TELEMETRY=off in remote mode → poller no-op (kill-switch precedence)

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	startFooterPoller,
	type FooterPollerOpts,
} from "../src/metrics-poller";
import type { SidecarStatus } from "../src/sidecar-status-client";

type Tick = () => void | Promise<void>;

function manualTimer(): {
	intervalImpl: (cb: Tick, _ms: number) => { __tag: "fake" };
	fire: () => Promise<void>;
	fireTimes: (n: number) => Promise<void>;
} {
	let cb: Tick | null = null;
	const intervalImpl = ((fn: Tick, _ms: number) => {
		cb = fn;
		return { __tag: "fake" } as const;
	}) as unknown as FooterPollerOpts["intervalImpl"] as unknown as (
		cb: Tick,
		_ms: number,
	) => { __tag: "fake" };
	return {
		intervalImpl,
		fire: async () => {
			if (cb) await cb();
		},
		fireTimes: async (n: number) => {
			for (let i = 0; i < n; i++) if (cb) await cb();
		},
	};
}

function makeStatusImpl(payloads: SidecarStatus[]): {
	impl: (baseUrl: string, timeoutMs: number) => Promise<SidecarStatus>;
	calls: Array<[string, number]>;
} {
	const calls: Array<[string, number]> = [];
	let i = 0;
	const impl = async (baseUrl: string, timeoutMs: number) => {
		calls.push([baseUrl, timeoutMs]);
		const payload = payloads[Math.min(i, payloads.length - 1)]!;
		i++;
		return payload;
	};
	return { impl, calls };
}

function readyStatus(overrides: Partial<SidecarStatus> = {}): SidecarStatus {
	return {
		state: "ready",
		profile_id: "gemma-4-26b-a4b-it",
		profile_variant: "v2.1",
		profile_hash: "a".repeat(64),
		vllm_up: true,
		vllm_pid: 1,
		container_digest: null,
		kv_used_pct: 0.34,
		gpu_temp_c: 64,
		in_flight: 0,
		last_error: null,
		...overrides,
	};
}

describe("startFooterPoller — D-09 remote-mode branch (Plan 04.2-04)", () => {
	let oldRemote: string | undefined;
	let oldServeUrl: string | undefined;
	let oldTelemetry: string | undefined;

	beforeEach(() => {
		oldRemote = process.env.EMMY_REMOTE_CLIENT;
		oldServeUrl = process.env.EMMY_SERVE_URL;
		oldTelemetry = process.env.EMMY_TELEMETRY;
	});

	afterEach(() => {
		// S-2 env restore — handle undefined sentinel correctly.
		if (oldRemote === undefined) delete process.env.EMMY_REMOTE_CLIENT;
		else process.env.EMMY_REMOTE_CLIENT = oldRemote;
		if (oldServeUrl === undefined) delete process.env.EMMY_SERVE_URL;
		else process.env.EMMY_SERVE_URL = oldServeUrl;
		if (oldTelemetry === undefined) delete process.env.EMMY_TELEMETRY;
		else process.env.EMMY_TELEMETRY = oldTelemetry;
	});

	test("EMMY_REMOTE_CLIENT=1 → tick polls /status, NOT vllm /metrics or nvidia-smi", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		delete process.env.EMMY_SERVE_URL;
		const { impl: getStatusImpl, calls: statusCalls } = makeStatusImpl([
			readyStatus(),
		]);
		let metricsCalled = 0;
		let smiCalled = 0;
		const timer = manualTimer();
		const setStatusCalls: Array<[string, string | undefined]> = [];

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (k, t) => setStatusCalls.push([k, t]),
			intervalImpl: timer.intervalImpl,
			fetchMetricsImpl: async () => {
				metricsCalled++;
				return {};
			},
			sampleNvidiaSmiImpl: () => {
				smiCalled++;
				return null;
			},
			getStatusImpl,
		});

		await timer.fire();
		expect(statusCalls.length).toBeGreaterThanOrEqual(1);
		expect(metricsCalled).toBe(0);
		expect(smiCalled).toBe(0);
		// setStatus emitted footer text.
		expect(setStatusCalls.some(([k]) => k === "emmy.footer")).toBe(true);
		handle.stop();
	});

	test("EMMY_REMOTE_CLIENT unset → tick uses local pollers, /status NOT called", async () => {
		delete process.env.EMMY_REMOTE_CLIENT;
		const { impl: getStatusImpl, calls: statusCalls } = makeStatusImpl([
			readyStatus(),
		]);
		let metricsCalled = 0;
		let smiCalled = 0;
		const timer = manualTimer();

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: () => {},
			intervalImpl: timer.intervalImpl,
			fetchMetricsImpl: async () => {
				metricsCalled++;
				return {};
			},
			sampleNvidiaSmiImpl: () => {
				smiCalled++;
				return null;
			},
			getStatusImpl,
		});

		await timer.fire();
		expect(statusCalls.length).toBe(0);
		expect(metricsCalled).toBeGreaterThanOrEqual(1);
		expect(smiCalled).toBeGreaterThanOrEqual(1);
		handle.stop();
	});

	test("EMMY_REMOTE_CLIENT=0 → still local path (only literal '1' triggers remote)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "0";
		const { impl: getStatusImpl, calls: statusCalls } = makeStatusImpl([
			readyStatus(),
		]);
		let metricsCalled = 0;
		const timer = manualTimer();

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: () => {},
			intervalImpl: timer.intervalImpl,
			fetchMetricsImpl: async () => {
				metricsCalled++;
				return {};
			},
			sampleNvidiaSmiImpl: () => null,
			getStatusImpl,
		});

		await timer.fire();
		expect(statusCalls.length).toBe(0);
		expect(metricsCalled).toBeGreaterThanOrEqual(1);
		handle.stop();
	});

	test("remote mode kv_used_pct=0.34 → footer text contains 'KV 34'", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		const { impl: getStatusImpl } = makeStatusImpl([
			readyStatus({ kv_used_pct: 0.34 }),
		]);
		const timer = manualTimer();
		const setStatusCalls: Array<[string, string | undefined]> = [];

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (k, t) => setStatusCalls.push([k, t]),
			intervalImpl: timer.intervalImpl,
			getStatusImpl,
		});

		await timer.fire();
		const footerLine = setStatusCalls
			.filter(([k]) => k === "emmy.footer")
			.map(([, t]) => t ?? "")
			.join(" ");
		expect(footerLine).toContain("KV 34");
		handle.stop();
	});

	test("remote mode kv_used_pct=null → eventually degrades (KV --% after maxFailures+1 ticks)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		const { impl: getStatusImpl } = makeStatusImpl([
			readyStatus({ kv_used_pct: null }),
		]);
		const timer = manualTimer();
		const setStatusCalls: Array<[string, string | undefined]> = [];

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (k, t) => setStatusCalls.push([k, t]),
			intervalImpl: timer.intervalImpl,
			maxFailures: 3,
			getStatusImpl,
		});

		// Fire 5 times — should blank kv eventually.
		await timer.fireTimes(5);
		const final = setStatusCalls[setStatusCalls.length - 1]?.[1] ?? "";
		expect(final).toContain("KV --%");
		handle.stop();
	});

	test("remote mode getStatus throws → all fields degrade (no silent fallback to local)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		const timer = manualTimer();
		const setStatusCalls: Array<[string, string | undefined]> = [];
		let metricsCalled = 0;
		let smiCalled = 0;

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: (k, t) => setStatusCalls.push([k, t]),
			intervalImpl: timer.intervalImpl,
			maxFailures: 3,
			fetchMetricsImpl: async () => {
				metricsCalled++;
				return {};
			},
			sampleNvidiaSmiImpl: () => {
				smiCalled++;
				return null;
			},
			getStatusImpl: async () => {
				throw new Error("ECONNREFUSED");
			},
		});

		await timer.fireTimes(5);
		const final = setStatusCalls[setStatusCalls.length - 1]?.[1] ?? "";
		// All fields should be `--`.
		expect(final).toContain("KV --%");
		expect(final).toContain("GPU --%");
		expect(final).toContain("tok/s --");
		// Critically — local pollers were NEVER called (T-04.2-S5).
		expect(metricsCalled).toBe(0);
		expect(smiCalled).toBe(0);
		handle.stop();
	});

	test("remote mode uses EMMY_SERVE_URL when set", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		process.env.EMMY_SERVE_URL = "https://spark.example.ts.net:8003";
		const { impl: getStatusImpl, calls } = makeStatusImpl([readyStatus()]);
		const timer = manualTimer();

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: () => {},
			intervalImpl: timer.intervalImpl,
			getStatusImpl,
		});

		await timer.fire();
		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls[0]![0]).toBe("https://spark.example.ts.net:8003");
		handle.stop();
	});

	test("remote mode default URL is http://127.0.0.1:8003 when EMMY_SERVE_URL unset", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		delete process.env.EMMY_SERVE_URL;
		const { impl: getStatusImpl, calls } = makeStatusImpl([readyStatus()]);
		const timer = manualTimer();

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: () => {},
			intervalImpl: timer.intervalImpl,
			getStatusImpl,
		});

		await timer.fire();
		expect(calls[0]![0]).toBe("http://127.0.0.1:8003");
		handle.stop();
	});

	test("EMMY_TELEMETRY=off in remote mode → poller no-op (kill-switch precedence)", () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		process.env.EMMY_TELEMETRY = "off";
		const { impl: getStatusImpl, calls } = makeStatusImpl([readyStatus()]);
		let intervalCreated = false;
		const intervalImpl = ((_cb: Tick, _ms: number) => {
			intervalCreated = true;
			return { __tag: "fake" } as const;
		}) as unknown as FooterPollerOpts["intervalImpl"];

		const handle = startFooterPoller({
			baseUrl: "http://127.0.0.1:8002",
			setStatus: () => {},
			intervalImpl,
			getStatusImpl,
		});
		handle.stop();

		expect(intervalCreated).toBe(false);
		expect(calls.length).toBe(0);
	});
});
