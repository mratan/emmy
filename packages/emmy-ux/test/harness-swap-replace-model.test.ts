// packages/emmy-ux/test/harness-swap-replace-model.test.ts
//
// Followup to Plan 04-03 D-23: when /profile crosses bundles
// (e.g. gemma-4-26b-a4b-it → qwen3.6-27b), reloadHarnessProfile must
// re-target the pi-mono ModelRegistry + the closure-captured emmy model
// object. Without this, the harness sends the OLD served_model_name in chat
// completion request bodies (vLLM 404s on the swapped engine) AND the
// pi-mono TUI footer keeps showing the stale `sm.model.id`.
//
// This test pins the new contract: reloadHarnessProfile invokes the
// replaceModel handle with the NEW profile's served_model_name +
// max_model_len. The session.ts implementation (mutates the live model
// object + re-registers in ModelRegistry) is exercised end-to-end via the
// session integration test; this file pins just the harness-swap plumbing.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reloadHarnessProfile } from "../src/harness-swap";
import type { EmmyProfileStampProcessor } from "@emmy/telemetry";

function makeMockProcessor(): EmmyProfileStampProcessor {
	let profile = { id: "old", version: "v1", hash: `sha256:${"0".repeat(64)}` };
	return {
		get profile() {
			return profile;
		},
		setProfile(next: typeof profile) {
			profile = next;
		},
		onStart: () => {},
		onEnd: () => {},
		forceFlush: async () => {},
		shutdown: async () => {},
	} as unknown as EmmyProfileStampProcessor;
}

function writeMinimalProfileBundle(
	bundleDir: string,
	servedModelName: string,
	maxModelLen: number,
): void {
	mkdirSync(bundleDir, { recursive: true });
	mkdirSync(join(bundleDir, "prompts"), { recursive: true });
	mkdirSync(join(bundleDir, "tool_schemas"), { recursive: true });
	mkdirSync(join(bundleDir, "grammars"), { recursive: true });
	writeFileSync(join(bundleDir, "prompts", "system.md"), "test system\n");
	writeFileSync(
		join(bundleDir, "profile.yaml"),
		[
			"profile:",
			"  id: replace-model-fixture",
			"  version: v1",
			"  family: test",
			"  base_model: test",
			"  description: replace-model regression fixture",
			"  created: '2026-04-30'",
			`  hash: sha256:${"0".repeat(64)}`,
			"  hash_algorithm: sha256",
			"  hash_manifest_version: 1",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(bundleDir, "serving.yaml"),
		[
			"engine:",
			"  model: /models/test",
			"  model_hf_id: test/test",
			`  served_model_name: ${servedModelName}`,
			"  container_image: test-image",
			"  container_image_digest: sha256:abcdef",
			`  max_model_len: ${maxModelLen}`,
			"  gpu_memory_utilization: 0.5",
			"  kv_cache_dtype: auto",
			"  enable_prefix_caching: false",
			"  enable_chunked_prefill: false",
			"  max_num_batched_tokens: 1024",
			"  load_format: auto",
			"  quantization: null",
			"  tool_call_parser: null",
			"  enable_auto_tool_choice: false",
			"  attention_backend: null",
			"  host: 127.0.0.1",
			"  port: 8000",
			"sampling_defaults:",
			"  temperature: 0.2",
			"  top_p: 0.95",
			"  top_k: 40",
			"  repetition_penalty: 1.0",
			"  max_tokens: 256",
			"  stop: []",
			"env_vars: {}",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(bundleDir, "harness.yaml"),
		[
			"prompts:",
			"  system: prompts/system.md",
			"  edit_format: null",
			"  tool_descriptions: null",
			"  use_system_role: true",
			"  prepend_system_text: ''",
			"context:",
			"  max_input_tokens: 512",
			"  include_repo_map: false",
			"  repo_map_max_tokens: 0",
			"  default_pruning: head_tail",
			"tools:",
			"  format: openai",
			"  schemas: null",
			"  grammar: null",
			"  per_tool_sampling: {}",
			"  web_fetch:",
			"    allowlist: []",
			"agent_loop:",
			"  max_iterations: 5",
			"  retry_on_unparseable_tool_call: 0",
			"  retry_on_empty_response: 0",
			"  self_correction: disabled",
			"advanced_settings_whitelist: []",
			"",
		].join("\n"),
	);
}

function loadHashedBundle(
	tmp: string,
	name: string,
	servedModelName: string,
	maxModelLen: number,
): string {
	const bundleDir = join(tmp, name);
	writeMinimalProfileBundle(bundleDir, servedModelName, maxModelLen);
	execSync(`uv run emmy profile hash ${bundleDir} --write`, {
		cwd: "/data/projects/emmy",
		stdio: "pipe",
	});
	return bundleDir;
}

describe("reloadHarnessProfile — replaceModel handle (cross-bundle /profile fix)", () => {
	test("invokes replaceModel with new profile's served_model_name + max_model_len", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-replace-model-"));
		try {
			const bundleDir = loadHashedBundle(tmp, "qwen-bundle", "qwen3.6-27b", 32768);

			const calls: Array<{ id: string; len: number }> = [];
			await reloadHarnessProfile(bundleDir, {
				replaceProfileRef: () => {},
				profileStampProcessor: makeMockProcessor(),
				replaceModel: (id, len) => {
					calls.push({ id, len });
				},
			});

			expect(calls).toEqual([{ id: "qwen3.6-27b", len: 32768 }]);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("missing replaceModel emits a stderr warning (visible in dev) but does not throw", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-replace-model-"));
		try {
			const bundleDir = loadHashedBundle(tmp, "gemma-bundle", "gemma-4-26b-a4b-it", 262144);

			// Capture stderr writes by monkey-patching process.stderr.write.
			const original = process.stderr.write.bind(process.stderr);
			const captured: string[] = [];
			process.stderr.write = ((chunk: unknown): boolean => {
				captured.push(typeof chunk === "string" ? chunk : String(chunk));
				return true;
			}) as typeof process.stderr.write;

			try {
				await reloadHarnessProfile(bundleDir, {
					replaceProfileRef: () => {},
					profileStampProcessor: makeMockProcessor(),
					// replaceModel intentionally omitted
				});
			} finally {
				process.stderr.write = original;
			}

			const warningLine = captured.find((l) =>
				l.includes("[harness-swap] WARNING: replaceModel handle missing"),
			);
			expect(warningLine).toBeDefined();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
