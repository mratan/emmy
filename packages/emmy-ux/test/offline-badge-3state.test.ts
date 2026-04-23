// packages/emmy-ux/test/offline-badge-3state.test.ts
//
// Plan 03.1-02 Task 2 (RED) — D-36 three-state badge: green OFFLINE OK /
// yellow LOCAL LLM · WEB / red CLOUD INFERENCE (reserved).
//
// Covers:
//   - renderBadge with badge_state:"yellow" emits "LOCAL LLM · WEB" + ANSI yellow
//   - renderBadge with badge_state:"green" emits "OFFLINE OK" + ANSI green
//   - renderBadge with badge_state:"red" emits the reserved violation text
//   - flipToYellow / flipToGreen update module-level state and re-render
//   - backward-compat: passing legacy OfflineAuditResult WITHOUT badge_state
//     still renders green/red based on offline_ok.

import { beforeEach, describe, expect, test } from "bun:test";

import {
	__resetBadgeStateForTests,
	bindBadge,
	flipToGreen,
	flipToYellow,
	flipToViolation,
	renderBadge,
	renderBadgePlain,
	setInitialAudit,
} from "../src/offline-badge";

beforeEach(() => {
	__resetBadgeStateForTests();
});

describe("renderBadge — 3-state ANSI rendering", () => {
	test("green badge (SearxNG off/disabled) — OFFLINE OK with ANSI green", () => {
		const out = renderBadge({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
			badge_state: "green",
		});
		expect(out).toContain("OFFLINE OK");
		expect(out).toContain("\x1b[32m");
		expect(out).toContain("\x1b[0m");
	});

	test("yellow badge — LOCAL LLM · WEB with ANSI yellow (ESC[33m)", () => {
		const out = renderBadge({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
			badge_state: "yellow",
			reason: "searxng up",
		});
		expect(out).toContain("LOCAL LLM · WEB");
		expect(out).toContain("\x1b[33m");
		expect(out).toContain("\x1b[0m");
		// Must NOT say "OFFLINE OK" in yellow mode
		expect(out).not.toContain("OFFLINE OK");
	});

	test("red badge (reserved for non-loopback inference) — CLOUD INFERENCE with ANSI red", () => {
		const out = renderBadge({
			offline_ok: false,
			violating_tool: "hypothetical_remote_inference",
			violating_host: "api.example.com",
			badge_state: "red",
		});
		expect(out).toContain("CLOUD INFERENCE");
		expect(out).toContain("\x1b[31m");
		expect(out).toContain("\x1b[0m");
	});

	test("renderBadgePlain — no ANSI, plain text for each state", () => {
		expect(
			renderBadgePlain({
				offline_ok: true,
				violating_tool: null,
				violating_host: null,
				badge_state: "green",
			}),
		).toBe("OFFLINE OK");
		expect(
			renderBadgePlain({
				offline_ok: true,
				violating_tool: null,
				violating_host: null,
				badge_state: "yellow",
			}),
		).toBe("LOCAL LLM · WEB");
		expect(
			renderBadgePlain({
				offline_ok: false,
				violating_tool: "remote_inference",
				violating_host: "api.example.com",
				badge_state: "red",
			}),
		).toContain("CLOUD INFERENCE");
	});

	test("backward-compat — no badge_state field → maps offline_ok→green/red", () => {
		// Legacy shape (before D-36 added badge_state). This is the path taken
		// by Plan 03-06 call-sites that we haven't migrated yet.
		const greenLegacy = renderBadge({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
		});
		expect(greenLegacy).toContain("OFFLINE OK");
		const redLegacy = renderBadge({
			offline_ok: false,
			violating_tool: "web_fetch",
			violating_host: "evil.example",
		});
		// Legacy red = NETWORK USED (retained for existing call-site semantics)
		// OR it can be "CLOUD INFERENCE" — either is acceptable so long as it
		// renders in red ANSI. We assert red ANSI is present.
		expect(redLegacy).toContain("\x1b[31m");
	});
});

describe("module-level 3-state transitions — flipToYellow / flipToGreen", () => {
	test("flipToYellow renders LOCAL LLM · WEB via bound ctx.ui.setStatus", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const ctx = {
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					calls.push({ key, text });
				},
			},
		};
		setInitialAudit({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
			badge_state: "green",
		});
		bindBadge(ctx);
		flipToYellow("searxng responded healthy");
		const last = calls[calls.length - 1]!;
		expect(last.key).toBe("emmy.offline_badge");
		expect(last.text).toContain("LOCAL LLM · WEB");
		expect(last.text).toContain("\x1b[33m");
	});

	test("flipToGreen after flipToYellow renders OFFLINE OK green", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const ctx = {
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					calls.push({ key, text });
				},
			},
		};
		setInitialAudit({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
			badge_state: "green",
		});
		bindBadge(ctx);
		flipToYellow("searxng up");
		flipToGreen("searxng down");
		const last = calls[calls.length - 1]!;
		expect(last.text).toContain("OFFLINE OK");
		expect(last.text).toContain("\x1b[32m");
	});

	test("flipToViolation remains available for the red state (D-36 reserved)", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const ctx = {
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					calls.push({ key, text });
				},
			},
		};
		setInitialAudit({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
			badge_state: "green",
		});
		bindBadge(ctx);
		flipToViolation("web_fetch", "evil.example.com");
		const last = calls[calls.length - 1]!;
		// Red ANSI MUST be present (badge is red now).
		expect(last.text).toContain("\x1b[31m");
	});
});
