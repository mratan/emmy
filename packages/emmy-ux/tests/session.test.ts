// packages/emmy-ux/tests/session.test.ts
//
// RED unit tests for createEmmySession (Plan 02-04 Task 2) — uses an injected
// piFactory so the test doesn't depend on real pi-coding-agent runtime state.
// The real-pi integration is exercised in session.integration.test.ts.
//
// Covers:
//   - SP_OK gate fires first; failure throws SpOkCanaryError with the response.
//   - Provider registered before native tools; native tools before MCP.
//   - AGENTS.md discovery: cwd/AGENTS.md > cwd/.pi/SYSTEM.md > null.
//   - Transcript file is opened under runs/phase2-sc3-capture/ and the initial
//     system record is appended.
//   - Tool-call turn events coming from pi.on(...) are appended to the transcript.
//   - Returns { runtime, assembledPrompt, spOkOk:true, transcriptPath }.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Telemetry mock BEFORE the package import so session.ts + prompt-assembly.ts pick it up.
const emitted: unknown[] = [];
mock.module("@emmy/telemetry", () => ({
  emitEvent: (r: unknown) => {
    emitted.push(r);
  },
}));

import { createEmmySession, SpOkCanaryError, type ProfileSnapshot } from "@emmy/ux";

function makeProfile(path: string): ProfileSnapshot {
  return {
    ref: {
      id: "qwen3.6-35b-a3b",
      version: "v2",
      hash: "sha256:abc",
      path,
    },
    serving: {
      engine: { served_model_name: "qwen3.6-35b-a3b", max_model_len: 131072 },
      sampling_defaults: { temperature: 0.2, top_p: 0.95, max_tokens: 8192, stop: [] },
      quirks: { strip_thinking_tags: false, promote_reasoning_to_content: false, buffer_tool_streams: false },
    },
    harness: {
      tools: { format: "openai", grammar: null, per_tool_sampling: {} },
      agent_loop: { retry_on_unparseable_tool_call: 2 },
    },
  };
}

let tmp: string;
let profilePath: string;
let cwd: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "emmy-ux-session-"));
  profilePath = join(tmp, "profile");
  cwd = join(tmp, "proj");
  mkdirSync(profilePath, { recursive: true });
  mkdirSync(join(profilePath, "prompts"), { recursive: true });
  writeFileSync(
    join(profilePath, "prompts", "system.md"),
    "You are Emmy. Echo [SP_OK] when the user says 'ping'.\n",
    "utf8",
  );
  mkdirSync(cwd, { recursive: true });
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Shared mock SP_OK server (returns [SP_OK] unless configured to fail).
let mockServer: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";
let spOkResponse: string = "[SP_OK]";
beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    fetch: async (r: Request) => {
      if (new URL(r.url).pathname.endsWith("/v1/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              { message: { role: "assistant", content: spOkResponse }, finish_reason: "stop" },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
  });
  baseUrl = `http://127.0.0.1:${mockServer!.port}`;
});
afterAll(() => {
  try {
    mockServer?.stop(true);
  } catch {
    /* ignore */
  }
});

// Minimal PiRuntime stub — tracks registerProvider / registerTool / on calls.
type RegistrationLog = Array<{ kind: string; args: unknown[] }>;
function makeStubPiFactory(log: RegistrationLog, handlers: Record<string, Array<(...args: unknown[]) => void>>) {
  return () => ({
    registerProvider: (name: string, impl: unknown) => {
      log.push({ kind: "registerProvider", args: [name, impl] });
    },
    registerTool: (spec: { name?: unknown }) => {
      log.push({ kind: "registerTool", args: [spec.name] });
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      (handlers[event] ||= []).push(handler);
      log.push({ kind: "on", args: [event] });
    },
    // optional
    run: async (_prompt: string, _opts?: { mode: "print" | "json" }) => ({ text: "done" }),
    runTui: async () => {},
  });
}

describe("createEmmySession — SP_OK gate", () => {
  test("happy path: SP_OK passes, session returns runtime + transcript + assembledPrompt", async () => {
    spOkResponse = "[SP_OK]";
    const log: RegistrationLog = [];
    const out = await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      piFactory: makeStubPiFactory(log, {}),
    });
    expect(out.spOkOk).toBe(true);
    expect(out.runtime).toBeDefined();
    expect(typeof out.assembledPrompt.sha256).toBe("string");
    expect(out.assembledPrompt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.transcriptPath).toContain("runs/phase2-sc3-capture/");
    expect(existsSync(out.transcriptPath)).toBe(true);
  });

  test("SP_OK fails → throws SpOkCanaryError with the response text", async () => {
    spOkResponse = "Thinking Process: maybe hi?";
    const log: RegistrationLog = [];
    let thrown: unknown;
    try {
      await createEmmySession({
        profile: makeProfile(profilePath),
        baseUrl,
        cwd,
        mode: "tui",
        piFactory: makeStubPiFactory(log, {}),
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SpOkCanaryError);
    // When SP_OK fails, pi runtime should not have been constructed.
    expect(log.filter((l) => l.kind === "registerProvider").length).toBe(0);
  });
});

