// packages/emmy-provider/src/profile-ref.ts
//
// Re-exports ProfileRef so `import { ProfileRef } from "@emmy/provider"` works
// without reaching into ./types. Loading from disk is Plan 04's concern
// (Python-side profile loader is the source of truth — shell out to
// `uv run emmy profile hash <path>` per CONTEXT.md §code_context).

import type { ProfileRef } from "./types";
export type { ProfileRef };
