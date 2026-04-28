#!/usr/bin/env bun
// scripts/compute_max_input_tokens.ts
//
// Plan 02-07 Step 2 — honest max_input_tokens derivation (SC-5 / CONTEXT-05).
//
// Reads a profile bundle's serving.yaml + PROFILE_NOTES.md frontmatter, calls
// `computeMaxInputTokens` from @emmy/ux, and prints the JSON result. The
// printed `max_input_tokens` lands in harness.yaml; the `derivation` string
// lands in PROFILE_NOTES.md "Harness (Phase 2)" provenance table.
//
// Usage:
//   bun scripts/compute_max_input_tokens.ts profiles/gemma-4-26b-a4b-it/v2
//
// Also used by Plan-04's un-skipped max-model-len regression test to double-
// check the committed harness.yaml value against the current formula (SC-5
// consistency gate).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { computeMaxInputTokens } from "@emmy/ux";

const profileDir = resolve(process.argv[2] ?? "profiles/gemma-4-26b-a4b-it/v2");

const serving = yaml.load(readFileSync(`${profileDir}/serving.yaml`, "utf8")) as {
	engine?: { max_model_len?: number };
};
const notes = readFileSync(`${profileDir}/PROFILE_NOTES.md`, "utf8");
const fm = notes.match(/^---\n([\s\S]*?)\n---/);
if (!fm) {
	console.error(`PROFILE_NOTES.md missing frontmatter at ${profileDir}`);
	process.exit(1);
}
const measured = yaml.load(fm[1]!) as {
	measured_values?: { gpu_memory_utilization?: number };
};

const mu = measured.measured_values?.gpu_memory_utilization;
const maxModelLen = serving.engine?.max_model_len;
if (typeof mu !== "number" || typeof maxModelLen !== "number") {
	console.error(
		`Missing numeric fields: measured_values.gpu_memory_utilization=${mu}, serving.engine.max_model_len=${maxModelLen}`,
	);
	process.exit(1);
}

// SC-5: 16K output reserve (16384). Documented in CONTEXT.md §specifics.
const OUTPUT_RESERVE_TOKENS = 16384;

const result = computeMaxInputTokens({
	measured_gpu_memory_utilization: mu,
	max_model_len: maxModelLen,
	output_reserve_tokens: OUTPUT_RESERVE_TOKENS,
});

console.log(JSON.stringify(result, null, 2));
