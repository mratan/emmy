#!/usr/bin/env bun
// eval/phase2/sc3/corpus_fill.ts
//
// Backfill helper for SC-3's real-replay corpus when runs/phase2-sc3-capture/
// is short (< 50 tool-call turns). Runs a rotating set of real prompts from
// the prior-repo eval_tasks.py against live emmy-serve with the native tool
// schemas declared. Captures the model's tool_calls and writes them as JSONL
// turns directly to real_replay.jsonl — no full pi-emmy agent loop needed.
//
// The corpus_fill approach is equivalent to pi-emmy's transcript capture in
// shape (every entry has a system message + user prompt + model's tool call),
// but runs faster because we only issue ONE model turn per prompt (not a
// multi-turn agent loop).
//
// Plan note (D-13): real-replay entries need not be "real daily-driver sessions"
// — they need to be "real-shape" (i.e., produced by the actual model under
// the actual profile's tool schemas and grammar). This helper produces that.
// The README.md documents which entries are naturally captured vs backfilled.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { postChat, type ChatMessage, type ChatRequest, type ChatResponse } from "@emmy/provider";
import { loadProfile } from "@emmy/ux";

// Rotating prompts — a mix of code, literature, file-ops, and debugging prompts
// that together exercise every native tool. Lifted spirit (not verbatim) from
// /data/projects/setup_local_opencode/validation/eval_tasks.py.
const PROMPTS: Array<{ prompt: string; hint?: string }> = [
	{ prompt: "Read the file /etc/hostname." },
	{ prompt: "Show me the contents of /etc/os-release by reading it." },
	{ prompt: "List the contents of /tmp." },
	{ prompt: "Write 'hello' to /tmp/corpus_fill_01.txt." },
	{ prompt: "Find all .py files in /tmp (just use find)." },
	{ prompt: "Grep for 'python' in /etc/passwd." },
	{ prompt: "Run 'uname -a' as a bash command." },
	{ prompt: "Read /etc/hosts and tell me how many lines it has." },
	{ prompt: "Write 'def hello():\\n    return 42\\n' to /tmp/corpus_fill_02.py." },
	{ prompt: "Find files modified in the last day in /tmp using bash." },
	{ prompt: "Web_fetch https://example.com." },
	{ prompt: "Ls /var/log with --long." },
	{ prompt: "Grep with flags '-c' for 'root' in /etc/passwd." },
	{ prompt: "Bash: echo $HOME && pwd." },
	{ prompt: "Read lines 1 to 10 of /etc/shells." },
	{ prompt: "Write a simple python script saying hi to /tmp/corpus_fill_03.py." },
	{ prompt: "Find /tmp -type d." },
	{ prompt: "Ls / -a." },
	{ prompt: "Grep 'nobody' in /etc/passwd." },
	{ prompt: "Read /proc/version." },
	{ prompt: "Bash: date." },
	{ prompt: "Web_fetch https://httpbin.org/get." },
	{ prompt: "Find /usr -name 'bash' -type f." },
	{ prompt: "Ls /usr/bin." },
	{ prompt: "Grep -rn 'TODO' in /etc." },
	{ prompt: "Read /tmp/corpus_fill_01.txt." },
	{ prompt: "Bash: echo hello | wc -c." },
	{ prompt: "Ls /etc." },
	{ prompt: "Find / -name 'python*' -type f in bash." },
	{ prompt: "Grep 'PATH' in /etc/environment." },
	{ prompt: "Write '# log' to /tmp/corpus_fill_04.log." },
	{ prompt: "Read /etc/resolv.conf." },
	{ prompt: "Bash: df -h /." },
	{ prompt: "Ls /home." },
	{ prompt: "Find /tmp -name 'corpus*' -type f." },
	{ prompt: "Grep -l 'systemd' in /etc." },
	{ prompt: "Web_fetch https://en.wikipedia.org/wiki/JSON." },
	{ prompt: "Read /etc/group and pick the first line." },
	{ prompt: "Bash: ps aux | head -5." },
	{ prompt: "Ls /proc." },
	{ prompt: "Write 'done\\n' to /tmp/corpus_fill_05.txt." },
	{ prompt: "Find /etc -maxdepth 1 -type d." },
	{ prompt: "Grep 'nameserver' in /etc/resolv.conf." },
	{ prompt: "Read /etc/shells." },
	{ prompt: "Bash: uptime." },
	{ prompt: "Ls /var." },
	{ prompt: "Web_fetch https://raw.githubusercontent.com/octocat/Hello-World/master/README." },
	{ prompt: "Grep -n 'lo' in /etc/hosts." },
	{ prompt: "Find /usr/local -maxdepth 2 -type d." },
	{ prompt: "Read /etc/machine-id." },
];

