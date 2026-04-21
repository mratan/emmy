# Self-hosted CI runner on DGX Spark (Phase 1 — REPRO-03 / D-10)

The air-gap workflow (`.github/workflows/airgap.yml`) runs on a self-hosted GitHub Actions runner
hosted on the DGX Spark. One-time operator setup below.

## 1. Create dedicated OS user
```bash
sudo useradd -m -s /bin/bash emmy-ci
sudo usermod -aG docker emmy-ci    # so runner can invoke docker without sudo
# NO sudo access — the runner must never have root
```

## 2. Register the runner
Follow GitHub's official instructions under Repo Settings → Actions → Runners → New self-hosted runner.
Install into `/data/ci-runner/_work/emmy/emmy/` (work directory).

## 3. Label the runner
Apply the label `dgx-spark` so workflows with `runs-on: [self-hosted, dgx-spark]` match.

## 4. File-system access
The runner user must be able to read:
- `/data/models/Qwen3.6-35B-A3B-FP8/` (weights)
- `~/.cache/huggingface/` or `/data/hf-cache/` (HF metadata; `HF_HOME` during runs)

## 5. Concurrency
Workflow defines `concurrency: { group: airgap-${{ github.ref }}, cancel-in-progress: true }`
so only one air-gap run per PR head.

## 6. Secrets
HF_TOKEN is NOT set via GitHub secrets; tokens live in `~/.cache/huggingface/token` on the host
and are mounted read-only into the container when needed. This avoids exposing secrets to the
workflow environment and matches the offline-first model.

## 7. Verify
After registration, push a commit that touches `emmy-serve/**` and confirm the air-gap workflow
queues on the self-hosted runner (visible in GitHub UI).

## 8. Certification after registration (SC-4 gate)

After §1–§7 are complete and the runner reports online in GitHub Settings → Actions →
Runners, run the certification flow from `docs/airgap-green-run.md`:

1. From a feature branch: `./scripts/trigger_airgap_ci.sh`
2. Wait for the `airgap-replay` job to complete (~5–10 min).
3. Run: `./scripts/verify_airgap_ci.sh`
4. On exit 0, commit the `airgap-report.json` artifact as certification evidence
   per `docs/airgap-green-run.md` §5.

### What a green run proves

- **SC-4:** 50-turn synthetic coding session produces zero outbound packets
  (`docker run --network none` + 4-layer D-12 probe: (a) network devices, (b)
  DNS audit, (c) telemetry env, (d) HF offline env).
- **REPRO-03:** Air-gap reproducibility test runs in CI; anyone with a Spark
  can reproduce.
- **SERVE-09:** `VLLM_NO_USAGE_STATS=1` explicitly asserted in the live
  container (not just the profile schema).

### What the operator commits back

Per `docs/airgap-green-run.md` §5, commit the downloaded
`airgap-report.json` under
`.planning/phases/01-serving-foundation-profile-schema/evidence/airgap-report-sc4-certification.json`
— this turns the transient workflow artifact into durable git history and lets
a future auditor replay the per-layer `commands_run` log.

### When to re-certify

Re-run this flow whenever any of the following change:

- `.github/workflows/airgap.yml`
- `scripts/start_emmy.sh` (boot path)
- `scripts/airgap_probe.py` / `emmy_serve/airgap/` (D-12 logic)
- `profiles/*/v*/serving.yaml.env` (telemetry / offline env vars)

The `airgap.yml` path filters already re-trigger on these changes automatically,
but the **operator certification** (steps 1–4 above) is the durable gate: a PR
that alters any of these files SHOULD carry a fresh green-run commit under
`.planning/.../evidence/` before merge.

See `docs/airgap-green-run.md` for the full runbook, expected output, and
failure-mode handbook.
