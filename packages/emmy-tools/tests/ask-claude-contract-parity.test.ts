// packages/emmy-tools/tests/ask-claude-contract-parity.test.ts
//
// WR-06 (Phase 04.6 review) — two near-identical TS HTTP clients exist:
//   - callAskClaudeViaSidecar  in @emmy/tools/src/ask-claude.ts (model-side tool)
//   - callAskClaude            in @emmy/ux/src/ask-claude-client.ts (slash command)
//
// They will drift over time — a future change to the sidecar wire contract
// (e.g. adding a request_id field or a new error reason) requires updating
// both, and there's no test enforcing they stay synchronized.
//
// This contract-parity test imports BOTH clients and exercises identical
// fake-fetch scenarios. It pins the cross-layer invariants:
//
//   1. Both POST to ${baseUrl}/ask-claude (path identical).
//   2. Both POST application/json with at minimum {prompt}.
//   3. Both parse 200 → AskClaudeResponse-shaped {response, duration_ms,
//      rate_limit_remaining_hour}.
//   4. Both surface non-2xx as a thrown Error with `.reason` populated from
//      detail.reason (or top-level reason if envelope is flat).
//   5. Both surface scrubber_blocked with `.pattern_class` attached.
//
// Acknowledged behavioral differences (NOT enforced by this test, but
// documented so future drift remains visible):
//   - tools-side reads EMMY_SERVE_URL when baseUrl is unset; ux-side requires
//     baseUrl always. The harness's session.ts wires baseUrl explicitly for
//     ux, while the tool factory falls back to env. This is intentional per
//     CLAUDE.md URL config precedence (env > profile > literal default) but
//     resolved at different layers.
//   - tools-side sends timeout_ms in the JSON body when caller passes it;
//     ux-side never sends timeout_ms (the slash command path defers entirely
//     to the sidecar's default + an outer 120s AbortController on the client).
//   - tools-side has no client-side default timeout; ux-side defaults to
//     120000ms client-side abort.

import { describe, expect, test } from "bun:test";

import { callAskClaudeViaSidecar } from "../src/ask-claude";
// Cross-package import via the workspace path. The two clients are deliberately
// referenced from a single test file so a divergence in either lands as a
// failing assertion here.
import { callAskClaude } from "../../emmy-ux/src/ask-claude-client";

// --------------------------------------------------------------------------
// Shared fake fetch builder — both clients see the same responses.
// --------------------------------------------------------------------------

