// packages/emmy-telemetry/test/export-hf.integration.test.ts
//
// Plan 03-05 Task 1 (RED). HuggingFace `datasets`-loadable export artifact.
//
// Core behavior (unit-testable without uv / python):
//   - exportHfDataset copies source feedback.jsonl verbatim under outDir/
//   - emits dataset_card.md with schema description + row count + emmy version
//   - emits provenance.json with git SHA + profile hashes in use + export ts
//   - emits stderr warning on rows whose model_response looks like file contents
//     (``` fences / function / import / class markers). Does NOT block export.
//
// Optional HF loadability probe (skip unless SKIP_HF_INTEGRATION != "1" AND
// `uv` is on PATH). The default test run is `SKIP_HF_INTEGRATION=1` so CI is
// hermetic; opt-in by unsetting that env var locally to exercise the real
// `datasets.load_dataset("json", data_files=...)` round-trip.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendFeedback, type FeedbackRow } from "../src/feedback";
import { exportHfDataset } from "../src/hf-export";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "emmy-hfexport-"));
}

function sampleRow(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
	return {
		session_id: "S-1",
		turn_id: "T-1",
		profile_id: "qwen3.6-35b-a3b",
		profile_version: "v2",
		profile_hash:
			"24be3eea0067102f1f61bd32806a875d019fe02cb114697cd5f3ca4e39985d8b",
		rating: 1,
		comment: "",
		model_response: "ok",
		tool_calls: [],
		latency_ms: 100,
		kv_used: 10,
		tokens_in: 32,
		tokens_out: 4,
		...overrides,
	};
}

describe("exportHfDataset — file-layout assertions", () => {
	test("copies feedback.jsonl and emits dataset_card.md + provenance.json", () => {
		const dir = makeTmpDir();
		try {
			const src = join(dir, "src", "feedback.jsonl");
			const out = join(dir, "out");
			for (let i = 0; i < 5; i++) {
				appendFeedback(src, sampleRow({ turn_id: `T-${i}` }));
			}
			const result = exportHfDataset(src, out, {
				emmyVersion: "0.1.0",
				gitSha: "deadbeefcafe",
			});
			expect(result.rowCount).toBe(5);
			expect(result.warningCount).toBe(0);
			expect(existsSync(join(out, "feedback.jsonl"))).toBe(true);
			expect(existsSync(join(out, "dataset_card.md"))).toBe(true);
			expect(existsSync(join(out, "provenance.json"))).toBe(true);

			// feedback.jsonl content == src (5 lines):
			const lines = readFileSync(join(out, "feedback.jsonl"), "utf8")
				.split("\n")
				.filter((l) => l.length > 0);
			expect(lines.length).toBe(5);

			// dataset_card.md mentions schema + row count + emmy version + load_dataset:
			const card = readFileSync(join(out, "dataset_card.md"), "utf8");
			expect(card).toContain("5");
			expect(card).toContain("0.1.0");
			expect(card).toMatch(/load_dataset/);
			expect(card).toMatch(/session_id|turn_id|rating/);

			// provenance.json has git_sha + row_count + profile_hashes:
			const prov = JSON.parse(readFileSync(join(out, "provenance.json"), "utf8")) as {
				git_sha: string;
				row_count: number;
				profile_hashes: string[];
				emmy_version: string;
				export_ts: string;
			};
			expect(prov.git_sha).toBe("deadbeefcafe");
			expect(prov.row_count).toBe(5);
			expect(prov.profile_hashes.length).toBe(1);
			expect(prov.emmy_version).toBe("0.1.0");
			expect(typeof prov.export_ts).toBe("string");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("missing source jsonl throws a descriptive error", () => {
		const dir = makeTmpDir();
		try {
			const src = join(dir, "missing.jsonl");
			const out = join(dir, "out");
			expect(() => exportHfDataset(src, out)).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("file-content warning fires for rows whose model_response looks like code", () => {
		const dir = makeTmpDir();
		try {
			const src = join(dir, "src", "feedback.jsonl");
			const out = join(dir, "out");
			// Code-fence marker: \n``` ...
			appendFeedback(
				src,
				sampleRow({
					turn_id: "T-CODE",
					model_response: "here is some code:\n```python\nprint('hi')\n```",
				}),
			);
			// function\s+<ident>\s*(  — a JS / TS / C-style function definition
			appendFeedback(
				src,
				sampleRow({
					turn_id: "T-FUNC",
					model_response: "let me define this:\nfunction foo(x) { return x; }",
				}),
			);
			// Benign row — no warning
			appendFeedback(
				src,
				sampleRow({ turn_id: "T-OK", model_response: "all good here" }),
			);
			const result = exportHfDataset(src, out, { emmyVersion: "0.1.0", gitSha: "abc" });
			expect(result.warningCount).toBe(2);
			expect(result.rowCount).toBe(3); // export is NOT blocked
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("exportHfDataset — HF datasets loadability (opt-in integration)", () => {
	const skip = process.env.SKIP_HF_INTEGRATION !== "0"; // opt-in only
	test.skipIf(skip)("datasets.load_dataset parses the exported JSONL natively", () => {
		const dir = makeTmpDir();
		try {
			const src = join(dir, "src", "feedback.jsonl");
			const out = join(dir, "out");
			for (let i = 0; i < 3; i++) {
				appendFeedback(src, sampleRow({ turn_id: `T-${i}` }));
			}
			exportHfDataset(src, out);
			const uv = spawnSync(
				"uv",
				[
					"run",
					"python",
					"-c",
					`from datasets import load_dataset
d = load_dataset("json", data_files="${join(out, "feedback.jsonl")}")
assert len(d["train"]) == 3, f"expected 3 rows, got {len(d['train'])}"
print("ok")`,
				],
				{ encoding: "utf8" },
			);
			expect(uv.status).toBe(0);
			expect(uv.stdout).toContain("ok");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
