// packages/emmy-ux/tests/prompt-assembly.test.ts
//
// RED tests for assemblePrompt (Plan 02-04 Task 1).
//   - 3-layer order locked: system.md → AGENTS.md → tool_defs → user (CONTEXT-04).
//   - AGENTS.md absent → layer emitted as {present:false, tokens_approx:0}.
//   - Determinism: same input → same sha256.
//   - stderr log line: `prompt.assembled sha256=<hex>` written to process.stderr.
//   - emitEvent called with event:"prompt.assembled", sha256, layers.

import { describe, expect, mock, test } from "bun:test";

// Mock @emmy/telemetry BEFORE importing @emmy/ux so prompt-assembly captures the mock.
const emittedEvents: unknown[] = [];
mock.module("@emmy/telemetry", () => ({
  emitEvent: (r: unknown) => {
    emittedEvents.push(r);
  },
}));

import { assemblePrompt } from "@emmy/ux";

describe("assemblePrompt — layer order (CONTEXT-04 locked)", () => {
  test("returns 4 layers in locked order: system.md → AGENTS.md → tool_defs → user", () => {
    const out = assemblePrompt({
      profileSystemMd: "SYSTEM",
      agentsMd: "AGENTS",
      agentsMdPath: "/tmp/AGENTS.md",
      toolDefsText: "TOOLS",
      userPrompt: "USER",
    });
    const names = out.layers.map((l) => l.name);
    expect(names).toEqual(["system.md", "AGENTS.md", "tool_defs", "user"]);
    // All four present here.
    expect(out.layers.every((l) => l.present)).toBe(true);
    // text concatenates in order.
    const idxSystem = out.text.indexOf("SYSTEM");
    const idxAgents = out.text.indexOf("AGENTS");
    const idxTools = out.text.indexOf("TOOLS");
    const idxUser = out.text.indexOf("USER");
    expect(idxSystem).toBeGreaterThanOrEqual(0);
    expect(idxSystem).toBeLessThan(idxAgents);
    expect(idxAgents).toBeLessThan(idxTools);
    expect(idxTools).toBeLessThan(idxUser);
  });

  test("AGENTS.md absent → emitted as {present:false, tokens_approx:0}", () => {
    const out = assemblePrompt({
      profileSystemMd: "SYSTEM",
      agentsMd: null,
      agentsMdPath: null,
      toolDefsText: "TOOLS",
      userPrompt: "USER",
    });
    const agentsLayer = out.layers.find((l) => l.name === "AGENTS.md")!;
    expect(agentsLayer.present).toBe(false);
    expect(agentsLayer.tokens_approx).toBe(0);
    expect(out.agents_md_path).toBeUndefined();
  });

  test("agents_md_path is returned when AGENTS.md is present", () => {
    const out = assemblePrompt({
      profileSystemMd: "SYSTEM",
      agentsMd: "A",
      agentsMdPath: "/proj/AGENTS.md",
      toolDefsText: "T",
      userPrompt: "U",
    });
    expect(out.agents_md_path).toBe("/proj/AGENTS.md");
  });
});

describe("assemblePrompt — sha256 + determinism (SC-5)", () => {
  test("sha256 is 64-hex", () => {
    const out = assemblePrompt({
      profileSystemMd: "a",
      agentsMd: null,
      agentsMdPath: null,
      toolDefsText: "b",
    });
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("same input → same sha256", () => {
    const opts = {
      profileSystemMd: "SYSTEM",
      agentsMd: "AGENTS",
      agentsMdPath: "/p/AGENTS.md",
      toolDefsText: "TOOLS",
      userPrompt: "USER",
    };
    const a = assemblePrompt(opts);
    const b = assemblePrompt(opts);
    expect(a.sha256).toBe(b.sha256);
    expect(a.text).toBe(b.text);
  });

  test("different AGENTS.md → different sha256", () => {
    const a = assemblePrompt({
      profileSystemMd: "SYSTEM",
      agentsMd: "A1",
      agentsMdPath: "/p/AGENTS.md",
      toolDefsText: "TOOLS",
    });
    const b = assemblePrompt({
      profileSystemMd: "SYSTEM",
      agentsMd: "A2",
      agentsMdPath: "/p/AGENTS.md",
      toolDefsText: "TOOLS",
    });
    expect(a.sha256).not.toBe(b.sha256);
  });
});

describe("assemblePrompt — token approximation + logging", () => {
  test("tokens_approx = ceil(layer_text.length / 4)", () => {
    const out = assemblePrompt({
      profileSystemMd: "x".repeat(8),
      agentsMd: null,
      agentsMdPath: null,
      toolDefsText: "y".repeat(12),
    });
    const systemLayer = out.layers.find((l) => l.name === "system.md")!;
    const toolsLayer = out.layers.find((l) => l.name === "tool_defs")!;
    expect(systemLayer.tokens_approx).toBe(2); // 8/4
    expect(toolsLayer.tokens_approx).toBe(3); // 12/4
  });

  test("writes `prompt.assembled sha256=<hex>` to stderr on every call (HARNESS-06)", () => {
    const chunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown, ..._rest: unknown[]) => {
      chunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      assemblePrompt({
        profileSystemMd: "S",
        agentsMd: null,
        agentsMdPath: null,
        toolDefsText: "T",
      });
    } finally {
      process.stderr.write = origWrite;
    }
    const joined = chunks.join("");
    expect(joined).toMatch(/prompt\.assembled sha256=[0-9a-f]{64}/);
  });

  test("emitEvent called with event='prompt.assembled', sha256, layers", () => {
    emittedEvents.length = 0;
    const out = assemblePrompt({
      profileSystemMd: "S",
      agentsMd: null,
      agentsMdPath: null,
      toolDefsText: "T",
    });
    const evt = emittedEvents.find(
      (e) => (e as { event?: string }).event === "prompt.assembled",
    ) as { event: string; sha256: string; layers: unknown[] } | undefined;
    expect(evt).toBeDefined();
    expect(evt?.sha256).toBe(out.sha256);
    expect(Array.isArray(evt?.layers)).toBe(true);
    expect(evt?.layers).toHaveLength(4);
  });
});
