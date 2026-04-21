// Plan 02-06 Task 2 — registerNativeTools.
//
// Binds the 8-tool native floor (CLAUDE.md: "pi's minimal floor — read/write/
// edit/bash + grep/find/ls + web_fetch + MCP") via pi.registerTool. NATIVE_TOOL_NAMES
// is the collision source of truth consumed by mcp-bridge.ts (D-15).
//
// "wrapper-not-replacement" discipline (CONTEXT.md §code_context):
//   - `read` delegates to Plan 03's readWithHashes (D-07 prefix format)
//   - `edit` delegates to Plan 03's editHashline (D-05 hash-anchored default)
//   - Plain string-replace is NOT registered as `edit_plain` in Phase 2; add
//     only if lived-experience shows the fallback is needed (CONTEXT.md
//     §source_excerpts on edit wrapper composition).
//
// YOLO + denylist (CLAUDE.md Design Principles):
//   - bash has a builtin denylist (rm -rf /, fork bomb) + user-extensible list.
//   - Once the model has read+write+bash, real isolation is impossible inside
//     the loop. Use git for undo.
//
// Telemetry:
//   - Every invocation emits `emitEvent({event:"tool.invoke", tool, latency_ms,
//     outcome, profile})`. Wave 0 emitEvent body is no-op; Phase 3 makes observable.

