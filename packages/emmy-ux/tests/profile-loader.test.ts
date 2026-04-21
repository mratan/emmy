// packages/emmy-ux/tests/profile-loader.test.ts
//
// RED tests for loadProfile (Plan 02-04 Task 1).
//   - Happy path: stub profile with nested grammar + required max_model_len
//   - W4 FIX: omit serving.engine.max_model_len -> ProfileLoadError
//   - B3 FIX: nested grammar {path, mode} accepted; null accepted; flattened string rejected;
//     invalid mode rejected.
//   - Missing profile dir -> ProfileLoadError
//   - Malformed YAML -> ProfileLoadError with dotted path

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProfile, ProfileLoadError } from "@emmy/ux";

const HASH = "sha256:b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "emmy-ux-profile-loader-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeProfile(
  dir: string,
  overrides: {
    profileYaml?: string;
    servingYaml?: string;
    harnessYaml?: string;
    promptsSystemMd?: string;
  } = {},
): void {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "prompts"), { recursive: true });
  const profileYaml =
    overrides.profileYaml ??
    `profile:
  id: qwen3.6-35b-a3b
  version: v2
  family: qwen3.6
  base_model: Qwen/Qwen3.6-35B-A3B-FP8
  description: test
  created: '2026-04-21'
  hash: ${HASH}
  hash_algorithm: sha256
  hash_manifest_version: 1
  tags: [coding, fp8]
`;
  const servingYaml =
    overrides.servingYaml ??
    `engine:
  served_model_name: qwen3.6-35b-a3b
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
`;
  const harnessYaml =
    overrides.harnessYaml ??
    `prompts:
  system: prompts/system.md
context:
  max_input_tokens: 114688
tools:
  format: openai
  grammar: null
  per_tool_sampling: {}
agent_loop:
  retry_on_unparseable_tool_call: 2
`;
  writeFileSync(join(dir, "profile.yaml"), profileYaml, "utf8");
  writeFileSync(join(dir, "serving.yaml"), servingYaml, "utf8");
  writeFileSync(join(dir, "harness.yaml"), harnessYaml, "utf8");
  writeFileSync(
    join(dir, "prompts", "system.md"),
    overrides.promptsSystemMd ?? "You are Emmy.\n",
    "utf8",
  );
}

describe("loadProfile — happy path", () => {
  test("returns a populated ProfileSnapshot for a well-formed bundle", async () => {
    const dir = join(tmp, "v2");
    writeProfile(dir);
    const snap = await loadProfile(dir);
    expect(snap.ref.id).toBe("qwen3.6-35b-a3b");
    expect(snap.ref.version).toBe("v2");
    expect(snap.ref.hash).toBe(HASH);
    expect(snap.ref.path).toBe(dir);
    expect(snap.serving.engine.served_model_name).toBe("qwen3.6-35b-a3b");
    expect(snap.serving.engine.max_model_len).toBe(131072);
    expect(snap.serving.sampling_defaults.temperature).toBe(0.2);
    expect(snap.serving.sampling_defaults.top_p).toBe(0.95);
    expect(snap.serving.sampling_defaults.max_tokens).toBe(8192);
    expect(snap.harness.tools.format).toBe("openai");
    expect(snap.harness.tools.grammar).toBeNull();
    expect(snap.harness.agent_loop.retry_on_unparseable_tool_call).toBe(2);
  });
});

describe("loadProfile — W4: required max_model_len", () => {
  test("missing serving.engine.max_model_len → ProfileLoadError", async () => {
    const dir = join(tmp, "v2");
    writeProfile(dir, {
      servingYaml: `engine:
  served_model_name: qwen3.6-35b-a3b
sampling_defaults:
  temperature: 0.2
  top_p: 0.95
  max_tokens: 8192
  stop: []
quirks:
  strip_thinking_tags: false
  promote_reasoning_to_content: false
  buffer_tool_streams: false
`,
    });
    let thrown: unknown;
    try {
      await loadProfile(dir);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProfileLoadError);
    expect((thrown as Error).message).toContain("max_model_len");
  });
});

describe("loadProfile — B3: nested grammar {path, mode}", () => {
  test("nested {path, mode:'reactive'} → returned as {path, mode}", async () => {
    const dir = join(tmp, "v2");
    writeProfile(dir, {
      harnessYaml: `prompts:
  system: prompts/system.md
context:
  max_input_tokens: 114688
tools:
  format: openai
  grammar:
    path: grammars/tool_call.lark
    mode: reactive
  per_tool_sampling: {}
agent_loop:
  retry_on_unparseable_tool_call: 2
`,
    });
    const snap = await loadProfile(dir);
    expect(snap.harness.tools.grammar).toEqual({
      path: "grammars/tool_call.lark",
      mode: "reactive",
    });
  });

  test("grammar: null → returned as null", async () => {
    const dir = join(tmp, "v2");
    writeProfile(dir);
    const snap = await loadProfile(dir);
    expect(snap.harness.tools.grammar).toBeNull();
  });

  test("B3: pre-revision flattened string shape → ProfileLoadError dotted path tools.grammar", async () => {
    const dir = join(tmp, "v2");
    writeProfile(dir, {
      harnessYaml: `prompts:
  system: prompts/system.md
context:
  max_input_tokens: 114688
tools:
  format: openai
  grammar: "grammars/tool_call.lark"
  per_tool_sampling: {}
agent_loop:
  retry_on_unparseable_tool_call: 2
`,
    });
    let thrown: unknown;
    try {
      await loadProfile(dir);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProfileLoadError);
    expect((thrown as Error).message).toContain("tools.grammar");
    expect((thrown as Error).message).toMatch(/must be a mapping with path \+ mode, or null/);
  });

  test("B3: invalid mode → ProfileLoadError dotted path tools.grammar.mode; enumerates accepted modes", async () => {
    const dir = join(tmp, "v2");
    writeProfile(dir, {
      harnessYaml: `prompts:
  system: prompts/system.md
context:
  max_input_tokens: 114688
tools:
  format: openai
  grammar:
    path: grammars/tool_call.lark
    mode: always_on
  per_tool_sampling: {}
agent_loop:
  retry_on_unparseable_tool_call: 2
`,
    });
    let thrown: unknown;
    try {
      await loadProfile(dir);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProfileLoadError);
    expect((thrown as Error).message).toContain("tools.grammar.mode");
    expect((thrown as Error).message).toContain("reactive");
    expect((thrown as Error).message).toContain("disabled");
  });
});

describe("loadProfile — failures", () => {
  test("non-existent profileDir → ProfileLoadError", async () => {
    let thrown: unknown;
    try {
      await loadProfile(join(tmp, "does-not-exist"));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProfileLoadError);
    expect((thrown as Error).message).toContain("not found");
  });

  test("malformed YAML → ProfileLoadError with dotted path", async () => {
    const dir = join(tmp, "v2");
    writeProfile(dir);
    writeFileSync(join(dir, "serving.yaml"), "engine:\n  served_model_name: [unclosed\n", "utf8");
    let thrown: unknown;
    try {
      await loadProfile(dir);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ProfileLoadError);
    expect((thrown as Error).message).toContain("serving.yaml");
  });
});
