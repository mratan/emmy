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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProviderError } from "@emmy/provider";
import {
	configureTelemetry,
	initOtel,
	resolveTelemetryEnabled,
	shutdownOtel,
} from "@emmy/telemetry";
import { ToolsError } from "@emmy/tools";

import { SpOkCanaryError, UxError } from "../src/errors";
import { loadProfile } from "../src/profile-loader";
import { createEmmySession } from "../src/session";

// Silence pi-coding-agent's npm-registry "Update Available" banner. Bumping
// pi 0.68 → 0.70 is a deliberate phase task (extension API breaks); the banner
// is a footgun. Operators wanting pi's broader offline mode (also disables
// fd/rg auto-download) can set PI_OFFLINE=1 — see docs/runbook.md.
process.env.PI_SKIP_VERSION_CHECK ??= "1";

// Resolve the emmy install root. Derived from this script's path
// (packages/emmy-ux/bin/pi-emmy.ts -> ../../..), overridable via $EMMY_PROFILE_ROOT.
// Both the default profile path AND the `uv run emmy` subprocess need this — running
// from any other cwd would fail: profile lookup and Python entry-point resolution both
// break. Surfaced by SC-1 walkthrough.
function emmyInstallRoot(): string {
	const envRoot = process.env.EMMY_PROFILE_ROOT;
	if (envRoot && envRoot.length > 0) return resolve(envRoot);
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	return resolve(scriptDir, "../../..");
}

function defaultProfilePath(): string {
	// Phase 3.1 (Plan 03.1-03 post-close fix): default bumped v2 → v3.1 so
	// `pi-emmy` with no `--profile` runs on the daily-driver profile that
	// includes web_search + live compaction + allowlist bypass. Previously
	// the default was v2 (Phase 2 baseline, no web_search). Users can still
	// opt into v1/v2/v3 explicitly via `--profile` or `EMMY_PROFILE_ROOT`.
	return resolve(emmyInstallRoot(), "profiles/qwen3.6-35b-a3b/v3.1");
}

type Mode = "tui" | "print" | "json";
interface ParsedArgs {
	mode: Mode;
	prompt?: string;
	profilePath: string;
	baseUrl: string;
	printEnvironment?: boolean;
	help?: boolean;
	/** Plan 03-05: `--export-hf <out_dir>` emits a HF datasets-loadable
	 *  artifact from ~/.emmy/telemetry/feedback.jsonl. When present, pi-emmy
	 *  runs the exporter and exits without starting a session. */
	exportHf?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
	let profilePath = defaultProfilePath();
	let baseUrl = "http://127.0.0.1:8002";
	let mode: Mode = "tui";
	let prompt: string | undefined;
	let printEnvironment = false;
	let help = false;
	let exportHf: string | undefined;
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
		} else if (a === "--export-hf") {
			exportHf = argv[++i];
		} else if (a === "-h" || a === "--help") {
			help = true;
		}
	}
	const args: ParsedArgs = { mode, profilePath, baseUrl };
	if (prompt !== undefined) args.prompt = prompt;
	if (printEnvironment) args.printEnvironment = true;
	if (help) args.help = true;
	if (exportHf !== undefined) args.exportHf = exportHf;
	return args;
}

