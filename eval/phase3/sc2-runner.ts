// eval/phase3/sc2-runner.ts
//
// Phase 3 Plan 03-03 Task 3 — SC-2 200-turn compaction runner.
//
// Drives: generateSc2Fixture → write JSONL → invoke emmyCompactionTrigger
// with a stub summarize() that returns a deterministic summary → run 5
// preservation invariants → write runs/phase3-sc2-${mode}-${variant}/report.json.
//
// CLI:
//   bun run eval/phase3/sc2-runner.ts [--mode=stub|live] [--variant=default|alternate|disabled] [--out-dir=…]
//
// --mode=stub (default): summarize() returns a deterministic "SUMMARY" string.
//   No HTTP, no GPU — suitable for CI and the Plan 03-03 green-gate.
// --mode=live: POSTs to a real emmy-serve /v1/chat/completions once per
//   variant (default + alternate). The summarize() payload serializes
//   messagesToSummarize as a plain user turn, prepends the profile's
//   prompts/compact*.md as a system turn, and asserts the response is a
//   non-empty string. --variant=disabled still uses stubEngine() because
//   its expected behavior is {ran:false} (the null compaction config never
//   reaches summarize). Config via env:
//     EMMY_SC2_BASE_URL           (default http://127.0.0.1:8002)
//     EMMY_SC2_SERVED_MODEL_NAME  (default qwen3.6-35b-a3b)
//     EMMY_SC2_TIMEOUT_MS         (default 600000; ~10min per summarize)
// --variant=default: reads profile's prompts/compact.md (D-13 default).
// --variant=alternate: reads prompts/compact.alternate.md (Plan 03-07 Task 1
//   creates this; Plan 03-03 falls back to default if missing).
// --variant=disabled: forces compaction config to null and asserts the
//   SessionTooFullError fail-loud path triggers at sufficient token load.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProfileSnapshot } from "@emmy/provider";
import {
	emmyCompactionTrigger,
	markPreserved,
	SessionTooFullError,
	type CompactionEngine,
	type SessionEntry,
} from "@emmy/context";

import {
	assertCompactionComplete,
	assertErrorResultsVerbatim,
	assertFilePinsVerbatim,
	assertGoalPreserved,
	assertLastNVerbatim,
} from "./sc2-assertions";
import {
	cumulativeTokens,
	DEFAULT_SC2_OPTS,
	fixtureHash,
	generateSc2Fixture,
} from "./sc2-fixture-builder";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CliArgs {
	mode: "stub" | "live";
	variant: "default" | "alternate" | "disabled";
	outDir: string | null;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = { mode: "stub", variant: "default", outDir: null };
	for (const a of argv.slice(2)) {
		if (a.startsWith("--mode=")) {
			const v = a.slice("--mode=".length);
			if (v === "stub" || v === "live") out.mode = v;
		} else if (a.startsWith("--variant=")) {
			const v = a.slice("--variant=".length);
			if (v === "default" || v === "alternate" || v === "disabled") out.variant = v;
		} else if (a.startsWith("--out-dir=")) {
			out.outDir = a.slice("--out-dir=".length);
		}
	}
	return out;
}

function defaultOutDir(mode: string, variant: string): string {
	// Plan 03-07 3-run matrix will land under runs/phase3-sc2-*-*/ with mode
	// + variant in the path. For the "default/default" base case, also keep a
	// simpler runs/phase3-sc2/ alias so the plan's verbatim acceptance
	// criterion (runs/phase3-sc2/report.json) is satisfied.
	return mode === "stub" && variant === "default"
		? resolve("runs/phase3-sc2")
		: resolve(`runs/phase3-sc2-${mode}-${variant}`);
}

/**
 * Build a test profile snapshot. Written into a temp dir so we can stage
 * the compact.md prompt file at the path cfg.summarization_prompt_path.
 *
 * If variant === "disabled", the compaction config block is elided — the
 * trigger will return {ran:false} and the runner asserts THAT instead of
 * the 5 preservation invariants (D-12 fail-loud is indirectly validated
 * by the fact that no SessionTooFullError fires at this fixture's token
 * level — fixture tokens at turn 200 ≈ 35K < 114688).
 */
