// packages/emmy-ux/test/pi-emmy-prereq.test.ts
//
// Phase 04.2 follow-up — pi-emmy boot probe sidecar-aware in remote-client mode.
//
// Why: Plan 04.2-04 added the sidecar as the always-on control plane in
// remote-client mode, but pi-emmy.ts kept its Phase-2-era boot probe that
// hits vLLM /v1/models directly. When the operator stops vLLM externally
// (e.g. `docker stop emmy-serve` to hand lifecycle ownership to the sidecar),
// the next `emmy` launch dies with "cannot reach emmy-serve at <baseUrl>:
// status 502" because Tailscale Serve proxies a 502 from the dead vLLM.
// User has no path back into the TUI where /start would resurrect vLLM.
//
// Fix (this test pins it): resolvePrereqProbe() picks the sidecar /healthz
// when EMMY_REMOTE_CLIENT=1 + EMMY_SERVE_URL set, otherwise falls back to
// the legacy vLLM probe. Test assertions:
//   1. local mode (no env) → vllm probe with baseUrl
//   2. remote-client mode → sidecar probe with EMMY_SERVE_URL
//   3. remote-client mode without EMMY_SERVE_URL → falls back to vllm probe
//      (defensive — defaulting to localhost sidecar would be wrong on a Mac)
//   4. EMMY_REMOTE_CLIENT="0"/"true"/"yes" → still falls back to vllm probe
//      (literal-"1" check matches the discipline in Plan 04.2-03's dispatcher
//      and Plan 04.2-04's metrics-poller)
//
// S-2 env-restore per PATTERNS.md §Group C.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolvePrereqProbe } from "../bin/pi-emmy";

describe("resolvePrereqProbe (sidecar vs vLLM precedence)", () => {
	let oldRemote: string | undefined;
	let oldServe: string | undefined;

	beforeEach(() => {
		oldRemote = process.env.EMMY_REMOTE_CLIENT;
		oldServe = process.env.EMMY_SERVE_URL;
	});
	afterEach(() => {
		if (oldRemote === undefined) delete process.env.EMMY_REMOTE_CLIENT;
		else process.env.EMMY_REMOTE_CLIENT = oldRemote;
		if (oldServe === undefined) delete process.env.EMMY_SERVE_URL;
		else process.env.EMMY_SERVE_URL = oldServe;
	});

	test("local mode (no env) → vllm probe with baseUrl", () => {
		delete process.env.EMMY_REMOTE_CLIENT;
		delete process.env.EMMY_SERVE_URL;
		const got = resolvePrereqProbe({ baseUrl: "http://127.0.0.1:8002" });
		expect(got.kind).toBe("vllm");
		expect(got.target).toBe("http://127.0.0.1:8002");
	});

	test("EMMY_REMOTE_CLIENT=1 + EMMY_SERVE_URL set → sidecar probe", () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		process.env.EMMY_SERVE_URL = "https://spark.example.ts.net:8003";
		const got = resolvePrereqProbe({ baseUrl: "https://spark.example.ts.net" });
		expect(got.kind).toBe("sidecar");
		expect(got.target).toBe("https://spark.example.ts.net:8003");
	});

	test("EMMY_REMOTE_CLIENT=1 but EMMY_SERVE_URL unset → falls back to vllm probe", () => {
		// Defensive: silently defaulting to http://127.0.0.1:8003 would point
		// at localhost on a Mac (nothing there) and waste 5s on each launch.
		// Better to fall through to the vLLM probe — at least that surfaces
		// a useful error message.
		process.env.EMMY_REMOTE_CLIENT = "1";
		delete process.env.EMMY_SERVE_URL;
		const got = resolvePrereqProbe({ baseUrl: "https://spark.example.ts.net" });
		expect(got.kind).toBe("vllm");
		expect(got.target).toBe("https://spark.example.ts.net");
	});

	test("EMMY_REMOTE_CLIENT=1 but EMMY_SERVE_URL='' (empty) → falls back to vllm probe", () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		process.env.EMMY_SERVE_URL = "";
		const got = resolvePrereqProbe({ baseUrl: "https://spark.example.ts.net" });
		expect(got.kind).toBe("vllm");
	});

	test.each([["0"], ["true"], ["yes"], ["TRUE"]])(
		"EMMY_REMOTE_CLIENT=%p (non-literal-1) → falls back to vllm probe (matches Plan 04.2-03 dispatcher discipline)",
		(value) => {
			process.env.EMMY_REMOTE_CLIENT = value;
			process.env.EMMY_SERVE_URL = "https://spark.example.ts.net:8003";
			const got = resolvePrereqProbe({ baseUrl: "https://spark.example.ts.net" });
			expect(got.kind).toBe("vllm");
		},
	);
});

