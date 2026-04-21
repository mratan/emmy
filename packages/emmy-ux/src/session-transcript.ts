// packages/emmy-ux/src/session-transcript.ts
//
// B2 FIX (Plan 08 SC-3 corpus feed): every pi-emmy session writes its
// tool-call turns to runs/phase2-sc3-capture/session-<iso>.jsonl under the
// current working directory. Plan 08 samples 50 transcripts from this
// directory to build the real-session replay half of the SC-3 corpus.
//
// Capture is ALWAYS on — no opt-in flag — so the corpus builds up passively
// during daily-driver use. The SC-3 evaluator itself runs with a capture-off
// guard so replay runs don't pollute the capture feed.
//
// Atomic-append pattern mirrors emmy_serve/diagnostics/atomic.py:
//   open(path, "a") → writeFileSync → fsyncSync → closeSync. Each call
//   flushes to disk before returning so a crash mid-session never truncates
//   the JSONL file.

import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const transcriptDir = "runs/phase2-sc3-capture";

export function openTranscript(cwd: string): { path: string } {
	const iso = new Date().toISOString().replace(/[:.]/g, "-");
	const dir = resolve(cwd, transcriptDir);
	const path = join(dir, `session-${iso}.jsonl`);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return { path };
}

export interface SessionTurn {
	role: string;
	content?: string | null;
	tool_calls?: unknown[];
	tool_call_id?: string;
	ts?: string;
	profile?: { id: string; version: string; hash: string };
	[k: string]: unknown;
}

export function appendSessionTurn(path: string, turn: SessionTurn): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const record: SessionTurn = {
		ts: turn.ts ?? new Date().toISOString(),
		...turn,
	};
	const line = `${JSON.stringify(record)}\n`;
	const fd = openSync(path, "a");
	try {
		writeFileSync(fd, line, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
