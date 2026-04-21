#!/usr/bin/env bun
// eval/phase2/sc5/run_sc5.ts
//
// SC-5: prompt.sha256 byte-stability + AGENTS.md verbatim + max_input_tokens
// consistency.
//
// This runner is PURE HARNESS — no LLM calls. It:
//   1. Stages a fixture repo at /tmp/emmy-sc5-fixture-<rand>/ with a known
//      AGENTS.md (canonical bytes) and an empty src/foo.ts.
//   2. Calls assemblePrompt() THREE TIMES with identical inputs and captures:
//      - assembledPrompt.sha256
//      - stderr `prompt.assembled sha256=<64-hex>` log line
//      - layer metadata (especially AGENTS.md layer tokens_approx > 0)
//   3. Asserts the three sha256s are IDENTICAL (byte-stable).
//   4. Asserts the assembled text CONTAINS the verbatim AGENTS.md content.
//   5. Computes max_input_tokens from profile serving.yaml + PROFILE_NOTES.md,
//      and asserts harness.yaml.context.max_input_tokens equals the computed
//      value (SC-5 consistency gate — superset of Plan-04's regression).

import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

import yaml from "js-yaml";
import { assemblePrompt, computeMaxInputTokens, loadProfile } from "@emmy/ux";

interface SC5Row {
	run: number;
	sha256: string;
	layers: Array<{ name: string; tokens_approx: number; present: boolean }>;
	text_length: number;
	stderr_sha256_seen: string | null;
}

function parseArgs(argv: string[]): { profile: string; out: string } {
	let profile = "profiles/qwen3.6-35b-a3b/v2";
	let out = "runs/phase2-sc5/report.json";
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--profile") profile = argv[++i]!;
		else if (a === "--out") out = argv[++i]!;
	}
	return { profile: resolve(profile), out: resolve(out) };
}

// Canonical AGENTS.md content — exactly 500 bytes per plan (measured below).
// We pad/trim via a deterministic filler to hit the target.
function canonicalAgentsMd(): string {
	const header = [
		"# AGENTS.md",
		"",
		"SC-5 fixture AGENTS.md. This text must survive verbatim into the assembled system prompt.",
		"",
		"## Conventions",
		"- TypeScript, Bun runtime.",
		"- Commit messages: conventional-commits.",
		"",
		"## Paths",
		"- src/        app code",
		"- tests/      test files",
		"",
	].join("\n");
	// Pad to 500 bytes exactly.
	const target = 500;
	let padded = header;
	while (Buffer.byteLength(padded, "utf8") < target) {
		padded += "# pad\n";
	}
	// If overshoot, trim trailing pad lines (keeps markdown well-formed).
	if (Buffer.byteLength(padded, "utf8") > target) {
		padded = padded.slice(0, target);
		// Ensure no partial codepoint by falling back to a known-safe prefix.
		while (Buffer.byteLength(padded, "utf8") > target) {
			padded = padded.slice(0, -1);
		}
	}
	return padded;
}

