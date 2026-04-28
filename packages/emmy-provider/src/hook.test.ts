// packages/emmy-provider/src/hook.test.ts
//
// Plan 03-01 Task 1 (RED) — unit tests for handleBeforeProviderRequest (the
// Wave-1 before_provider_request payload mutator).
//
// Covers:
//   T4: enable_thinking:false is injected at chat_template_kwargs (D-02a).
//   T4b: the system message is replaced by the emmy-assembled 3-layer prompt
//        (D-02c + D-04).
//   T5: when retry-state wantsGrammar is true (Phase 2 D-11 reactive path),
//       extra_body.guided_decoding.grammar_str is populated from the profile's
//       grammar file path.
//   T6: when payload.emmy.is_sp_ok_canary === true, the hook is a pass-through
//       (belt-and-suspenders for RESEARCH Pitfall #7 / 03-CONTEXT D-02 SP_OK
//       canary regression guard).
//
// Phase-3 RED (Task 1): this file imports from `./before-request-hook` which
// does NOT exist yet at commit time. Task 2 (GREEN) creates it and these tests
// flip from fail-to-compile to fail-to-assert-pass.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProfileSnapshot } from "./types";
// RED: this import path resolves to a NEW module Task 2 must create.
import {
	handleBeforeProviderRequest,
	type BeforeProviderRequestPayload,
	type AssembledPromptSnapshot,
	type RetryState,
} from "./before-request-hook";

function makeProfile(path: string, grammarMode: "reactive" | "disabled" | null = "reactive"): ProfileSnapshot {
	return {
		ref: { id: "gemma-4-26b-a4b-it", version: "v2", hash: "sha256:abc", path },
		serving: {
			engine: { served_model_name: "gemma-4-26b-a4b-it", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.2, top_p: 0.95, max_tokens: 8192, stop: [] },
			quirks: { strip_thinking_tags: false, promote_reasoning_to_content: false, buffer_tool_streams: false },
		},
		harness: {
			tools: {
				format: "openai",
				grammar:
					grammarMode === null
						? null
						: { path: "grammars/tool_call.lark", mode: grammarMode },
				per_tool_sampling: {},
			},
			agent_loop: { retry_on_unparseable_tool_call: 2 },
		},
	};
}

function makeAssembled(): AssembledPromptSnapshot {
	return { text: "EMMY ASSEMBLED PROMPT (3-layer)", sha256: "deadbeef".repeat(8) };
}

describe("handleBeforeProviderRequest — Test 4 (enable_thinking + system overwrite)", () => {
	test("injects chat_template_kwargs.enable_thinking=false on non-canary request", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-hook-"));
		try {
			const payload: BeforeProviderRequestPayload = {
				model: "gemma-4-26b-a4b-it",
				messages: [{ role: "system", content: "pi-default-system" }],
				chat_template_kwargs: {},
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: makeAssembled(),
				retryState: null,
			});
			expect(payload.chat_template_kwargs?.enable_thinking).toBe(false);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("replaces existing system message content with emmy.assembledPrompt.text", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-hook-"));
		try {
			const assembled = makeAssembled();
			const payload: BeforeProviderRequestPayload = {
				model: "gemma-4-26b-a4b-it",
				messages: [
					{ role: "system", content: "pi-default-system" },
					{ role: "user", content: "hello" },
				],
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: assembled,
				retryState: null,
			});
			expect(payload.messages[0]!.role).toBe("system");
			expect(payload.messages[0]!.content).toBe(assembled.text);
			// user preserved
			expect(payload.messages[1]!.role).toBe("user");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("prepends system message when pi omitted one", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-hook-"));
		try {
			const assembled = makeAssembled();
			const payload: BeforeProviderRequestPayload = {
				model: "gemma-4-26b-a4b-it",
				messages: [{ role: "user", content: "hi" }],
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: assembled,
				retryState: null,
			});
			expect(payload.messages.length).toBe(2);
			expect(payload.messages[0]!.role).toBe("system");
			expect(payload.messages[0]!.content).toBe(assembled.text);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("handleBeforeProviderRequest — Test 5 (reactive grammar injection)", () => {
	test("wantsGrammar=true → extra_body.guided_decoding.grammar_str is the profile's Lark file contents", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-hook-"));
		try {
			mkdirSync(join(tmp, "grammars"), { recursive: true });
			writeFileSync(join(tmp, "grammars", "tool_call.lark"), "start: \"OK\"\n", "utf8");
			const payload: BeforeProviderRequestPayload = {
				model: "gemma-4-26b-a4b-it",
				messages: [{ role: "system", content: "pi-sys" }],
			};
			const retryState: RetryState = { wantsGrammar: true };
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp, "reactive"),
				assembledPrompt: makeAssembled(),
				retryState,
			});
			const eb = payload.extra_body as { guided_decoding?: { grammar_str?: string } } | undefined;
			expect(eb?.guided_decoding?.grammar_str).toBe("start: \"OK\"\n");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("wantsGrammar=false → no extra_body.guided_decoding injection", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-hook-"));
		try {
			const payload: BeforeProviderRequestPayload = {
				model: "gemma-4-26b-a4b-it",
				messages: [{ role: "system", content: "pi-sys" }],
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: makeAssembled(),
				retryState: { wantsGrammar: false },
			});
			expect(payload.extra_body?.guided_decoding).toBeUndefined();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("wantsGrammar=true but grammar.mode=disabled → no injection (D-14 baseline)", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-hook-"));
		try {
			const payload: BeforeProviderRequestPayload = {
				model: "gemma-4-26b-a4b-it",
				messages: [{ role: "system", content: "pi-sys" }],
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp, "disabled"),
				assembledPrompt: makeAssembled(),
				retryState: { wantsGrammar: true },
			});
			expect(payload.extra_body?.guided_decoding).toBeUndefined();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("handleBeforeProviderRequest — Test 6 (SP_OK canary pass-through)", () => {
	test("payload.emmy.is_sp_ok_canary === true → hook is a no-op (belt-and-suspenders)", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-hook-"));
		try {
			const originalSystem = "canary-raw-sp-ok-prompt";
			const payload: BeforeProviderRequestPayload = {
				model: "gemma-4-26b-a4b-it",
				messages: [
					{ role: "system", content: originalSystem },
					{ role: "user", content: "ping" },
				],
				emmy: { is_sp_ok_canary: true },
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: makeAssembled(),
				retryState: null,
			});
			// Neither chat_template_kwargs nor system content should have been mutated.
			expect(payload.chat_template_kwargs).toBeUndefined();
			expect(payload.messages[0]!.content).toBe(originalSystem);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
