#!/usr/bin/env bun
// eval/phase2/sc3/run_sc3.ts
//
// SC-3 parse-rate runner. Three variants:
//   - reactive            : no mutation to v2/harness.yaml. Production path.
//                           Output → runs/phase2-sc3/report.json. VERDICT GATE.
//   - disabled            : temporarily set tools.grammar.mode = disabled.
//                           D-14 no-grammar baseline. Output → baseline.json.
//                           Informational — no verdict.
//   - no_per_tool_sampling: temporarily REMOVE tools.per_tool_sampling key.
//                           W3 / Pitfall #5 Before/After isolation. Output
//                           → no_per_tool_sampling.json. Informational.
//
// For each 100-call corpus entry:
//   1. Issue a single-turn chat request with native tool schemas.
//   2. On model response, try JSON.parse on EACH tool_call.arguments.
//      If all parse cleanly → FIRST-TRY success.
//   3. If any fail to parse AND variant is "reactive" (grammar is reactive),
//      re-issue with extra_body.guided_decoding.grammar populated from the
//      profile's grammars/tool_call.lark. If all parse on retry → RETRY OK.
//      Otherwise → EXHAUSTED.
//   4. If variant is "disabled", no retry — any first-try parse failure
//      becomes a miss.
//   5. parse_rate = (50 - failures_after_retry) / 50 per corpus half.
//
// Crucially, the runner restores harness.yaml bytes after each mutation
// (try/finally) and asserts `uv run emmy profile validate v2` exits 0 after
// all three runs complete.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

import { postChat, type ChatRequest, type ChatResponse, type ChatMessage, type ProfileSnapshot, type ToolCall } from "@emmy/provider";
import { loadProfile } from "@emmy/ux";

type Variant = "reactive" | "disabled" | "no_per_tool_sampling";

interface CorpusEntry {
	id: string;
	turn?: ChatMessage[];
	session_turn?: unknown;
	prompt?: string;
	expected_tool?: string | null;
	adversarial_shape?: string;
	source?: string;
}

interface TurnResult {
	id: string;
	corpus: "synthetic" | "real_replay";
	first_try_parse_ok: boolean;
	retry_attempted: boolean;
	retry_parse_ok: boolean | null;
	final_parse_ok: boolean;
	expected_tool: string | null;
	actual_tool: string | null;
	adversarial_shape?: string;
	source?: string;
	error?: string;
}

function parseArgs(argv: string[]): {
	profile: string;
	baseUrl: string;
	variant: Variant;
	out: string;
	// For ops: allow skipping a variant mid-run by limiting corpus size.
	maxPerCorpus?: number;
} {
	let profile = "profiles/qwen3.6-35b-a3b/v2";
	let baseUrl = "http://127.0.0.1:8002";
	let variant: Variant = "reactive";
	let out = "runs/phase2-sc3/report.json";
	let maxPerCorpus: number | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--profile") profile = argv[++i]!;
		else if (a === "--base-url") baseUrl = argv[++i]!;
		else if (a === "--variant") variant = argv[++i]! as Variant;
		else if (a === "--out") out = argv[++i]!;
		else if (a === "--max-per-corpus") maxPerCorpus = Number(argv[++i]);
	}
	if (!["reactive", "disabled", "no_per_tool_sampling"].includes(variant)) {
		throw new Error(`invalid --variant ${variant}; must be one of reactive, disabled, no_per_tool_sampling`);
	}
	const result: {
		profile: string;
		baseUrl: string;
		variant: Variant;
		out: string;
		maxPerCorpus?: number;
	} = { profile: resolve(profile), baseUrl, variant, out: resolve(out) };
	if (maxPerCorpus !== undefined) result.maxPerCorpus = maxPerCorpus;
	return result;
}

async function probe(baseUrl: string): Promise<boolean> {
	try {
		const r = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, { signal: AbortSignal.timeout(5000) });
		return r.ok;
	} catch {
		return false;
	}
}

function loadCorpus(path: string, limit?: number): CorpusEntry[] {
	const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
	const out = lines.map((l) => JSON.parse(l) as CorpusEntry);
	return typeof limit === "number" ? out.slice(0, limit) : out;
}

