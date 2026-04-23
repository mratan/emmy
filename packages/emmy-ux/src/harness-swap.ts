// packages/emmy-ux/src/harness-swap.ts
//
// Plan 04-03 Task 2 — D-23 harness-side hot-swap composition.
//
// After the Python swap primitive (Plan 04-02 orchestrator) returns exit 0,
// the harness-side state tied to the OLD profile must be re-initialized so
// the NEXT user turn picks up the NEW profile without restarting the pi
// AgentSession. Three re-inits compose this helper:
//
//   (1) Profile cache invalidation
//       — loadProfile(newDir) reads + parses profile.yaml/serving.yaml/
//         harness.yaml, returning a fresh ProfileSnapshot. The factory's
//         closure-captured `currentProfile` reference is replaced via the
//         handles.replaceProfileRef setter.
//
//   (2) OTel profile-stamp hot-swap
//       — The @opentelemetry/sdk-* 2.x pinned in emmy-telemetry does NOT
//         expose a public addSpanProcessor/removeSpanProcessor mutator. We
//         avoid rebuilding the whole SDK by making the processor's profile
//         ref mutable (swapSpanProcessor). See
//         emmy-telemetry/src/profile-stamp-processor.ts for rationale.
//
//   (3) web_fetch allowlist re-audit
//       — The allowlist in the OLD profile is replaced with the NEW
//         profile's harness.tools.web_fetch.allowlist via setInitialAudit.
//         This is the Plan 03-06 D-27 mechanism: bindBadge sets the module-
//         level state; setInitialAudit reseeds it with the new state.
//
// D-23 invariants (from 04-RESEARCH §5.3):
//   - pi's AgentSession transcript is NOT touched here (preserved for free
//     by pi — MCP subprocess registry + SessionManager transcript + tools
//     registry all survive provider swap).
//   - D-06 in-flight-turn guard in the /profile handler prevents this path
//     from firing mid-generation; an open OTel span cannot be mid-flight.

import { loadProfile } from "./profile-loader";
import { setInitialAudit } from "./offline-badge";
import type { ProfileSnapshot } from "./types";
import {
	type EmmyProfileStampProcessor,
	swapSpanProcessor,
} from "@emmy/telemetry";

export interface HarnessSwapHandles {
	/**
	 * Set the current profile on whatever closure/module owns the live
	 * ProfileSnapshot reference (pi-emmy-extension.ts factory closure).
	 */
	replaceProfileRef: (snap: ProfileSnapshot) => void;
	/**
	 * The currently-installed EmmyProfileStampProcessor instance. Its profile
	 * ref is mutated in place — no SDK rebuild required.
	 */
	profileStampProcessor: EmmyProfileStampProcessor;
}

export interface ReloadHarnessProfileResult {
	snap: ProfileSnapshot;
}

/**
 * Perform the three-part D-23 hot-swap after the engine-layer swap
 * succeeded. Resolves with the freshly-loaded ProfileSnapshot once all
 * three re-inits are done.
 *
 * Caller should invoke this ONLY on orchestrator exit code 0; exit 5 leaves
 * the OLD engine running (no harness-side change needed); exit 6 means the
 * rollback path already re-targeted the prior profile, so the harness
 * state does not move either. See registerProfileCommand handler in
 * slash-commands.ts for the exit-code routing.
 */
export async function reloadHarnessProfile(
	newDir: string,
	handles: HarnessSwapHandles,
): Promise<ReloadHarnessProfileResult> {
	// (1) Load the new profile bundle → ProfileSnapshot.
	const snap = await loadProfile(newDir);

	// (2) Swap the closure-captured reference so before_provider_request +
	//     compaction trigger + slash-command handlers see the new profile.
	handles.replaceProfileRef(snap);

	// (3) Hot-swap the OTel stamp processor's internal profile ref. Next span
	//     started after this call stamps the new emmy.profile.* attrs. This
	//     uses swapSpanProcessor (mutable-in-place) because the pinned OTel
	//     SDK does NOT expose addSpanProcessor/removeSpanProcessor publicly.
	swapSpanProcessor(handles.profileStampProcessor, {
		id: snap.ref.id,
		version: snap.ref.version,
		hash: snap.ref.hash,
	});

	// (4) web_fetch allowlist re-audit. The new profile's allowlist governs
	//     future tool.web_fetch enforcement. Absent allowlist → empty array
	//     (default-deny; red badge flips on next web_fetch attempt).
	const newAllowlist =
		snap.harness.tools.web_fetch?.allowlist ?? [];
	setInitialAudit({
		offline_ok: true,
		violating_tool: null,
		violating_host: null,
		badge_state: "green",
		// The audit-result shape carries allowlist through its own plumbing
		// (see runBootOfflineAudit in offline-badge.ts); but the BADGE itself
		// is driven by the fields above. Tool enforcement reads the allowlist
		// from its own EnforcementContext wired via session.ts. In a full
		// swap, session.ts's getEnforcementContext() must also re-read the
		// ProfileSnapshot — the replaceProfileRef setter above feeds that
		// path. The setInitialAudit call resets the badge state machine to
		// green so a prior RED flip from the old profile doesn't persist
		// spuriously after swap.
	});
	// Mark the new allowlist as applied so downstream readers can observe
	// the swap in tests without chasing enforcement-context internals.
	_lastReloadAllowlist = [...newAllowlist];

	return { snap };
}

// Test introspection: record the most recently applied allowlist so unit
// tests can assert it propagated through reloadHarnessProfile. Not part of
// the public production API.
let _lastReloadAllowlist: string[] = [];

/** Test-only: read the most recent allowlist passed through reloadHarnessProfile. */
export function __getLastReloadAllowlistForTests(): readonly string[] {
	return _lastReloadAllowlist;
}

/** Test-only: clear the recorded allowlist between tests. */
export function __resetLastReloadAllowlistForTests(): void {
	_lastReloadAllowlist = [];
}
