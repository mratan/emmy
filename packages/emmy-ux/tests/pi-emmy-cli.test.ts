// packages/emmy-ux/tests/pi-emmy-cli.test.ts
//
// Tests for the pi-emmy CLI (Plan 02-04 Task 2).
//
// Hybrid execution model:
//   - Static CLI behaviors (--help, --print-environment, missing-profile exit 4)
//     run in a real subprocess via spawnSync — these paths don't need network.
//   - Network-touching paths (SP_OK canary, vLLM probe, profile validate) call
//     main() in-process because the test sandbox does not route subprocess
//     fetch() to a parent-process Bun.serve listener. In-process testing
//     exercises the same CLI orchestration logic.
//
// Covered CLI contracts:
//   - --help exits 0 and prints "Usage: pi-emmy"
//   - --print-environment exits 0 and emits valid JSON
//   - Missing profile dir → exit 4, stderr "profile not found"
//   - Unreachable emmy-serve → exit 4, stderr "cannot reach emmy-serve"
//   - W5 prereq: profile-validate failure → exit 4, stderr "profile failed validation"
//   - Happy path: stderr carries "SP_OK canary: OK" + "prompt.sha256=<hex>" +
//     "transcript=" and the transcript file is created on disk.
//   - SP_OK canary failure → exit 1, stderr "SP_OK canary: FAILED"

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Telemetry mock before importing main (session → prompt-assembly → emitEvent).
mock.module("@emmy/telemetry", () => ({ emitEvent: (_r: unknown) => {} }));

import { main } from "../bin/pi-emmy";

const BUN = process.execPath;
const CLI = join(__dirname, "..", "bin", "pi-emmy.ts");

let tmp: string;
let profilePath: string;
let cwd: string;