function usage(): string {
	return `pi-emmy — Emmy harness (daily-driver)
  Usage: pi-emmy [--profile <dir>] [--base-url <url>] [--print <prompt>|--json <prompt>|--print-environment|--export-hf <out_dir>]
  Defaults: --profile <emmy-install>/profiles/qwen3.6-35b-a3b/v3.1 (override via $EMMY_PROFILE_ROOT or --profile), --base-url http://127.0.0.1:8002
  --export-hf <out_dir>: export ~/.emmy/telemetry/feedback.jsonl as a HuggingFace datasets-loadable artifact (TELEM-02) and exit.
  Exit codes: 0=ready, 1=runtime failure (SP_OK/MCP), 2=usage error (e.g. --export-hf without <out_dir>), 4=prerequisite missing (profile dir, vLLM, or emmy profile validate failed)`;
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

	// Plan 03-05: --export-hf <out_dir> emits the HF datasets-loadable
	// artifact from ~/.emmy/telemetry/feedback.jsonl and exits. No session
	// is started; no prereq checks (emmy-serve / profile validate) run
	// because export is a pure file-to-file transform.
	if (args.exportHf !== undefined) {
		if (!args.exportHf || args.exportHf.length === 0) {
			console.error("pi-emmy: --export-hf requires an <out_dir> argument");
			return 2;
		}
		const outDir = resolve(args.exportHf);
		const { defaultFeedbackPath, exportHfDataset } = await import("@emmy/telemetry");
		const src = defaultFeedbackPath();
		let gitSha = process.env.EMMY_GIT_SHA ?? "";
		if (!gitSha) {
			try {
				gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
					encoding: "utf8",
					cwd: emmyInstallRoot(),
				}).trim();
			} catch {
				gitSha = "unknown";
			}
		}
		try {
			const result = exportHfDataset(src, outDir, {
				emmyVersion: "0.1.0",
				gitSha,
			});
			console.log(
				`[emmy/export-hf] exported ${result.rowCount} rows to ${result.outDir} (${result.warningCount} file-content warnings)`,
			);
			return 0;
		} catch (e) {
			console.error(
				`pi-emmy: --export-hf failed: ${e instanceof Error ? e.message : String(e)}`,
			);
			return 1;
		}
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
					cwd: emmyInstallRoot(),
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
	//
	// CRITICAL ordering (RESEARCH Pitfall #2 + plan-checker WARNING):
	//   parseCliArgs -> loadProfile -> initOtel -> createEmmySession
	// loadProfile is emitEvent-free BY CONSTRUCTION (verified at test-time by
	// packages/emmy-ux/test/profile-loader-no-telemetry.test.ts). If that
	// invariant ever breaks, Bun's ESM hoisting would emit spans before the
	// OTel SDK is live -- we would silently lose every profile-load event.
	let profile;
	try {
		profile = await loadProfile(args.profilePath);
	} catch (e) {
		console.error(`pi-emmy: ERROR (profile): ${e instanceof Error ? e.message : String(e)}`);
		return 1;
	}

	// Initialize OTel SDK + JSONL sink (D-06, D-08). This runs BEFORE
	// createEmmySession so every emitEvent fired during session bootstrap
	// (SP_OK canary, session.tools.registered, session.transcript.open) lands
	// in events.jsonl and fans out to Langfuse via OTLP.
	const telemetryEnabled = resolveTelemetryEnabled({ env: process.env, argv });
	const sessionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${profile.ref.hash.slice(0, 8)}`;
	const runsDir = resolve(process.cwd(), "runs", sessionId);
	const jsonlPath = join(runsDir, "events.jsonl");
	const lfPk = process.env.LANGFUSE_PUBLIC_KEY ?? "";
	const lfSk = process.env.LANGFUSE_SECRET_KEY ?? "";
	let otelSdk: Awaited<ReturnType<typeof initOtel>> = null;
	if (telemetryEnabled && (!lfPk || !lfSk)) {
		console.error(
			"[emmy] Langfuse keys not set (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY) - running JSONL-only",
		);
	}
	if (telemetryEnabled && lfPk && lfSk) {
		otelSdk = await initOtel({
			langfusePublicKey: lfPk,
			langfuseSecretKey: lfSk,
			profile: { id: profile.ref.id, version: profile.ref.version, hash: profile.ref.hash },
			enabled: true,
		});
	} else if (!telemetryEnabled) {
		// Emits "OBSERVABILITY: OFF" banner.
		await initOtel({
			langfusePublicKey: "",
			langfuseSecretKey: "",
			profile: { id: profile.ref.id, version: profile.ref.version, hash: profile.ref.hash },
			enabled: false,
		});
	}
	configureTelemetry({
		jsonlPath: telemetryEnabled ? jsonlPath : null,
		tracer: null, // configureTelemetry picks up global tracer when enabled=true
		enabled: telemetryEnabled,
	});

	// Boot banner distinguishes the three telemetry modes (D-06).
	const telemetryMode = !telemetryEnabled
		? "OFF"
		: otelSdk
			? "JSONL+Langfuse"
			: "JSONL-only";
	console.error(
		`pi-emmy starting (profile=${profile.ref.id}@${profile.ref.version}, base_url=${args.baseUrl}, telemetry=${telemetryMode})`,
	);

	try {
		const sessionOpts: Parameters<typeof createEmmySession>[0] = {
			profile,
			baseUrl: args.baseUrl,
			cwd: process.cwd(),
			mode: args.mode,
			// Plan 03-05: propagate the emmy-owned session id + telemetry
			// flag so the Emmy ExtensionFactory can synthesize turn_id +
			// honor the kill-switch for Alt+Up/Down rating capture.
			sessionId,
			telemetryEnabled,
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
			// Plan 03-08 (SC-3-TUI-WIRE gap closure): the prior
			// TUI-not-available bail is gone; createEmmySession({mode:"tui"}) returns a runtime
			// whose runTui() launches pi 0.68's InteractiveMode bound to the
			// AgentSessionRuntime (via createAgentSessionRuntime). The only
			// failure mode at this point is a self-inflicted bootstrap defect
			// (our own runtime.runTui is undefined) — NOT a pi API gap. Wrap
			// in try/finally so OTel spans are flushed via shutdownOtel when
			// the user quits (Ctrl-C / Ctrl-D / /quit).
			const runTui = (runtime as { runTui?: () => Promise<void> }).runTui;
			if (typeof runTui !== "function") {
				console.error(
					`pi-emmy: runtime missing runTui() — this is a session-bootstrap defect, not a pi API gap`,
				);
				await shutdownOtel(otelSdk);
				return 1;
			}
			try {
				await runTui();
				return 0;
			} finally {
				await shutdownOtel(otelSdk);
			}
		}

		// --print / --json: drive one agent turn via the runtime's runPrint.
		if (args.prompt === undefined) {
			console.error(`pi-emmy: --${args.mode} requires a prompt argument`);
			return 1;
		}
		const runPrint = runtime.runPrint;
		if (typeof runPrint !== "function") {
			console.error(
				`pi-emmy: runtime missing runPrint() — this is a session-bootstrap defect, not a pi API gap`,
			);
			return 1;
		}
		const pm = args.mode === "json" ? "json" : "text";
		const result = await runPrint(args.prompt, { mode: pm });
		if (args.mode === "json") {
			console.log(JSON.stringify(result.messages, null, 2));
		} else {
			console.log(result.text);
		}
		// Flush OTel spans before exit so the final turn_end span is visible
		// in Langfuse immediately (otherwise the BatchSpanProcessor could drop
		// pending spans on process.exit).
		await shutdownOtel(otelSdk);
		return 0;
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
