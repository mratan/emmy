#!/usr/bin/env bun
// eval/phase2/sc2/run_sc2.ts
//
// SC-2 hash-anchored edit regression driver.
//
// Imports @emmy/ux + @emmy/tools as libraries (per plan "eval imports harness
// as a library"). For each fixture:
//   1. Stage a tmp workdir with fixture_files.
//   2. Run an in-process minimal agent loop against emmy-serve (postChat) with
//      the native-tool schemas declared as `tools`. Max 8 turns.
//   3. Count hash-anchored edit string-not-found failures (StaleHashError /
//      HashResolutionError).
//   4. Repeat with a BASELINE edit tool that replaces the hash-anchored path
//      with plain string-replace. Count baseline string-not-found failures.
//   5. Emit runs/phase2-sc2/report.json with verdict.

import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve, basename, dirname } from "node:path";

import { postChat, type ChatMessage, type ChatRequest, type ChatResponse, type ProfileSnapshot } from "@emmy/provider";
import { loadProfile } from "@emmy/ux";
import {
	editHashline,
	HashResolutionError,
	readWithHashes,
	renderHashedLines,
	StaleHashError,
	ToolsError,
} from "@emmy/tools";

interface Fixture {
	task_id: string;
	source: string;
	exercises_edit: boolean;
	title: string;
	fixture_files: Record<string, string>;
	prompt: string;
	expected_rubric: string;
	notes?: string;
}

interface VariantResult {
	invocations: number;
	string_not_found_failures: number;
	completed: boolean;
	turn_count: number;
	tool_calls_attempted: string[];
	notes: string[];
}

interface FixtureRow {
	task_id: string;
	source: string;
	hash_anchored: VariantResult;
	baseline: VariantResult;
}

function parseArgs(argv: string[]): { profile: string; baseUrl: string; out: string } {
	let profile = "profiles/qwen3.6-35b-a3b/v2";
	let baseUrl = "http://127.0.0.1:8002";
	let out = "runs/phase2-sc2/";
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--profile") profile = argv[++i]!;
		else if (a === "--base-url") baseUrl = argv[++i]!;
		else if (a === "--out") out = argv[++i]!;
	}
	return { profile: resolve(profile), baseUrl, out: resolve(out) };
}

async function probe(baseUrl: string): Promise<boolean> {
	try {
		const r = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
			signal: AbortSignal.timeout(5000),
		});
		return r.ok;
	} catch {
		return false;
	}
}

function stageWorkdir(files: Record<string, string>): string {
	const base = `/tmp/emmy-sc2-${Date.now()}-${randomBytes(4).toString("hex")}`;
	mkdirSync(base, { recursive: true });
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(base, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content, "utf8");
	}
	return base;
}

// Baseline plain string-replace "edit" tool — the counterfactual.
// Replaces the first occurrence of old_string with new_string.
// Fails with "string not found" when old_string is absent OR appears multiple times.
function baselineEdit(args: {
	path: string;
	old_string?: string;
	new_string?: string;
}): { ok: true; bytes_written: number } | { ok: false; error: "string_not_found" | "ambiguous_match" | "other"; message: string } {
	const old = typeof args.old_string === "string" ? args.old_string : "";
	const neu = typeof args.new_string === "string" ? args.new_string : "";
	if (!old) {
		return { ok: false, error: "other", message: "old_string required" };
	}
	let contents: string;
	try {
		contents = readFileSync(args.path, "utf8");
	} catch (e) {
		return { ok: false, error: "other", message: `read failed: ${e instanceof Error ? e.message : String(e)}` };
	}
	const first = contents.indexOf(old);
	if (first < 0) {
		return { ok: false, error: "string_not_found", message: `old_string not found in ${args.path}` };
	}
	const second = contents.indexOf(old, first + old.length);
	if (second >= 0) {
		return { ok: false, error: "ambiguous_match", message: `old_string matches multiple locations in ${args.path}` };
	}
	const updated = contents.slice(0, first) + neu + contents.slice(first + old.length);
	writeFileSync(args.path, updated, "utf8");
	return { ok: true, bytes_written: Buffer.byteLength(updated, "utf8") };
}

