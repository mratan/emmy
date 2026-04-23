// Plan 02-06 Task 2 — web_fetch: HTTP GET → markdown.
//
// Contract:
//   - Documentation-reading only (CLAUDE.md: no cloud inference). Tagged
//     NETWORK_REQUIRED_TAG for Phase 3 offline-OK badge (UX-03).
//   - maxBytes default 2MB; exceeding throws ToolsError('web_fetch.size').
//   - timeoutMs default 30000ms (web-specific, tighter than provider-level).
//   - On timeout: throws ToolsError('web_fetch.timeout') — W7 fix message MUST
//     contain the timeoutMs literal so the caller can correlate the config value
//     with the timeout event in logs/telemetry.
//   - HTML → markdown via turndown (atx headings, fenced code blocks).
//   - JSON → pretty-printed within a \`\`\`json fence.
//   - Markdown/text → returned as-is.
//   - Response shape: { markdown, contentType, url } where `url` is the final
//     URL AFTER redirects (resp.url from fetch()).

import TurndownService from "turndown";
import { ToolsError } from "./errors";
import {
	enforceWebFetchAllowlist,
	WebFetchAllowlistError,
	type EnforcementContext,
} from "./web-fetch-allowlist";

export const NETWORK_REQUIRED_TAG = "network-required";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
// Phase 3.1 post-close: cap the final markdown response size. Plan 03.1-02
// walkthrough discovered that a single web_fetch on a JavaScript-heavy site
// (Yahoo Finance, CNN) returned 271K tokens in one turn — 2.4× max_model_len.
// 40 000 chars ≈ 10K tokens ≈ 1/12 of the 114 688-token input budget, leaving
// room for several fetches + the rest of the conversation. Pages exceeding
// this are head+tail-truncated (not rejected) so snippets of long docs still
// reach the agent.
const DEFAULT_MAX_MARKDOWN_CHARS = 40_000;
const TRUNCATE_HEAD_CHARS = 24_000;
const TRUNCATE_TAIL_CHARS = 12_000;

function truncateHeadTail(markdown: string, maxChars: number): string {
	if (markdown.length <= maxChars) return markdown;
	const droppedChars = markdown.length - TRUNCATE_HEAD_CHARS - TRUNCATE_TAIL_CHARS;
	return (
		markdown.slice(0, TRUNCATE_HEAD_CHARS) +
		`\n\n[…web_fetch truncated ${droppedChars.toLocaleString()} chars from middle — page is longer than the ${maxChars.toLocaleString()}-char per-fetch cap; refine the URL or use web_search for targeted snippets…]\n\n` +
		markdown.slice(-TRUNCATE_TAIL_CHARS)
	);
}

export async function webFetch(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxMarkdownChars?: number } = {},
): Promise<{ markdown: string; contentType: string; url: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxMarkdownChars = opts.maxMarkdownChars ?? DEFAULT_MAX_MARKDOWN_CHARS;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(new Error("timeout")), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctl.signal,
      headers: {
        accept: "text/html, text/markdown, application/json, text/plain, */*",
      },
    });
    const contentType = resp.headers.get("content-type") ?? "";
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new ToolsError(
        "web_fetch.size",
        `response exceeded maxBytes=${maxBytes} (actual=${buf.byteLength})`,
      );
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    let markdown: string;
    if (/application\/json/i.test(contentType)) {
      try {
        markdown = "```json\n" + JSON.stringify(JSON.parse(text), null, 2) + "\n```";
      } catch {
        markdown = text;
      }
    } else if (/text\/html/i.test(contentType)) {
      const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
      markdown = td.turndown(text);
    } else {
      markdown = text;
    }
    markdown = truncateHeadTail(markdown, maxMarkdownChars);
    return { markdown, contentType, url: resp.url };
  } catch (e) {
    if (e instanceof ToolsError) throw e;
    if (e instanceof Error && (e.name === "AbortError" || /timeout/i.test(e.message))) {
      // W7 FIX: include configured timeoutMs so "500ms" in the error message
      // matches the caller-supplied value — makes timeout events diagnosable.
      throw new ToolsError(
        "web_fetch.timeout",
        `GET ${url} timed out after ${timeoutMs}ms`,
      );
    }
    throw new ToolsError(
      "web_fetch.network",
      `GET ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(tm);
  }
}

// ---- Plan 03-06 (D-27 + D-28): allowlist-enforcing wrapper -----------------
//
// webFetchWithAllowlist is the pi-tool-call surface: it runs
// enforceWebFetchAllowlist BEFORE the HTTP GET and, on a WebFetchAllowlistError,
// returns a ToolError-shaped result (isError: true + content: [{type:text}]) so
// pi's agent loop receives a well-formed tool response and CONTINUES the session
// (D-28 warn-and-continue). Plain `webFetch` above remains for eval drivers and
// non-agent call sites that need raw network semantics.

export interface WebFetchToolErrorResult {
	isError: true;
	content: Array<{ type: "text"; text: string }>;
}

export interface WebFetchToolOkResult {
	isError?: false;
	markdown: string;
	contentType: string;
	url: string;
}

export type WebFetchToolResult = WebFetchToolErrorResult | WebFetchToolOkResult;

export async function webFetchWithAllowlist(
	url: string,
	enforcement: EnforcementContext,
	opts: { timeoutMs?: number; maxBytes?: number; maxMarkdownChars?: number } = {},
): Promise<WebFetchToolResult> {
	try {
		enforceWebFetchAllowlist(url, enforcement);
	} catch (e) {
		if (e instanceof WebFetchAllowlistError) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Error: ${e.message}`,
					},
				],
			};
		}
		throw e;
	}
	const r = await webFetch(url, opts);
	return { markdown: r.markdown, contentType: r.contentType, url: r.url };
}

