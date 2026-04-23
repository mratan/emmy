// packages/emmy-ux/src/offline-badge.ts
//
// Plan 03-06 Task 2 (GREEN) — UX-03 badge rendering + boot banner + module-
// level state machine.
// Plan 03.1-02 Task 2 (GREEN) — D-36 3-state badge (green / yellow / red).
//
// Three surfaces:
//   1. renderBadge / renderBadgePlain — pure render fns (unit-tested).
//      renderBadge returns ANSI-colored for the TUI status line;
//      renderBadgePlain returns uncolored for stderr banners that should
//      grep-match cleanly without ANSI noise.
//      3-state enum per D-36:
//        green  → "OFFLINE OK"          SearxNG down/disabled
//        yellow → "LOCAL LLM · WEB"     SearxNG up, LLM still local
//        red    → "CLOUD INFERENCE"     reserved — non-loopback inference
//      Backward-compat: call-sites that pass legacy OfflineAuditResult
//      (no badge_state) continue to work; renderer derives green/red from
//      offline_ok.
//   2. updateOfflineBadge(ctx, result) — dispatches the rendered badge to
//      pi's ctx.ui.setStatus("emmy.offline_badge", ...) per D-27.
//   3. flipToYellow / flipToGreen / flipToViolation — module-level state
//      transitions wired from the session bootstrap (session.ts) +
//      web_search success/failure paths.

import {
	auditToolRegistry,
	type EmmyToolRegistration,
	type OfflineAuditResult,
} from "@emmy/telemetry";

// ANSI color sequences. Kept as module-local constants so tests can grep for
// them and so the production build has no runtime dependency on a color lib.
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * Resolve the effective badge_state from an OfflineAuditResult. When the
 * explicit `badge_state` field is present, it wins. When absent (legacy
 * call-sites), derive from `offline_ok`.
 */
function _effectiveState(r: OfflineAuditResult): "green" | "yellow" | "red" {
	if (r.badge_state) return r.badge_state;
	return r.offline_ok ? "green" : "red";
}

/**
 * Render the badge with ANSI color + bold for the TUI status line.
 *
 * 3-state per D-36:
 *   - green:  "[emmy] OFFLINE OK"
 *   - yellow: "[emmy] LOCAL LLM · WEB"
 *   - red:    depends on call-site:
 *       - badge_state:"red" explicitly → "[emmy] CLOUD INFERENCE ..."
 *       - derived red (legacy offline_ok:false) → "[emmy] NETWORK USED (...)"
 *         (retained so Plan 03-06's web_fetch violation flow still
 *         renders the tool→host diagnostic that operators rely on).
 */
export function renderBadge(result: OfflineAuditResult): string {
	const state = _effectiveState(result);
	if (state === "green") return `${GREEN}${BOLD}OFFLINE OK${RESET}`;
	if (state === "yellow") return `${YELLOW}${BOLD}LOCAL LLM · WEB${RESET}`;
	// red: if badge_state:"red" was set explicitly (D-36 reserved), render
	// "CLOUD INFERENCE"; else fall back to legacy NETWORK USED diagnostic.
	if (result.badge_state === "red") {
		const tool = result.violating_tool ?? "?";
		const host = result.violating_host ?? "?";
		return `${RED}${BOLD}CLOUD INFERENCE${RESET} (${tool} → ${host})`;
	}
	return `${RED}${BOLD}NETWORK USED${RESET} (${result.violating_tool ?? "?"} → ${result.violating_host ?? "?"})`;
}

/**
 * Render the badge WITHOUT ANSI codes — for stderr banners and logs where a
 * clean grep is worth more than color. Shape mirrors renderBadge.
 */
export function renderBadgePlain(result: OfflineAuditResult): string {
	const state = _effectiveState(result);
	if (state === "green") return "OFFLINE OK";
	if (state === "yellow") return "LOCAL LLM · WEB";
	if (result.badge_state === "red") {
		const tool = result.violating_tool ?? "?";
		const host = result.violating_host ?? "?";
		return `CLOUD INFERENCE (${tool} → ${host})`;
	}
	return `NETWORK USED (${result.violating_tool ?? "?"} → ${result.violating_host ?? "?"})`;
}

export interface BadgeCtx {
	ui: {
		setStatus: (key: string, text: string | undefined) => void;
	};
}

/**
 * Dispatch the rendered badge to pi's TUI status line. The "emmy.offline_badge"
 * key is stable — tests assert on it, and Plan 03-07's verification scripts
 * grep runs/<session>/events.jsonl for the same namespace.
 */
export function updateOfflineBadge(ctx: BadgeCtx, result: OfflineAuditResult): void {
	ctx.ui.setStatus("emmy.offline_badge", renderBadge(result));
}

// --- Module-level state machine ------------------------------------------

let _lastResult: OfflineAuditResult = {
	offline_ok: true,
	violating_tool: null,
	violating_host: null,
	badge_state: "green",
};
let _ctx: BadgeCtx | null = null;

/**
 * Install the pi `ctx.ui` reference AND immediately render the most recently
 * captured audit state. Safe to call multiple times (idempotent; most recent
 * ctx wins).
 */