describe("probeSidecar / probeVllm wire behavior (smoke)", () => {
	// Lightweight smoke that the .probe() callable actually fetches a URL
	// shaped correctly for each kind. We use Bun.serve to capture the request
	// path on each kind without faking fetch() — same pattern as
	// web-search-env-override.test.ts.

	let oldRemote: string | undefined;
	let oldServe: string | undefined;

	beforeEach(() => {
		oldRemote = process.env.EMMY_REMOTE_CLIENT;
		oldServe = process.env.EMMY_SERVE_URL;
	});
	afterEach(() => {
		if (oldRemote === undefined) delete process.env.EMMY_REMOTE_CLIENT;
		else process.env.EMMY_REMOTE_CLIENT = oldRemote;
		if (oldServe === undefined) delete process.env.EMMY_SERVE_URL;
		else process.env.EMMY_SERVE_URL = oldServe;
	});

	test("vllm probe hits /v1/models", async () => {
		let receivedPath = "";
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				receivedPath = new URL(req.url).pathname;
				return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
			},
		});
		try {
			delete process.env.EMMY_REMOTE_CLIENT;
			delete process.env.EMMY_SERVE_URL;
			const got = resolvePrereqProbe({ baseUrl: `http://127.0.0.1:${server.port}` });
			await got.probe();
			expect(got.kind).toBe("vllm");
			expect(receivedPath).toBe("/v1/models");
		} finally {
			server.stop(true);
		}
	});

	test("sidecar probe hits /healthz", async () => {
		let receivedPath = "";
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				receivedPath = new URL(req.url).pathname;
				return new Response('{"ok":true}', {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});
		try {
			process.env.EMMY_REMOTE_CLIENT = "1";
			process.env.EMMY_SERVE_URL = `http://127.0.0.1:${server.port}`;
			const got = resolvePrereqProbe({ baseUrl: "http://unused" });
			await got.probe();
			expect(got.kind).toBe("sidecar");
			expect(receivedPath).toBe("/healthz");
		} finally {
			server.stop(true);
		}
	});

	test("trailing slash on EMMY_SERVE_URL is stripped before /healthz join", async () => {
		let receivedPath = "";
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				receivedPath = new URL(req.url).pathname;
				return new Response('{"ok":true}', { status: 200 });
			},
		});
		try {
			process.env.EMMY_REMOTE_CLIENT = "1";
			process.env.EMMY_SERVE_URL = `http://127.0.0.1:${server.port}/`;
			const got = resolvePrereqProbe({ baseUrl: "http://unused" });
			await got.probe();
			expect(receivedPath).toBe("/healthz");
		} finally {
			server.stop(true);
		}
	});

	test("sidecar probe rejects on non-2xx (so caller can produce sidecar-specific error)", async () => {
		const server = Bun.serve({
			port: 0,
			async fetch() {
				return new Response("nope", { status: 503 });
			},
		});
		try {
			process.env.EMMY_REMOTE_CLIENT = "1";
			process.env.EMMY_SERVE_URL = `http://127.0.0.1:${server.port}`;
			const got = resolvePrereqProbe({ baseUrl: "http://unused" });
			await expect(got.probe()).rejects.toThrow(/status 503/);
		} finally {
			server.stop(true);
		}
	});
});