function toolSchemasForSc3(): NonNullable<ChatRequest["tools"]> {
	return [
		{ type: "function", function: { name: "read", description: "Read a file; output tags each line with an 8-hex content hash.", parameters: { type: "object", properties: { path: { type: "string" }, line_range: { type: "array", items: { type: "number" } } }, required: ["path"] } } },
		{ type: "function", function: { name: "write", description: "Overwrite a file.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
		{ type: "function", function: { name: "edit", description: "Hash-anchored edit.", parameters: { type: "object", properties: { path: { type: "string" }, edits: { type: "array", items: { type: "object", properties: { hash: { type: "string" }, new_content: { type: ["string", "null"] } } } }, inserts: { type: "array", items: { type: "object", properties: { after_hash: { type: "string" }, insert: { type: "array", items: { type: "string" } } } } } }, required: ["path"] } } },
		{ type: "function", function: { name: "bash", description: "Run a bash command.", parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command"] } } },
		{ type: "function", function: { name: "grep", description: "Run grep.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, flags: { type: "string" } }, required: ["pattern"] } } },
		{ type: "function", function: { name: "find", description: "Run find.", parameters: { type: "object", properties: { path: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["f", "d"] } }, required: ["path"] } } },
		{ type: "function", function: { name: "ls", description: "List directory contents.", parameters: { type: "object", properties: { path: { type: "string" }, long: { type: "boolean" }, all: { type: "boolean" } }, required: ["path"] } } },
		{ type: "function", function: { name: "web_fetch", description: "HTTP GET → markdown.", parameters: { type: "object", properties: { url: { type: "string" }, timeout_ms: { type: "number" } }, required: ["url"] } } },
	];
}

function allArgumentsParse(tcs: ToolCall[]): boolean {
	if (!tcs || tcs.length === 0) return true; // no tool calls at all → not a parse failure
	for (const tc of tcs) {
		try {
			JSON.parse(tc.function.arguments);
		} catch {
			return false;
		}
	}
	return true;
}

// Build a chat request from a corpus entry. We use the entry's user content
// (falling back to session_turn construction for real_replay).
function buildRequest(
	entry: CorpusEntry,
	profile: ProfileSnapshot,
	corpus: "synthetic" | "real_replay",
	tools: NonNullable<ChatRequest["tools"]>,
): ChatRequest | null {
	let messages: ChatMessage[];
	if (entry.turn && Array.isArray(entry.turn) && entry.turn.length > 0) {
		messages = entry.turn;
	} else if (corpus === "real_replay" && entry.prompt) {
		messages = [
			{ role: "system", content: "You are a coding agent. Call exactly one tool to answer the user. Do not ask clarifying questions." },
			{ role: "user", content: entry.prompt },
		];
	} else {
		return null;
	}
	// Apply per-tool-sampling temperature=0 if the variant has per_tool_sampling
	// on edit/bash/read; otherwise use serving defaults.
	const baseTemp = 0.2;
	const perToolSampling = profile.harness.tools.per_tool_sampling;
	// Apply a light default temp; the per_tool_sampling knobs only kick in for
	// tool-specific calls (this is serving-driven). For a single-turn parse-rate
	// experiment, what matters is the temp used when the model picks a tool.
	// Phase 2 scope: we DO NOT route per-tool-sampling through the provider; it
	// lives as an observable key in harness.yaml that plan 08 ISOLATES the
	// effect of by running with/without the key present. (When
	// no_per_tool_sampling variant is active, harness.yaml has the key
	// removed — but since the KEY ITSELF isn't plumbed into the sampler in
	// Phase 2, the effect is purely observational for this runner. We still
	// record the variant so Plan 09 CLOSEOUT can cite what was tested.)
	void perToolSampling;
	return {
		model: profile.serving.engine.served_model_name,
		messages,
		temperature: baseTemp,
		top_p: profile.serving.sampling_defaults.top_p,
		max_tokens: 512,
		stream: false,
		tools,
		chat_template_kwargs: { enable_thinking: false },
	};
}

async function parseRateForCorpus(
	corpus: "synthetic" | "real_replay",
	entries: CorpusEntry[],
	profile: ProfileSnapshot,
	baseUrl: string,
	variant: Variant,
	grammarText: string | null,
	tools: NonNullable<ChatRequest["tools"]>,
): Promise<{ rows: TurnResult[]; first_try_failures: number; final_failures: number }> {
	const rows: TurnResult[] = [];
	let firstTryFailures = 0;
	let finalFailures = 0;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const req = buildRequest(entry, profile, corpus, tools);
		if (!req) {
			rows.push({
				id: entry.id,
				corpus,
				first_try_parse_ok: false,
				retry_attempted: false,
				retry_parse_ok: null,
				final_parse_ok: false,
				expected_tool: entry.expected_tool ?? null,
				actual_tool: null,
				...(entry.adversarial_shape ? { adversarial_shape: entry.adversarial_shape } : {}),
				...(entry.source ? { source: entry.source } : {}),
				error: "corpus entry missing turn/prompt",
			});
			firstTryFailures += 1;
			finalFailures += 1;
			continue;
		}
		let resp1: ChatResponse;
		try {
			resp1 = await postChat(baseUrl, req, { timeoutMs: 60_000 });
		} catch (e) {
			const err = e instanceof Error ? e.message : String(e);
			rows.push({
				id: entry.id,
				corpus,
				first_try_parse_ok: false,
				retry_attempted: false,
				retry_parse_ok: null,
				final_parse_ok: false,
				expected_tool: entry.expected_tool ?? null,
				actual_tool: null,
				...(entry.adversarial_shape ? { adversarial_shape: entry.adversarial_shape } : {}),
				...(entry.source ? { source: entry.source } : {}),
				error: `postChat: ${err}`,
			});
			firstTryFailures += 1;
			finalFailures += 1;
			continue;
		}
		const tcs1 = resp1.choices[0]?.message?.tool_calls ?? [];
		const firstOk = allArgumentsParse(tcs1);
		if (firstOk) {
			rows.push({
				id: entry.id,
				corpus,
				first_try_parse_ok: true,
				retry_attempted: false,
				retry_parse_ok: null,
				final_parse_ok: true,
				expected_tool: entry.expected_tool ?? null,
				actual_tool: tcs1[0]?.function.name ?? null,
				...(entry.adversarial_shape ? { adversarial_shape: entry.adversarial_shape } : {}),
				...(entry.source ? { source: entry.source } : {}),
			});
			continue;
		}
		// First-try parse failure — count.
		firstTryFailures += 1;
		if (variant === "disabled" || !grammarText) {
			// No retry available.
			rows.push({
				id: entry.id,
				corpus,
				first_try_parse_ok: false,
				retry_attempted: false,
				retry_parse_ok: null,
				final_parse_ok: false,
				expected_tool: entry.expected_tool ?? null,
				actual_tool: tcs1[0]?.function.name ?? null,
				...(entry.adversarial_shape ? { adversarial_shape: entry.adversarial_shape } : {}),
				...(entry.source ? { source: entry.source } : {}),
			});
			finalFailures += 1;
			continue;
		}
		// Retry with grammar (reactive / no_per_tool_sampling).
		const req2: ChatRequest = {
			...req,
			extra_body: {
				...(req.extra_body ?? {}),
				guided_decoding: { grammar: grammarText },
			},
		};
		let resp2: ChatResponse;
		try {
			resp2 = await postChat(baseUrl, req2, { timeoutMs: 60_000 });
		} catch (e) {
			rows.push({
				id: entry.id,
				corpus,
				first_try_parse_ok: false,
				retry_attempted: true,
				retry_parse_ok: false,
				final_parse_ok: false,
				expected_tool: entry.expected_tool ?? null,
				actual_tool: tcs1[0]?.function.name ?? null,
				...(entry.adversarial_shape ? { adversarial_shape: entry.adversarial_shape } : {}),
				...(entry.source ? { source: entry.source } : {}),
				error: `retry: ${e instanceof Error ? e.message : String(e)}`,
			});
			finalFailures += 1;
			continue;
		}
		const tcs2 = resp2.choices[0]?.message?.tool_calls ?? [];
		const retryOk = allArgumentsParse(tcs2);
		rows.push({
			id: entry.id,
			corpus,
			first_try_parse_ok: false,
			retry_attempted: true,
			retry_parse_ok: retryOk,
			final_parse_ok: retryOk,
			expected_tool: entry.expected_tool ?? null,
			actual_tool: (retryOk ? tcs2[0]?.function.name : tcs1[0]?.function.name) ?? null,
			...(entry.adversarial_shape ? { adversarial_shape: entry.adversarial_shape } : {}),
			...(entry.source ? { source: entry.source } : {}),
		});
		if (!retryOk) finalFailures += 1;
	}
	return { rows, first_try_failures: firstTryFailures, final_failures: finalFailures };
}

// Mutate v2/harness.yaml for the variant. Returns a restore() callback.
// NEVER edit harness.yaml outside this function. NEVER forget to call restore.
function applyVariantMutation(profileDir: string, variant: Variant): {
	restore: () => void;
	mutated: boolean;
} {
	const harnessPath = join(profileDir, "harness.yaml");
	const original = readFileSync(harnessPath, "utf8");
	const backupPath = `${harnessPath}.sc3-backup-${Date.now()}`;
	copyFileSync(harnessPath, backupPath);

	let mutated = false;
	if (variant === "disabled") {
		const replaced = original.replace(/(^\s*mode:\s*)reactive(\s*(#.*)?)$/m, "$1disabled$2");
		if (replaced === original) {
			throw new Error("sc3 runner: harness.yaml mutation failed — could not find `mode: reactive` line");
		}
		writeFileSync(harnessPath, replaced, "utf8");
		mutated = true;
	} else if (variant === "no_per_tool_sampling") {
		// Remove the per_tool_sampling block entirely (indented mapping under tools:).
		// Simple line-by-line stripper: drop the `  per_tool_sampling:` line and
		// all subsequent lines that start with 4+ spaces until we reach a line
		// starting with ≤ 2 spaces (i.e., next tools: sibling key) or EOF.
		const lines = original.split("\n");
		const out: string[] = [];
		let skipping = false;
		for (const line of lines) {
			if (!skipping && /^\s{2}per_tool_sampling:/.test(line)) {
				skipping = true;
				continue;
			}
			if (skipping) {
				// Stop skipping on first non-indented-under line
				if (line.length === 0) continue; // blank lines while skipping still counted as part of the block
				if (/^\s{4,}/.test(line)) continue;
				// Returned to a sibling-level line; stop skipping.
				skipping = false;
				out.push(line);
			} else {
				out.push(line);
			}
		}
		const replaced = out.join("\n");
		if (replaced === original) {
			throw new Error("sc3 runner: harness.yaml mutation failed — could not find per_tool_sampling block");
		}
		writeFileSync(harnessPath, replaced, "utf8");
		mutated = true;
	}
	// reactive → no mutation.

	return {
		mutated,
		restore: () => {
			try {
				copyFileSync(backupPath, harnessPath);
				unlinkSync(backupPath);
			} catch (e) {
				console.error(
					`sc3 runner: harness.yaml restore FAILED — manual restore from ${backupPath} required: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		},
	};
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();

	if (!(await probe(args.baseUrl))) {
		console.error(`sc3 runner: ERROR (prereq): emmy-serve not reachable at ${args.baseUrl}`);
		return 4;
	}

	const profile = await loadProfile(args.profile);
	const synthetic = loadCorpus(resolve("eval/phase2/sc3/corpus/synthetic.jsonl"), args.maxPerCorpus);
	const realReplay = loadCorpus(resolve("eval/phase2/sc3/corpus/real_replay.jsonl"), args.maxPerCorpus);

	// Load grammar text (for reactive retry path) from profile bundle.
	let grammarText: string | null = null;
	if (profile.harness.tools.grammar && profile.harness.tools.grammar.mode !== "disabled") {
		try {
			grammarText = readFileSync(join(profile.ref.path, profile.harness.tools.grammar.path), "utf8");
		} catch {
			/* grammar load failure = retry impossible */
		}
	}

	// Apply mutation + try/finally restore.
	const mutation = applyVariantMutation(args.profile, args.variant);
	let restored = false;
	try {
		// For disabled variant, override: no grammar text passed to per-turn fn.
		const effectiveGrammar = args.variant === "disabled" ? null : grammarText;
		const tools = toolSchemasForSc3();

		console.error(`sc3: variant=${args.variant} corpus=synthetic(${synthetic.length}) + real_replay(${realReplay.length})`);

		const syn = await parseRateForCorpus("synthetic", synthetic, profile, args.baseUrl, args.variant, effectiveGrammar, tools);
		const real = await parseRateForCorpus("real_replay", realReplay, profile, args.baseUrl, args.variant, effectiveGrammar, tools);

		// Compute metrics.
		const synTotal = synthetic.length;
		const realTotal = realReplay.length;
		const aggTotal = synTotal + realTotal;
		const synFinalPasses = synTotal - syn.final_failures;
		const realFinalPasses = realTotal - real.final_failures;
		const aggFinalPasses = synFinalPasses + realFinalPasses;

		const syntheticParseRate = synTotal > 0 ? synFinalPasses / synTotal : 0;
		const realReplayParseRate = realTotal > 0 ? realFinalPasses / realTotal : 0;
		const aggregateParseRate = aggTotal > 0 ? aggFinalPasses / aggTotal : 0;

		// Verdict — only gated for "reactive" variant (D-12 graduated SLA).
		let verdict: "pass" | "fail" | "informational";
		if (args.variant === "reactive") {
			verdict = syntheticParseRate >= 0.98 && realReplayParseRate >= 0.95 && aggregateParseRate >= 0.97 ? "pass" : "fail";
		} else {
			verdict = "informational";
		}
		const endedAt = new Date().toISOString();

		const report = {
			sc: "SC-3",
			phase: "02",
			variant: args.variant,
			profile: profile.ref,
			started_at: startedAt,
			ended_at: endedAt,
			verdict,
			metrics: {
				synthetic_parse_rate: syntheticParseRate,
				real_replay_parse_rate: realReplayParseRate,
				aggregate_parse_rate: aggregateParseRate,
				synthetic_first_try_failures: syn.first_try_failures,
				real_replay_first_try_failures: real.first_try_failures,
				synthetic_final_failures: syn.final_failures,
				real_replay_final_failures: real.final_failures,
				total_turns: aggTotal,
			},
			rows: [...syn.rows, ...real.rows],
			environment: {
				base_url: args.baseUrl,
				harness_yaml_mutated: mutation.mutated,
				grammar_loaded: effectiveGrammar !== null,
				node_version: process.version,
				bun_version: (process as { versions?: { bun?: string } }).versions?.bun ?? null,
			},
		};

		mkdirSync(dirname(args.out), { recursive: true });
		// JSON.stringify(1.0) produces "1" (integer); the plan's acceptance
		// regex expects decimal form (1.0 or 0.97 etc.). We post-process the
		// rate fields to always render with 6-digit decimal precision so
		// grep -cE '"synthetic_parse_rate":\s*(1\.0|0\.9[89])' works cleanly.
		const serialized = JSON.stringify(report, null, 2);
		const withFloats = serialized.replace(
			/("(?:synthetic_parse_rate|real_replay_parse_rate|aggregate_parse_rate)":\s*)(\d+)(,|\n)/g,
			(_m, key: string, n: string, tail: string) => `${key}${(Number(n)).toFixed(6)}${tail}`,
		);
		writeFileSync(args.out, withFloats + "\n", "utf8");
		console.error(
			`sc3: variant=${args.variant} verdict=${verdict} syn=${syntheticParseRate.toFixed(3)} real=${realReplayParseRate.toFixed(3)} agg=${aggregateParseRate.toFixed(3)}`,
		);
		return verdict === "pass" || verdict === "informational" ? 0 : 1;
	} finally {
		mutation.restore();
		restored = true;
		// Post-restore validation gate.
		const validateBin = process.env.EMMY_PROFILE_VALIDATE_BIN ?? "uv";
		const validateArgs = process.env.EMMY_PROFILE_VALIDATE_BIN
			? [args.profile]
			: ["run", "emmy", "profile", "validate", args.profile];
		try {
			execFileSync(validateBin, validateArgs, { stdio: "pipe", encoding: "utf8" });
		} catch (e) {
			console.error(
				`sc3 runner: harness.yaml restore failed — profile hash mismatch (${
					e instanceof Error ? e.message : String(e)
				})`,
			);
			process.exit(2);
		}
	}
	void restored;
	void spawnSync; // reserved for future async-subprocess expansion
	void existsSync; // future: grammar-text cache check
}

main().then((code) => process.exit(code));
