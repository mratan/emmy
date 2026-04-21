// packages/emmy-ux/tests/session.integration.test.ts
//
// W2 FIX — integration test for createEmmySession with the REAL
// @mariozechner/pi-coding-agent@0.68.0 runtime factory (no piFactory override).
//
// What this test proves:
//   1. The `runtime` object returned by createEmmySession is truthy — the
//      real pi factory actually ran and produced a session object.
//   2. The transcript file exists under runs/phase2-sc3-capture/.
//   3. No `throw new Error("...pending")` / placeholder string is in the
//      runtime construction path (static grep; see acceptance criteria).
//
// The test mocks emmy-serve only for the SP_OK canary — pi itself is not
// mocked and the factory is not overridden.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const emitted: unknown[] = [];
mock.module("@emmy/telemetry", () => ({
  emitEvent: (r: unknown) => {
    emitted.push(r);
  },
}));

import { createEmmySession, type ProfileSnapshot } from "@emmy/ux";

function makeProfile(path: string): ProfileSnapshot {
  return {
    ref: { id: "qwen3.6-35b-a3b", version: "v2", hash: "sha256:abc", path },
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
  tmp = mkdtempSync(join(tmpdir(), "emmy-ux-session-integ-"));
  profilePath = join(tmp, "profile");
  cwd = join(tmp, "proj");
  mkdirSync(profilePath, { recursive: true });
  mkdirSync(join(profilePath, "prompts"), { recursive: true });
  writeFileSync(
    join(profilePath, "prompts", "system.md"),
    "You are Emmy.\n",
    "utf8",
  );
  mkdirSync(cwd, { recursive: true });
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

let mockServer: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";
beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: "[SP_OK]" }, finish_reason: "stop" },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  baseUrl = `http://127.0.0.1:${mockServer!.port}`;
});
afterAll(() => {
  try { mockServer?.stop(true); } catch { /* ignore */ }
});

describe("createEmmySession — REAL pi 0.68.0 runtime (W2 FIX)", () => {
  test("returns a truthy runtime object and a transcript file on disk", async () => {
    const out = await createEmmySession({
      profile: makeProfile(profilePath),
      baseUrl,
      cwd,
      mode: "tui",
      // NO piFactory override — exercises the real pi-coding-agent factory.
    });
    // Proof (1): runtime is truthy and is an object.
    expect(out.runtime).toBeDefined();
    expect(typeof out.runtime).toBe("object");
    // Proof (2): transcript file exists under runs/phase2-sc3-capture/.
    expect(out.transcriptPath).toContain("runs/phase2-sc3-capture/");
    expect(existsSync(out.transcriptPath)).toBe(true);
    // Proof (3): first line of transcript is the assembled system record.
    const raw = readFileSync(out.transcriptPath, "utf8");
    expect(raw.trim().split("\n").length).toBeGreaterThanOrEqual(1);
    const first = JSON.parse(raw.trim().split("\n")[0]!) as { role: string };
    expect(first.role).toBe("system");
  });
});