function makeFakeFetch(opts: {
	status: number;
	body: unknown;
	statusText?: string;
	captureUrl?: { value?: string };
	captureBody?: { value?: string };
	captureMethod?: { value?: string };
}): typeof fetch {
	return (async (url: string | URL | Request, init?: RequestInit) => {
		if (opts.captureUrl) opts.captureUrl.value = String(url);
		if (opts.captureBody && init?.body) {
			opts.captureBody.value = init.body as string;
		}
		if (opts.captureMethod) opts.captureMethod.value = init?.method ?? "GET";
		return new Response(JSON.stringify(opts.body), {
			status: opts.status,
			statusText: opts.statusText,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
}

// --------------------------------------------------------------------------
// Contract: 200 happy path round-trips identically
// --------------------------------------------------------------------------

describe("ask-claude HTTP clients — contract parity (WR-06)", () => {
	test("both clients POST to ${baseUrl}/ask-claude and parse 200 identically", async () => {
		const happyBody = {
			response: "the answer is 4",
			duration_ms: 100,
			rate_limit_remaining_hour: 29,
		};

		// tools-side
		const toolsUrl: { value?: string } = {};
		const toolsBody: { value?: string } = {};
		const toolsMethod: { value?: string } = {};
		const toolsResult = await callAskClaudeViaSidecar("what is 2+2", {
			baseUrl: "http://127.0.0.1:8003",
			fetchImpl: makeFakeFetch({
				status: 200,
				body: happyBody,
				captureUrl: toolsUrl,
				captureBody: toolsBody,
				captureMethod: toolsMethod,
			}),
		});

		// ux-side
		const uxUrl: { value?: string } = {};
		const uxBody: { value?: string } = {};
		const uxMethod: { value?: string } = {};
		const uxResult = await callAskClaude({
			baseUrl: "http://127.0.0.1:8003",
			prompt: "what is 2+2",
			fetchImpl: makeFakeFetch({
				status: 200,
				body: happyBody,
				captureUrl: uxUrl,
				captureBody: uxBody,
				captureMethod: uxMethod,
			}),
		});

		// (1) Same URL path.
		expect(toolsUrl.value).toBe("http://127.0.0.1:8003/ask-claude");
		expect(uxUrl.value).toBe("http://127.0.0.1:8003/ask-claude");

		// (2) Same method.
		expect(toolsMethod.value).toBe("POST");
		expect(uxMethod.value).toBe("POST");

		// (3) Both bodies parse to JSON with at least {prompt}.
		const toolsJson = JSON.parse(toolsBody.value!) as { prompt: string };
		const uxJson = JSON.parse(uxBody.value!) as { prompt: string };
		expect(toolsJson.prompt).toBe("what is 2+2");
		expect(uxJson.prompt).toBe("what is 2+2");

		// (4) Same response shape.
		expect(toolsResult.response).toBe(happyBody.response);
		expect(toolsResult.duration_ms).toBe(happyBody.duration_ms);
		expect(toolsResult.rate_limit_remaining_hour).toBe(
			happyBody.rate_limit_remaining_hour,
		);
		expect(uxResult.response).toBe(happyBody.response);
		expect(uxResult.duration_ms).toBe(happyBody.duration_ms);
		expect(uxResult.rate_limit_remaining_hour).toBe(
			happyBody.rate_limit_remaining_hour,
		);
	});

	// ----------------------------------------------------------------------
	// Contract: trailing slash in baseUrl is stripped by both
	// ----------------------------------------------------------------------

	test("both clients strip trailing slash from baseUrl", async () => {
		const happyBody = {
			response: "ok",
			duration_ms: 1,
			rate_limit_remaining_hour: 1,
		};

		const toolsUrl: { value?: string } = {};
		await callAskClaudeViaSidecar("hi", {
			baseUrl: "http://127.0.0.1:8003/",
			fetchImpl: makeFakeFetch({
				status: 200,
				body: happyBody,
				captureUrl: toolsUrl,
			}),
		});

		const uxUrl: { value?: string } = {};
		await callAskClaude({
			baseUrl: "http://127.0.0.1:8003/",
			prompt: "hi",
			fetchImpl: makeFakeFetch({
				status: 200,
				body: happyBody,
				captureUrl: uxUrl,
			}),
		});

		expect(toolsUrl.value).toBe("http://127.0.0.1:8003/ask-claude");
		expect(uxUrl.value).toBe("http://127.0.0.1:8003/ask-claude");
	});

	// ----------------------------------------------------------------------
	// Contract: scrubber_blocked surfaces with .reason + .pattern_class
	// ----------------------------------------------------------------------

	test("both clients surface scrubber_blocked with reason + pattern_class", async () => {
		const errBody = {
			detail: {
				reason: "scrubber_blocked",
				pattern_class: "aws_access_key_id",
			},
		};

		// tools-side
		let toolsErr: (Error & { reason?: string; pattern_class?: string }) | null =
			null;
		try {
			await callAskClaudeViaSidecar("AKIA...", {
				baseUrl: "http://127.0.0.1:8003",
				fetchImpl: makeFakeFetch({ status: 400, body: errBody }),
			});
			expect.unreachable("tools client should have thrown");
		} catch (e) {
			toolsErr = e as Error & { reason?: string; pattern_class?: string };
		}

		// ux-side
		let uxErr: (Error & { reason?: string; pattern_class?: string }) | null =
			null;
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "AKIA...",
				fetchImpl: makeFakeFetch({ status: 400, body: errBody }),
			});
			expect.unreachable("ux client should have thrown");
		} catch (e) {
			uxErr = e as Error & { reason?: string; pattern_class?: string };
		}

		expect(toolsErr?.reason).toBe("scrubber_blocked");
		expect(toolsErr?.pattern_class).toBe("aws_access_key_id");
		expect(uxErr?.reason).toBe("scrubber_blocked");
		expect(uxErr?.pattern_class).toBe("aws_access_key_id");
	});

	// ----------------------------------------------------------------------
	// Contract: rate-limit reasons surface verbatim from detail.reason
	// ----------------------------------------------------------------------

	test("both clients surface rate_limited_hourly with reason", async () => {
		const errBody = { detail: { reason: "rate_limited_hourly" } };

		let toolsErr: (Error & { reason?: string }) | null = null;
		try {
			await callAskClaudeViaSidecar("hi", {
				baseUrl: "http://127.0.0.1:8003",
				fetchImpl: makeFakeFetch({ status: 429, body: errBody }),
			});
		} catch (e) {
			toolsErr = e as Error & { reason?: string };
		}

		let uxErr: (Error & { reason?: string }) | null = null;
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "hi",
				fetchImpl: makeFakeFetch({ status: 429, body: errBody }),
			});
		} catch (e) {
			uxErr = e as Error & { reason?: string };
		}

		expect(toolsErr?.reason).toBe("rate_limited_hourly");
		expect(uxErr?.reason).toBe("rate_limited_hourly");
	});

	// ----------------------------------------------------------------------
	// Contract: env_disabled (503) surfaces with reason
	// ----------------------------------------------------------------------

	test("both clients surface env_disabled with reason on 503", async () => {
		const errBody = { detail: { reason: "env_disabled" } };

		let toolsErr: (Error & { reason?: string }) | null = null;
		try {
			await callAskClaudeViaSidecar("hi", {
				baseUrl: "http://127.0.0.1:8003",
				fetchImpl: makeFakeFetch({ status: 503, body: errBody }),
			});
		} catch (e) {
			toolsErr = e as Error & { reason?: string };
		}

		let uxErr: (Error & { reason?: string }) | null = null;
		try {
			await callAskClaude({
				baseUrl: "http://127.0.0.1:8003",
				prompt: "hi",
				fetchImpl: makeFakeFetch({ status: 503, body: errBody }),
			});
		} catch (e) {
			uxErr = e as Error & { reason?: string };
		}

		expect(toolsErr?.reason).toBe("env_disabled");
		expect(uxErr?.reason).toBe("env_disabled");
	});
});
