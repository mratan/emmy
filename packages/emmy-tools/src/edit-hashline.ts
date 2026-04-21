// Hash-anchored edit — DEFAULT edit format (D-05 per-line; D-06 SHA-256 trunc
// 8 hex; D-09 payload shape; D-08 fallback only for binary / new-file).
//
// CLAUDE.md: "Hash-anchored edits as default. Plain string-replace only as fallback."
// Atomic write pattern adapts emmy_serve/diagnostics/atomic.py (temp + fsync +
// rename; dot-prefix temp name; unlink on rename failure).
//
// NOT thread-safe — ARCHITECTURE.md §9 single-user assumption.

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	HashResolutionError,
	StaleHashError,
	ToolsError,
} from "./errors";
import { hash8hex } from "./hash";
import { readWithHashes } from "./read-with-hashes";
import { renderUnifiedDiff } from "./diff-render";
import type { EditRequest, EditResult } from "./types";

export async function editHashline(req: EditRequest): Promise<EditResult> {
	const edits = req.edits ?? [];
	const inserts = req.inserts ?? [];
	const fileExists = fs.existsSync(req.path);

	// --- New-file creation path (D-08 non-text fallback for missing files) ---
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

	// --- Existing file: ALWAYS re-read fresh (advisory hashesFromLastRead
	// is intentionally ignored). ---
	const fresh = readWithHashes(req.path);
	if (fresh.binary) {
		throw new ToolsError(
			"edit.binary",
			`hash-anchored edit not supported on binary file ${req.path} — use the write tool for overwrite`,
		);
	}

	// Empty request on an existing file → no-op with empty diff.
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

	// Build hash → line-index map for resolution.
	const hashToIdx = new Map<string, number[]>();
	fresh.lines.forEach((l, i) => {
		const arr = hashToIdx.get(l.hash) ?? [];
		arr.push(i);
		hashToIdx.set(l.hash, arr);
	});

	// Validate ALL anchors BEFORE mutation (atomic-fail — no partial writes).
	for (const e of edits) {
		const m = hashToIdx.get(e.hash) ?? [];
		if (m.length === 0) throw new StaleHashError(e.hash, req.path);
		if (m.length > 1)
			throw new HashResolutionError(e.hash, req.path, "duplicate");
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
		if (m.length > 1)
			throw new HashResolutionError(ins.after_hash, req.path, "duplicate");
	}

	// Apply edits on a working copy first; DELETED sentinel survives the
	// insert-splice pass so insert indices stay stable.
	const DELETED = Symbol("deleted");
	const working: (string | typeof DELETED)[] = fresh.lines.map(
		(l) => l.content,
	);
	for (const e of edits) {
		const idx = hashToIdx.get(e.hash)![0]!;
		working[idx] = e.new_content === null ? DELETED : e.new_content;
	}
	// Insert descending by anchor index so earlier inserts don't shift later ones.
	const byIdx = inserts
		.map((ins) => ({
			idx: hashToIdx.get(ins.after_hash)![0]!,
			lines: ins.insert,
		}))
		.sort((a, b) => b.idx - a.idx);
	const withInserts: (string | typeof DELETED)[] = working.slice();
	for (const { idx, lines } of byIdx) withInserts.splice(idx + 1, 0, ...lines);
	const finalLines = withInserts.filter((l) => l !== DELETED) as string[];
	const newContent =
		finalLines.length === 0 ? "" : finalLines.join("\n") + "\n";

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

// Atomic write: temp file in the same dir (so rename is atomic on the same FS),
// dot-prefixed so `ls` hides it, fsync before close, rename on success, unlink
// on rename failure. Matches emmy_serve/diagnostics/atomic.py's discipline.
//
// Implementation note: we dispatch all fs operations through the `fs` module
// namespace (not destructured) so `spyOn(fs, "renameSync")` in tests can
// intercept the rename call. Destructured binds lock the reference at import
// time and bypass the spy.
function writeAtomic(absPath: string, content: string): void {
	const dir = dirname(absPath);
	const tmp = join(
		dir,
		`.${basename(absPath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
	);
	const fd = fs.openSync(tmp, "w");
	try {
		fs.writeFileSync(fd, content, "utf8");
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	try {
		fs.renameSync(tmp, absPath);
	} catch (e) {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// best-effort cleanup
		}
		throw e;
	}
}
