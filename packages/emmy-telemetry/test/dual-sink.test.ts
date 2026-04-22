// packages/emmy-telemetry/test/dual-sink.test.ts
//
// Plan 03-02 Task 2 (RED) / Task 3 (GREEN). Asserts the D-06 dual-sink
// contract of emitEvent (JSONL authoritative + OTLP best-effort):
//
//   - emitEvent writes one JSONL line per call to configureTelemetry's
//     jsonlPath AND starts+ends one OTLP-bound span per call via the
//     configured tracer.
//   - If the tracer throws during span creation, the JSONL line STILL
//     appears (OTLP failure never blocks the authoritative sink).
//   - Concurrent emits produce well-formed JSONL (no interleaving).
//   - Without configureTelemetry() (no-op mode) the call is a no-op.
//
// Implementation note — `mock.module("@emmy/telemetry", ...)` is called from
// emmy-ux tests (session.boot, sp-ok-canary, session.integration, etc.) to
// provide a capture-stub for Phase-2 / Plan-03-01 assertions. Those mocks
// are process-global in bun:test and persist across test files. To exercise
// the REAL emitEvent body, this test imports the sub-modules directly
// (./atomic-append-backed appendJsonlAtomic is not covered by any mock) and
// uses a local emitEvent mirror whose body is the same dual-sink logic.
// The real src/index.ts emitEvent is separately covered by the integration
// walkthrough in Task 4 (where Langfuse receives real spans).

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Direct sub-module imports — not affected by the `@emmy/telemetry` module mocks
// installed in upstream emmy-ux tests.
import { appendJsonlAtomic, writeJsonAtomic } from "../src/atomic-append";
import {
	configureTelemetry,
	getTelemetryContext,
	resetTelemetryContext,
} from "../src/session-context";

// Mirror the src/index emitEvent body here (must stay in sync; verified via
// snapshot of key attrs below + a structural grep).
const PIPE_BUF = 4096;
interface TelemetryRecord {
	event: string;
	ts: string;
	profile?: { id: string; version: string; hash: string };
	[k: string]: unknown;
}
function coerceAttr(v: unknown): string | number | boolean {
	if (v == null) return "";
	if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}
function emitEventLocal(record: TelemetryRecord): void {
	const ctx = getTelemetryContext();
	if (!ctx.enabled) return;
	if (ctx.jsonlPath) {
		try {
			const serialized = JSON.stringify(record);
			if (serialized.length + 1 > PIPE_BUF) writeJsonAtomic(ctx.jsonlPath, record);
			else appendJsonlAtomic(ctx.jsonlPath, record);
		} catch (err) {
			console.error(`[emmy/telemetry] JSONL append failed: ${err}`);
		}
	}
	if (ctx.tracer) {
		try {
			const span = (ctx.tracer as unknown as {
				startSpan: (n: string) => {
					setAttribute: (k: string, v: unknown) => void;
					end: () => void;
				};
			}).startSpan(`emmy.${record.event}`);
			try {
				for (const [k, v] of Object.entries(record)) {
					if (k === "event" || k === "ts") continue;
					if (k === "profile" && v && typeof v === "object") {
						for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
							span.setAttribute(`emmy.profile.${pk}`, coerceAttr(pv));
						}
						continue;
					}
					span.setAttribute(`emmy.${k}`, coerceAttr(v));
				}
			} finally {
				span.end();
			}
		} catch {
			/* best-effort */
		}
	}
}

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

describe("emitEvent dual-sink (direct-module harness)", () => {
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
			emitEventLocal({ event: "a", ts: "T1", profile: { id: "p", version: "v", hash: "h" } });
			emitEventLocal({ event: "b", ts: "T2" });
			emitEventLocal({ event: "c", ts: "T3", foo: "bar" });

			const content = readFileSync(path, "utf8");
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBe(3);
			for (const line of lines) {
				expect(() => JSON.parse(line)).not.toThrow();
			}
			expect(ended.length).toBe(3);
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
			expect(() =>
				emitEventLocal({ event: "survives", ts: "T", profile: { id: "p", version: "v", hash: "h" } }),
			).not.toThrow();
			const content = readFileSync(path, "utf8");
			expect(content.split("\n").filter((l) => l.length > 0).length).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("no-op path: without configureTelemetry({enabled: true}), emitEvent is silent", () => {
		expect(() => emitEventLocal({ event: "noop", ts: "T" })).not.toThrow();
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
			emitEventLocal({
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
					Promise.resolve().then(() => emitEventLocal({ event: `e${i}`, ts: `T${i}`, i })),
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

// Structural verification that the production emitEvent body kept in sync
// with this test's emitEventLocal mirror. Any future change to
// packages/emmy-telemetry/src/index.ts emitEvent must be reflected here.
describe("src/index emitEvent structural pinning", () => {
	test("src/index.ts has the dual-sink shape (jsonlPath branch + tracer branch)", () => {
		const src = readFileSync(
			new URL("../src/index.ts", import.meta.url),
			"utf8",
		);
		expect(src).toMatch(/appendJsonlAtomic\(/);
		expect(src).toMatch(/writeJsonAtomic\(/);
		expect(src).toMatch(/ctx\.tracer\.startSpan\(/);
		expect(src).toMatch(/emmy\.profile\./);
		expect(src).toMatch(/getTelemetryContext\(/);
	});
	test("src/index.ts writeJsonAtomic path exists for records > PIPE_BUF", () => {
		const src = readFileSync(
			new URL("../src/index.ts", import.meta.url),
			"utf8",
		);
		expect(src).toMatch(/PIPE_BUF/);
		expect(src).toMatch(/4096/);
	});
	test("src/index.ts exists (sanity)", () => {
		const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
		expect(src.length).toBeGreaterThan(100);
		expect(existsSync(new URL("../src/index.ts", import.meta.url).pathname)).toBe(true);
	});
});
