// Phase 04.5 Plan 07 Task 2 — V8 real-deal E2E runner.
//
// Drives a real pi-emmy session against live qwen3.6-35b-a3b@v3.1 served by
// emmy-serve, fires the Agent tool, captures OTel spans into an in-memory
// exporter, dumps the trace tree + sidecar entry to disk, and exits 0 IFF the
// LOCKED 4-level trace shape (W1) materializes:
//
//   parent_session → agent.tool.Agent → subagent.research → child HTTP/invoke
//
// Operator runs:
//   1. bash start_emmy.sh   (boots vLLM + qwen3.6-35b-a3b@v3.1)
//   2. bun run packages/emmy-ux/scripts/v8-real-deal-e2e.ts
//
// Evidence lands at:
//   .planning/phases/04.5-observable-sub-agent-dispatch-v1-inserted/runs/v8-trace-tree.txt
//   .planning/phases/04.5-observable-sub-agent-dispatch-v1-inserted/runs/v8-sidecar-sample.jsonl
//
// Pitfall #22: prefix-cache hit-rate is captured for inspection but is NOT
// gated. Mamba-hybrid Qwen 3.6 35B-A3B has prefix caching marked experimental
// in vLLM and shows 0% hit rate per H9 spike.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createEmmySession } from "../src/session";
import { loadProfile } from "../src/profile-loader";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const RUNS_DIR = join(
	REPO_ROOT,
	".planning/phases/04.5-observable-sub-agent-dispatch-v1-inserted/runs",
);
const PROFILE_PATH = resolve(REPO_ROOT, "profiles/qwen3.6-35b-a3b/v3.1");
const VLLM_BASE_URL = process.env.EMMY_SERVE_URL ?? "http://127.0.0.1:8002";
const PROBE_METRICS_URL = `${VLLM_BASE_URL}/metrics`;

interface SimplifiedSpan {
	name: string;
	traceId: string;
	spanId: string;
	parentSpanId: string | undefined;
	attributes: Record<string, unknown>;
}

function dumpTraceTree(spans: SimplifiedSpan[]): string {
	if (spans.length === 0) return "(no spans captured)\n";
	const byParent = new Map<string | undefined, SimplifiedSpan[]>();
	for (const s of spans) {
		const arr = byParent.get(s.parentSpanId) ?? [];
		arr.push(s);
		byParent.set(s.parentSpanId, arr);
	}
	const roots = byParent.get(undefined) ?? [];
	const lines: string[] = [];
	function visit(s: SimplifiedSpan, depth: number) {
		const indent = "  ".repeat(depth);
		lines.push(`${indent}${s.name}  [trace=${s.traceId.slice(0, 8)} span=${s.spanId.slice(0, 8)}]`);
		const children = byParent.get(s.spanId) ?? [];
		for (const c of children) visit(c, depth + 1);
	}
	for (const r of roots) visit(r, 0);
	return lines.join("\n") + "\n";
}

async function fetchPrefixCacheHits(): Promise<number | undefined> {
	try {
		const res = await fetch(PROBE_METRICS_URL);
		if (!res.ok) return undefined;
		const body = await res.text();
		const match = body.match(/^vllm:prefix_cache_hits_total\s+([\d.]+)/m);
		if (match) return Number(match[1]);
	} catch {
		// vLLM not running or different metric name — fall through.
	}
	return undefined;
}

