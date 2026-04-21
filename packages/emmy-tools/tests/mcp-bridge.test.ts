// Plan 02-06 Task 1 — MCP stdio bridge (D-15/D-17/D-18).
// Mocks @modelcontextprotocol/sdk to avoid real subprocess spawns. Cases:
//   - No servers → empty output
//   - Poison rejection on a tool name → other tools from same server still register
//   - Name collision with native tool "read" → ToolNameCollisionError
//   - Spawn failure (transport constructor throws) → McpServerSpawnError

import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import type { McpServersConfig, PiToolSpec } from "../src/types";
import { ToolNameCollisionError, McpServerSpawnError } from "../src/errors";

// --- Per-test scripting knobs for the MCP SDK mock -----------------------
interface MockState {
  toolsByServer: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>>;
  spawnFailures: Set<string>;
  connectedClients: Array<{ name: string; closed: boolean }>;
  callToolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}

const mockState: MockState = {
  toolsByServer: {},
  spawnFailures: new Set(),
  connectedClients: [],
  callToolCalls: [],
};

// Mock the SDK BEFORE importing the bridge. The bridge imports the SDK at
// module-load time, so we must install mocks before `import("../src/mcp-bridge")`.
mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    command: string;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(server: { command: string; args: string[]; env?: Record<string, string> }) {
      this.command = server.command;
      // Scripted failure: the fake command string "__SPAWN_FAIL__" throws.
      if (mockState.spawnFailures.has(server.command)) {
        throw new Error(`scripted spawn failure for command=${server.command}`);
      }
    }
  },
}));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    info: { name: string; version: string };
    closed = false;
    serverKey: string;
    constructor(info: { name: string; version: string }, _opts: unknown) {
      this.info = info;
      // Convention: info.name is `emmy-bridge/<serverName>`; extract serverName.
      this.serverKey = info.name.split("/")[1] ?? info.name;
      mockState.connectedClients.push({ name: this.serverKey, closed: false });
    }
    async connect(_transport: unknown): Promise<void> {
      // success path
    }
    async listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }> {
      return { tools: mockState.toolsByServer[this.serverKey] ?? [] };
    }
    async callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<{ ok: true }> {
      mockState.callToolCalls.push(params);
      return { ok: true };
    }
    close(): void {
      this.closed = true;
      const entry = mockState.connectedClients.find((c) => c.name === this.serverKey);
      if (entry) entry.closed = true;
    }
  },
}));

// Import AFTER mocks are installed.
const { registerMcpServers } = await import("../src/mcp-bridge");

// --- Test fixture helpers ------------------------------------------------
function makeStubPi(): {
  pi: { registerTool: (spec: PiToolSpec) => void };
  registered: PiToolSpec[];
} {
  const registered: PiToolSpec[] = [];
  return {
    pi: { registerTool: (spec: PiToolSpec) => registered.push(spec) },
    registered,
  };
}

const PROFILE_REF = { id: "qwen3.6-35b-a3b", version: "v2", hash: "sha256:aaaaaaaa" };

beforeEach(() => {
  mockState.toolsByServer = {};
  mockState.spawnFailures.clear();
  mockState.connectedClients.length = 0;
  mockState.callToolCalls.length = 0;
});

afterEach(() => {
  mockState.toolsByServer = {};
  mockState.spawnFailures.clear();
});

describe("registerMcpServers — empty config", () => {
  test("no servers → empty output", async () => {
    const { pi, registered } = makeStubPi();
    const cfg: McpServersConfig = { servers: {} };
    const out = await registerMcpServers(pi, cfg, {
      registeredToolNames: new Set(),
      profileRef: PROFILE_REF,
    });
    expect(out.spawned).toEqual([]);
    expect(out.registeredTools).toEqual([]);
    expect(registered.length).toBe(0);
  });
});

describe("registerMcpServers — happy path", () => {
  test("two clean tools from one server → both registered, names added to dedup set", async () => {
    const { pi, registered } = makeStubPi();
    mockState.toolsByServer = {
      filesystem: [
        { name: "fs_read", description: "Read a file", inputSchema: { type: "object" } },
        { name: "fs_write", description: "Write a file", inputSchema: { type: "object" } },
      ],
    };
    const cfg: McpServersConfig = {
      servers: { filesystem: { command: "npx", args: ["-y", "fake-fs"] } },
    };
    const knownNames = new Set<string>(["read", "write", "edit", "bash"]);
    const out = await registerMcpServers(pi, cfg, {
      registeredToolNames: knownNames,
      profileRef: PROFILE_REF,
    });
    expect(out.registeredTools.sort()).toEqual(["fs_read", "fs_write"]);
    expect(registered.length).toBe(2);
    // invoke path round-trips to callTool
    await registered[0]!.invoke({ path: "/tmp/a" });
    expect(mockState.callToolCalls.length).toBe(1);
    expect(mockState.callToolCalls[0]!.name).toBe("fs_read");
    // knownNames set should now include the new tools (dedup source of truth)
    expect(knownNames.has("fs_read")).toBe(true);
    expect(knownNames.has("fs_write")).toBe(true);
  });
});

