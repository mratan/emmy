// packages/emmy-ux/test/harness-swap-wr04.test.ts
//
// Regression test for WR-04 (04-REVIEW.md):
// harness-swap.ts previously hardcoded `badge_state: "green"` after swap
// without running runBootOfflineAudit against the new profile's allowlist,
// which masked posture regressions when swapping to a stricter-allowlist
// profile.
//
// This test pins the new behavior: when `getToolRegistrations` is supplied
// in HarnessSwapHandles, reloadHarnessProfile runs the real audit and the
// badge flips to red if a registered tool's required_hosts aren't covered
// by the new allowlist.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reloadHarnessProfile } from "../src/harness-swap";
import { __resetBadgeStateForTests } from "../src/offline-badge";
import type { ProfileSnapshot } from "../src/types";
import type { EmmyToolRegistration, EmmyProfileStampProcessor } from "@emmy/telemetry";
import { execSync } from "node:child_process";

function makeMockProcessor(): EmmyProfileStampProcessor {
	// swapSpanProcessor calls .setProfile(newProfile); we only need that and
	// the 4 SDK lifecycle methods to satisfy the interface.
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

function writeMinimalProfileBundle(bundleDir: string, allowlist: string[]) {
	mkdirSync(bundleDir, { recursive: true });
	mkdirSync(join(bundleDir, "prompts"), { recursive: true });
	mkdirSync(join(bundleDir, "tool_schemas"), { recursive: true });
	mkdirSync(join(bundleDir, "grammars"), { recursive: true });
	writeFileSync(join(bundleDir, "prompts", "system.md"), "test system\n");
	writeFileSync(
		join(bundleDir, "profile.yaml"),
		[
			"profile:",
			"  id: test-profile",
			"  version: v1-wr04",
			"  family: test",
			"  base_model: test",
			"  description: wr04 regression fixture",
			"  created: '2026-04-23'",
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
			"  served_model_name: test",
			"  container_image: test-image",
			"  container_image_digest: sha256:abcdef",
			"  max_model_len: 1024",
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
	const allowlistYaml = allowlist.length
		? ["  web_fetch:", "    allowlist:", ...allowlist.map((h) => `      - ${h}`)].join("\n")
		: "  web_fetch:\n    allowlist: []";
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
			allowlistYaml,
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

describe("reloadHarnessProfile WR-04 — runBootOfflineAudit against new profile allowlist", () => {
	test("with getToolRegistrations: badge flips to RED when registered tool needs host NOT in new allowlist", async () => {
		__resetBadgeStateForTests();
		const tmp = mkdtempSync(join(tmpdir(), "emmy-wr04-"));
		try {
			// New profile has allowlist WITHOUT the host a registered tool needs.
			const bundleDir = join(tmp, "strict-profile");
			writeMinimalProfileBundle(bundleDir, ["only-this-host.example"]);
			// Stamp real content hash so loader accepts the bundle.
			execSync(`uv run emmy profile hash ${bundleDir} --write`, {
				cwd: "/data/projects/emmy",
				stdio: "pipe",
			});

			// One registered tool declares it needs api.external.com which is
			// NOT in the new profile's allowlist → audit must fail → badge RED.
			const toolRegistrations: EmmyToolRegistration[] = [
				{
					name: "external_api_tool",
					required_hosts: ["api.external.com"],
				},
			];

			let replaced: ProfileSnapshot | null = null;
			const result = await reloadHarnessProfile(bundleDir, {
				replaceProfileRef: (snap) => {
					replaced = snap;
				},
				profileStampProcessor: makeMockProcessor(),
				getToolRegistrations: () => toolRegistrations,
			});

			expect(result.snap).toBeDefined();
			expect(replaced).toBeDefined();
			// The audit ran against the new allowlist and produced a non-green
			// result — we assert that the badge state mutation reflects the real
			// audit (offline_ok: false), not the old hardcoded green.
			// We check via the exported getter in offline-badge internals:
			const { getBadgeStateForTests } = await import("../src/offline-badge");
			const state = getBadgeStateForTests();
			expect(state?.offline_ok).toBe(false);
			expect(state?.violating_tool).toBe("external_api_tool");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("with getToolRegistrations: badge stays GREEN when registered tools' hosts ARE covered", async () => {
		__resetBadgeStateForTests();
		const tmp = mkdtempSync(join(tmpdir(), "emmy-wr04-"));
		try {
			const bundleDir = join(tmp, "permissive-profile");
			writeMinimalProfileBundle(bundleDir, ["api.external.com"]);
			execSync(`uv run emmy profile hash ${bundleDir} --write`, {
				cwd: "/data/projects/emmy",
				stdio: "pipe",
			});

			const toolRegistrations: EmmyToolRegistration[] = [
				{ name: "external_api_tool", required_hosts: ["api.external.com"] },
			];

			await reloadHarnessProfile(bundleDir, {
				replaceProfileRef: () => {},
				profileStampProcessor: makeMockProcessor(),
				getToolRegistrations: () => toolRegistrations,
			});

			const { getBadgeStateForTests } = await import("../src/offline-badge");
			const state = getBadgeStateForTests();
			expect(state?.offline_ok).toBe(true);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("without getToolRegistrations: preserves legacy force-green behavior (backward compat)", async () => {
		__resetBadgeStateForTests();
		const tmp = mkdtempSync(join(tmpdir(), "emmy-wr04-"));
		try {
			const bundleDir = join(tmp, "compat-profile");
			writeMinimalProfileBundle(bundleDir, []);
			execSync(`uv run emmy profile hash ${bundleDir} --write`, {
				cwd: "/data/projects/emmy",
				stdio: "pipe",
			});

			await reloadHarnessProfile(bundleDir, {
				replaceProfileRef: () => {},
				profileStampProcessor: makeMockProcessor(),
				// getToolRegistrations omitted — callers that don't supply
				// still get the old force-green behavior (no breakage).
			});

			const { getBadgeStateForTests } = await import("../src/offline-badge");
			const state = getBadgeStateForTests();
			expect(state?.offline_ok).toBe(true);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
