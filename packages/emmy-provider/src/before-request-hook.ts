// packages/emmy-provider/src/before-request-hook.ts
//
// Plan 03-01 Task 2 (GREEN) — the pi 0.68 `before_provider_request`
// payload mutator. One concentrated place for the five live injections
// that Phase 3 Track B makes authoritative on every wire request:
//
//   (a) D-02a: chat_template_kwargs.enable_thinking:false at request level
//       — this is the PROPER fix that obsoletes the a17f4a9 `<think>`-strip
//       stopgap. vLLM's Qwen3.6 chat template reads enable_thinking and
//       generates NO `<think>` prefix when it's false.
//
//   (b) D-02b: reactive grammar injection — when the retry-state for the
//       request's AbortSignal says wantsGrammar=true (Phase 2 D-11 retry
//       leg), this injects extra_body.guided_decoding.grammar_str from the
//       profile's Lark file. Grammar config {path,mode} is the nested shape
//       (D-11 lock); mode="disabled" suppresses injection even on retry
//       (Plan 02-08 SC-3 no-grammar baseline).
//
//   (c) D-02c + D-04: the assembled 3-layer emmy prompt OVERWRITES pi's
//       templated system message at wire time. pi 0.68 builds its own
//       system message from skills/resources; Emmy's prompt is the
//       CONTEXT-04 locked-order layering (system.md + AGENTS.md + tool_defs
//       + user) whose SHA-256 is the HARNESS-06 audit identifier. The
//       overwrite happens HERE — not at session boot — so every chat call
//       on the live path carries the emmy-authoritative system prompt.
//
// SP_OK canary guard (RESEARCH Pitfall #7 / 03-CONTEXT T-03-01-02):
//   If payload.emmy.is_sp_ok_canary === true, the hook is a pass-through.
//   The canary fires BEFORE buildRealPiRuntime so this branch should never
//   fire in practice — belt-and-suspenders against future wiring mistakes
//   that might route the canary through pi's stream.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RetryState } from "./grammar-retry";
import type { ProfileSnapshot } from "./types";

export type { RetryState };

export interface BeforeProviderRequestPayload {
	model: string;
	messages: Array<{ role: string; content: unknown }>;
	extra_body?: Record<string, unknown>;
	chat_template_kwargs?: Record<string, unknown>;
	/**
	 * Emmy-private payload namespace. Used today for the SP_OK canary
	 * pass-through flag; future fields (turn_id correlation, trace context)
	 * live here so they never collide with vLLM or OpenAI-standard fields.
	 */
	emmy?: { is_sp_ok_canary?: boolean };
}

export interface AssembledPromptSnapshot {
	text: string;
	sha256: string;
}

export function handleBeforeProviderRequest(args: {
	payload: BeforeProviderRequestPayload;
	profile: ProfileSnapshot;
	assembledPrompt: AssembledPromptSnapshot;
	retryState: RetryState | null;
}): void {
	const { payload, profile, assembledPrompt, retryState } = args;

	// SP_OK canary guard — never mutate the canary's payload. The canary runs
	// BEFORE pi's extension runtime exists, so this branch is defensive only.
	if (payload.emmy?.is_sp_ok_canary === true) return;

	// (a) D-02a: enable_thinking:false at request level. Removes a17f4a9.
	payload.chat_template_kwargs = {
		...(payload.chat_template_kwargs ?? {}),
		enable_thinking: false,
	};

	// (b) D-02b: reactive grammar injection (Phase 2 D-11 live-path wiring).
	if (retryState?.wantsGrammar === true) {
		const grammarCfg = profile.harness.tools.grammar;
		if (grammarCfg !== null && grammarCfg.mode !== "disabled") {
			const grammarText = readFileSync(
				join(profile.ref.path, grammarCfg.path),
				"utf8",
			);
			payload.extra_body = {
				...(payload.extra_body ?? {}),
				guided_decoding: { grammar_str: grammarText },
			};
		}
	}

	// (c) D-02c + D-04: replace the system message with emmy's 3-layer prompt.
	const idx = payload.messages.findIndex((m) => m.role === "system");
	if (idx >= 0) {
		payload.messages[idx] = { role: "system", content: assembledPrompt.text };
	} else {
		payload.messages.unshift({ role: "system", content: assembledPrompt.text });
	}
}
