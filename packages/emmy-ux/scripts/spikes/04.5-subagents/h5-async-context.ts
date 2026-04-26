// H5 — Does async context propagate through pi's session.prompt() →
// tool dispatch → tool handler? This is the precondition for OTel
// traceparent inheritance: if AsyncLocalStorage values survive the
// async hops, OTel context (which uses the same mechanism) will too.
//
// Test: set a value in AsyncLocalStorage from outside session.prompt(),
// run a prompt that triggers a tool call to a custom tool, and have
// the tool handler read the AsyncLocalStorage. Assert the value is the
// one we set.
//
// Pass: AsyncLocalStorage value visible inside the tool handler.
// Fail: pi resets async context somewhere → manual context injection
//   required in SubAgentTool.

import { AsyncLocalStorage } from "node:async_hooks";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	defineTool,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import {
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	registerFauxProvider,
	Type,
} from "@mariozechner/pi-ai";

const als = new AsyncLocalStorage<{ traceId: string; spanId: string }>();

let observedInsideTool: { traceId: string; spanId: string } | undefined;

const probeTool = defineTool({
	name: "trace_probe",
	description: "Reads the AsyncLocalStorage value at the point the tool fires.",
	label: "TraceProbe",
	parameters: Type.Object({}),
	execute: async () => {
		observedInsideTool = als.getStore();
		return {
			output: "captured",
			details: { ok: true } as any,
		};
	},
});

async function main() {
	const findings: any = { hypothesis: "H5 — async context propagation", checks: [] };

	const reg = registerFauxProvider({
		api: "spike-h5",
		provider: "spike-h5",
		models: [{ id: "h5-model", contextWindow: 4096, maxTokens: 1024 }],
	});

	// Faux must call the probe tool then return a final assistant message.
	// Two-step response sequence: first the tool call, then a stop.
	const turnStep: any = (ctx: any) => {
		// Decide: have we already issued the tool call this turn?
		const msgs = ctx?.messages ?? [];
		const hasToolResult = msgs.some(
			(m: any) =>
				Array.isArray(m?.content) &&
				m.content.some((c: any) => c.type === "toolResult" && c.toolName === "trace_probe"),
		);
		if (hasToolResult) {
			return fauxAssistantMessage("done", { stopReason: "stop" });
		}
		return fauxAssistantMessage(
			[fauxText("calling probe"), fauxToolCall("trace_probe", {}, { id: "tc-1" })],
			{ stopReason: "toolUse" },
		);
	};
	reg.setResponses(Array(64).fill(turnStep));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h5", "fake-key");

	const services = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});

	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: reg.getModel(),
		customTools: [probeTool] as any,
	});

	// Verify probe tool is active.
	const activeTools = session.getActiveToolNames();
	findings.checks.push({
		name: "probe tool active in session",
		pass: activeTools.includes("trace_probe"),
		activeTools,
	});

	// The interesting bit: run prompt() inside an ALS scope.
	const expected = { traceId: "abc123def456", spanId: "0011223344556677" };
	let promptCompleted = false;
	await als.run(expected, async () => {
		await session.prompt("trigger the probe tool");
		promptCompleted = true;
	});

	findings.checks.push({
		name: "prompt() completed",
		pass: promptCompleted,
	});
	findings.checks.push({
		name: "tool handler observed AsyncLocalStorage value",
		pass: observedInsideTool !== undefined,
	});
	findings.checks.push({
		name: "observed value matches the one set outside",
		pass:
			observedInsideTool?.traceId === expected.traceId &&
			observedInsideTool?.spanId === expected.spanId,
		expected,
		observed: observedInsideTool,
	});

	session.dispose();
	reg.unregister();

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "FAIL";
	findings.totalProviderCalls = reg.state.callCount;
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(1);
}

main().catch((e) => {
	console.error("H5 FAILED with exception:", e);
	process.exit(2);
});
