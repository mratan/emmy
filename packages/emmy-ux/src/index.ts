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
export { createEmmyExtension, type EmmyExtensionOptions } from "./pi-emmy-extension";

export const PACKAGE_VERSION = "0.1.0";