describe("createEmmySession — registration order", () => {
  test("order: registerProvider → registerTool (×8+) → (mcp registerTool) → pi.on(...)", async () => {
    spOkResponse = "[SP_OK]";
    const log: RegistrationLog = [];
    await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      piFactory: makeStubPiFactory(log, {}),
    });
    const firstProvider = log.findIndex((l) => l.kind === "registerProvider");
    const firstTool = log.findIndex((l) => l.kind === "registerTool");
    const firstOn = log.findIndex((l) => l.kind === "on");
    expect(firstProvider).toBeGreaterThanOrEqual(0);
    expect(firstTool).toBeGreaterThanOrEqual(0);
    expect(firstProvider).toBeLessThan(firstTool);
    if (firstOn >= 0) expect(firstTool).toBeLessThan(firstOn);

    // At least the 8-tool native floor is registered.
    const toolNames = log
      .filter((l) => l.kind === "registerTool")
      .map((l) => l.args[0] as string);
    for (const expected of ["read", "write", "edit", "bash", "grep", "find", "ls", "web_fetch"]) {
      expect(toolNames).toContain(expected);
    }
  });
});

describe("createEmmySession — AGENTS.md discovery", () => {
  test("./AGENTS.md wins over ./.pi/SYSTEM.md", async () => {
    spOkResponse = "[SP_OK]";
    writeFileSync(join(cwd, "AGENTS.md"), "# project AGENTS.md\n", "utf8");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "SYSTEM.md"), "# fallback\n", "utf8");
    const log: RegistrationLog = [];
    const out = await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      piFactory: makeStubPiFactory(log, {}),
    });
    expect(out.assembledPrompt.agents_md_path).toBe(join(cwd, "AGENTS.md"));
    const agentsLayer = out.assembledPrompt.layers.find((l) => l.name === "AGENTS.md");
    expect(agentsLayer?.present).toBe(true);
  });

  test("./.pi/SYSTEM.md used when ./AGENTS.md missing", async () => {
    spOkResponse = "[SP_OK]";
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "SYSTEM.md"), "# pi system\n", "utf8");
    const log: RegistrationLog = [];
    const out = await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      piFactory: makeStubPiFactory(log, {}),
    });
    expect(out.assembledPrompt.agents_md_path).toBe(join(cwd, ".pi", "SYSTEM.md"));
  });

  test("neither → AGENTS.md layer marked present:false", async () => {
    spOkResponse = "[SP_OK]";
    const log: RegistrationLog = [];
    const out = await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      piFactory: makeStubPiFactory(log, {}),
    });
    const agentsLayer = out.assembledPrompt.layers.find((l) => l.name === "AGENTS.md");
    expect(agentsLayer?.present).toBe(false);
  });
});

describe("createEmmySession — transcript capture (B2)", () => {
  test("initial system record is appended to transcript on session open", async () => {
    spOkResponse = "[SP_OK]";
    const log: RegistrationLog = [];
    const out = await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      piFactory: makeStubPiFactory(log, {}),
    });
    const contents = readFileSync(out.transcriptPath, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const firstTurn = JSON.parse(lines[0]!) as { role: string; profile: { id: string } };
    expect(firstTurn.role).toBe("system");
    expect(firstTurn.profile.id).toBe("qwen3.6-35b-a3b");
  });

  test("pi.on('turn'|'tool_call'|'tool_result') emissions append to transcript", async () => {
    spOkResponse = "[SP_OK]";
    const log: RegistrationLog = [];
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const out = await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      piFactory: makeStubPiFactory(log, handlers),
    });
    // Simulate pi emitting a tool-call turn.
    (handlers.tool_call ?? []).forEach((h) => h({ role: "assistant", tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: "{}" } }] }));
    (handlers.tool_result ?? []).forEach((h) => h({ role: "tool", tool_call_id: "t1", content: "ok" }));
    const raw = readFileSync(out.transcriptPath, "utf8");
    const lines = raw.trim().split("\n").map((l) => JSON.parse(l) as { role: string });
    // Initial system + assistant tool_call + tool result
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.some((l) => l.role === "assistant")).toBe(true);
    expect(lines.some((l) => l.role === "tool")).toBe(true);
  });
});
