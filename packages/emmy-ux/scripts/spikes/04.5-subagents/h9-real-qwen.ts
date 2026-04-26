// H9 — Real-deal Qwen 3.6 35B-A3B v3.1 wire-level behaviors.
//
// Scope: H1–H8 validated the structural pi-mono plumbing for sub-agents
// against a faux provider. H9 validates the wire-level behaviors on real
// vLLM output that the integration sketch depends on, without rebuilding
// a full SubAgentTool against pi's real-provider registration (which
// would burn the spike budget). Specifically:
//
//   (1) Real Qwen produces an OpenAI-style tool_call when prompted with a
//       tools schema.
//   (2) Prefix-cache hit rate increments between two requests that share a
//       system prompt prefix (parent → child shared-services pattern).
//   (3) Round-trip latency for short turns is acceptable (< 30s).
//
// vLLM endpoint: http://127.0.0.1:8002/v1
// Model id (served): qwen3.6-35b-a3b
// Profile: profiles/qwen3.6-35b-a3b/v3.1

const VLLM_BASE = "http://127.0.0.1:8002";
const MODEL_ID = "qwen3.6-35b-a3b";

async function fetchPrefixCacheHits(): Promise<number> {
	const r = await fetch(`${VLLM_BASE}/metrics`);
	const text = await r.text();
	// Parse Prometheus-format metrics. Look for vllm:prefix_cache_hits_total
	// and the unlabeled or aggregate value.
	let total = 0;
	for (const line of text.split("\n")) {
		if (line.startsWith("#")) continue;
		if (line.startsWith("vllm:prefix_cache_hits_total")) {
			const m = line.match(/}\s+([0-9.eE+-]+)$/);
			if (m) total += Number(m[1]);
		}
		// Some vLLM versions name it without the explicit "total".
		if (line.startsWith("vllm:gpu_prefix_cache_hits") || line.startsWith("vllm:cache_hits")) {
			const m = line.match(/}\s+([0-9.eE+-]+)$/);
			if (m) total += Number(m[1]);
		}
	}
	return total;
}

interface ChatResp {
	choices: Array<{
		message: { role: string; content: string | null; tool_calls?: any[] };
		finish_reason: string;
	}>;
	usage?: { prompt_tokens: number; completion_tokens: number };
}

