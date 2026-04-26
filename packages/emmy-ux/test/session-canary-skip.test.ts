// packages/emmy-ux/test/session-canary-skip.test.ts
//
// Phase 04.2 follow-up — SP_OK canary is SKIPPED when remote-client mode is
// on AND the sidecar reports vllm_up=false. This test exercises the new
// branch added in createEmmySession() before the canary fires.
//
// Why we even have this branch: the canary is a Pitfall #6 system-prompt-
// delivery probe (CLAUDE.md), not a vLLM-aliveness check. When vLLM is down,
// running the canary against /v1/chat/completions surfaces a misleading
// "ERROR (runtime): provider.network 502" instead of letting the user into
// the TUI to /start vLLM. The prereq probe upstream owns vLLM-aliveness
// (resolvePrereqProbe in pi-emmy.ts); the canary should defer to it.
//
// We can't easily exercise createEmmySession end-to-end in a unit test
// (it spins up the whole pi runtime). Instead this test mocks the sidecar
// /status endpoint via Bun.serve, sets EMMY_REMOTE_CLIENT + EMMY_SERVE_URL,
// and asserts the inline branch behavior — by exercising the same
// {fetch /status, parse vllm_up, decide to skip} logic shape.
//
// Three cases:
//   1. EMMY_REMOTE_CLIENT=1 + sidecar reports vllm_up=false → skip
//   2. EMMY_REMOTE_CLIENT=1 + sidecar reports vllm_up=true  → run canary
//   3. EMMY_REMOTE_CLIENT unset                              → run canary
//
// S-2 env restore per PATTERNS.md §Group C.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

interface SidecarStatusLite {
	vllm_up?: boolean;
}

/**
 * Mirrors the inline canary-skip decision logic in createEmmySession().
 * Extracted here so we can pin the behavior independently of the rest of
 * the session-bootstrap surface. Production code makes the same fetch
 * directly inline (no shared helper) because it's a 5-line gate; this test
 * helper is structurally identical.
 */
async function shouldSkipCanary(): Promise<boolean> {
	if (process.env.EMMY_REMOTE_CLIENT !== "1") return false;
	const sidecarUrl = process.env.EMMY_SERVE_URL;
	if (!sidecarUrl || sidecarUrl.length === 0) return false;
	try {
		const r = await fetch(`${sidecarUrl.replace(/\/$/, "")}/status`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!r.ok) return false;
		const status = (await r.json()) as SidecarStatusLite;
		return status.vllm_up === false;
	} catch {
		return false;
	}
}

describe("SP_OK canary skip decision (remote-client mode + sidecar vllm_up gate)", () => {
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

	test("EMMY_REMOTE_CLIENT unset → never skip (legacy local-mode behavior preserved)", async () => {
		delete process.env.EMMY_REMOTE_CLIENT;
		process.env.EMMY_SERVE_URL = "http://127.0.0.1:9999"; // unreachable; should not even probe
		expect(await shouldSkipCanary()).toBe(false);
	});

	test("remote-client mode + sidecar reports vllm_up=true → run canary", async () => {
		const server = Bun.serve({
			port: 0,
			async fetch() {
				return new Response('{"state":"ready","vllm_up":true}', {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});
		try {
			process.env.EMMY_REMOTE_CLIENT = "1";
			process.env.EMMY_SERVE_URL = `http://127.0.0.1:${server.port}`;
			expect(await shouldSkipCanary()).toBe(false);
		} finally {
			server.stop(true);
		}
	});

	test("remote-client mode + sidecar reports vllm_up=false → SKIP canary (the fix)", async () => {
		const server = Bun.serve({
			port: 0,
			async fetch() {
				return new Response('{"state":"stopped","vllm_up":false}', {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});
		try {
			process.env.EMMY_REMOTE_CLIENT = "1";
			process.env.EMMY_SERVE_URL = `http://127.0.0.1:${server.port}`;
			expect(await shouldSkipCanary()).toBe(true);
		} finally {
			server.stop(true);
		}
	});

	test("remote-client mode + sidecar /status returns 5xx → run canary (don't mask sidecar errors)", async () => {
		const server = Bun.serve({
			port: 0,
			async fetch() {
				return new Response("kaboom", { status: 503 });
			},
		});
		try {
			process.env.EMMY_REMOTE_CLIENT = "1";
			process.env.EMMY_SERVE_URL = `http://127.0.0.1:${server.port}`;
			expect(await shouldSkipCanary()).toBe(false);
		} finally {
			server.stop(true);
		}
	});

	test("remote-client mode + sidecar unreachable (network error) → run canary (the canary's network error will surface the real issue)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		process.env.EMMY_SERVE_URL = "http://127.0.0.1:1"; // port 1 is reserved → instant ECONNREFUSED
		expect(await shouldSkipCanary()).toBe(false);
	});

	test("remote-client mode + EMMY_SERVE_URL unset → run canary (no sidecar to consult)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		delete process.env.EMMY_SERVE_URL;
		expect(await shouldSkipCanary()).toBe(false);
	});

	test("EMMY_REMOTE_CLIENT='0' (non-literal-1) → never skip (matches dispatcher discipline)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "0";
		process.env.EMMY_SERVE_URL = "http://127.0.0.1:9999";
		expect(await shouldSkipCanary()).toBe(false);
	});
});
