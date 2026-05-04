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
import type { ProfileSnapshot, VariantSnapshot } from "./types";

export type { RetryState };

export interface BeforeProviderRequestPayload {
	model: string;
	messages: Array<{ role: string; content: unknown }>;
	extra_body?: Record<string, unknown>;
	chat_template_kwargs?: Record<string, unknown>;
	// Phase 4 HARNESS-08 — variant-level sampling fields applied when a
	// variantSnapshot is present. Their absence (undefined) means the wire
	// layer or profile layer downstream is responsible for sampling
	// defaults; presence is a per-turn override.
	temperature?: number;
	top_p?: number;
	top_k?: number;
	max_tokens?: number;
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
	// Phase 4 Plan 04-04 (HARNESS-08) — per-turn variant snapshot. When
	// present, its harness.sampling_defaults / chat_template_kwargs override
	// the base profile's values. When absent (existing callers + Phase 3
	// wiring), the hook's behavior is unchanged.
	variantSnapshot?: VariantSnapshot;
}): void {
	const { payload, profile, assembledPrompt, retryState, variantSnapshot } = args;

	// SP_OK canary guard — never mutate the canary's payload. The canary runs
	// BEFORE pi's extension runtime exists, so this branch is defensive only.
	if (payload.emmy?.is_sp_ok_canary === true) return;

	// (pre) Plan 04-03 follow-up (2026-04-24): after /profile swap, pi's
	// ModelRegistry still carries the boot-time served_model_name. vLLM
	// rejects with 404 ("model X does not exist") because the engine now
	// answers under the NEW served_model_name. Overwrite payload.model with
	// the currently-loaded profile's served_model_name on every request —
	// idempotent pre-swap (same string), corrective post-swap.
	payload.model = profile.serving.engine.served_model_name;

	// (a) D-02a: enable_thinking:false at request level. Removes a17f4a9.
	// Phase 04.7-02 Wave 5: vLLM's MistralTokenizer (tokenizer_mode=mistral)
	// REJECTS chat_template_kwargs with HTTP 400 ("chat_template is not
	// supported for Mistral tokenizers" — vllm/tokenizers/mistral.py:217).
	// mistral_common has its own chat formatting that doesn't honor
	// enable_thinking kwargs anyway, so the injection is silently no-op for
	// Mistral and actively breaks the request shape — skip it entirely.
	const isMistralTokenizer = profile.serving.engine.tokenizer_mode === "mistral";
	if (!isMistralTokenizer) {
		payload.chat_template_kwargs = {
			...(payload.chat_template_kwargs ?? {}),
			enable_thinking: false,
		};
	}

	// (a1) Phase 4 HARNESS-08 — variant snapshot application. Overrides the
	// enable_thinking default (a) and the base profile sampling whenever a
	// variant is active for the current turn. Tool-name + message-text based
	// role classification means temperature=0.6 on a "plan" turn and
	// temperature=0.0 on an "edit" turn, without restarting the vLLM engine
	// (serving.yaml is byte-identical across sibling variants per D-10).
	if (variantSnapshot) {
		const sd = variantSnapshot.harness.sampling_defaults;
		if (sd) {
			if (typeof sd.temperature === "number") payload.temperature = sd.temperature;
			if (typeof sd.top_p === "number") payload.top_p = sd.top_p;
			if (typeof sd.top_k === "number") payload.top_k = sd.top_k;
			if (typeof sd.max_tokens === "number") payload.max_tokens = sd.max_tokens;
		}
		if (variantSnapshot.harness.chat_template_kwargs) {
			payload.chat_template_kwargs = {
				...(payload.chat_template_kwargs ?? {}),
				...variantSnapshot.harness.chat_template_kwargs,
			};
		}
		// Note: variant-specific system prompt mutation is deferred to the
		// @emmy/ux caller; pi-emmy-extension.ts's before_provider_request
		// handler rebuilds assembledPrompt.text when harness.prompts.system
		// points at a variant-specific file. This hook only applies the
		// chat-request-shape fields directly.
	}

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
