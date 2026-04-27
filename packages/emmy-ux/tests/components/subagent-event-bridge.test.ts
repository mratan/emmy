// Phase 04.5 Plan 05 Task 1 — subagent-event-bridge regression suite.

import { describe, expect, test } from "bun:test";
import { subscribeChildSession, type ChildEventSnapshot } from "../../src/components/subagent-event-bridge";

interface FakeSession {
	subscribe: (h: (e: any) => void) => () => void;
	fire: (evt: any) => void;
	handlerCount: () => number;
}

function makeFakeSession(): FakeSession {
	const handlers: Array<(e: any) => void> = [];
	return {
		subscribe(h) {
			handlers.push(h);
			return () => {
				const i = handlers.indexOf(h);
				if (i >= 0) handlers.splice(i, 1);
			};
		},
		fire(evt) {
			for (const h of handlers) h(evt);
		},
		handlerCount: () => handlers.length,
	};
}

describe("subscribeChildSession — pi event capture", () => {
	test("Test 1 — tool_call_start adds a running turn", () => {
		const session = makeFakeSession();
		const updates: ChildEventSnapshot[] = [];
		subscribeChildSession(session, "research", "find usages", (s) => updates.push(s));
		session.fire({
			type: "tool_call_start",
			toolCallId: "call-1",
			toolName: "read",
			args: { path: "/tmp/x" },
		});
		expect(updates.length).toBe(1);
		expect(updates[0].turns.length).toBe(1);
		expect(updates[0].turns[0].toolName).toBe("read");
		expect(updates[0].turns[0].status).toBe("running");
		expect(updates[0].turns[0].argsPreview).toContain("/tmp/x");
	});

	test("Test 2 — tool_call_end with output marks turn ok + populates result preview", () => {
		const session = makeFakeSession();
		const updates: ChildEventSnapshot[] = [];
		subscribeChildSession(session, "research", "x", (s) => updates.push(s));
		session.fire({
			type: "tool_call_start",
			toolCallId: "call-1",
			toolName: "read",
			args: {},
		});
		session.fire({
			type: "tool_call_end",
			toolCallId: "call-1",
			result: { output: "file contents", ok: true },
		});
		expect(updates.length).toBe(2);
		const last = updates[updates.length - 1];
		expect(last.turns[0].status).toBe("ok");
		expect(last.turns[0].resultPreview).toContain("file contents");
	});

	test("Test 3 — tool_call_end with error marks status='error'", () => {
		const session = makeFakeSession();
		const updates: ChildEventSnapshot[] = [];
		subscribeChildSession(session, "research", "x", (s) => updates.push(s));
		session.fire({
			type: "tool_call_start",
			toolCallId: "call-1",
			toolName: "read",
			args: {},
		});
		session.fire({
			type: "tool_call_end",
			toolCallId: "call-1",
			result: { ok: false, error: "ENOENT" },
		});
		const last = updates[updates.length - 1];
		expect(last.turns[0].status).toBe("error");
	});

	test("Test 4 — agent_end sets done=true and captures finalText from last assistant message", () => {
		const session = makeFakeSession();
		const updates: ChildEventSnapshot[] = [];
		subscribeChildSession(session, "research", "x", (s) => updates.push(s));
		session.fire({
			type: "agent_end",
			messages: [
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "answer part 1 " },
						{ type: "text", text: "answer part 2" },
					],
				},
			],
		});
		const last = updates[updates.length - 1];
		expect(last.done).toBe(true);
		expect(last.finalText).toBe("answer part 1 answer part 2");
	});

	test("Test 5 — preview truncation to LOCKED widths (60 / 80 / 200)", () => {
		const session = makeFakeSession();
		const updates: ChildEventSnapshot[] = [];
		const longPrompt = "x".repeat(120);
		const longArgs = "y".repeat(120);
		const longResult = "z".repeat(300);
		subscribeChildSession(session, "research", longPrompt, (s) => updates.push(s));
		session.fire({
			type: "tool_call_start",
			toolCallId: "call-1",
			toolName: "read",
			args: { path: longArgs },
		});
		session.fire({
			type: "tool_call_end",
			toolCallId: "call-1",
			result: { output: longResult, ok: true },
		});
		const last = updates[updates.length - 1];
		expect(last.promptPreview.length).toBeLessThanOrEqual(60);
		expect(last.promptPreview.endsWith("…")).toBe(true);
		expect(last.turns[0].argsPreview.length).toBeLessThanOrEqual(80);
		expect(last.turns[0].argsPreview.endsWith("…")).toBe(true);
		expect(last.turns[0].resultPreview.length).toBeLessThanOrEqual(200);
		expect(last.turns[0].resultPreview.endsWith("…")).toBe(true);
	});

	test("Test 6 — unsubscribe stops further onUpdate calls", () => {
		const session = makeFakeSession();
		const updates: ChildEventSnapshot[] = [];
		const unsub = subscribeChildSession(session, "research", "x", (s) => updates.push(s));
		session.fire({ type: "tool_call_start", toolCallId: "call-1", toolName: "read", args: {} });
		expect(updates.length).toBe(1);
		unsub();
		session.fire({ type: "tool_call_end", toolCallId: "call-1", result: { output: "x", ok: true } });
		// No new update after unsub.
		expect(updates.length).toBe(1);
		expect(session.handlerCount()).toBe(0);
	});
});
