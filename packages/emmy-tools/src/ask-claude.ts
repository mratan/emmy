// packages/emmy-tools/src/ask-claude.ts
//
// Phase 04.6 Plan 04.6-05 (GREEN) — ask_claude tool form.
//
// A model-callable tool that escalates a focused question to Claude (the
// stronger reasoning model), routed through the Spark-side sidecar's
// POST /ask-claude endpoint (Phase 04.6-01). Gated by:
//
//   - D-13 opt-in per profile: factory returns null when config.enabled !== true
//   - D-05 structured args: question + tried (required) + relevant_context (optional)
//   - D-07 harness-side per-turn rate-limit (sidecar enforces global pool)
//   - T-06 discipline gate: boilerplate `tried` ("stuck", "I tried thinking",
//     "n/a", etc.) is rejected before dispatch — the `tried` field is the
//     load-bearing knob that forces the model to document prior attempts
//
// The tool description (D-15) carries the verbatim "X circumstances"
// guidance — Phase 5 eval calibrates whether the model honors it; this
// module only enforces the structured-args + per-turn budget gates.
//
// Surface mirrors web-search.ts:
//   - createAskClaudeTool(deps) → PiToolDefinitionShape | null
//   - resetAskClaudeTurnCount()  → wired by pi extension factory on
//     pi.on("turn_end", ...)
//   - __resetAskClaudeTurnCountForTests() — test-only back door
//   - callAskClaudeViaSidecar(prompt, opts?) — convenience HTTP client
//     that POSTs to ${EMMY_SERVE_URL}/ask-claude per CLAUDE.md URL config
//     precedence (env > profile > literal default 127.0.0.1:8003).
//
// The factory takes a `callAskClaude` dep so tests can inject a stub and
// production can wire callAskClaudeViaSidecar (or a profile-overridden
// equivalent).

import type { PiToolDefinitionShape } from "./web-search";

// ---- Types ----------------------------------------------------------------

export interface AskClaudeArgs {
	question: string;
	tried: string;
	relevant_context?: string;
}

/** Result shape returned by the sidecar POST /ask-claude success body
 *  (Phase 04.6-01 — see emmy_serve/swap/controller.py::AskClaudeResponse). */
export interface AskClaudeCallResult {
	response: string;
	duration_ms: number;
	rate_limit_remaining_hour: number;
}

/** Optional fields a sidecar/transport can attach to a thrown Error so the
 *  tool can surface them to the model verbatim (e.g. the matched pattern
 *  class on scrubber_blocked, or the rate-limit reason). */
export interface AskClaudeError extends Error {
	reason?: string;
	pattern_class?: string;
	matched_excerpt?: string;
	detail?: string;
	status?: number;
}

export interface AskClaudeConfig {
	enabled: boolean;
	rate_limit_per_turn: number;
	rate_limit_per_hour: number;
}

export interface AskClaudeToolDeps {
	/** Caller-injected sidecar invoker. Production callers can pass
	 *  callAskClaudeViaSidecar; tests inject stubs. */
	callAskClaude: (prompt: string) => Promise<AskClaudeCallResult>;
	config: AskClaudeConfig;
}

// ---- Tool description (D-15 verbatim, do not paraphrase) ----------------
//
// Phase 04.6 D-15: "X circumstances" guidance is shipped in the tool
// description, not enforced in code. Phase 5 eval calibrates whether the
// model honors it; this string is the harness's only side of the contract.
// CLAUDE.md instruction: copy-paste verbatim — paraphrasing is forbidden.

const TOOL_DESCRIPTION = `Ask Claude (a stronger reasoning model) a focused question when stuck on a hard problem.

Use ask_claude WHEN:
  - You've tried at least 2 local approaches and they failed (must show in your reasoning trace)
  - The problem needs reasoning past your training horizon: cutting-edge algorithm, security-sensitive
    correctness, complex multi-system architecture decisions hard to undo
  - The user explicitly asked for a "second opinion" or "expert review"
  - You're about to make a design choice with significant downstream cost (DB schema, API contract,
    security model, dependency commitment)

Do NOT use ask_claude for:
  - Anything solvable by reading more files (use read/grep first)
  - Anything solvable by running tests/experiments (use bash)
  - Routine code edits, test writing, refactoring
  - Information lookups about libraries/docs (use web_search)
  - Simple syntax/language questions (just answer)
  - Sensitive content: secrets, credentials, PII, customer data (the scrubber will block these and
    you should not even attempt — your prompt will fail and the user will see the matched class)

Format your call:
  ask_claude(
    question: "Concrete, focused question — not a dump of context",
    tried: "What you've already attempted and why it didn't work — required, must be specific",
    relevant_context: "Minimum sufficient context (≤ 2K tokens). Code snippets, error messages, or
                       a short summary of the problem domain"
  )

Output is a verdict/suggestion you should evaluate critically; Claude can be wrong, and you remain
responsible for the answer. Per-turn limit: 5 calls.`;

