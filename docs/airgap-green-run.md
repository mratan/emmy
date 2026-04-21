# Air-Gap CI Green-Run Runbook (SC-4 Certification)

This runbook certifies **Phase 1 Success Criterion 4**: "50-turn synthetic coding
session produces zero outbound network packets verified via ss/tcpdump snapshot in
CI." It is run ONCE per self-hosted-runner lifetime (and optionally re-run on major
CI changes per the list in `docs/ci-runner.md` §8).

The machinery is three committed artifacts:

- `scripts/trigger_airgap_ci.sh` — pushes a trivial branch edit that fires the
  workflow's path filters.
- `scripts/verify_airgap_ci.sh` — downloads the `airgap-report` artifact and
  validates it against the 4-layer D-12 contract.
- `emmy_serve/airgap/ci_verify.py` — the pure-Python validator both scripts
  and unit tests use.

## Prerequisite

The self-hosted GitHub Actions runner is registered on the DGX Spark with label
`dgx-spark`. See `docs/ci-runner.md` §1–§7. If the runner is not registered, this
runbook cannot proceed — the `airgap-replay` job will queue forever.

Verify via `gh`:

```bash
gh api repos/:owner/:repo/actions/runners \
  | jq '.runners[] | {name, status, labels: [.labels[].name]}'
```

Expect at least one runner with `"online"` status and `"dgx-spark"` in its labels.

## Steps

### 1. Trigger the workflow

From a clean checkout on a feature branch (not `main`):

```bash
cd /path/to/emmy
git checkout -b sc4-airgap-certification
./scripts/trigger_airgap_ci.sh
```

The script:

- Verifies working tree is clean (`git status --porcelain` empty).
- Refuses if current branch is `main`.
- Appends a timestamped marker comment to `air_gap/README.md` (in the workflow's
  path filters).
- Does NOT touch `air_gap/session.jsonl` (immutable fixture per Plan 01-05).
- Commits + pushes the current branch with upstream tracking (`-u origin HEAD` on
  first push).
- If `gh` CLI is installed, creates or references the PR and prints the
  workflow-run URL.

### 2. Observe the run

Open the PR's Checks tab (printed by `trigger_airgap_ci.sh`). Two jobs:

- `profile-hash-integrity` on `ubuntu-latest` — ~30s. Validates every
  `profiles/*/v*/` bundle via `emmy profile validate`. This job has NO GPU needs
  and is the fast gate before any self-hosted runner time is used.

- `airgap-replay` on `[self-hosted, dgx-spark]` — ~5–10 min. Boots emmy-serve with
  `--network none`, runs the D-12 four-layer probe, replays the 50-turn
  `air_gap/session.jsonl`, runs the REPRO-04 offline-HF test, and uploads
  `runs/ci-airgap/airgap-report.json` as artifact `airgap-report`.

Expected outcome: both jobs green.

Poll via `gh` if you prefer:

```bash
gh run list --branch sc4-airgap-certification --workflow airgap.yml --limit 1
```

### 3. Certify the run

Once `airgap-replay` completes:

```bash
./scripts/verify_airgap_ci.sh
```

The script:

- Runs `gh run list ... --limit 1 --json databaseId -q '.[0].databaseId'` to find
  the latest workflow run on the current branch.
- Downloads the `airgap-report` artifact via `gh run download`.
- Invokes `emmy_serve.airgap.ci_verify` to validate the JSON.
- Exits 0 iff `passes=true`, `failures=[]`, and all four D-12 layers `passed=true`.

Example output (green):

```
downloading airgap-report artifact from run 12345678 -> /tmp/airgap-report-XYZ
validating /tmp/airgap-report-XYZ/airgap-report.json
airgap-report OK: passes=True, 4 layers green, failures=[]
  ts: 2026-04-22T03:00:00Z
  container: emmy-serve
```

Example output (red — layer (a) fail):

```
validating /tmp/airgap-report-XYZ/airgap-report.json
airgap-report FAILED validation:
  - passes=False (expected True)
  - failures is non-empty: ["layer (a) network_devices FAILED: ..."]
  - layer (a) network_devices not passed: expected only 'none' network, got ['bridge']
```

If `gh` is not installed on the host where you run the verifier, download the
`airgap-report` artifact manually from the GitHub Actions UI and run:

```bash
./scripts/verify_airgap_ci.sh --from-file /path/to/airgap-report.json
```

### 4. What counts as "4 layers green"?

Per `emmy_serve/airgap/probe.py`:

| Layer | Name | Proves |
|-------|------|--------|
| a | network_devices | `docker inspect` shows only the `none` network; `ip addr` inside the container shows only `lo`, no `eth*/ens*/wlan*/enp*/wlp*` |
| b | dns_audit | `/etc/resolv.conf` contains no non-loopback nameservers; `getent hosts huggingface.co` fails |
| c | telemetry_env | `VLLM_NO_USAGE_STATS=1` AND `DO_NOT_TRACK=1` inside the container |
| d | hf_offline_env | `HF_HUB_OFFLINE=1` AND `TRANSFORMERS_OFFLINE=1` inside the container |

Any layer failure identifies itself in the `failures` list with its letter
(`layer (a) ...`, `layer (b) ...`) — that's the grepable audit trail.

The validator also rejects **contradictory** reports (threat T-08-01): a report
with `passes=true` but any individual `layer.passed=false` is caught and fails
verification, even if the top-level boolean was tampered with.

