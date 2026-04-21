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

// --- Plan 02-06 error classes (MCP bridge + Unicode poison blocklist) ---
export class PoisonError extends ToolsError {
	constructor(
		public readonly codepoint: number,
		public readonly categoryOrRange: string,
		public readonly whichField: "name" | "description",
	) {
		super(
			"mcp.poison",
			`rejected ${whichField}: U+${codepoint.toString(16).toUpperCase().padStart(4, "0")} (${categoryOrRange})`,
		);
		this.name = "PoisonError";
	}
}

export class ToolNameCollisionError extends ToolsError {
	constructor(
		public readonly toolName: string,
		public readonly sources: string[],
	) {
		super(
			"mcp.collision",
			`MCP tool name '${toolName}' collides with: ${sources.join(", ")} — add an 'alias:' to the mcp_servers.yaml entry to remediate`,
		);
		this.name = "ToolNameCollisionError";
	}
}

export class McpServerSpawnError extends ToolsError {
	constructor(
		public readonly serverName: string,
		detail: string,
	) {
		super("mcp.spawn", `server '${serverName}' failed to spawn: ${detail}`);
		this.name = "McpServerSpawnError";
	}
}

export class McpServersConfigError extends ToolsError {
	constructor(
		public readonly at: string,
		detail: string,
	) {
		super("mcp.config", `${at}: ${detail}`);
		this.name = "McpServersConfigError";
	}
}