function writeValidProfile(path: string): void {
  mkdirSync(path, { recursive: true });
  mkdirSync(join(path, "prompts"), { recursive: true });
  writeFileSync(
    join(path, "prompts", "system.md"),
    "You are Emmy.\n",
    "utf8",
  );
  writeFileSync(
    join(path, "profile.yaml"),
    `profile:
  id: gemma-4-26b-a4b-it
  version: v2
  hash: sha256:b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913
  hash_algorithm: sha256
  hash_manifest_version: 1
`,
    "utf8",
  );
  writeFileSync(
    join(path, "serving.yaml"),
    `engine:
  served_model_name: gemma-4-26b-a4b-it
  max_model_len: 131072
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
    "utf8",
  );
  writeFileSync(
    join(path, "harness.yaml"),
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
`,
    "utf8",
  );
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "emmy-ux-cli-"));
  profilePath = join(tmp, "profile");
  cwd = join(tmp, "proj");
  writeValidProfile(profilePath);
  mkdirSync(cwd, { recursive: true });
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---- In-process mock emmy-serve (only reachable from current process) ----
let mockServer: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";
let spOkResponse = "[SP_OK]";
beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (r: Request) => {
      const path = new URL(r.url).pathname;
      if (path === "/v1/models") {
        return new Response(
          JSON.stringify({ data: [{ id: "gemma-4-26b-a4b-it" }] }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (path === "/v1/chat/completions") {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: spOkResponse },
                finish_reason: "stop",
              },
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

// In-process capture of console.log / console.error; we need both, because
// main writes diagnostics to stderr and --print-environment to stdout.
function captureConsole<T>(fn: () => Promise<T> | T): Promise<{ stdout: string; stderr: string; value: T }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => outChunks.push(a.map(String).join(" ") + "\n");
  console.error = (...a: unknown[]) => errChunks.push(a.map(String).join(" ") + "\n");
  // Also capture process.stderr.write (used by prompt-assembly for the sha256 log).
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ..._rest: unknown[]) => {
    errChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return (async () => {
    try {
      const value = await fn();
      return { stdout: outChunks.join(""), stderr: errChunks.join(""), value };
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.stderr.write = origStderrWrite;
    }
  })();
}

describe("pi-emmy CLI — help / environment (subprocess)", () => {
  test("--help exits 0 and prints 'Usage: pi-emmy'", () => {
    const r = spawnSync(BUN, [CLI, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: pi-emmy");
  });

  test("--print-environment exits 0 and emits valid JSON", () => {
    const r = spawnSync(BUN, [CLI, "--print-environment"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const obj = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(obj.pi_emmy_version).toBe("0.1.0");
    expect(typeof obj.cwd).toBe("string");
    expect(typeof obj.base_url).toBe("string");
  });
});

describe("pi-emmy CLI — prereq failures", () => {
  test("missing profile dir → exit 4 with 'profile not found' (subprocess)", () => {
    const r = spawnSync(
      BUN,
      [CLI, "--profile", "/does/not/exist", "--base-url", baseUrl, "--print", "hi"],
      { encoding: "utf8", cwd },
    );
    expect(r.status).toBe(4);
    expect(r.stderr).toContain("profile not found");
  });

  test("unreachable emmy-serve → exit 4 with 'cannot reach emmy-serve' (in-process)", async () => {
    const { stderr, value: code } = await captureConsole(() =>
      main([
        "--profile",
        profilePath,
        "--base-url",
        "http://127.0.0.1:1",
        "--print",
        "hi",
      ]),
    );
    expect(code).toBe(4);
    expect(stderr).toContain("cannot reach emmy-serve");
  });

  test("W5: profile-validate fails → exit 4 with 'profile failed validation' (in-process)", async () => {
    const savedBin = process.env.EMMY_PROFILE_VALIDATE_BIN;
    process.env.EMMY_PROFILE_VALIDATE_BIN = "/bin/false";
    try {
      const { stderr, value: code } = await captureConsole(() =>
        main([
          "--profile",
          profilePath,
          "--base-url",
          baseUrl,
          "--print",
          "hi",
        ]),
      );
      expect(code).toBe(4);
      expect(stderr).toContain("profile failed validation");
    } finally {
      if (savedBin === undefined) delete process.env.EMMY_PROFILE_VALIDATE_BIN;
      else process.env.EMMY_PROFILE_VALIDATE_BIN = savedBin;
    }
  });
});

describe("pi-emmy CLI — runtime paths (in-process)", () => {
  test("happy path: stderr carries canary OK + prompt.sha256= + transcript=, transcript file written", async () => {
    spOkResponse = "[SP_OK]";
    const savedSkip = process.env.EMMY_SKIP_PROFILE_VALIDATE;
    const savedCwd = process.cwd();
    process.env.EMMY_SKIP_PROFILE_VALIDATE = "1";
    process.chdir(cwd);
    try {
      const { stderr } = await captureConsole(() =>
        main([
          "--profile",
          profilePath,
          "--base-url",
          baseUrl,
          "--print",
          "hello",
        ]),
      );
      expect(stderr).toContain("SP_OK canary: OK");
      expect(stderr).toMatch(/prompt\.sha256=[0-9a-f]{64}/);
      expect(stderr).toContain("transcript=");
      expect(existsSync(join(cwd, "runs/phase2-sc3-capture"))).toBe(true);
    } finally {
      process.chdir(savedCwd);
      if (savedSkip === undefined) delete process.env.EMMY_SKIP_PROFILE_VALIDATE;
      else process.env.EMMY_SKIP_PROFILE_VALIDATE = savedSkip;
    }
  });

  test("SP_OK canary failure → exit 1 with 'SP_OK canary: FAILED'", async () => {
    spOkResponse = "Thinking Process: maybe?"; // no [SP_OK]
    const savedSkip = process.env.EMMY_SKIP_PROFILE_VALIDATE;
    const savedCwd = process.cwd();
    process.env.EMMY_SKIP_PROFILE_VALIDATE = "1";
    process.chdir(cwd);
    try {
      const { stderr, value: code } = await captureConsole(() =>
        main([
          "--profile",
          profilePath,
          "--base-url",
          baseUrl,
          "--print",
          "hi",
        ]),
      );
      expect(code).toBe(1);
      expect(stderr).toContain("SP_OK canary: FAILED");
    } finally {
      process.chdir(savedCwd);
      if (savedSkip === undefined) delete process.env.EMMY_SKIP_PROFILE_VALIDATE;
      else process.env.EMMY_SKIP_PROFILE_VALIDATE = savedSkip;
    }
  });
});