export function bindBadge(ctx: BadgeCtx): void {
	_ctx = ctx;
	updateOfflineBadge(ctx, _lastResult);
}

/**
 * Capture the boot-time audit result. If ctx is already bound, re-renders.
 */
export function setInitialAudit(result: OfflineAuditResult): void {
	_lastResult = result;
	if (_ctx) updateOfflineBadge(_ctx, result);
}

/**
 * Runtime violation flip (D-27). Called by the web_fetch enforcement hook's
 * onViolation callback. Flips the module-level state to red and re-renders
 * if ctx is bound. If ctx is not yet bound (bootstrap timing), the next
 * bindBadge call replays the red state.
 *
 * Plan 03.1-02 D-36: this remains the authoritative "legacy red" path
 * (renders "NETWORK USED" with tool→host diagnostic). The D-36 reserved
 * "red" state (badge_state:"red") is for non-loopback inference detection
 * and is NOT fired by current code.
 */
export function flipToViolation(tool: string, host: string): void {
	// NOTE: no badge_state here → renderer uses legacy NETWORK USED path.
	_lastResult = { offline_ok: false, violating_tool: tool, violating_host: host };
	if (_ctx) updateOfflineBadge(_ctx, _lastResult);
}

/**
 * Plan 03.1-02 D-36 — flip to YELLOW (LOCAL LLM · WEB). Called from the
 * web_search success path in session.ts: when SearxNG responds healthy,
 * the badge transitions green → yellow. `reason` is captured for the
 * operator-facing transition log (setStatus key "emmy.offline_badge.reason").
 */
export function flipToYellow(reason: string): void {
	_lastResult = {
		offline_ok: true,
		violating_tool: null,
		violating_host: null,
		badge_state: "yellow",
		reason,
	};
	if (_ctx) updateOfflineBadge(_ctx, _lastResult);
}

/**
 * Plan 03.1-02 D-36 — flip to GREEN (OFFLINE OK). Called from the web_search
 * failure/fallback path: when SearxNG is down or returns an error, the badge
 * transitions back to green (SearxNG is out of the loop; emmy is fully
 * air-gapped again).
 */
export function flipToGreen(reason: string): void {
	_lastResult = {
		offline_ok: true,
		violating_tool: null,
		violating_host: null,
		badge_state: "green",
		reason,
	};
	if (_ctx) updateOfflineBadge(_ctx, _lastResult);
}

/**
 * Test-only escape hatch: reset module-level state between tests so
 * assertions are not polluted by prior test runs.
 */
export function __resetBadgeStateForTests(): void {
	_lastResult = {
		offline_ok: true,
		violating_tool: null,
		violating_host: null,
		badge_state: "green",
	};
	_ctx = null;
}

/**
 * Test-only getter for the module-level audit result. Used by
 * harness-swap-wr04.test.ts to assert reloadHarnessProfile runs the real
 * audit against the new profile's allowlist. Production code should NEVER
 * import this — read from a bound ctx instead.
 */
export function getBadgeStateForTests(): OfflineAuditResult | null {
	return _lastResult;
}

// --- Boot audit helper ---------------------------------------------------

export interface RunBootAuditOpts {
	toolRegistrations: readonly EmmyToolRegistration[];
	allowlist: readonly string[];
	/** Stderr sink. Defaults to process.stderr.write. Tests inject an array
	 *  pusher to capture the line for assertion. */
	stderr?: (line: string) => void;
}

/**
 * Runs the boot-time audit (pure, no side effects beyond the stderr callback)
 * and returns the OfflineAuditResult. session.ts calls this right after
 * tool registration to:
 *   - Print the [emmy] OFFLINE OK / NETWORK USED banner to stderr
 *   - Feed the result into setInitialAudit + emitEvent("session.offline_audit.complete")
 *
 * Color is applied inline to the stderr line (matches renderBadge color scheme).
 *
 * Plan 03.1-02: the boot banner still renders green (OFFLINE OK) because the
 * boot-time audit doesn't know whether SearxNG is up — the yellow transition
 * happens lazily on first successful web_search call (session.ts wires the
 * flipToYellow callback into webSearch's onSuccess path).
 */
export function runBootOfflineAudit(opts: RunBootAuditOpts): OfflineAuditResult {
	const rawResult = auditToolRegistry(opts.toolRegistrations, opts.allowlist);
	// D-36: boot-time audit's red path remains "legacy red" (NETWORK USED with
	// tool→host diagnostic). Only green results get badge_state:"green" stamped
	// explicitly so the 3-state renderer picks the OFFLINE OK path verbatim.
	// Red audits here are tool-registration-time violations (config-detected,
	// not runtime); the D-36 reserved red state (badge_state:"red") is for
	// actual non-loopback inference detection, which today never fires.
	const result: OfflineAuditResult = rawResult.offline_ok
		? { ...rawResult, badge_state: "green" }
		: rawResult;
	const sink = opts.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
	const color = result.offline_ok ? GREEN : RED;
	sink(`${color}[emmy] ${renderBadgePlain(result)}${RESET}`);
	return result;
}
