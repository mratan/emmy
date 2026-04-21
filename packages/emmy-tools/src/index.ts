// @emmy/tools — public surface.
// Plan 02-03: hash-anchored edit primitives.
// Plan 02-06: native-tools + MCP bridge + web_fetch + Unicode poison check.
export * from "./types";
export * from "./errors";
export { hash8hex, normalizeText } from "./hash";
export { isBinary } from "./text-binary-detect";
export { readWithHashes, renderHashedLines } from "./read-with-hashes";
export { renderUnifiedDiff } from "./diff-render";
export { editHashline } from "./edit-hashline";
export { assertNoPoison } from "./mcp-poison-check";
export { loadMcpServersConfig } from "./mcp-config";
export { registerMcpServers } from "./mcp-bridge";
export { registerNativeTools, NATIVE_TOOL_NAMES } from "./native-tools";
export { webFetch, NETWORK_REQUIRED_TAG } from "./web-fetch";
export const PACKAGE_VERSION = "0.1.0";