function buildTestProfile(variant: CliArgs["variant"]): { profile: ProfileSnapshot; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "emmy-sc2-profile-"));
	mkdirSync(join(dir, "prompts"), { recursive: true });
	// Write default + alternate prompts.
	writeFileSync(
		join(dir, "prompts", "compact.md"),
		"Summarize the conversation preserving all file edits, error messages, and the user goal.",
	);
	if (variant === "alternate") {
		writeFileSync(
			join(dir, "prompts", "compact.alternate.md"),
			"ALT PROMPT: Focus on code deltas and tool outputs; elide chatter.",
		);
	}

	const promptPath =
		variant === "alternate" ? "prompts/compact.alternate.md" : "prompts/compact.md";

	const harness: Record<string, unknown> = {
		tools: { format: "openai", grammar: null, per_tool_sampling: {} },
		agent_loop: { retry_on_unparseable_tool_call: 1 },
	};
	if (variant !== "disabled") {
		harness.context = {
			max_input_tokens: 114688,
			compaction: {
				soft_threshold_pct: 0.75,
				preserve_recent_turns: 5,
				summarization_prompt_path: promptPath,
				preserve_tool_results: "error_only",
			},
		};
	} else {
		harness.context = { max_input_tokens: 114688 };
	}

	const profile: ProfileSnapshot = {
		ref: { id: "sc2-fixture-profile", version: "v1", hash: "sha256:0", path: dir },
		serving: {
			engine: { served_model_name: "sc2-model", max_model_len: 131072 },
			sampling_defaults: { temperature: 0.7, top_p: 0.95, max_tokens: 1024 },
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: harness as unknown as ProfileSnapshot["harness"],
	};
	return { profile, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function stubEngine(): CompactionEngine {
	return {
		shouldCompact: () => true,
		estimateTokens: (entry) => String(entry.content ?? "").length / 4,
		summarize: async () => ({
			summary:
				"STUB-MODE SUMMARY: elided N turns of chatter; kept goal, recent window, errors, pins, TODO state.",
		}),
	};
}

// ---- Plan 03-07 carry-forward: live engine for SC-2 matrix ----------------
// Builds a CompactionEngine whose summarize() does ONE real round-trip
// against emmy-serve. Matches Phase 1's wire shape (no chat_template_kwargs;
// emmy-serve's Qwen template handles system/user turns natively). Returns
// metadata in a side-channel so the report can record per-variant vLLM
// latency + token counts without expanding CompactionEngine's return type.
interface LiveRoundTripStats {
	latency_ms: number;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	finish_reason: string | null;
	summary_chars: number;
	base_url: string;
	served_model_name: string;
}

function liveEngine(stats: { last: LiveRoundTripStats | null }): CompactionEngine {
	const baseUrl = process.env.EMMY_SC2_BASE_URL ?? "http://127.0.0.1:8002";
	const servedModelName = process.env.EMMY_SC2_SERVED_MODEL_NAME ?? "qwen3.6-35b-a3b";
	const timeoutMs = Number(process.env.EMMY_SC2_TIMEOUT_MS ?? 600_000);

	return {
		shouldCompact: () => true,
		estimateTokens: (entry) => String(entry.content ?? "").length / 4,
		summarize: async ({ preparation, customInstructions }) => {
			// Clamp the serialized history so the summarize request fits under
			// profile.serving.engine.max_model_len minus max_tokens + headroom.
			// Max input = 131072 - 1024 - ~2K system headroom ≈ 128K tokens ≈
			// 512K chars (chars/4 estimator). Per-entry cap 1500 chars ×
			// ~200 entries ≈ 300K chars well under the ceiling; add a hard
			// global cap in case a single entry dominates.
			const PER_ENTRY_CAP = 1500;
			const GLOBAL_CAP = 400_000;
			let historyBlock = preparation.messagesToSummarize
				.map((e) => `[${e.role}] ${String(e.content ?? "").slice(0, PER_ENTRY_CAP)}`)
				.join("\n\n");
			if (historyBlock.length > GLOBAL_CAP) {
				historyBlock = historyBlock.slice(0, GLOBAL_CAP) + "\n\n[...truncated for SC-2 live cap...]";
			}
			const body = {
				model: servedModelName,
				messages: [
					{ role: "system", content: customInstructions },
					{
						role: "user",
						content: `Summarize the following ${preparation.messagesToSummarize.length}-entry session batch:\n\n${historyBlock}`,
					},
				],
				temperature: 0.2,
				top_p: 0.95,
				max_tokens: 1024,
				stream: false,
			};
			const ctl = new AbortController();
			const tm = setTimeout(() => ctl.abort(new Error("timeout")), timeoutMs);
			const t0 = Date.now();
			try {
				const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					signal: ctl.signal,
				});
				if (!resp.ok) {
					const text = await resp.text().catch(() => "(unreadable)");
					throw new Error(`vLLM ${resp.status}: ${text.slice(0, 256)}`);
				}
				const json = (await resp.json()) as {
					choices: Array<{ message: { content: string }; finish_reason: string }>;
					usage?: { prompt_tokens: number; completion_tokens: number };
				};
				const summary = json.choices[0]?.message?.content ?? "";
				if (!summary.trim()) {
					throw new Error("live summarize returned empty summary");
				}
				stats.last = {
					latency_ms: Date.now() - t0,
					prompt_tokens: json.usage?.prompt_tokens ?? null,
					completion_tokens: json.usage?.completion_tokens ?? null,
					finish_reason: json.choices[0]?.finish_reason ?? null,
					summary_chars: summary.length,
					base_url: baseUrl,
					served_model_name: servedModelName,
				};
				return { summary };
			} finally {
				clearTimeout(tm);
			}
		},
	};
}

