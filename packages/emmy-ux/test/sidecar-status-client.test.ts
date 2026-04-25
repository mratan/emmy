// packages/emmy-ux/test/sidecar-status-client.test.ts
//
// Plan 04.2-04 Task 1 — Bun unit tests for getSidecarStatus.
//
// Strategy: Bun.serve() runs a real HTTP listener on a random port, returns
// canned JSON / error / never-respond bodies. Tests assert:
//   - Returns parsed SidecarStatus shape (D-07 schema mirror of Plan 01
//     controller.py StatusResponse Pydantic model)
//   - Throws Error containing status code on non-2xx
//   - Trailing-slash strip on baseUrl (`/` → no `//status`)
//   - AbortController fires after timeoutMs (no hang)
//   - 404 throws with status code in error message

import { afterAll, describe, expect, test } from "bun:test";
import {
	getSidecarStatus,
	type SidecarStatus,
} from "../src/sidecar-status-client";

// Canonical D-07 status sample mirroring Plan 01 controller.py StatusResponse
// (the source of truth — TS interface MUST match field-by-field).
const D07_READY_SAMPLE: SidecarStatus = {
	state: "ready",
	profile_id: "qwen3.6-35b-a3b",
	profile_variant: "v3.1-default",
	profile_hash:
		"a".repeat(64),
	vllm_up: true,
	vllm_pid: 12345,
	container_digest: "sha256:0123456789abcdef",
	kv_used_pct: 0.34,
	gpu_temp_c: 64.2,
	in_flight: 2,
	last_error: null,
};

const D07_STOPPED_SAMPLE: SidecarStatus = {
	state: "stopped",
	profile_id: null,
	profile_variant: null,
	profile_hash: null,
	vllm_up: false,
	vllm_pid: null,
	container_digest: null,
	kv_used_pct: null,
	gpu_temp_c: null,
	in_flight: null,
	last_error: null,
};

// Track all servers started so afterAll can stop them (avoid port leaks).
const _servers: Array<{ stop: () => void }> = [];

function startServer(handler: (req: Request) => Response | Promise<Response>): {
	url: string;
	stop: () => void;
} {
	const server = Bun.serve({
		port: 0, // OS-assigned
		fetch: handler,
	});
	const stop = () => {
		try {
			server.stop(true);
		} catch {
			/* ignore */
		}
	};
	_servers.push({ stop });
	return { url: `http://127.0.0.1:${server.port}`, stop };
}

afterAll(() => {
	for (const s of _servers) s.stop();
});

describe("getSidecarStatus (Plan 04.2-04 Task 1)", () => {
	test("returns parsed SidecarStatus with all D-07 fields populated (ready)", async () => {
		const { url, stop } = startServer((req) => {
			const path = new URL(req.url).pathname;
			if (path !== "/status") return new Response("not found", { status: 404 });
			return Response.json(D07_READY_SAMPLE);
		});
		try {
			const status = await getSidecarStatus(url);
			expect(status).toEqual(D07_READY_SAMPLE);
			// Spot-check key fields.
			expect(status.state).toBe("ready");
			expect(status.profile_id).toBe("qwen3.6-35b-a3b");
			expect(status.profile_variant).toBe("v3.1-default");
			expect(status.vllm_up).toBe(true);
			expect(status.kv_used_pct).toBe(0.34);
			expect(status.gpu_temp_c).toBe(64.2);
			expect(status.in_flight).toBe(2);
			expect(status.last_error).toBeNull();
		} finally {
			stop();
		}
	});

	test("returns parsed SidecarStatus with null fields (stopped)", async () => {
		const { url, stop } = startServer(() => Response.json(D07_STOPPED_SAMPLE));
		try {
			const status = await getSidecarStatus(url);
			expect(status.state).toBe("stopped");
			expect(status.vllm_up).toBe(false);
			expect(status.profile_id).toBeNull();
			expect(status.profile_variant).toBeNull();
			expect(status.kv_used_pct).toBeNull();
			expect(status.gpu_temp_c).toBeNull();
			expect(status.in_flight).toBeNull();
		} finally {
			stop();
		}
	});

	test("throws Error containing status code on 500", async () => {
		const { url, stop } = startServer(
			() => new Response("boom", { status: 500 }),
		);
		try {
			await expect(getSidecarStatus(url)).rejects.toThrow(/500/);
		} finally {
			stop();
		}
	});

	test("throws Error containing status code on 404", async () => {
		const { url, stop } = startServer(
			() => new Response("not found", { status: 404 }),
		);
		try {
			await expect(getSidecarStatus(url)).rejects.toThrow(/404/);
		} finally {
			stop();
		}
	});

	test("strips trailing slash from baseUrl (no //status)", async () => {
		let observedPath: string | null = null;
		const { url, stop } = startServer((req) => {
			observedPath = new URL(req.url).pathname;
			if (observedPath !== "/status") {
				return new Response("wrong path", { status: 404 });
			}
			return Response.json(D07_STOPPED_SAMPLE);
		});
		try {
			await getSidecarStatus(`${url}/`);
			expect(observedPath).toBe("/status");
			// Belt-and-suspenders: never `//status`.
			expect(observedPath).not.toContain("//");
		} finally {
			stop();
		}
	});

	test("aborts after timeoutMs when server hangs", async () => {
		// Server that never responds — defers indefinitely.
		const { url, stop } = startServer(
			() =>
				new Promise<Response>(() => {
					// never resolve
				}),
		);
		try {
			const t0 = Date.now();
			await expect(getSidecarStatus(url, 100)).rejects.toThrow();
			const elapsed = Date.now() - t0;
			// Should abort well under 1s — generous bound for slow CI.
			expect(elapsed).toBeLessThan(1500);
		} finally {
			stop();
		}
	});
});
