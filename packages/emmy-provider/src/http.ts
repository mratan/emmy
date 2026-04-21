// packages/emmy-provider/src/http.ts
//
// Thin fetch wrapper around vLLM's OpenAI-compat `/v1/chat/completions`.
// Wire shape mirrors the Phase 1 Python canaries verbatim (see
// `emmy_serve/canary/replay.py` and `emmy_serve/canary/sp_ok.py`):
// - `chat_template_kwargs` lives at the TOP LEVEL of the body (vLLM ignores
//   the OpenAI-SDK-only `extra_body` concept as a server field).
// - `extra_body.guided_decoding.grammar` is populated ONLY on the reactive
//   retry (D-11); never on the first call.
//
// Timeouts: default 120s matches `replay.py`; the SP_OK canary caller passes
// 60000ms per `sp_ok.py`.

import { NetworkError } from "./errors";
import type { ChatRequest, ChatResponse } from "./types";

export async function postChat(
	baseUrl: string,
	payload: ChatRequest,
	opts: { timeoutMs?: number } = {},
): Promise<ChatResponse> {
	const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
	const timeoutMs = opts.timeoutMs ?? 120_000;
	const controller = new AbortController();
	const timer = setTimeout(() => {
		// AbortController.abort(reason) exists on modern runtimes; fall back gracefully.
		try {
			(controller as AbortController & { abort: (reason?: unknown) => void }).abort(
				new Error("timeout"),
			);
		} catch (_e) {
			controller.abort();
		}
	}, timeoutMs);
	try {
		const resp = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		if (!resp.ok) {
			const text = await resp.text().catch(() => "(unreadable body)");
			throw new NetworkError(url, resp.status, text.slice(0, 512));
		}
		return (await resp.json()) as ChatResponse;
	} catch (e: unknown) {
		if (e instanceof NetworkError) throw e;
		if (
			e instanceof Error &&
			(e.name === "AbortError" ||
				e.name === "TimeoutError" ||
				/timeout/i.test(e.message))
		) {
			throw new NetworkError(url, null, `timeout after ${timeoutMs}ms`);
		}
		throw new NetworkError(
			url,
			null,
			e instanceof Error ? e.message : String(e),
		);
	} finally {
		clearTimeout(timer);
	}
}
