// packages/emmy-provider/test/variant-sampling.test.ts
//
// Phase 4 Plan 04-04 Task 2i — variant-snapshot payload mutation tests.
// Asserts:
//   1. variantSnapshot.harness.sampling_defaults overrides payload fields.
//   2. variantSnapshot.harness.chat_template_kwargs merges (override wins).
//   3. Absent variantSnapshot → existing behavior unchanged.
//   4. per_tool_sampling in the snapshot does NOT mutate chat defaults
//      (it's tool-specific; this hook only applies sampling_defaults).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	handleBeforeProviderRequest,
	type AssembledPromptSnapshot,
	type BeforeProviderRequestPayload,
	type ProfileSnapshot,
	type VariantSnapshot,
} from "../src/index";

function makeProfile(path: string): ProfileSnapshot {
	return {
		ref: { id: "qwen3.6-35b-a3b", version: "v3.1", hash: "sha256:abc", path },
		serving: {
			engine: { served_model_name: "qwen3.6-35b-a3b", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.2, top_p: 0.95, max_tokens: 8192 },
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: {
			tools: {
				format: "openai",
				grammar: null,
				per_tool_sampling: {},
			},
			agent_loop: { retry_on_unparseable_tool_call: 2 },
		},
	};
}

function makeAssembled(): AssembledPromptSnapshot {
	return { text: "EMMY ASSEMBLED PROMPT", sha256: "deadbeef".repeat(8) };
}

describe("handleBeforeProviderRequest — variant snapshot application", () => {
	test("variantSnapshot.sampling_defaults.temperature mutates payload.temperature", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-variant-"));
		try {
			const payload: BeforeProviderRequestPayload = {
				model: "qwen3.6-35b-a3b",
				messages: [{ role: "system", content: "pi-sys" }],
				temperature: 0.8, // incoming default (caller-supplied)
			};
			const variantSnapshot: VariantSnapshot = {
				profileId: "qwen3.6-35b-a3b",
				variant: "v3.1-precise",
				variantHash: "sha256:precise",
				role: "edit",
				harness: {
					sampling_defaults: { temperature: 0.0 },
				},
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: makeAssembled(),
				retryState: null,
				variantSnapshot,
			});
			expect(payload.temperature).toBe(0.0);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("variantSnapshot.chat_template_kwargs is merged (override wins)", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-variant-"));
		try {
			const payload: BeforeProviderRequestPayload = {
				model: "qwen3.6-35b-a3b",
				messages: [{ role: "system", content: "pi-sys" }],
				chat_template_kwargs: { some_other_key: "value" },
			};
			const variantSnapshot: VariantSnapshot = {
				profileId: "qwen3.6-35b-a3b",
				variant: "v3.1-reason",
				variantHash: "sha256:reason",
				role: "plan",
				harness: {
					chat_template_kwargs: { enable_thinking: true },
				},
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: makeAssembled(),
				retryState: null,
				variantSnapshot,
			});
			// enable_thinking set to TRUE by variant — OVERRIDES the hook's
			// default (false) set at step (a).
			expect(payload.chat_template_kwargs?.enable_thinking).toBe(true);
			// Pre-existing unrelated keys preserved.
			expect(payload.chat_template_kwargs?.some_other_key).toBe("value");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("no variantSnapshot → existing behavior unchanged (payload.temperature not clobbered)", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-variant-"));
		try {
			const payload: BeforeProviderRequestPayload = {
				model: "qwen3.6-35b-a3b",
				messages: [{ role: "system", content: "pi-sys" }],
				temperature: 0.5,
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: makeAssembled(),
				retryState: null,
				// no variantSnapshot
			});
			// Pre-Phase-4 behavior: hook does NOT touch temperature if no
			// variant is supplied.
			expect(payload.temperature).toBe(0.5);
			// And chat_template_kwargs.enable_thinking = false (Phase 3 D-02a)
			// still fires as before.
			expect(payload.chat_template_kwargs?.enable_thinking).toBe(false);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("variantSnapshot.per_tool_sampling presence does NOT mutate payload.temperature", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-variant-"));
		try {
			const payload: BeforeProviderRequestPayload = {
				model: "qwen3.6-35b-a3b",
				messages: [{ role: "system", content: "pi-sys" }],
				temperature: 0.4,
			};
			const variantSnapshot: VariantSnapshot = {
				profileId: "qwen3.6-35b-a3b",
				variant: "v3.1-default",
				variantHash: "sha256:default",
				role: "default",
				harness: {
					// per_tool_sampling alone (no sampling_defaults) — the chat-
					// request-shape fields are unaffected by per-tool knobs.
					per_tool_sampling: { edit: { temperature: 0.0 } },
				},
			};
			handleBeforeProviderRequest({
				payload,
				profile: makeProfile(tmp),
				assembledPrompt: makeAssembled(),
				retryState: null,
				variantSnapshot,
			});
			// Payload temperature untouched because the snapshot only carries
			// per_tool_sampling, not sampling_defaults.
			expect(payload.temperature).toBe(0.4);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