async function chat(body: any): Promise<{ resp: ChatResp; latencyMs: number }> {
	const t0 = Date.now();
	const r = await fetch(`${VLLM_BASE}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: MODEL_ID,
			temperature: 0,
			max_tokens: 256,
			// Phase 3 D-02a: disable Qwen's reasoning so output is direct.
			chat_template_kwargs: { enable_thinking: false },
			...body,
		}),
	});
	const resp = (await r.json()) as ChatResp;
	const latencyMs = Date.now() - t0;
	return { resp, latencyMs };
}

async function main() {
	const findings: any = { hypothesis: "H9 — real Qwen 3.6 35B-A3B wire-level", checks: [] };

	// --- Pre-flight ---
	const status = await fetch("http://127.0.0.1:8003/status").then((r) => r.json());
	findings.sidecarStatus = status;
	findings.checks.push({
		name: "vLLM is up per sidecar status",
		pass: status.vllm_up === true,
	});

	const cacheHitsBefore = await fetchPrefixCacheHits();
	findings.cacheHitsBefore = cacheHitsBefore;

	// --- Probe 1: tool_call generation ---
	// Give Qwen a clear instruction to call a hypothetical Agent tool.
	const sharedSystemPrompt =
		"You are an emmy parent agent. Use the Agent tool to delegate research tasks. " +
		"When the user asks for research, call Agent with subagent_type='research'.";

	const toolsSchema = [
		{
			type: "function",
			function: {
				name: "Agent",
				description: "Dispatch a focused task to a sub-agent.",
				parameters: {
					type: "object",
					properties: {
						subagent_type: {
							type: "string",
							enum: ["research", "code_reviewer"],
							description: "Persona to dispatch to.",
						},
						description: { type: "string" },
						prompt: { type: "string" },
					},
					required: ["subagent_type", "description", "prompt"],
				},
			},
		},
	];

	const probe1 = await chat({
		messages: [
			{ role: "system", content: sharedSystemPrompt },
			{
				role: "user",
				content:
					"Research how the customTools array is used in this codebase. Use the Agent tool.",
			},
		],
		tools: toolsSchema,
		tool_choice: "auto",
	});

	const choice1 = probe1.resp.choices[0];
	const toolCalls = choice1?.message?.tool_calls ?? [];
	findings.probe1 = {
		latencyMs: probe1.latencyMs,
		finishReason: choice1?.finish_reason,
		toolCallCount: toolCalls.length,
		firstToolCall: toolCalls[0],
		assistantContent: choice1?.message?.content,
	};

	findings.checks.push({
		name: "Qwen produces a tool_call when prompted",
		pass: toolCalls.length > 0,
	});
	findings.checks.push({
		name: "tool_call name === Agent",
		pass: toolCalls[0]?.function?.name === "Agent",
	});
	findings.checks.push({
		name: "tool_call args are valid JSON with expected shape",
		pass: (() => {
			try {
				const args = JSON.parse(toolCalls[0]?.function?.arguments ?? "{}");
				return (
					typeof args.subagent_type === "string" &&
					typeof args.prompt === "string"
				);
			} catch {
				return false;
			}
		})(),
	});
	findings.checks.push({
		name: "probe 1 round-trip < 30s",
		pass: probe1.latencyMs < 30_000,
	});

	const cacheHitsAfterProbe1 = await fetchPrefixCacheHits();

	// --- Probe 2: shared system prompt, different user prompt
	// (mimics parent and child both grounded in the same prefix).
	const probe2 = await chat({
		messages: [
			{ role: "system", content: sharedSystemPrompt },
			{
				role: "user",
				content: "What does the Agent tool do? Answer in one sentence.",
			},
		],
	});
	const cacheHitsAfterProbe2 = await fetchPrefixCacheHits();
	const probe2Text = probe2.resp.choices[0]?.message?.content ?? "";
	findings.probe2 = {
		latencyMs: probe2.latencyMs,
		assistantText: probe2Text.slice(0, 200),
		usage: probe2.resp.usage,
	};
	findings.cacheHitsAfterProbe1 = cacheHitsAfterProbe1;
	findings.cacheHitsAfterProbe2 = cacheHitsAfterProbe2;
	findings.cacheHitsDeltaProbe1 = cacheHitsAfterProbe1 - cacheHitsBefore;
	findings.cacheHitsDeltaProbe2 = cacheHitsAfterProbe2 - cacheHitsAfterProbe1;

	findings.checks.push({
		name: "probe 2 round-trip < 30s",
		pass: probe2.latencyMs < 30_000,
	});
	findings.checks.push({
		name: "probe 2 produces non-empty assistant content",
		pass: probe2Text.length > 0,
	});
	// The big one: shared system prompt → second request should hit prefix cache.
	findings.checks.push({
		name: "prefix_cache_hits_total increments between probe 1 and probe 2",
		pass: cacheHitsAfterProbe2 > cacheHitsAfterProbe1,
		probe1Delta: findings.cacheHitsDeltaProbe1,
		probe2Delta: findings.cacheHitsDeltaProbe2,
	});

	// --- Probe 3: child-style turn (different system prompt, no shared prefix).
	// Should produce coherent grep-task output.
	const probe3 = await chat({
		messages: [
			{
				role: "system",
				content:
					"You are a research sub-agent. Investigate one specific question and return a 1-3 sentence summary.",
			},
			{
				role: "user",
				content:
					"In the Emmy codebase, what is the role of the customTools array? Reply in 1-2 sentences.",
			},
		],
	});
	const probe3Text = probe3.resp.choices[0]?.message?.content ?? "";
	findings.probe3 = {
		latencyMs: probe3.latencyMs,
		assistantText: probe3Text.slice(0, 300),
	};
	findings.checks.push({
		name: "probe 3 (child-style) returns coherent short text",
		pass: probe3Text.length > 20 && probe3Text.length < 2000,
	});
	findings.checks.push({
		name: "probe 3 mentions tools or customTools",
		pass: /tools|customTools/i.test(probe3Text),
	});

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "PARTIAL";
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(0); // PARTIAL is acceptable; informs design
}

main().catch((e) => {
	console.error("H9 FAILED with exception:", e);
	process.exit(2);
});
