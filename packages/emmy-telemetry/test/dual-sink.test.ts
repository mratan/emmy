// packages/emmy-telemetry/test/dual-sink.test.ts
//
// Plan 03-02 Task 2 (RED). Imports configureTelemetry from ../src/index
// (signature addition; function does not exist yet). Asserts the D-06
// dual-sink contract:
//
//   - emitEvent writes one JSONL line per call to configureTelemetry's
//     jsonlPath AND starts+ends one OTLP-bound span per call via the
//     configured tracer.
//   - If the tracer throws during span creation, the JSONL line STILL
//     appears (OTLP failure never blocks the authoritative sink).
//   - Concurrent emits produce well-formed JSONL (no interleaving).
//   - Without configureTelemetry() (no-op mode) the call is a no-op.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	configureTelemetry,
	emitEvent,
	resetTelemetryContext,
} from "../src/index";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "emmy-dualsink-"));
}

function makeMockTracer(options: { throwOnStartSpan?: boolean } = {}) {
	const starts: string[] = [];
	const ended: Array<{ name: string; attrs: Record<string, unknown> }> = [];
	const tracer = {
		startSpan(name: string) {
			if (options.throwOnStartSpan) throw new Error("OTLP boom");
			starts.push(name);
			const attrs: Record<string, unknown> = {};
			return {
				setAttribute(k: string, v: unknown) {
					attrs[k] = v;
				},
				setAttributes(o: Record<string, unknown>) {
					Object.assign(attrs, o);
				},
				end() {
					ended.push({ name, attrs });
				},
			};
		},
	};
	return { tracer, starts, ended };
}

afterEach(() => {
	resetTelemetryContext();
});

describe("emitEvent dual-sink", () => {
	test("writes one JSONL line + starts one OTLP span per emit", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "events.jsonl");
			const { tracer, ended } = makeMockTracer();
			configureTelemetry({
				jsonlPath: path,
				tracer: tracer as unknown as never,
				enabled: true,
			});
			emitEvent({ event: "a", ts: "T1", profile: { id: "p", version: "v", hash: "h" } });
			emitEvent({ event: "b", ts: "T2" });
			emitEvent({ event: "c", ts: "T3", foo: "bar" });

			const content = readFileSync(path, "utf8");
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(3);
			for (const line of lines) {
				expect(() => JSON.parse(line)).not.toThrow();
			}
			expect(ended.length).toBe(3);
			// Span names follow `emmy.<event>` naming convention
			expect(ended.map((s) => s.name)).toEqual(["emmy.a", "emmy.b", "emmy.c"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("JSONL line still written when tracer.startSpan throws (D-06 invariant)", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "events.jsonl");
			const { tracer } = makeMockTracer({ throwOnStartSpan: true });
			configureTelemetry({
				jsonlPath: path,
				tracer: tracer as unknown as never,
				enabled: true,
			});
			// Must not propagate the tracer error.
			expect(() =>
				emitEvent({ event: "survives", ts: "T", profile: { id: "p", version: "v", hash: "h" } }),
			).not.toThrow();
			const content = readFileSync(path, "utf8");
			expect(content.split("\n").filter((l) => l.length > 0).length).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("no-op path: without configureTelemetry({enabled: true}), emitEvent is silent", () => {
		// Default context is enabled:false after resetTelemetryContext.
		expect(() => emitEvent({ event: "noop", ts: "T" })).not.toThrow();
	});

	test("profile key on the record is flattened into emmy.profile.* span attrs", () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "events.jsonl");
			const { tracer, ended } = makeMockTracer();
			configureTelemetry({
				jsonlPath: path,
				tracer: tracer as unknown as never,
				enabled: true,
			});
			emitEvent({
				event: "test",
				ts: "T",
				profile: { id: "p1", version: "v1", hash: "h1" },
			});
			expect(ended.length).toBe(1);
			const attrs = ended[0]!.attrs;
			expect(attrs["emmy.profile.id"]).toBe("p1");
			expect(attrs["emmy.profile.version"]).toBe("v1");
			expect(attrs["emmy.profile.hash"]).toBe("h1");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("concurrent emit x 50 yields 50 valid JSONL lines", async () => {
		const dir = makeTmpDir();
		try {
			const path = join(dir, "events.jsonl");
			const { tracer } = makeMockTracer();
			configureTelemetry({
				jsonlPath: path,
				tracer: tracer as unknown as never,
				enabled: true,
			});
			await Promise.all(
				Array.from({ length: 50 }, (_, i) =>
					Promise.resolve().then(() => emitEvent({ event: `e${i}`, ts: `T${i}`, i })),
				),
			);
			const content = readFileSync(path, "utf8");
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(50);
			for (const line of lines) {
				expect(() => JSON.parse(line)).not.toThrow();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
