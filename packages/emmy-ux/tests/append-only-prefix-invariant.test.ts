// Plan 04.4-06 Task 2 — V3 integration test for the append-only-prefix
// invariant. Drives the before_provider_request handler with a synthetic
// conversation grown across multiple turns and a mocked compaction event;
// asserts emmy.prefix.hash stays byte-equal across every non-canary request.

import {
	beforeAll,
	beforeEach,
	afterEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureTelemetry, resetTelemetryContext } from "@emmy/telemetry";

import { createEmmyExtension } from "../src/pi-emmy-extension";
import type { ProfileSnapshot } from "@emmy/provider";

function makeProfile(path: string): ProfileSnapshot {
	return {
		ref: {
			id: "qwen3.6-35b-a3b",
			version: "v3.1",
			hash: "sha256:b91e74730c6460be1454c857dd64459eea3754ef5844de15e7a42e691cb21913",
			path,
		},
		serving: {
			engine: {
				served_model_name: "qwen-test",
				max_model_len: 131072,
			},
			sampling_defaults: {
				temperature: 0.2,
				top_p: 0.95,
				max_tokens: 8192,
				stop: [],
			},
			quirks: {
				strip_thinking_tags: false,
				promote_reasoning_to_content: false,
				buffer_tool_streams: false,
			},
		},
		harness: {
			tools: { format: "openai", grammar: null, per_tool_sampling: {} },
			agent_loop: { retry_on_unparseable_tool_call: 2 },
		},
	};
}

interface HandlerRecord {
	event: string;
	handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
}

function makeMockPi(): {
	api: unknown;
	handlers: HandlerRecord[];
} {
	const handlers: HandlerRecord[] = [];
	const api = {
		on: (
			event: string,
			handler: (e: unknown, c: unknown) => Promise<unknown> | unknown,
		) => {
			handlers.push({ event, handler });
		},
		registerTool: () => undefined,
		registerCommand: () => undefined,
		registerShortcut: () => undefined,
		registerFlag: () => undefined,
		getFlag: () => undefined,
		registerMessageRenderer: () => undefined,
		sendMessage: () => undefined,
		sendUserMessage: () => undefined,
	};
	return { api, handlers };
}

function getBeforeProviderHandler(
	handlers: HandlerRecord[],
): (event: unknown, ctx: unknown) => Promise<unknown> | unknown {
	const h = handlers.find((r) => r.event === "before_provider_request");
	if (!h) throw new Error("before_provider_request handler not registered");
	return h.handler;
}

let tmp: string;
let jsonlPath: string;
let profileDir: string;

beforeAll(() => {
	tmp = mkdtempSync(join(tmpdir(), "emmy-prefix-inv-"));
	profileDir = join(tmp, "profile");
	mkdirSync(profileDir, { recursive: true });
});

beforeEach(() => {
	jsonlPath = join(tmp, `events-${Date.now()}-${Math.random()}.jsonl`);
	configureTelemetry({
		jsonlPath,
		tracer: undefined,
		enabled: true,
	});
});

afterEach(() => {
	resetTelemetryContext();
});

function readEvents(path: string): Array<Record<string, unknown>> {
	try {
		const fs = require("node:fs");
		const text = fs.readFileSync(path, "utf8");
		return text
			.split("\n")
			.filter((l: string) => l.length > 0)
			.map((l: string) => JSON.parse(l));
	} catch {
		return [];
	}
}

const SNAP = {
	text: "system\nAGENTS.md\nproject preamble\n",
	sha256: "deadbeef",
};

function instantiate(): {
	handlers: HandlerRecord[];
} {
	const ext = createEmmyExtension({
		profile: makeProfile(profileDir),
		assembledPromptProvider: () => SNAP,
		// session.ts plumbing not needed for handler unit test
	});
	const { api, handlers } = makeMockPi();
	ext(api as never);
	return { handlers };
}

const SYSTEM_MSG = { role: "system", content: "you are emmy" };
const PREAMBLE = { role: "user", content: "AGENTS.md\nproject preamble" };