function stageFixtureRepo(): string {
	const base = `/tmp/emmy-sc5-fixture-${randomBytes(4).toString("hex")}`;
	mkdirSync(base, { recursive: true });
	mkdirSync(join(base, "src"), { recursive: true });
	writeFileSync(join(base, "AGENTS.md"), canonicalAgentsMd(), "utf8");
	writeFileSync(join(base, "src", "foo.ts"), "export const FOO = 1;\n", "utf8");
	return base;
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();

	const profile = await loadProfile(args.profile);

	const fixtureRoot = stageFixtureRepo();
	try {
		const agentsMdAbs = join(fixtureRoot, "AGENTS.md");
		const agentsMdContent = readFileSync(agentsMdAbs, "utf8");
		const agentsMdBytes = Buffer.byteLength(agentsMdContent, "utf8");

		// Profile's prompts/system.md (required per session.ts boot).
		const systemMdPath = join(profile.ref.path, "prompts", "system.md");
		if (!existsSync(systemMdPath)) {
			throw new Error(`profile system.md missing at ${systemMdPath}`);
		}
		const profileSystemMd = readFileSync(systemMdPath, "utf8");

		// Fixed tool defs text (matches session.ts byte-for-byte so SC-5 is a
		// representative measurement of the production prompt path).
		const toolDefsText = [
			"# Tools available",
			"- read(path, line_range?): read a file; output tags each line with an 8-hex content-hash prefix for hash-anchored edits.",
			"- write(path, content): overwrite a file (atomic fsync).",
			"- edit(path, edits?, inserts?): hash-anchored edit — reference hashes from the last read.",
			"- bash(command, cwd?, timeout_ms?): run a shell command (YOLO default; denylist applied).",
			"- grep(pattern, path?, flags?): ripgrep-style search.",
			"- find(path, name?, type?): filesystem find.",
			"- ls(path, long?, all?): list a directory.",
			"- web_fetch(url, timeout_ms?): HTTP GET → markdown (network-required; documentation reading only).",
		].join("\n");

		// Run 3 times — capturing stderr each time so we can grep the log line.
		const rows: SC5Row[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		for (let run = 1; run <= 3; run++) {
			let stderrBuf = "";
			process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
				if (typeof chunk === "string") stderrBuf += chunk;
				else if (chunk instanceof Uint8Array) stderrBuf += Buffer.from(chunk).toString("utf8");
				return originalWrite(chunk as Parameters<typeof originalWrite>[0], ...(rest as unknown as Parameters<typeof originalWrite>));
			}) as typeof process.stderr.write;
			let assembled;
			try {
				assembled = assemblePrompt({
					profileSystemMd,
					agentsMd: agentsMdContent,
					agentsMdPath: agentsMdAbs,
					toolDefsText,
					// Do NOT include a userPrompt — keeps the 3 runs deterministically identical.
				});
			} finally {
				process.stderr.write = originalWrite;
			}
			const m = stderrBuf.match(/prompt\.assembled sha256=([0-9a-f]{64})/);
			rows.push({
				run,
				sha256: assembled.sha256,
				layers: assembled.layers,
				text_length: assembled.text.length,
				stderr_sha256_seen: m ? m[1]! : null,
			});
		}

		// Pull the actual assembled text from one more call (stderr not needed).
		const assembled = assemblePrompt({
			profileSystemMd,
			agentsMd: agentsMdContent,
			agentsMdPath: agentsMdAbs,
			toolDefsText,
		});

		// Assertions.
		const uniqueSha256 = new Set(rows.map((r) => r.sha256));
		const sha256Stable = uniqueSha256.size === 1;
		const agentsMdIncluded = assembled.text.includes(agentsMdContent);
		const agentsLayer = assembled.layers.find((l) => l.name === "AGENTS.md");
		const agentsMdTokensApprox = agentsLayer?.tokens_approx ?? 0;
		const stderrSha256Seen = rows.every((r) => r.stderr_sha256_seen === r.sha256);

		// max_input_tokens consistency gate (CONTEXT-05 / SC-5).
		const servingYaml = yaml.load(readFileSync(join(profile.ref.path, "serving.yaml"), "utf8")) as {
			engine?: { max_model_len?: number };
		};
		const harnessYaml = yaml.load(readFileSync(join(profile.ref.path, "harness.yaml"), "utf8")) as {
			context?: { max_input_tokens?: number };
		};
		const profileNotesRaw = readFileSync(join(profile.ref.path, "PROFILE_NOTES.md"), "utf8");
		const fmMatch = profileNotesRaw.match(/^---\n([\s\S]*?)\n---/);
		if (!fmMatch) throw new Error("PROFILE_NOTES.md missing frontmatter");
		const notes = yaml.load(fmMatch[1]!) as {
			measured_values?: { gpu_memory_utilization?: number };
		};
		const mu = notes.measured_values?.gpu_memory_utilization;
		const mml = servingYaml.engine?.max_model_len;
		const committedMax = harnessYaml.context?.max_input_tokens;
		if (typeof mu !== "number" || typeof mml !== "number" || typeof committedMax !== "number") {
			throw new Error(
				`profile inputs missing: mu=${mu} max_model_len=${mml} committed_max_input_tokens=${committedMax}`,
			);
		}
		const OUTPUT_RESERVE_TOKENS = 16384;
		const computed = computeMaxInputTokens({
			measured_gpu_memory_utilization: mu,
			max_model_len: mml,
			output_reserve_tokens: OUTPUT_RESERVE_TOKENS,
		});
		const maxInputTokensConsistent = committedMax === computed.max_input_tokens;

		const verdict =
			sha256Stable && agentsMdIncluded && maxInputTokensConsistent && stderrSha256Seen
				? "pass"
				: "fail";
		const endedAt = new Date().toISOString();

		const report = {
			sc: "SC-5",
			phase: "02",
			profile: profile.ref,
			started_at: startedAt,
			ended_at: endedAt,
			verdict,
			metrics: {
				sha256_unique_count: uniqueSha256.size,
				sha256_stable_across_runs: sha256Stable,
				agents_md_included_verbatim: agentsMdIncluded,
				agents_md_tokens_approx: agentsMdTokensApprox,
				agents_md_bytes: agentsMdBytes,
				stderr_sha256_match: stderrSha256Seen,
				max_input_tokens_committed: committedMax,
				max_input_tokens_computed: computed.max_input_tokens,
				max_input_tokens_consistent: maxInputTokensConsistent,
				max_input_tokens_derivation: computed.derivation,
			},
			rows,
			environment: {
				profile_path: profile.ref.path,
				fixture_root: fixtureRoot,
				agents_md_path: agentsMdAbs,
				node_version: process.version,
				bun_version: (process as { versions?: { bun?: string } }).versions?.bun ?? null,
			},
		};

		const outDir = resolve(args.out, "..");
		mkdirSync(outDir, { recursive: true });
		writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n", "utf8");
		console.error(`sc5: verdict=${verdict} report=${args.out}`);
		console.error(
			`sc5: sha256_stable=${sha256Stable} agents_md_included=${agentsMdIncluded} max_input_tokens_consistent=${maxInputTokensConsistent}`,
		);
		return verdict === "pass" ? 0 : 1;
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
}

main().then((code) => process.exit(code));
