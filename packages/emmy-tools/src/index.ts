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
export {
	webFetch,
	webFetchWithAllowlist,
	NETWORK_REQUIRED_TAG,
	type WebFetchToolResult,
	type WebFetchToolOkResult,
	type WebFetchToolErrorResult,
} from "./web-fetch";
// Plan 03-06: web_fetch runtime allowlist enforcement (D-27 + D-28).
// Plan 03.1-02: D-35 returned-URL bypass.
export {
	enforceWebFetchAllowlist,
	WebFetchAllowlistError,
	recordSearchUrl,
	getOrCreateDefaultStore,
	__resetSearchStoreForTests,
	type EnforcementContext,
	type RecentSearchUrlStore,
} from "./web-fetch-allowlist";
// Plan 03.1-02 (D-34, D-35): web_search tool + search-returned-URL bypass.
export {
	webSearch,
	registerWebSearchTool,
	resetTurnSearchCount,
	__resetSearchCountForTests,
	type WebSearchConfig,
	type SearchResult,
	type WebSearchToolErrorResult,
	type WebSearchOpts,
	type PiToolDefinitionShape,
	type RegisterWebSearchToolOpts,
} from "./web-search";
export const PACKAGE_VERSION = "0.1.0";
