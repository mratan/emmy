// packages/emmy-tools/src/web-search.ts
//
// Phase 3.1 Plan 03.1-02 Task 1 (GREEN) — D-34 web_search tool.
//
// SearxNG JSON API wrapper. Loopback-only by configuration (profile's
// tools.web_search.base_url is pinned to 127.0.0.1:8888 and the runtime
// enforcement of allowlisted hosts + LOOPBACK_HOSTS set already makes
// non-loopback endpoints impossible to slip in).
//
// Surface:
//   - webSearch(query, opts) → SearchResult[] | WebSearchToolErrorResult
//     On HTTP failure/timeout/5xx/connect-refused, returns a ToolError-shaped
//     result + emits tool.web_search.fallback; does NOT throw. Agent loop
//     continues.
//   - registerWebSearchTool(opts) → pi ToolSpec | null
//     Null when opts.enabled=false, EMMY_WEB_SEARCH=off, or EMMY_TELEMETRY=off
//     (inherited kill-switch). Otherwise returns a name="web_search" spec
//     with {query, max_results?} schema.
//   - resetTurnSearchCount() — called by pi.on("turn_end") to reset the
//     module-level per-turn search counter (T-03.1-02-03 runaway guard).
//
// Telemetry events emitted (through the `emit` hook — test-injectable):
//   - tool.web_search.ok           (successful request)
//   - tool.web_search.fallback     (connection/timeout/HTTP error)
//   - tool.web_search.rate_limit   (11th call within a turn hit the cap)
//
// The recent-search-URL bypass (D-35) is wired via a lazy import to
// web-fetch-allowlist.recordSearchUrl on every successful result — see
// Plan 03.1-02 Task 2 for the bypass store implementation. When the
// recordSearchUrl import is unavailable (e.g. in isolation tests), the
// success path silently skips recording.

import { emitEvent } from "@emmy/telemetry";

// ---- Types ----------------------------------------------------------------

export interface WebSearchConfig {
	baseUrl: string;
	maxResultsDefault: number;
	rateLimitPerTurn: number;
	timeoutMs: number;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	engine: string;
}

export interface WebSearchToolErrorResult {
	isError: true;
	content: Array<{ type: "text"; text: string }>;
}

export interface WebSearchOpts extends Partial<WebSearchConfig> {
	/** Optional override for maxResults on a single call (agent-supplied). */
	maxResults?: number;
	/** Test hook for the canned SearxNG mock mode selector. */
	mockMode?: string;
	/** Test hook to collect emitted telemetry without hitting the dual sink. */
	emit?: (e: { event: string; [k: string]: unknown }) => void;
	/** Test hook to override the profile ref on emitted events. */
	profileRef?: { id: string; version: string; hash: string };
}

export interface PiToolDefinitionShape {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	invoke: (args: Record<string, unknown>) => Promise<unknown>;
}

// ---- Module-level rate-limit counter -------------------------------------
//
// T-03.1-02-03 mitigation. `_turnSearchCount` is incremented on every
// webSearch call attempt; when it would exceed cfg.rateLimitPerTurn, the
// call short-circuits to a ToolError. `resetTurnSearchCount` is wired by
// the pi extension factory on `pi.on("turn_end", ...)` (Plan 03.1-02 Task
// 2 integration). Tests can use __resetSearchCountForTests as a back door.

let _turnSearchCount = 0;

export function resetTurnSearchCount(): void {
	_turnSearchCount = 0;
}

/** Test-only: reset the module-level counter between tests. */
export function __resetSearchCountForTests(): void {
	_turnSearchCount = 0;
}

// ---- webSearch ------------------------------------------------------------

const DEFAULT_CFG: WebSearchConfig = {
	baseUrl: "http://127.0.0.1:8888",
	maxResultsDefault: 10,
	rateLimitPerTurn: 10,
	timeoutMs: 10000,
};

/** Lazy import to avoid a hard circular dep with web-fetch-allowlist. */
async function _recordSearchUrlSafe(url: string): Promise<void> {
	try {
		const mod = (await import("./web-fetch-allowlist")) as {
			recordSearchUrl?: (u: string) => void;
		};
		if (typeof mod.recordSearchUrl === "function") {
			mod.recordSearchUrl(url);
		}
	} catch {
		/* recordSearchUrl is optional; silently skip when unavailable */
	}
}

