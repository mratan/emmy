// packages/emmy-ux/test/offline-badge.test.ts
//
// Plan 03-06 Task 1 (RED) — badge rendering + updateOfflineBadge dispatcher.
//
// renderBadge (ANSI-colored) / renderBadgePlain (no color) produce the exact
// human-facing string for the TUI + stderr surfaces. updateOfflineBadge is the
// plug for pi's ctx.ui.setStatus("emmy.offline_badge", ...).

import { describe, expect, test } from "bun:test";
import {
	bindBadge,
	flipToViolation,
	renderBadge,
	renderBadgePlain,
	setInitialAudit,
	updateOfflineBadge,
} from "../src/offline-badge";

describe("renderBadge (ANSI-colored)", () => {
	test("green OFFLINE OK for offline_ok: true", () => {
		const out = renderBadge({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
		});
		expect(out).toContain("OFFLINE OK");
		// ANSI green escape present (either code 32 form)
		expect(out).toContain("\x1b[32m");
		expect(out).toContain("\x1b[0m");
	});

	test("red NETWORK USED for offline_ok: false, with tool → host context", () => {
		const out = renderBadge({
			offline_ok: false,
			violating_tool: "custom_api",
			violating_host: "api.openai.com",
		});
		expect(out).toContain("NETWORK USED");
		expect(out).toContain("custom_api");
		expect(out).toContain("api.openai.com");
		expect(out).toContain("\x1b[31m");
		expect(out).toContain("\x1b[0m");
	});

	test("red badge handles null violating_tool/host gracefully", () => {
		const out = renderBadge({
			offline_ok: false,
			violating_tool: null,
			violating_host: null,
		});
		expect(out).toContain("NETWORK USED");
	});
});

describe("renderBadgePlain (no color — for stderr banner)", () => {
	test("returns plain 'OFFLINE OK' without ANSI codes", () => {
		const out = renderBadgePlain({
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
		});
		expect(out).toBe("OFFLINE OK");
		expect(out).not.toContain("\x1b[");
	});

	test("returns plain 'NETWORK USED (tool → host)' without ANSI codes", () => {
		const out = renderBadgePlain({
			offline_ok: false,
			violating_tool: "custom_api",
			violating_host: "api.openai.com",
		});
		expect(out).toContain("NETWORK USED");
		expect(out).toContain("custom_api");
		expect(out).toContain("api.openai.com");
		expect(out).not.toContain("\x1b[");
	});
});

describe("updateOfflineBadge — dispatches to ctx.ui.setStatus", () => {
	test("green result → setStatus called with 'emmy.offline_badge' key + rendered badge", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const ctx = {
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					calls.push({ key, text });
				},
			},
		};
		updateOfflineBadge(ctx, {
			offline_ok: true,
			violating_tool: null,
			violating_host: null,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]!.key).toBe("emmy.offline_badge");
		expect(calls[0]!.text).toContain("OFFLINE OK");
	});

	test("red result → setStatus called with red-rendered badge", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const ctx = {
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					calls.push({ key, text });
				},
			},
		};
		updateOfflineBadge(ctx, {
			offline_ok: false,
			violating_tool: "web_fetch",
			violating_host: "developer.mozilla.org",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]!.key).toBe("emmy.offline_badge");
		expect(calls[0]!.text).toContain("NETWORK USED");
		expect(calls[0]!.text).toContain("developer.mozilla.org");
	});
});

describe("module-level badge state — bindBadge + setInitialAudit + flipToViolation", () => {
	test("bindBadge installs ctx; setInitialAudit triggers immediate render", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const ctx = {
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					calls.push({ key, text });
				},
			},
		};
		setInitialAudit({ offline_ok: true, violating_tool: null, violating_host: null });
		bindBadge(ctx); // bind AFTER initial audit → renders initial state now
		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls[calls.length - 1]!.text).toContain("OFFLINE OK");
	});

	test("flipToViolation re-renders as red with tool + host", () => {
		const calls: Array<{ key: string; text: string | undefined }> = [];
		const ctx = {
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					calls.push({ key, text });
				},
			},
		};
		// Reset then bind
		setInitialAudit({ offline_ok: true, violating_tool: null, violating_host: null });
		bindBadge(ctx);
		const beforeLen = calls.length;
		flipToViolation("web_fetch", "docs.python.org");
		expect(calls.length).toBeGreaterThan(beforeLen);
		const last = calls[calls.length - 1]!;
		expect(last.text).toContain("NETWORK USED");
		expect(last.text).toContain("web_fetch");
		expect(last.text).toContain("docs.python.org");
	});
});
