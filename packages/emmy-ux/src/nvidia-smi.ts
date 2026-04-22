// packages/emmy-ux/src/nvidia-smi.ts
//
// Plan 03-04 Task 2 (GREEN). TypeScript port of
// emmy_serve/thermal/sampler.py:GpuSampler._sample (Plan 01-07 Task 1).
//
// Why the port exists:
//   The DGX Spark GB10 SoC shares host UMA memory between CPU and GPU; there
//   is no dedicated VRAM bank for nvidia-smi to report. `memory.used` comes
//   back as the literal string "[N/A]". Plan 01-07's Python fix switched
//   the parser to PER-FIELD tolerance: one bad field OMITS that key from the
//   returned dict but keeps the rest. Dropping the entire row (as the pre-fix
//   shipped code did) lost the valid clock/util/temp readings.
//
// This TS port preserves the same contract:
//   - `[N/A]` / `n/a` / `` / `nan` in any field → that key is OMITTED
//   - All 4 numeric fields can be missing simultaneously — caller gets {ts}
//   - Fewer than 5 CSV fields → null (structurally malformed — drop)
//   - subprocess failure / timeout / ENOENT → null (no data this tick)
//
// Shell injection guard: we use `spawnSync(bin, [...args])` with explicit
// argv, NOT a shell string. The only externally-controllable piece is
// `opts.bin` / `EMMY_NVIDIA_SMI_BIN`; if an attacker owns that env var,
// they already own the process (T-03-04-01 threat register).

import { spawnSync } from "node:child_process";

const NA_SENTINELS = new Set(["[n/a]", "n/a", "", "nan"]);

export interface NvidiaSample {
	ts: string;
	gpu_util_pct?: number;
	gpu_clock_mhz?: number;
	gpu_temp_c?: number;
	memory_used_mb?: number;
}

/**
 * Parse `raw` as a float OR return undefined for nvidia-smi sentinels.
 *
 * Recognised sentinels (case-insensitive): "[N/A]", "N/A", "", "nan". Any
 * non-numeric string also degrades to undefined rather than NaN — the sampler
 * never propagates NaN to the footer (T-03-04-04: NaN-injection mitigation).
 */
export function parseFloatOrUndefined(raw: string): number | undefined {
	const s = (raw ?? "").trim();
	if (NA_SENTINELS.has(s.toLowerCase())) return undefined;
	const n = parseFloat(s);
	return Number.isFinite(n) ? n : undefined;
}

export interface SampleNvidiaSmiOpts {
	/** Override the nvidia-smi binary path. Defaults to process.env.EMMY_NVIDIA_SMI_BIN or "nvidia-smi". */
	bin?: string;
	/** Subprocess timeout in ms. Default 5000. */
	timeoutMs?: number;
}

/**
 * Invoke `nvidia-smi --query-gpu=...` once and return a parsed sample, OR
 * null if the subprocess is structurally unavailable.
 *
 * Query fields (in order): timestamp, utilization.gpu,
 * clocks.current.graphics, temperature.gpu, memory.used.
 *
 * Matches emmy_serve/thermal/sampler.py:GpuSampler._sample verbatim.
 */
export function sampleNvidiaSmi(opts: SampleNvidiaSmiOpts = {}): NvidiaSample | null {
	const bin = opts.bin ?? process.env.EMMY_NVIDIA_SMI_BIN ?? "nvidia-smi";
	const timeout = opts.timeoutMs ?? 5000;

	let out: ReturnType<typeof spawnSync>;
	try {
		out = spawnSync(
			bin,
			[
				"--query-gpu=timestamp,utilization.gpu,clocks.current.graphics,temperature.gpu,memory.used",
				"--format=csv,noheader,nounits",
			],
			{
				encoding: "utf8",
				timeout,
				// ignore stdin; capture stdout; drop stderr (the Python reference
				// passes stderr=subprocess.DEVNULL — mirror that exactly).
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
	} catch {
		// ENOENT / timeout / other — treat as structurally unavailable.
		return null;
	}

	// spawnSync can surface failure via .error (e.g. ENOENT) without throwing.
	if (out.error) return null;
	if (out.status !== 0) return null;
	const stdout = typeof out.stdout === "string" ? out.stdout : String(out.stdout ?? "");
	if (!stdout) return null;

	// Take the first non-empty line.
	const firstLine = stdout.split("\n").find((l) => l.trim().length > 0);
	if (!firstLine) return null;

	const parts = firstLine.split(",").map((p) => p.trim());
	if (parts.length < 5) return null;

	const [ts, util, clock, temp, mem] = parts;
	const sample: NvidiaSample = { ts: ts ?? "" };
	const u = parseFloatOrUndefined(util ?? "");
	if (u !== undefined) sample.gpu_util_pct = u;
	const c = parseFloatOrUndefined(clock ?? "");
	if (c !== undefined) sample.gpu_clock_mhz = c;
	const t = parseFloatOrUndefined(temp ?? "");
	if (t !== undefined) sample.gpu_temp_c = t;
	const m = parseFloatOrUndefined(mem ?? "");
	if (m !== undefined) sample.memory_used_mb = m;
	return sample;
}