// ---- Boilerplate-tried gate (T-06 / discipline shaper) -------------------
//
// The `tried` field is the load-bearing knob that forces the model to
// document prior attempts before escalating. Empty / boilerplate values
// short-circuit before dispatch with a structured error directing the
// model back to local approaches. See PLAN test cases for the boilerplate
// set; the regex is anchored on the whole-string trimmed match so a
// genuine "I tried thinking through approach A and it returned X, then I
// tried approach B and it returned Y" passes through.

// Match either an exact-equality short-circuit set ("stuck", "n/a", "tried"
// alone, etc.) OR a prefix that starts with a known boilerplate opener
// ("I tried thinking ...", "I don't know ...", "thinking ..."). The PLAN
// boilerplate corpus includes "I tried thinking about it" — so the
// long-form openers anchor on `^` only, not `$`. The exact-equality set
// stays anchored both ends so a real attempt that mentions "stuck" or
// "tried" mid-sentence still passes through.
const _BOILERPLATE_TRIED_PATTERNS: readonly RegExp[] = [
	/^\s*$/,
	/^\s*(n\/?a|none|nothing|tried|stuck|thinking)\.?\s*$/i,
	/^\s*(i don'?t know|i tried thinking)\b/i,
];

function _isBoilerplateTried(tried: string): boolean {
	for (const p of _BOILERPLATE_TRIED_PATTERNS) {
		if (p.test(tried)) return true;
	}
	return false;
}

// ---- Module-level per-turn rate-limit counter (D-07 harness side) -------
//
// Mirrors web-search.ts's _turnSearchCount discipline. resetAskClaudeTurnCount
// is wired by the pi extension factory on pi.on("turn_end", ...). Tests use
// __resetAskClaudeTurnCountForTests as a back door.

let _turnAskClaudeCount = 0;

export function resetAskClaudeTurnCount(): void {
	_turnAskClaudeCount = 0;
}

/** Test-only: reset the module-level counter between tests. */
export function __resetAskClaudeTurnCountForTests(): void {
	_turnAskClaudeCount = 0;
}

// ---- ToolError-shaped result helper ---------------------------------------

interface ToolErrorResult {
	isError: true;
	content: Array<{ type: "text"; text: string }>;
}

function _err(text: string): ToolErrorResult {
	return { isError: true, content: [{ type: "text", text }] };
}

// ---- callAskClaudeViaSidecar (production transport) ----------------------
//
// CLAUDE.md URL config precedence: env > profile > literal default. Profile
// override (if any) is plumbed through opts.baseUrl by the harness's
// session.ts wiring layer. Literal default is the D-33 LOCKED loopback
// 127.0.0.1:8003 (matches profile-swap-runner-http.ts and metrics-poller.ts
// — the same sidecar surface).
//
// Returns AskClaudeCallResult on 2xx; throws AskClaudeError with `reason`
// + (optional) `pattern_class` / `matched_excerpt` / `detail` populated
// from the JSON response body so the tool can surface them verbatim.

export interface CallAskClaudeViaSidecarOpts {
	/** Optional override; otherwise EMMY_SERVE_URL or 127.0.0.1:8003. */
	baseUrl?: string;
	/** Optional millisecond timeout for the sidecar request itself. */
	timeoutMs?: number;
	/** Test hook so we don't pay for fetch in the unit suite. */
	fetchImpl?: typeof fetch;
}

export async function callAskClaudeViaSidecar(
	prompt: string,
	opts: CallAskClaudeViaSidecarOpts = {},
): Promise<AskClaudeCallResult> {
	const baseUrl = (opts.baseUrl ??
		process.env.EMMY_SERVE_URL ??
		"http://127.0.0.1:8003").replace(/\/$/, "");
	const url = `${baseUrl}/ask-claude`;
	const fetchImpl = opts.fetchImpl ?? fetch;

	const ctl = new AbortController();
	const timer =
		typeof opts.timeoutMs === "number"
			? setTimeout(() => ctl.abort(new Error("timeout")), opts.timeoutMs)
			: undefined;

	let resp: Response;
	try {
		resp = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({
				prompt,
				...(typeof opts.timeoutMs === "number"
					? { timeout_ms: opts.timeoutMs }
					: {}),
			}),
			signal: ctl.signal,
		});
	} finally {
		if (timer) clearTimeout(timer);
	}

	if (resp.ok) {
		const body = (await resp.json()) as AskClaudeCallResult;
		return body;
	}

	// Map sidecar 4xx/5xx into AskClaudeError so the tool can surface the
	// reason + pattern_class verbatim. Sidecar contract (Plan 04.6-01):
	//   400 scrubber_blocked  → detail.{reason, pattern_class, matched_excerpt}
	//   429 rate_limited_*    → detail.{reason}
	//   503 env_disabled / claude_cli_not_found → detail.{reason}
	//   504 timeout / 502 subprocess_failed     → detail.{reason, detail?, exit_code?}
	type ErrorBody = {
		detail?: {
			reason?: string;
			pattern_class?: string;
			matched_excerpt?: string;
			detail?: string;
		};
	};
	let parsed: ErrorBody = {};
	try {
		parsed = (await resp.json()) as ErrorBody;
	} catch {
		// non-JSON body — fall through with empty parsed
	}
	const detail = parsed.detail ?? {};
	const err = new Error(
		detail.reason ?? `ask_claude HTTP ${resp.status}`,
	) as AskClaudeError;
	err.status = resp.status;
	if (detail.reason) err.reason = detail.reason;
	if (detail.pattern_class) err.pattern_class = detail.pattern_class;
	if (detail.matched_excerpt) err.matched_excerpt = detail.matched_excerpt;
	if (detail.detail) err.detail = detail.detail;
	throw err;
}