describe("registerMcpServers — Unicode poison rejection (D-18)", () => {
  test("poisoned tool name is skipped; sibling clean tool still registers", async () => {
    const { pi, registered } = makeStubPi();
    mockState.toolsByServer = {
      filesystem: [
        // U+200B ZERO WIDTH SPACE in the name → Cf → rejected.
        { name: "fs​_read", description: "Read a file", inputSchema: { type: "object" } },
        { name: "fs_list", description: "List dir", inputSchema: { type: "object" } },
      ],
    };
    const cfg: McpServersConfig = {
      servers: { filesystem: { command: "npx", args: ["-y", "fake-fs"] } },
    };
    const out = await registerMcpServers(pi, cfg, {
      registeredToolNames: new Set(["read"]),
      profileRef: PROFILE_REF,
    });
    // fs​_read is poisoned; fs_list is clean and registers.
    expect(out.registeredTools).toEqual(["fs_list"]);
    expect(registered.length).toBe(1);
    expect(registered[0]!.name).toBe("fs_list");
  });

  test("poisoned description also rejects (even if name is clean)", async () => {
    const { pi } = makeStubPi();
    mockState.toolsByServer = {
      filesystem: [
        // Clean name but U+202E in description.
        {
          name: "fs_list",
          description: "List files ‮(RTL-override)",
          inputSchema: { type: "object" },
        },
      ],
    };
    const cfg: McpServersConfig = {
      servers: { filesystem: { command: "npx", args: ["-y", "fake-fs"] } },
    };
    const out = await registerMcpServers(pi, cfg, {
      registeredToolNames: new Set(),
      profileRef: PROFILE_REF,
    });
    expect(out.registeredTools).toEqual([]);
  });
});

describe("registerMcpServers — collision with native tools (D-15)", () => {
  test("MCP tool named 'read' collides with native → ToolNameCollisionError", async () => {
    const { pi } = makeStubPi();
    mockState.toolsByServer = {
      badfs: [{ name: "read", description: "Conflicting read tool", inputSchema: { type: "object" } }],
    };
    const cfg: McpServersConfig = {
      servers: { badfs: { command: "npx", args: ["-y", "fake"] } },
    };
    let caught: unknown;
    try {
      await registerMcpServers(pi, cfg, {
        registeredToolNames: new Set(["read", "write", "edit", "bash"]),
        profileRef: PROFILE_REF,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolNameCollisionError);
    expect((caught as ToolNameCollisionError).toolName).toBe("read");
    expect((caught as ToolNameCollisionError).message).toContain("alias:");
  });

  test("collision triggers teardown — any connected clients are closed before re-throw", async () => {
    const { pi } = makeStubPi();
    mockState.toolsByServer = {
      server_a: [{ name: "a_tool", description: "ok", inputSchema: { type: "object" } }],
      server_b: [{ name: "bash", description: "collides with native bash", inputSchema: { type: "object" } }],
    };
    const cfg: McpServersConfig = {
      servers: {
        server_a: { command: "npx", args: ["-y", "a"] },
        server_b: { command: "npx", args: ["-y", "b"] },
      },
    };
    await expect(
      registerMcpServers(pi, cfg, {
        registeredToolNames: new Set(["read", "write", "edit", "bash"]),
        profileRef: PROFILE_REF,
      }),
    ).rejects.toBeInstanceOf(ToolNameCollisionError);
    // Both clients were created; both should now be closed (teardown).
    const ac = mockState.connectedClients.find((c) => c.name === "server_a");
    const bc = mockState.connectedClients.find((c) => c.name === "server_b");
    expect(ac?.closed).toBe(true);
    expect(bc?.closed).toBe(true);
  });
});

describe("registerMcpServers — spawn failure (D-17)", () => {
  test("transport constructor throws → McpServerSpawnError with serverName", async () => {
    const { pi } = makeStubPi();
    mockState.spawnFailures.add("__FAIL_CMD__");
    const cfg: McpServersConfig = {
      servers: { badserver: { command: "__FAIL_CMD__", args: [] } },
    };
    let caught: unknown;
    try {
      await registerMcpServers(pi, cfg, {
        registeredToolNames: new Set(),
        profileRef: PROFILE_REF,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpServerSpawnError);
    expect((caught as McpServerSpawnError).serverName).toBe("badserver");
  });
});

describe("registerMcpServers — returned spawned[] has kill()", () => {
  test("each spawned entry exposes a kill function that closes the client", async () => {
    const { pi } = makeStubPi();
    mockState.toolsByServer = {
      filesystem: [{ name: "fs_read", description: "Read", inputSchema: { type: "object" } }],
    };
    const cfg: McpServersConfig = {
      servers: { filesystem: { command: "npx", args: ["-y", "fake"] } },
    };
    const out = await registerMcpServers(pi, cfg, {
      registeredToolNames: new Set(),
      profileRef: PROFILE_REF,
    });
    expect(out.spawned.length).toBe(1);
    const entry = out.spawned[0]!;
    expect(entry.name).toBe("filesystem");
    expect(typeof entry.kill).toBe("function");
    entry.kill();
    expect(mockState.connectedClients[0]!.closed).toBe(true);
  });
});
