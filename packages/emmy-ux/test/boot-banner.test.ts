// packages/emmy-ux/test/boot-banner.test.ts
//
// Plan 03-06 Task 1 (RED) — boot-time banner emits OFFLINE OK (green) or
// NETWORK USED (red) to stderr at session start.
//
// Integration-level: we exercise the audit pipeline that session.ts runs right
// after tool registration. Rather than stand up a full createEmmySession path
// (heavy, needs live emmy-serve), we call the pure boot-audit helper
// `runBootOfflineAudit` that session.ts will delegate to, and capture its
// emitted stderr banner + the OfflineAuditResult it produces.

import { describe, expect, test } from "bun:test";

import { runBootOfflineAudit } from "../src/offline-badge";

describe("boot banner — runBootOfflineAudit pure helper", () => {
	test("green boot: all-local native tools + empty allowlist → stderr contains 'OFFLINE OK'", () => {
		const stderrLines: string[] = [];
		const result = runBootOfflineAudit({
			toolRegistrations: [
				{ name: "read", required_hosts: [] },
				{ name: "write", required_hosts: [] },
				{ name: "edit", required_hosts: [] },
				{ name: "bash", required_hosts: [] },
				{ name: "grep", required_hosts: [] },
				{ name: "find", required_hosts: [] },
				{ name: "ls", required_hosts: [] },
				{ name: "web_fetch", required_hosts: [] },
			],
			allowlist: [],
			stderr: (line) => stderrLines.push(line),
		});
		expect(result.offline_ok).toBe(true);
		expect(stderrLines.some((l) => l.includes("OFFLINE OK"))).toBe(true);
		expect(stderrLines.some((l) => l.includes("NETWORK USED"))).toBe(false);
	});

	test("red boot: fake tool declaring api.notlocal.com → stderr contains 'NETWORK USED' + tool name + host", () => {
		const stderrLines: string[] = [];
		const result = runBootOfflineAudit({
			toolRegistrations: [
				{ name: "read", required_hosts: [] },
				{ name: "fake_cloud_tool", required_hosts: ["api.notlocal.com"] },
			],
			allowlist: [],
			stderr: (line) => stderrLines.push(line),
		});
		expect(result.offline_ok).toBe(false);
		expect(result.violating_tool).toBe("fake_cloud_tool");
		expect(result.violating_host).toBe("api.notlocal.com");
		const combined = stderrLines.join("\n");
		expect(combined).toContain("NETWORK USED");
		expect(combined).toContain("fake_cloud_tool");
		expect(combined).toContain("api.notlocal.com");
	});

	test("allowlist applied: api.notlocal.com in allowlist → green", () => {
		const stderrLines: string[] = [];
		const result = runBootOfflineAudit({
			toolRegistrations: [
				{ name: "read", required_hosts: [] },
				{ name: "docs_tool", required_hosts: ["api.notlocal.com"] },
			],
			allowlist: ["api.notlocal.com"],
			stderr: (line) => stderrLines.push(line),
		});
		expect(result.offline_ok).toBe(true);
		expect(stderrLines.some((l) => l.includes("OFFLINE OK"))).toBe(true);
	});

	test("ANSI color in banner matches state (green for ok, red for violation)", () => {
		const greenLines: string[] = [];
		runBootOfflineAudit({
			toolRegistrations: [{ name: "read", required_hosts: [] }],
			allowlist: [],
			stderr: (line) => greenLines.push(line),
		});
		expect(greenLines.join("\n")).toContain("\x1b[32m"); // green

		const redLines: string[] = [];
		runBootOfflineAudit({
			toolRegistrations: [{ name: "bad", required_hosts: ["api.bad.com"] }],
			allowlist: [],
			stderr: (line) => redLines.push(line),
		});
		expect(redLines.join("\n")).toContain("\x1b[31m"); // red
	});

	test("banner line is prefixed with '[emmy]' for grep-friendly discovery", () => {
		const lines: string[] = [];
		runBootOfflineAudit({
			toolRegistrations: [{ name: "read", required_hosts: [] }],
			allowlist: [],
			stderr: (line) => lines.push(line),
		});
		expect(lines.some((l) => l.includes("[emmy]"))).toBe(true);
	});
});