// Tool schemas the model sees for BOTH variants. The `edit` schema shape
// differs between variants (hash-anchored vs old_string/new_string) — keeping
// the shape clean per variant avoids model confusion.
function toolSchemas(variant: "hash_anchored" | "baseline"): Record<string, unknown>[] {
	const editSchema =
		variant === "hash_anchored"
			? {
					type: "function",
					function: {
						name: "edit",
						description:
							"Hash-anchored edit (DEFAULT). Every line in a prior read is tagged {8hex}{2sp}{content}; edits reference individual line hashes. Use edits for replace/delete, inserts for new lines.",
						parameters: {
							type: "object",
							properties: {
								path: { type: "string" },
								edits: {
									type: "array",
									items: {
										type: "object",
										properties: {
											hash: { type: "string", description: "8-hex line hash from last read" },
											new_content: { type: ["string", "null"], description: "replacement line (no newline) or null to delete" },
										},
										required: ["hash", "new_content"],
									},
								},
								inserts: {
									type: "array",
									items: {
										type: "object",
										properties: {
											after_hash: { type: "string" },
											insert: { type: "array", items: { type: "string" } },
										},
										required: ["after_hash", "insert"],
									},
								},
							},
							required: ["path"],
						},
					},
				}
			: {
					type: "function",
					function: {
						name: "edit",
						description:
							"Plain string-replace edit (baseline counterfactual). Replace the first occurrence of old_string with new_string in path. Fails if old_string is not found or matches multiple locations.",
						parameters: {
							type: "object",
							properties: {
								path: { type: "string" },
								old_string: { type: "string" },
								new_string: { type: "string" },
							},
							required: ["path", "old_string", "new_string"],
						},
					},
				};
	return [
		{
			type: "function",
			function: {
				name: "read",
				description: "Read a file. Returns content with 8-hex hash prefixes per line for the hash-anchored edit tool (hash prefixes apply only when hash-anchored edit is available).",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
					},
					required: ["path"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "write",
				description: "Overwrite a file with content.",
				parameters: {
					type: "object",
					properties: {
						path: { type: "string" },
						content: { type: "string" },
					},
					required: ["path", "content"],
				},
			},
		},
		editSchema,
		{
			type: "function",
			function: {
				name: "ls",
				description: "List files in a directory.",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "done",
				description: "Signal task completion. Call this when you believe the task is complete.",
				parameters: {
					type: "object",
					properties: { summary: { type: "string" } },
					required: ["summary"],
				},
			},
		},
	];
}

function systemPromptFor(variant: "hash_anchored" | "baseline"): string {
	if (variant === "hash_anchored") {
		return [
			"You are a coding agent with access to read/write/edit/ls/done tools.",
			"",
			"EDIT TOOL PROTOCOL (hash-anchored, default):",
			"1. ALWAYS read() a file IMMEDIATELY before each edit() call. Read output tags every line with an 8-hex hash: `{hash}  {content}`.",
			"2. To REPLACE a line: pass edits=[{hash: '<8hex>', new_content: '<replacement>'}]. new_content MUST NOT contain \\n.",
			"3. To DELETE a line: pass edits=[{hash: '<8hex>', new_content: null}].",
			"4. To INSERT lines: pass inserts=[{after_hash: '<8hex>', insert: ['line a', 'line b']}].",
			"5. CRITICAL: after ANY edit() call that returned success, you MUST call read() AGAIN before the next edit() — the hashes change after a mutation. Skipping this causes StaleHashError.",
			"6. BATCH RULE: if you need multiple edits/inserts in the SAME call (single file), combine them into ONE edit() call — do not split across multiple edit() calls without re-reading in between.",
			"7. When the task is complete, call done() with a one-line summary. Do NOT keep editing once the file state satisfies the task.",
			"",
			"Keep edits minimal — never rewrite a whole file if you can edit specific lines.",
		].join("\n");
	}
	return [
		"You are a coding agent with access to read/write/edit/ls/done tools.",
		"",
		"EDIT TOOL PROTOCOL (plain string-replace):",
		"1. Read the file.",
		"2. Call edit(path, old_string, new_string) to replace the first occurrence of old_string with new_string.",
		"3. old_string MUST be unique within the file (no duplicates) or the call will fail.",
		"4. When done, call done() with a one-line summary.",
		"",
		"Keep edits minimal — do not rewrite a whole file if you can replace specific substrings.",
	].join("\n");
}

