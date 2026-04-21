// RED-phase stub. GREEN step wires up stdio client + poison + collision checks.
import type { McpServersConfig, PiToolSpec } from "./types";

export async function registerMcpServers(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _pi: { registerTool: (spec: PiToolSpec) => void },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _cfg: McpServersConfig,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: { registeredToolNames: Set<string>; profileRef: { id: string; version: string; hash: string } },
): Promise<{ spawned: Array<{ name: string; pid: number; kill: () => void }>; registeredTools: string[] }> {
  throw new Error("not implemented");
}
