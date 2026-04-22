// packages/emmy-telemetry/src/span-factory.ts
//
// Phase 3 Plan 03-02 Task 3 (GREEN) — OTel GenAI semconv span helpers.
//
// HARNESS-09 canonicalizes span names and attribute names for the chat-call
// and tool-execute span types. Rather than stamp the attributes ad-hoc at
// every call site (D-10 anti-pattern — RESEARCH Pitfall on inventing
// emmy-specific names where OTel semconv already has canonical ones), we
// funnel span creation through the helpers below and only add emmy-specific
// attrs (emmy.prompt.sha256, emmy.grammar.retry_count) where semconv has no
// coverage.
//
// Plan 03-03 (not this plan) will wire these helpers into the
// before_provider_request hook for live chat spans. This file ships the
// skeleton + unit-testable signatures.

import { SpanKind, trace, type Span, type Tracer } from "@opentelemetry/api";

export interface ProfileRef {
	id: string;
	version: string;
	hash: string;
}

export interface StartChatSpanArgs {
	model: string;
	profile: ProfileRef;
	promptSha256: string;
	/** Optional override; defaults to global trace.getTracer("emmy", ...) */
	tracer?: Tracer;
}

/**
 * Start an OTel GenAI semconv chat span with emmy-specific extensions.
 *
 * Attribute schema:
 *   gen_ai.system               = "vllm"
 *   gen_ai.request.model        = args.model
 *   emmy.prompt.sha256          = args.promptSha256
 *   emmy.profile.{id,ver,hash}  = auto-stamped by SpanProcessor.onStart
 *
 * Caller is responsible for ending the span (via endChatSpan) to ensure
 * duration + finish-reason metrics land on the right span.
 */
export function startChatSpan(args: StartChatSpanArgs): Span {
	const tracer = args.tracer ?? trace.getTracer("emmy", "0.1.0");
	const span = tracer.startSpan("emmy.chat", { kind: SpanKind.CLIENT });
	span.setAttributes({
		"gen_ai.system": "vllm",
		"gen_ai.request.model": args.model,
		"emmy.prompt.sha256": args.promptSha256,
	});
	return span;
}

export interface StartToolExecuteSpanArgs {
	toolName: string;
	argsHash: string;
	tracer?: Tracer;
}

/**
 * Start an OTel GenAI semconv tool-execute span.
 *
 * Attribute schema:
 *   gen_ai.operation.name = "execute_tool"
 *   gen_ai.tool.name      = args.toolName
 *   emmy.tool.args_hash   = args.argsHash
 */
export function startToolExecuteSpan(args: StartToolExecuteSpanArgs): Span {
	const tracer = args.tracer ?? trace.getTracer("emmy", "0.1.0");
	const span = tracer.startSpan(`emmy.tool.${args.toolName}`, { kind: SpanKind.INTERNAL });
	span.setAttributes({
		"gen_ai.operation.name": "execute_tool",
		"gen_ai.tool.name": args.toolName,
		"emmy.tool.args_hash": args.argsHash,
	});
	return span;
}

export interface EndChatSpanArgs {
	tokensIn?: number;
	tokensOut?: number;
	finishReasons?: string[];
}

/**
 * Stamp usage + finish-reason attrs and end a chat span. Idempotent on the
 * close side — subsequent end() calls are cheap no-ops per OTel SDK.
 */
export function endChatSpan(span: Span, args: EndChatSpanArgs): void {
	if (args.tokensIn !== undefined) span.setAttribute("gen_ai.usage.input_tokens", args.tokensIn);
	if (args.tokensOut !== undefined) span.setAttribute("gen_ai.usage.output_tokens", args.tokensOut);
	if (args.finishReasons && args.finishReasons.length > 0) {
		span.setAttribute("gen_ai.response.finish_reasons", args.finishReasons);
	}
	span.end();
}
