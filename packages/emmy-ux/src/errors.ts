// packages/emmy-ux/src/errors.ts
//
// Dotted-path error hierarchy for @emmy/ux. Mirrors the Phase 1
// ProfileConfigError style (`ux.<field>: <message>`) so boot-error
// diagnostics share a recognizable shape across Python (emmy_serve) and
// TypeScript (@emmy) sides.

export class UxError extends Error {
	constructor(
		public readonly field: string,
		message: string,
	) {
		super(`ux.${field}: ${message}`);
		this.name = "UxError";
	}
}

export class ProfileLoadError extends UxError {
	constructor(
		public readonly path: string,
		detail: string,
	) {
		super(`profile.load`, `${path}: ${detail}`);
		this.name = "ProfileLoadError";
	}
}

export class SpOkCanaryError extends UxError {
	constructor(public readonly responseText: string) {
		super(
			`canary.sp_ok`,
			`SP_OK canary failed — response did not contain '[SP_OK]'. First 200 chars of response: ${responseText.slice(
				0,
				200,
			)}. This is Pitfall #6 (silent system-prompt delivery failure). Boot rejected; run scripts/smoke_test.py against emmy-serve for deeper diagnostics.`,
		);
		this.name = "SpOkCanaryError";
	}
}

export class MaxModelLenError extends UxError {
	constructor(
		public readonly at: string,
		detail: string,
	) {
		super(`max_model_len.${at}`, detail);
		this.name = "MaxModelLenError";
	}
}
