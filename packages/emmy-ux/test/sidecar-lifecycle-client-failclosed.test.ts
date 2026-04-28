// packages/emmy-ux/test/sidecar-lifecycle-client-failclosed.test.ts
//
// Phase 04.2 follow-up — fail-loud default for the SSE lifecycle client.
//
// The original client defaulted exitCode=0, so any SSE stream that completed
// WITHOUT emitting an explicit {exit:N} frame (e.g. controller raised an
// exception and emitted only {phase:"error"} before closing) was misreported
// as success. The slash command would then notify "started <profile>" even
// though vLLM was actually still down — the operator's first prompt would
// then 502 with no clear cause.
//
// Fixed contract pinned by this test:
//   - exitCode defaults to 1 (assumed failure)
//   - explicit {exit:0} frame → exit=0 (success)
//   - explicit {exit:N} frame with N>0 → exit=N (failure)
//   - {phase:"error"} frame WITHOUT a follow-up exit → exit=1 (failure)
//   - stream closes cleanly with no exit frame at all → exit=1 (failure)
//   - mid-stream abort with no exit frame → exit=1 (failure)
//
// Pairs with controller.py emitting {exit:0} on idempotent short-circuit and
// {exit:1} on handler exceptions so the contract is symmetric end-to-end.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { runSidecarStartHttp } from "../src/sidecar-lifecycle-client";

interface FrameSink {
	frames: string[];
}

function sseLine(rec: object): string {
	return `data: ${JSON.stringify(rec)}\n\n`;
}

describe("sidecar-lifecycle-client fail-loud default (Phase 04.2 follow-up)", () => {
	let server: ReturnType<typeof Bun.serve>;
	let baseUrl: string;
	// Each test mutates this so the request handler knows what to send back.
	let nextResponseFrames: string[] = [];

	beforeAll(() => {
		server = Bun.serve({
			port: 0,
			async fetch(req) {
				if (new URL(req.url).pathname === "/start") {
					return new Response(nextResponseFrames.join(""), {
						status: 200,
						headers: {
							"content-type": "text/event-stream",
							"cache-control": "no-cache",
						},
					});
				}
				return new Response("nope", { status: 404 });
			},
		});
		baseUrl = `http://127.0.0.1:${server.port}`;
	});
	afterAll(() => {
		server.stop(true);
	});
	beforeEach(() => {
		nextResponseFrames = [];
	});

	function makeSink(): FrameSink & {
		onProgress: (phase: string, pct?: number) => void;
	} {
		const sink: FrameSink = { frames: [] };
		return {
			...sink,
			onProgress: (phase: string, pct?: number) => {
				sink.frames.push(pct !== undefined ? `${phase}@${pct}` : phase);
			},
		};
	}

	test("explicit {exit:0} frame → exit=0 (success)", async () => {
		nextResponseFrames = [
			sseLine({ phase: "loading weights", pct: 0 }),
			sseLine({ phase: "loading weights", pct: 50 }),
			sseLine({ phase: "warmup" }),
			sseLine({ phase: "ready" }),
			sseLine({ exit: 0 }),
		];
		const sink = makeSink();
		const got = await runSidecarStartHttp({
			baseUrl,
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: sink.onProgress,
		});
		expect(got.exit).toBe(0);
	});

	test("explicit {exit:5} frame → exit=5 (orchestrator-reported failure passes through)", async () => {
		nextResponseFrames = [
			sseLine({ phase: "stopping vLLM" }),
			sseLine({ phase: "loading weights", pct: 0 }),
			sseLine({ exit: 5 }),
		];
		const sink = makeSink();
		const got = await runSidecarStartHttp({
			baseUrl,
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: sink.onProgress,
		});
		expect(got.exit).toBe(5);
	});

	test("only {phase:'error'} frame, no exit → exit=1 (the bug this fixes)", async () => {
		// Mirrors the failure mode reproduced on Spark: controller raised
		// FileNotFoundError, emitted a single {phase:"error", details:{msg}}
		// frame, closed the stream. Pre-fix: client returned exit=0, slash
		// command notified "started ...". Post-fix: exit=1.
		nextResponseFrames = [
			sseLine({
				phase: "error",
				details: { msg: "[Errno 2] No such file or directory" },
			}),
		];
		const sink = makeSink();
		const got = await runSidecarStartHttp({
			baseUrl,
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: sink.onProgress,
		});
		expect(got.exit).toBe(1);
		// And the error msg should have been surfaced via onProgress so the
		// slash command can render it (currently doesn't, but the breadcrumb
		// is in the transcript / log).
		expect(sink.frames).toContain("error");
		expect(sink.frames.some((f) => f.includes("No such file"))).toBe(true);
	});

	test("stream closes cleanly with NO frames at all → exit=1", async () => {
		// Pathological: 200 OK but body is empty. Pre-fix: exit=0. Post-fix: exit=1.
		nextResponseFrames = [];
		const sink = makeSink();
		const got = await runSidecarStartHttp({
			baseUrl,
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: sink.onProgress,
		});
		expect(got.exit).toBe(1);
	});

	test("only progress frames (no exit, no error) → exit=1 (a stream that just stops mid-progress is a failure)", async () => {
		nextResponseFrames = [
			sseLine({ phase: "loading weights", pct: 0 }),
			sseLine({ phase: "loading weights", pct: 50 }),
			// no exit frame, no error frame — connection drops here
		];
		const sink = makeSink();
		const got = await runSidecarStartHttp({
			baseUrl,
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: sink.onProgress,
		});
		expect(got.exit).toBe(1);
	});

	test("idempotent short-circuit: {phase:'ready'} + {exit:0} → exit=0 (matches new controller behavior)", async () => {
		// Pinned at the wire level: controller's idempotent short-circuit now
		// emits the ready frame followed by an exit:0 terminator, matching
		// the cold-start success path. TS client treats it as success.
		nextResponseFrames = [
			sseLine({ state: "ready", phase: "ready" }),
			sseLine({ exit: 0 }),
		];
		const sink = makeSink();
		const got = await runSidecarStartHttp({
			baseUrl,
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: sink.onProgress,
		});
		expect(got.exit).toBe(0);
	});

	test("error frame followed by exit:1 → exit=1 (controller's exception path)", async () => {
		// Controller now emits both frames on handler exception:
		nextResponseFrames = [
			sseLine({ phase: "error", details: { msg: "kaboom" } }),
			sseLine({ exit: 1 }),
		];
		const sink = makeSink();
		const got = await runSidecarStartHttp({
			baseUrl,
			profile_id: "gemma-4-26b-a4b-it",
			variant: "v2.1",
			onProgress: sink.onProgress,
		});
		expect(got.exit).toBe(1);
	});
});
