// Plan 02-06 Task 2 — registerNativeTools tests.
// Stubs pi.registerTool; exercises each of the 8 native tools end-to-end against
// a real tempdir filesystem. Covers:
//   - Exactly 8 tools register with names matching NATIVE_TOOL_NAMES
//   - read delegates to readWithHashes (output includes {8hex}  prefix)
//   - write fsyncs + returns bytes_written
//   - edit delegates to editHashline (uses fresh hashes from read round-trip)
//   - bash truncates long output to head+tail with "(truncated" marker
//   - bash denylist blocks dangerous patterns
//   - grep / find / ls spawn and return structured output
//   - web_fetch tool description carries NETWORK_REQUIRED_TAG

import { describe, expect, test, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerNativeTools, NATIVE_TOOL_NAMES } from "../src/native-tools";
import type { PiToolSpec } from "../src/types";

const PROFILE_REF = { id: "qwen3.6-35b-a3b", version: "v2", hash: "sha256:aaaaaaaa" };

// Web mock for web_fetch tool invocation.
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response("hello from mock", { headers: { "content-type": "text/plain" } });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

// Test fixture helper.
function makeStubPi(): {
  pi: { registerTool: (spec: PiToolSpec) => void };
  registered: PiToolSpec[];
} {
  const registered: PiToolSpec[] = [];
  return {
    pi: { registerTool: (spec) => registered.push(spec) },
    registered,
  };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "emmy-native-tools-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// --- Surface registration -------------------------------------------------
describe("registerNativeTools — surface", () => {
  test("NATIVE_TOOL_NAMES is the 8-tool floor + web_search (Plan 03.1-02 D-34)", () => {
    // CLAUDE.md floor: 8 tools. Plan 03.1-02 adds web_search as a profile-
    // gated 9th name — registered only when the profile's tools.web_search
    // block is present AND enabled AND neither kill-switch engages.
    expect([...NATIVE_TOOL_NAMES].sort()).toEqual(
      ["bash", "edit", "find", "grep", "ls", "read", "web_fetch", "web_search", "write"].sort(),
    );
    expect(NATIVE_TOOL_NAMES.length).toBe(9);
  });

  test("8 base tools register without profile opts (web_search is profile-gated)", () => {
    const { pi, registered } = makeStubPi();
    // No webSearchConfig/webSearchEnabled → web_search is NOT registered.
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    expect(registered.length).toBe(8);
    // The 8 base tools = NATIVE_TOOL_NAMES minus web_search.
    const baseSet = new Set(NATIVE_TOOL_NAMES.filter((n) => n !== "web_search"));
    expect(new Set(registered.map((t) => t.name))).toEqual(baseSet);
  });

  test("web_search registers when profile opts enable it (Plan 03.1-02 D-34)", () => {
    const { pi, registered } = makeStubPi();
    // Ensure no kill-switch leaks from prior tests.
    const savedWebSearch = process.env.EMMY_WEB_SEARCH;
    const savedTelemetry = process.env.EMMY_TELEMETRY;
    delete process.env.EMMY_WEB_SEARCH;
    delete process.env.EMMY_TELEMETRY;
    try {
      registerNativeTools(pi, {
        cwd: tmp,
        profileRef: PROFILE_REF,
        webSearchEnabled: true,
        webSearchConfig: {
          baseUrl: "http://127.0.0.1:8888",
          maxResultsDefault: 10,
          rateLimitPerTurn: 10,
          timeoutMs: 10000,
        },
      });
      expect(registered.length).toBe(9);
      expect(new Set(registered.map((t) => t.name))).toEqual(new Set(NATIVE_TOOL_NAMES));
    } finally {
      if (savedWebSearch !== undefined) process.env.EMMY_WEB_SEARCH = savedWebSearch;
      if (savedTelemetry !== undefined) process.env.EMMY_TELEMETRY = savedTelemetry;
    }
  });

  test("each tool has a non-empty string description + JSON-schema-shaped parameters", () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    for (const t of registered) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.parameters).toBe("object");
      expect((t.parameters as { type?: string }).type).toBe("object");
    }
  });

  test("web_fetch description carries NETWORK_REQUIRED_TAG (Phase 3 offline-OK consumer)", () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const webFetch = registered.find((t) => t.name === "web_fetch")!;
    expect(webFetch.description).toContain("network-required");
  });
});