const TOOL_SCHEMAS: NonNullable<ChatRequest["tools"]> = [
	{ type: "function", function: { name: "read", description: "Read a file; output tags each line with an 8-hex content hash.", parameters: { type: "object", properties: { path: { type: "string" }, line_range: { type: "array", items: { type: "number" } } }, required: ["path"] } } },
	{ type: "function", function: { name: "write", description: "Overwrite a file.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
	{ type: "function", function: { name: "edit", description: "Hash-anchored edit.", parameters: { type: "object", properties: { path: { type: "string" }, edits: { type: "array", items: { type: "object", properties: { hash: { type: "string" }, new_content: { type: ["string", "null"] } } } }, inserts: { type: "array", items: { type: "object", properties: { after_hash: { type: "string" }, insert: { type: "array", items: { type: "string" } } } } } }, required: ["path"] } } },
	{ type: "function", function: { name: "bash", description: "Run a bash command.", parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command"] } } },
	{ type: "function", function: { name: "grep", description: "Run grep.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, flags: { type: "string" } }, required: ["pattern"] } } },
	{ type: "function", function: { name: "find", description: "Run find.", parameters: { type: "object", properties: { path: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["f", "d"] } }, required: ["path"] } } },
	{ type: "function", function: { name: "ls", description: "List directory contents.", parameters: { type: "object", properties: { path: { type: "string" }, long: { type: "boolean" }, all: { type: "boolean" } }, required: ["path"] } } },
	{ type: "function", function: { name: "web_fetch", description: "HTTP GET → markdown.", parameters: { type: "object", properties: { url: { type: "string" }, timeout_ms: { type: "number" } }, required: ["url"] } } },
];

function parseArgs(argv: string[]): { profile: string; baseUrl: string; out: string; count: number; captureDir: string } {
	let profile = "profiles/qwen3.6-35b-a3b/v2";
	let baseUrl = "http://127.0.0.1:8002";
	let out = "eval/phase2/sc3/corpus/real_replay.jsonl";
	let count = 50;
	let captureDir = "runs/phase2-sc3-capture";
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--profile") profile = argv[++i]!;
		else if (a === "--base-url") baseUrl = argv[++i]!;
		else if (a === "--out") out = argv[++i]!;
		else if (a === "--count") count = Number(argv[++i]);
		else if (a === "--capture-dir") captureDir = argv[++i]!;
	}
	return { profile: resolve(profile), baseUrl, out: resolve(out), count, captureDir: resolve(captureDir) };
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const profile = await loadProfile(args.profile);

	// 1. Count available tool-call turns in captureDir (the passively captured
	//    pi-emmy transcripts from Plan 04's B2 machinery). If ≥ count, sample
	//    from there; otherwise backfill via single-turn postChat.
	let naturallyCaptured = 0;
	const captured: Array<Record<string, unknown>> = [];
	if (existsSync(args.captureDir)) {
		const sessionFiles = readdirSync(args.captureDir)
			.filter((f) => f.startsWith("session-") && f.endsWith(".jsonl"))
			.map((f) => join(args.captureDir, f))
			.filter((p) => {
				try { return statSync(p).size > 0; } catch { return false; }
			});
		for (const sf of sessionFiles) {
			const lines = readFileSync(sf, "utf8").split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const obj = JSON.parse(line) as Record<string, unknown>;
					// Count entries that look like tool-call turns (have tool_calls).
					if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
						captured.push(obj);
					}
				} catch { /* skip */ }
			}
		}
		naturallyCaptured = captured.length;
	}
	console.error(`corpus_fill: naturally captured tool-call turns in ${args.captureDir} = ${naturallyCaptured}`);

	// 2. If we have ≥ count, sample directly.
	const output: Record<string, unknown>[] = [];
	if (naturallyCaptured >= args.count) {
		// Even sampling with a simple stride.
		const stride = Math.max(1, Math.floor(naturallyCaptured / args.count));
		for (let i = 0; i < args.count && output.length < args.count; i++) {
			const idx = (i * stride) % naturallyCaptured;
			const turn = captured[idx];
			output.push({
				id: `real_${String(i + 1).padStart(2, "0")}`,
				source: "natural-capture",
				session_turn: turn,
				expected_tool: (turn as { tool_calls?: Array<{ function?: { name?: string } }> }).tool_calls?.[0]?.function?.name ?? null,
			});
		}
	} else {
		// 3. Otherwise backfill via single-turn postChat.
		const needed = args.count - naturallyCaptured;
		console.error(`corpus_fill: backfilling ${needed} entries via postChat (captured ${naturallyCaptured} already will be appended first)`);
		// First, append what we captured.
		for (let i = 0; i < naturallyCaptured && output.length < args.count; i++) {
			const turn = captured[i];
			output.push({
				id: `real_${String(output.length + 1).padStart(2, "0")}`,
				source: "natural-capture",
				session_turn: turn,
				expected_tool: (turn as { tool_calls?: Array<{ function?: { name?: string } }> }).tool_calls?.[0]?.function?.name ?? null,
			});
		}
		// Then backfill.
		for (let i = 0; i < needed; i++) {
			const p = PROMPTS[i % PROMPTS.length]!;
			const messages: ChatMessage[] = [
				{ role: "system", content: "You are a coding agent. Call exactly one tool to answer the user. Do not ask clarifying questions." },
				{ role: "user", content: p.prompt },
			];
			const req: ChatRequest = {
				model: profile.serving.engine.served_model_name,
				messages,
				temperature: 0.2,
				top_p: profile.serving.sampling_defaults.top_p,
				max_tokens: 512,
				stream: false,
				tools: TOOL_SCHEMAS,
				chat_template_kwargs: { enable_thinking: false },
			};
			try {
				const resp: ChatResponse = await postChat(args.baseUrl, req, { timeoutMs: 60_000 });
				const msg = resp.choices[0]?.message;
				if (!msg) continue;
				const entry: Record<string, unknown> = {
					id: `real_${String(output.length + 1).padStart(2, "0")}`,
					source: "backfill-postChat",
					prompt: p.prompt,
					session_turn: {
						role: "assistant",
						content: msg.content ?? null,
						tool_calls: msg.tool_calls ?? [],
					},
					expected_tool: msg.tool_calls?.[0]?.function?.name ?? null,
				};
				output.push(entry);
				if ((i + 1) % 10 === 0) {
					console.error(`corpus_fill: backfilled ${i + 1}/${needed}`);
				}
			} catch (e) {
				console.error(`corpus_fill: iteration ${i} failed: ${e instanceof Error ? e.message : String(e)}; continuing`);
			}
			if (output.length >= args.count) break;
		}
	}

	// Trim to exactly count.
	while (output.length > args.count) output.pop();

	const lines = output.map((o) => JSON.stringify(o)).join("\n") + "\n";
	writeFileSync(args.out, lines, "utf8");
	console.error(`corpus_fill: wrote ${output.length} entries to ${args.out}`);
	console.error(`corpus_fill: source breakdown — natural=${output.filter((o) => o.source === "natural-capture").length}, backfill=${output.filter((o) => o.source === "backfill-postChat").length}`);
	return output.length === args.count ? 0 : 1;
}

main().then((code) => process.exit(code));
