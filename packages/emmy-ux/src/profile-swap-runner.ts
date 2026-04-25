// packages/emmy-ux/src/profile-swap-runner.ts
//
// Plan 04-03 Task 1 — TS-side child-process driver for the Python swap
// primitive shipped by Plan 04-02 (`emmy_serve.swap.orchestrator`).
//
// Plan 04.2-03 D-04 LOCKED dual-path dispatcher (4-line leading branch
// added at the top of runSwapAndStreamProgress): when EMMY_REMOTE_CLIENT='1'
// the call routes through ./profile-swap-runner-http (HTTP+SSE to the
// FastAPI sidecar over Tailscale). When unset/anything-else, the existing
// spawn path runs UNTOUCHED — Phase-4-stabilized daily-driver byte-stable.
// The spawn-argv snapshot test in test/spawn-argv.snapshot.test.ts pins
// the exact argv array; any future refactor of this body fails CI loudly.
//
// Spawns `uv run python -m emmy_serve.swap.orchestrator --from X --to Y --port N`,
// line-buffers its stdout, parses each complete line as JSON, and:
//   - forwards `{phase, pct?}` records to opts.onProgress(phase, pct?)
//   - captures `{rolled_back, rollback_succeeded?}` envelope records
//   - silently ignores malformed / non-JSON lines (try/catch)
//
// Contract with Plan 04-02 orchestrator (D-02 LOCKED progress labels emitted
// on stdout, one JSON line per phase, flushed):
//   {"ts":"...","phase":"stopping vLLM"}
//   {"ts":"...","phase":"loading weights","pct":0|50|90}
//   {"ts":"...","phase":"warmup"}
//   {"ts":"...","phase":"ready"}
//   (on exit 6) {"rolled_back":true,"rollback_succeeded":true|false}
//
// Exit codes (from orchestrator.py docstring):
//   0 ok, 5 pre-flight fail (prior engine alive), 6 post-stop fail (+ envelope),
//   other → generic failure (see runs/boot-failures/).
//
// Design note (DI for tests):
//   The `spawnFn` option accepts `typeof spawn` so unit tests can inject a mock
//   that yields a fake ChildProcess-like object without touching the real
//   subprocess layer. Production callers omit it and get node's child_process.spawn.

import { spawn as defaultSpawn } from "node:child_process";

export interface SwapResult {
	exit: number;
	envelope?: { rolled_back?: boolean; rollback_succeeded?: boolean };
}

/**
 * Minimal ChildProcess-like shape we drive. Narrower than node's
 * `ChildProcess` so we stay compatible with the bun-types node surface
 * (which doesn't expose the full EventEmitter API on ChildProcess) — and
 * so unit tests can inject a plain EventEmitter-backed fake without
 * satisfying the entire ChildProcess interface.
 */
export interface SwapRunnerChild {
	stdout: {
		on(event: "data", listener: (chunk: Buffer | string) => void): void;
	} | null;
	on(event: "exit", listener: (code: number | null) => void): void;
	on(event: "error", listener: (err: Error) => void): void;
}

/**
 * DI-friendly spawn signature. Matches node's `child_process.spawn` subset we
 * use: argv-array form with stdio config that gives us a readable stdout pipe.
 */
export type SpawnFn = (
	command: string,
	args: readonly string[],
	options: { cwd?: string; stdio?: readonly (string | number)[] },
) => SwapRunnerChild;

/**
 * Spawn the Python swap orchestrator and stream its JSON-per-line progress to
 * opts.onProgress. Resolves when the child exits; rejects only on spawn
 * errors (ENOENT for `uv`, for example).
 *
 * Line-buffered parsing: partial stdout chunks are accumulated into a buffer;
 * complete lines (terminated by `\n`) are JSON.parse'd one at a time. Lines
 * that fail JSON.parse are silently ignored (orchestrator.py may emit
 * incidental non-JSON noise on stderr — we pipe stderr to parent, but guard
 * stdout parsing defensively).
 */
export async function runSwapAndStreamProgress(args: {
	from: string;
	to: string;
	port: number;
	onProgress: (phase: string, pct?: number) => void;
	cwd?: string;
	spawnFn?: SpawnFn;
}): Promise<SwapResult> {
	// Plan 04.2-03 D-04 LOCKED dual-path dispatcher.
	// EMMY_REMOTE_CLIENT='1' → HTTP+SSE path (Mac client over Tailscale to sidecar).
	// Anything else → byte-stable spawn path (Spark-side daily-driver, UNCHANGED).
	if (process.env.EMMY_REMOTE_CLIENT === "1") {
		const { runSwapAndStreamProgressHttp } = await import("./profile-swap-runner-http");
		return runSwapAndStreamProgressHttp(args);
	}
	// ===== EXISTING SPAWN PATH (UNCHANGED below this line — D-04 BYTE-STABLE) =====
	const spawnFn: SpawnFn = args.spawnFn ?? (defaultSpawn as unknown as SpawnFn);
	return new Promise<SwapResult>((resolve, reject) => {
		const p = spawnFn(
			"uv",
			[
				"run",
				"python",
				"-m",
				"emmy_serve.swap.orchestrator",
				"--from",
				args.from,
				"--to",
				args.to,
				"--port",
				String(args.port),
			],
			{
				cwd: args.cwd ?? process.cwd(),
				stdio: ["ignore", "pipe", "inherit"],
			},
		);

		let envelope: SwapResult["envelope"];
		let buf = "";

		// stdout is typed `Readable | null` — it's always non-null when stdio[1]
		// is "pipe", but TS doesn't know that. Guard for safety.
		const stdout = p.stdout;
		if (stdout) {
			stdout.on("data", (chunk: Buffer | string) => {
				buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
				let idx: number;
				while ((idx = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, idx);
					buf = buf.slice(idx + 1);
					if (!line.trim()) continue;
					try {
						const rec = JSON.parse(line) as {
							phase?: unknown;
							pct?: unknown;
							rolled_back?: unknown;
							rollback_succeeded?: unknown;
						};
						if (typeof rec.phase === "string") {
							const pct = typeof rec.pct === "number" ? rec.pct : undefined;
							args.onProgress(rec.phase, pct);
						} else if ("rolled_back" in rec) {
							envelope = {
								rolled_back:
									typeof rec.rolled_back === "boolean"
										? rec.rolled_back
										: undefined,
								rollback_succeeded:
									typeof rec.rollback_succeeded === "boolean"
										? rec.rollback_succeeded
										: undefined,
							};
						}
					} catch {
						// Non-JSON / malformed line — ignore per contract.
					}
				}
			});
		}

		p.on("exit", (code: number | null) => {
			resolve({ exit: code ?? 1, envelope });
		});
		p.on("error", (err: Error) => {
			reject(err);
		});
	});
}