async function runAgentLoop(
	workdir: string,
	fixture: Fixture,
	variant: "hash_anchored" | "baseline",
	profile: ProfileSnapshot,
	baseUrl: string,
): Promise<VariantResult> {
	const tools = toolSchemas(variant);
	const system = systemPromptFor(variant);
	const messages: ChatMessage[] = [
		{ role: "system", content: system },
		{
			role: "user",
			content: [
				`Task: ${fixture.title}`,
				"",
				fixture.prompt,
				"",
				`Working directory: ${workdir}`,
				`Files present: ${Object.keys(fixture.fixture_files).join(", ")}`,
			].join("\n"),
		},
	];
	const result: VariantResult = {
		invocations: 0,
		string_not_found_failures: 0,
		completed: false,
		turn_count: 0,
		tool_calls_attempted: [],
		notes: [],
	};

	const MAX_TURNS = 8;
	for (let turn = 0; turn < MAX_TURNS; turn++) {
		result.turn_count = turn + 1;
		const req: ChatRequest = {
			model: profile.serving.engine.served_model_name,
			messages,
			temperature: 0.0,
			top_p: profile.serving.sampling_defaults.top_p,
			max_tokens: 2048,
			stream: false,
			tools: tools as ChatRequest["tools"],
			chat_template_kwargs: { enable_thinking: false },
		};
		let resp: ChatResponse;
		try {
			resp = await postChat(baseUrl, req, { timeoutMs: 120_000 });
		} catch (e) {
			result.notes.push(`turn ${turn + 1}: emmy-serve error: ${e instanceof Error ? e.message : String(e)}`);
			break;
		}
		const msg = resp.choices[0]?.message;
		if (!msg) {
			result.notes.push(`turn ${turn + 1}: empty response`);
			break;
		}
		messages.push({ role: "assistant", content: msg.content ?? null, ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
		const toolCalls = msg.tool_calls ?? [];
		if (toolCalls.length === 0) {
			// Model chose to just respond without tool calls — done
			result.notes.push(`turn ${turn + 1}: no tool calls (assistant text-only)`);
			break;
		}
		let shouldStop = false;
		for (const tc of toolCalls) {
			const name = tc.function.name;
			result.tool_calls_attempted.push(name);
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
			} catch (_e) {
				// Bad JSON — push a tool error back
				messages.push({
					role: "tool",
					tool_call_id: tc.id,
					content: JSON.stringify({ error: "tool_arguments_not_json", raw: tc.function.arguments.slice(0, 500) }),
				});
				result.notes.push(`turn ${turn + 1}: tool ${name} args unparseable`);
				continue;
			}
			// Resolve path relative to workdir if not absolute
			if (typeof args.path === "string" && !args.path.startsWith("/")) {
				args.path = join(workdir, args.path);
			}
			let toolOut: unknown;
			try {
				if (name === "read") {
					const r = readWithHashes(String(args.path));
					if (r.binary) toolOut = { path: args.path, binary: true, content_base64: r.content };
					else toolOut = { path: args.path, binary: false, lines: renderHashedLines(r.lines), line_count: r.lines.length };
				} else if (name === "write") {
					writeFileSync(String(args.path), String(args.content ?? ""), "utf8");
					toolOut = { path: args.path, bytes_written: Buffer.byteLength(String(args.content ?? ""), "utf8") };
				} else if (name === "edit") {
					result.invocations += 1;
					if (variant === "hash_anchored") {
						try {
							toolOut = await editHashline({
								path: String(args.path),
								edits: (args.edits as Array<{ hash: string; new_content: string | null }>) ?? [],
								inserts: (args.inserts as Array<{ after_hash: string; insert: string[] }>) ?? [],
							});
						} catch (e) {
							if (e instanceof StaleHashError || e instanceof HashResolutionError) {
								result.string_not_found_failures += 1;
								toolOut = { error: "edit_failed", class: e.constructor.name, message: e.message };
							} else if (e instanceof ToolsError) {
								toolOut = { error: "edit_failed", class: e.constructor.name, message: e.message };
							} else {
								toolOut = { error: "edit_failed", class: "Error", message: e instanceof Error ? e.message : String(e) };
							}
						}
					} else {
						const br = baselineEdit({
							path: String(args.path),
							old_string: typeof args.old_string === "string" ? args.old_string : undefined,
							new_string: typeof args.new_string === "string" ? args.new_string : undefined,
						});
						if (!br.ok) {
							if (br.error === "string_not_found" || br.error === "ambiguous_match") {
								result.string_not_found_failures += 1;
							}
							toolOut = { error: "edit_failed", reason: br.error, message: br.message };
						} else {
							toolOut = { ok: true, bytes_written: br.bytes_written };
						}
					}
				} else if (name === "ls") {
					const entries = readdirSync(String(args.path));
					toolOut = { path: args.path, entries };
				} else if (name === "done") {
					result.completed = true;
					shouldStop = true;
					toolOut = { done: true };
				} else {
					toolOut = { error: "unknown_tool", name };
				}
			} catch (e) {
				toolOut = { error: "tool_execution_failed", message: e instanceof Error ? e.message : String(e) };
			}
			messages.push({
				role: "tool",
				tool_call_id: tc.id,
				content: typeof toolOut === "string" ? toolOut : JSON.stringify(toolOut),
			});
		}
		if (shouldStop) break;
	}
	return result;
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();

	if (!(await probe(args.baseUrl))) {
		console.error(`sc2 runner: ERROR (prereq): emmy-serve not reachable at ${args.baseUrl}`);
		return 4;
	}
	const profile = await loadProfile(args.profile);

	// Load all fixtures.
	const fixtureDir = resolve("eval/phase2/sc2/fixtures");
	const fixtureFiles = readdirSync(fixtureDir)
		.filter((f) => f.startsWith("sc2_task_") && f.endsWith(".json"))
		.sort();
	const fixtures: Fixture[] = fixtureFiles.map(
		(f) => JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as Fixture,
	);

	console.error(`sc2: ${fixtures.length} fixtures, profile=${profile.ref.id}@${profile.ref.version}`);

	const rows: FixtureRow[] = [];
	for (const fixture of fixtures) {
		console.error(`sc2: task=${fixture.task_id} variant=hash_anchored`);
		const wd1 = stageWorkdir(fixture.fixture_files);
		const hashed = await runAgentLoop(wd1, fixture, "hash_anchored", profile, args.baseUrl);
		rmSync(wd1, { recursive: true, force: true });

		console.error(`sc2: task=${fixture.task_id} variant=baseline`);
		const wd2 = stageWorkdir(fixture.fixture_files);
		const baseline = await runAgentLoop(wd2, fixture, "baseline", profile, args.baseUrl);
		rmSync(wd2, { recursive: true, force: true });

		rows.push({
			task_id: fixture.task_id,
			source: fixture.source,
			hash_anchored: hashed,
			baseline: baseline,
		});
	}

	const hashAnchoredFailTotal = rows.reduce((s, r) => s + r.hash_anchored.string_not_found_failures, 0);
	const baselineFailTotal = rows.reduce((s, r) => s + r.baseline.string_not_found_failures, 0);
	const endedAt = new Date().toISOString();

	const verdict = hashAnchoredFailTotal === 0 && baselineFailTotal >= 1 ? "pass" : "fail";

	const report = {
		sc: "SC-2",
		phase: "02",
		profile: profile.ref,
		started_at: startedAt,
		ended_at: endedAt,
		verdict,
		metrics: {
			hash_anchored_string_not_found_failures_total: hashAnchoredFailTotal,
			baseline_string_not_found_failures_total: baselineFailTotal,
			delta_failures: baselineFailTotal - hashAnchoredFailTotal,
			fixtures_total: fixtures.length,
			fixtures_completed_hash_anchored: rows.filter((r) => r.hash_anchored.completed).length,
			fixtures_completed_baseline: rows.filter((r) => r.baseline.completed).length,
		},
		rows,
		environment: {
			base_url: args.baseUrl,
			node_version: process.version,
			bun_version: (process as { versions?: { bun?: string } }).versions?.bun ?? null,
			cwd: process.cwd(),
		},
	};

	mkdirSync(args.out, { recursive: true });
	const outFile = join(args.out, "report.json");
	writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
	console.error(`sc2: verdict=${verdict} report=${outFile}`);
	console.error(`sc2: hash_anchored_failures=${hashAnchoredFailTotal} baseline_failures=${baselineFailTotal}`);
	return verdict === "pass" ? 0 : 1;
}

// Use a content-hash of this file in commit metadata — not relevant here, left as docs.
void createHash;
void execSync;
void basename;

main().then((code) => process.exit(code));
