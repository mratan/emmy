// packages/emmy-ux/src/offline-badge.ts
//
// Plan 03-06 Task 2 (GREEN) — UX-03 badge rendering + boot banner + module-
// level state machine.
//
// Two surfaces:
//   1. renderBadge / renderBadgePlain — pure render fns (unit-tested).
//      renderBadge returns ANSI-colored for the TUI status line;
//      renderBadgePlain returns uncolored for stderr banners that should
//      grep-match cleanly without ANSI noise.
//   2. updateOfflineBadge(ctx, result) — dispatches the rendered badge to
//      pi's ctx.ui.setStatus("emmy.offline_badge", ...) per D-27.
//
// Module-level state (bindBadge / setInitialAudit / flipToViolation):
// session.ts runs the boot-time audit BEFORE pi's extension factory binds
// ctx.ui; the extension factory later calls bindBadge(ctx) on session_start,
// at which point we replay the captured initial audit + any in-flight
// violation that happened in between. Symmetric with Plan 03-04's footer
// poller lifetime.
//
// runBootOfflineAudit is a pure helper that session.ts calls during boot
// to:
//   a. audit the current tool registry against the profile's allowlist
//   b. emit the [emmy]-prefixed green/red stderr banner
//   c. return the OfflineAuditResult for downstream emitEvent +
//      setInitialAudit dispatch
//
// Kill-switch non-interaction (plan success_criteria):
//   The badge is UX, not telemetry. EMMY_TELEMETRY=off does NOT suppress
//   the badge render — updateOfflineBadge runs unconditionally. Telemetry
//   kill-switch only prevents the emitEvent side of the pipeline (which
//   lives in session.ts, not here).

import {
	auditToolRegistry,
	type EmmyToolRegistration,
	type OfflineAuditResult,
} from "@emmy/telemetry";

// ANSI color sequences. Kept as module-local constants so tests can grep for
// them and so the production build has no runtime dependency on a color lib.
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * Render the badge with ANSI color + bold for the TUI status line.
 */
export function renderBadge(result: OfflineAuditResult): string {
	if (result.offline_ok) return `${GREEN}${BOLD}OFFLINE OK${RESET}`;
	return `${RED}${BOLD}NETWORK USED${RESET} (${result.violating_tool ?? "?"} → ${result.violating_host ?? "?"})`;
}

/**
 * Render the badge WITHOUT ANSI codes — for stderr banners and logs where a
 * clean grep is worth more than color. Shape mirrors renderBadge.
 */
export function renderBadgePlain(result: OfflineAuditResult): string {
	if (result.offline_ok) return "OFFLINE OK";
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
//
// Why module-level state: the boot-time audit runs in session.ts BEFORE
// pi's extension factory gets a `ctx` reference (factories receive ctx via
// the pi.on("session_start") handler). We capture the initial audit via
// setInitialAudit(result), the extension factory calls bindBadge(ctx) when
// it gets ctx, and bindBadge replays the captured state into setStatus.
// This mirrors Plan 03-02's session-context pattern (module-level config
// updated by session bootstrap, read by emitEvent call sites).
//
// Runtime updates: web_fetch enforcement calls flipToViolation(tool, host)
// on allowlist miss. The callback pipeline is wired in session.ts:
//   web-fetch-allowlist.enforceWebFetchAllowlist → onViolation callback
//   → flipToViolation → updateOfflineBadge (if ctx is bound).

let _lastResult: OfflineAuditResult = {
	offline_ok: true,
	violating_tool: null,
	violating_host: null,
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
 */
export function flipToViolation(tool: string, host: string): void {
	_lastResult = { offline_ok: false, violating_tool: tool, violating_host: host };
	if (_ctx) updateOfflineBadge(_ctx, _lastResult);
}

/**
 * Test-only escape hatch: reset module-level state between tests so
 * assertions are not polluted by prior test runs. Exported so
 * @emmy/ux/test files can call it in `beforeEach`; production code
 * never invokes it.
 */
export function __resetBadgeStateForTests(): void {
	_lastResult = { offline_ok: true, violating_tool: null, violating_host: null };
	_ctx = null;
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
 */
export function runBootOfflineAudit(opts: RunBootAuditOpts): OfflineAuditResult {
	const result = auditToolRegistry(opts.toolRegistrations, opts.allowlist);
	const sink = opts.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
	const color = result.offline_ok ? GREEN : RED;
	sink(`${color}[emmy] ${renderBadgePlain(result)}${RESET}`);
	return result;
}