import { spawnSync, execFileSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { emitEvent } from "@emmy/telemetry";
import type { PiToolSpec, NativeToolOpts } from "./types";
import { ToolsError } from "./errors";
import { readWithHashes, renderHashedLines } from "./read-with-hashes";
import { editHashline } from "./edit-hashline";
import { webFetch, NETWORK_REQUIRED_TAG } from "./web-fetch";

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

const BASH_DEFAULT_DENY: RegExp[] = [
  // rm -rf / (no specific subdir)
  /^\s*rm\s+-rf\s+\/(?:\s|$)/,
  // Classic fork bomb signature: :(){ :|: & };:
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];
const BASH_TRUNC_LINES_PER_SIDE = 50;
const BASH_DEFAULT_TIMEOUT_MS = 60_000;

export function registerNativeTools(
  pi: { registerTool: (spec: PiToolSpec) => void },
  opts: NativeToolOpts,
): void {
  const { cwd, profileRef } = opts;
  const deny: RegExp[] = [
    ...BASH_DEFAULT_DENY,
    ...(opts.bashDenylist ?? []).map((s) => new RegExp(s)),
  ];

  const invoke = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      const result = await fn();
      emitEvent({
        event: "tool.invoke",
        ts: new Date().toISOString(),
        profile: profileRef,
        tool: name,
        latency_ms: Date.now() - t0,
        outcome: "ok",
      });
      return result;
    } catch (e) {
      emitEvent({
        event: "tool.invoke",
        ts: new Date().toISOString(),
        profile: profileRef,
        tool: name,
        latency_ms: Date.now() - t0,
        outcome: "error",
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  };

  // ---- read -----------------------------------------------------------------
  pi.registerTool({
    name: "read",
    description:
      "Read a file; output tags each line with an 8-hex content hash for use by the edit tool. Accepts optional line_range [start,end] (1-based, inclusive).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute filesystem path." },
        line_range: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "Optional [start,end] line range, 1-based inclusive.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("read", async () => {
        const path = String(args.path);
        const lineRange = Array.isArray(args.line_range)
          ? (args.line_range as [number, number])
          : undefined;
        const r = readWithHashes(path, lineRange ? { lineRange } : {});
        if (r.binary) return { path, binary: true, content_base64: r.content };
        return {
          path,
          binary: false,
          lines: renderHashedLines(r.lines),
          line_count: r.lines.length,
        };
      }),
  });

  // ---- write ----------------------------------------------------------------
  pi.registerTool({
    name: "write",
    description:
      "Overwrite a file with the given content. Atomic fsync (open→writeFile→fsync→close).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("write", async () => {
        const path = String(args.path);
        const content = String(args.content);
        const fd = openSync(path, "w");
        try {
          writeFileSync(fd, content, "utf8");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        return { path, bytes_written: Buffer.byteLength(content, "utf8") };
      }),
  });

  // ---- edit (hash-anchored — default) --------------------------------------
  pi.registerTool({
    name: "edit",
    description:
      "Hash-anchored edit (DEFAULT). Every line in a prior read is tagged {8hex}{2sp}{content}; edits reference individual line hashes. Stale hashes are rejected with a named error — re-read the file and retry with fresh hashes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              hash: { type: "string", pattern: "^[0-9a-f]{8}$" },
              new_content: { type: ["string", "null"] },
            },
            required: ["hash", "new_content"],
            additionalProperties: false,
          },
        },
        inserts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              after_hash: { type: "string" },
              insert: { type: "array", items: { type: "string" } },
            },
            required: ["after_hash", "insert"],
            additionalProperties: false,
          },
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("edit", async () => {
        return editHashline({
          path: String(args.path),
          edits: (args.edits as Array<{ hash: string; new_content: string | null }> | undefined) ?? [],
          inserts:
            (args.inserts as Array<{ after_hash: string; insert: string[] }> | undefined) ?? [],
        });
      }),
  });

  // ---- bash -----------------------------------------------------------------
  pi.registerTool({
    name: "bash",
    description: `Run a bash command (YOLO default; per CLAUDE.md). Output truncated to head+tail of ${BASH_TRUNC_LINES_PER_SIDE} lines each side. Timeout default ${BASH_DEFAULT_TIMEOUT_MS}ms. Denylist applies.`,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("bash", async () => {
        const cmd = String(args.command);
        for (const re of deny) {
          if (re.test(cmd)) {
            throw new ToolsError(
              "bash.denylist",
              `command matches denylist pattern ${re}`,
            );
          }
        }
        const result = spawnSync("sh", ["-c", cmd], {
          cwd: String(args.cwd ?? cwd),
          timeout: Number(args.timeout_ms ?? BASH_DEFAULT_TIMEOUT_MS),
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        const stdout = truncateHeadTail(result.stdout ?? "", BASH_TRUNC_LINES_PER_SIDE);
        const stderr = truncateHeadTail(result.stderr ?? "", BASH_TRUNC_LINES_PER_SIDE);
        return {
          stdout,
          stderr,
          exit_code: result.status ?? -1,
          signal: result.signal ?? null,
        };
      }),
  });

  // ---- grep -----------------------------------------------------------------
  pi.registerTool({
    name: "grep",
    description: "Run grep against a path. Returns stdout + exit_code.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        flags: { type: "string" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("grep", async () => {
        const flagsStr = String(args.flags ?? "-rn");
        const pattern = String(args.pattern);
        const path = String(args.path ?? ".");
        try {
          const out = execFileSync(
            "grep",
            [...flagsStr.split(/\s+/).filter(Boolean), pattern, path],
            { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
          );
          return { stdout: truncateHeadTail(out, 100), exit_code: 0 };
        } catch (e: unknown) {
          const err = e as { stdout?: string; stderr?: string; status?: number };
          return {
            stdout: truncateHeadTail(err.stdout ?? "", 100),
            stderr: err.stderr ?? "",
            exit_code: err.status ?? -1,
          };
        }
      }),
  });

  // ---- find -----------------------------------------------------------------
  pi.registerTool({
    name: "find",
    description: "Run find on a path. Returns matching paths, one per line.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["f", "d"] },
      },
      required: ["path"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("find", async () => {
        const findArgs = [String(args.path)];
        if (args.name) findArgs.push("-name", String(args.name));
        if (args.type) findArgs.push("-type", String(args.type));
        const out = execFileSync("find", findArgs, {
          cwd,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        return { stdout: truncateHeadTail(out, 100), exit_code: 0 };
      }),
  });

  // ---- ls -------------------------------------------------------------------
  pi.registerTool({
    name: "ls",
    description: "List directory contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        long: { type: "boolean" },
        all: { type: "boolean" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("ls", async () => {
        const flags: string[] = [];
        if (args.long) flags.push("-l");
        if (args.all) flags.push("-a");
        const out = execFileSync("ls", [...flags, String(args.path)], {
          cwd,
          encoding: "utf8",
        });
        return { stdout: out.trim(), exit_code: 0 };
      }),
  });

  // ---- web_fetch -----------------------------------------------------------
  pi.registerTool({
    name: "web_fetch",
    description: `HTTP GET → markdown. Reads documentation only (no inference). Tagged ${NETWORK_REQUIRED_TAG}.`,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        timeout_ms: { type: "number" },
      },
      required: ["url"],
      additionalProperties: false,
    },
    invoke: async (args) =>
      invoke("web_fetch", async () => {
        return webFetch(String(args.url), {
          timeoutMs: Number(args.timeout_ms ?? 30_000),
        });
      }),
  });
}

function truncateHeadTail(text: string, linesPerSide: number): string {
  const lines = text.split("\n");
  if (lines.length <= linesPerSide * 2) return text;
  const head = lines.slice(0, linesPerSide).join("\n");
  const tail = lines.slice(-linesPerSide).join("\n");
  return `${head}\n…(truncated ${lines.length - linesPerSide * 2} lines)…\n${tail}`;
}