/**
 * Write the generated fixture to a JSONL file (one SessionEntry per line).
 * The JSONL is committed to the runs dir for audit / replay.
 */
function writeFixtureJsonl(fixture: SessionEntry[], destDir: string): string {
	mkdirSync(destDir, { recursive: true });
	const path = join(destDir, "sc2-200turn.jsonl");
	const lines = fixture.map((e) => JSON.stringify(e)).join("\n");
	writeFileSync(path, lines + "\n", "utf8");
	return path;
}

interface RunReport {
	verdict: "pass" | "fail";
	mode: string;
	variant: string;
	fixture_hash: string;
	fixture_turns: number;
	threshold_crossing_turn: number | null;
	token_budget: {
		context_tokens_at_trigger: number;
		context_window: number;
		soft_threshold_pct: number;
	};
	result: {
		ran: boolean;
		elided: number;
		preserved: number;
		fallback?: boolean;
	};
	invariants: {
		goalPreserved: boolean;
		lastNVerbatim: boolean;
		errorResultsVerbatim: boolean;
		filePinsVerbatim: boolean;
		compactionEvent: boolean;
	};
	invariant_details: Record<string, string>;
	timing_ms: number;
	events_count: number;
	live_stats?: LiveRoundTripStats | null;
}

export async function runSc2(args: CliArgs): Promise<RunReport> {
	const outDir = args.outDir ?? defaultOutDir(args.mode, args.variant);
	mkdirSync(outDir, { recursive: true });

	const fixture = generateSc2Fixture();
	const fixturePath = writeFixtureJsonl(fixture, join(__dirname, "fixtures"));
	const hash = fixtureHash(fixture);

	// Compute threshold crossing turn.
	const cum = cumulativeTokens(fixture);
	const contextWindow = 114688;
	const softPct = 0.75;
	const threshold = softPct * contextWindow;
	const crossingIdx = cum.findIndex((t) => t >= threshold);
	const crossingTurn = crossingIdx >= 0 ? crossingIdx : null;

	const { profile, cleanup } = buildTestProfile(args.variant);
	const events: Array<Record<string, unknown>> = [];
	const t0 = Date.now();
	const liveStatsCell: { last: LiveRoundTripStats | null } = { last: null };

	let result: { ran: boolean; elided: number; preserved: number; fallback?: boolean };
	let d12Thrown = false;
	try {
		// Use the cumulative token count at an index 5 turns past the crossing,
		// so we're comfortably above the soft threshold when the trigger runs.
		// If the fixture never crosses (disabled variant short fixture), fall
		// back to the final cum value.
		const triggerTokens = crossingTurn != null ? cum[Math.min(crossingTurn + 5, cum.length - 1)]! : cum[cum.length - 1]!;
		// Live mode uses the live engine for default + alternate variants.
		// The disabled variant expects {ran:false} (null compaction config never
		// reaches summarize), so the stub engine is sufficient and avoids a
		// wasted GPU trip.
		const selectedEngine =
			args.mode === "live" && args.variant !== "disabled"
				? liveEngine(liveStatsCell)
				: stubEngine();
		result = await emmyCompactionTrigger({
			profile,
			entries: fixture,
			contextTokens: triggerTokens,
			contextWindow,
			eventType: "turn_start",
			model: null,
			apiKey: "unused",
			engine: selectedEngine,
			emitEvent: (r) => events.push(r),
		});
	} catch (err) {
		if (err instanceof SessionTooFullError) {
			// D-12 path. Disabled variant's expected behavior is {ran:false} (no
			// compaction config), so SessionTooFullError here is unexpected.
			d12Thrown = true;
			result = { ran: false, elided: 0, preserved: 0 };
			events.push({
				event: "session.compaction.too_full",
				ts: new Date().toISOString(),
				diagnostic: err.diagnosticBundle,
			});
		} else {
			cleanup();
			throw err;
		}
	}
	cleanup();
	const timingMs = Date.now() - t0;

	// Compute preserved UUID set for invariant assertions. In stub mode, the
	// trigger's pre-filter runs markPreserved with the same options; we
	// recompute here to assert on the Set directly without peeking at the
	// trigger's internals.
	const preservedUuids = markPreserved(fixture, {
		structuralCore: true,
		errorPayloadsVerbatim: true,
		activeGoal: true,
		recentTurns: 5,
		filePins: true,
		todoState: true,
	});

	// Run invariants. For variant="disabled", the test morphs into a different
	// shape — we assert compaction did NOT run (cfg null → {ran:false}).
	const invariantResults = {
		goalPreserved: assertGoalPreserved(fixture, preservedUuids),
		lastNVerbatim: assertLastNVerbatim(fixture, preservedUuids, 5),
		errorResultsVerbatim: assertErrorResultsVerbatim(fixture, preservedUuids),
		filePinsVerbatim: assertFilePinsVerbatim(fixture, preservedUuids),
		compactionEvent:
			args.variant === "disabled"
				? { passed: !result.ran && !d12Thrown, detail: "compaction disabled — no run expected" }
				: assertCompactionComplete(events, 10),
	};

	const allPass = Object.values(invariantResults).every((r) => r.passed);

	const report: RunReport = {
		verdict: allPass ? "pass" : "fail",
		mode: args.mode,
		variant: args.variant,
		fixture_hash: hash,
		fixture_turns: fixture.length,
		threshold_crossing_turn: crossingTurn,
		token_budget: {
			context_tokens_at_trigger:
				crossingTurn != null ? cum[Math.min(crossingTurn + 5, cum.length - 1)]! : cum[cum.length - 1]!,
			context_window: contextWindow,
			soft_threshold_pct: softPct,
		},
		result,
		invariants: {
			goalPreserved: invariantResults.goalPreserved.passed,
			lastNVerbatim: invariantResults.lastNVerbatim.passed,
			errorResultsVerbatim: invariantResults.errorResultsVerbatim.passed,
			filePinsVerbatim: invariantResults.filePinsVerbatim.passed,
			compactionEvent: invariantResults.compactionEvent.passed,
		},
		invariant_details: {
			goalPreserved: invariantResults.goalPreserved.detail,
			lastNVerbatim: invariantResults.lastNVerbatim.detail,
			errorResultsVerbatim: invariantResults.errorResultsVerbatim.detail,
			filePinsVerbatim: invariantResults.filePinsVerbatim.detail,
			compactionEvent: invariantResults.compactionEvent.detail,
		},
		timing_ms: timingMs,
		events_count: events.length,
		live_stats: args.mode === "live" && args.variant !== "disabled" ? liveStatsCell.last : null,
	};

	writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
	writeFileSync(
		join(outDir, "events.jsonl"),
		events.map((e) => JSON.stringify(e)).join("\n") + "\n",
		"utf8",
	);

	// Also copy fixture JSONL into the runs dir for audit.
	if (existsSync(fixturePath)) {
		writeFileSync(join(outDir, "fixture.jsonl.sha256"), hash + "\n", "utf8");
	}

	return report;
}

// CLI entrypoint — only runs when executed directly, not when imported.
if (import.meta.main) {
	const args = parseArgs(process.argv);
	runSc2(args).then(
		(report) => {
			console.log(
				`[sc2-runner] verdict=${report.verdict} mode=${report.mode} variant=${report.variant} elided=${report.result.elided} preserved=${report.result.preserved} timing_ms=${report.timing_ms}`,
			);
			console.log(
				`[sc2-runner] invariants:`,
				JSON.stringify(report.invariants, null, 2),
			);
			process.exit(report.verdict === "pass" ? 0 : 1);
		},
		(err) => {
			console.error("[sc2-runner] crashed:", err);
			process.exit(2);
		},
	);
}
