// packages/emmy-telemetry/src/hf-export.ts
//
// Plan 03-05 Task 2 (GREEN) — HuggingFace datasets-loadable export.
//
// D-21 (2026-04-21 amendment): JSONL-only MVP. Parquet + upstream dataset
// card publication deferred to Phase 7. The exported JSONL is loadable
// natively via `datasets.load_dataset("json", data_files=...)` (RESEARCH
// §Summary #5 verified).
//
// Output layout (outDir/):
//   feedback.jsonl   — verbatim copy of the source corpus
//   dataset_card.md  — emmy-authored schema / version / load snippet
//   provenance.json  — git SHA + profile hashes in capture + export ts
//
// File-content warning (TELEM-02 TODO(Phase-7) consent guardrail): any
// row whose model_response or tool_calls blob matches one of the heuristic
// code-indicator patterns triggers a stderr warning. Export is NOT blocked
// — consent/redaction is a Phase 7 concern. This surface gives the operator
// an early signal that the corpus may contain file contents before it is
// shared.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readFeedback } from "./feedback";

export interface ExportResult {
	rowCount: number;
	warningCount: number;
	outDir: string;
}

export interface ExportOpts {
	emmyVersion?: string;
	gitSha?: string;
}

/**
 * Heuristic markers for "row may contain file contents". These are
 * deliberately over-inclusive (false-positive is OK, false-negative is bad).
 * Each pattern requires a newline prefix so inline mentions like "use the
 * `function` keyword" don't trigger.
 */
const FILE_CONTENT_MARKERS: RegExp[] = [
	/\n```/, // markdown code fence
	/\nfunction\s+\w+\s*\(/, // JS/TS function definition
	/\nimport\s+\w+/, // JS/TS/Python import at column 0
	/\nclass\s+\w+/, // JS/TS/Python class definition
	/\n#include\s+</, // C / C++ include
	/\ndef\s+\w+\s*\(/, // Python def
];

/**
 * Copy the source feedback.jsonl into `outDir/feedback.jsonl` and emit the
 * two emmy-authored sidecars (dataset_card.md + provenance.json).
 *
 * @throws Error if srcJsonl does not exist.
 */
export function exportHfDataset(
	srcJsonl: string,
	outDir: string,
	opts: ExportOpts = {},
): ExportResult {
	if (!existsSync(srcJsonl)) {
		throw new Error(`source feedback jsonl missing: ${srcJsonl}`);
	}
	if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

	// Copy JSONL verbatim — HF-loadable as-is.
	const dstJsonl = join(outDir, "feedback.jsonl");
	copyFileSync(srcJsonl, dstJsonl);

	// Scan rows for file-content markers → stderr warning per row.
	const rows = readFeedback(srcJsonl);
	let warnings = 0;
	for (const row of rows) {
		const blob = "\n" + (row.model_response ?? "") + "\n" + JSON.stringify(row.tool_calls ?? []);
		if (FILE_CONTENT_MARKERS.some((m) => m.test(blob))) {
			console.error(
				`[emmy/export-hf] WARNING: row turn_id=${row.turn_id} may contain file contents`,
			);
			warnings++;
		}
	}

	// dataset_card.md — human-readable schema + load snippet.
	const emmyVersion = opts.emmyVersion ?? "unknown";
	const gitSha = opts.gitSha ?? "unknown";
	const exportTs = new Date().toISOString();
	const card = [
		`# Emmy Lived-Experience Feedback Dataset`,
		``,
		`Emmy is a fully-local coding agent on NVIDIA DGX Spark. This dataset is`,
		`the lived-experience rating corpus captured via Alt+Up / Alt+Down keybinds`,
		`on the most-recent completed agent turn.`,
		``,
		`- **Rows:** ${rows.length}`,
		`- **Schema (13 fields):** session_id, turn_id, profile_id, profile_version, profile_hash, rating (∈ {+1, -1}), comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out`,
		`- **Exported:** ${exportTs}`,
		`- **Emmy version:** ${emmyVersion}`,
		`- **Emmy git SHA:** ${gitSha}`,
		`- **File-content warnings:** ${warnings}`,
		``,
		`## Loading`,
		``,
		"```python",
		`from datasets import load_dataset`,
		`d = load_dataset("json", data_files="${dstJsonl}")`,
		`print(d["train"])`,
		"```",
		``,
		`## Warnings`,
		``,
		`${warnings} row(s) may contain file contents (code fences / function /`,
		`import / class / #include markers). Review before publication per`,
		`TELEM-02 TODO(Phase-7) consent flow.`,
		``,
	].join("\n");
	writeFileSync(join(outDir, "dataset_card.md"), card, "utf8");

	// provenance.json — structured provenance for downstream auditors.
	const profileHashes = [...new Set(rows.map((r) => r.profile_hash))];
	const provenance = {
		emmy_version: emmyVersion,
		git_sha: gitSha,
		export_ts: exportTs,
		row_count: rows.length,
		warning_count: warnings,
		source_path: srcJsonl,
		profile_hashes: profileHashes,
	};
	writeFileSync(
		join(outDir, "provenance.json"),
		JSON.stringify(provenance, null, 2) + "\n",
		"utf8",
	);

	return { rowCount: rows.length, warningCount: warnings, outDir };
}
