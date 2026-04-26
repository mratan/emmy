// Phase 04.5 Plan 04 — Concurrency governor.
//
// Caps Agent dispatches at `maxConcurrent` (default 2 — vLLM-imposed hardware
// ceiling per Phase 04.2 vLLM concurrency spike). Reduces effective cap to 1
// when parent input tokens exceed `longContextSerializeThresholdTokens` (default
// 40K — a 40K parent already consumes >35% of max_input_tokens=114688; KV
// pressure from parallel children would risk vLLM preemption).
//
// I3 LOCKED default: `rejectOverCap: true`. The 3rd concurrent dispatch is
// REJECTED (not queued). This is the V5 acceptance behavior — failure is
// bounded, observable via `agent.dispatch.rejected` telemetry, and the parent
// model gets a structured error it can route to.
//
// Telemetry events:
//   - agent.dispatch.queued     — fires when a dispatch waited > 1ms (rejectOverCap=false path)
//   - agent.dispatch.serialized — fires when long-context rule reduces cap to 1
//   - agent.dispatch.rejected   — fires when over-cap dispatch is refused (I3 default)

import { emitEvent } from "@emmy/telemetry";

export interface ConcurrencyGovernor {
	acquire(opts: {
		parentInputTokens?: number;
	}): Promise<{ release: () => void; serialized: boolean; waited_ms: number }>;
}

export interface ConcurrencyGovernorConfig {
	/** Hardware-imposed concurrency cap. Default: 2 (LOCKED — vLLM concurrency spike). */
	maxConcurrent: number;
	/** Parent token threshold above which dispatch serializes. Default: 40000 (LOCKED). */
	longContextSerializeThresholdTokens: number;
	/** I3: when true, over-cap dispatches reject; when false, they queue FIFO. LOCKED default: true. */
	rejectOverCap?: boolean;
}

export function createConcurrencyGovernor(config: ConcurrencyGovernorConfig): ConcurrencyGovernor {
	const rejectOverCap = config.rejectOverCap ?? true; // I3 LOCKED default
	let inFlight = 0;
	const queue: Array<() => void> = [];

	function effectiveCap(parentInputTokens: number | undefined): {
		cap: number;
		serialized: boolean;
	} {
		if (
			parentInputTokens != null &&
			parentInputTokens > config.longContextSerializeThresholdTokens
		) {
			return { cap: 1, serialized: true };
		}
		return { cap: config.maxConcurrent, serialized: false };
	}

	async function acquire(opts: { parentInputTokens?: number }) {
		const startedAt = performance.now();
		const { cap, serialized } = effectiveCap(opts.parentInputTokens);

		if (serialized) {
			emitEvent({
				event: "agent.dispatch.serialized",
				ts: new Date().toISOString(),
				parent_input_tokens: opts.parentInputTokens!,
				threshold: config.longContextSerializeThresholdTokens,
			});
		}

		// I3 — over-cap rejection: skip the wait queue if at cap.
		if (rejectOverCap && inFlight >= cap) {
			emitEvent({
				event: "agent.dispatch.rejected",
				ts: new Date().toISOString(),
				reason: "over_cap",
				in_flight: inFlight,
				cap,
			});
			throw new Error(
				`[Agent] dispatch rejected: concurrent dispatch cap reached (in_flight=${inFlight}, cap=${cap})`,
			);
		}

		// Queue mode (rejectOverCap=false): wait for capacity.
		while (inFlight >= cap) {
			await new Promise<void>((r) => queue.push(r));
		}
		inFlight++;
		const waited_ms = performance.now() - startedAt;
		if (waited_ms > 1) {
			emitEvent({
				event: "agent.dispatch.queued",
				ts: new Date().toISOString(),
				wait_ms: waited_ms,
				in_flight: inFlight,
				cap,
			});
		}
		let released = false;
		const release = () => {
			if (released) return; // idempotent — second call is no-op
			released = true;
			inFlight--;
			const next = queue.shift();
			if (next) next();
		};
		return { release, serialized, waited_ms };
	}

	return { acquire };
}
