// Plan 02-06 Task 1 — Layered MCP servers config (D-16).
//
// Read order:
//   1. ${userHome}/.emmy/mcp_servers.yaml   (user defaults)
//   2. ${projectRoot}/.emmy/mcp_servers.yaml (project overrides)
//
// On key collision, PROJECT wins (D-16: "project overrides user on same key").
// Shape validated via explicit type-narrowing; errors carry a dotted path.
// `env:` values containing $VAR / ${VAR} are preserved verbatim — interpolation
// happens at spawn time (mcp-bridge.ts), NOT at load time.
// `alias:` is preserved for Phase 3 forward-compat but not honored in Phase 2.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { McpServersConfig, McpServerSpec } from "./types";
import { McpServersConfigError } from "./errors";

export function loadMcpServersConfig(opts: { userHome: string; projectRoot: string }): McpServersConfig {
  const userPath = join(opts.userHome, ".emmy", "mcp_servers.yaml");
  const projectPath = join(opts.projectRoot, ".emmy", "mcp_servers.yaml");
  const user = existsSync(userPath) ? parseFile(userPath) : { servers: {} };
  const project = existsSync(projectPath) ? parseFile(projectPath) : { servers: {} };
  // D-16: project OVERRIDES user on same key (spread order matters).
  return { servers: { ...user.servers, ...project.servers } };
}

function parseFile(path: string): McpServersConfig {
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(path, "utf8"));
  } catch (e) {
    throw new McpServersConfigError(`read.${path}`, e instanceof Error ? e.message : String(e));
  }
  if (!raw || typeof raw !== "object") {
    throw new McpServersConfigError(`root(${path})`, "must be a mapping");
  }
  const obj = raw as Record<string, unknown>;
  if (!("servers" in obj) || !obj.servers || typeof obj.servers !== "object") {
    throw new McpServersConfigError(`servers(${path})`, "must be a mapping");
  }
  const servers: Record<string, McpServerSpec> = {};
  for (const [name, spec] of Object.entries(obj.servers as Record<string, unknown>)) {
    if (!spec || typeof spec !== "object") {
      throw new McpServersConfigError(`servers.${name}(${path})`, "must be a mapping");
    }
    const s = spec as Record<string, unknown>;
    if (typeof s.command !== "string" || !s.command.trim()) {
      throw new McpServersConfigError(
        `servers.${name}.command(${path})`,
        "must be a non-empty string",
      );
    }
    if (!Array.isArray(s.args) || !s.args.every((a) => typeof a === "string")) {
      throw new McpServersConfigError(
        `servers.${name}.args(${path})`,
        "must be an array of strings",
      );
    }
    if (s.env !== undefined) {
      if (typeof s.env !== "object" || s.env === null || Array.isArray(s.env)) {
        throw new McpServersConfigError(
          `servers.${name}.env(${path})`,
          "must be a mapping of string to string",
        );
      }
      for (const [k, v] of Object.entries(s.env as Record<string, unknown>)) {
        if (typeof v !== "string") {
          throw new McpServersConfigError(
            `servers.${name}.env.${k}(${path})`,
            "value must be a string",
          );
        }
      }
    }
    if (s.alias !== undefined && typeof s.alias !== "string") {
      throw new McpServersConfigError(
        `servers.${name}.alias(${path})`,
        "must be a string (Phase 3 forward-compat field)",
      );
    }
    const entry: McpServerSpec = {
      command: s.command,
      args: s.args as string[],
    };
    if (s.env) entry.env = s.env as Record<string, string>;
    if (s.alias) entry.alias = s.alias as string;
    servers[name] = entry;
  }
  return { servers };
}

export { McpServersConfigError } from "./errors";
