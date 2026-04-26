// packages/emmy-tools/src/memory/path-resolver.ts
//
// Plan 04.4-01 Task 2: two-scope path resolver with traversal block.
//
// MEMORY-TOOL-SPEC.md §2 + §3.1 + §3.4 + §7 ("Symlink escape"). Translates a
// logical /memories/... path into an absolute filesystem path, OR returns a
// MemoryError if the input is hostile (traversal, blocked extension, disabled
// scope, etc.).
//
// Threat model — see PLAN.md §threat_model:
//   T-04.4-01-01  Tampering: hostile path strings (`..`, `\\`, %2e%2e, null)
//   T-04.4-01-02  Tampering: symlink-out (resolves outside root)
//   T-04.4-01-03  Info disclosure: secret-extension writes (.env / .key / .pem)
//
// V4 (MEMORY-TOOL-SPEC.md §10): 30 hostile inputs — ALL must reject.

import { homedir } from "node:os";
import { resolve, normalize, sep } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { MemoryError, type MemoryConfig } from "./types";

export type ResolvedPath =
	| {
			ok: true;
			scope: "project" | "global" | "virtual";
			absPath: string;
			logicalPath: string;
	  }
	| { ok: false; error: MemoryError };

// URL-encoded variants we explicitly reject before path.resolve runs.
// Case-insensitive: %2E, %2e, %2F, %2f.
const URL_ENCODED_RE = /%2[ef]/i;

/** Expand a leading `~` or `~/...` to the user's HOME directory. */
function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return homedir() + p.slice(1);
	return p;
}

/** Lowercase the suffix from the last "." in basename (or "" if no dot). */
function lowerExtension(p: string): string {
	const slashIdx = Math.max(p.lastIndexOf("/"), p.lastIndexOf(sep));
	const base = slashIdx >= 0 ? p.slice(slashIdx + 1) : p;
	const dotIdx = base.lastIndexOf(".");
	if (dotIdx <= 0) return ""; // no dot, or leading dot (dotfile)
	return base.slice(dotIdx).toLowerCase();
}

/**
 * Resolve a logical /memories/{project,global}/... path under the configured
 * scope roots. Reject hostile inputs (traversal, blocked extension, disabled
 * scope, symlink-out) with a typed MemoryError.
 *
 * @param logicalPath the model-supplied path (e.g. "/memories/project/notes/foo.md")
 * @param config     active MemoryConfig (from profile harness.yaml)
 * @param cwd        working directory used as base for project_root (default process.cwd())
 */
export function resolveMemoryPath(
	logicalPath: string,
	config: MemoryConfig,
	cwd: string = process.cwd(),
): ResolvedPath {
	// 0 — global enabled gate.
	if (!config.enabled) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.disabled",
				"memory tool disabled in profile (memory.enabled=false)",
			),
		};
	}

	// 1 — Reject empty path.
	if (typeof logicalPath !== "string" || logicalPath.length === 0) {
		return {
			ok: false,
			error: new MemoryError("memory.traversal_blocked", "empty path"),
		};
	}

	// 2 — Reject null-byte injection.
	if (logicalPath.includes("\0")) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.traversal_blocked",
				"null byte injection",
			),
		};
	}

	// 3 — Reject backslash-style separators (Windows traversal vector).
	if (logicalPath.includes("\\")) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.traversal_blocked",
				"backslash not permitted",
			),
		};
	}

	// 4 — Reject URL-encoded path components (would be silently decoded by some FS layers).
	if (URL_ENCODED_RE.test(logicalPath)) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.traversal_blocked",
				"URL-encoded path component",
			),
		};
	}

	// 5 — Reject literal `..` segment (any position).
	if (logicalPath.split("/").some((seg) => seg === "..")) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.traversal_blocked",
				"parent-traversal segment",
			),
		};
	}

	// 6 — Reject any absolute filesystem path NOT starting with `/memories`.
	//      Also rejects file:// schemes and Windows drive prefixes.
	if (!logicalPath.startsWith("/memories")) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.traversal_blocked",
				"path must start with /memories",
			),
		};
	}

	// 7 — Strip /memories prefix; classify scope.
	const tail = logicalPath.slice("/memories".length);

	// Exact "/memories" → virtual root (top-level listing).
	if (tail === "" || tail === "/") {
		return {
			ok: true,
			scope: "virtual",
			absPath: "",
			logicalPath: "/memories",
		};
	}

	let scope: "project" | "global";
	let inner: string;
	if (tail === "/project" || tail.startsWith("/project/")) {
		scope = "project";
		inner = tail.slice("/project".length);
	} else if (tail === "/global" || tail.startsWith("/global/")) {
		scope = "global";
		inner = tail.slice("/global".length);
	} else {
		return {
			ok: false,
			error: new MemoryError(
				"memory.traversal_blocked",
				"scope must be project or global",
			),
		};
	}

	// 8 — Resolve scope root from config.
	const rootRel = scope === "project" ? config.project_root : config.global_root;
	if (rootRel === null) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.disabled",
				`scope ${scope} disabled in profile (${scope}_root=null)`,
			),
		};
	}

	const base = scope === "project" ? cwd : homedir();
	const expandedRel = expandTilde(rootRel);
	const rootAbs = resolve(base, expandedRel);

	// 9 — Compose candidate. Use "." + inner so inner="" resolves to rootAbs.
	const candidate = resolve(rootAbs, "." + inner);

	// 10 — Pre-symlink containment check.
	const normRoot = normalize(rootAbs);
	const normCandidate = normalize(candidate);
	if (normCandidate !== normRoot && !normCandidate.startsWith(normRoot + sep)) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.traversal_blocked",
				"resolved path escapes scope root",
			),
		};
	}

	// 11 — Post-symlink containment check.
	//      If candidate exists, realpathSync it AND realpathSync the root once;
	//      assert containment after symlink expansion.
	if (existsSync(candidate)) {
		try {
			const realCandidate = realpathSync(candidate);
			const realRoot = realpathSync(rootAbs);
			if (
				realCandidate !== realRoot &&
				!realCandidate.startsWith(realRoot + sep)
			) {
				return {
					ok: false,
					error: new MemoryError(
						"memory.traversal_blocked",
						"symlink escapes scope root",
					),
				};
			}
		} catch (err) {
			// realpathSync can throw EACCES / ENOENT in race; treat as untrusted.
			return {
				ok: false,
				error: new MemoryError(
					"memory.traversal_blocked",
					`could not verify symlink containment: ${(err as Error).message}`,
				),
			};
		}
	}

	// 12 — Blocked-extension check (lowercase compare).
	const ext = lowerExtension(candidate);
	if (
		ext.length > 0 &&
		config.blocked_extensions
			.map((e) => e.toLowerCase())
			.includes(ext)
	) {
		return {
			ok: false,
			error: new MemoryError(
				"memory.blocked_extension",
				`extension ${ext} is in blocked_extensions`,
			),
		};
	}

	return {
		ok: true,
		scope,
		absPath: candidate,
		logicalPath,
	};
}
