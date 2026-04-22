// packages/emmy-provider/src/grammar-retry.ts
//
// Reactive XGrammar retry path (D-11).
//
// Cite: CLAUDE.md Pitfall #6 / CONTEXT.md §D-11.
//   Grammar is a correctness backstop, NOT a quality lever.
//   We parse unconstrained first. On tool-call argument parse failure we retry
//   exactly once with `extra_body.guided_decoding.grammar` populated. There is
//   no unconditional-on path in Phase 2; the only `mode` values the schema
//   exposes are "reactive" and "disabled" (the Plan 08 no-grammar baseline).
//
// Wire-shape anchor: the nested grammar config shape comes from D-11 (B3 fix)
// and is read as `profile.harness.tools.grammar.{path, mode}`. Plan 07 writes
// the v2 harness.yaml with this exact shape. If someone ever re-flattens this
// to a bare string field, the type-checker catches it here.
//
// Telemetry: every retry decision emits an event via @emmy/telemetry.emitEvent
// (Wave-0 no-op body; Phase 3 replaces it with atomic JSONL append). SC-3's
// parse-rate metric is computed from these events in Plan 08's corpus replay:
//   - grammar.retry              : trigger (first-pass parse failure)
//   - grammar.retry.success      : retry parsed cleanly
//   - grammar.retry.exhausted    : retry still malformed OR no grammar configured
// Every event carries `profile: profile.ref` (Shared Pattern 3/4).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emitEvent } from "@emmy/telemetry";
import { GrammarRetryExhaustedError, ProviderError } from "./errors";
import { postChat } from "./http";
import type { ChatRequest, ChatResponse, ProfileSnapshot, ToolCall } from "./types";

/**
 * Retry-state shape the before_provider_request hook consumes to decide whether
 * to inject `extra_body.guided_decoding.grammar_str` for the current request.
 */
export interface RetryState {
	wantsGrammar: boolean;
}

// Intentional: pure WeakMap semantics — GC handles the entry lifetime correctly.
// Each request's AbortSignal is the key; when the signal is discarded (typically
// at response-stream close) the corresponding entry becomes unreachable. There is
// no size cap, no explicit eviction, no manual bookkeeping — long-running sessions
// are bounded by request-level AbortSignal lifetime.
// See grammar-retry.weakmap.test.ts for the guard test.
const _retryStateMap: WeakMap<AbortSignal, RetryState> = new WeakMap();

/**
 * Read the retry state associated with a given AbortSignal. Returns undefined
 * if no state has been stored against this signal. Pure WeakMap semantics —
 * never does size-bounded eviction.
 */
export function getRetryStateForSignal(signal: AbortSignal): RetryState | undefined {
	return _retryStateMap.get(signal);
}

/**
 * Associate retry state with a given AbortSignal. Later reads via
 * getRetryStateForSignal return this value while `signal` is reachable;
 * once `signal` is GC'd the entry becomes unreachable automatically.
 */
export function setRetryStateForSignal(signal: AbortSignal, state: RetryState): void {
	_retryStateMap.set(signal, state);
}

/**
 * Reactive grammar retry path (D-11 / CLAUDE.md Pitfall #6).
 *
 * 1. Parse unconstrained first. Most turns never pay the grammar cost.
 * 2. If any tool_call.arguments is not valid JSON, retry ONCE with
 *    `extra_body.guided_decoding.grammar` populated. Grammar path resolved
 *    from `profile.harness.tools.grammar.path` (nested shape per D-11; B3 fix)
 *    against `profile.ref.path`.
 * 3. Emit telemetry events on every retry decision so SC-3's parse-rate
 *    metric can be computed by counting events in the corpus replay.
 *
 * Retry budget is hard-coded to 1 at the provider level.
 * `profile.harness.agent_loop.retry_on_unparseable_tool_call` is the AGENT
 * LOOP's retry budget (Plan 04), not this one. This function handles a single
 * wire-format parse failure and returns.
 */
export async function callWithReactiveGrammar(
	baseUrl: string,
	req: ChatRequest,
	profile: ProfileSnapshot,
	opts: { turnId?: string } = {},
): Promise<{ response: ChatResponse; retried: boolean; reason?: string }> {
	const firstResp = await postChat(baseUrl, req);
	const toolCalls = firstResp.choices[0]?.message?.tool_calls;
	if (!toolCalls || toolCalls.length === 0) {
		return { response: firstResp, retried: false };
	}
	const parseFailure = firstBadArgument(toolCalls);
	if (!parseFailure) {
		return { response: firstResp, retried: false };
	}

	// --- RETRY trigger event — always emitted on first-pass parse failure ---
	emitEvent({
		event: "grammar.retry",
		ts: new Date().toISOString(),
		profile: profile.ref,
		reason: "parse_failure",
		attempt: 1,
		...(opts.turnId !== undefined ? { turn_id: opts.turnId } : {}),
	});

	// B3 FIX: consume nested shape profile.harness.tools.grammar.{path, mode}.
	// Retry is impossible if grammar is null OR mode is "disabled".
	const grammarConfig = profile.harness.tools.grammar;
	if (grammarConfig === null || grammarConfig.mode === "disabled") {
		emitEvent({
			event: "grammar.retry.exhausted",
			ts: new Date().toISOString(),
			profile: profile.ref,
			reason: "no_grammar_configured",
			attempt: 1,
			...(opts.turnId !== undefined ? { turn_id: opts.turnId } : {}),
		});
		throw new ProviderError(
			"grammar.retry",
			`tool-call arguments unparseable and harness.tools.grammar is ${
				grammarConfig === null
					? "null"
					: `mode=${grammarConfig.mode}`
			} (profile ${profile.ref.id}@${profile.ref.version})`,
		);
	}

	const grammarPath = join(profile.ref.path, grammarConfig.path);
	let grammarText: string;
	try {
		grammarText = readFileSync(grammarPath, "utf8");
	} catch (e) {
		throw new ProviderError(
			"grammar.retry",
			`grammar file not found: ${grammarPath} (${
				e instanceof Error ? e.message : String(e)
			})`,
		);
	}

	const retryReq: ChatRequest = {
		...req,
		extra_body: {
			...(req.extra_body ?? {}),
			guided_decoding: { grammar: grammarText },
		},
	};
	const retryResp = await postChat(baseUrl, retryReq);
	const retryToolCalls = retryResp.choices[0]?.message?.tool_calls ?? [];
	const stillBad = firstBadArgument(retryToolCalls);
	if (stillBad) {
		emitEvent({
			event: "grammar.retry.exhausted",
			ts: new Date().toISOString(),
			profile: profile.ref,
			reason: "parse_failure",
			attempt: 1,
			...(opts.turnId !== undefined ? { turn_id: opts.turnId } : {}),
		});
		throw new GrammarRetryExhaustedError(1, "parse_failure");
	}
	emitEvent({
		event: "grammar.retry.success",
		ts: new Date().toISOString(),
		profile: profile.ref,
		reason: "parse_failure",
		attempt: 1,
		...(opts.turnId !== undefined ? { turn_id: opts.turnId } : {}),
	});
	return { response: retryResp, retried: true, reason: "parse_failure" };
}

function firstBadArgument(toolCalls: ToolCall[]): string | null {
	for (const tc of toolCalls) {
		try {
			JSON.parse(tc.function.arguments);
		} catch (_e) {
			return tc.function.name;
		}
	}
	return null;
}
