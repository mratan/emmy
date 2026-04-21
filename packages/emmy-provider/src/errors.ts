// packages/emmy-provider/src/errors.ts
//
// Dotted-path error hierarchy for @emmy/provider. Mirrors the Phase 1
// `ProfileConfigError` convention (`profile.<field>: <message>`) so the
// harness's boot-error diagnostics have a single, recognizable shape across
// Python (emmy_serve) and TS (@emmy) sides.

export class ProviderError extends Error {
	constructor(
		public readonly field: string,
		message: string,
	) {
		super(`provider.${field}: ${message}`);
		this.name = "ProviderError";
	}
}

export class NetworkError extends ProviderError {
	constructor(
		public readonly url: string,
		public readonly status: number | null,
		detail: string,
	) {
		super(
			"network",
			`POST ${url} failed (status=${status ?? "n/a"}): ${detail}`,
		);
		this.name = "NetworkError";
	}
}

export class GrammarRetryExhaustedError extends ProviderError {
	constructor(
		public readonly attempts: number,
		public readonly lastReason: string,
	) {
		super(
			"grammar.retry",
			`exhausted after ${attempts} attempt(s); last reason: ${lastReason}`,
		);
		this.name = "GrammarRetryExhaustedError";
	}
}
