// packages/emmy-ux/src/max-model-len.ts
//
// CONTEXT-05 honest max_model_len (SC-5 / W4). Phase 2 refuses back-of-envelope
// max_input_tokens numbers — the value must be computed from Phase 1's
// measured KV ceiling + a documented output-reserve budget.
//
// Formula:
//   max_input_tokens = max_model_len - output_reserve_tokens
//
// The measured_gpu_memory_utilization input is currently a validation-only
// field — the Phase 1 find-kv-budget process already bakes it into
// max_model_len. We enforce a reasonable lower bound (0.5) so the caller
// cannot pass a garbage value that would mask a profile-load bug.

import { MaxModelLenError } from "./errors";

export function computeMaxInputTokens(opts: {
	measured_gpu_memory_utilization: number;
	max_model_len: number;
	output_reserve_tokens: number;
}): { max_input_tokens: number; derivation: string } {
	const mu = opts.measured_gpu_memory_utilization;
	const mml = opts.max_model_len;
	const reserve = opts.output_reserve_tokens;

	if (!Number.isFinite(mu) || mu < 0.5 || mu > 1) {
		throw new MaxModelLenError(
			"gpu_memory_utilization",
			`measured_gpu_memory_utilization must be in [0.5, 1.0]; got ${mu}. Check PROFILE_NOTES.md measured_values.gpu_memory_utilization — Phase 1's find_kv_budget.py writes the authoritative value.`,
		);
	}
	if (!Number.isFinite(mml) || mml <= 0) {
		throw new MaxModelLenError(
			"max_model_len",
			`max_model_len must be > 0; got ${mml}. Check serving.yaml:engine.max_model_len.`,
		);
	}
	if (!Number.isFinite(reserve) || reserve < 0) {
		throw new MaxModelLenError(
			"output_reserve_tokens",
			`output_reserve_tokens must be >= 0; got ${reserve}`,
		);
	}
	if (reserve >= mml) {
		throw new MaxModelLenError(
			"output_reserve_tokens",
			`output_reserve_tokens (${reserve}) must be < max_model_len (${mml}) — otherwise max_input_tokens would be <= 0`,
		);
	}

	const maxInputTokens = Math.floor(mml - reserve);
	const derivation =
		`max_input_tokens = max_model_len(${mml}) - output_reserve_tokens(${reserve}) = ${maxInputTokens} ` +
		`(measured_gpu_memory_utilization=${mu}, source: PROFILE_NOTES.md measured_values)`;
	return { max_input_tokens: maxInputTokens, derivation };
}

export { MaxModelLenError } from "./errors";
