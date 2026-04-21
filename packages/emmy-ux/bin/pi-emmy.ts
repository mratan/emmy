#!/usr/bin/env bun
// packages/emmy-ux/bin/pi-emmy.ts
//
// pi-emmy — Phase-2 daily-driver CLI (D-03 / SC-1 verbatim).
//
// Boot sequence:
//   1. Parse argv.
//   2. Pre-flight (fail-loud with exit 4 on any missing prereq):
//      a. profile dir exists
//      b. vLLM reachable at baseUrl/v1/models within 5s
//      c. W5 FIX: `uv run emmy profile validate <path>` exits 0
//   3. loadProfile (rejects missing max_model_len per W4; nested grammar per B3).
//   4. createEmmySession (SP_OK canary → prompt assembly → pi runtime →
//      provider/tools/MCP registration → transcript opened).
//   5. Dispatch to TUI, --print, or --json mode.
//
// Exit codes: 0=ready, 1=runtime failure (SP_OK / MCP / etc.), 4=prerequisite
// missing (profile / vLLM / validate).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ProviderError } from "@emmy/provider";
import { ToolsError } from "@emmy/tools";

import { SpOkCanaryError, UxError } from "../src/errors";
import { loadProfile } from "../src/profile-loader";
import { createEmmySession } from "../src/session";

type Mode = "tui" | "print" | "json";
interface ParsedArgs {
	mode: Mode;
	prompt?: string;
	profilePath: string;
	baseUrl: string;
	printEnvironment?: boolean;
	help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
	let profilePath = resolve(process.cwd(), "profiles/qwen3.6-35b-a3b/v2");
	let baseUrl = "http://127.0.0.1:8002";
	let mode: Mode = "tui";
	let prompt: string | undefined;
	let printEnvironment = false;
	let help = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--profile") {
			profilePath = resolve(argv[++i]!);
		} else if (a === "--base-url") {
			baseUrl = argv[++i]!;
		} else if (a === "--print") {
			mode = "print";
			prompt = argv[++i];
		} else if (a === "--json") {
			mode = "json";
			prompt = argv[++i];
		} else if (a === "--print-environment") {
			printEnvironment = true;
		} else if (a === "-h" || a === "--help") {
			help = true;
		}
	}
	const args: ParsedArgs = { mode, profilePath, baseUrl };
	if (prompt !== undefined) args.prompt = prompt;
	if (printEnvironment) args.printEnvironment = true;
	if (help) args.help = true;
	return args;
}

function usage(): string {
	return `pi-emmy — Emmy harness (daily-driver)
  Usage: pi-emmy [--profile <dir>] [--base-url <url>] [--print <prompt>|--json <prompt>|--print-environment]
  Defaults: --profile profiles/qwen3.6-35b-a3b/v2, --base-url http://127.0.0.1:8002
  Exit codes: 0=ready, 1=runtime failure (SP_OK/MCP), 4=prerequisite missing (profile dir, vLLM, or emmy profile validate failed)`;
}

