// packages/emmy-ux/test/sidecar-lifecycle-client.test.ts
//
// Plan 04.2-04 Task 2 — Bun unit tests for runSidecarStartHttp +
// runSidecarStopHttp.
//
// Self-contained module (does NOT import from profile-swap-runner-http.ts).
// Mirrors profile-swap-runner.http.test.ts patterns: makeFakeFetchSse helper
// returns canned SSE chunks; makeFakeFetchHttpError returns a non-2xx Response.
//
// Coverage (≥7 cases):
//   /start dispatch:
//     1. POSTs to ${baseUrl}/start with {profile_id, variant} body
//     2. Strips trailing slash from baseUrl
//     3. Forwards 4 D-02 LOCKED phases in order (C-06 wire format)
//     4. Returns {exit:1} on connect refuse (T-04.2-S5 hard-fail)
//     5. Returns {exit:1} on HTTP 5xx
//   /stop dispatch:
//     6. POSTs to ${baseUrl}/stop with {} body
//     7. Surfaces draining sidecar event via onProgress
//     8. Returns {exit:1} on connect refuse

import { describe, expect, test } from "bun:test";
import {
	runSidecarStartHttp,
	runSidecarStopHttp,
	type FetchSseImpl,
} from "../src/sidecar-lifecycle-client";

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

