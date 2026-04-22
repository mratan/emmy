// Plan 02-06 Task 1 — MCP stdio bridge (D-15 / D-17 / D-18).
//
// Responsibilities:
//   - Spawn MCP servers as stdio subprocesses (D-17 stdio-only).
//   - Register each MCP-declared tool via pi.registerTool by its flat name (D-15).
//   - Reject tool names/descriptions that contain blocked Unicode codepoints (D-18).
//   - Throw ToolNameCollisionError if a flat name collides with an already-registered
//     tool (the native 8 come pre-populated in `registeredToolNames`).
//   - Clean up all spawned subprocesses if ANY downstream failure is thrown.
//   - Emit telemetry events for every registered/rejected tool.
//
// What this file does NOT do:
//   - Honor `alias:` from mcp_servers.yaml (Phase 3 work; Phase 2 rejects loud).
//   - Resolve $VAR inside env values (MCP SDK's StdioClientTransport handles that
//     through DEFAULT_INHERITED_ENV_VARS; we pass env as-is).
//   - Implement any non-stdio transport. D-17 locks stdio-only for Phase 2
//     (see threat T-02-06-03). Other MCP transports are deferred to v1.x.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { emitEvent } from "@emmy/telemetry";
import type { McpServersConfig, PiToolSpec } from "./types";
import { McpServerSpawnError, ToolNameCollisionError } from "./errors";
import { assertNoPoison } from "./mcp-poison-check";
import { toolSpecToDefinition, type ToolDefinitionLike } from "./tool-definition-adapter";

interface SpawnedEntry {
  name: string;
  pid: number;
  kill: () => void;
  client: Client;
}

