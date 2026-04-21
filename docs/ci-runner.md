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
