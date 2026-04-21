// PLAN-03-MERGE-NOTE: Owned by Plan 02-03. Stubbed so native-tools.ts's `edit`
// tool can delegate in isolation. On merge-back:
// `git checkout --theirs packages/emmy-tools/src/edit-hashline.ts`.

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { EditRequest, EditResult } from "./types";
import { HashResolutionError, StaleHashError, ToolsError } from "./errors";
import { readWithHashes } from "./read-with-hashes";
import { hash8hex } from "./hash";
import { renderUnifiedDiff } from "./diff-render";

export async function editHashline(req: EditRequest): Promise<EditResult> {
  const edits = req.edits ?? [];
  const inserts = req.inserts ?? [];
  const fileExists = existsSync(req.path);

  if (!fileExists) {
    if (edits.length > 0) {
      throw new ToolsError(
        "edit.new_file",
        `cannot edit non-existent file ${req.path}; use inserts with after_hash:"" to create`,
      );
    }
    if (inserts.length !== 1 || inserts[0]!.after_hash !== "") {
      throw new ToolsError(
        "edit.new_file",
        `new-file creation requires exactly one insert with after_hash:"" (got ${inserts.length} insert(s))`,
      );
    }
    const newContent = inserts[0]!.insert.join("\n") + "\n";
    writeAtomic(req.path, newContent);
    return {
      path: req.path,
      applied: { edits: 0, inserts: inserts[0]!.insert.length },
      diff: renderUnifiedDiff("", newContent, req.path),
      before_hash_file: hash8hex(""),
      after_hash_file: hash8hex(newContent),
    };
  }

  const fresh = readWithHashes(req.path);
  if (fresh.binary) {
    throw new ToolsError(
      "edit.binary",
      `hash-anchored edit not supported on binary file ${req.path} — use the write tool for overwrite`,
    );
  }

  if (edits.length === 0 && inserts.length === 0) {
    const fileHash = hash8hex(fresh.content);
    return {
      path: req.path,
      applied: { edits: 0, inserts: 0 },
      diff: "",
      before_hash_file: fileHash,
      after_hash_file: fileHash,
    };
  }

  const hashToIdx = new Map<string, number[]>();
  fresh.lines.forEach((l, i) => {
    const arr = hashToIdx.get(l.hash) ?? [];
    arr.push(i);
    hashToIdx.set(l.hash, arr);
  });

  for (const e of edits) {
    const m = hashToIdx.get(e.hash) ?? [];
    if (m.length === 0) throw new StaleHashError(e.hash, req.path);
    if (m.length > 1) throw new HashResolutionError(e.hash, req.path, "duplicate");
    if (e.new_content !== null && e.new_content.includes("\n")) {
      throw new ToolsError(
        "edit.new_content_multiline",
        `new_content must not contain '\\n' (path=${req.path}, hash=${e.hash})`,
      );
    }
  }
  for (const ins of inserts) {
    if (ins.after_hash === "") {
      throw new ToolsError(
        "edit.insert_empty_anchor",
        `after_hash:"" is only legal for new-file creation (${req.path} already exists)`,
      );
    }
    const m = hashToIdx.get(ins.after_hash) ?? [];
    if (m.length === 0) throw new StaleHashError(ins.after_hash, req.path);
    if (m.length > 1) throw new HashResolutionError(ins.after_hash, req.path, "duplicate");
  }

  const DELETED = Symbol("deleted");
  const working: (string | typeof DELETED)[] = fresh.lines.map((l) => l.content);
  for (const e of edits) {
    const [idx] = hashToIdx.get(e.hash)!;
    working[idx!] = e.new_content === null ? DELETED : e.new_content;
  }
  const byIdx = inserts
    .map((ins) => ({ idx: hashToIdx.get(ins.after_hash)![0]!, lines: ins.insert }))
    .sort((a, b) => b.idx - a.idx);
  const withInserts: (string | typeof DELETED)[] = working.slice();
  for (const { idx, lines } of byIdx) withInserts.splice(idx + 1, 0, ...lines);
  const finalLines = withInserts.filter((l) => l !== DELETED) as string[];
  const newContent = finalLines.length === 0 ? "" : finalLines.join("\n") + "\n";

  const diff = renderUnifiedDiff(fresh.content, newContent, req.path);
  writeAtomic(req.path, newContent);
  return {
    path: req.path,
    applied: {
      edits: edits.length,
      inserts: inserts.reduce((n, i) => n + i.insert.length, 0),
    },
    diff,
    before_hash_file: hash8hex(fresh.content),
    after_hash_file: hash8hex(newContent),
  };
}

function writeAtomic(absPath: string, content: string): void {
  const dir = dirname(absPath);
  const tmp = join(dir, `.${basename(absPath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, absPath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
    throw e;
  }
}
