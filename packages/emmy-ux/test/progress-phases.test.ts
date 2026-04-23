// packages/emmy-ux/test/progress-phases.test.ts
//
// Plan 04-03 Task 1 — D-02 LOCKED progress-phase ordering assertion.
//
// Distinct from profile-swap-runner.test.ts: this test focuses on the
// verbatim D-02 four-phase sequence (`stopping vLLM` → `loading weights` →
// `warmup` → `ready`) + optional pct progression on `loading weights`. It
// drives the same runSwapAndStreamProgress driver but sharpens the
// assertions on phase-label fidelity.

import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import {
	runSwapAndStreamProgress,
	type SpawnFn,
} from "../src/profile-swap-runner";

class FakeChild extends EventEmitter {
	readonly stdout: EventEmitter;
	constructor() {
		super();
		this.stdout = new EventEmitter();
	}
	emitStdout(chunk: string): void {
		this.stdout.emit("data", chunk);
	}
	emitExit(code: number | null): void {
		this.emit("exit", code);
	}
}

function makeSpawnFn(): { spawnFn: SpawnFn; child: FakeChild } {
	const child = new FakeChild();
	const spawnFn: SpawnFn = ((
		_cmd: string,
		_args: readonly string[],
		_opts: unknown,
	) => child as unknown as ReturnType<SpawnFn>) as SpawnFn;
	return { spawnFn, child };
}

describe("D-02 LOCKED — four progress phases in order", () => {
	test("four D-02 progress phases forwarded in order to onProgress", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const phases: Array<[string, number | undefined]> = [];

		const promise = runSwapAndStreamProgress({
			from: "profiles/qwen3.6-35b-a3b/v3.1",
			to: "profiles/gemma-4-26b-a4b-it/v1",
			port: 8002,
			onProgress: (p, pct) => phases.push([p, pct]),
			spawnFn,
		});

		// Emit the four D-02 verbatim labels in order.
		child.emitStdout('{"ts":"2026-04-23T00:00:00Z","phase":"stopping vLLM"}\n');
		child.emitStdout('{"ts":"2026-04-23T00:00:05Z","phase":"loading weights","pct":0}\n');
		child.emitStdout('{"ts":"2026-04-23T00:00:30Z","phase":"warmup"}\n');
		child.emitStdout('{"ts":"2026-04-23T00:00:35Z","phase":"ready"}\n');
		child.emitExit(0);

		await promise;

		// The order is the contract — four phases, verbatim labels.
		expect(phases.length).toBe(4);
		expect(phases[0]![0]).toBe("stopping vLLM");
		expect(phases[1]![0]).toBe("loading weights");
		expect(phases[1]![1]).toBe(0);
		expect(phases[2]![0]).toBe("warmup");
		expect(phases[3]![0]).toBe("ready");
	});

	test("loading weights pct progression (0/50/90) forwarded with correct pct", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const events: Array<[string, number | undefined]> = [];

		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: (p, pct) => events.push([p, pct]),
			spawnFn,
		});

		child.emitStdout('{"phase":"stopping vLLM"}\n');
		child.emitStdout('{"phase":"loading weights","pct":0}\n');
		child.emitStdout('{"phase":"loading weights","pct":50}\n');
		child.emitStdout('{"phase":"loading weights","pct":90}\n');
		child.emitStdout('{"phase":"warmup"}\n');
		child.emitStdout('{"phase":"ready"}\n');
		child.emitExit(0);

		await promise;

		const loadingEvents = events.filter(([p]) => p === "loading weights");
		expect(loadingEvents.length).toBe(3);
		expect(loadingEvents.map(([, pct]) => pct)).toEqual([0, 50, 90]);
	});

	test("phase event without pct → onProgress receives undefined pct (no NaN injection)", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const events: Array<[string, number | undefined]> = [];

		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: (p, pct) => events.push([p, pct]),
			spawnFn,
		});

		// `pct` intentionally absent on warmup/ready phases.
		child.emitStdout('{"phase":"warmup"}\n');
		child.emitStdout('{"phase":"ready"}\n');
		child.emitExit(0);
		await promise;

		expect(events).toEqual([
			["warmup", undefined],
			["ready", undefined],
		]);
	});

	test("pct value that isn't a number is coerced to undefined (defensive)", async () => {
		const { spawnFn, child } = makeSpawnFn();
		const events: Array<[string, number | undefined]> = [];
		const promise = runSwapAndStreamProgress({
			from: "a",
			to: "b",
			port: 8002,
			onProgress: (p, pct) => events.push([p, pct]),
			spawnFn,
		});

		// Orchestrator should never emit non-numeric pct, but if it does, we
		// pass undefined downstream rather than leaking "50" string into the UI.
		child.emitStdout('{"phase":"loading weights","pct":"50"}\n');
		child.emitExit(0);
		await promise;

		expect(events).toEqual([["loading weights", undefined]]);
	});
});