// --- read tool: delegates to readWithHashes ------------------------------
describe("registerNativeTools — read tool", () => {
  test("returns hashed lines with 8-hex prefix (D-07)", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const path = join(tmp, "a.txt");
    writeFileSync(path, "first\nsecond\nthird\n", "utf8");
    const read = registered.find((t) => t.name === "read")!;
    const result = (await read.invoke({ path })) as {
      path: string;
      binary: boolean;
      lines: string;
      line_count: number;
    };
    expect(result.binary).toBe(false);
    expect(result.line_count).toBe(3);
    // D-07: each line prefixed with 8 hex chars + 2 spaces + content.
    for (const line of result.lines.split("\n").filter(Boolean)) {
      expect(line).toMatch(/^[0-9a-f]{8} {2}.+$/);
    }
  });

  test("lineRange narrows output", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const path = join(tmp, "b.txt");
    writeFileSync(path, "l1\nl2\nl3\nl4\nl5\n", "utf8");
    const read = registered.find((t) => t.name === "read")!;
    const result = (await read.invoke({ path, line_range: [2, 3] })) as {
      lines: string;
      line_count: number;
    };
    expect(result.line_count).toBe(2);
    expect(result.lines).toContain("l2");
    expect(result.lines).toContain("l3");
    expect(result.lines).not.toContain("l1");
    expect(result.lines).not.toContain("l4");
  });
});

// --- write tool: atomic overwrite ----------------------------------------
describe("registerNativeTools — write tool", () => {
  test("overwrites file and returns bytes_written", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const path = join(tmp, "out.txt");
    const write = registered.find((t) => t.name === "write")!;
    const result = (await write.invoke({ path, content: "hello\n" })) as {
      path: string;
      bytes_written: number;
    };
    expect(result.path).toBe(path);
    expect(result.bytes_written).toBe(6);
    expect(readFileSync(path, "utf8")).toBe("hello\n");
  });
});

// --- edit tool: delegates to editHashline --------------------------------
describe("registerNativeTools — edit tool (delegates to editHashline)", () => {
  test("hash-anchored replace round-trip: read → edit → re-read", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const path = join(tmp, "code.txt");
    writeFileSync(path, "alpha\nbeta\ngamma\n", "utf8");
    const read = registered.find((t) => t.name === "read")!;
    const edit = registered.find((t) => t.name === "edit")!;
    // Capture the hash of the middle line.
    const r1 = (await read.invoke({ path })) as { lines: string };
    const betaLine = r1.lines
      .split("\n")
      .find((l) => l.endsWith("  beta"));
    expect(betaLine).toBeDefined();
    const betaHash = betaLine!.slice(0, 8);
    // Replace it.
    const editResult = (await edit.invoke({
      path,
      edits: [{ hash: betaHash, new_content: "BETA_REPLACED" }],
    })) as { applied: { edits: number; inserts: number }; diff: string };
    expect(editResult.applied.edits).toBe(1);
    expect(editResult.diff).toContain("-beta");
    expect(editResult.diff).toContain("+BETA_REPLACED");
    expect(readFileSync(path, "utf8")).toBe("alpha\nBETA_REPLACED\ngamma\n");
  });
});

