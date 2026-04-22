// packages/emmy-context/src/index.ts
//
// @emmy/context — barrel re-exports.
//
// Phase 3 Plan 03-03 (Task 1): types + preservation + config-loader + errors.
// Phase 3 Plan 03-03 (Task 2): adds compaction.ts (emmyCompactionTrigger +
// IllegalCompactionTimingError re-export + EmmyCompactionContext interface).

export * from "./types";
export * from "./errors";
export * from "./preservation";
export * from "./config-loader";
export * from "./compaction";
