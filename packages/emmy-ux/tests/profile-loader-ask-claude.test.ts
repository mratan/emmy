// packages/emmy-ux/tests/profile-loader-ask-claude.test.ts
//
// Plan 04.6-03 Task 1 (RED) — profile-loader parses harness.tools.ask_claude
// into a typed snapshot field. Mirrors the test pattern from
// profile-loader-memory.test.ts (ephemeral tmpdir profile bundles), with the
// structural sibling being web_search (also under harness.tools.*) rather than
// memory (which lives under harness.context.*).
//
// Per CLAUDE.md additive rule + 04.6 D-04: when the block is absent on a
// profile, the snapshot's tools.ask_claude is undefined (backward-compat with
// all 7 shipping bundles). When the block is present, the snapshot carries a
// typed AskClaudeBlock with operator-overridable defaults from D-13.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProfile, ProfileLoadError } from "@emmy/ux";

const HASH = "sha256:b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-ux-askcl-loader-"));
});
afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeProfile(dir: string, toolsExtras = ""): void {
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
  created: '2026-04-30'
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
tools:
  format: openai
  grammar: null
  per_tool_sampling: {}
${toolsExtras}
agent_loop:
  retry_on_unparseable_tool_call: 2
`,
		"utf8",
	);
	writeFileSync(join(dir, "prompts", "system.md"), "x\n", "utf8");
}

const FULL_ASK_CLAUDE_BLOCK = `  ask_claude:
    enabled: true
    rate_limit_per_turn: 3
    rate_limit_per_hour: 20`;

const MINIMAL_ASK_CLAUDE_BLOCK = `  ask_claude:
    enabled: false`;

// Cast helper: ask_claude is parsed into snapshot but the ProfileSnapshot type
// (in @emmy/provider/src/types.ts) doesn't currently declare it (mirroring
// the web_search precedent — sites cast to read it). This test casts at the
// read site too.
type AskClaudeBlock = {
	enabled: boolean;
	rate_limit_per_turn: number;
	rate_limit_per_hour: number;
};
function readAskClaude(snap: { harness: { tools: unknown } }): AskClaudeBlock | undefined {
	return (snap.harness.tools as { ask_claude?: AskClaudeBlock }).ask_claude;
}

describe("profile-loader — ask_claude block (Plan 04.6-03)", () => {
	test("missing ask_claude block → harness.tools.ask_claude undefined (backward-compat)", async () => {
		const dir = join(tmp, "no-ask-claude");
		writeProfile(dir, "");
		const snap = await loadProfile(dir);
		expect(readAskClaude(snap)).toBeUndefined();
	});

	test("minimal block (enabled: false) parses with defaults", async () => {
		const dir = join(tmp, "minimal");
		writeProfile(dir, MINIMAL_ASK_CLAUDE_BLOCK);
		const snap = await loadProfile(dir);
		const block = readAskClaude(snap);
		expect(block).toBeDefined();
		expect(block!.enabled).toBe(false);
		expect(block!.rate_limit_per_turn).toBe(5);
		expect(block!.rate_limit_per_hour).toBe(30);
	});

	test("full block parses fields", async () => {
		const dir = join(tmp, "full");
		writeProfile(dir, FULL_ASK_CLAUDE_BLOCK);
		const snap = await loadProfile(dir);
		const block = readAskClaude(snap);
		expect(block).toBeDefined();
		expect(block!.enabled).toBe(true);
		expect(block!.rate_limit_per_turn).toBe(3);
		expect(block!.rate_limit_per_hour).toBe(20);
	});

	test("enabled=true with default rate-limits parses (operator opt-in path)", async () => {
		const dir = join(tmp, "enabled-defaults");
		const block = `  ask_claude:
    enabled: true`;
		writeProfile(dir, block);
		const snap = await loadProfile(dir);
		const ac = readAskClaude(snap);
		expect(ac).toBeDefined();
		expect(ac!.enabled).toBe(true);
		expect(ac!.rate_limit_per_turn).toBe(5);
		expect(ac!.rate_limit_per_hour).toBe(30);
	});

	test("invalid rate_limit_per_turn (negative) rejected with dotted-path error", async () => {
		const dir = join(tmp, "bad-rate-turn");
		const bad = `  ask_claude:
    enabled: true
    rate_limit_per_turn: -1`;
		writeProfile(dir, bad);
		await expect(async () => await loadProfile(dir)).toThrow(ProfileLoadError);
		try {
			await loadProfile(dir);
		} catch (e) {
			expect(String(e)).toContain("tools.ask_claude.rate_limit_per_turn");
		}
	});

	test("invalid rate_limit_per_hour (zero) rejected with dotted-path error", async () => {
		const dir = join(tmp, "bad-rate-hour");
		const bad = `  ask_claude:
    enabled: true
    rate_limit_per_hour: 0`;
		writeProfile(dir, bad);
		await expect(async () => await loadProfile(dir)).toThrow(ProfileLoadError);
		try {
			await loadProfile(dir);
		} catch (e) {
			expect(String(e)).toContain("tools.ask_claude.rate_limit_per_hour");
		}
	});

	test("non-boolean enabled rejected with dotted-path error", async () => {
		const dir = join(tmp, "bad-enabled");
		const bad = `  ask_claude:
    enabled: "yes"`;
		writeProfile(dir, bad);
		await expect(async () => await loadProfile(dir)).toThrow(ProfileLoadError);
		try {
			await loadProfile(dir);
		} catch (e) {
			expect(String(e)).toContain("tools.ask_claude.enabled");
		}
	});
});
