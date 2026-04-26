// Phase 04.5 Plan 03 — V4 OTel parent→child propagation regression suite.
//
// LOCKED 4-level trace tree (CONTEXT.md §decisions, line 183):
//   Level 1: parent_session                    (test-installed parent span)
//   Level 2: agent.tool.Agent                  (W1 — withAgentToolSpan in createSubAgentTool.execute)
//   Level 3: subagent.<persona.name>           (withSubagentSpan in dispatcher)
//   Level 4: child_invoke / child_chat_completion  (HTTP auto-instrumentation; not exercised by faux tests)
//
// We use an in-memory tracer-provider exporter to capture finished spans and
// assert the parent-chain linkage by trace_id + parentSpanId equality.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
	AuthStorage,
	createAgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import {
	SUBAGENT_TRACER_NAME,
	withAgentToolSpan,
	withSubagentSpan,
} from "../../src/subagent/otel";
import { createSubAgentTool, dispatchSubAgent } from "../../src/subagent";
import type { SubAgentSpec } from "../../src/subagent/types";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
	// OTel 2.x: BasicTracerProvider no longer ships `register()`. We:
	// 1. install an AsyncHooks context manager so AsyncLocalStorage carries spans across awaits;
	// 2. set the global tracer provider directly so trace.getTracer() resolves to ours.
	const contextManager = new AsyncHooksContextManager().enable();
	context.setGlobalContextManager(contextManager);
	trace.setGlobalTracerProvider(provider);
});
afterAll(async () => {
	await provider.shutdown();
});

function clearSpans() {
	exporter.reset();
}

describe("OTel propagation — withSubagentSpan + withAgentToolSpan helpers (Task 1)", () => {
	test("Test 1 — withSubagentSpan creates a subagent.<name> span", async () => {
		clearSpans();
		await withSubagentSpan({ name: "research", pattern: "lean" }, "sid-1", async () => {
			// no-op
		});
		const spans = exporter.getFinishedSpans();
		const sub = spans.find((s) => s.name === "subagent.research");
		expect(sub).toBeDefined();
	});

	test("Test 2 — span parented to active span when called inside startActiveSpan", async () => {
		clearSpans();
		const tracer = trace.getTracer(SUBAGENT_TRACER_NAME);
		await tracer.startActiveSpan("parent_span", async (parent) => {
			await withSubagentSpan({ name: "research", pattern: "lean" }, "sid-1", async () => {
				// no-op
			});
			parent.end();
		});
		const spans = exporter.getFinishedSpans();
		const parent = spans.find((s) => s.name === "parent_span")!;
		const sub = spans.find((s) => s.name === "subagent.research")!;
		expect(parent).toBeDefined();
		expect(sub).toBeDefined();
		expect(sub.spanContext().traceId).toBe(parent.spanContext().traceId);
		const subParentSpanId =
			(sub as any).parentSpanContext?.spanId ?? (sub as any).parentSpanId;
		expect(subParentSpanId).toBe(parent.spanContext().spanId);
	});

	test("Test 3 — span attributes match LOCKED set", async () => {
		clearSpans();
		await withSubagentSpan({ name: "research", pattern: "persona" }, "sid-42", async () => {
			// no-op
		});
		const sub = exporter.getFinishedSpans().find((s) => s.name === "subagent.research")!;
		expect(sub.attributes["gen_ai.agent.name"]).toBe("research");
		expect(sub.attributes["gen_ai.agent.id"]).toBe("research");
		expect(sub.attributes["gen_ai.conversation.id"]).toBe("sid-42");
		expect(sub.attributes["emmy.subagent.pattern"]).toBe("persona");
	});

	test("Test 4 — failure path: ERROR status + recordException + span.end()", async () => {
		clearSpans();
		await expect(
			withSubagentSpan({ name: "research", pattern: "lean" }, "sid-1", async () => {
				throw new Error("simulated failure");
			}),
		).rejects.toThrow("simulated failure");
		const sub = exporter.getFinishedSpans().find((s) => s.name === "subagent.research")!;
		expect(sub.status.code).toBe(SpanStatusCode.ERROR);
		expect(sub.events.some((e) => e.name === "exception")).toBe(true);
	});

	test("Test 5 — AsyncLocalStorage non-clobber (H5 invariant)", async () => {
		clearSpans();
		const als = new AsyncLocalStorage<string>();
		let observed: string | undefined;
		await als.run("PARENT_VAL", async () => {
			await withSubagentSpan({ name: "research", pattern: "lean" }, undefined, async () => {
				observed = als.getStore();
			});
		});
		expect(observed).toBe("PARENT_VAL");
	});

	test("Test 6 (W1) — withAgentToolSpan creates agent.tool.Agent span with W1 attributes", async () => {
		clearSpans();
		await withAgentToolSpan("research", "sid-2", async () => {
			// no-op
		});
		const tool = exporter.getFinishedSpans().find((s) => s.name === "agent.tool.Agent");
		expect(tool).toBeDefined();
		expect(tool!.attributes["gen_ai.tool.name"]).toBe("Agent");
		expect(tool!.attributes["gen_ai.tool.persona"]).toBe("research");
		expect(tool!.attributes["gen_ai.conversation.id"]).toBe("sid-2");
	});

	test("Test 7 (W1) — 3-level chain: parent_session → agent.tool.Agent → subagent.<name>", async () => {
		clearSpans();
		const tracer = trace.getTracer(SUBAGENT_TRACER_NAME);
		await tracer.startActiveSpan("parent_session", async (parent) => {
			await withAgentToolSpan("research", "sid-3", async () => {
				await withSubagentSpan({ name: "research", pattern: "lean" }, "sid-3", async () => {
					// no-op inner
				});
			});
			parent.end();
		});
		const spans = exporter.getFinishedSpans();
		const parent = spans.find((s) => s.name === "parent_session")!;
		const tool = spans.find((s) => s.name === "agent.tool.Agent")!;
		const sub = spans.find((s) => s.name === "subagent.research")!;
		expect(parent && tool && sub).toBeTruthy();
		expect(tool.spanContext().traceId).toBe(parent.spanContext().traceId);
		expect(sub.spanContext().traceId).toBe(parent.spanContext().traceId);
		const toolParent = (tool as any).parentSpanContext?.spanId ?? (tool as any).parentSpanId;
		const subParent = (sub as any).parentSpanContext?.spanId ?? (sub as any).parentSpanId;
		expect(toolParent).toBe(parent.spanContext().spanId);
		expect(subParent).toBe(tool.spanContext().spanId);
	});
});

