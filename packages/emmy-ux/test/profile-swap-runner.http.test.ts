// packages/emmy-ux/test/profile-swap-runner.http.test.ts
//
// Plan 04.2-03 Task 1 — Bun unit tests for runSwapAndStreamProgressHttp.
//
// Strategy: inject a fake `fetchSseImpl` that returns a Response wrapping a
// ReadableStream of canned SSE chunks. Tests drive frame-by-frame events and
// assert:
//   - 4 D-02 LOCKED phase callbacks fire in order (C-06 wire format)
//   - {rolled_back, rollback_succeeded?} envelope captured (Phase-4 contract)
//   - Default URL is http://127.0.0.1:8003 when EMMY_SERVE_URL unset
//   - EMMY_SERVE_URL override + trailing-slash strip
//   - POST body shape + Accept/Content-Type headers
//   - Hard-fail on connect-refuse (T-04.2-S5: NEVER silently fall back to local)
//   - HTTP non-2xx returns {exit: 1}
//   - Malformed SSE frames silently ignored (S-3 discipline)
//   - Goal-backward dispatch-target test: /profile dispatch hits /profile/swap

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	runSwapAndStreamProgressHttp,
	type FetchSseImpl,
} from "../src/profile-swap-runner-http";

function makeFakeFetchSse(sseChunks: string[]): {
	fetchSseImpl: FetchSseImpl;
	lastUrl: { url?: string; init?: RequestInit };
} {
	const lastUrl: { url?: string; init?: RequestInit } = {};
	const fetchSseImpl: FetchSseImpl = async (url, init) => {
		lastUrl.url = url;
		lastUrl.init = init;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const enc = new TextEncoder();
				for (const c of sseChunks) controller.enqueue(enc.encode(c));
				controller.close();
			},
		});
		return new Response(stream, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	};
	return { fetchSseImpl, lastUrl };
}

function makeFakeFetchHttpError(status: number): {
	fetchSseImpl: FetchSseImpl;
	lastUrl: { url?: string };
} {
	const lastUrl: { url?: string } = {};
	const fetchSseImpl: FetchSseImpl = async (url) => {
		lastUrl.url = url;
		return new Response("error", { status });
	};
	return { fetchSseImpl, lastUrl };
}