describe("V3 — append-only-prefix invariant integration", () => {
	test("emits compaction.prefix_hash on every non-canary request", async () => {
		const { handlers } = instantiate();
		const handler = getBeforeProviderHandler(handlers);
		await handler(
			{
				payload: {
					model: "m",
					messages: [SYSTEM_MSG, PREAMBLE, { role: "user", content: "u1" }],
				},
			},
			{ signal: undefined },
		);
		const events = readEvents(jsonlPath);
		const prefix = events.filter(
			(e) => e.event === "compaction.prefix_hash",
		);
		expect(prefix.length).toBe(1);
		expect((prefix[0] as { "emmy.prefix.hash"?: string })["emmy.prefix.hash"])
			.toMatch(/^[0-9a-f]{64}$/);
	});

	test("hash byte-equal across turn 0, 5, 10 (V3 core property)", async () => {
		const { handlers } = instantiate();
		const handler = getBeforeProviderHandler(handlers);

		// Turn 0: just system + preamble + user1
		await handler(
			{
				payload: {
					model: "m",
					messages: [SYSTEM_MSG, PREAMBLE, { role: "user", content: "u1" }],
				},
			},
			{ signal: undefined },
		);

		// Turn 5: 5 user/assistant exchanges
		await handler(
			{
				payload: {
					model: "m",
					messages: [
						SYSTEM_MSG,
						PREAMBLE,
						{ role: "user", content: "u1" },
						{ role: "assistant", content: "a1" },
						{ role: "user", content: "u2" },
						{ role: "assistant", content: "a2" },
						{ role: "user", content: "u3" },
						{ role: "assistant", content: "a3" },
						{ role: "user", content: "u4" },
						{ role: "assistant", content: "a4" },
						{ role: "user", content: "u5" },
					],
				},
			},
			{ signal: undefined },
		);

		// Turn 10 (post-compaction simulation): body has been compacted to a
		// single summary message but system + preamble unchanged.
		await handler(
			{
				payload: {
					model: "m",
					messages: [
						SYSTEM_MSG,
						PREAMBLE,
						{ role: "user", content: "u1" },
						{ role: "assistant", content: "[summary of turns 1-9]" },
						{ role: "user", content: "u10" },
					],
				},
			},
			{ signal: undefined },
		);

		const events = readEvents(jsonlPath);
		const prefix = events.filter(
			(e) => e.event === "compaction.prefix_hash",
		);
		expect(prefix.length).toBe(3);
		const hashes = prefix.map(
			(e) => (e as { "emmy.prefix.hash": string })["emmy.prefix.hash"],
		);
		expect(hashes[0]).toBe(hashes[1]);
		expect(hashes[1]).toBe(hashes[2]);
	});

	test("SP_OK canary requests skip compaction.prefix_hash emission", async () => {
		const { handlers } = instantiate();
		const handler = getBeforeProviderHandler(handlers);
		await handler(
			{
				payload: {
					model: "m",
					messages: [SYSTEM_MSG, { role: "user", content: "ping" }],
					emmy: { is_sp_ok_canary: true },
				},
			},
			{ signal: undefined },
		);
		const events = readEvents(jsonlPath);
		const prefix = events.filter(
			(e) => e.event === "compaction.prefix_hash",
		);
		expect(prefix.length).toBe(0);
	});

	test("regression case: mutating prompt-provider mid-session produces hash drift", async () => {
		// The 3-layer assembled prompt is what actually flows on the wire (the
		// before_provider_request handler rewrites payload.messages[0].content
		// from the assembledPromptProvider snapshot). To simulate a D-3X
		// violation we have to flip the provider's snapshot between calls — if
		// any code path were to do that mid-session, the prefix hash would
		// drift, which is the alarm we want.
		let snap = SNAP;
		const ext = createEmmyExtension({
			profile: makeProfile(profileDir),
			assembledPromptProvider: () => snap,
		});
		const { api, handlers } = makeMockPi();
		ext(api as never);
		const handler = getBeforeProviderHandler(handlers);
		await handler(
			{
				payload: {
					model: "m",
					messages: [SYSTEM_MSG, { role: "user", content: "u1" }],
				},
			},
			{ signal: undefined },
		);
		// Simulate a forbidden mid-session prefix mutation (e.g. someone
		// reloaded a different system prompt without bumping session id).
		snap = { text: "MUTATED system prompt", sha256: "feedface" };
		await handler(
			{
				payload: {
					model: "m",
					messages: [SYSTEM_MSG, { role: "user", content: "u1" }],
				},
			},
			{ signal: undefined },
		);
		const events = readEvents(jsonlPath);
		const prefix = events.filter(
			(e) => e.event === "compaction.prefix_hash",
		);
		expect(prefix.length).toBe(2);
		const a = (prefix[0] as { "emmy.prefix.hash": string })[
			"emmy.prefix.hash"
		];
		const b = (prefix[1] as { "emmy.prefix.hash": string })[
			"emmy.prefix.hash"
		];
		expect(a).not.toBe(b); // drift detected — V3 violation indicator
	});

	test("body-only growth after compaction does NOT change hash (V3 invariant)", async () => {
		const { handlers } = instantiate();
		const handler = getBeforeProviderHandler(handlers);
		const baseMsgs = [
			SYSTEM_MSG,
			{ role: "user", content: "u1" },
			{ role: "assistant", content: "a1" },
		];
		await handler(
			{ payload: { model: "m", messages: baseMsgs } },
			{ signal: undefined },
		);
		await handler(
			{
				payload: {
					model: "m",
					messages: [
						...baseMsgs,
						{ role: "user", content: "u2" },
						{ role: "assistant", content: "a2" },
						{ role: "tool", content: "t1" },
					],
				},
			},
			{ signal: undefined },
		);
		const events = readEvents(jsonlPath);
		const prefix = events.filter(
			(e) => e.event === "compaction.prefix_hash",
		);
		expect(prefix.length).toBe(2);
		const a = (prefix[0] as { "emmy.prefix.hash": string })[
			"emmy.prefix.hash"
		];
		const b = (prefix[1] as { "emmy.prefix.hash": string })[
			"emmy.prefix.hash"
		];
		expect(a).toBe(b);
	});

	test("session.id and turn.id propagate when present in payload.emmy", async () => {
		const { handlers } = instantiate();
		const handler = getBeforeProviderHandler(handlers);
		await handler(
			{
				payload: {
					model: "m",
					messages: [SYSTEM_MSG, { role: "user", content: "u" }],
					emmy: { session_id: "sess-42", turn_id: "sess-42:7" },
				},
			},
			{ signal: undefined },
		);
		const events = readEvents(jsonlPath);
		const prefix = events.filter(
			(e) => e.event === "compaction.prefix_hash",
		);
		expect(prefix.length).toBe(1);
		const e = prefix[0] as Record<string, string>;
		expect(e["emmy.session.id"]).toBe("sess-42");
		expect(e["emmy.turn.id"]).toBe("sess-42:7");
	});
});
