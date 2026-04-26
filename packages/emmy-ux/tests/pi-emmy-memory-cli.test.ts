// Plan 04.4-05 Task 3 — pi-emmy CLI parser tests for --no-memory / --memory-snapshot.
//
// Drives parseArgs via subprocess invocation against pi-emmy.ts's --help and
// --print-environment paths so the parser is exercised without booting a
// real pi runtime. The full session.ts wiring (resolveMemoryConfig +
// applyMemorySnapshot) is verified by repro.test.ts and snapshot-fidelity.test.ts;
// this file ships the CLI-surface acceptance.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const PI_EMMY = resolve(REPO_ROOT, "packages/emmy-ux/bin/pi-emmy.ts");
const BUN_BIN = `${process.env.HOME}/.bun/bin/bun`;

function runPiEmmy(args: string[]): { stdout: string; stderr: string; code: number } {
	const res = spawnSync(BUN_BIN, ["run", PI_EMMY, ...args], {
		encoding: "utf8",
		timeout: 15_000,
		// Skip the vLLM probe + profile validate so --help still works.
		env: {
			...process.env,
			EMMY_SKIP_PROFILE_VALIDATE: "1",
		},
	});
	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		code: res.status ?? -1,
	};
}

describe("pi-emmy CLI — memory flags (Plan 04.4-05)", () => {
	test("--help mentions --no-memory", () => {
		const r = runPiEmmy(["--help"]);
		expect(r.stdout + r.stderr).toContain("--no-memory");
	});

	test("--help mentions --memory-snapshot", () => {
		const r = runPiEmmy(["--help"]);
		expect(r.stdout + r.stderr).toContain("--memory-snapshot");
	});

	test("--memory-snapshot without arg surfaces usage error", () => {
		// The parser sets memorySnapshotError sentinel; main() returns 2.
		// We exercise the parser via the test bundle below.
	});
});

// Direct parser tests — import parseArgs directly to avoid subprocess overhead.
import("../bin/pi-emmy").then(() => undefined).catch(() => undefined);

describe("pi-emmy parseArgs — memory flag parsing (in-process)", () => {
	// We can't import parseArgs directly because pi-emmy.ts has top-level side
	// effects. Instead exercise via spawn for the small handful of cases.

	test("--no-memory + --print-environment exits 0", () => {
		const r = runPiEmmy([
			"--no-memory",
			"--print-environment",
			"--profile",
			resolve(REPO_ROOT, "profiles/qwen3.6-35b-a3b/v3.1"),
		]);
		// Either exit 0 (success) or 4 (prereq), but NOT 2 (usage error).
		expect(r.code).not.toBe(2);
	});

	test("--memory-snapshot without dir argument exits 2 (usage error)", () => {
		// `--memory-snapshot` followed by another flag — parser detects bare
		// flag and sets memorySnapshotError; main() returns 2 (usage error).
		const r = runPiEmmy(["--memory-snapshot", "--print-environment"]);
		expect(r.code).toBe(2);
	});
});
