// @emmy/tools — public surface (Plan 02-03 primitives).
// Plan 06 extends this with native-tools + MCP bridge + web-fetch + poison check.
export * from "./types";
export * from "./errors";
export { hash8hex, normalizeText } from "./hash";
export { isBinary } from "./text-binary-detect";
export { readWithHashes, renderHashedLines } from "./read-with-hashes";
export { renderUnifiedDiff } from "./diff-render";
export { editHashline } from "./edit-hashline";
export const PACKAGE_VERSION = "0.1.0";
