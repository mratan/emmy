// packages/emmy-ux/test/spawn-argv.snapshot.test.ts
//
// Plan 04.2-03 Task 2 — D-04 BYTE-STABLE snapshot guard for the local-mode
// spawn argv. Locks the EXACT argv array runSwapAndStreamProgress issues when
// EMMY_REMOTE_CLIENT is unset. Any future refactor that mutates this argv
// fails this test loudly — preserves Phase-4-stabilized daily-driver path.
//
// Companion to profile-swap-runner.test.ts (which covers behavior); this file
// covers the argv shape + the dispatcher's env-flag branch behavior.
//
// T-04.2-S5 mitigation case: when EMMY_REMOTE_CLIENT='1', spawn MUST NEVER
// be called — even if the sidecar is unreachable. Hard-fail rather than
// silently falling back to a local orchestrator on a Mac (no Docker/GPU).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	runSwapAndStreamProgress,
	type SpawnFn,
	type SwapRunnerChild,
} from "../src/profile-swap-runner";

class FakeChild extends EventEmitter implements SwapRunnerChild {
	readonly stdout: SwapRunnerChild["stdout"];
	constructor() {
		super();
		const ee = new EventEmitter();
		this.stdout = {
			on: (event: "data", listener: (chunk: Buffer | string) => void) => {
				ee.on(event, listener);
			},
		};
	}
	emitExit(code: number | null): void {
		this.emit("exit", code);
	}
}

function makeSpawnFn() {
	const lastArgs: {
		cmd?: string;
		args?: readonly string[];
		options?: unknown;
	} = {};
	const child = new FakeChild();
	let calls = 0;
	const spawnFn: SpawnFn = ((cmd, args, options) => {
		calls++;
		lastArgs.cmd = cmd;
		lastArgs.args = args;
		lastArgs.options = options;
		return child as unknown as ReturnType<SpawnFn>;
	}) as SpawnFn;
	return { spawnFn, child, lastArgs, getCalls: () => calls };
}

describe("D-04 BYTE-STABLE spawn-argv snapshot", () => {
	let oldEnv: string | undefined;
	let oldServeUrl: string | undefined;
	beforeEach(() => {
		oldEnv = process.env.EMMY_REMOTE_CLIENT;
		oldServeUrl = process.env.EMMY_SERVE_URL;
	});
	afterEach(() => {
		if (oldEnv === undefined) delete process.env.EMMY_REMOTE_CLIENT;
		else process.env.EMMY_REMOTE_CLIENT = oldEnv;
		if (oldServeUrl === undefined) delete process.env.EMMY_SERVE_URL;
		else process.env.EMMY_SERVE_URL = oldServeUrl;
	});

	test("EMMY_REMOTE_CLIENT unset → spawn argv is byte-stable", async () => {
		delete process.env.EMMY_REMOTE_CLIENT;
		const { spawnFn, child, lastArgs, getCalls } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});
		child.emitExit(0);
		await promise;

		expect(getCalls()).toBe(1);
		expect(lastArgs.cmd).toBe("uv");
		// BYTE-STABLE — any future diff to this array fails the snapshot guard.
		expect([...(lastArgs.args ?? [])]).toEqual([
			"run",
			"python",
			"-m",
			"emmy_serve.swap.orchestrator",
			"--from",
			"X",
			"--to",
			"Y",
			"--port",
			"8002",
		]);
		// Options shape from line 96-99 of profile-swap-runner.ts:
		const opts = lastArgs.options as {
			stdio?: readonly (string | number)[];
			cwd?: string;
		};
		expect(opts.stdio).toEqual(["ignore", "pipe", "inherit"]);
	});

	test("EMMY_REMOTE_CLIENT='0' → spawn path (treats only literal '1' as remote)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "0";
		const { spawnFn, child, getCalls } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});
		child.emitExit(0);
		await promise;
		expect(getCalls()).toBe(1);
	});

	test("EMMY_REMOTE_CLIENT='true' → spawn path (only '1' triggers remote)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "true";
		const { spawnFn, child, getCalls } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});
		child.emitExit(0);
		await promise;
		expect(getCalls()).toBe(1);
	});

	test("EMMY_REMOTE_CLIENT='1' → spawn NOT called; HTTP path taken (T-04.2-S5: hard-fail, no silent local fallback)", async () => {
		process.env.EMMY_REMOTE_CLIENT = "1";
		process.env.EMMY_SERVE_URL = "http://127.0.0.1:9999"; // unreachable on purpose
		const { spawnFn, getCalls } = makeSpawnFn();
		const result = await runSwapAndStreamProgress({
			from: "X",
			to: "Y",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});
		// HTTP path returned (exit:1 because :9999 is unreachable).
		expect(result.exit).toBe(1);
		// CRITICAL: spawn was NEVER called. T-04.2-S5: no silent local fallback.
		expect(getCalls()).toBe(0);
	});

	test("EMMY_REMOTE_CLIENT undefined explicitly → spawn path", async () => {
		delete process.env.EMMY_REMOTE_CLIENT;
		const { spawnFn, child, getCalls } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "A",
			to: "B",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});
		child.emitExit(0);
		await promise;
		expect(getCalls()).toBe(1);
	});
});
