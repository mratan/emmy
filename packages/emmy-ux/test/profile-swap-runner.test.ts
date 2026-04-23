// packages/emmy-ux/test/profile-swap-runner.test.ts
//
// Plan 04-03 Task 1 — unit tests for runSwapAndStreamProgress.
//
// Strategy: inject a fake `spawnFn` that returns a minimal ChildProcess-like
// object. Tests drive stdout events + exit events manually, asserting:
//   - 4 D-02 phase events are relayed via onProgress
//   - rolled_back envelope is captured on exit 6
//   - malformed JSON lines silently ignored (no throw, no onProgress fire)
//   - exit codes forwarded verbatim
//   - partial-chunk buffering correctly reassembles split JSON lines

import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import {
	runSwapAndStreamProgress,
	type SpawnFn,
} from "../src/profile-swap-runner";

/** Minimal ChildProcess-like fake that satisfies runSwapAndStreamProgress. */
class FakeChild extends EventEmitter {
	readonly stdout: EventEmitter;
	constructor() {
		super();
		this.stdout = new EventEmitter();
	}
	emitStdout(chunk: string | Buffer): void {
		this.stdout.emit("data", chunk);
	}
	emitExit(code: number | null): void {
		this.emit("exit", code);
	}
	emitError(err: Error): void {
		this.emit("error", err);
	}
}

/** Build a spawnFn that yields a caller-controlled FakeChild and records the argv. */
function makeSpawnFn(): {
	spawnFn: SpawnFn;
	child: FakeChild;
	lastArgs: { cmd?: string; args?: readonly string[]; options?: unknown };
} {
	const lastArgs: { cmd?: string; args?: readonly string[]; options?: unknown } = {};
	const child = new FakeChild();
	const spawnFn: SpawnFn = ((cmd, args, options) => {
		lastArgs.cmd = cmd;
		lastArgs.args = args;
		lastArgs.options = options;
		return child as unknown as ReturnType<SpawnFn>;
	}) as SpawnFn;
	return { spawnFn, child, lastArgs };
}

describe("runSwapAndStreamProgress", () => {
	test("spawns orchestrator and forwards 4 phase events in order (D-02 LOCKED)", async () => {
		const { spawnFn, child, lastArgs } = makeSpawnFn();
		const phases: Array<[string, number | undefined]> = [];

		const promise = runSwapAndStreamProgress({
			from: "profiles/old",
			to: "profiles/new",
			port: 8002,
			onProgress: (p, pct) => phases.push([p, pct]),
			spawnFn,
		});

		// Emit D-02 verbatim labels as one JSON line each.
		child.emitStdout('{"ts":"2026-04-23T00:00:00Z","phase":"stopping vLLM"}\n');
		child.emitStdout('{"ts":"2026-04-23T00:00:05Z","phase":"loading weights","pct":0}\n');
		child.emitStdout('{"phase":"warmup"}\n');
		child.emitStdout('{"phase":"ready"}\n');
		child.emitExit(0);

		const result = await promise;
		expect(result.exit).toBe(0);
		expect(result.envelope).toBeUndefined();

		expect(phases).toEqual([
			["stopping vLLM", undefined],
			["loading weights", 0],
			["warmup", undefined],
			["ready", undefined],
		]);

		// Argv contract verification — must shell out to the Python primitive.
		expect(lastArgs.cmd).toBe("uv");
		expect(lastArgs.args).toContain("emmy_serve.swap.orchestrator");
		expect(lastArgs.args).toContain("--from");
		expect(lastArgs.args).toContain("profiles/old");
		expect(lastArgs.args).toContain("--to");
		expect(lastArgs.args).toContain("profiles/new");
		expect(lastArgs.args).toContain("--port");
		expect(lastArgs.args).toContain("8002");
	});

	test("rolled_back envelope captured on final stdout line (exit 6)", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const phases: Array<[string, number | undefined]> = [];
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: (p, pct) => phases.push([p, pct]),
			spawnFn,
		});

		child.emitStdout('{"phase":"stopping vLLM"}\n');
		child.emitStdout('{"phase":"loading weights","pct":0}\n');
		// After post-stop failure, orchestrator emits a final envelope record.
		child.emitStdout('{"rolled_back":true,"rollback_succeeded":true}\n');
		child.emitExit(6);

		const result = await promise;
		expect(result.exit).toBe(6);
		expect(result.envelope).toBeDefined();
		expect(result.envelope?.rolled_back).toBe(true);
		expect(result.envelope?.rollback_succeeded).toBe(true);
	});

	test("rollback_succeeded=false also captured on envelope line", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});

		child.emitStdout('{"rolled_back":true,"rollback_succeeded":false}\n');
		child.emitExit(6);

		const result = await promise;
		expect(result.envelope?.rolled_back).toBe(true);
		expect(result.envelope?.rollback_succeeded).toBe(false);
	});

	test("malformed JSON lines silently ignored; valid events still fire", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const phases: Array<[string, number | undefined]> = [];
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: (p, pct) => phases.push([p, pct]),
			spawnFn,
		});

		child.emitStdout('{"phase":"stopping vLLM"}\n');
		child.emitStdout("this is not JSON at all\n");
		child.emitStdout("{broken json: yep\n"); // starts '{' but invalid
		child.emitStdout('{"phase":"ready"}\n');
		child.emitExit(0);

		const result = await promise;
		expect(result.exit).toBe(0);
		// Exactly the two valid events — the two garbage lines are ignored.
		expect(phases).toEqual([
			["stopping vLLM", undefined],
			["ready", undefined],
		]);
	});

	test("exit code forwarded verbatim (5 → pre-flight fail)", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});

		// Exit 5 = pre-flight fail, no progress emitted, prior engine alive.
		child.emitExit(5);

		const result = await promise;
		expect(result.exit).toBe(5);
		expect(result.envelope).toBeUndefined();
	});

	test("null exit code coerces to 1 (spawn anomaly fallback)", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});

		child.emitExit(null);

		const result = await promise;
		expect(result.exit).toBe(1);
	});

	test("buffer correctly splits on partial chunks (mid-line stdout break)", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const phases: Array<[string, number | undefined]> = [];
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: (p, pct) => phases.push([p, pct]),
			spawnFn,
		});

		// Split a single JSON line across TWO chunks.
		child.emitStdout('{"phase":"stop');
		expect(phases).toEqual([]); // nothing fired — no newline yet
		child.emitStdout('ping vLLM"}\n');
		expect(phases).toEqual([["stopping vLLM", undefined]]);

		// Even trickier: a chunk containing MULTIPLE lines + a partial trailing line.
		child.emitStdout(
			'{"phase":"loading weights","pct":50}\n{"phase":"warm',
		);
		expect(phases).toEqual([
			["stopping vLLM", undefined],
			["loading weights", 50],
		]);
		child.emitStdout('up"}\n');
		expect(phases).toEqual([
			["stopping vLLM", undefined],
			["loading weights", 50],
			["warmup", undefined],
		]);

		child.emitExit(0);
		const result = await promise;
		expect(result.exit).toBe(0);
	});

	test("rejects on child process spawn error", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: () => {},
			spawnFn,
		});

		child.emitError(new Error("spawn uv ENOENT"));
		await expect(promise).rejects.toThrow("spawn uv ENOENT");
	});
});
