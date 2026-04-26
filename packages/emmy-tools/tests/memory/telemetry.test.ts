// Plan 04.4-04 Task 1 — telemetry hook + redaction + counters tests.

import { describe, expect, test } from "bun:test";
import {
	buildMemoryTelemetryHook,
	redactBlockedArgs,
	MemoryTelemetryCounters,
} from "../../src/memory/telemetry";
import type { MemoryOpEvent } from "../../src/memory/types";

describe("buildMemoryTelemetryHook", () => {
	test("fires emitEvent once per call with event='memory.op'", () => {
		const events: Array<{ event: string; [k: string]: unknown }> = [];
		const hook = buildMemoryTelemetryHook({
			emitEvent: (rec) => events.push(rec),
			blockedExtensions: [".env"],
		});
		hook({
			command: "view",
			scope: "project",
			path: "/memories/project/x.md",
			result: "ok",
		});
		expect(events.length).toBe(1);
		expect(events[0].event).toBe("memory.op");
	});

	test("emitted record carries OTel attributes", () => {
		const events: Array<{ [k: string]: unknown }> = [];
		const hook = buildMemoryTelemetryHook({
			emitEvent: (rec) => events.push(rec),
			blockedExtensions: [],
		});
		hook({
			command: "create",
			scope: "global",
			path: "/memories/global/a.md",
			result: "ok",
			bytes: 42,
		});
		const e = events[0];
		expect(e["gen_ai.tool.name"]).toBe("memory");
		expect(e["emmy.memory.command"]).toBe("create");
		expect(e["emmy.memory.scope"]).toBe("global");
		expect(e["emmy.memory.path"]).toBe("/memories/global/a.md");
		expect(e["emmy.memory.result"]).toBe("ok");
		expect(e["emmy.memory.bytes"]).toBe(42);
	});

	test("emmy.memory.bytes only present when bytes is a number", () => {
		const events: Array<{ [k: string]: unknown }> = [];
		const hook = buildMemoryTelemetryHook({
			emitEvent: (rec) => events.push(rec),
			blockedExtensions: [],
		});
		hook({
			command: "delete",
			scope: "project",
			path: "/memories/project/x.md",
			result: "ok",
		});
		expect(events[0]["emmy.memory.bytes"]).toBeUndefined();
	});

	test("argsForOp is redacted before serialization", () => {
		const events: Array<{ [k: string]: unknown }> = [];
		const hook = buildMemoryTelemetryHook({
			emitEvent: (rec) => events.push(rec),
			blockedExtensions: [".env"],
			argsForOp: () => ({
				command: "create",
				path: "/memories/project/secrets.env",
				file_text: "SECRET=topsecret",
			}),
		});
		hook({
			command: "create",
			scope: "project",
			path: "/memories/project/secrets.env",
			result: "ok",
		});
		const args = JSON.parse(
			events[0]["gen_ai.tool.call.arguments"] as string,
		);
		expect(args.file_text).toContain("REDACTED");
		expect(args.file_text).not.toContain("topsecret");
	});
});

describe("redactBlockedArgs", () => {
	test("redacts file_text on blocked-extension path", () => {
		const out = redactBlockedArgs(
			{
				command: "create",
				path: "/memories/project/secrets.env",
				file_text: "SECRET=topsecret",
			},
			[".env"],
		);
		expect(out.file_text).toBe("[REDACTED — blocked extension .env]");
		expect(out.path).toBe("/memories/project/secrets.env");
		expect(out.command).toBe("create");
	});

	test("preserves non-text fields untouched", () => {
		const out = redactBlockedArgs(
			{
				command: "view",
				path: "/memories/project/secrets.key",
				view_range: [1, 5],
			},
			[".key"],
		);
		expect(out.command).toBe("view");
		expect(out.path).toBe("/memories/project/secrets.key");
		expect(out.view_range).toEqual([1, 5]);
	});

	test("no-op for non-blocked-extension paths", () => {
		const original = {
			command: "create",
			path: "/memories/project/notes.md",
			file_text: "hello",
		};
		const out = redactBlockedArgs(original, [".env"]);
		expect(out.file_text).toBe("hello");
	});

	test("redacts old_str + new_str on blocked-extension paths", () => {
		const out = redactBlockedArgs(
			{
				command: "str_replace",
				path: "/memories/project/x.pem",
				old_str: "-----BEGIN",
				new_str: "-----BEGIN UPDATED",
			},
			[".pem"],
		);
		expect(out.old_str).toContain("REDACTED");
		expect(out.new_str).toContain("REDACTED");
	});
});

describe("MemoryTelemetryCounters", () => {
	test("snapshot starts at zero", () => {
		const c = new MemoryTelemetryCounters();
		const s = c.snapshot();
		expect(s).toEqual({
			view: 0,
			create: 0,
			str_replace: 0,
			insert: 0,
			delete: 0,
			rename: 0,
			bytes_read: 0,
			bytes_written: 0,
		});
	});

	test("accumulates per-command counts", () => {
		const c = new MemoryTelemetryCounters();
		c.record({
			command: "view",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 100,
		});
		c.record({
			command: "view",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 50,
		});
		c.record({
			command: "view",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 25,
		});
		c.record({
			command: "create",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 100,
		});
		c.record({
			command: "str_replace",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 50,
		});
		c.record({
			command: "str_replace",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 75,
		});
		const s = c.snapshot();
		expect(s.view).toBe(3);
		expect(s.create).toBe(1);
		expect(s.str_replace).toBe(2);
	});

	test("bytes_read sums view + str_replace bytes", () => {
		const c = new MemoryTelemetryCounters();
		c.record({
			command: "view",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 100,
		});
		c.record({
			command: "str_replace",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 50,
		});
		expect(c.snapshot().bytes_read).toBe(150);
	});

	test("bytes_written sums create + str_replace + insert bytes", () => {
		const c = new MemoryTelemetryCounters();
		c.record({
			command: "create",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 100,
		});
		c.record({
			command: "str_replace",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 50,
		});
		c.record({
			command: "insert",
			scope: "project",
			path: "/x",
			result: "ok",
			bytes: 25,
		});
		expect(c.snapshot().bytes_written).toBe(175);
	});

	test("does not accumulate bytes on error results", () => {
		const c = new MemoryTelemetryCounters();
		c.record({
			command: "create",
			scope: "project",
			path: "/x",
			result: "exists",
			bytes: 100,
		});
		expect(c.snapshot().bytes_written).toBe(0);
		expect(c.snapshot().create).toBe(1); // count still increments
	});
});
