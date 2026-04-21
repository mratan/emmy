// RED-phase stub. GREEN wires all 8 pi.registerTool bindings.
import type { PiToolSpec, NativeToolOpts } from "./types";

export const NATIVE_TOOL_NAMES = Object.freeze([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
  "web_fetch",
] as const);

export function registerNativeTools(
  _pi: { registerTool: (spec: PiToolSpec) => void },
  _opts: NativeToolOpts,
): void {
  throw new Error("not implemented");
}
