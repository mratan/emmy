// packages/emmy-ux/src/footer.ts
//
// Plan 03-04 Task 2 (GREEN). TUI footer formatter (UX-02).
//
// Output shape (verbatim from UX-02 spec):
//   `GPU N% • KV N% • spec accept - • tok/s N`
//
// D-24 degrade rendering:
//   - `{value}?` suffix when {field}Degraded=true (last-good value shown,
//     most-recent poll failed; poller bookkeeping limits this to failures
//     1..maxFailures).
//   - `--` placeholder when {value}=undefined (poller has blanked the field
//     beyond maxFailures or has no value yet).
//
// D-25: spec-accept is literal `-` until Phase 6 wires
// `vllm:spec_decode_draft_acceptance_length` from the vLLM exporter.

export interface FooterValues {
	gpuPct?: number;
	/** D-24: append `?` suffix because this value is last-good (not fresh). */
	gpuDegraded?: boolean;
	kvPct?: number;
	kvDegraded?: boolean;
	specAccept?: string;
	tokPerS?: number;
	tokDegraded?: boolean;
}

/**
 * Build the TUI footer text from a `FooterValues` snapshot.
 *
 * Called by `metrics-poller.ts` on every 1 Hz tick with the latest cached
 * values + per-field degrade flags; result is passed to
 * `ctx.ui.setStatus("emmy.footer", ...)` inside pi 0.68's extension API.
 *
 * Rendering rules:
 *   - `%` suffix is always applied to GPU / KV (they are percentages).
 *   - tok/s has no `%` suffix — it's a rate.
 *   - D-24 `?` marker is appended AFTER the unit (GPU 45%? — `?` follows
 *     the full unit-bearing value so degraded-state text reads naturally).
 *   - `--` placeholder replaces the value when undefined; the unit is
 *     retained (GPU --% / tok/s --).
 */
export function formatFooter(v: FooterValues): string {
	const gpu = renderPct(v.gpuPct, v.gpuDegraded);
	const kv = renderPct(v.kvPct, v.kvDegraded);
	const spec = v.specAccept ?? "-";
	const tok = renderScalar(v.tokPerS, v.tokDegraded);
	return `GPU ${gpu} • KV ${kv} • spec accept ${spec} • tok/s ${tok}`;
}

function renderPct(value: number | undefined, degraded: boolean | undefined): string {
	if (value === undefined) return "--%";
	const rounded = Math.round(value);
	return degraded ? `${rounded}%?` : `${rounded}%`;
}

function renderScalar(value: number | undefined, degraded: boolean | undefined): string {
	if (value === undefined) return "--";
	const rounded = Math.round(value);
	return degraded ? `${rounded}?` : `${rounded}`;
}