describe("runSwapAndStreamProgressHttp (Plan 04.2-03)", () => {
	let oldServeUrl: string | undefined;
	beforeEach(() => {
		oldServeUrl = process.env.EMMY_SERVE_URL;
	});
	afterEach(() => {
		if (oldServeUrl === undefined) delete process.env.EMMY_SERVE_URL;
		else process.env.EMMY_SERVE_URL = oldServeUrl;
	});

	test("forwards 4 D-02 LOCKED phases in order (C-06 wire format)", async () => {
		const { fetchSseImpl } = makeFakeFetchSse([
			'data: {"phase":"stopping vLLM"}\n\n',
			'data: {"phase":"loading weights","pct":0}\n\n',
			'data: {"phase":"loading weights","pct":50}\n\n',
			'data: {"phase":"warmup"}\n\n',
			'data: {"phase":"ready"}\n\n',
			'data: {"exit":0}\n\n',
		]);
		const phases: Array<[string, number | undefined]> = [];
		const result = await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: (p, pct) => phases.push([p, pct]),
			fetchSseImpl,
		});
		expect(result.exit).toBe(0);
		expect(phases).toEqual([
			["stopping vLLM", undefined],
			["loading weights", 0],
			["loading weights", 50],
			["warmup", undefined],
			["ready", undefined],
		]);
	});

	test("captures rolled_back envelope on exit-6 frame (Phase-4 contract)", async () => {
		const { fetchSseImpl } = makeFakeFetchSse([
			'data: {"phase":"stopping vLLM"}\n\n',
			'data: {"rolled_back":true,"rollback_succeeded":true}\n\n',
			'data: {"exit":6}\n\n',
		]);
		const result = await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(result.exit).toBe(6);
		expect(result.envelope?.rolled_back).toBe(true);
		expect(result.envelope?.rollback_succeeded).toBe(true);
	});

	test("default URL is http://127.0.0.1:8003 when EMMY_SERVE_URL unset", async () => {
		delete process.env.EMMY_SERVE_URL;
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe("http://127.0.0.1:8003/profile/swap");
	});

	test("uses EMMY_SERVE_URL when set", async () => {
		process.env.EMMY_SERVE_URL = "https://spark.example.ts.net:8003";
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe(
			"https://spark.example.ts.net:8003/profile/swap",
		);
	});

	test("strips trailing slash from EMMY_SERVE_URL", async () => {
		process.env.EMMY_SERVE_URL = "https://spark.example.ts.net:8003/";
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe(
			"https://spark.example.ts.net:8003/profile/swap",
		);
	});

	test("POSTs JSON body with from/to/port + accepts text/event-stream", async () => {
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSwapAndStreamProgressHttp({
			from: "profiles/old",
			to: "profiles/new",
			port: 8002,
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.init?.method).toBe("POST");
		const body = JSON.parse(lastUrl.init?.body as string);
		expect(body).toEqual({
			from: "profiles/old",
			to: "profiles/new",
			port: 8002,
		});
		const headers = lastUrl.init?.headers as Record<string, string>;
		expect(headers["accept"] || headers["Accept"]).toBe(
			"text/event-stream",
		);
		expect(headers["content-type"] || headers["Content-Type"]).toBe(
			"application/json",
		);
	});

	test("returns {exit: 1} when sidecar unreachable (T-04.2-S5: hard-fail, no silent local fallback)", async () => {
		const fetchSseImpl: FetchSseImpl = async () => {
			throw new Error("ECONNREFUSED");
		};
		const phases: string[] = [];
		const result = await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: (p) => phases.push(p),
			fetchSseImpl,
		});
		expect(result.exit).toBe(1);
		expect(phases).toEqual([]); // no callbacks fired
		expect(result.envelope).toBeUndefined();
	});

	test("returns {exit: 1} on HTTP 5xx", async () => {
		const { fetchSseImpl } = makeFakeFetchHttpError(500);
		const result = await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(result.exit).toBe(1);
	});

	test("ignores malformed SSE frames (S-3 discipline)", async () => {
		const { fetchSseImpl } = makeFakeFetchSse([
			'data: {"phase":"stopping vLLM"}\n\n',
			"data: not-json\n\n",
			'data: {"phase":"ready"}\n\n',
			'data: {"exit":0}\n\n',
		]);
		const phases: string[] = [];
		const result = await runSwapAndStreamProgressHttp({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: (p) => phases.push(p),
			fetchSseImpl,
		});
		expect(result.exit).toBe(0);
		expect(phases).toEqual(["stopping vLLM", "ready"]);
	});

	test("end-to-end /profile dispatch hits /profile/swap (NOT /start, NOT /stop) per phase goal — goal-backward closure", async () => {
		// Phase goal: "Mac client emmy /profile <other> shows D-02 four-phase progress."
		// The spawn-argv snapshot test (Task 2 case 4) proves spawn is NOT called when
		// EMMY_REMOTE_CLIENT='1'. This test bridges the goal-backward gap: it proves
		// the HTTP path REACHES the correct sidecar endpoint (/profile/swap) — not /start
		// (cold start), not /stop (drain), not /healthz. Without this test, the dispatcher
		// could theoretically POST to the wrong URL and still pass spawn-NOT-called.
		process.env.EMMY_SERVE_URL = "http://stub:8003";
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSwapAndStreamProgressHttp({
			from: "profiles/old",
			to: "profiles/new",
			port: 8002,
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe("http://stub:8003/profile/swap");
		expect(lastUrl.url).not.toContain("/start");
		expect(lastUrl.url).not.toContain("/stop");
		expect(lastUrl.url).not.toContain("/healthz");
		expect(lastUrl.url).not.toContain("/status");
		const body = JSON.parse(lastUrl.init?.body as string);
		expect(body).toEqual({
			from: "profiles/old",
			to: "profiles/new",
			port: 8002,
		});
	});
});
