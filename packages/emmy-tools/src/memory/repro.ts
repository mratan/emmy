// packages/emmy-tools/src/memory/repro.ts
//
// Phase 04.4 plan 05 — reproducibility hooks for the memory tool.
//
// Precedence rule (CLAUDE.md "URL config precedence", applied to filesystem):
//   env > profile > literal flag-default
//
//   - EMMY_MEMORY_OVERRIDE_PROJECT — if set, replaces project_root unconditionally
//   - EMMY_MEMORY_OVERRIDE_GLOBAL  — if set, replaces global_root unconditionally
//   - --no-memory flag             — short-circuits to enabled=false
//   - profile.harness.context.memory — base values
//   - DEFAULT_MEMORY_CONFIG        — fallback when profile missing the block

import {
	cpSync,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from "./types";

export interface ResolveMemoryConfigArgs {
	profileMemory?: MemoryConfig;
	noMemory?: boolean;
	env?: Record<string, string | undefined>;
}

export function resolveMemoryConfig(
	args: ResolveMemoryConfigArgs,
): MemoryConfig {
	// Step 1: --no-memory short-circuit (highest priority for the master switch).
	if (args.noMemory === true) {
		return { ...DEFAULT_MEMORY_CONFIG, enabled: false };
	}
	// Step 2: base from profile (or default if profile lacks the block).
	const base = args.profileMemory ?? DEFAULT_MEMORY_CONFIG;
	// Step 3: env overrides for the two roots.
	const env = args.env ?? process.env;
	const project = env.EMMY_MEMORY_OVERRIDE_PROJECT;
	const global = env.EMMY_MEMORY_OVERRIDE_GLOBAL;
	return {
		...base,
		project_root:
			project !== undefined && project !== ""
				? project
				: base.project_root,
		global_root:
			global !== undefined && global !== "" ? global : base.global_root,
	};
}

/** Snapshot handle — tracks the live-root path + the parked-original path. */
export interface SnapshotHandle {
	liveRoot: string;
	parkedOriginal: string | null;
	sourceUsed: string;
}

function uniq(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Apply a snapshot: mirror sourceDir into liveRoot via a tempfile-and-rename
 * dance so restore is symmetric.
 */
export function createSnapshot(
	sourceDir: string,
	liveRoot: string,
): SnapshotHandle {
	const parent = dirname(liveRoot);
	mkdirSync(parent, { recursive: true });
	const tmpStaging = join(parent, `.${uniq()}-staging`);
	cpSync(sourceDir, tmpStaging, { recursive: true });
	let parkedOriginal: string | null = null;
	if (existsSync(liveRoot)) {
		parkedOriginal = join(parent, `.${uniq()}-parked`);
		renameSync(liveRoot, parkedOriginal);
	}
	renameSync(tmpStaging, liveRoot);
	return { liveRoot, parkedOriginal, sourceUsed: sourceDir };
}

/** Restore a snapshot: rename current liveRoot away, rename parked back. Atomic. */
export function restoreSnapshot(handle: SnapshotHandle): void {
	if (existsSync(handle.liveRoot)) {
		rmSync(handle.liveRoot, { recursive: true, force: true });
	}
	if (handle.parkedOriginal !== null) {
		renameSync(handle.parkedOriginal, handle.liveRoot);
	}
}

export interface ApplyMemorySnapshotArgs {
	projectSnapshotDir?: string;
	globalSnapshotDir?: string;
	resolvedConfig: MemoryConfig;
	cwd: string;
	home: string;
}

export interface ApplyMemorySnapshotResult {
	projectHandle: SnapshotHandle | null;
	globalHandle: SnapshotHandle | null;
}

function rootAbs(rel: string | null, base: string, home: string): string | null {
	if (!rel) return null;
	if (rel.startsWith("/")) return rel;
	if (rel.startsWith("~/")) return rel.replace(/^~/, home);
	return join(base, rel);
}

/**
 * Apply both project + global snapshots transactionally. If global apply
 * fails, project is rolled back to leave no half-state.
 */
export function applyMemorySnapshot(
	args: ApplyMemorySnapshotArgs,
): ApplyMemorySnapshotResult {
	const result: ApplyMemorySnapshotResult = {
		projectHandle: null,
		globalHandle: null,
	};
	const projectAbs = rootAbs(
		args.resolvedConfig.project_root,
		args.cwd,
		args.home,
	);
	const globalAbs = rootAbs(
		args.resolvedConfig.global_root,
		args.home,
		args.home,
	);

	try {
		if (args.projectSnapshotDir && projectAbs) {
			result.projectHandle = createSnapshot(
				args.projectSnapshotDir,
				projectAbs,
			);
		}
		if (args.globalSnapshotDir && globalAbs) {
			result.globalHandle = createSnapshot(
				args.globalSnapshotDir,
				globalAbs,
			);
		}
	} catch (err) {
		// Atomic rollback — undo the project snapshot if global failed.
		if (result.projectHandle) {
			try {
				restoreSnapshot(result.projectHandle);
			} catch {
				// best-effort rollback
			}
		}
		throw err;
	}
	return result;
}

/** Reverse applyMemorySnapshot — restore both scopes if handles were captured. */
export function revertMemorySnapshot(
	result: ApplyMemorySnapshotResult,
): void {
	if (result.globalHandle) {
		try {
			restoreSnapshot(result.globalHandle);
		} catch {
			// ignore — best-effort
		}
	}
	if (result.projectHandle) {
		try {
			restoreSnapshot(result.projectHandle);
		} catch {
			// ignore — best-effort
		}
	}
}
