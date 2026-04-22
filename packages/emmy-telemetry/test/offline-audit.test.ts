// packages/emmy-telemetry/test/offline-audit.test.ts
//
// Plan 03-06 Task 1 (RED) — offline-audit pure functions.
//
// Tests for auditToolRegistry (tool-host-set vs union(loopback, allowlist)
// boot-time audit) and auditWebFetchUrl (runtime hostname-exact allowlist
// enforcement with CNAME-bypass and SSRF guards).
//
// D-26 VERBATIM: LOOPBACK_HOSTS has FOUR entries — 127.0.0.1, localhost, ::1,
// loopback. 0.0.0.0 is EXCLUDED because it is semantically bind-all, NOT
// loopback. Plan-checker WARNING guard.
//
// Threat register alignment:
//   T-03-06-01 — CNAME bypass (docs.python.org.evil.com) → blocked (hostname-exact)
//   T-03-06-02 — URL credentials bypass (https://docs.python.org@evil.com) → blocked
//                (new URL().hostname returns `evil.com`, not `docs.python.org`)
//   T-03-06-03 — Loopback SSRF accepted by design (D-26); 0.0.0.0 NOT accepted

import { describe, expect, test } from "bun:test";
import {
	auditToolRegistry,
	auditWebFetchUrl,
	LOOPBACK_HOSTS,
	type EmmyToolRegistration,
	type OfflineAuditResult,
} from "../src/offline-audit";

describe("auditToolRegistry — boot-time tool host-set audit", () => {
	test("all-local tools with no allowlist → green", () => {
		const tools: EmmyToolRegistration[] = [
			{ name: "read", required_hosts: [] },
			{ name: "web_fetch", required_hosts: [] },
		];
		const result = auditToolRegistry(tools, []);
		expect(result.offline_ok).toBe(true);
		expect(result.violating_tool).toBeNull();
		expect(result.violating_host).toBeNull();
	});

	test("tool with non-allowlisted host → red", () => {
		const tools: EmmyToolRegistration[] = [
			{ name: "read", required_hosts: [] },
			{ name: "custom_api", required_hosts: ["api.openai.com"] },
		];
		const result = auditToolRegistry(tools, []);
		expect(result.offline_ok).toBe(false);
		expect(result.violating_tool).toBe("custom_api");
		expect(result.violating_host).toBe("api.openai.com");
	});

	test("tool host in allowlist → green", () => {
		const tools: EmmyToolRegistration[] = [
			{ name: "custom_api", required_hosts: ["api.openai.com"] },
		];
		const result = auditToolRegistry(tools, ["api.openai.com"]);
		expect(result.offline_ok).toBe(true);
		expect(result.violating_tool).toBeNull();
		expect(result.violating_host).toBeNull();
	});

	test("loopback aliases unconditionally permitted without allowlist", () => {
		for (const host of ["127.0.0.1", "localhost", "::1", "loopback"]) {
			const tools: EmmyToolRegistration[] = [
				{ name: `t_${host}`, required_hosts: [host] },
			];
			const result = auditToolRegistry(tools, []);
			expect(result.offline_ok).toBe(true);
		}
	});

	test("0.0.0.0 is NOT loopback (bind-all per D-26 verbatim; plan-checker WARNING)", () => {
		const tools: EmmyToolRegistration[] = [
			{ name: "bind_all_tool", required_hosts: ["0.0.0.0"] },
		];
		const result = auditToolRegistry(tools, []);
		expect(result.offline_ok).toBe(false);
		expect(result.violating_host).toBe("0.0.0.0");
	});

	test("returns first violating tool + host (order-stable)", () => {
		const tools: EmmyToolRegistration[] = [
			{ name: "ok", required_hosts: [] },
			{ name: "bad_a", required_hosts: ["a.example.com"] },
			{ name: "bad_b", required_hosts: ["b.example.com"] },
		];
		const result = auditToolRegistry(tools, []);
		expect(result.violating_tool).toBe("bad_a");
		expect(result.violating_host).toBe("a.example.com");
	});

	test("tool with multiple hosts — first offending host reported", () => {
		const tools: EmmyToolRegistration[] = [
			{ name: "multi", required_hosts: ["docs.python.org", "evil.example.com"] },
		];
		const result = auditToolRegistry(tools, ["docs.python.org"]);
		expect(result.offline_ok).toBe(false);
		expect(result.violating_tool).toBe("multi");
		expect(result.violating_host).toBe("evil.example.com");
	});
});

