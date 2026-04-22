// packages/emmy-ux/test/nvidia-smi.test.ts
//
// Plan 03-04 Task 1 (RED). Imports `sampleNvidiaSmi` + `parseFloatOrUndefined`
// + type `NvidiaSample` from ../src/nvidia-smi (not yet created — RED).
//
// Semantic parity target: emmy_serve/thermal/sampler.py lines 39-56, 124-155
// (Plan 01-07 Task 1 N/A-tolerant fix — DGX Spark UMA memory.used returns
// `[N/A]` because the GPU shares host UMA memory). The TS port must preserve
// the per-field N/A tolerance: one field with `[N/A]` MUST NOT drop the whole
// row.
//
// Stubbing strategy: `EMMY_NVIDIA_SMI_BIN` env var overrides the binary path
// so the test can use a tiny shell stub that prints a fixture line. Mirrors
// Phase 2's `EMMY_PROFILE_VALIDATE_BIN` pattern (Plan 02-04).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	parseFloatOrUndefined,
	sampleNvidiaSmi,
	type NvidiaSample,
} from "../src/nvidia-smi";

function makeStubBin(dir: string, stdout: string, exitCode = 0): string {
	const bin = join(dir, "fake-nvidia-smi");
	const script = `#!/usr/bin/env bash\ncat <<'EOF'\n${stdout}\nEOF\nexit ${exitCode}\n`;
	writeFileSync(bin, script);
	chmodSync(bin, 0o755);
	return bin;
}

describe("parseFloatOrUndefined (N/A-tolerant scalar parser)", () => {
	test("parses numeric strings", () => {
		expect(parseFloatOrUndefined("42")).toBe(42);
		expect(parseFloatOrUndefined("  87.5 ")).toBe(87.5);
		expect(parseFloatOrUndefined("2850")).toBe(2850);
	});

	test("returns undefined for [N/A] sentinel (DGX Spark UMA case)", () => {
		expect(parseFloatOrUndefined("[N/A]")).toBeUndefined();
		expect(parseFloatOrUndefined("[n/a]")).toBeUndefined();
	});

	test("returns undefined for bare N/A", () => {
		expect(parseFloatOrUndefined("N/A")).toBeUndefined();
		expect(parseFloatOrUndefined("n/a")).toBeUndefined();
	});

	test("returns undefined for empty string or 'nan'", () => {
		expect(parseFloatOrUndefined("")).toBeUndefined();
		expect(parseFloatOrUndefined("   ")).toBeUndefined();
		expect(parseFloatOrUndefined("nan")).toBeUndefined();
	});

	test("returns undefined for non-numeric values", () => {
		expect(parseFloatOrUndefined("hello")).toBeUndefined();
	});
});

describe("sampleNvidiaSmi (subprocess shape)", () => {
	let tmpDir: string;
	const origBin = process.env.EMMY_NVIDIA_SMI_BIN;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "emmy-smi-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		if (origBin === undefined) delete process.env.EMMY_NVIDIA_SMI_BIN;
		else process.env.EMMY_NVIDIA_SMI_BIN = origBin;
	});

	test("parses a dedicated-GPU row where all 5 fields are numeric", () => {
		const bin = makeStubBin(
			tmpDir,
			"2026-04-21T10:00:00, 87, 2850, 72, 12345",
		);
		const out: NvidiaSample | null = sampleNvidiaSmi({ bin });
		expect(out).not.toBeNull();
		expect(out!.ts).toBe("2026-04-21T10:00:00");
		expect(out!.gpu_util_pct).toBe(87);
		expect(out!.gpu_clock_mhz).toBe(2850);
		expect(out!.gpu_temp_c).toBe(72);
		expect(out!.memory_used_mb).toBe(12345);
	});

	test("DGX Spark UMA regression — `[N/A]` in memory.used keeps other fields", () => {
		// This is the exact shape Plan 01-07 Task 1 fixed in Python; the TS port
		// must preserve it.
		const bin = makeStubBin(
			tmpDir,
			"2026/04/21 09:03:14.839, 0, 2405, 48, [N/A]",
		);
		const out = sampleNvidiaSmi({ bin });
		expect(out).not.toBeNull();
		expect(out!.gpu_util_pct).toBe(0);
		expect(out!.gpu_clock_mhz).toBe(2405);
		expect(out!.gpu_temp_c).toBe(48);
		expect(out!.memory_used_mb).toBeUndefined();
	});

	test("all-[N/A] row returns ts only", () => {
		const bin = makeStubBin(
			tmpDir,
			"2026/04/21 09:03:14.839, [N/A], [N/A], [N/A], [N/A]",
		);
		const out = sampleNvidiaSmi({ bin });
		expect(out).not.toBeNull();
		expect(out!.ts).toBe("2026/04/21 09:03:14.839");
		expect(out!.gpu_util_pct).toBeUndefined();
		expect(out!.gpu_clock_mhz).toBeUndefined();
		expect(out!.gpu_temp_c).toBeUndefined();
		expect(out!.memory_used_mb).toBeUndefined();
	});

	test("picks up EMMY_NVIDIA_SMI_BIN env var when no opts.bin", () => {
		const bin = makeStubBin(tmpDir, "2026-04-21T10:00:00, 50, 2000, 60, 8000");
		process.env.EMMY_NVIDIA_SMI_BIN = bin;
		const out = sampleNvidiaSmi();
		expect(out).not.toBeNull();
		expect(out!.gpu_util_pct).toBe(50);
	});

	test("missing nvidia-smi binary (ENOENT) returns null, does not throw", () => {
		const out = sampleNvidiaSmi({ bin: "/nonexistent/does/not/exist/nvidia-smi" });
		expect(out).toBeNull();
	});

	test("non-zero exit status returns null", () => {
		const bin = makeStubBin(tmpDir, "", 1);
		const out = sampleNvidiaSmi({ bin });
		expect(out).toBeNull();
	});

	test("empty stdout returns null", () => {
		const bin = makeStubBin(tmpDir, "");
		const out = sampleNvidiaSmi({ bin });
		expect(out).toBeNull();
	});

	test("fewer than 5 CSV fields returns null (structurally malformed)", () => {
		const bin = makeStubBin(tmpDir, "2026-04-21T10:00:00, 87");
		const out = sampleNvidiaSmi({ bin });
		expect(out).toBeNull();
	});
});
