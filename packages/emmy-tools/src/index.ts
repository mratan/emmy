// @emmy/tools — public surface.
// Plan 02-03: hash-anchored edit primitives.
// Plan 02-06: native-tools + MCP bridge + web_fetch + Unicode poison check.
// Plan 03-01: buildNativeToolDefs + buildMcpToolDefs (Phase-3 wire-through
//             helpers for createAgentSessionFromServices({ customTools })).
export * from "./types";
export * from "./errors";
export { hash8hex, normalizeText } from "./hash";
export { isBinary } from "./text-binary-detect";
export { readWithHashes, renderHashedLines } from "./read-with-hashes";
export { renderUnifiedDiff } from "./diff-render";
export { editHashline } from "./edit-hashline";
export { assertNoPoison } from "./mcp-poison-check";
export { loadMcpServersConfig } from "./mcp-config";
export { registerMcpServers, buildMcpToolDefs } from "./mcp-bridge";
export {
	registerNativeTools,
	buildNativeToolDefs,
	NATIVE_TOOL_NAMES,
	type ToolDefinitionLike,
	type AgentToolResultLike,
} from "./native-tools";
export { toolSpecToDefinition } from "./tool-definition-adapter";
export { webFetch, NETWORK_REQUIRED_TAG } from "./web-fetch";
export const PACKAGE_VERSION = "0.1.0";