describe("LOOPBACK_HOSTS — D-26 verbatim (4 entries, 0.0.0.0 EXCLUDED)", () => {
	test("exactly 4 entries", () => {
		expect(LOOPBACK_HOSTS.size).toBe(4);
	});

	test("contains the 4 canonical loopback aliases", () => {
		expect(LOOPBACK_HOSTS.has("127.0.0.1")).toBe(true);
		expect(LOOPBACK_HOSTS.has("localhost")).toBe(true);
		expect(LOOPBACK_HOSTS.has("::1")).toBe(true);
		expect(LOOPBACK_HOSTS.has("loopback")).toBe(true);
	});

	test("does NOT contain 0.0.0.0 (plan-checker WARNING guard)", () => {
		expect(LOOPBACK_HOSTS.has("0.0.0.0")).toBe(false);
	});
});

describe("auditWebFetchUrl — runtime hostname-exact enforcement", () => {
	test("allowlisted host — exact match returns true", () => {
		expect(auditWebFetchUrl("https://docs.python.org/3/", ["docs.python.org"])).toBe(true);
	});

	test("non-allowlisted host returns false", () => {
		expect(auditWebFetchUrl("https://evil.example.com/", ["docs.python.org"])).toBe(false);
	});

	test("hostname-exact, not suffix-match (prevents CNAME bypass)", () => {
		// T-03-06-01 threat — suffix-attack via docs.python.org.evil.com
		expect(
			auditWebFetchUrl("https://docs.python.org.evil.com/", ["docs.python.org"]),
		).toBe(false);
		// Sub-domain of allowlisted host — not listed, so blocked.
		expect(auditWebFetchUrl("https://sub.docs.python.org/", ["docs.python.org"])).toBe(false);
		// Base path on the exact host — allowed.
		expect(auditWebFetchUrl("https://docs.python.org/3/", ["docs.python.org"])).toBe(true);
	});

	test("URL credentials bypass — new URL().hostname strips auth component", () => {
		// T-03-06-02: `https://docs.python.org@evil.com/` parses as hostname=evil.com
		expect(
			auditWebFetchUrl("https://docs.python.org@evil.com/", ["docs.python.org"]),
		).toBe(false);
	});

	test("loopback hosts unconditionally ok (D-26); 0.0.0.0 NOT loopback-trumped", () => {
		// Loopback (127.0.0.1/localhost/::1/loopback) is unconditionally OK per D-26.
		// 0.0.0.0 is bind-all and is NOT in loopback_set — plan-checker WARNING guard.
		expect(auditWebFetchUrl("http://127.0.0.1:22/", [])).toBe(true);
		expect(auditWebFetchUrl("http://localhost:8002/", [])).toBe(true);
		// IPv6 loopback literal — Node URL parses hostname without brackets.
		expect(auditWebFetchUrl("http://[::1]:22/", [])).toBe(true);
		expect(auditWebFetchUrl("http://0.0.0.0:22/", [])).toBe(false); // bind-all, not loopback
	});

	test("loopback ok even with non-empty allowlist that doesn't list it", () => {
		expect(auditWebFetchUrl("http://127.0.0.1:8002/", ["docs.python.org"])).toBe(true);
	});

	test("malformed URL throws (not silently passes)", () => {
		expect(() => auditWebFetchUrl("not a url", [])).toThrow();
		expect(() => auditWebFetchUrl("", [])).toThrow();
	});

	test("empty allowlist blocks all non-loopback URLs (default-deny)", () => {
		expect(auditWebFetchUrl("https://docs.python.org/", [])).toBe(false);
		expect(auditWebFetchUrl("https://huggingface.co/", [])).toBe(false);
	});

	test("multi-host allowlist — only listed hosts pass", () => {
		const allow = ["docs.python.org", "developer.mozilla.org", "huggingface.co"];
		expect(auditWebFetchUrl("https://docs.python.org/", allow)).toBe(true);
		expect(auditWebFetchUrl("https://developer.mozilla.org/", allow)).toBe(true);
		expect(auditWebFetchUrl("https://huggingface.co/", allow)).toBe(true);
		expect(auditWebFetchUrl("https://api.openai.com/", allow)).toBe(false);
	});

	test("type is OfflineAuditResult — compile-time shape guard", () => {
		const r: OfflineAuditResult = {
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
		};
		expect(r.offline_ok).toBe(true);
	});
});