export async function registerMcpServers(
  pi: { registerTool: (spec: PiToolSpec) => void },
  cfg: McpServersConfig,
  opts: {
    registeredToolNames: Set<string>;
    profileRef: { id: string; version: string; hash: string };
  },
): Promise<{
  spawned: Array<{ name: string; pid: number; kill: () => void }>;
  registeredTools: string[];
}> {
  const spawned: SpawnedEntry[] = [];
  const registeredTools: string[] = [];

  try {
    for (const [serverName, spec] of Object.entries(cfg.servers)) {
      let client: Client;
      let transport: StdioClientTransport;
      try {
        transport = new StdioClientTransport({
          command: spec.command,
          args: spec.args,
          env: spec.env,
        });
        client = new Client(
          { name: `emmy-bridge/${serverName}`, version: "0.1.0" },
          { capabilities: {} },
        );
        await client.connect(transport);
      } catch (e) {
        throw new McpServerSpawnError(
          serverName,
          e instanceof Error ? e.message : String(e),
        );
      }

      // Transport's underlying child_process is internal; best-effort PID lookup.
      const pid =
        (transport as unknown as { _process?: { pid?: number } })._process?.pid ?? -1;
      const kill = (): void => {
        try {
          // client.close() resolves a promise; we fire-and-forget for best-effort teardown.
          void client.close();
        } catch {
          /* best-effort — a closed client should not bubble errors */
        }
      };
      spawned.push({ name: serverName, pid, kill, client });

      const toolsResp = await client.listTools();
      for (const t of toolsResp.tools) {
        // D-18: poison-check on BOTH name and description.
        try {
          assertNoPoison(t.name, "name");
          if (t.description) assertNoPoison(t.description, "description");
        } catch (e) {
          // Poison rejects THIS tool ONLY; other tools from the same server continue.
          emitEvent({
            event: "mcp.tool.rejected",
            ts: new Date().toISOString(),
            profile: opts.profileRef,
            server: serverName,
            tool: t.name,
            reason: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        // D-15: flat-name collision with native tools (or earlier MCP registrations).
        if (opts.registeredToolNames.has(t.name)) {
          throw new ToolNameCollisionError(t.name, [...opts.registeredToolNames]);
        }
        pi.registerTool({
          name: t.name,
          description: t.description ?? "",
          parameters:
            (t.inputSchema as Record<string, unknown> | undefined) ??
            ({ type: "object", properties: {}, additionalProperties: false } as Record<string, unknown>),
          invoke: async (args) =>
            client.callTool({ name: t.name, arguments: args }),
        });
        opts.registeredToolNames.add(t.name);
        registeredTools.push(t.name);
        emitEvent({
          event: "mcp.tool.registered",
          ts: new Date().toISOString(),
          profile: opts.profileRef,
          server: serverName,
          tool: t.name,
        });
      }
    }
    return {
      spawned: spawned.map((s) => ({ name: s.name, pid: s.pid, kill: s.kill })),
      registeredTools,
    };
  } catch (e) {
    // Fail-loud discipline (Shared Pattern 3): kill every spawned subprocess
    // BEFORE re-throwing, so a collision/poison at server N doesn't leak
    // servers 0..N-1 as orphan processes.
    for (const s of spawned) s.kill();
    throw e;
  }
}

/**
 * Plan 03-01 Task 2 (GREEN) — Phase-3 wire-through helper.
 *
 * Emit MCP-discovered tools as pi 0.68 ToolDefinition-shaped objects, ready
 * to pass into createAgentSessionFromServices({ customTools: [...] }).
 *
 * D-18 CONTRACT (re-asserted on the NEW ToolDefinition-emitting path):
 *   - `assertNoPoison` is invoked on both tool.name and tool.description
 *     BEFORE the ToolDefinition is emitted.
 *   - Rejected tools are skipped — a poisoned tool from server N does NOT
 *     block sibling tools from the same server (same semantics as
 *     registerMcpServers).
 *   - Collisions with `registeredToolNames` (the 8 native tools plus earlier
 *     MCP registrations) throw ToolNameCollisionError and trigger teardown.
 *
 * See packages/emmy-ux/test/session.mcp-poison.test.ts for the regression
 * guard.
 */
export async function buildMcpToolDefs(
  cfg: McpServersConfig,
  opts: {
    registeredToolNames: Set<string>;
    profileRef: { id: string; version: string; hash: string };
  },
): Promise<{
  tools: ToolDefinitionLike[];
  spawned: Array<{ name: string; pid: number; kill: () => void }>;
  registeredCount: number;
}> {
  const spawned: SpawnedEntry[] = [];
  const tools: ToolDefinitionLike[] = [];

  try {
    for (const [serverName, spec] of Object.entries(cfg.servers)) {
      let client: Client;
      let transport: StdioClientTransport;
      try {
        transport = new StdioClientTransport({
          command: spec.command,
          args: spec.args,
          env: spec.env,
        });
        client = new Client(
          { name: `emmy-bridge/${serverName}`, version: "0.1.0" },
          { capabilities: {} },
        );
        await client.connect(transport);
      } catch (e) {
        throw new McpServerSpawnError(
          serverName,
          e instanceof Error ? e.message : String(e),
        );
      }
      const pid =
        (transport as unknown as { _process?: { pid?: number } })._process?.pid ?? -1;
      const kill = (): void => {
        try {
          void client.close();
        } catch {
          /* best-effort */
        }
      };
      spawned.push({ name: serverName, pid, kill, client });

      const toolsResp = await client.listTools();
      for (const t of toolsResp.tools) {
        // D-18 poison gate — MUST fire BEFORE emitting a ToolDefinition.
        // This is the Plan 03-01 re-assertion on the new customTools path
        // (regression guard: packages/emmy-ux/test/session.mcp-poison.test.ts).
        try {
          assertNoPoison(t.name, "name");
          if (t.description) assertNoPoison(t.description, "description");
        } catch (e) {
          emitEvent({
            event: "mcp.tool.rejected",
            ts: new Date().toISOString(),
            profile: opts.profileRef,
            server: serverName,
            tool: t.name,
            reason: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        // D-15: flat-name collision guard.
        if (opts.registeredToolNames.has(t.name)) {
          throw new ToolNameCollisionError(t.name, [...opts.registeredToolNames]);
        }
        const pispec: PiToolSpec = {
          name: t.name,
          description: t.description ?? "",
          parameters:
            (t.inputSchema as Record<string, unknown> | undefined) ??
            ({ type: "object", properties: {}, additionalProperties: false } as Record<string, unknown>),
          invoke: async (args) => client.callTool({ name: t.name, arguments: args }),
        };
        tools.push(toolSpecToDefinition(pispec));
        opts.registeredToolNames.add(t.name);
        emitEvent({
          event: "mcp.tool.registered",
          ts: new Date().toISOString(),
          profile: opts.profileRef,
          server: serverName,
          tool: t.name,
        });
      }
    }
    return {
      tools,
      spawned: spawned.map((s) => ({ name: s.name, pid: s.pid, kill: s.kill })),
      registeredCount: tools.length,
    };
  } catch (e) {
    for (const s of spawned) s.kill();
    throw e;
  }
}
