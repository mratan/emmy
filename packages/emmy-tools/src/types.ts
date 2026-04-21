// PLAN-03-MERGE-NOTE: This file is owned by Plan 02-03 (hash-anchored edit primitives).
// Plan 02-06 runs in a parallel worktree and needs these types to compile its own
// modules (native-tools.ts, mcp-*.ts). The contents below MUST be a subset of Plan
// 02-03's final types.ts; on merge-back the orchestrator should prefer 02-03's
// version (`git checkout --theirs packages/emmy-tools/src/types.ts`) and keep the
// Plan-06-added mcp types at the bottom.

// --- Plan 02-03 types (hash-anchored edit primitives) ---
export interface HashedLine {
  hash: string;
  content: string;
  line_number: number;
}

export interface EditOp {
  hash: string;
  new_content: string | null;
}

export interface InsertOp {
  after_hash: string;
  insert: string[];
}

export interface EditRequest {
  path: string;
  edits?: EditOp[];
  inserts?: InsertOp[];
  hashesFromLastRead?: HashedLine[];
}

export interface EditResult {
  path: string;
  applied: { edits: number; inserts: number };
  diff: string;
  before_hash_file: string;
  after_hash_file: string;
}

// --- Plan 02-06 types (MCP bridge + native tools) ---
export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  alias?: string; // Reserved for Phase 3; preserved in config but not honored in Phase 2.
}

export interface McpServersConfig {
  servers: Record<string, McpServerSpec>;
}

export interface PiToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  invoke: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface NativeToolOpts {
  cwd: string;
  profileRef: { id: string; version: string; hash: string };
  bashDenylist?: string[];
}
