// packages/emmy-telemetry/src/otel-sdk.ts
//
// Phase 3 Plan 03-02 Task 3 (GREEN) — OTel SDK initialization.
//
// Verbatim-adapted from RESEARCH §Ex 2 (lines 722-777):
//   - @opentelemetry/sdk-node's NodeSDK with resource {service.name: "emmy"}
//   - BatchSpanProcessor(OTLPTraceExporter) as the export-bound processor
//   - EmmyProfileStampProcessor as the FIRST processor in the pipeline so
//     onStart stamping runs before any exporter sees the span
//   - Langfuse OTLP endpoint at http://127.0.0.1:3000/api/public/otel/v1/traces
//   - Auth: Basic base64(pk:sk) + x-langfuse-ingestion-version: 4
//     (langfuse.com/integrations/native/opentelemetry, verified 2026-04-21)
//
// Kill-switch (D-08 + T-03-02-05 accept):
//   - EMMY_TELEMETRY=off -> resolveTelemetryEnabled returns false
//   - --no-telemetry in argv -> resolveTelemetryEnabled returns false
//   - Passing {enabled: false} to initOtel returns null and logs
//     "OBSERVABILITY: OFF" to stderr
//
// Loopback reachability probe (D-06 boot banner differentiation):
//   After sdk.start(), we do a HEAD probe against langfuseBaseUrl with a
//   2-second AbortSignal.timeout. Success -> "OBSERVABILITY: ON - JSONL +
//   Langfuse OTLP (Langfuse responded <status>)". Failure -> "OBSERVABILITY:
//   JSONL-only (Langfuse unreachable at <url>)". The SDK itself keeps trying
//   to export on BatchSpanProcessor's schedule; the probe is purely for the
//   boot banner.

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { EmmyProfileStampProcessor } from "./profile-stamp-processor";

export interface InitOtelOpts {
	langfusePublicKey: string;
	langfuseSecretKey: string;
	profile: { id: string; version: string; hash: string };
	enabled: boolean;
	/** Default: http://127.0.0.1:3000 (loopback, T-03-02-02 mitigation). */
	langfuseBaseUrl?: string;
}

/**
 * Resolve telemetry-enabled flag from process env + argv. Pure function; no
 * IO. Called at pi-emmy.ts boot before initOtel.
 */
export function resolveTelemetryEnabled(opts: {
	env: Record<string, string | undefined>;
	argv: string[];
}): boolean {
	if (opts.env.EMMY_TELEMETRY === "off") return false;
	if (opts.argv.includes("--no-telemetry")) return false;
	return true;
}

/**
 * Initialize the OTel NodeSDK with a Langfuse OTLP trace exporter plus the
 * EmmyProfileStampProcessor. Returns the SDK handle (pass to shutdownOtel at
 * process exit), or null if telemetry is disabled.
 *
 * Callers: pi-emmy.ts runs this AFTER parseCliArgs + loadProfile (which MUST
 * remain emitEvent-free — guarded by profile-loader-no-telemetry.test.ts) and
 * BEFORE createEmmySession, so every span emitted downstream has a live SDK
 * installed globally.
 */
export async function initOtel(opts: InitOtelOpts): Promise<NodeSDK | null> {
	if (!opts.enabled) {
		console.error("[emmy] OBSERVABILITY: OFF (EMMY_TELEMETRY=off or --no-telemetry)");
		return null;
	}
	const baseUrl = opts.langfuseBaseUrl ?? "http://127.0.0.1:3000";
	const auth = Buffer.from(`${opts.langfusePublicKey}:${opts.langfuseSecretKey}`).toString("base64");
	const exporter = new OTLPTraceExporter({
		url: `${baseUrl}/api/public/otel/v1/traces`,
		headers: {
			Authorization: `Basic ${auth}`,
			"x-langfuse-ingestion-version": "4",
		},
	});
	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: "emmy",
			// OTel GenAI semconv — canonical constant name across spans that
			// describe LLM interactions. Literal string (rather than importing
			// from /incubating) to keep this module compatible with semconv
			// releases where the incubating surface moves around.
			"gen_ai.system": "vllm",
		}),
		spanProcessors: [
			new EmmyProfileStampProcessor(opts.profile),
			new BatchSpanProcessor(exporter),
		],
	});
	sdk.start();

	// Langfuse reachability probe — purely for boot-banner text; the SDK keeps
	// trying on its own schedule regardless of this result.
	try {
		const r = await fetch(baseUrl, {
			method: "HEAD",
			signal: AbortSignal.timeout(2000),
		});
		console.error(
			`[emmy] OBSERVABILITY: ON - JSONL + Langfuse OTLP (Langfuse responded ${r.status})`,
		);
	} catch {
		console.error(`[emmy] OBSERVABILITY: JSONL-only (Langfuse unreachable at ${baseUrl})`);
	}
	return sdk;
}

/**
 * Flush and shut down the OTel NodeSDK. Idempotent on null input so callers
 * can pass the return value of initOtel (which may be null when telemetry is
 * disabled) without a guard.
 */
export async function shutdownOtel(sdk: NodeSDK | null): Promise<void> {
	if (sdk) await sdk.shutdown();
}
