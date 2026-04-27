# V-Protocols autonomous run — blocker findings, 2026-04-26

Autonomous Claude attempted V1/V3 from `04.4-09-OPERATOR-PROTOCOLS.md` post-merge.
**Both blocked at profile validation.** Operator decision required before any
V-protocol can run against the merged tree.

## Blocker

All 4 shipped profiles fail `uv run emmy profile validate`:

| Profile | Stored sha256 (profile.yaml) | Recomputed (just now) |
|---------|------------------------------|------------------------|
| qwen3.6-35b-a3b/v3.1 | a3716a86… | a06d1bea… |
| qwen3.6-27b/v1.1     | cfcfeb97… | eefd7c7a… |
| gemma-4-26b-a4b-it/v2 | af2e9992… | 9a2a0c54… |
| gemma-4-31b-it/v1.1  | ffbf7e7d… | eebba605… |

`pi-emmy` boot fails with exit 4 (prereq error: profile failed validation),
because Phase 04.5-02 added a `subagents:` block to all 4 `harness.yaml` files
and did NOT recompute the bundle sha256 stored in `profile.yaml`. This is the
"Profile hash bumps DEFERRED" item flagged in the 04.5 EXEC-STATUS § Notes 4.

D-03 / PROFILE-06 LOCKED invariant: profiles are immutable; any post-creation
edit is disallowed. The validator catches this and refuses to boot.

## Why this surfaces NOW (not on either branch alone)

- 04.4 only: 04.4-03 added `memory:` blocks and recomputed the 4 hashes ✓
- 04.5 only: 04.5-02 added `subagents:` blocks but did NOT recompute (deferred) ✗
- Merged: stored hashes are post-04.4 (a3716a86, …); computed hashes include
  04.5's additive `subagents:` block — they no longer match.

## Operator decision required

Per `.planning/phases/04.5-observable-sub-agent-dispatch-v1-inserted/04.5-EXEC-STATUS.md`
Notes § 4, two paths:

1. **In-place rev-bump.** Recompute and overwrite `profile.yaml`'s sha256 in
   the existing v3.1 / v1.1 / v2 / v1.1 directories. Violates D-03 / PROFILE-06
   ("any edit to v1 after creation is disallowed") but is operationally
   simplest. Telemetry / Langfuse data history continues unbroken under the
   same profile id+version. Aligned with 04.5 EXEC-STATUS author's hint that
   the change is "purely additive" so the contract is unbroken.

2. **Cut new versions.** `profiles/qwen3.6-35b-a3b/v3.2`, `qwen3.6-27b/v1.2`,
   `gemma-4-26b-a4b-it/v2.1`, `gemma-4-31b-it/v1.2`. Honor D-03 strictly. Update
   `routes.yaml`, `start_emmy.sh`, eval/MATRIX.md, runbook.md to reference
   the new dirs. Clean break in telemetry — historical traces under v3.1/v1.1
   remain queryable but separate from post-04.5 traces.

Recommendation: **path 1**, on the grounds that 04.5-02's changes are strictly
additive (new `subagents:` block, never modifying existing keys) and the
intent of D-03 is to prevent silent behavioral drift, which doesn't apply
to additive-only changes. But this is your call.

## What was attempted before the blocker fired

1. V8 SC walkthrough — partial. Documented separately in
   `.planning/phases/04.5-observable-sub-agent-dispatch-v1-inserted/runs/v8-FINDING.md`.
   Functional dispatch GREEN; W1 4-level trace tree FAILED for an unrelated
   architectural reason (session.ts doesn't own a `parent_session` span).

2. V3 rot test fixture — staged at `/tmp/v3-rot-test/` with the 5 planted
   notes per OPERATOR-PROTOCOLS § V3 and 5 truth-source files contradicting
   them:
   - api-format note (camelCase) vs `src/api/handler.ts` (snake_case `request_id`)
   - auth note (HS256) vs `src/auth/auth.ts` (RS256 via jose)
   - db-pool note (50) vs `src/db/pool.ts` (max: 200)
   - env-var note (LOG_LEVEL=verbose) vs `src/config/logger.ts` (DEBUG=1)
   - route note (POST /api/v1/users) vs `src/routes/users.ts` (POST /users)

   Once profile hashes are resolved, V3 can run by:
   ```
   cd /tmp/v3-rot-test
   pi-emmy --profile $REPO/profiles/qwen3.6-35b-a3b/v3.1 --print "<question>"
   ```
   for each of the 5 questions in OPERATOR-PROTOCOLS § V3 step 3.

3. V1 batch — not started (profile validation gates the very first call).

4. V2 (memory) — derives from V1, not started.

5. V2 (compaction) — deliberately skipped by autonomous Claude. 10 sessions
   × 86K tokens needs sustained 30+ turn drives per session; cost outweighs
   partial signal.

6. V8 (memory + compaction) — explicitly require organic 1–2h human use;
   not authentically reproducible by autonomous Claude regardless of profile state.

## Path to flip the gates green

Once operator decides hash path:

1. (path 1) recompute + overwrite stored hashes in 4 `profile.yaml` files; OR
   (path 2) clone-and-promote 4 new version dirs + update routes.yaml + scripts.
2. Re-run `uv run emmy profile validate profiles/<each>/` until all 4 print
   ` OK profile valid`.
3. Run V3 (CRITICAL) — autonomous Claude can drive this if asked.
4. Run V1 (20-task batch) — autonomous Claude can drive this if asked.
5. Run V2-memory (derived from V1) — free.
6. V2-compaction + V8s remain operator-time work.

ETA on items 3+4 by autonomous Claude: ~45 min once profiles validate.

---

*Captured 2026-04-26 by autonomous Claude post-merge.*
*Blocker is environmental + operator-pref, not a bug in 04.4 implementation.*
