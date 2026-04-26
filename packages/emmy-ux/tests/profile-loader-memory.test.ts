// packages/emmy-ux/tests/profile-loader-memory.test.ts
//
// Plan 04.4-03 Task 2 — profile-loader parses harness.context.memory into a
// typed ProfileSnapshot field. Mirrors the test pattern from
// profile-loader.test.ts (ephemeral tmpdir profile bundles).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProfile, ProfileLoadError } from "@emmy/ux";

const HASH = "sha256:b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-ux-mem-loader-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeProfile(dir: string, harnessExtras = ""): void {
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(dir, "prompts"), { recursive: true });
	writeFileSync(
		join(dir, "profile.yaml"),
		`profile:
  id: test-profile
  version: v1
  family: test
  base_model: test/test
  description: test
  created: '2026-04-26'
  hash: ${HASH}
  hash_algorithm: sha256
  hash_manifest_version: 1
  tags: [test]
`,
		"utf8",
	);
	writeFileSync(
		join(dir, "serving.yaml"),
		`engine:
  served_model_name: test-model
  max_model_len: 131072
sampling_defaults:
  temperature: 0.2
  top_p: 0.95
  top_k: 40
  max_tokens: 8192
  stop: []
quirks:
  strip_thinking_tags: false
  promote_reasoning_to_content: false
  buffer_tool_streams: false
`,
		"utf8",
	);
	writeFileSync(
		join(dir, "harness.yaml"),
		`prompts:
  system: prompts/system.md
context:
  max_input_tokens: 114688
${harnessExtras}
tools:
  format: openai
  grammar: null
  per_tool_sampling: {}
agent_loop:
  retry_on_unparseable_tool_call: 2
`,
		"utf8",
	);
	writeFileSync(join(dir, "prompts", "system.md"), "x\n", "utf8");
}

const FULL_MEMORY_BLOCK = `  memory:
    enabled: true
    project_root: ".emmy/notes"
    global_root: "~/.emmy/memory"
    read_at_session_start: true
    max_file_bytes: 65536
    max_total_bytes: 10485760
    blocked_extensions: [".env", ".key", ".pem"]`;

describe("profile-loader — memory block (Plan 04.4-03)", () => {
	test("missing memory: block → harness.context.memory undefined (backward-compat)", async () => {
		const dir = join(tmp, "no-memory");
		writeProfile(dir, "");
		const snap = await loadProfile(dir);
		expect(snap.harness.context?.memory).toBeUndefined();
	});

	test("v1 default block parses fully", async () => {
		const dir = join(tmp, "default");
		writeProfile(dir, FULL_MEMORY_BLOCK);
		const snap = await loadProfile(dir);
		expect(snap.harness.context?.memory).toBeDefined();
		const m = snap.harness.context?.memory!;
		expect(m.enabled).toBe(true);
		expect(m.project_root).toBe(".emmy/notes");
		expect(m.global_root).toBe("~/.emmy/memory");
		expect(m.read_at_session_start).toBe(true);
		expect(m.max_file_bytes).toBe(65536);
		expect(m.max_total_bytes).toBe(10485760);
		expect(m.blocked_extensions).toEqual([".env", ".key", ".pem"]);
	});

	test("enabled=false carries through", async () => {
		const dir = join(tmp, "disabled");
		const block = FULL_MEMORY_BLOCK.replace("enabled: true", "enabled: false");
		writeProfile(dir, block);
		const snap = await loadProfile(dir);
		expect(snap.harness.context?.memory?.enabled).toBe(false);
	});

	test("project_root=null carries through", async () => {
		const dir = join(tmp, "no-project");
		const block = FULL_MEMORY_BLOCK.replace(
			'project_root: ".emmy/notes"',
			"project_root: null",
		);
		writeProfile(dir, block);
		const snap = await loadProfile(dir);
		expect(snap.harness.context?.memory?.project_root).toBeNull();
	});

	test("blocked_extensions parsed as string array", async () => {
		const dir = join(tmp, "blocked");
		writeProfile(dir, FULL_MEMORY_BLOCK);
		const snap = await loadProfile(dir);
		const blocked = snap.harness.context?.memory?.blocked_extensions ?? [];
		expect(Array.isArray(blocked)).toBe(true);
		expect(blocked).toContain(".env");
		expect(blocked).toContain(".key");
		expect(blocked).toContain(".pem");
	});

	test("max_file_bytes parsed as number (numeric type)", async () => {
		const dir = join(tmp, "numeric");
		writeProfile(dir, FULL_MEMORY_BLOCK);
		const snap = await loadProfile(dir);
		expect(typeof snap.harness.context?.memory?.max_file_bytes).toBe(
			"number",
		);
	});

	test("malformed memory block rejected with dotted-path error", async () => {
		const dir = join(tmp, "malformed");
		const bad = FULL_MEMORY_BLOCK.replace(
			"max_file_bytes: 65536",
			'max_file_bytes: "not a number"',
		);
		writeProfile(dir, bad);
		await expect(async () => await loadProfile(dir)).toThrow(ProfileLoadError);
		try {
			await loadProfile(dir);
		} catch (e) {
			expect(String(e)).toContain("context.memory.max_file_bytes");
		}
	});
});