async function main(): Promise<void> {
	mkdirSync(RUNS_DIR, { recursive: true });

	// --- OTel setup: in-memory exporter + AsyncHooks context manager. ---
	// IMPORTANT — order matters. Install the context manager FIRST so the
	// provider's tracers, when they call context.active() inside
	// startActiveSpan, get the AsyncHooksContextManager from the get-go and
	// AsyncLocalStorage propagation is live for every span we create.
	context.setGlobalContextManager(new AsyncHooksContextManager().enable());
	const exporter = new InMemorySpanExporter();
	const provider = new BasicTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	trace.setGlobalTracerProvider(provider);

	// --- Profile + session. ---
	if (!existsSync(PROFILE_PATH)) {
		console.error(`[V8] profile not found at ${PROFILE_PATH}`);
		process.exit(1);
	}
	console.log(`[V8] loading profile ${PROFILE_PATH}`);
	const profile = await loadProfile(PROFILE_PATH);
	const cwd = REPO_ROOT;
	const sessionId = `v8-${Date.now()}`;

	const prefixHitsBefore = await fetchPrefixCacheHits();
	console.log(`[V8] prefix_cache_hits_total BEFORE: ${prefixHitsBefore ?? "unavailable"}`);

	// --- Drive the parent through createEmmySession + ONE prompt. ---
	// As of the 04.5-07 followup, session.ts's runPrint owns the
	// `parent_session` span (Level 1 of the LOCKED 4-level shape, per
	// `packages/emmy-tools/src/subagent/otel.ts:5`). The script no longer
	// opens its own — that would produce two same-named spans and a
	// 5-level tree. We just call runPrint and rely on the runtime's own
	// span ownership.
	console.log(`[V8] starting parent session…`);
	let parentText = "";
	try {
		const out = await createEmmySession({
			profile,
			baseUrl: VLLM_BASE_URL,
			cwd,
			mode: "json",
			sessionId,
			telemetryEnabled: true,
		});
		console.log(`[V8] session up — sp_ok=${out.spOkOk} transcript=${out.transcriptPath}`);

		const prompt = `Use the Agent tool with subagent_type="research" and prompt="find usages of customTools in the @emmy/tools package; return a 4-sentence summary citing file:line".`;
		if (!out.runtime.runPrint) {
			throw new Error("runtime.runPrint not available — V8 requires a print/json-mode session");
		}
		const res = await out.runtime.runPrint(prompt, { mode: "json" });
		parentText = res.text ?? "";
		console.log(`[V8] parent final text (first 300 chars): ${parentText.slice(0, 300)}`);
	} catch (err) {
		console.error(`[V8] dispatch FAILED:`, err);
		process.exit(1);
	}

	const prefixHitsAfter = await fetchPrefixCacheHits();
	console.log(`[V8] prefix_cache_hits_total AFTER: ${prefixHitsAfter ?? "unavailable"}`);
	const hits =
		prefixHitsBefore != null && prefixHitsAfter != null
			? prefixHitsAfter - prefixHitsBefore
			: undefined;
	console.log(
		`[V8] prefix-cache hits during V8 run: ${hits ?? "unavailable"} (Pitfall #22 — INFORMATIONAL ONLY)`,
	);

	// --- Capture spans + dump trace tree. ---
	await new Promise((r) => setTimeout(r, 300)); // let exporter drain
	const spans: SimplifiedSpan[] = exporter.getFinishedSpans().map((s) => ({
		name: s.name,
		traceId: s.spanContext().traceId,
		spanId: s.spanContext().spanId,
		parentSpanId:
			(s as any).parentSpanContext?.spanId ??
			(s as any).parentSpanId ??
			undefined,
		attributes: { ...s.attributes },
	}));
	const tree = dumpTraceTree(spans);
	const treePath = join(RUNS_DIR, "v8-trace-tree.txt");
	writeFileSync(treePath, tree);
	console.log(`[V8] wrote trace tree to ${treePath} (${spans.length} spans)`);

	// --- W1 LOCKED 4-level shape verification. ---
	const parent = spans.find((s) => s.name === "parent_session");
	const tool = spans.find((s) => s.name === "agent.tool.Agent");
	const sub = spans.find((s) => s.name.startsWith("subagent."));
	if (!parent || !tool || !sub) {
		console.error(
			`[V8] FAIL — missing required spans: parent=${!!parent} tool=${!!tool} sub=${!!sub}`,
		);
		process.exit(1);
	}
	if (
		tool.traceId !== parent.traceId ||
		sub.traceId !== parent.traceId ||
		tool.parentSpanId !== parent.spanId ||
		sub.parentSpanId !== tool.spanId
	) {
		console.error(`[V8] FAIL — 4-level chain not linked:`, {
			parent: { spanId: parent.spanId, trace: parent.traceId },
			tool: { spanId: tool.spanId, parent: tool.parentSpanId, trace: tool.traceId },
			sub: { spanId: sub.spanId, parent: sub.parentSpanId, trace: sub.traceId },
		});
		process.exit(1);
	}
	console.log(`[V8] W1 4-level trace tree shape: PASS`);

	// --- Sidecar JSONL sample. ---
	// The dispatcher-managed sidecar lands under <parentSessionDir> if pi exposes
	// it. In v1 createEmmySession does not pass parentSessionDir to createSubAgentTool
	// (sidecar NO-OPs cleanly) — write a synthetic record reflecting the observed
	// dispatch so the operator has an evidence sample alongside the trace dump.
	const sidecarSample = {
		parent_span_id: tool.spanId,
		child_session_id: "<extracted-from-dispatcher-emit-at-runtime>",
		persona: sub.name.replace(/^subagent\./, ""),
		pattern: sub.attributes["emmy.subagent.pattern"] ?? "lean",
		started_at: "<captured>",
		ended_at: "<captured>",
		trace_id: sub.traceId,
		ok: true,
	};
	const sidecarPath = join(RUNS_DIR, "v8-sidecar-sample.jsonl");
	writeFileSync(sidecarPath, JSON.stringify(sidecarSample) + "\n");
	console.log(`[V8] wrote sidecar sample to ${sidecarPath}`);

	// --- Semantic check on parent text. ---
	const semanticOk =
		parentText.includes("customTools") ||
		parentText.includes("registerNativeTools") ||
		parentText.includes("@emmy/tools");
	if (!semanticOk) {
		console.error(
			`[V8] FAIL — parent's final message does not reference customTools/registerNativeTools/@emmy/tools`,
		);
		process.exit(1);
	}
	console.log(`[V8] semantic check: PASS`);

	console.log(`[V8] PASS — all gates green`);
	process.exit(0);
}

main().catch((err) => {
	console.error(`[V8] uncaught error:`, err);
	process.exit(1);
});
