// @emmy/tools — error classes (Plan 02-03 Task 1).
// Dotted-path message convention matches Phase 1 profile errors.
// Plan 06 APPENDS more error classes (PoisonError, ToolNameCollisionError, etc.).

export class ToolsError extends Error {
	constructor(
		public readonly field: string,
		message: string,
	) {
		super(`tools.${field}: ${message}`);
		this.name = "ToolsError";
	}
}

export class HasherError extends ToolsError {
	constructor(m: string) {
		super("hash", m);
		this.name = "HasherError";
	}
}

export class StaleHashError extends ToolsError {
	constructor(
		public readonly hash: string,
		public readonly path: string,
	) {
		super(
			"edit.stale_hash",
			`hash '${hash}' not found in current contents of ${path} — re-read the file and retry with fresh hashes`,
		);
		this.name = "StaleHashError";
	}
}

export class HashResolutionError extends ToolsError {
	constructor(
		public readonly hash: string,
		public readonly path: string,
		public readonly reason: "duplicate" | "missing",
	) {
		super(
			"edit.hash_resolution",
			`hash '${hash}' in ${path} is ${reason === "duplicate" ? "ambiguous (matches multiple lines)" : "not present"}`,
		);
		this.name = "HashResolutionError";
	}
}
