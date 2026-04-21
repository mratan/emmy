// Plan 02-06 Task 1 — layered MCP config loader (D-16).
// Tests: user-only, project-only, both-disjoint, both-overlap (project wins),
// schema validation (command/args/env shape), $VAR preservation, alias preserved.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServersConfig } from "../src/mcp-config";
import { McpServersConfigError } from "../src/errors";

let tmpRoot: string;
let userHome: string;
let projectRoot: string;

function writeUserYaml(yaml: string): string {
  const dir = join(userHome, ".emmy");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "mcp_servers.yaml");
  writeFileSync(p, yaml, "utf8");
  return p;
}

function writeProjectYaml(yaml: string): string {
  const dir = join(projectRoot, ".emmy");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "mcp_servers.yaml");
  writeFileSync(p, yaml, "utf8");
  return p;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "emmy-mcp-config-"));
  userHome = join(tmpRoot, "home");
  projectRoot = join(tmpRoot, "project");
  mkdirSync(userHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("loadMcpServersConfig — empty cases", () => {
  test("neither file exists → empty servers", () => {
    const cfg = loadMcpServersConfig({ userHome, projectRoot });
    expect(cfg.servers).toEqual({});
  });
});

describe("loadMcpServersConfig — single-file cases", () => {
  test("user-only file → returns its servers", () => {
    writeUserYaml(`
servers:
  filesystem:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "/tmp"
`);
    const cfg = loadMcpServersConfig({ userHome, projectRoot });
    expect(Object.keys(cfg.servers).sort()).toEqual(["filesystem"]);
    expect(cfg.servers.filesystem!.command).toBe("npx");
    expect(cfg.servers.filesystem!.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp",
    ]);
  });

  test("project-only file → returns its servers", () => {
    writeProjectYaml(`
servers:
  playwright:
    command: npx
    args: ["@playwright/mcp"]
`);
    const cfg = loadMcpServersConfig({ userHome, projectRoot });
    expect(Object.keys(cfg.servers).sort()).toEqual(["playwright"]);
    expect(cfg.servers.playwright!.command).toBe("npx");
  });
});

describe("loadMcpServersConfig — layering (D-16)", () => {
  test("disjoint keys → union", () => {
    writeUserYaml(`
servers:
  filesystem:
    command: npx
    args: ["@modelcontextprotocol/server-filesystem", "/home"]
`);
    writeProjectYaml(`
servers:
  playwright:
    command: npx
    args: ["@playwright/mcp"]
`);
    const cfg = loadMcpServersConfig({ userHome, projectRoot });
    expect(Object.keys(cfg.servers).sort()).toEqual(["filesystem", "playwright"]);
    expect(cfg.servers.filesystem!.command).toBe("npx");
    expect(cfg.servers.playwright!.command).toBe("npx");
  });

  test("overlapping keys → PROJECT wins (D-16)", () => {
    writeUserYaml(`
servers:
  filesystem:
    command: npx
    args: ["@modelcontextprotocol/server-filesystem", "/home/user"]
`);
    writeProjectYaml(`
servers:
  filesystem:
    command: node
    args: ["./my-project-fs.js", "/project/subdir"]
`);
    const cfg = loadMcpServersConfig({ userHome, projectRoot });
    expect(Object.keys(cfg.servers).sort()).toEqual(["filesystem"]);
    // Project version wins.
    expect(cfg.servers.filesystem!.command).toBe("node");
    expect(cfg.servers.filesystem!.args).toEqual(["./my-project-fs.js", "/project/subdir"]);
  });
});

describe("loadMcpServersConfig — schema validation", () => {
  test("invalid YAML → McpServersConfigError('read.<path>', ...)", () => {
    const p = writeUserYaml(`
servers:
  bad: [unclosed
`);
    let caught: unknown;
    try {
      loadMcpServersConfig({ userHome, projectRoot });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpServersConfigError);
    const err = caught as McpServersConfigError;
    expect(err.at).toContain("read");
    expect(err.at).toContain(p);
  });

  test("missing command → McpServersConfigError with dotted path", () => {
    writeUserYaml(`
servers:
  filesystem:
    args: ["-y", "@modelcontextprotocol/server-filesystem"]
`);
    let caught: unknown;
    try {
      loadMcpServersConfig({ userHome, projectRoot });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpServersConfigError);
    expect((caught as McpServersConfigError).at).toContain("servers.filesystem.command");
  });

  test("args not an array → McpServersConfigError", () => {
    writeUserYaml(`
servers:
  filesystem:
    command: npx
    args: "should-be-array"
`);
    expect(() => loadMcpServersConfig({ userHome, projectRoot })).toThrow(McpServersConfigError);
  });

  test("args contain non-string entry → McpServersConfigError", () => {
    writeUserYaml(`
servers:
  filesystem:
    command: npx
    args: ["-y", 42]
`);
    expect(() => loadMcpServersConfig({ userHome, projectRoot })).toThrow(McpServersConfigError);
  });

  test("env not a mapping → McpServersConfigError", () => {
    writeUserYaml(`
servers:
  filesystem:
    command: npx
    args: ["-y"]
    env: "should-be-map"
`);
    expect(() => loadMcpServersConfig({ userHome, projectRoot })).toThrow(McpServersConfigError);
  });
});

describe("loadMcpServersConfig — $VAR preservation", () => {
  test("env values containing $VAR are returned verbatim; interpolation happens at spawn", () => {
    writeUserYaml(`
servers:
  search:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-brave-search"]
    env:
      BRAVE_API_KEY: "$BRAVE_API_KEY"
      SOME_PATH: "\${HOME}/secrets"
`);
    const cfg = loadMcpServersConfig({ userHome, projectRoot });
    expect(cfg.servers.search!.env).toEqual({
      BRAVE_API_KEY: "$BRAVE_API_KEY",
      SOME_PATH: "${HOME}/secrets",
    });
  });
});

describe("loadMcpServersConfig — alias preservation (Phase 3 forward compat)", () => {
  test("alias field survives load but is not honored by Phase 2 registerMcpServers", () => {
    writeUserYaml(`
servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem"]
    alias: "fs_read"
`);
    const cfg = loadMcpServersConfig({ userHome, projectRoot });
    expect(cfg.servers.filesystem!.alias).toBe("fs_read");
  });
});
