// packages/emmy-ux/src/types.ts
//
// Core types for the @emmy/ux package (pi-emmy CLI + session primitives).
// Re-exports ProfileSnapshot from @emmy/provider so downstream callers have a
// single entry point; session.ts consumes the type directly.

import type { ProfileSnapshot } from "@emmy/provider";
export type { ProfileSnapshot };

export type Mode = "tui" | "print" | "json";

export interface EmmyCliArgs {
	// Positional: either a prompt (for --print/--json) or undefined (TUI mode).
	prompt?: string;
	mode: Mode;
	profilePath: string; // resolved absolute path, default: profiles/qwen3.6-35b-a3b/v2
	baseUrl: string; // default: http://127.0.0.1:8002
	cwd: string; // default: process.cwd()
	printEnvironment?: boolean;
}

export interface AssembledPromptLayer {
	name: "system.md" | "AGENTS.md" | "tool_defs" | "user";
	tokens_approx: number;
	present: boolean;
}

export interface AssembledPrompt {
	text: string;
	sha256: string;
	layers: AssembledPromptLayer[];
	agents_md_path?: string;
}
