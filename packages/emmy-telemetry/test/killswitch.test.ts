// packages/emmy-telemetry/test/killswitch.test.ts
//
// Plan 03-02 Task 2 (RED). Exercises the EMMY_TELEMETRY=off and
// --no-telemetry kill-switches (D-08 + threat T-03-02-05 accept).
//
// Contract:
//   resolveTelemetryEnabled({env, argv}) -> boolean
//     - env.EMMY_TELEMETRY === "off" -> false
//     - argv.includes("--no-telemetry") -> false
//     - otherwise -> true
//
//   initOtel({enabled: false}) -> null AND logs "OBSERVABILITY: OFF" to stderr
//
//   After configureTelemetry({enabled: false}), emitEvent is a no-op (no
//   JSONL line is written even if jsonlPath is set).

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock @opentelemetry/exporter-trace-otlp-http + sdk-node so we don't pull a
// real SDK during killswitch tests.
mock.module("@opentelemetry/exporter-trace-otlp-http", () => ({
	OTLPTraceExporter: class {
		constructor(_args: unknown) {}
		shutdown(): Promise<void> {
			return Promise.resolve();
		}
	},
}));
mock.module("@opentelemetry/sdk-node", () => ({
	NodeSDK: class {
		start(): void {}
		shutdown(): Promise<void> {
			return Promise.resolve();
		}
	},
}));

import { configureTelemetry, emitEvent, resetTelemetryContext } from "../src/index";
import { initOtel, resolveTelemetryEnabled } from "../src/otel-sdk";

afterEach(() => {
	resetTelemetryContext();
});

describe("resolveTelemetryEnabled", () => {
	test("env.EMMY_TELEMETRY === 'off' -> false", () => {
		expect(
			resolveTelemetryEnabled({ env: { EMMY_TELEMETRY: "off" }, argv: [] }),
		).toBe(false);
	});

	test("argv includes '--no-telemetry' -> false", () => {
		expect(resolveTelemetryEnabled({ env: {}, argv: ["--no-telemetry"] })).toBe(
			false,
		);
	});

	test("env.EMMY_TELEMETRY === 'on' -> true (default on)", () => {
		expect(
			resolveTelemetryEnabled({ env: { EMMY_TELEMETRY: "on" }, argv: [] }),
		).toBe(true);
	});

	test("empty env and argv -> true (default on per D-08)", () => {
		expect(resolveTelemetryEnabled({ env: {}, argv: [] })).toBe(true);
	});

	test("argv with unrelated flags and no --no-telemetry -> true", () => {
		expect(
			resolveTelemetryEnabled({
				env: {},
				argv: ["--profile", "foo", "--base-url", "bar"],
			}),
		).toBe(true);
	});
});

describe("initOtel({enabled: false})", () => {
	test("returns null AND writes 'OBSERVABILITY: OFF' to stderr", async () => {
		const orig = console.error;
		const errs: string[] = [];
		console.error = (...args: unknown[]) => {
			errs.push(args.map(String).join(" "));
		};
		try {
			const sdk = await initOtel({
				langfusePublicKey: "",
				langfuseSecretKey: "",
				profile: { id: "p", version: "v", hash: "h" },
				enabled: false,
			});
			expect(sdk).toBeNull();
		} finally {
			console.error = orig;
		}
		expect(errs.join("\n")).toMatch(/OBSERVABILITY: OFF/);
	});
});

describe("emitEvent after configureTelemetry({enabled: false})", () => {
	test("no JSONL line written even if jsonlPath is set", () => {
		const dir = mkdtempSync(join(tmpdir(), "emmy-killswitch-"));
		try {
			const path = join(dir, "events.jsonl");
			configureTelemetry({ jsonlPath: path, tracer: null, enabled: false });
			emitEvent({ event: "should-not-write", ts: "T" });
			expect(existsSync(path)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
