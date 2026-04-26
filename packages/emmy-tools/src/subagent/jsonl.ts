// Phase 04.5 Plan 06 — Per-child JSONL routing + sidecar index.
//
// ----------------------------------------------------------------------------
// Persona naming convention (LOCKED — see Plan 04.5-02 + Plan 04.5-06; I2 fix):
//   YAML keys (snake_case):  research, code_reviewer, bash_runner    ← SubAgentSpec.name
//   On-disk PROFILE bundle (kebab-case):  subagents/research, subagents/code-reviewer, subagents/bash-runner
//   On-disk PARENT child-instance dir (snake_case): <parentCwd>/.emmy/subagents/<persona-name>-<timestamp>-<id>/
//                                                                     ^^^ uses SubAgentSpec.name (snake) — grep-friendly
// The persona-loader (Plan 04.5-02) reconciles the two conventions: it reads the kebab dir
// (per yaml's persona_dir field) but stamps SubAgentSpec.name with the snake yaml key.
// This file consumes SubAgentSpec.name verbatim (snake) for all on-disk paths it CREATES,
// and never re-resolves the kebab profile-bundle dir (that's persona-loader's job).
// ----------------------------------------------------------------------------
//
// LOCKED rules (CONTEXT.md §"Per-child JSONL location"):
//   - Pattern A (lean) default: SessionManager.inMemory(parentCwd)
//   - Pattern A with persistTranscript: true: SessionManager.create(...)
//   - Pattern B (persona) default: SessionManager.inMemory(parentCwd)
//   - Pattern B with persistTranscript: true: SessionManager.create(...)
//   - Sidecar JSONL (always when parentSessionDir + parentSessionId present):
//       <parentSessionDir>/session-<parentSessionId>.subagents.jsonl
//   - Persona name must match /^[a-zA-Z0-9_-]+$/ (defense-in-depth path-traversal block).

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { SubAgentSpec } from "./types";

const PERSONA_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export interface SidecarEntry {
	parent_span_id: string | undefined;
	child_session_id: string;
	persona: string;
	pattern: "lean" | "persona";
	started_at: string;
	ended_at?: string;
	child_jsonl_path?: string;
	trace_id: string | undefined;
	ok?: boolean;
}

/**
 * Decide whether the child writes its JSONL to disk (SessionManager.create) or
 * stays in-memory (SessionManager.inMemory). Returns the SDK SessionManager
 * instance plus the absolute child-jsonl path when persisted.
 *
 * @param persona      The persona spec (carries persistTranscript flag + name).
 * @param parentCwd    Parent's working directory.
 * @param childSessionId  Pre-generated child id used in the dirname suffix.
 *                        The actual SDK-assigned child.sessionId may differ;
 *                        callers stamp the real id on the SidecarEntry separately.
 */
export function resolveChildSessionManager(
	persona: SubAgentSpec,
	parentCwd: string,
	childSessionId: string,
): { sm: SessionManager; childJsonlPath?: string } {
	if (!persona.persistTranscript) {
		return { sm: SessionManager.inMemory(parentCwd) };
	}
	if (!PERSONA_NAME_RE.test(persona.name)) {
		throw new Error(
			`[subagent.jsonl] persona name "${persona.name}" fails [a-zA-Z0-9_-]+ sanitization`,
		);
	}
	// snake_case persona name (per the convention comment above) + ISO timestamp + 8-char child id suffix
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const idShort = childSessionId.slice(0, 8);
	const subDir = resolve(parentCwd, ".emmy/subagents", `${persona.name}-${ts}-${idShort}`);
	mkdirSync(subDir, { recursive: true });
	return {
		sm: SessionManager.create(parentCwd, subDir),
		childJsonlPath: subDir,
	};
}

/**
 * Append a sidecar index entry to <parentSessionDir>/session-<parentSessionId>.subagents.jsonl.
 *
 * NO-OP when parentSessionDir or parentSessionId is undefined (allows testing
 * contexts and non-persistent sessions to skip the sidecar without errors).
 *
 * Best-effort: filesystem errors are logged to stderr but do NOT propagate.
 * The OTel span is the authoritative completion record; the sidecar is forensics.
 */
export function writeSidecarEntry(
	parentSessionDir: string | undefined,
	parentSessionId: string | undefined,
	entry: SidecarEntry,
): void {
	if (!parentSessionDir || !parentSessionId) return;
	try {
		const filePath = join(
			parentSessionDir,
			`session-${parentSessionId}.subagents.jsonl`,
		);
		mkdirSync(dirname(filePath), { recursive: true });
		const line = JSON.stringify(entry) + "\n";
		appendFileSync(filePath, line, { flag: "a" });
	} catch (err) {
		// best-effort, mirrors @emmy/telemetry's stderr-log-don't-block contract
		console.error(`[subagent.sidecar] write failed: ${(err as Error).message}`);
	}
}
