// packages/emmy-provider/src/types.ts
//
// Core types for the @emmy/provider package.
//
// Anchors to Plan 02-02:
// - GrammarConfig nested shape `{ path, mode }` is load-bearing for D-11 (reactive-only grammar).
//   Do NOT flatten to a bare string field — the `callWithReactiveGrammar` code path reads
//   `profile.harness.tools.grammar.path` and `profile.harness.tools.grammar.mode`.
// - `serving.engine.max_model_len` is REQUIRED (not optional) per W4 fix so downstream plans
//   (Plan 04 max-model-len regression, Plan 07 profile v2 fill) can trust the field exists.
// - ChatRequest carries `chat_template_kwargs` at the TOP LEVEL (matching Phase 1 SP_OK wire
//   shape) and `extra_body.guided_decoding.grammar` only on the reactive retry.

export interface ProfileRef {
	id: string; // "qwen3.6-35b-a3b"
	version: string; // "v1" | "v2"
	hash: string; // "sha256:<64-hex>"
	path: string; // absolute path to bundle dir
}

export interface GrammarConfig {
	path: string; // relative path under profile dir, e.g. "grammars/tool_call.lark"
	mode: "reactive" | "disabled"; // D-11: reactive only; "disabled" = SC-3 no-grammar baseline (Plan 08)
}

export interface ProfileSnapshot {
	ref: ProfileRef;
	// Subset of serving.yaml consumed by the provider. Read once per session.
	serving: {
		engine: {
			served_model_name: string;
			max_model_len: number; // REQUIRED per W4 fix; downstream honest-max-model-len tests depend on it.
		};
		sampling_defaults: {
			temperature: number;
			top_p: number;
			top_k?: number;
			repetition_penalty?: number;
			max_tokens: number;
			stop?: string[];
		};
		quirks: {
			strip_thinking_tags: boolean;
			promote_reasoning_to_content: boolean;
			buffer_tool_streams: boolean;
			// Optional extension: extra fields to strip from every response message.
			strip_fields?: string[];
		};
	};
	// Subset of harness.yaml consumed by the provider.
	harness: {
		tools: {
			format: "openai" | "hermes";
			// D-11 LOCK: nested shape { path, mode }. NEVER flatten to a string.
			// null means "no grammar configured" — retry path fails loud with `no_grammar_configured`.
			grammar: GrammarConfig | null;
			per_tool_sampling: Record<
				string,
				Partial<{
					temperature: number;
					top_p: number;
					max_tokens: number;
				}>
			>;
		};
		agent_loop: {
			// D-11 retry budget consumed by Plan 04's agent loop; provider hard-codes 1 for
			// wire-format parse failures. This field is observed but not consumed here.
			retry_on_unparseable_tool_call: number;
		};
	};
}

export interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string }; // arguments is a JSON string per OpenAI spec
}

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	// Non-OpenAI fields vLLM may emit; stripped by stripNonStandardFields.
	reasoning_content?: unknown;
	thinking?: unknown;
	[k: string]: unknown;
}

export interface ChatRequest {
	model: string; // served_model_name
	messages: ChatMessage[];
	temperature: number;
	top_p?: number;
	max_tokens: number;
	stop?: string[];
	stream?: boolean; // true for user-facing, false for canary / unit
	tools?: Array<{
		type: "function";
		function: {
			name: string;
			description?: string;
			parameters: Record<string, unknown>;
		};
	}>;
	tool_choice?:
		| "auto"
		| "none"
		| { type: "function"; function: { name: string } };
	// TOP-LEVEL placement matches Phase 1 SP_OK canary; vLLM ignores the OpenAI-SDK-only
	// `extra_body` field, so `chat_template_kwargs` must live at the root of the POST body.
	chat_template_kwargs?: Record<string, unknown>;
	extra_body?: {
		guided_decoding?: { grammar: string }; // set ONLY on reactive retry
		[k: string]: unknown;
	};
}

export interface ChatResponse {
	choices: Array<{
		message: ChatMessage & { role: "assistant" };
		finish_reason: "stop" | "length" | "tool_calls" | string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export interface GrammarRetryEvent {
	event: "grammar.retry" | "grammar.retry.success" | "grammar.retry.exhausted";
	ts: string;
	profile: ProfileRef;
	// "parse_failure"         — malformed tool_call arguments on first attempt (trigger)
	// "no_grammar_configured" — retry impossible: profile.harness.tools.grammar null or mode=disabled
	// "arg_parse_failure" / "schema_mismatch" — reserved for Phase 3 finer-grained signals
	reason:
		| "parse_failure"
		| "arg_parse_failure"
		| "schema_mismatch"
		| "no_grammar_configured";
	attempt: number;
	turn_id?: string;
}
