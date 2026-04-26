// Phase 04.5 Plan 03 — OTel parent-child span propagation helpers.
//
// LOCKED 4-level trace tree (CONTEXT.md §decisions diagram, line 183):
//   Level 1: parent_session                  (owned by emmy-ux's session.ts)
//   Level 2: agent.tool.Agent                (owned by createSubAgentTool's execute — withAgentToolSpan, W1)
//   Level 3: subagent.<persona.name>         (owned by dispatchSubAgent — withSubagentSpan)
//   Level 4: child_invoke_agent / child_chat_completion  (owned by OTel HTTP auto-instrumentation
//            in @emmy/telemetry; not exercised by faux tests)
//
// Pitfall #18 mitigation: every level fires on every dispatch, with ERROR status + recordException
// on failure paths so sub-agents are NEVER black-boxes — debugging a failed sub-agent never requires
// opening multiple log files; the trace tree shows the full chain in one viewer.
//
// AsyncLocalStorage propagation: tracer.startActiveSpan already activates the new span as the
// active span and runs the callback inside that activated context. OTel uses AsyncLocalStorage
// under the hood (H5 confirms this works through pi's tool dispatch). We do NOT add a redundant
// `context.with(parentCtx, ...)` wrapper — startActiveSpan does the right thing.

import { context, trace, SpanStatusCode, type Span } from "@opentelemetry/api";

export const SUBAGENT_TRACER_NAME = "emmy-subagent";

/**
 * Level 2 of the LOCKED 4-level trace tree (W1 fix).
 *
 * Wraps the Agent tool's execute body so the dispatcher's subagent span has an explicit
 * tool-call parent. Without this span the trace tree is only 3 levels and the per-tool-call
 * grouping is lost.
 *
 * @param personaName  the resolved persona key (e.g. "research")
 * @param parentSessionId  the parent pi AgentSession id, when known (stamped on `gen_ai.conversation.id`)
 * @param inner  the callback to run inside the activated span
 */
export async function withAgentToolSpan<T>(
	personaName: string,
	parentSessionId: string | undefined,
	inner: (span: Span) => Promise<T>,
): Promise<T> {
	const tracer = trace.getTracer(SUBAGENT_TRACER_NAME);
	return await tracer.startActiveSpan(
		"agent.tool.Agent",
		{
			attributes: {
				"gen_ai.tool.name": "Agent",
				"gen_ai.tool.persona": personaName,
				"gen_ai.conversation.id": parentSessionId ?? "<unknown>",
			},
		},
		async (span: Span) => {
			try {
				return await inner(span);
			} catch (err) {
				span.recordException(err as Error);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: (err as Error)?.message ?? String(err),
				});
				throw err;
			} finally {
				span.end();
			}
		},
	);
}

/**
 * Level 3 of the LOCKED 4-level trace tree.
 *
 * Parented to `agent.tool.Agent` when called from inside withAgentToolSpan. The child's
 * vLLM HTTP request inherits the trace context via AsyncLocalStorage — no manual
 * `traceparent` injection here; OTel HTTP auto-instrumentation handles the wire-level header.
 */
export async function withSubagentSpan<T>(
	persona: { name: string; pattern: "lean" | "persona" },
	parentSessionId: string | undefined,
	inner: (span: Span) => Promise<T>,
): Promise<T> {
	const tracer = trace.getTracer(SUBAGENT_TRACER_NAME);
	const parentCtx = context.active();
	const parentSpan = trace.getSpan(parentCtx);
	const parentSpanIdHex = parentSpan?.spanContext().spanId;

	return await tracer.startActiveSpan(
		`subagent.${persona.name}`,
		{
			attributes: {
				"gen_ai.agent.name": persona.name,
				// v1 fallback: id == name. Profile id stamping is owned by EmmyProfileStampProcessor at the OTel resource layer.
				"gen_ai.agent.id": persona.name,
				"gen_ai.conversation.id": parentSessionId ?? "<unknown>",
				"emmy.subagent.pattern": persona.pattern,
				...(parentSpanIdHex ? { "emmy.subagent.parent_span_id": parentSpanIdHex } : {}),
			},
		},
		async (span: Span) => {
			try {
				return await inner(span);
			} catch (err) {
				span.recordException(err as Error);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: (err as Error)?.message ?? String(err),
				});
				throw err;
			} finally {
				span.end();
			}
		},
	);
}
