// @emmy/ux — public surface.
//
// Plan 02-04 Task 1: session primitives (profile-loader + prompt-assembly +
// sp-ok-canary + max-model-len + session-transcript).
// Plan 02-04 Task 2: createEmmySession + pi-emmy CLI wire-up (added by GREEN
// for Task 2 in the same plan).

export * from "./types";
export * from "./errors";
export { loadProfile } from "./profile-loader";
export { assemblePrompt } from "./prompt-assembly";
export {
	runSpOk,
	SP_OK_SYSTEM_PROMPT,
	SP_OK_USER_MESSAGE,
	SP_OK_ASSERTION_SUBSTR,
} from "./sp-ok-canary";
export { computeMaxInputTokens } from "./max-model-len";
export {
	appendSessionTurn,
	openTranscript,
	transcriptDir,
	type SessionTurn,
} from "./session-transcript";
export { createEmmySession, type PiRuntime } from "./session";
// Plan 03-01: Phase-3 pi 0.68 extension factory — installs the
// before_provider_request hook (enable_thinking:false + Emmy 3-layer prompt
// overwrite + reactive-grammar injection) on every live wire request.
// Plan 03.1-01 (D-30): runTurnStartCompaction extracted as a named helper so
// unit tests can drive it with a fake ExtensionContext; the factory calls it
// from pi.on("turn_start", ...) on the live path.
export {
	createEmmyExtension,
	runTurnStartCompaction,
	type EmmyExtensionOptions,
	type TurnStartCompactionCtx,
} from "./pi-emmy-extension";

// Plan 03.1-01 Task 2 (D-31, D-32): /compact and /clear slash commands
// registered via pi.registerCommand. Exported for external reuse + tests.
export {
	buildCompactInstructions,
	registerCompactCommand,
	registerClearCommand,
} from "./slash-commands";

// Plan 03-04 (UX-02): TUI footer components.
//   - formatFooter: pure renderer producing `GPU N% • KV N% • spec accept - • tok/s N`
//   - startFooterPoller: 1 Hz metrics poller + setStatus dispatcher
//   - vLLM /metrics parser + nvidia-smi subprocess wrapper
export { formatFooter, type FooterValues } from "./footer";
export {
	startFooterPoller,
	stopFooterPoller,
	type FooterPollerHandle,
	type FooterPollerOpts,
} from "./metrics-poller";
export {
	fetchVllmMetrics,
	parseMetrics,
	TokRateTracker,
	computeTokRate,
	type MetricSnapshot,
	type MetricSample,
} from "./vllm-metrics";
export {
	sampleNvidiaSmi,
	parseFloatOrUndefined,
	type NvidiaSample,
} from "./nvidia-smi";

// Plan 03-06 (UX-03): OFFLINE OK / NETWORK USED badge surface.
export {
	renderBadge,
	renderBadgePlain,
	updateOfflineBadge,
	bindBadge,
	setInitialAudit,
	flipToViolation,
	runBootOfflineAudit,
	type BadgeCtx,
	type RunBootAuditOpts,
} from "./offline-badge";

export const PACKAGE_VERSION = "0.1.0";
