// packages/emmy-ux/tests/session-transcript.test.ts
//
// RED tests for session-transcript (Plan 02-04 Task 1; B2 fix).
//   - openTranscript creates ${cwd}/runs/phase2-sc3-capture/ if absent; returns an absolute path
//     ending in session-<iso-safe-ts>.jsonl
//   - appendSessionTurn writes one valid JSON line per call
//   - Multiple calls produce a parseable JSONL file
//   - Parent dir auto-created when appending to a freshly-computed path

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { appendSessionTurn, openTranscript, transcriptDir } from "@emmy/ux";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "emmy-ux-transcript-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("transcriptDir constant", () => {
  test("is 'runs/phase2-sc3-capture' (Plan 08 SC-3 corpus feed path)", () => {
    expect(transcriptDir).toBe("runs/phase2-sc3-capture");
  });
});

describe("openTranscript", () => {
  test("creates runs/phase2-sc3-capture/ under cwd if absent; returns absolute jsonl path", () => {
    const { path } = openTranscript(tmp);
    expect(isAbsolute(path)).toBe(true);
    expect(path).toContain("runs/phase2-sc3-capture/");
    expect(path.endsWith(".jsonl")).toBe(true);
    // Filename should match session-<iso-safe>.jsonl
    expect(path).toMatch(/session-[0-9TZ.\-]+\.jsonl$/);
    expect(existsSync(join(tmp, "runs/phase2-sc3-capture"))).toBe(true);
  });

  test("two sequential calls produce distinct filenames (iso timestamp)", async () => {
    const a = openTranscript(tmp).path;
    // Wait a few ms to advance the iso timestamp; iso granularity is ms.
    await new Promise((r) => setTimeout(r, 5));
    const b = openTranscript(tmp).path;
    expect(a).not.toBe(b);
  });
});

describe("appendSessionTurn", () => {
  test("writes a single JSON line per call", () => {
    const { path } = openTranscript(tmp);
    appendSessionTurn(path, { role: "user", content: "hello" });
    const raw = readFileSync(path, "utf8");
    expect(raw).toMatch(/\n$/);
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const turn = JSON.parse(lines[0]!) as { role: string; content: string; ts: string };
    expect(turn.role).toBe("user");
    expect(turn.content).toBe("hello");
    expect(typeof turn.ts).toBe("string");
  });

  test("multiple calls build a parseable JSONL file", () => {
    const { path } = openTranscript(tmp);
    appendSessionTurn(path, { role: "user", content: "first" });
    appendSessionTurn(path, { role: "assistant", content: "second" });
    appendSessionTurn(path, {
      role: "tool",
      tool_call_id: "call_1",
      content: "third",
    });
    const raw = readFileSync(path, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      // Each line parses as JSON.
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const parsed = lines.map((l) => JSON.parse(l) as { role: string; content?: string });
    expect(parsed[0]?.role).toBe("user");
    expect(parsed[1]?.role).toBe("assistant");
    expect(parsed[2]?.role).toBe("tool");
  });

  test("non-existent parent dir is auto-created", () => {
    // Use a path whose parent dir doesn't exist yet.
    const path = join(tmp, "does/not/exist/session.jsonl");
    expect(existsSync(join(tmp, "does"))).toBe(false);
    appendSessionTurn(path, { role: "user", content: "x" });
    expect(existsSync(path)).toBe(true);
  });

  test("preserves optional profile field when provided", () => {
    const { path } = openTranscript(tmp);
    const profile = { id: "qwen3.6-35b-a3b", version: "v2", hash: "sha256:abc" };
    appendSessionTurn(path, { role: "system", content: "hi", profile });
    const line = readFileSync(path, "utf8").trim();
    const parsed = JSON.parse(line) as { profile: typeof profile };
    expect(parsed.profile).toEqual(profile);
  });
});