describe("OTel propagation — V4 end-to-end through createSubAgentTool.execute (Task 2)", () => {
	test("V4 — dispatch through Agent tool produces 3-level chain (parent → agent.tool.Agent → subagent.<name>)", async () => {
		clearSpans();

		const apiId = `otel-e2e-${Math.random().toString(36).slice(2)}`;
		const reg = registerFauxProvider({
			api: apiId,
			provider: apiId,
			models: [{ id: "test-model", contextWindow: 4096, maxTokens: 1024 }],
		});
		reg.setResponses(Array(8).fill(fauxAssistantMessage("E2E_OK", { stopReason: "stop" })));

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(apiId, "fake-key");

		const parentCwd = mkdtempSync(join(tmpdir(), "emmy-04.5-03-otel-e2e-"));
		const parentServices = await createAgentSessionServices({ cwd: parentCwd, authStorage });

		const persona: SubAgentSpec = {
			name: "test_lean",
			description: "x",
			pattern: "lean",
			toolAllowlist: [],
			maxTurns: 1,
		};

		const tool = createSubAgentTool({
			parentServices,
			parentCwd,
			personas: { test_lean: persona },
			modelResolver: () => reg.getModel(),
			parentSessionId: "sid-e2e",
		});

		const tracer = trace.getTracer(SUBAGENT_TRACER_NAME);
		await tracer.startActiveSpan("parent_session", async (parent) => {
			await tool.execute(
				"call-1",
				{ subagent_type: "test_lean", description: "d", prompt: "ping" } as any,
				undefined,
				undefined,
				{} as any,
			);
			parent.end();
		});

		const spans = exporter.getFinishedSpans();
		const parent = spans.find((s) => s.name === "parent_session")!;
		const toolSpan = spans.find((s) => s.name === "agent.tool.Agent")!;
		const subSpan = spans.find((s) => s.name === "subagent.test_lean")!;
		expect(parent).toBeDefined();
		expect(toolSpan).toBeDefined();
		expect(subSpan).toBeDefined();
		expect(toolSpan.spanContext().traceId).toBe(parent.spanContext().traceId);
		expect(subSpan.spanContext().traceId).toBe(parent.spanContext().traceId);
		const toolParent =
			(toolSpan as any).parentSpanContext?.spanId ?? (toolSpan as any).parentSpanId;
		const subParent = (subSpan as any).parentSpanContext?.spanId ?? (subSpan as any).parentSpanId;
		expect(toolParent).toBe(parent.spanContext().spanId);
		expect(subParent).toBe(toolSpan.spanContext().spanId);
		// The success-path final_text_chars attribute is set on the subagent span.
		expect(subSpan.attributes["emmy.subagent.final_text_chars"]).toBe(6); // "E2E_OK".length
		reg.unregister();
	});
});
