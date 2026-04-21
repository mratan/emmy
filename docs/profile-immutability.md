# Profile Immutability (PROFILE-06) — 3-Layer Enforcement

Profiles under `profiles/<name>/v<N>/` are immutable. Any field change — whether
a YAML key, a prompt character, a grammar byte, or a `PROFILE_NOTES.md` line —
creates a new version directory (`v<N+1>/`). Three layers enforce this:

## Layer 1 — Validator (always on)

`emmy profile validate <path>` recomputes the bundle hash via the
canonicalization algorithm in `emmy_serve.profile.hasher` and compares to the
stored `profile.yaml.hash`. Exit codes (`01-RESEARCH.md` §5):

| Code | Meaning                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | Schema + hash + policy all OK                                                                                 |
| 1    | Schema error (missing field, wrong type, unknown key)                                                         |
| 2    | Hash mismatch — body edited without bumping the version (D-03 / PROFILE-06 violation)                          |
| 3    | Canonicalization error (symlink, non-UTF-8, disallowed dotfile)                                               |
| 4    | Cross-field policy failure (`env.VLLM_NO_USAGE_STATS != "1"` or `env.HF_HUB_OFFLINE != "1"`)                   |

`scripts/start_emmy.sh` invokes this as a boot-time pre-flight (Step 2);
every CI + pre-commit layer below reuses the same validator.

## Layer 2 — Git pre-commit hook (recommended for developers)

`.githooks/pre-commit` invokes `emmy profile validate` on every profile bundle
whose files are staged for commit. Activate once:

```bash
git config core.hooksPath .githooks
```

From that point on, a commit that edits `profiles/qwen3.6-35b-a3b/v1/` without
also updating `profile.yaml.hash` (or without bumping to `v2/`) aborts with an
actionable remediation message.

Bypass with `git commit --no-verify` only when you are deliberately committing
a recompute-and-hash change — the hook will pass once the manifest hash is
updated. The hook prints the exact recompute command:

```bash
uv run emmy profile hash profiles/<name>/v<N>/ --write
```

## Layer 3 — CI enforcement (self-hosted + cloud)

`.github/workflows/airgap.yml` has a `profile-hash-integrity` job that runs
`emmy profile validate` on every `profiles/*/v*/` bundle on every PR touching
`profiles/**` or `emmy_serve/**` or `scripts/start_emmy.sh` or `air_gap/**`.
The job runs on a GitHub-hosted `ubuntu-latest` runner (no GPU or self-hosted
runner required), so it is never starved by the air-gap job's Spark serialization.
Any hash mismatch or policy violation fails the PR.

This layer is what makes `--no-verify` harmless at the project level — a
developer can bypass locally, but cannot merge without CI blessing.

## Why not `chattr +i` or filesystem ACLs?

- Filesystem immutable bit requires root.
- Breaks `git gc` and normal git object operations.
- Doesn't protect against `rm -rf + recreate-and-regenerate`.
- OS-specific (Linux-only; macOS developers are stuck).

The 3-layer validator chain is strictly better for a single-user tool +
research artifact reviewed via git. It catches every mutation route that
matters, works cross-platform, and never requires privilege escalation.

## Recomputing after legitimate edits

Two Phase-1 code paths legitimately mutate the active `v1/` bundle after its
initial commit:

| Path                             | What it writes                                         |
| -------------------------------- | ------------------------------------------------------ |
| `scripts/find_kv_budget.py`      | `serving.yaml.engine.gpu_memory_utilization`           |
| `scripts/thermal_replay.py --record-floors` | `PROFILE_NOTES.md` measured-values table    |

Both recompute the manifest hash as part of their normal flow via
`emmy profile hash <bundle> --write`. Any PR that lands such a mutation MUST
cite the run-dir artifact that produced it in `PROFILE_NOTES.md`; CI catches
any drift through the `profile-hash-integrity` job.

For all other edits (prompts, new tool schemas, new grammars, serving field
tuning), bump the version: copy `v1/` to `v2/`, make changes, recompute the
hash, commit. Both versions coexist; downstream code references the desired
version via its path.

## One-time operator setup (Layer 2 activation)

```bash
# From a fresh clone:
cd /path/to/emmy
git config core.hooksPath .githooks
git config --get core.hooksPath   # expect: .githooks

# Verify it fires:
touch profiles/qwen3.6-35b-a3b/v1/serving.yaml    # no content change
git add profiles/qwen3.6-35b-a3b/v1/serving.yaml
git commit -m "test"
# Expect: pre-commit validates (exit 0 on no-op), OR fails with hash mismatch
# if editor rewrote the file (e.g. added trailing whitespace).
```

The Layer 3 CI job requires no per-developer setup — it is enforced centrally
once the workflow is merged.

## See also

- `01-RESEARCH.md` §5 — Layered enforcement rationale.
- `01-RESEARCH.md` §4 — Canonicalization rules (UTF-8 NFC + LF + symlink reject).
- `emmy_serve/profile/immutability.py` — Layer 1 implementation.
- `.githooks/pre-commit` — Layer 2 implementation.
- `.github/workflows/airgap.yml` — Layer 3 implementation.
