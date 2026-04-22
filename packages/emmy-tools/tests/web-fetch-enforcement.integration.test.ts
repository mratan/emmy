// packages/emmy-tools/tests/web-fetch-enforcement.integration.test.ts
//
// Plan 03-06 Task 1 (RED) — web_fetch runtime allowlist enforcement.
//
// Validates per-call hostname-exact allowlist enforcement (D-27) with
// warn-and-continue semantics (D-28): non-allowlisted URL returns a
// ToolError-shaped result + fires onViolation; session continues.
//
// Uses a Bun.serve() mock backed by the default `webFetch` implementation
// so we exercise the full enforcement path (enforceWebFetchAllowlist →
// webFetch) without real internet egress.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
	enforceWebFetchAllowlist,
	WebFetchAllowlistError,
} from "../src/web-fetch-allowlist";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/docs") {
				return new Response("# Hello\n\nDocumentation body.\n", {
					headers: { "content-type": "text/markdown" },
				});
			}
			return new Response("not found", { status: 404 });
		},
	});
	baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

const PROFILE_REF = { id: "test", version: "v1", hash: "sha256:deadbeef" };

describe("enforceWebFetchAllowlist — hostname-exact + loopback + violation callback", () => {
	test("allowlisted URL passes without throwing; onViolation NOT called", () => {
		let called = 0;
		enforceWebFetchAllowlist("https://docs.python.org/3/", {
			allowlist: ["docs.python.org"],
			profileRef: PROFILE_REF,
			onViolation: () => {
				called++;
			},
		});
		expect(called).toBe(0);
	});

	test("loopback URL passes without throwing even when allowlist is empty", () => {
		let called = 0;
		enforceWebFetchAllowlist(`${baseUrl}/docs`, {
			allowlist: [],
			profileRef: PROFILE_REF,
			onViolation: () => {
				called++;
			},
		});
		expect(called).toBe(0);
	});

	test("non-allowlisted URL throws WebFetchAllowlistError + fires onViolation", () => {
		let callCount = 0;
		let lastDetails: { url: string; hostname: string } | null = null;
		let caught: unknown;
		try {
			enforceWebFetchAllowlist("https://evil.example.com/steal", {
				allowlist: ["docs.python.org"],
				profileRef: PROFILE_REF,
				onViolation: (d) => {
					callCount++;
					lastDetails = d;
				},
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
		expect((caught as WebFetchAllowlistError).hostname).toBe("evil.example.com");
		expect((caught as WebFetchAllowlistError).url).toBe("https://evil.example.com/steal");
		expect(callCount).toBe(1);
		expect(lastDetails).toEqual({
			url: "https://evil.example.com/steal",
			hostname: "evil.example.com",
		});
	});

	test("empty allowlist + non-loopback URL → throws (default-deny)", () => {
		let caught: unknown;
		try {
			enforceWebFetchAllowlist("https://docs.python.org/", {
				allowlist: [],
				profileRef: PROFILE_REF,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
	});

	test("CNAME-bypass URL blocked (hostname-exact, not suffix match)", () => {
		let caught: unknown;
		try {
			enforceWebFetchAllowlist("https://docs.python.org.evil.com/", {
				allowlist: ["docs.python.org"],
				profileRef: PROFILE_REF,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
		expect((caught as WebFetchAllowlistError).hostname).toBe("docs.python.org.evil.com");
	});

	test("onViolation is optional — throws without throwing TypeError when absent", () => {
		let caught: unknown;
		try {
			enforceWebFetchAllowlist("https://evil.example.com/", {
				allowlist: [],
				profileRef: PROFILE_REF,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
	});

	test("WebFetchAllowlistError.message contains host + URL for diagnosability", () => {
		let caught: unknown;
		try {
			enforceWebFetchAllowlist("https://evil.example.com/api", {
				allowlist: [],
				profileRef: PROFILE_REF,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
		const msg = (caught as WebFetchAllowlistError).message;
		expect(msg).toContain("evil.example.com");
		expect(msg).toContain("allowlist");
	});
});

describe("web_fetch tool — wrapper integration (D-28 warn-and-continue)", () => {
	test("when called with non-allowlisted URL, returns ToolError-shaped result (NOT throw)", async () => {
		// Simulate the tool-level wrapper that pi's createAgentSession dispatches
		// to: allowlist pre-check → webFetch → return result. On allowlist miss,
		// per D-28 warn-and-continue, the tool returns a structured error object
		// so pi's agent loop surfaces the error text and CONTINUES.
		const { webFetchWithAllowlist } = await import("../src/web-fetch");
		const result = await webFetchWithAllowlist("https://evil.example.com/steal", {
			allowlist: [],
			profileRef: PROFILE_REF,
		});
		expect(result.isError).toBe(true);
		// Content array with text entry containing the rejection + remediation
		expect(Array.isArray(result.content)).toBe(true);
		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text.toLowerCase()).toContain("evil.example.com");
		expect(text).toContain("allowlist");
	});

	test("when called with allowlisted URL, dispatches webFetch and returns markdown", async () => {
		const { webFetchWithAllowlist } = await import("../src/web-fetch");
		// Use loopback (always ok) to avoid needing a live allowlist entry —
		// local Bun.serve() base URL is 127.0.0.1:<port>, which is LOOPBACK_HOSTS member.
		const result = await webFetchWithAllowlist(`${baseUrl}/docs`, {
			allowlist: [],
			profileRef: PROFILE_REF,
		});
		expect(result.isError).toBeFalsy();
		expect(typeof result.markdown).toBe("string");
		expect(result.markdown).toContain("Hello");
	});
});