export async function webSearch(
	query: string,
	opts: WebSearchOpts = {},
): Promise<SearchResult[] | WebSearchToolErrorResult> {
	const cfg: WebSearchConfig = {
		baseUrl: opts.baseUrl ?? DEFAULT_CFG.baseUrl,
		maxResultsDefault: opts.maxResultsDefault ?? DEFAULT_CFG.maxResultsDefault,
		rateLimitPerTurn: opts.rateLimitPerTurn ?? DEFAULT_CFG.rateLimitPerTurn,
		timeoutMs: opts.timeoutMs ?? DEFAULT_CFG.timeoutMs,
	};
	const emit = opts.emit ?? ((e: { event: string; [k: string]: unknown }) =>
		emitEvent({ ts: new Date().toISOString(), ...e } as Parameters<
			typeof emitEvent
		>[0]));
	const maxResults = opts.maxResults ?? cfg.maxResultsDefault;

	// T-03.1-02-03 rate-limit gate. Check BEFORE incrementing so an over-
	// budget call doesn't consume more tokens of counter headroom.
	if (_turnSearchCount >= cfg.rateLimitPerTurn) {
		emit({
			event: "tool.web_search.rate_limit",
			ts: new Date().toISOString(),
			limit: cfg.rateLimitPerTurn,
		});
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: `Error: rate limit: ${cfg.rateLimitPerTurn} searches per turn reached. Either rely on prior results or wait for the next agent turn.`,
				},
			],
		};
	}
	_turnSearchCount++;

	// Build URL. SearxNG accepts q= + format=json; max_results isn't in the
	// public API for strict limiting (it's a hint), so we slice client-side.
	const url = new URL("/search", cfg.baseUrl);
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("safesearch", "0");
	if (opts.mockMode) url.searchParams.set("mock_mode", opts.mockMode);

	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(new Error("timeout")), cfg.timeoutMs);
	try {
		const resp = await fetch(url.toString(), {
			signal: ctl.signal,
			headers: { accept: "application/json" },
		});
		if (!resp.ok) {
			emit({
				event: "tool.web_search.fallback",
				ts: new Date().toISOString(),
				reason: `http_${resp.status}`,
				query,
			});
			return _buildError(
				`web_search failed: SearxNG returned HTTP ${resp.status}. The search index may be unreachable; try an allowlisted web_fetch URL or rephrase your approach.`,
			);
		}
		const body = (await resp.json()) as {
			results?: Array<{
				title?: unknown;
				url?: unknown;
				content?: unknown;
				engine?: unknown;
			}>;
		};
		const raw = Array.isArray(body.results) ? body.results : [];
		const mapped: SearchResult[] = raw.slice(0, maxResults).map((r) => ({
			title: typeof r.title === "string" ? r.title : "",
			url: typeof r.url === "string" ? r.url : "",
			snippet: typeof r.content === "string" ? r.content : "",
			engine: typeof r.engine === "string" ? r.engine : "",
		}));
		// D-35 — record returned URLs for web_fetch bypass. Silent-skip if the
		// recordSearchUrl export is not available (isolation test scenario).
		for (const r of mapped) {
			if (r.url) void _recordSearchUrlSafe(r.url);
		}
		emit({
			event: "tool.web_search.ok",
			ts: new Date().toISOString(),
			result_count: mapped.length,
			query,
		});
		return mapped;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		emit({
			event: "tool.web_search.fallback",
			ts: new Date().toISOString(),
			reason: "fetch_error",
			error: msg,
			query,
		});
		return _buildError(
			`web_search failed: ${msg}. SearxNG may be down; if operating locally, try 'bash scripts/start_searxng.sh'.`,
		);
	} finally {
		clearTimeout(timer);
	}
}

function _buildError(text: string): WebSearchToolErrorResult {
	return { isError: true, content: [{ type: "text", text }] };
}

// ---- registerWebSearchTool ------------------------------------------------

export interface RegisterWebSearchToolOpts {
	enabled: boolean;
	config: WebSearchConfig;
	/** Test-only hook to observe each successful result batch (wiring point
	 *  for the badge flipToYellow callback in Plan 03.1-02 Task 2). */
	onSuccess?: (results: SearchResult[]) => void;
}

/**
 * Returns a pi ToolSpec-shaped object for web_search or null when any of the
 * kill-switches is engaged.
 */
export function registerWebSearchTool(
	opts: RegisterWebSearchToolOpts,
): PiToolDefinitionShape | null {
	if (!opts.enabled) return null;
	if (process.env.EMMY_WEB_SEARCH === "off") return null;
	// EMMY_TELEMETRY=off is an explicit "no telemetry, no egress" setting —
	// web_search is egress-adjacent (SearxNG is outbound even though loopback-
	// bound), so we inherit the off-switch.
	if (process.env.EMMY_TELEMETRY === "off") return null;

	const cfg = opts.config;
	return {
		name: "web_search",
		description:
			"Search the open web via a local self-hosted SearxNG instance at " +
			cfg.baseUrl +
			". Returns an array of {title, url, snippet, engine} records. Rate-limited to " +
			String(cfg.rateLimitPerTurn) +
			" calls per agent turn. Use web_fetch to follow up on any returned URL without adding to the allowlist.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query." },
				max_results: {
					type: "integer",
					minimum: 1,
					maximum: 50,
					default: cfg.maxResultsDefault,
					description:
						"Maximum number of results to return (default " +
						String(cfg.maxResultsDefault) +
						").",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		invoke: async (args: Record<string, unknown>) => {
			const query = typeof args.query === "string" ? args.query : "";
			const maxResults =
				typeof args.max_results === "number" ? args.max_results : cfg.maxResultsDefault;
			const res = await webSearch(query, {
				baseUrl: cfg.baseUrl,
				maxResultsDefault: cfg.maxResultsDefault,
				rateLimitPerTurn: cfg.rateLimitPerTurn,
				timeoutMs: cfg.timeoutMs,
				maxResults,
			});
			// If the underlying call succeeded, wrap as { results: [...] } so the
			// agent sees a structured response (pi tool_result surfaces this to
			// the assistant). ToolError-shaped results pass through unchanged so
			// pi's agent loop surfaces the error text.
			if ((res as WebSearchToolErrorResult).isError === true) return res;
			const results = res as SearchResult[];
			if (opts.onSuccess) {
				try {
					opts.onSuccess(results);
				} catch {
					/* never let the success-hook mask a returned result */
				}
			}
			return { results };
		},
	};
}