describe("runSidecarStartHttp (Plan 04.2-04 Task 2)", () => {
	test("POSTs to ${baseUrl}/start with {profile_id, variant} body", async () => {
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSidecarStartHttp({
			baseUrl: "http://127.0.0.1:8003",
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe("http://127.0.0.1:8003/start");
		const body = JSON.parse(lastUrl.init?.body as string);
		expect(body).toEqual({
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
		});
		expect(lastUrl.init?.method).toBe("POST");
		const headers = lastUrl.init?.headers as Record<string, string>;
		expect(headers["accept"] || headers["Accept"]).toBe("text/event-stream");
		expect(headers["content-type"] || headers["Content-Type"]).toBe(
			"application/json",
		);
	});

	test("strips trailing slash from baseUrl", async () => {
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSidecarStartHttp({
			baseUrl: "https://spark.example.ts.net:8003/",
			profile_id: "x",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe("https://spark.example.ts.net:8003/start");
		expect(lastUrl.url).not.toContain("//start");
	});

	test("variant omitted → body has variant=undefined (serialized as missing)", async () => {
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSidecarStartHttp({
			baseUrl: "http://127.0.0.1:8003",
			profile_id: "gemma-4-26b-a4b-it",
			onProgress: () => {},
			fetchSseImpl,
		});
		const body = JSON.parse(lastUrl.init?.body as string);
		expect(body.profile_id).toBe("gemma-4-26b-a4b-it");
		// JSON.stringify drops undefined values; Pydantic uses default None.
		expect(body.variant).toBeUndefined();
	});

	test("forwards C-06 LOCKED 4 phases in order", async () => {
		const { fetchSseImpl } = makeFakeFetchSse([
			'data: {"phase":"stopping vLLM"}\n\n',
			'data: {"phase":"loading weights","pct":50}\n\n',
			'data: {"phase":"warmup"}\n\n',
			'data: {"phase":"ready"}\n\n',
			'data: {"exit":0}\n\n',
		]);
		const phases: Array<[string, number | undefined]> = [];
		const result = await runSidecarStartHttp({
			baseUrl: "http://x:8003",
			profile_id: "x",
			onProgress: (p, pct) => phases.push([p, pct]),
			fetchSseImpl,
		});
		expect(result.exit).toBe(0);
		expect(phases.map((x) => x[0])).toEqual([
			"stopping vLLM",
			"loading weights",
			"warmup",
			"ready",
		]);
		// pct only present on loading weights.
		expect(phases[1]![1]).toBe(50);
	});

	test("captures rolled_back envelope on exit-6 frame", async () => {
		const { fetchSseImpl } = makeFakeFetchSse([
			'data: {"phase":"stopping vLLM"}\n\n',
			'data: {"rolled_back":true,"rollback_succeeded":false}\n\n',
			'data: {"exit":6}\n\n',
		]);
		const result = await runSidecarStartHttp({
			baseUrl: "http://x:8003",
			profile_id: "x",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(result.exit).toBe(6);
		expect(result.envelope?.rolled_back).toBe(true);
		expect(result.envelope?.rollback_succeeded).toBe(false);
	});

	test("returns {exit:1} when sidecar unreachable (T-04.2-S5)", async () => {
		const fetchSseImpl: FetchSseImpl = async () => {
			throw new Error("ECONNREFUSED");
		};
		const phases: string[] = [];
		const r = await runSidecarStartHttp({
			baseUrl: "http://x:8003",
			profile_id: "x",
			onProgress: (p) => phases.push(p),
			fetchSseImpl,
		});
		expect(r.exit).toBe(1);
		expect(phases).toEqual([]);
	});

	test("returns {exit:1} on HTTP 5xx", async () => {
		const { fetchSseImpl } = makeFakeFetchHttpError(500);
		const r = await runSidecarStartHttp({
			baseUrl: "http://x:8003",
			profile_id: "x",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(r.exit).toBe(1);
	});

	test("ignores malformed SSE frames (S-3 discipline)", async () => {
		const { fetchSseImpl } = makeFakeFetchSse([
			'data: {"phase":"stopping vLLM"}\n\n',
			"data: not-json\n\n",
			'data: {"phase":"ready"}\n\n',
			'data: {"exit":0}\n\n',
		]);
		const phases: string[] = [];
		const r = await runSidecarStartHttp({
			baseUrl: "http://x:8003",
			profile_id: "x",
			onProgress: (p) => phases.push(p),
			fetchSseImpl,
		});
		expect(r.exit).toBe(0);
		expect(phases).toEqual(["stopping vLLM", "ready"]);
	});
});

describe("runSidecarStopHttp (Plan 04.2-04 Task 2)", () => {
	test("POSTs to ${baseUrl}/stop with {} body", async () => {
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSidecarStopHttp({
			baseUrl: "http://127.0.0.1:8003",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe("http://127.0.0.1:8003/stop");
		expect(JSON.parse(lastUrl.init?.body as string)).toEqual({});
		expect(lastUrl.init?.method).toBe("POST");
	});

	test("strips trailing slash from baseUrl", async () => {
		const { fetchSseImpl, lastUrl } = makeFakeFetchSse([
			'data: {"exit":0}\n\n',
		]);
		await runSidecarStopHttp({
			baseUrl: "http://x:8003/",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(lastUrl.url).toBe("http://x:8003/stop");
	});

	test("surfaces draining sidecar event via onProgress", async () => {
		const { fetchSseImpl } = makeFakeFetchSse([
			'data: {"phase":"draining","details":{"in_flight":2}}\n\n',
			'data: {"phase":"draining","details":{"in_flight":0}}\n\n',
			'data: {"exit":0}\n\n',
		]);
		const phases: string[] = [];
		const r = await runSidecarStopHttp({
			baseUrl: "http://x:8003",
			onProgress: (p) => phases.push(p),
			fetchSseImpl,
		});
		expect(r.exit).toBe(0);
		expect(phases).toContain("draining");
	});

	test("returns {exit:1} on connect refuse (T-04.2-S5)", async () => {
		const fetchSseImpl: FetchSseImpl = async () => {
			throw new Error("ECONNREFUSED");
		};
		const r = await runSidecarStopHttp({
			baseUrl: "http://x:8003",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(r.exit).toBe(1);
	});

	test("returns {exit:1} on HTTP 5xx", async () => {
		const { fetchSseImpl } = makeFakeFetchHttpError(500);
		const r = await runSidecarStopHttp({
			baseUrl: "http://x:8003",
			onProgress: () => {},
			fetchSseImpl,
		});
		expect(r.exit).toBe(1);
	});
});