### 5. Commit the certification evidence

Once `verify_airgap_ci.sh` exits 0, the SC-4 contract is satisfied for this
branch. Commit a certification receipt so the evidence lives in git history, not
just in a transient workflow artifact:

```bash
# Save the artifact JSON for provenance (runs/ci-airgap/ is gitignored by default
# but we commit the green-run evidence under .planning/ for durability).
mkdir -p .planning/phases/01-serving-foundation-profile-schema/evidence/

# The verify script prints its download location; capture it or re-download:
gh run download "$(gh run list --branch sc4-airgap-certification --workflow airgap.yml --limit 1 --json databaseId -q '.[0].databaseId')" \
    --name airgap-report --dir /tmp/airgap-report-certify

cp /tmp/airgap-report-certify/airgap-report.json \
   .planning/phases/01-serving-foundation-profile-schema/evidence/airgap-report-sc4-certification.json

git add .planning/phases/01-serving-foundation-profile-schema/evidence/airgap-report-sc4-certification.json

RUN_URL="$(gh run list --branch sc4-airgap-certification --workflow airgap.yml --limit 1 --json url -q '.[0].url')"
git commit -m "chore(01-08): SC-4 certification evidence — airgap-report.json (green CI run)

- branch: sc4-airgap-certification
- workflow run: $RUN_URL
- passes: true; 4/4 D-12 layers green; failures: []
- Phase 1 SC-4 + REPRO-03 + SERVE-09 now VERIFIED"

git push
```

Merge the PR (the marker commit from `trigger_airgap_ci.sh` is harmless — it just
accumulates as a lightweight history log of certifications) OR reset the branch
to `main` after the CI run lands. GitHub retains the completed CI run regardless
of branch history.

## Failure mode handbook

| Symptom | Likely cause | Remediation |
|---------|--------------|-------------|
| `airgap-replay` queued but never starts | self-hosted runner offline | `systemctl status actions.runner.*` on the DGX Spark; restart if needed |
| Layer (a) fail: "got ['bridge']" or similar | `start_emmy.sh --airgap` did not pass `--network none` | Check `scripts/start_emmy.sh`; confirm `--airgap` flag is wired through to `docker run` via `emmy_serve.boot.runner render-docker-args` |
| Layer (b) fail: "getent resolved huggingface.co" | Container has DNS reachability despite `--network none` (misconfigured) | Inspect container's `/etc/resolv.conf`; investigate host routing; confirm `docker run --network none` was actually used |
| Layer (c) fail: env var missing | `serving.yaml.env` regressed | `uv run emmy profile validate` locally — cross-field validator catches this normally |
| Layer (d) fail: env var missing | same as (c) | same |
| 50-turn replay errors inside the container | vLLM endpoint not ready / tool schema mismatch | `docker logs emmy-serve`; check `air_gap/session.jsonl` is unmodified from Plan 01-05 |
| `verify_airgap_ci.sh` exits 2 with "gh CLI not installed" | `gh` missing on host running verify | Install `gh` (`sudo apt install gh`) OR use `--from-file` with a manually-downloaded JSON |
| `verify_airgap_ci.sh` exits 2 with "no airgap.yml run found" | First run hasn't happened yet / wrong branch | Check `gh run list --branch <branch> --workflow airgap.yml`; run `trigger_airgap_ci.sh` first |
| `verify_airgap_ci.sh` exits 2 with "airgap-report.json not found in downloaded artifact" | Workflow uploaded but artifact shape regressed | Inspect the mktemp'd outdir; verify `.github/workflows/airgap.yml` still uploads `runs/ci-airgap/` with `name: airgap-report` |

**Do NOT edit the D-12 probes to make a failing layer pass.** That's CLAUDE.md
pitfall #5 in action — "hidden cloud dependencies". If a layer fails, the
**serving stack is broken**, not the probe. Fix the underlying boot / env / docker
configuration.

## Why this matters

CLAUDE.md pitfall #5 is "hidden cloud dependencies — critical." This runbook + the
committed scripts convert the latent risk "the CI could silently be broken" into a
deterministic two-command certification. Any future code change that breaks
air-gap discipline (e.g. adding a tool that hits the network, forgetting to
propagate an env var, removing `--network none`) will fail the corresponding D-12
layer, and `verify_airgap_ci.sh` will refuse to certify.

The `airgap.yml` workflow's path filters re-trigger on every change to the
sensitive files listed in `docs/ci-runner.md` §8, so regression catches are
automatic — but the **first green run must be certified manually** to establish
the baseline. That's what this runbook does.

## Cross-references

- `docs/ci-runner.md` §1–§7 — one-time self-hosted runner setup on the DGX Spark.
- `docs/ci-runner.md` §8 — "Certification after registration" — points back here
  for the two-script flow.
- `docs/profile-immutability.md` — the 3-layer PROFILE-06 enforcement (Layer 3
  runs on `ubuntu-latest` as `profile-hash-integrity` in the same workflow).
- `.planning/phases/01-serving-foundation-profile-schema/01-05-SUMMARY.md` §"Phase
  B Launch Instructions" — the original hand-off from Plan 01-05.
- `.planning/phases/01-serving-foundation-profile-schema/01-VERIFICATION.md` — SC-4
  gap text that this runbook closes.
