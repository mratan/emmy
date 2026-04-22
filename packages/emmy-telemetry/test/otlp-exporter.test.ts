// packages/emmy-telemetry/test/otlp-exporter.test.ts
//
// Plan 03-02 Task 2 (RED). Imports `initOtel` + `shutdownOtel` from
// ../src/otel-sdk which does not exist yet.
//
// Assertions target (per RESEARCH §Ex 2 and D-06/D-07):
//   - OTLPTraceExporter constructed with url
//     "http://127.0.0.1:3000/api/public/otel/v1/traces"
//   - Authorization header = "Basic " + base64(pk:sk)
//   - x-langfuse-ingestion-version = "4"
//   - When Langfuse is unreachable (fetch HEAD throws), stderr warns
//     "JSONL-only" (boot banner branch per D-06)

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// --- capture OTLPTraceExporter constructor args via module mock ---
interface ExporterArgs {
	url?: string;
	headers?: Record<string, string>;
}
const capturedExporterArgs: ExporterArgs[] = [];
mock.module("@opentelemetry/exporter-trace-otlp-http", () => ({
	OTLPTraceExporter: class MockExporter {
		constructor(args: ExporterArgs) {
			capturedExporterArgs.push(args);
		}
		// Methods the SDK invokes at shutdown / forceFlush time.
		export(_spans: unknown[], cb: (r: { code: number }) => void): void {
			cb({ code: 0 });
		}
		shutdown(): Promise<void> {
			return Promise.resolve();
		}
		forceFlush(): Promise<void> {
			return Promise.resolve();
		}
	},
}));

// Mock the minimum sdk-node surface initOtel uses.
mock.module("@opentelemetry/sdk-node", () => ({
	NodeSDK: class MockSDK {
		start(): void {}
		shutdown(): Promise<void> {
			return Promise.resolve();
		}
	},
}));

// --- capture fetch calls for the reachability probe ---
let fetchBehavior: "ok" | "throw" = "ok";
let capturedFetchCalls: Array<{ url: string | URL; init?: RequestInit }> = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
	capturedExporterArgs.length = 0;
	capturedFetchCalls.length = 0;
	globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
		capturedFetchCalls.push({ url, init });
		if (fetchBehavior === "throw") throw new Error("ECONNREFUSED");
		return new Response("", { status: 200 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	fetchBehavior = "ok";
});

import { initOtel, shutdownOtel } from "../src/otel-sdk";

describe("initOtel", () => {
	test("constructs OTLPTraceExporter with Langfuse OTLP URL + Basic auth + ingestion version header", async () => {
		fetchBehavior = "ok";
		const sdk = await initOtel({
			langfusePublicKey: "pk-lf-test",
			langfuseSecretKey: "sk-lf-test",
			profile: { id: "p", version: "v", hash: "h" },
			enabled: true,
		});
		expect(sdk).not.toBeNull();
		expect(capturedExporterArgs.length).toBe(1);
		const args = capturedExporterArgs[0]!;
		expect(args.url).toBe("http://127.0.0.1:3000/api/public/otel/v1/traces");
		expect(args.headers).toBeDefined();
		const headers = args.headers ?? {};
		expect(headers["x-langfuse-ingestion-version"]).toBe("4");
		const expectedAuth = `Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`;
		expect(headers["Authorization"]).toBe(expectedAuth);
		await shutdownOtel(sdk);
	});

	test("warns 'JSONL-only' on stderr when Langfuse reachability probe throws", async () => {
		fetchBehavior = "throw";
		const orig = console.error;
		const errs: string[] = [];
		console.error = (...args: unknown[]) => {
			errs.push(args.map(String).join(" "));
		};
		try {
			const sdk = await initOtel({
				langfusePublicKey: "pk",
				langfuseSecretKey: "sk",
				profile: { id: "p", version: "v", hash: "h" },
				enabled: true,
			});
			expect(sdk).not.toBeNull();
			await shutdownOtel(sdk);
		} finally {
			console.error = orig;
		}
		const joined = errs.join("\n");
		expect(joined).toMatch(/JSONL-only/);
	});

	test("honors custom langfuseBaseUrl (must still only use loopback per T-03-02-02)", async () => {
		fetchBehavior = "ok";
		const sdk = await initOtel({
			langfusePublicKey: "pk",
			langfuseSecretKey: "sk",
			profile: { id: "p", version: "v", hash: "h" },
			enabled: true,
			langfuseBaseUrl: "http://127.0.0.1:3100",
		});
		expect(capturedExporterArgs[0]!.url).toBe("http://127.0.0.1:3100/api/public/otel/v1/traces");
		await shutdownOtel(sdk);
	});
});