// ---- createAskClaudeTool (D-13) ------------------------------------------

/**
 * Factory for the ask_claude tool. Returns a PiToolDefinitionShape on
 * config.enabled=true; null otherwise (D-13 opt-in: registration must be
 * a no-op when the profile doesn't enable the tool).
 *
 * The returned spec mirrors web-search's shape: {name, description,
 * parameters, invoke}. session.ts feeds it through toolSpecToDefinition
 * (or the legacy registerNativeTools shim) to produce the pi 0.68
 * ToolDefinition consumed by createAgentSessionFromServices.
 */
export function createAskClaudeTool(
	deps: AskClaudeToolDeps,
): PiToolDefinitionShape | null {
	if (!deps.config.enabled) return null;

	return {
		name: "ask_claude",
		description: TOOL_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				question: {
					type: "string",
					minLength: 1,
					maxLength: 4000,
					description: "The concrete focused question for Claude.",
				},
				tried: {
					type: "string",
					minLength: 10,
					maxLength: 4000,
					description:
						"Specific prior attempts and why they failed. Boilerplate (e.g., 'I tried thinking', 'stuck', 'n/a') is rejected before dispatch.",
				},
				relevant_context: {
					type: "string",
					maxLength: 8000,
					description:
						"Minimum sufficient context. ≤ 2K tokens recommended. Code snippets, error messages, or a short problem-domain summary.",
				},
			},
			required: ["question", "tried"],
			additionalProperties: false,
		},
		invoke: async (rawArgs: Record<string, unknown>): Promise<unknown> => {
			const question = typeof rawArgs.question === "string" ? rawArgs.question : "";
			const tried = typeof rawArgs.tried === "string" ? rawArgs.tried : "";
			const relevantContext =
				typeof rawArgs.relevant_context === "string"
					? rawArgs.relevant_context
					: "";

			// Boilerplate-tried gate (D-05 / T-06). Validation rejects MUST NOT
			// consume rate-limit headroom — gate runs before the counter check.
			if (_isBoilerplateTried(tried)) {
				return _err(
					"`tried` field requires concrete prior attempts. Try reading more files, running tests, or thinking harder first; if still stuck, document what specifically failed (e.g., 'I tried X and got error Y; I tried Z and it produced wrong result W') and try again.",
				);
			}

			// Per-turn rate-limit (D-07 harness pool). Check BEFORE incrementing
			// so an over-budget call doesn't consume more counter headroom (same
			// discipline as web-search.ts).
			if (_turnAskClaudeCount >= deps.config.rate_limit_per_turn) {
				return _err(
					`ask_claude rate-limit (${deps.config.rate_limit_per_turn} per-turn) exceeded. Continue the work locally and try again on a future turn.`,
				);
			}

			// Build the prompt sent to Claude (structured per D-05). The sidecar
			// receives a single `prompt` string; the harness composes the three
			// fields into the canonical layout so Claude sees a consistent shape.
			const prompt = [
				`question: ${question}`,
				``,
				`tried: ${tried}`,
				``,
				`relevant_context: ${relevantContext.length > 0 ? relevantContext : "(none provided)"}`,
			].join("\n");

			try {
				const r = await deps.callAskClaude(prompt);
				_turnAskClaudeCount += 1;
				return {
					content: [
						{
							type: "text" as const,
							text: `Claude (${r.duration_ms}ms, ${r.rate_limit_remaining_hour}/hr left):\n\n${r.response}`,
						},
					],
				};
			} catch (caught: unknown) {
				const err = caught as AskClaudeError;
				const reason = err?.reason ?? "unknown";
				const patternBit = err?.pattern_class
					? ` (${err.pattern_class})`
					: "";
				const detailBit = err?.detail
					? ` ${err.detail}`
					: err?.message && err.message !== reason
						? ` ${err.message}`
						: "";
				return _err(`ask_claude failed: ${reason}${patternBit}.${detailBit}`.trim());
			}
		},
	};
}
