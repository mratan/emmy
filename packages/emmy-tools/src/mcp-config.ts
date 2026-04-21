// RED-phase stub. GREEN step fills in YAML loading + layering.
import type { McpServersConfig } from "./types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function loadMcpServersConfig(_opts: { userHome: string; projectRoot: string }): McpServersConfig {
  throw new Error("not implemented");
}
export { McpServersConfigError } from "./errors";