// --- bash tool: spawnSync + truncation + denylist ------------------------
describe("registerNativeTools — bash tool", () => {
  test("short output returned verbatim", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const bash = registered.find((t) => t.name === "bash")!;
    const r = (await bash.invoke({ command: "echo hello" })) as {
      stdout: string;
      exit_code: number;
    };
    expect(r.stdout).toContain("hello");
    expect(r.exit_code).toBe(0);
  });

  test("long stdout (>100 lines) truncated with head+tail marker", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const bash = registered.find((t) => t.name === "bash")!;
    // Produce ~1000 lines of output. `yes | head -n 1000` is the canonical form.
    const r = (await bash.invoke({
      command: "yes | head -n 1000",
    })) as { stdout: string; exit_code: number };
    // Truncation marker present (per spec: "…(truncated …)…" in the middle).
    expect(r.stdout).toContain("truncated");
    // Total lines in stdout after truncation ≤ head+tail+marker (50 + 50 + 1 + newlines).
    const lineCount = r.stdout.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(102);
  });

  test("denylist blocks 'rm -rf /'", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const bash = registered.find((t) => t.name === "bash")!;
    await expect(bash.invoke({ command: "rm -rf /" })).rejects.toThrow(/denylist/);
  });

  test("denylist blocks fork-bomb signature", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const bash = registered.find((t) => t.name === "bash")!;
    await expect(bash.invoke({ command: ":(){ :|: & };:" })).rejects.toThrow(/denylist/);
  });

  test("custom bashDenylist entries honored in addition to defaults", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, {
      cwd: tmp,
      profileRef: PROFILE_REF,
      bashDenylist: ["^npm publish"],
    });
    const bash = registered.find((t) => t.name === "bash")!;
    await expect(bash.invoke({ command: "npm publish emmy" })).rejects.toThrow(/denylist/);
  });

  // Regression: `pkill -f <pattern>` must not SIGKILL its own host shell
  // when <pattern> appears as a literal substring of the command text.
  // Pre-fix `spawnSync("sh", ["-c", cmd])` put the script body in sh's
  // argv, so /proc/<sh>/cmdline matched pkill's pattern. Observed against
  // Gemma 4 on 2026-04-24 restarting a python http.server — every run
  // returned {exit_code:-1, signal:"SIGKILL"} in 0.0s.
  test("pkill -f with pattern matching the command text does not self-kill", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const bash = registered.find((t) => t.name === "bash")!;
    // The script's pkill pattern appears literally later in the same script.
    // Pre-fix this SIGKILL'd the hosting shell before `echo survived` ran.
    const r = (await bash.invoke({
      command:
        "pkill -9 -f 'nonexistent_pattern_for_emmy_bashtool_selfkill_test' 2>/dev/null; echo survived",
    })) as { stdout: string; exit_code: number; signal: string | null };
    expect(r.stdout).toContain("survived");
    expect(r.signal).toBeNull();
  });
});

// --- grep / find / ls ----------------------------------------------------
describe("registerNativeTools — grep/find/ls", () => {
  test("grep finds matches", async () => {
    writeFileSync(join(tmp, "f.txt"), "hello world\nfoo bar\nhello again\n", "utf8");
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const grep = registered.find((t) => t.name === "grep")!;
    const r = (await grep.invoke({ pattern: "hello", path: tmp })) as {
      stdout: string;
      exit_code: number;
    };
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toContain("hello world");
    expect(r.stdout).toContain("hello again");
  });

  test("find locates files by name", async () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "target.txt"), "x", "utf8");
    writeFileSync(join(tmp, "other.md"), "y", "utf8");
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const find = registered.find((t) => t.name === "find")!;
    const r = (await find.invoke({ path: tmp, name: "target.txt" })) as {
      stdout: string;
      exit_code: number;
    };
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toContain("target.txt");
    expect(r.stdout).not.toContain("other.md");
  });

  test("ls lists directory contents", async () => {
    writeFileSync(join(tmp, "a.txt"), "x", "utf8");
    writeFileSync(join(tmp, "b.txt"), "y", "utf8");
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const ls = registered.find((t) => t.name === "ls")!;
    const r = (await ls.invoke({ path: tmp })) as { stdout: string; exit_code: number };
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toContain("a.txt");
    expect(r.stdout).toContain("b.txt");
  });
});

// --- web_fetch tool ------------------------------------------------------
describe("registerNativeTools — web_fetch tool", () => {
  test("invoke hits the mock and returns markdown", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const webFetch = registered.find((t) => t.name === "web_fetch")!;
    const r = (await webFetch.invoke({ url: baseUrl })) as {
      markdown: string;
      contentType: string;
      url: string;
    };
    expect(r.markdown).toBe("hello from mock");
    expect(r.url).toBe(`${baseUrl}/`);
  });
});

// --- write tool: fsync evidence ------------------------------------------
describe("registerNativeTools — write tool fsync path", () => {
  test("file exists and size is accurate after write", async () => {
    const { pi, registered } = makeStubPi();
    registerNativeTools(pi, { cwd: tmp, profileRef: PROFILE_REF });
    const write = registered.find((t) => t.name === "write")!;
    const path = join(tmp, "fsync.txt");
    await write.invoke({ path, content: "aaa" });
    const st = statSync(path);
    expect(st.size).toBe(3);
  });
});