async function probeVllm(baseUrl: string): Promise<void> {
	const ctl = new AbortController();
	const timeout = setTimeout(() => {
		try {
			ctl.abort(new Error("timeout"));
		} catch {
			ctl.abort();
		}
	}, 5000);
	try {
		const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
		const r = await fetch(url, { signal: ctl.signal });
		if (!r.ok) throw new Error(`status ${r.status}`);
	} finally {
		clearTimeout(timeout);
	}
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const args = parseArgs(argv);
	if (args.help) {
		console.log(usage());
		return 0;
	}
	if (args.printEnvironment) {
		console.log(
			JSON.stringify(
				{
					pi_emmy_version: "0.1.0",
					node_version: process.version,
					bun_version: (process as { versions?: { bun?: string } }).versions?.bun ?? null,
					cwd: process.cwd(),
					profile_path: args.profilePath,
					base_url: args.baseUrl,
				},
				null,
				2,
			),
		);
		return 0;
	}

	// Pre-flight 1: profile dir exists.
	if (!existsSync(args.profilePath)) {
		console.error(`pi-emmy: ERROR (prereq): profile not found: ${args.profilePath}`);
		return 4;
	}

	// Pre-flight 2: vLLM reachable.
	try {
		await probeVllm(args.baseUrl);
	} catch (e) {
		console.error(
			`pi-emmy: ERROR (prereq): cannot reach emmy-serve at ${args.baseUrl}: ${
				e instanceof Error ? e.message : String(e)
			} (try: scripts/start_emmy.sh)`,
		);
		return 4;
	}

	// Pre-flight 3 (W5 FIX — T-02-04-08 implementation): emmy profile validate.
	// EMMY_PROFILE_VALIDATE_BIN env var overrides the CLI command (used by
	// pi-emmy-cli.test.ts to simulate a non-zero validate exit); unset in
	// production → `uv run emmy profile validate <path>`.
	// EMMY_SKIP_PROFILE_VALIDATE=1 short-circuits the gate (test-only helper
	// for failure-mode tests that don't exercise this gate).
	if (process.env.EMMY_SKIP_PROFILE_VALIDATE !== "1") {
		const bin = process.env.EMMY_PROFILE_VALIDATE_BIN;
		try {
			if (bin) {
				execFileSync(bin, [args.profilePath], { stdio: "inherit", encoding: "utf8" });
			} else {
				execFileSync("uv", ["run", "emmy", "profile", "validate", args.profilePath], {
					stdio: "inherit",
					encoding: "utf8",
				});
			}
		} catch (e) {
			const code =
				typeof (e as { status?: number })?.status === "number"
					? (e as { status?: number }).status
					: 1;
			console.error(
				`pi-emmy: ERROR (prereq): profile failed validation (uv run emmy profile validate ${args.profilePath} exited ${code}); re-run validate for details`,
			);
			return 4;
		}
	}

	// Load profile (W4 + B3 enforcement via profile-loader).
	let profile;
	try {
		profile = await loadProfile(args.profilePath);
	} catch (e) {
		console.error(`pi-emmy: ERROR (profile): ${e instanceof Error ? e.message : String(e)}`);
		return 1;
	}

	console.error(
		`pi-emmy starting (profile=${profile.ref.id}@${profile.ref.version}, base_url=${args.baseUrl})`,
	);

	try {
		const sessionOpts: Parameters<typeof createEmmySession>[0] = {
			profile,
			baseUrl: args.baseUrl,
			cwd: process.cwd(),
			mode: args.mode,
		};
		if (args.prompt !== undefined) sessionOpts.userPrompt = args.prompt;
		const { runtime, assembledPrompt, transcriptPath } = await createEmmySession(sessionOpts);

		console.error(`pi-emmy SP_OK canary: OK`);
		console.error(
			`pi-emmy session ready (prompt.sha256=${assembledPrompt.sha256}, layers=${assembledPrompt.layers
				.filter((l) => l.present)
				.map((l) => l.name)
				.join(",")})`,
		);
		console.error(`pi-emmy transcript=${transcriptPath}`);

		if (args.mode === "tui") {
			const runTui = (runtime as { runTui?: () => Promise<void> }).runTui;
			if (typeof runTui === "function") {
				await runTui();
				return 0;
			}
			console.error(
				`pi-emmy: TUI unavailable in this pi 0.68.0 adapter — use --print or --json for now, or run pi directly`,
			);
			return 1;
		}

		const run = (
			runtime as {
				run?: (
					prompt: string,
					opts?: { mode: "print" | "json" },
				) => Promise<{ text: string; tool_calls?: unknown[] } | string>;
			}
		).run;
		if (typeof run === "function" && args.prompt !== undefined) {
			const out = await run(args.prompt, { mode: args.mode });
			if (args.mode === "json") {
				console.log(JSON.stringify(out, null, 2));
			} else {
				console.log(typeof out === "string" ? out : (out as { text?: string })?.text ?? JSON.stringify(out));
			}
			return 0;
		}
		console.error(
			`pi-emmy: runtime does not expose a one-shot run() method in this pi version (session wired; manual pi drive required for this mode)`,
		);
		return 1;
	} catch (e) {
		if (e instanceof SpOkCanaryError) {
			console.error(`pi-emmy SP_OK canary: FAILED — ${e.message}`);
			return 1;
		}
		if (e instanceof UxError || e instanceof ToolsError || e instanceof ProviderError) {
			console.error(`pi-emmy: ERROR (runtime): ${e.message}`);
			return 1;
		}
		console.error(
			`pi-emmy: ERROR (unexpected): ${e instanceof Error ? e.stack ?? e.message : String(e)}`,
		);
		return 1;
	}
}

// Only auto-run when invoked as the bin entry (not when imported by tests).
// Bun sets import.meta.main=true for the entry file; Node sets import.meta.url.
const isEntry =
	(typeof Bun !== "undefined" && (import.meta as { main?: boolean }).main === true) ||
	(typeof process !== "undefined" &&
		process.argv[1] !== undefined &&
		import.meta.url === `file://${process.argv[1]}`);
if (isEntry) {
	main().then((code) => process.exit(code));
}
